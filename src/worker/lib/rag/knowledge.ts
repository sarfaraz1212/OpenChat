import type { AppBindings } from "../../env"
import { newId } from "../db/client"
import * as files from "../db/files"
import type { FileRow, KnowledgeFile } from "../db/types"
import { chunkText } from "./chunk"
import { embedTexts } from "./embed"
import {
  decodeText,
  isSupportedTextFile,
  MAX_FILE_BYTES,
  storedFileType,
} from "./extract"
import { deleteVectors, upsertVectors } from "./vectors"

/** What the upload endpoint can turn away before storing anything. */
export type UploadRejection = {
  status: 400 | 413 | 415
  code: string
  error: string
}

export type UploadResult =
  { ok: true; file: KnowledgeFile } | ({ ok: false } & UploadRejection)

const reject = (
  status: UploadRejection["status"],
  code: string,
  error: string
): UploadResult => ({ ok: false, status, code, error })

const UNSUPPORTED = reject(
  415,
  "UNSUPPORTED_FILE_TYPE",
  "Only text-based files (txt, md, csv, json, code…) can be added for now."
)

/** Chunk, embed and index a file's text; leaves nothing behind if it fails. */
async function indexText(
  env: AppBindings,
  file: { id: string; userId: string },
  text: string
): Promise<number> {
  const rows = chunkText(text).map((chunk, index) => ({
    id: newId(),
    index,
    text: chunk,
  }))
  try {
    const embeddings = await embedTexts(
      env,
      rows.map((row) => row.text)
    )
    // Rows first, so a vector never exists without the text it points at.
    await files.insertChunks(env.DB, {
      fileId: file.id,
      userId: file.userId,
      chunks: rows,
    })
    await upsertVectors(
      env.KB_VECTORS,
      file.userId,
      rows.map((row, i) => ({
        id: row.id,
        fileId: file.id,
        values: embeddings[i],
      }))
    )
    return rows.length
  } catch (error) {
    await files.deleteChunks(env.DB, file.id)
    await deleteVectors(
      env.KB_VECTORS,
      rows.map((row) => row.id)
    ).catch(() => undefined)
    throw error
  }
}

/**
 * Store an upload in R2 and index it, all within the request. A file whose
 * indexing fails is kept, marked `failed`, so the user can see and delete it.
 */
export async function uploadFile(
  env: AppBindings,
  userId: string,
  upload: File
): Promise<UploadResult> {
  if (upload.size > MAX_FILE_BYTES) {
    return reject(413, "FILE_TOO_LARGE", "Files can be at most 1 MB.")
  }
  if (!isSupportedTextFile(upload.name, upload.type)) return UNSUPPORTED

  const bytes = new Uint8Array(await upload.arrayBuffer())
  const text = decodeText(bytes)
  if (text === null) return UNSUPPORTED
  if (!text.trim()) return reject(400, "EMPTY_FILE", "That file is empty.")

  const id = newId()
  const r2Key = `users/${userId}/files/${id}`
  const fileType = storedFileType(upload.type)
  await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType: fileType } })
  try {
    await files.create(env.DB, {
      id,
      userId,
      name: upload.name,
      fileType,
      size: bytes.byteLength,
      r2Key,
    })
  } catch (error) {
    await env.FILES.delete(r2Key)
    throw error
  }

  try {
    const chunkCount = await indexText(env, { id, userId }, text)
    await files.setStatus(env.DB, id, { status: "ready", chunkCount })
  } catch (error) {
    console.error("[knowledge] indexing failed", error)
    await files.setStatus(env.DB, id, {
      status: "failed",
      error: "Could not index this file. Delete it and try again.",
      chunkCount: 0,
    })
  }
  const stored = await files.findOwned(env.DB, id, userId)
  return { ok: true, file: files.toKnowledgeFile(stored!) }
}

/** Remove a file, its stored object and its vectors. */
export async function deleteFile(
  env: AppBindings,
  userId: string,
  file: FileRow
): Promise<void> {
  const ids = await files.chunkIds(env.DB, file.id)
  // Orphaned vectors are inert (retrieval reads chunk text from D1), so a
  // Vectorize outage must not stop the user deleting their file.
  await deleteVectors(env.KB_VECTORS, ids).catch((error) =>
    console.error("[knowledge] vector cleanup failed", error)
  )
  await env.FILES.delete(file.r2_key)
  await files.remove(env.DB, file.id, userId)
}
