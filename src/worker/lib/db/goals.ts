import { newId, now, parseJson, stringifyJson } from "./client"
import type {
  DecisionOption,
  Goal,
  GoalConfig,
  GoalDecision,
  GoalEdge,
  GoalEvent,
  GoalNode,
  GoalNodeRow,
  GoalRow,
  GoalStatus,
  Task,
  TaskRow,
} from "./types"

/**
 * Persistence for goals, their task graph, gates and audit trail. Table and
 * column names in the SQL below are constants in this file, never user input.
 */

const goalOf = (row: GoalRow): Goal => ({
  id: row.id,
  agentId: row.agent_id,
  title: row.title,
  requirement: row.requirement,
  config: parseJson<GoalConfig>(row.config, {}),
  maxRounds: row.max_rounds,
  rounds: row.rounds,
  managerTurns: row.manager_turns,
  invalidPlans: row.invalid_plans,
  status: row.status,
  statusReason: row.status_reason,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const taskOf = (row: TaskRow): Task => ({
  id: row.id,
  goalId: row.goal_id,
  agentId: row.agent_id,
  title: row.title,
  description: row.description,
  status: row.status,
  result: row.result,
  error: row.error,
  attempts: row.attempts,
  topicId: row.topic_id,
  startedAt: row.started_at,
  completedAt: row.completed_at,
})

const nodeOf = (row: GoalNodeRow): GoalNode => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  title: row.title,
  description: row.description,
  taskId: row.task_id,
  verdict: row.verdict,
  priority: row.priority,
  round: row.round,
  resolvedAt: row.resolved_at,
})

/** UPDATE the given columns of one row (undefined values are left alone). */
async function patch(
  db: D1Database,
  table: "goals" | "tasks" | "goal_nodes",
  id: string,
  columns: Record<string, unknown>
): Promise<void> {
  const entries = Object.entries(columns).filter(
    ([, value]) => value !== undefined
  )
  if (entries.length === 0) return
  await db
    .prepare(
      `UPDATE ${table} SET ${entries.map(([column]) => `${column} = ?`).join(", ")},
       updated_at = ? WHERE id = ?`
    )
    .bind(...entries.map(([, value]) => value), now(), id)
    .run()
}

/* ── Goals ────────────────────────────────────────────────────────────────── */

