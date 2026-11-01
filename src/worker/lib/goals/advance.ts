import type { AppBindings } from "../../env"
import { resolveModel } from "../chat/prepare-turn"
import * as agentsRepo from "../db/agents"
import { now } from "../db/client"
import * as goals from "../db/goals"
import type { Goal, GoalEdge, GoalNode } from "../db/types"
import { executeNode } from "./executor"
import {
  applyTasksPlan,
  planNextMove,
  validateTasksPlan,
  type Plan,
} from "./planner"

/** How many independent ready tasks run at once. */
const MAX_PARALLEL = 3
/** Executions of one task before a person is asked. */
export const MAX_ATTEMPTS = 2
const LEASE_SECONDS = 600
/** Consecutive refused plans before a person is asked. */
const MAX_INVALID_PLANS = 2

const FINISHED = new Set(["delivered", "retired"])

export type TickOutcome = { continue: boolean }

const STOP: TickOutcome = { continue: false }
const GO: TickOutcome = { continue: true }

const WAITING = "Waiting for a person to decide what to do next"

/** Verification and gate nodes sort after the tasks of the round they close. */
const CLOSING_PRIORITY = 1000

/** Nodes whose prerequisites are all delivered (or retired), so can run now. */
function runnable(nodes: GoalNode[], edges: GoalEdge[]): GoalNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return nodes.filter(
    (node) =>
      (node.status === "proposed" || node.status === "ready") &&
      edges
        .filter((edge) => edge.sourceNodeId === node.id)
        .every((edge) => {
          const target = byId.get(edge.targetNodeId)
          return !target || FINISHED.has(target.status)
        })
  )
}

/**
 * One scheduler tick: run whatever is ready, or ask the goal manager what to
 * do next, and say whether there is more to do. Only one tick runs a goal at a
 * time (a lease), so duplicate or retried workflow runs are harmless.
 */
export async function advanceGoal(
  env: AppBindings,
  goalId: string
): Promise<TickOutcome> {
  if (!(await goals.acquireLease(env.DB, goalId, LEASE_SECONDS))) return STOP
  try {
    return await tick(env, goalId)
  } finally {
    await goals.releaseLease(env.DB, goalId)
  }
}

async function finish(
  db: D1Database,
  goal: Goal,
  status: "achieved" | "failed" | "paused",
  reason: string
): Promise<TickOutcome> {
  await goals.setGoalStatus(db, goal.id, { status, reason })
  if (status === "failed") await goals.cancelPendingDecisions(db, goal.id)
  await goals.recordEvent(db, {
    goalId: goal.id,
    eventType: `goal_${status}`,
    entityType: "goal",
    entityId: goal.id,
    actorType: "system",
    reason,
  })
  return STOP
}

/** Put a question to a person: a blocked node plus a decision with options. */
async function openGate(
  db: D1Database,
  goal: Goal,
  params: {
    nodeId?: string
    title: string
    question: string
    options: Array<{ id: string; label: string }>
    recommended: string
  }
): Promise<void> {
  const nodeId =
    params.nodeId ??
    (
      await goals.insertNode(db, {
        goalId: goal.id,
        kind: "decision",
        status: "blocked",
        title: params.title,
        description: params.question,
        round: goal.rounds,
        priority: CLOSING_PRIORITY,
      })
    ).id
  const decision = await goals.insertDecision(db, {
    goalId: goal.id,
    nodeId,
    question: params.question,
    options: params.options,
    recommendedOptionId: params.recommended,
  })
  await goals.recordEvent(db, {
    goalId: goal.id,
    eventType: "decision_opened",
    entityType: "decision",
    entityId: decision.id,
    actorType: "system",
    reason: params.question,
  })
}

const ESCALATION_OPTIONS = [
  { id: "continue", label: "Continue: the manager plans again with my note" },
  { id: "stop", label: "Stop this goal" },
]

