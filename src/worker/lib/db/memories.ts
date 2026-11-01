import { newId, now, parseJson, stringifyJson } from "./client"
import type { Memory, MemoryRow, Persona } from "./types"

const hydrate = (row: MemoryRow): Memory => ({
  id: row.id,
  layer: row.layer,
  title: row.title,
  summary: row.summary,
  details: row.details,
  tags: parseJson<string[]>(row.tags, []),
  attributes: parseJson<Record<string, unknown>>(row.attributes, {}),
  confidence: row.confidence,
  sourceTopicId: row.source_topic_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const placeholders = (ids: unknown[]) => ids.map(() => "?").join(", ")

export type MemoryFields = {
  title: string
  summary: string
  details?: string | null
  tags?: string[]
  attributes?: Record<string, unknown>
  confidence?: number | null
}

export async function listForUser(
  db: D1Database,
  userId: string,
  layer?: Memory["layer"]
): Promise<Memory[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM user_memories
       WHERE user_id = ? AND (? IS NULL OR layer = ?)
       ORDER BY updated_at DESC, id ASC`
    )
    .bind(userId, layer ?? null, layer ?? null)
    .all<MemoryRow>()
  return (results ?? []).map(hydrate)
}

export async function findOwned(
  db: D1Database,
  id: string,
  userId: string
): Promise<Memory | null> {
  const row = await db
    .prepare("SELECT * FROM user_memories WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<MemoryRow>()
  return row ? hydrate(row) : null
}

/** The user's memories with these ids, in the order asked (missing ones skipped). */
export async function byIds(
  db: D1Database,
  userId: string,
  ids: string[]
): Promise<Memory[]> {
  if (ids.length === 0) return []
  const { results } = await db
    .prepare(
      `SELECT * FROM user_memories
       WHERE user_id = ? AND id IN (${placeholders(ids)})`
    )
    .bind(userId, ...ids)
    .all<MemoryRow>()
  const rows = new Map((results ?? []).map((row) => [row.id, row]))
  return ids.flatMap((id) => (rows.has(id) ? [hydrate(rows.get(id)!)] : []))
}

export async function count(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM user_memories WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export async function insert(
  db: D1Database,
  params: {
    userId: string
    layer: Memory["layer"]
    sourceTopicId?: string | null
  } & MemoryFields
): Promise<Memory> {
  const id = newId()
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO user_memories
         (id, user_id, layer, title, summary, details, tags, attributes,
          confidence, source_topic_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.userId,
      params.layer,
      params.title,
      params.summary,
      params.details ?? null,
      stringifyJson(params.tags ?? []),
      stringifyJson(params.attributes ?? {}),
      params.confidence ?? null,
      params.sourceTopicId ?? null,
      timestamp,
      timestamp
    )
    .run()
  return (await findOwned(db, id, params.userId))!
}

/** Fields left out are kept; the layer never changes. */
export async function update(
  db: D1Database,
  params: { id: string; userId: string } & Partial<MemoryFields>
): Promise<Memory | null> {
  const existing = await findOwned(db, params.id, params.userId)
  if (!existing) return null
  await db
    .prepare(
      `UPDATE user_memories
       SET title = ?, summary = ?, details = ?, tags = ?, attributes = ?,
           confidence = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .bind(
      params.title ?? existing.title,
      params.summary ?? existing.summary,
      params.details === undefined ? existing.details : params.details,
      stringifyJson(params.tags ?? existing.tags),
      stringifyJson(params.attributes ?? existing.attributes),
      params.confidence === undefined ? existing.confidence : params.confidence,
      now(),
      params.id,
      params.userId
    )
    .run()
  return await findOwned(db, params.id, params.userId)
}

export async function remove(
  db: D1Database,
  id: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM user_memories WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

/** Forget everything about the user; returns the ids so vectors can follow. */
export async function removeAll(
  db: D1Database,
  userId: string
): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT id FROM user_memories WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string }>()
  await db.batch([
    db.prepare("DELETE FROM user_memories WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM user_persona WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM topic_memory_state WHERE user_id = ?").bind(userId),
  ])
  return (results ?? []).map((row) => row.id)
}

/* ── Persona ──────────────────────────────────────────────────────────────── */

export async function getPersona(
  db: D1Database,
  userId: string
): Promise<Persona | null> {
  const row = await db
    .prepare(
      "SELECT persona, version, updated_at FROM user_persona WHERE user_id = ?"
    )
    .bind(userId)
    .first<{ persona: string; version: number; updated_at: string }>()
  return row
    ? { persona: row.persona, version: row.version, updatedAt: row.updated_at }
    : null
}

export async function setPersona(
  db: D1Database,
  userId: string,
  persona: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_persona (user_id, persona, version, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT (user_id) DO UPDATE
       SET persona = excluded.persona, version = version + 1,
           updated_at = excluded.updated_at`
    )
    .bind(userId, persona, now())
    .run()
}

/* ── Settings and extraction state ────────────────────────────────────────── */

export async function isEnabled(
  db: D1Database,
  userId: string
): Promise<boolean> {
  const row = await db
    .prepare("SELECT enabled FROM user_memory_settings WHERE user_id = ?")
    .bind(userId)
    .first<{ enabled: number }>()
  return row ? row.enabled === 1 : true
}

export async function setEnabled(
  db: D1Database,
  userId: string,
  enabled: boolean
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_memory_settings (user_id, enabled, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE
       SET enabled = excluded.enabled, updated_at = excluded.updated_at`
    )
    .bind(userId, Number(enabled), now())
    .run()
}

export async function extractedCount(
  db: D1Database,
  topicId: string
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT extracted_message_count AS n FROM topic_memory_state WHERE topic_id = ?"
    )
    .bind(topicId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export async function setExtractedCount(
  db: D1Database,
  params: { topicId: string; userId: string; count: number }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO topic_memory_state
         (topic_id, user_id, extracted_message_count, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (topic_id) DO UPDATE
       SET extracted_message_count = excluded.extracted_message_count,
           updated_at = excluded.updated_at`
    )
    .bind(params.topicId, params.userId, params.count, now())
    .run()
}