export async function insertGoal(
  db: D1Database,
  params: {
    userId: string
    agentId: string
    title: string
    requirement?: string | null
    config?: GoalConfig
    maxRounds?: number
  }
): Promise<Goal> {
  const id = newId()
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO goals
         (id, user_id, agent_id, title, requirement, config, max_rounds,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 8), ?, ?)`
    )
    .bind(
      id,
      params.userId,
      params.agentId,
      params.title,
      params.requirement ?? null,
      stringifyJson(params.config ?? {}),
      params.maxRounds ?? null,
      timestamp,
      timestamp
    )
    .run()
  return (await findGoal(db, id))!
}

/** By id alone; for the scheduler, which has no user in hand. */
export async function findGoal(
  db: D1Database,
  id: string
): Promise<Goal | null> {
  const row = await db
    .prepare("SELECT * FROM goals WHERE id = ?")
    .bind(id)
    .first<GoalRow>()
  return row ? goalOf(row) : null
}

export async function findOwnedGoal(
  db: D1Database,
  id: string,
  userId: string
): Promise<Goal | null> {
  const row = await db
    .prepare("SELECT * FROM goals WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<GoalRow>()
  return row ? goalOf(row) : null
}

export async function listGoals(
  db: D1Database,
  userId: string
): Promise<Goal[]> {
  const { results } = await db
    .prepare("SELECT * FROM goals WHERE user_id = ? ORDER BY updated_at DESC")
    .bind(userId)
    .all<GoalRow>()
  return (results ?? []).map(goalOf)
}

export async function removeGoal(
  db: D1Database,
  id: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM goals WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

/** The owner of a goal, so the scheduler can act as them. */
export async function goalOwner(
  db: D1Database,
  id: string
): Promise<string | null> {
  const row = await db
    .prepare("SELECT user_id FROM goals WHERE id = ?")
    .bind(id)
    .first<{ user_id: string }>()
  return row?.user_id ?? null
}

export async function setGoalStatus(
  db: D1Database,
  id: string,
  update: { status: GoalStatus; reason?: string | null }
): Promise<void> {
  const terminal = ["achieved", "failed", "stopped"].includes(update.status)
  await patch(db, "goals", id, {
    status: update.status,
    status_reason: update.reason ?? null,
    completed_at: terminal ? now() : undefined,
  })
  if (update.status === "running") {
    // Keep the first start across pauses and resumes.
    await db
      .prepare(
        "UPDATE goals SET started_at = COALESCE(started_at, ?) WHERE id = ?"
      )
      .bind(now(), id)
      .run()
  }
}

/** Stopping a goal: withdraw whatever has not finished. */
export async function retireOpenWork(
  db: D1Database,
  goalId: string
): Promise<void> {
  const timestamp = now()
  await db.batch([
    db
      .prepare(
        `UPDATE goal_nodes SET status = 'retired', resolved_at = ?, updated_at = ?
         WHERE goal_id = ? AND status IN ('proposed','ready','running','blocked')`
      )
      .bind(timestamp, timestamp, goalId),
    db
      .prepare(
        `UPDATE tasks SET status = 'canceled', updated_at = ?
         WHERE goal_id = ? AND status IN ('pending','running')`
      )
      .bind(timestamp, goalId),
  ])
}

export const updateGoalCounters = (
  db: D1Database,
  id: string,
  columns: { rounds?: number; manager_turns?: number; invalid_plans?: number }
) => patch(db, "goals", id, columns)

export const updateGoalDetails = (
  db: D1Database,
  id: string,
  columns: {
    title?: string
    requirement?: string | null
    config?: string
    max_rounds?: number
  }
) => patch(db, "goals", id, columns)

/** True if this caller now holds the goal's run lease. */
export async function acquireLease(
  db: D1Database,
  id: string,
  seconds: number
): Promise<boolean> {
  const current = now()
  const until = new Date(Date.now() + seconds * 1000).toISOString()
  const result = await db
    .prepare(
      `UPDATE goals SET lease_until = ?
       WHERE id = ? AND (lease_until IS NULL OR lease_until < ?)`
    )
    .bind(until, id, current)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function releaseLease(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE goals SET lease_until = NULL WHERE id = ?")
    .bind(id)
    .run()
}

/* ── Tasks ────────────────────────────────────────────────────────────────── */

export async function insertTask(
  db: D1Database,
  params: {
    userId: string
    goalId: string
    agentId: string | null
    title: string
    description?: string | null
  }
): Promise<Task> {
  const id = newId()
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO tasks
         (id, user_id, goal_id, agent_id, title, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.userId,
      params.goalId,
      params.agentId,
      params.title,
      params.description ?? null,
      timestamp,
      timestamp
    )
    .run()
  return (await getTask(db, id))!
}

export async function getTask(
  db: D1Database,
  id: string
): Promise<Task | null> {
  const row = await db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .bind(id)
    .first<TaskRow>()
  return row ? taskOf(row) : null
}

export async function listTasks(
  db: D1Database,
  goalId: string
): Promise<Task[]> {
  const { results } = await db
    .prepare("SELECT * FROM tasks WHERE goal_id = ? ORDER BY rowid ASC")
    .bind(goalId)
    .all<TaskRow>()
  return (results ?? []).map(taskOf)
}

export const updateTask = (
  db: D1Database,
  id: string,
  columns: {
    status?: string
    result?: string | null
    error?: string | null
    attempts?: number
    topic_id?: string | null
    agent_id?: string | null
    started_at?: string | null
    completed_at?: string | null
  }
) => patch(db, "tasks", id, columns)

/* ── Graph ────────────────────────────────────────────────────────────────── */

export async function insertNode(
  db: D1Database,
  params: {
    goalId: string
    kind: GoalNode["kind"]
    status?: GoalNode["status"]
    title: string
    description?: string | null
    taskId?: string | null
    round: number
    priority?: number
  }
): Promise<GoalNode> {
  const id = newId()
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO goal_nodes
         (id, goal_id, kind, status, title, description, task_id, priority,
          round, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.goalId,
      params.kind,
      params.status ?? "proposed",
      params.title,
      params.description ?? null,
      params.taskId ?? null,
      params.priority ?? 0,
      params.round,
      timestamp,
      timestamp
    )
    .run()
  return (await getNode(db, id))!
}

export async function getNode(
  db: D1Database,
  id: string
): Promise<GoalNode | null> {
  const row = await db
    .prepare("SELECT * FROM goal_nodes WHERE id = ?")
    .bind(id)
    .first<GoalNodeRow>()
  return row ? nodeOf(row) : null
}

export async function listNodes(
  db: D1Database,
  goalId: string
): Promise<GoalNode[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM goal_nodes WHERE goal_id = ? ORDER BY round ASC, priority ASC, rowid ASC"
    )
    .bind(goalId)
    .all<GoalNodeRow>()
  return (results ?? []).map(nodeOf)
}

export const updateNode = (
  db: D1Database,
  id: string,
  columns: {
    status?: string
    verdict?: string | null
    task_id?: string | null
    resolved_at?: string | null
  }
) => patch(db, "goal_nodes", id, columns)

export async function insertEdges(
  db: D1Database,
  goalId: string,
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>
): Promise<void> {
  if (edges.length === 0) return
  const timestamp = now()
  await db.batch(
    edges.map((edge) =>
      db
        .prepare(
          `INSERT INTO goal_edges
             (id, goal_id, source_node_id, target_node_id, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(newId(), goalId, edge.sourceNodeId, edge.targetNodeId, timestamp)
    )
  )
}

