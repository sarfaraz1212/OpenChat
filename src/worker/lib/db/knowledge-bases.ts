import { newId, now } from "./client"
import type { FileRow, KnowledgeBase, KnowledgeBaseRow } from "./types"

type KnowledgeBaseWithCount = KnowledgeBaseRow & { file_count: number }

const hydrate = (row: KnowledgeBaseWithCount): KnowledgeBase => ({
  id: row.id,
  name: row.name,
  description: row.description,
  fileCount: row.file_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const WITH_COUNT = `SELECT kb.*,
  (SELECT COUNT(*) FROM knowledge_base_files k WHERE k.knowledge_base_id = kb.id)
    AS file_count
  FROM knowledge_bases kb`

const placeholders = (ids: unknown[]) => ids.map(() => "?").join(", ")

export async function listForUser(
  db: D1Database,
  userId: string
): Promise<KnowledgeBase[]> {
  const { results } = await db
    .prepare(`${WITH_COUNT} WHERE kb.user_id = ? ORDER BY kb.updated_at DESC`)
    .bind(userId)
    .all<KnowledgeBaseWithCount>()
  return (results ?? []).map(hydrate)
}

export async function findOwned(
  db: D1Database,
  id: string,
  userId: string
): Promise<KnowledgeBase | null> {
  const row = await db
    .prepare(`${WITH_COUNT} WHERE kb.id = ? AND kb.user_id = ?`)
    .bind(id, userId)
    .first<KnowledgeBaseWithCount>()
  return row ? hydrate(row) : null
}

export async function ownedIds(
  db: D1Database,
  userId: string,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { results } = await db
    .prepare(
      `SELECT id FROM knowledge_bases
       WHERE user_id = ? AND id IN (${placeholders(ids)})`
    )
    .bind(userId, ...ids)
    .all<{ id: string }>()
  return new Set((results ?? []).map((row) => row.id))
}

export async function create(
  db: D1Database,
  params: { userId: string; name: string; description?: string | null }
): Promise<KnowledgeBase> {
  const id = newId()
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO knowledge_bases
         (id, user_id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.userId,
      params.name,
      params.description ?? null,
      timestamp,
      timestamp
    )
    .run()
  return (await findOwned(db, id, params.userId))!
}

export async function update(
  db: D1Database,
  params: {
    id: string
    userId: string
    name?: string
    description?: string | null
  }
): Promise<KnowledgeBase | null> {
  const existing = await findOwned(db, params.id, params.userId)
  if (!existing) return null
  await db
    .prepare(
      `UPDATE knowledge_bases SET name = ?, description = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .bind(
      params.name ?? existing.name,
      params.description === undefined
        ? existing.description
        : params.description,
      now(),
      params.id,
      params.userId
    )
    .run()
  return await findOwned(db, params.id, params.userId)
}

/** Deleting a knowledge base keeps its files; only the grouping goes. */
export async function remove(
  db: D1Database,
  id: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM knowledge_bases WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

/** The caller must have checked that the user owns the base and every file. */
export async function addFiles(
  db: D1Database,
  params: { id: string; userId: string; fileIds: string[] }
): Promise<void> {
  const timestamp = now()
  await db.batch([
    ...params.fileIds.map((fileId) =>
      db
        .prepare(
          `INSERT INTO knowledge_base_files
             (knowledge_base_id, file_id, user_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (knowledge_base_id, file_id) DO NOTHING`
        )
        .bind(params.id, fileId, params.userId, timestamp)
    ),
    db
      .prepare("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?")
      .bind(timestamp, params.id),
  ])
}

export async function removeFile(
  db: D1Database,
  params: { id: string; userId: string; fileId: string }
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `DELETE FROM knowledge_base_files
         WHERE knowledge_base_id = ? AND file_id = ? AND user_id = ?`
      )
      .bind(params.id, params.fileId, params.userId),
    db
      .prepare("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?")
      .bind(now(), params.id),
  ])
}

export async function filesOf(
  db: D1Database,
  id: string,
  userId: string
): Promise<FileRow[]> {
  const { results } = await db
    .prepare(
      `SELECT f.* FROM files f
       JOIN knowledge_base_files k ON k.file_id = f.id
       WHERE k.knowledge_base_id = ? AND k.user_id = ?
       ORDER BY k.created_at ASC`
    )
    .bind(id, userId)
    .all<FileRow>()
  return results ?? []
}

/* ── What an agent draws on ───────────────────────────────────────────────── */

/** Replace the agent's attached files and knowledge bases (both may be empty). */
export async function setAgentKnowledge(
  db: D1Database,
  params: {
    agentId: string
    userId: string
    fileIds: string[]
    knowledgeBaseIds: string[]
  }
): Promise<void> {
  const timestamp = now()
  await db.batch([
    db
      .prepare("DELETE FROM agents_files WHERE agent_id = ?")
      .bind(params.agentId),
    db
      .prepare("DELETE FROM agents_knowledge_bases WHERE agent_id = ?")
      .bind(params.agentId),
    ...params.fileIds.map((fileId) =>
      db
        .prepare(
          `INSERT INTO agents_files (agent_id, file_id, user_id, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(params.agentId, fileId, params.userId, timestamp)
    ),
    ...params.knowledgeBaseIds.map((knowledgeBaseId) =>
      db
        .prepare(
          `INSERT INTO agents_knowledge_bases
             (agent_id, knowledge_base_id, user_id, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(params.agentId, knowledgeBaseId, params.userId, timestamp)
    ),
  ])
}

export async function agentKnowledge(
  db: D1Database,
  agentId: string,
  userId: string
): Promise<{ files: FileRow[]; knowledgeBases: KnowledgeBase[] }> {
  const files = await db
    .prepare(
      `SELECT f.* FROM files f
       JOIN agents_files a ON a.file_id = f.id
       WHERE a.agent_id = ? AND a.user_id = ?
       ORDER BY a.created_at ASC, f.name ASC`
    )
    .bind(agentId, userId)
    .all<FileRow>()
  const bases = await db
    .prepare(
      `${WITH_COUNT}
       JOIN agents_knowledge_bases a ON a.knowledge_base_id = kb.id
       WHERE a.agent_id = ? AND a.user_id = ?
       ORDER BY a.created_at ASC, kb.name ASC`
    )
    .bind(agentId, userId)
    .all<KnowledgeBaseWithCount>()
  return {
    files: files.results ?? [],
    knowledgeBases: (bases.results ?? []).map(hydrate),
  }
}

/** Ready files an agent may retrieve from: attached directly or via a base. */
export async function retrievableFileIds(
  db: D1Database,
  agentId: string,
  userId: string,
  limit = 200
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT f.id FROM files f
       WHERE f.user_id = ? AND f.status = 'ready' AND (
         f.id IN (SELECT file_id FROM agents_files
                  WHERE agent_id = ? AND enabled = 1)
         OR f.id IN (
           SELECT k.file_id FROM knowledge_base_files k
           JOIN agents_knowledge_bases a
             ON a.knowledge_base_id = k.knowledge_base_id
           WHERE a.agent_id = ? AND a.enabled = 1)
       )
       ORDER BY f.created_at DESC
       LIMIT ?`
    )
    .bind(userId, agentId, agentId, limit)
    .all<{ id: string }>()
  return (results ?? []).map((row) => row.id)
}
