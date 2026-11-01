import type { AppBindings } from "../../env"
import * as memories from "../db/memories"
import * as messageRepo from "../db/messages"
import * as topics from "../db/topics"
import type { Memory } from "../db/types"
import { MEMORY_LAYERS, type MemoryLayer } from "./layers"
import { generateJson } from "./llm"
import {
  decisionUser,
  gatekeeperSystem,
  layerSystem,
  personaSystem,
  personaUser,
  renderConversation,
  type PromptMemory,
} from "./prompts"
import { searchMemories } from "./retrieve"
import {
  gatekeeperSchema,
  layerResultSchema,
  personaSchema,
  type LayerResult,
} from "./schemas"
import { syncMemoryVectors } from "./vectors"

export type ExtractionParams = { userId: string; topicId: string }

/** Messages shown to the models, newest last. */
const WINDOW = 20
/** Existing memories shown to the models for de-duplication. */
const EXISTING_TOP_K = 8

const toPrompt = (memory: Memory): PromptMemory => ({
  id: memory.id,
  layer: memory.layer,
  title: memory.title,
  summary: memory.summary,
})

/**
 * Turn what one topic's conversation has added into memories: a gatekeeper
 * picks the layers worth extracting, each picked layer's extractor proposes
 * add/update/remove actions against the user's existing memories, and the
 * persona is rewritten if anything changed. Safe to run twice for the same
 * messages.
 */
export async function extractMemories(
  env: AppBindings,
  params: ExtractionParams
): Promise<void> {
  const { userId, topicId } = params
  if (!(await memories.isEnabled(env.DB, userId))) return
  if (!(await topics.findOwned(env.DB, topicId, userId))) return

  const history = await messageRepo.listForOwnedTopic(env.DB, topicId, userId)
  if (history.length === 0) return
  if (history.length <= (await memories.extractedCount(env.DB, topicId))) return

  const conversation = renderConversation(history.slice(-WINDOW))

  let existing: Memory[] = []
  try {
    existing = await searchMemories(env, {
      userId,
      text: conversation.slice(-2000),
      topK: EXISTING_TOP_K,
    })
  } catch (error) {
    console.error("[memory] could not load similar memories", error)
  }
  const known = new Map(existing.map((memory) => [memory.id, memory]))

  const decisions = await generateJson(env, {
    system: gatekeeperSystem(),
    prompt: decisionUser({
      conversation,
      existing: existing.map(toPrompt),
    }),
    schema: gatekeeperSchema,
  })
  const layers = MEMORY_LAYERS.filter((layer) => decisions[layer].shouldExtract)

  const results: Array<[MemoryLayer, LayerResult]> = await Promise.all(
    layers.map(async (layer) => [
      layer,
      await generateJson(env, {
        system: layerSystem(layer),
        prompt: decisionUser({
          conversation,
          existing: existing.filter((m) => m.layer === layer).map(toPrompt),
        }),
        schema: layerResultSchema,
      }),
    ])
  )

  const added: Memory[] = []
  const updated: Memory[] = []
  const removed: Memory[] = []
  for (const [layer, result] of results) {
    for (const item of result.add) {
      added.push(
        await memories.insert(env.DB, {
          ...item,
          userId,
          layer,
          sourceTopicId: topicId,
        })
      )
    }
    // Only memories the model was shown, of this layer, may be changed.
    for (const { id, ...patch } of result.update) {
      const current = known.get(id)
      if (!current || current.layer !== layer) continue
      const next = await memories.update(env.DB, { ...patch, id, userId })
      if (next) updated.push(next)
    }
    for (const { id } of result.remove) {
      const current = known.get(id)
      if (!current || current.layer !== layer) continue
      if (await memories.remove(env.DB, id, userId)) removed.push(current)
    }
  }

  await syncMemoryVectors(env, userId, [...added, ...updated], removed)

  if (added.length + updated.length + removed.length > 0) {
    const { persona } = await generateJson(env, {
      system: personaSystem(),
      prompt: personaUser({
        current: (await memories.getPersona(env.DB, userId))?.persona ?? null,
        changed: [...added, ...updated].map(toPrompt),
        removed: removed.map(toPrompt),
      }),
      schema: personaSchema,
    })
    if (persona) await memories.setPersona(env.DB, userId, persona)
  }

  await memories.setExtractedCount(env.DB, {
    topicId,
    userId,
    count: history.length,
  })
}

/**
 * Start background extraction for a topic. Skipped when the user has memory
 * off or the Workflows binding is absent (local dev without it).
 */
export async function enqueueMemoryExtraction(
  env: AppBindings,
  params: ExtractionParams
): Promise<void> {
  if (!env.MEMORY_WORKFLOW) return
  if (!(await memories.isEnabled(env.DB, params.userId))) return
  await env.MEMORY_WORKFLOW.create({ params })
}