export async function listEdges(
  db: D1Database,
  goalId: string
): Promise<GoalEdge[]> {
  const { results } = await db
    .prepare(
      "SELECT id, source_node_id, target_node_id FROM goal_edges WHERE goal_id = ? ORDER BY rowid ASC"
    )
    .bind(goalId)
    .all<{ id: string; source_node_id: string; target_node_id: string }>()
  return (results ?? []).map((row) => ({
    id: row.id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
  }))
}

/* ── Decisions (human gates) ──────────────────────────────────────────────── */

type DecisionRow = {
  id: string
  node_id: string
  status: GoalDecision["status"]
  question: string
  options: string
  recommended_option_id: string | null
  resolved_option_id: string | null
  resolution: string | null
  resolved_at: string | null
  created_at: string
}

const decisionOf = (row: DecisionRow): GoalDecision => ({
  id: row.id,
  nodeId: row.node_id,
  status: row.status,
  question: row.question,
  options: parseJson<DecisionOption[]>(row.options, []),
  recommendedOptionId: row.recommended_option_id,
  resolvedOptionId: row.resolved_option_id,
  resolution: row.resolution,
  resolvedAt: row.resolved_at,
  createdAt: row.created_at,
})

export async function insertDecision(
  db: D1Database,
  params: {
    goalId: string
    nodeId: string
    question: string
    options: DecisionOption[]
    recommendedOptionId?: string
  }
): Promise<GoalDecision> {
  const id = newId()
  await db
    .prepare(
      `INSERT INTO goal_node_decisions
         (id, goal_id, node_id, question, options, recommended_option_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.goalId,
      params.nodeId,
      params.question,
      stringifyJson(params.options),
      params.recommendedOptionId ?? null,
      now()
    )
    .run()
  return (await findDecision(db, id, params.goalId))!
}

export async function findDecision(
  db: D1Database,
  id: string,
  goalId: string
): Promise<GoalDecision | null> {
  const row = await db
    .prepare("SELECT * FROM goal_node_decisions WHERE id = ? AND goal_id = ?")
    .bind(id, goalId)
    .first<DecisionRow>()
  return row ? decisionOf(row) : null
}

export async function listDecisions(
  db: D1Database,
  goalId: string
): Promise<GoalDecision[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM goal_node_decisions WHERE goal_id = ? ORDER BY rowid ASC"
    )
    .bind(goalId)
    .all<DecisionRow>()
  return (results ?? []).map(decisionOf)
}

export async function resolveDecision(
  db: D1Database,
  id: string,
  update: { optionId: string; resolution: string | null }
): Promise<void> {
  await db
    .prepare(
      `UPDATE goal_node_decisions
       SET status = 'resolved', resolved_option_id = ?, resolution = ?, resolved_at = ?
       WHERE id = ?`
    )
    .bind(update.optionId, update.resolution, now(), id)
    .run()
}

export async function cancelPendingDecisions(
  db: D1Database,
  goalId: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE goal_node_decisions SET status = 'canceled' WHERE goal_id = ? AND status = 'pending'"
    )
    .bind(goalId)
    .run()
}

/* ── Events ───────────────────────────────────────────────────────────────── */

export async function recordEvent(
  db: D1Database,
  params: {
    goalId: string
    eventType: string
    entityType: "goal" | "node" | "task" | "decision"
    entityId: string
    actorType: GoalEvent["actorType"]
    reason?: string | null
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO goal_events
         (id, goal_id, event_type, entity_type, entity_id, actor_type, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      newId(),
      params.goalId,
      params.eventType,
      params.entityType,
      params.entityId,
      params.actorType,
      params.reason ?? null,
      now()
    )
    .run()
}

export async function listEvents(
  db: D1Database,
  goalId: string,
  limit = 100
): Promise<GoalEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT id, event_type, entity_type, entity_id, actor_type, reason, created_at
       FROM goal_events WHERE goal_id = ?
       ORDER BY created_at ASC, rowid ASC LIMIT ?`
    )
    .bind(goalId, limit)
    .all<{
      id: string
      event_type: string
      entity_type: string
      entity_id: string
      actor_type: GoalEvent["actorType"]
      reason: string | null
      created_at: string
    }>()
  return (results ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorType: row.actor_type,
    reason: row.reason,
    createdAt: row.created_at,
  }))
}
