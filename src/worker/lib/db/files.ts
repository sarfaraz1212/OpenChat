import { now } from "./client"
import type { ChunkRow, FileRow, FileStatus, KnowledgeFile } from "./types"

export const toKnowledgeFile = (row: FileRow): KnowledgeFile => ({
  id: row.id,
  name: row.name,
  fileType: row.file_type,
  size: row.size,
  status: row.status,
  error: row.error,
  chunkCount: row.chunk_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const CHUNK_INSERT_BATCH = 50

export async function create(
  db: D1Database,
  params: {
    id: string
    userId: string
    name: string
    fileType: string
    size: number
    r2Key: string
  }
): Promise<void> {
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO files
         (id, user_id, name, file_type, size, r2_key, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?)`
    )
    .bind(
      params.id,
      params.userId,
      params.name,
      params.fileType,
      params.size,
      params.r2Key,
      timestamp,
      timestamp
    )
    .run()
}

export async function findOwned(
  db: D1Database,
  id: string,
  userId: string
): Promise<FileRow | null> {
  return await db
    .prepare("SELECT * FROM files WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<FileRow>()
}

export async function listForUser(
  db: D1Database,
  userId: string
): Promise<FileRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<FileRow>()
  return results ?? []
}

export async function setStatus(
  db: D1Database,
  id: string,
  update: { status: FileStatus; error?: string | null; chunkCount?: number }
): Promise<void> {
  await db
    .prepare(
      `UPDATE files
       SET status = ?, error = ?, chunk_count = COALESCE(?, chunk_count),
           updated_at = ?
       WHERE id = ?`
    )
    .bind(
      update.status,
      update.error ?? null,
      update.chunkCount ?? null,
      now(),
      id
    )
    .run()
}

export async function insertChunks(
  db: D1Database,
  params: {
    fileId: string
    userId: string
    chunks: Array<{ id: string; index: number; text: string }>
  }
): Promise<void> {
  const timestamp = now()
  for (let i = 0; i < params.chunks.length; i += CHUNK_INSERT_BATCH) {
    await db.batch(
      params.chunks.slice(i, i + CHUNK_INSERT_BATCH).map((chunk) =>
        db
          .prepare(
            `INSERT INTO chunks
               (id, file_id, user_id, chunk_index, text, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(
            chunk.id,
            params.fileId,
            params.userId,
            chunk.index,
            chunk.text,
            timestamp
          )
      )
    )
  }
}

export async function chunkIds(
  db: D1Database,
  fileId: string
): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT id FROM chunks WHERE file_id = ?")
    .bind(fileId)
    .all<{ id: string }>()
  return (results ?? []).map((row) => row.id)
}

export async function deleteChunks(
  db: D1Database,
  fileId: string
): Promise<void> {
  await db.prepare("DELETE FROM chunks WHERE file_id = ?").bind(fileId).run()
}

/** Chunks (with their file names) for a set of vector hits, owner-checked. */
export async function chunksByIds(
  db: D1Database,
  userId: string,
  ids: string[]
): Promise<Array<ChunkRow & { file_name: string }>> {
  if (ids.length === 0) return []
  const { results } = await db
    .prepare(
      `SELECT c.*, f.name AS file_name
       FROM chunks c JOIN files f ON f.id = c.file_id
       WHERE c.user_id = ? AND c.id IN (${ids.map(() => "?").join(", ")})`
    )
    .bind(userId, ...ids)
    .all<ChunkRow & { file_name: string }>()
  return results ?? []
}

export async function remove(
  db: D1Database,
  id: string,
  userId: string
): Promise<void> {
  await db
    .prepare("DELETE FROM files WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run()
}

/** Which of `ids` are files this user owns (at most 50 ids per call). */
export async function ownedIds(
  db: D1Database,
  userId: string,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { results } = await db
    .prepare(
      `SELECT id FROM files
       WHERE user_id = ? AND id IN (${ids.map(() => "?").join(", ")})`
    )
    .bind(userId, ...ids)
    .all<{ id: string }>()
  return new Set((results ?? []).map((row) => row.id))
}
