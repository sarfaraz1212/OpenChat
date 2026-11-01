import type { AppBindings } from "../../env"
import * as memories from "../db/memories"
import type { Memory } from "../db/types"
import { deleteMemoryVectors, syncMemoryVectors } from "./vectors"

/** Changes the user makes to their own memories, with the index kept in step. */

export async function editMemory(
  env: AppBindings,
  userId: string,
  params: {
    id: string
    title?: string
    summary?: string
    details?: string | null
    tags?: string[]
  }
): Promise<Memory | null> {
  const next = await memories.update(env.DB, { ...params, userId })
  if (next) await syncMemoryVectors(env, userId, [next], [])
  return next
}

export async function forgetMemory(
  env: AppBindings,
  userId: string,
  id: string
): Promise<boolean> {
  const current = await memories.findOwned(env.DB, id, userId)
  if (!current || !(await memories.remove(env.DB, id, userId))) return false
  await syncMemoryVectors(env, userId, [], [current])
  return true
}

/** Delete every memory, the persona and the extraction bookkeeping. */
export async function forgetEverything(
  env: AppBindings,
  userId: string
): Promise<void> {
  const ids = await memories.removeAll(env.DB, userId)
  await deleteMemoryVectors(env.MEMORY_VECTORS, ids).catch((error) =>
    console.error("[memory] vector cleanup failed", error)
  )
}
