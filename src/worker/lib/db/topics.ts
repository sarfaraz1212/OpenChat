import { newId, now, parseJson, stringifyJson, toBool } from "./client"
import type { Topic, TopicRow } from "./types"

const hydrate = (row: TopicRow): Topic => ({
  ...row,
  favorite: toBool(row.favorite),
  metadata: parseJson(row.metadata, null),
})

/**
 * All of a user's chat topics, or only those under one agent. Topics that are
 * a goal task's workspace (metadata.taskId) are not chats and are left out.
 */
export async function listForUser(
  db: D1Database,
  userId: string,
  agentId?: string
): Promise<Topic[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM topics
       WHERE user_id = ? AND (? IS NULL OR agent_id = ?)
         AND json_extract(COALESCE(metadata, '{}'), '$.taskId') IS NULL
       ORDER BY favorite DESC, updated_at DESC`
    )
    .bind(userId, agentId ?? null, agentId ?? null)
    .all<TopicRow>()
  return (results ?? []).map(hydrate)
}

export async function findOwned(
  db: D1Database,
  id: string,
  userId: string
): Promise<Topic | null> {
  const row = await db
    .prepare("SELECT * FROM topics WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<TopicRow>()
  return row ? hydrate(row) : null
}

export async function create(
  db: D1Database,
  params: {
    userId: string
    agentId: string
    title?: string | null
    model?: string | null
    metadata?: unknown
  }
): Promise<Topic> {
  const id = newId()
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO topics
         (id, title, metadata, model, agent_id, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.title ?? null,
      params.metadata === undefined ? null : stringifyJson(params.metadata),
      params.model ?? null,
      params.agentId,
      params.userId,
      timestamp,
      timestamp
    )
    .run()
  const topic = await findOwned(db, id, params.userId)
  if (!topic) throw new Error("Failed to create topic")
  return topic
}

export async function update(
  db: D1Database,
  params: {
    id: string
    userId: string
    title?: string
    favorite?: boolean
    model?: string
  }
): Promise<Topic | null> {
  const existing = await findOwned(db, params.id, params.userId)
  if (!existing) return null
  await db
    .prepare(
      `UPDATE topics
       SET title = ?, favorite = ?, model = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .bind(
      params.title ?? existing.title,
      params.favorite === undefined
        ? Number(existing.favorite)
        : Number(params.favorite),
      params.model ?? existing.model,
      now(),
      params.id,
      params.userId
    )
    .run()
  return await findOwned(db, params.id, params.userId)
}

/** Bump `updated_at`; when a turn used a model, remember it as the topic's. */
export async function touch(
  db: D1Database,
  id: string,
  userId: string,
  model?: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE topics SET updated_at = ?, model = COALESCE(?, model)
       WHERE id = ? AND user_id = ?`
    )
    .bind(now(), model ?? null, id, userId)
    .run()
}

export async function remove(
  db: D1Database,
  id: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM topics WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run()
  return (result.meta.changes ?? 0) > 0
}
