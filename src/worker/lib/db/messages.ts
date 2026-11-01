import { newId, now, parseJson, stringifyJson, toBool } from "./client"
import type { Message, MessageRow } from "./types"

const hydrate = (row: MessageRow): Message => ({
  ...row,
  favorite: toBool(row.favorite),
  metadata: parseJson(row.metadata, null),
  usage: parseJson(row.usage, null),
  error: parseJson(row.error, null),
})

export async function listForOwnedTopic(
  db: D1Database,
  topicId: string,
  userId: string
): Promise<Message[]> {
  const { results } = await db
    .prepare(
      `SELECT m.* FROM messages m
       JOIN topics t ON t.id = m.topic_id
       WHERE m.topic_id = ? AND t.user_id = ?
       ORDER BY m.created_at ASC, m.id ASC`
    )
    .bind(topicId, userId)
    .all<MessageRow>()
  return (results ?? []).map(hydrate)
}

export async function insert(
  db: D1Database,
  params: {
    topicId: string
    userId: string
    role: MessageRow["role"]
    content: string
    model?: string | null
    metadata?: unknown
    usage?: unknown
    error?: unknown
    parentId?: string | null
  }
): Promise<Message> {
  const id = newId()
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO messages
         (id, role, content, metadata, usage, model, error, user_id,
          topic_id, parent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.role,
      params.content,
      params.metadata === undefined ? null : stringifyJson(params.metadata),
      params.usage === undefined ? null : stringifyJson(params.usage),
      params.model ?? null,
      params.error === undefined ? null : stringifyJson(params.error),
      params.userId,
      params.topicId,
      params.parentId ?? null,
      timestamp,
      timestamp
    )
    .run()
  const row = await db
    .prepare("SELECT * FROM messages WHERE id = ? AND user_id = ?")
    .bind(id, params.userId)
    .first<MessageRow>()
  if (!row) throw new Error("Failed to create message")
  return hydrate(row)
}

export async function updateContent(
  db: D1Database,
  params: { id: string; userId: string; content: string }
): Promise<Message | null> {
  await db
    .prepare(
      `UPDATE messages SET content = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .bind(params.content, now(), params.id, params.userId)
    .run()
  const row = await db
    .prepare("SELECT * FROM messages WHERE id = ? AND user_id = ?")
    .bind(params.id, params.userId)
    .first<MessageRow>()
  return row ? hydrate(row) : null
}

export async function remove(
  db: D1Database,
  id: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM messages WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run()
  return (result.meta.changes ?? 0) > 0
}
