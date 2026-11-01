import type { AppBindings } from "../../env"
import type { Memory } from "../db/types"
import { embedTexts } from "../rag/embed"
import { deleteVectors, type VectorStore } from "../rag/vectors"

export { deleteVectors as deleteMemoryVectors } from "../rag/vectors"

/**
 * The memory index: one vector per memory, keyed by the memory id, in the
 * user's namespace, with the layer as metadata. Like the knowledge index it
 * holds no text: memory content stays in D1.
 */

const UPSERT_BATCH = 500

/** What is embedded for a memory. */
export const memoryText = (
  memory: Pick<Memory, "title" | "summary" | "details">
) => [memory.title, memory.summary, memory.details].filter(Boolean).join("\n")

export async function upsertMemoryVectors(
  store: VectorStore,
  userId: string,
  items: Array<{ id: string; layer: string; values: number[] }>
): Promise<void> {
  for (let i = 0; i < items.length; i += UPSERT_BATCH) {
    await store.upsert(
      items.slice(i, i + UPSERT_BATCH).map((item) => ({
        id: item.id,
        values: item.values,
        namespace: userId,
        metadata: { layer: item.layer },
      }))
    )
  }
}

/** The user's memories closest to `vector`, best first. */
export async function queryMemoryVectors(
  store: VectorStore,
  params: { userId: string; vector: number[]; topK: number }
): Promise<Array<{ id: string; score: number }>> {
  const { matches } = await store.query(params.vector, {
    topK: params.topK,
    namespace: params.userId,
    returnMetadata: "none",
  })
  return matches.map(({ id, score }) => ({ id, score }))
}

/**
 * Bring the index in line with a change: embed and upsert the memories that
 * were added or edited, delete the ones that were removed. Best-effort: memory
 * rows are the source of truth, a vector without a row is never surfaced, and a
 * row without a vector is only missing from search until it is next edited.
 */
export async function syncMemoryVectors(
  env: AppBindings,
  userId: string,
  changed: Memory[],
  removed: Memory[]
): Promise<void> {
  try {
    if (changed.length > 0) {
      const embeddings = await embedTexts(env, changed.map(memoryText))
      await upsertMemoryVectors(
        env.MEMORY_VECTORS,
        userId,
        changed.map((memory, i) => ({
          id: memory.id,
          layer: memory.layer,
          values: embeddings[i],
        }))
      )
    }
    if (removed.length > 0) {
      await deleteVectors(
        env.MEMORY_VECTORS,
        removed.map((memory) => memory.id)
      )
    }
  } catch (error) {
    console.error("[memory] vector sync failed", error)
  }
}
