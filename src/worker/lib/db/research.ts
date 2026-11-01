import type { ResearchDepth } from "../research/config"
import type { Activity } from "../research/tools"
import { newId, now, parseJson, stringifyJson } from "./client"

/** A row of `research_sessions`, as the legacy app created it plus `activity`. */
type Row = {
  id: string
  user_id: string
  topic_id: string | null
  topic: string
  depth: ResearchDepth
  status: "in_progress" | "completed" | "failed"
  report_text: string | null
  sources: string
  activity: string
  model: string | null
  created_at: string
  completed_at: string | null
}

export type ResearchSession = {
  id: string
  topic: string
  depth: ResearchDepth
  status: Row["status"]
  report: string | null
  sources: string[]
  activity: Activity[]
  model: string | null
  createdAt: string
  completedAt: string | null
}

/** What the history list shows: no report and no activity. */
export type ResearchSummary = Omit<
  ResearchSession,
  "report" | "sources" | "activity"
>

const toSession = (row: Row): ResearchSession => ({
  id: row.id,
  topic: row.topic,
  depth: row.depth,
  status: row.status,
  report: row.report_text,
  sources: parseJson<string[]>(row.sources, []),
  activity: parseJson<Activity[]>(row.activity, []),
  model: row.model,
  createdAt: row.created_at,
  completedAt: row.completed_at,
})

const toSummary = (row: Row): ResearchSummary => ({
  id: row.id,
  topic: row.topic,
  depth: row.depth,
  status: row.status,
  model: row.model,
  createdAt: row.created_at,
  completedAt: row.completed_at,
})

export async function create(
  db: D1Database,
  params: {
    userId: string
    topic: string
    depth: ResearchDepth
    model: string
  }
): Promise<ResearchSession> {
  const id = newId()
  const createdAt = now()
  await db
    .prepare(
      `INSERT INTO research_sessions
         (id, user_id, topic, depth, status, sources, activity, model, created_at)
       VALUES (?, ?, ?, ?, 'in_progress', '[]', '[]', ?, ?)`
    )
    .bind(
      id,
      params.userId,
      params.topic,
      params.depth,
      params.model,
      createdAt
    )
    .run()
  return {
    id,
    topic: params.topic,
    depth: params.depth,
    status: "in_progress",
    report: null,
    sources: [],
    activity: [],
    model: params.model,
    createdAt,
    completedAt: null,
  }
}

export async function listForUser(
  db: D1Database,
  userId: string,
  limit = 50
): Promise<ResearchSummary[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM research_sessions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
    )
    .bind(userId, limit)
    .all<Row>()
  return (results ?? []).map(toSummary)
}

export async function findOwned(
  db: D1Database,
  id: string,
  userId: string
): Promise<ResearchSession | null> {
  const row = await db
    .prepare("SELECT * FROM research_sessions WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<Row>()
  return row ? toSession(row) : null
}

/** By id alone, for the background run (which is handed only an id it created). */
export async function find(
  db: D1Database,
  id: string
): Promise<ResearchSession | null> {
  const row = await db
    .prepare("SELECT * FROM research_sessions WHERE id = ?")
    .bind(id)
    .first<Row>()
  return row ? toSession(row) : null
}

export async function resetActivity(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE research_sessions SET activity = '[]' WHERE id = ?")
    .bind(id)
    .run()
}

/** Append one entry to the run's activity log (a no-op if the session is gone). */
export async function appendActivity(
  db: D1Database,
  id: string,
  entry: Activity
): Promise<void> {
  await db
    .prepare(
      "UPDATE research_sessions SET activity = json_insert(activity, '$[#]', json(?)) WHERE id = ?"
    )
    .bind(stringifyJson(entry), id)
    .run()
}

/** Finish a run once: a session that is no longer in progress is left as it is. */
export async function finish(
  db: D1Database,
  id: string,
  outcome: {
    status: "completed" | "failed"
    report: string
    sources?: string[]
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE research_sessions
       SET status = ?, report_text = ?, sources = COALESCE(?, sources), completed_at = ?
       WHERE id = ? AND status = 'in_progress'`
    )
    .bind(
      outcome.status,
      outcome.report,
      outcome.sources ? stringifyJson(outcome.sources) : null,
      now(),
      id
    )
    .run()
}

/** Mark the user's runs that started before `cutoff` and never finished as failed. */
export async function failStale(
  db: D1Database,
  userId: string,
  cutoff: string,
  report: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE research_sessions
       SET status = 'failed', report_text = ?, completed_at = ?
       WHERE user_id = ? AND status = 'in_progress' AND created_at < ?`
    )
    .bind(report, now(), userId, cutoff)
    .run()
}

export async function countSince(
  db: D1Database,
  userId: string,
  isoSince: string
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM research_sessions WHERE user_id = ? AND created_at >= ?"
    )
    .bind(userId, isoSince)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export async function deleteOwned(
  db: D1Database,
  id: string,
  userId: string
): Promise<void> {
  await db
    .prepare("DELETE FROM research_sessions WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run()
}
