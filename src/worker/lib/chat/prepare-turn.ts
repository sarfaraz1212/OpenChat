import {
  DEFAULT_CHAT_MODEL,
  isChatModelId,
  type ChatModelId,
} from "../../../shared/models"
import type { Agent, Message } from "../db/types"
import { memorySection, type MemoryContext } from "../memory/retrieve"
import { knowledgeSection, type Excerpt } from "../rag/retrieve"

export const DEFAULT_SYSTEM_PROMPT =
  "You are OpenChat, a thoughtful and clear assistant. Be helpful, grounded, and concise."

export const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/** The first candidate that is in the catalog, else the default model. */
export function resolveModel(
  ...candidates: Array<string | null | undefined>
): ChatModelId {
  for (const candidate of candidates) {
    if (candidate && isChatModelId(candidate)) return candidate
  }
  return DEFAULT_CHAT_MODEL
}

/**
 * Turns an agent and the topic's history into the model call: the system
 * prompt (with what is remembered about the user and any retrieved excerpts),
 * the (windowed) messages and the
 * sampling parameters. Pure, so the route only wires I/O around it.
 */
export function prepareTurn(input: {
  agent: Agent
  model: ChatModelId
  history: Message[]
  excerpts?: Excerpt[]
  memory?: MemoryContext
  /** What the model is told about its sandbox, when it has one. */
  sandboxPrompt?: string
}) {
  const { agent, history } = input
  const persona = agent.systemRole?.trim() || DEFAULT_SYSTEM_PROMPT
  const limit = agent.chatConfig.historyCount
  const windowed = limit ? history.slice(-limit) : history
  return {
    model: input.model,
    system: [
      persona,
      input.memory ? memorySection(input.memory) : "",
      input.excerpts?.length ? knowledgeSection(input.excerpts) : "",
      input.sandboxPrompt ?? "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    messages: windowed.map((message) => ({
      role: message.role,
      content: message.content ?? "",
    })),
    temperature: agent.params.temperature,
    topP: agent.params.topP,
    maxOutputTokens: agent.params.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  }
}
