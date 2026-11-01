import type { MemoryLayer } from "./layers"

/**
 * Prompts for the three model calls in memory extraction (gatekeeper, one
 * extractor per layer, persona). Condensed from LobeHub's
 * `packages/memory-user-memory`, keeping its layer definitions and its strict
 * rule that only durable, cross-conversation directives count as preferences.
 *
 * The `*_ROLE` markers are the stable first words of each system prompt; test
 * fakes use them to tell the calls apart.
 */

export const GATEKEEPER_ROLE = "memory gatekeeper"
export const PERSONA_ROLE = "user persona"
export const layerRole = (layer: MemoryLayer) => `extract ${layer} memories`

const LAYER_GUIDE: Record<
  MemoryLayer,
  { definition: string; attributes: string }
> = {
  identity: {
    definition:
      "Who the user is: describing labels, background and experience, roles, relationships with other people, and current life priorities. Keep identity compact: route lists of tools and techniques to preferences unless they change the user's biography.",
    attributes:
      '{"type": "professional" | "personal" | "demographic", "role": string | null, "relationship": string | null}',
  },
  preference: {
    definition:
      'Durable choices and behavioural directives that apply across conversations: communication style, formatting, workflow, recurring tools, likes and dislikes. Only extract when the user signals cross-conversation intent ("always", "never", "from now on", "I prefer"). Task-specific requirements for one deliverable, one-off instructions and in-conversation corrections are NOT preferences. Ask: would this apply to a completely different conversation topic? If not, skip it. The conversation\'s language is not a preference unless the user says so.',
    attributes: '{"scope": string | null}',
  },
  experience: {
    definition:
      "Lessons learned and practical knowledge worth reusing: non-obvious tricks, insights, and situation → reasoning → action → outcome patterns. Skip routine steps already covered by existing memories.",
    attributes:
      '{"situation": string | null, "action": string | null, "outcome": string | null}',
  },
  activity: {
    definition:
      "Episodic events with a clear timeline: meetings, calls, errands, appointments, trips. Include when, where and with whom if stated, the status, and follow-ups. Omit anything the conversation does not state.",
    attributes:
      '{"startsAt": string | null, "endsAt": string | null, "location": string | null, "status": "planned" | "completed" | "cancelled" | "ongoing" | "pending" | null}',
  },
  context: {
    definition:
      "Ongoing situations and projects the user is in the middle of: research threads, long-term goals, persistent dynamics. Only record a genuinely new situation, or a status change of a known one; if it is really a takeaway, it belongs to experience.",
    attributes:
      '{"status": string | null, "urgency": "low" | "medium" | "high" | null}',
  },
}

const JSON_ONLY = "Respond with ONLY a JSON object and no other text."

export function gatekeeperSystem(): string {
  const layers = (Object.keys(LAYER_GUIDE) as MemoryLayer[])
    .map((layer) => `- **${layer}**: ${LAYER_GUIDE[layer].definition}`)
    .join("\n")
  return [
    `You are a ${GATEKEEPER_ROLE}. You read a conversation between a user and an assistant and decide which of five memory layers hold something worth storing.`,
    "Bias toward sensitivity: when in doubt, set shouldExtract to true so the extractors can refine. Minor or incremental updates should still pass. If the conversation is fully covered by the existing memories listed below and adds no update or nuance, set false. Casual small talk, greetings and pure task work usually contain nothing to remember.",
    `Layers:\n${layers}`,
    `${JSON_ONLY} Shape: {"activity": {"reasoning": string, "shouldExtract": boolean}, "context": {...}, "experience": {...}, "identity": {...}, "preference": {...}}. Write reasoning in English, briefly.`,
  ].join("\n\n")
}

export function layerSystem(layer: MemoryLayer): string {
  const guide = LAYER_GUIDE[layer]
  return [
    `You ${layerRole(layer)} from a conversation between a user and an assistant.`,
    `The ${layer} layer: ${guide.definition}`,
    "You are given the existing memories. Never duplicate them: use `update` (with the existing id) to refine one, `remove` to retract one the user contradicted or asked you to forget, and `add` only for genuinely new information. Write in the user's language. Titles are short descriptors; summaries are one or two sentences; only record what the user actually said.",
    `${JSON_ONLY} Shape: {"add": [{"title": string, "summary": string, "details": string | null, "tags": string[], "confidence": number between 0 and 1, "attributes": ${guide.attributes}}], "update": [{"id": string, "title"?: string, "summary"?: string, "details"?: string | null, "tags"?: string[], "confidence"?: number, "attributes"?: object}], "remove": [{"id": string, "reason": string}]}. Use empty arrays when there is nothing to change.`,
  ].join("\n\n")
}

export function personaSystem(): string {
  return [
    `You maintain a ${PERSONA_ROLE}: a short, factual profile of the user (who they are, what they prefer, what they are working on), written in the third person as brief Markdown, at most 1,500 characters.`,
    "You receive the current persona and the memories that changed. Merge them: keep what still holds, revise what changed, and drop what was removed or contradicted. Never invent facts.",
    `${JSON_ONLY} Shape: {"persona": string}.`,
  ].join("\n\n")
}

export type PromptMemory = {
  id: string
  layer: MemoryLayer
  title: string
  summary: string
}

const renderMemories = (memories: PromptMemory[]) =>
  memories.length === 0
    ? "(none)"
    : memories
        .map(
          (memory) =>
            `- id=${memory.id} [${memory.layer}] ${memory.title}: ${memory.summary}`
        )
        .join("\n")

export const renderConversation = (
  messages: Array<{ role: string; content: string | null }>
) =>
  messages
    .map((message) => `${message.role}: ${message.content ?? ""}`)
    .join("\n\n")

export const decisionUser = (params: {
  conversation: string
  existing: PromptMemory[]
}) =>
  `Existing memories (most similar first):\n${renderMemories(params.existing)}\n\nConversation:\n${params.conversation}`

export const personaUser = (params: {
  current: string | null
  changed: PromptMemory[]
  removed: PromptMemory[]
}) =>
  `Current persona:\n${params.current || "(none yet)"}\n\nNew or updated memories:\n${renderMemories(params.changed)}\n\nRemoved memories:\n${renderMemories(params.removed)}`
