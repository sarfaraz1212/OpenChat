import type { AppBindings } from "../../env"
import * as agentsRepo from "../db/agents"
import * as goals from "../db/goals"
import type { Goal } from "../db/types"
import { scheduleGoal } from "./scheduler"

/** A refusal the router turns into the matching tRPC error. */
export class GoalError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "BAD_REQUEST",
    message: string
  ) {
    super(message)
  }
}

const TERMINAL = ["achieved", "failed", "stopped"]

async function owned(
  env: AppBindings,
  userId: string,
  id: string
): Promise<Goal> {
  const goal = await goals.findOwnedGoal(env.DB, id, userId)
  if (!goal) throw new GoalError("NOT_FOUND", "Goal not found")
  return goal
}

export async function createGoal(
  env: AppBindings,
  userId: string,
  input: {
    title: string
    requirement?: string | null
    agentId?: string
    taskAgentId?: string
    maxRounds?: number
    maxManagerTurns?: number
  }
): Promise<Goal> {
  const supervisor = input.agentId
    ? await agentsRepo.findOwned(env.DB, input.agentId, userId)
    : await agentsRepo.ensureInbox(env.DB, userId)
  if (!supervisor) throw new GoalError("NOT_FOUND", "Agent not found")
  if (
    input.taskAgentId &&
    !(await agentsRepo.findOwned(env.DB, input.taskAgentId, userId))
  ) {
    throw new GoalError("NOT_FOUND", "Task agent not found")
  }
  const goal = await goals.insertGoal(env.DB, {
    userId,
    agentId: supervisor.id,
    title: input.title,
    requirement: input.requirement,
    maxRounds: input.maxRounds,
    config: {
      ...(input.taskAgentId ? { taskAgentId: input.taskAgentId } : {}),
      ...(input.maxManagerTurns
        ? { maxManagerTurns: input.maxManagerTurns }
        : {}),
    },
  })
  await goals.recordEvent(env.DB, {
    goalId: goal.id,
    eventType: "goal_created",
    entityType: "goal",
    entityId: goal.id,
    actorType: "user",
  })
  return goal
}

/** Mark the goal running and wake the scheduler. */
async function run(
  env: AppBindings,
  goal: Goal,
  eventType: "goal_started" | "goal_resumed"
): Promise<void> {
  await goals.setGoalStatus(env.DB, goal.id, { status: "running" })
  await goals.recordEvent(env.DB, {
    goalId: goal.id,
    eventType,
    entityType: "goal",
    entityId: goal.id,
    actorType: "user",
  })
  try {
    await scheduleGoal(env, goal.id)
  } catch (error) {
    await goals.setGoalStatus(env.DB, goal.id, {
      status: "paused",
      reason: "The background scheduler could not be started",
    })
    throw error
  }
}

export async function startGoal(
  env: AppBindings,
  userId: string,
  id: string
): Promise<void> {
  const goal = await owned(env, userId, id)
  if (goal.status !== "planning") {
    throw new GoalError(
      "BAD_REQUEST",
      "Only a new goal can be started; resume a paused one instead"
    )
  }
  await run(env, goal, "goal_started")
}

export async function resumeGoal(
  env: AppBindings,
  userId: string,
  id: string
): Promise<void> {
  const goal = await owned(env, userId, id)
  if (goal.status !== "paused") {
    throw new GoalError("BAD_REQUEST", "Only a paused goal can be resumed")
  }
  const pending = (await goals.listDecisions(env.DB, id)).some(
    (decision) => decision.status === "pending"
  )
  if (pending) {
    throw new GoalError("BAD_REQUEST", "Answer the open question to continue")
  }
  await run(env, goal, "goal_resumed")
}

export async function pauseGoal(
  env: AppBindings,
  userId: string,
  id: string
): Promise<void> {
  const goal = await owned(env, userId, id)
  if (goal.status !== "running") {
    throw new GoalError("BAD_REQUEST", "Only a running goal can be paused")
  }
  await goals.setGoalStatus(env.DB, id, {
    status: "paused",
    reason: "Paused by you",
  })
  await goals.recordEvent(env.DB, {
    goalId: id,
    eventType: "goal_paused",
    entityType: "goal",
    entityId: id,
    actorType: "user",
  })
}

export async function stopGoal(
  env: AppBindings,
  userId: string,
  id: string
): Promise<void> {
  const goal = await owned(env, userId, id)
  if (TERMINAL.includes(goal.status)) {
    throw new GoalError("BAD_REQUEST", "This goal has already finished")
  }
  await goals.setGoalStatus(env.DB, id, {
    status: "stopped",
    reason: "Stopped by you",
  })
  await goals.cancelPendingDecisions(env.DB, id)
  await goals.retireOpenWork(env.DB, id)
  await goals.recordEvent(env.DB, {
    goalId: id,
    eventType: "goal_stopped",
    entityType: "goal",
    entityId: id,
    actorType: "user",
  })
}

/**
 * Answer a human gate. Retrying re-opens the task with a fresh attempt budget,
 * skipping retires it, continuing lets the manager plan again (with the note),
 * and stopping ends the goal. The goal resumes once no question is left open.
 */
export async function resolveGate(
  env: AppBindings,
  userId: string,
  params: {
    goalId: string
    decisionId: string
    optionId: string
    note?: string
  }
): Promise<void> {
  const goal = await owned(env, userId, params.goalId)
  const decision = await goals.findDecision(env.DB, params.decisionId, goal.id)
  if (!decision) throw new GoalError("NOT_FOUND", "Question not found")
  if (decision.status !== "pending") {
    throw new GoalError(
      "BAD_REQUEST",
      "That question has already been answered"
    )
  }
  const option = decision.options.find((o) => o.id === params.optionId)
  if (!option)
    throw new GoalError("BAD_REQUEST", "That is not one of the options")

  await goals.resolveDecision(env.DB, decision.id, {
    optionId: option.id,
    resolution: params.note?.trim() || null,
  })
  await goals.recordEvent(env.DB, {
    goalId: goal.id,
    eventType: "decision_resolved",
    entityType: "decision",
    entityId: decision.id,
    actorType: "user",
    reason: params.note?.trim()
      ? `${option.label}: ${params.note.trim()}`
      : option.label,
  })

  if (option.id === "stop") {
    await stopGoal(env, userId, goal.id)
    return
  }
  const node = await goals.getNode(env.DB, decision.nodeId)
  if (node) {
    if (option.id === "retry") {
      await goals.updateNode(env.DB, node.id, { status: "ready" })
      if (node.taskId) {
        await goals.updateTask(env.DB, node.taskId, {
          status: "pending",
          attempts: 0,
          error: null,
        })
      }
    } else {
      // "retire" skips the task; "continue" answers a manager's question.
      await goals.updateNode(env.DB, node.id, {
        status: option.id === "retire" ? "retired" : "delivered",
        resolved_at: new Date().toISOString(),
      })
    }
  }

  const stillOpen = (await goals.listDecisions(env.DB, goal.id)).some(
    (d) => d.status === "pending"
  )
  if (goal.status === "paused" && !stillOpen)
    await run(env, goal, "goal_resumed")
}

export async function deleteGoal(
  env: AppBindings,
  userId: string,
  id: string
): Promise<void> {
  const goal = await owned(env, userId, id)
  if (!TERMINAL.includes(goal.status)) await stopGoal(env, userId, id)
  await goals.removeGoal(env.DB, id, userId)
}