async function tick(env: AppBindings, goalId: string): Promise<TickOutcome> {
  const db = env.DB
  const goal = await goals.findGoal(db, goalId)
  if (!goal || goal.status !== "running") return STOP
  const userId = (await goals.goalOwner(db, goalId))!
  let nodes = await goals.listNodes(db, goalId)
  const edges = await goals.listEdges(db, goalId)

  // An earlier run may have died mid-task: put its work back in the queue.
  const stale = nodes.filter((node) => node.status === "running")
  for (const node of stale) {
    await goals.updateNode(db, node.id, { status: "ready" })
    if (node.taskId)
      await goals.updateTask(db, node.taskId, { status: "pending" })
  }
  if (stale.length > 0) nodes = await goals.listNodes(db, goalId)

  const frontier = runnable(nodes, edges).slice(0, MAX_PARALLEL)
  if (frontier.length > 0) {
    await Promise.all(
      frontier.map((node) => runNode(env, { goal, userId, node, nodes, edges }))
    )
    const after = await goals.listNodes(db, goalId)
    if (after.some((node) => node.status === "blocked")) {
      return finish(db, goal, "paused", WAITING)
    }
    return GO
  }

  if (nodes.some((node) => node.status === "blocked")) {
    return finish(db, goal, "paused", WAITING)
  }

  const open = nodes.filter((node) => !FINISHED.has(node.status))
  const verification = nodes
    .filter((node) => node.kind === "verification")
    .at(-1)
  if (open.length === 0 && verification?.verdict === "pass") {
    return finish(
      db,
      goal,
      "achieved",
      "The reviewer confirmed the requirement is met"
    )
  }
  if (open.length > 0) {
    return finish(
      db,
      goal,
      "failed",
      "Some tasks are waiting on work that will never finish"
    )
  }

  return managerTurn(env, { goal, userId, nodes, edges })
}

async function runNode(
  env: AppBindings,
  params: {
    goal: Goal
    userId: string
    node: GoalNode
    nodes: GoalNode[]
    edges: GoalEdge[]
  }
): Promise<void> {
  const { goal, userId, node, nodes, edges } = params
  const db = env.DB
  await goals.updateNode(db, node.id, { status: "running" })
  await goals.recordEvent(db, {
    goalId: goal.id,
    eventType: "node_started",
    entityType: "node",
    entityId: node.id,
    actorType: "system",
    reason: node.title,
  })

  const tasks = new Map(
    (await goals.listTasks(db, goal.id)).map((task) => [task.id, task])
  )
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const prerequisites = edges
    .filter((edge) => edge.sourceNodeId === node.id)
    .flatMap((edge) => {
      const target = byId.get(edge.targetNodeId)
      const task = target?.taskId ? tasks.get(target.taskId) : undefined
      return target && target.status === "delivered" && target.kind === "task"
        ? [{ title: target.title, result: task?.result ?? null }]
        : []
    })

  const outcome = await executeNode(env, { goal, userId, node, prerequisites })

  // The goal may have been stopped while this ran; do not overwrite that.
  if ((await goals.getNode(db, node.id))?.status !== "running") return

  if (outcome.ok) {
    await goals.updateNode(db, node.id, {
      status: "delivered",
      verdict: outcome.verdict ?? null,
      resolved_at: now(),
    })
    await goals.recordEvent(db, {
      goalId: goal.id,
      eventType: "node_delivered",
      entityType: "node",
      entityId: node.id,
      actorType: "agent",
      reason: outcome.verdict ? `Verdict: ${outcome.verdict}` : node.title,
    })
    return
  }

  const attempts =
    (node.taskId ? await goals.getTask(db, node.taskId) : null)?.attempts ?? 1
  const willRetry = attempts < MAX_ATTEMPTS
  await goals.recordEvent(db, {
    goalId: goal.id,
    eventType: "node_failed",
    entityType: "node",
    entityId: node.id,
    actorType: "agent",
    reason: `${outcome.error}${willRetry ? " (will retry)" : ""}`,
  })
  if (willRetry) {
    await goals.updateNode(db, node.id, { status: "ready" })
    return
  }
  await goals.updateNode(db, node.id, { status: "blocked" })
  await openGate(db, goal, {
    nodeId: node.id,
    title: node.title,
    question: `"${node.title}" failed after ${attempts} attempts: ${outcome.error}`,
    options: [
      { id: "retry", label: "Try this task again" },
      { id: "retire", label: "Skip this task" },
      { id: "stop", label: "Stop this goal" },
    ],
    recommended: "retry",
  })
}

