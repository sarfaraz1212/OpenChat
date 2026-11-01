import type { AppBindings } from "../../env"
import * as memories from "../db/memories"
import type { Memory } from "../db/types"
import { embedTexts } from "../rag/embed"
import { queryMemoryVectors } from "./vectors"

/** Memories handed to the model per turn, best first. */
export const MEMORY_TOP_K = 5

/**
 * The user's memories most similar to `text`. Embeds nothing when the user has
 * no memories yet. Throws if the search fails; callers decide whether that
 * matters.
 */
export async function searchMemories(
  env: AppBindings,
  params: { userId: string; text: string; topK: number }
): Promise<Memory[]> {
  if ((await memories.count(env.DB, params.userId)) === 0) return []
  const [vector] = await embedTexts(env, [params.text])
  const hits = await queryMemoryVectors(env.MEMORY_VECTORS, {
    userId: params.userId,
    vector,
    topK: params.topK,
  })
  // A vector whose row is gone (a memory deleted while the index was
  // unreachable) is skipped, so a stale hit can never surface.
  return memories.byIds(
    env.DB,
    params.userId,
    hits.map((hit) => hit.id)
  )
}

export type MemoryContext = { persona: string | null; memories: Memory[] }

export const NO_MEMORY: MemoryContext = { persona: null, memories: [] }

/**
 * What the assistant should know about the user for this turn: the persona plus
 * the memories closest to the message. Empty when the user turned memory off.
 * A failing search degrades to the persona alone.
 */
export async function retrieveMemoryContext(
  env: AppBindings,
  params: { userId: string; query: string }
): Promise<MemoryContext> {
  if (!(await memories.isEnabled(env.DB, params.userId))) return NO_MEMORY
  const persona = (await memories.getPersona(env.DB, params.userId))?.persona
  let found: Memory[] = []
  try {
    found = await searchMemories(env, {
      userId: params.userId,
      text: params.query,
      topK: MEMORY_TOP_K,
    })
  } catch (error) {
    console.error("[memory] search failed", error)
  }
  return { persona: persona || null, memories: found }
}

/** The system-prompt section for what the assistant remembers, or "". */
export function memorySection(context: MemoryContext): string {
  if (!context.persona && context.memories.length === 0) return ""
  const parts = [
    "What you know about the user, from earlier conversations. Use it naturally where it helps; do not recite it or mention that you were given it, and ignore anything not relevant.",
  ]
  if (context.persona) parts.push(context.persona)
  if (context.memories.length > 0) {
    parts.push(
      "Relevant memories:\n" +
        context.memories
          .map(
            (memory) => `- [${memory.layer}] ${memory.title}: ${memory.summary}`
          )
          .join("\n")
    )
  }
  return parts.join("\n\n")
}