async function managerTurn(
  env: AppBindings,
  params: { goal: Goal; userId: string; nodes: GoalNode[]; edges: GoalEdge[] }
): Promise<TickOutcome> {
  const { goal, userId, nodes, edges } = params
  const db = env.DB
  const maxTurns = goal.config.maxManagerTurns ?? 12
  if (goal.managerTurns >= maxTurns) {
    return finish(
      db,
      goal,
      "failed",
      "The planning-turn budget was used up before the goal was verified"
    )
  }

  const [events, decisions, tasks, supervisor] = await Promise.all([
    goals.listEvents(db, goal.id, 500),
    goals.listDecisions(db, goal.id),
    goals.listTasks(db, goal.id),
    goal.agentId ? agentsRepo.findOwned(db, goal.agentId, userId) : null,
  ])
  const last = events.at(-1)
  const turn = { ...goal, managerTurns: goal.managerTurns + 1 }
  await goals.updateGoalCounters(db, goal.id, {
    manager_turns: turn.managerTurns,
  })

  let plan: Plan
  try {
    plan = await planNextMove(
      env,
      {
        goal: turn,
        nodes,
        edges,
        tasks,
        guidance: decisions.flatMap((d) =>
          d.status === "resolved" && d.resolution ? [d.resolution] : []
        ),
        rejection: last?.eventType === "plan_rejected" ? last.reason : null,
      },
      resolveModel(supervisor?.model)
    )
  } catch (error) {
    const why = error instanceof Error ? error.message : "unknown error"
    return rejectPlan(
      db,
      turn,
      `The manager did not return a usable plan: ${why}`
    )
  }

  if (plan.action === "escalate") {
    await openGate(db, turn, {
      title: "Needs a person",
      question: plan.reason || "The manager asked for a person to weigh in.",
      options: ESCALATION_OPTIONS,
      recommended: "continue",
    })
    return finish(db, turn, "paused", WAITING)
  }

  if (plan.action === "verify") {
    // The acceptance node closes the work: it depends on every delivered task
    // that nothing else builds on.
    const delivered = nodes.filter(
      (n) => n.kind === "task" && n.status === "delivered"
    )
    const deliveredIds = new Set(delivered.map((n) => n.id))
    const builtOn = new Set(
      edges
        .filter((edge) => deliveredIds.has(edge.sourceNodeId))
        .map((edge) => edge.targetNodeId)
    )
    const task = await goals.insertTask(db, {
      userId,
      goalId: goal.id,
      agentId: goal.agentId,
      title: `Verify: ${goal.title}`,
    })
    const node = await goals.insertNode(db, {
      goalId: goal.id,
      kind: "verification",
      title: `Verify: ${goal.title}`,
      taskId: task.id,
      round: goal.rounds,
      priority: CLOSING_PRIORITY,
    })
    await goals.insertEdges(
      db,
      goal.id,
      delivered
        .filter((leaf) => !builtOn.has(leaf.id))
        .map((leaf) => ({ sourceNodeId: node.id, targetNodeId: leaf.id }))
    )
    await goals.updateGoalCounters(db, goal.id, { invalid_plans: 0 })
    await goals.recordEvent(db, {
      goalId: goal.id,
      eventType: "plan_applied",
      entityType: "node",
      entityId: node.id,
      actorType: "agent",
      reason: plan.reason || "Verification requested",
    })
    return GO
  }

  if (goal.rounds >= goal.maxRounds) {
    return finish(
      db,
      turn,
      "failed",
      "The round budget was used up before the goal was verified"
    )
  }
  const validation = validateTasksPlan(plan, nodes)
  if (!validation.ok) return rejectPlan(db, turn, validation.reason)

  const created = await applyTasksPlan(db, {
    goal,
    userId,
    executorAgentId: goal.config.taskAgentId ?? goal.agentId,
    plan,
  })
  await goals.updateGoalCounters(db, goal.id, { invalid_plans: 0 })
  await goals.recordEvent(db, {
    goalId: goal.id,
    eventType: "plan_applied",
    entityType: "goal",
    entityId: goal.id,
    actorType: "agent",
    reason: `${plan.reason || "Planned tasks"} (${created.length} task${created.length === 1 ? "" : "s"})`,
  })
  return GO
}

/** A plan that cannot be used costs a turn; too many in a row asks a person. */
async function rejectPlan(
  db: D1Database,
  goal: Goal,
  reason: string
): Promise<TickOutcome> {
  const invalid = goal.invalidPlans + 1
  await goals.updateGoalCounters(db, goal.id, { invalid_plans: invalid })
  await goals.recordEvent(db, {
    goalId: goal.id,
    eventType: "plan_rejected",
    entityType: "goal",
    entityId: goal.id,
    actorType: "agent",
    reason,
  })
  if (invalid < MAX_INVALID_PLANS) return GO
  await openGate(db, goal, {
    title: "Needs a person",
    question: `The manager could not produce a usable plan. ${reason}`,
    options: ESCALATION_OPTIONS,
    recommended: "continue",
  })
  return finish(db, goal, "paused", WAITING)
}
