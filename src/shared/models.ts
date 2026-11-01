/**
 * Cloudflare Workers AI chat catalog carried forward from the legacy app.
 *
 * IDs are the real open-weight backends. This is the single source of truth for
 * request validation, the model picker and the provider settings page; a user's
 * enable/disable choices are stored per user (migration 0004), not here.
 */
export const CHAT_MODELS = [
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    name: "Llama 3.3 70B",
    author: "Meta",
  },
  { id: "@cf/openai/gpt-oss-120b", name: "GPT-OSS 120B", author: "OpenAI" },
  { id: "@cf/openai/gpt-oss-20b", name: "GPT-OSS 20B", author: "OpenAI" },
  {
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    name: "Llama 4 Scout",
    author: "Meta",
  },
  {
    id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    name: "Mistral Small 3.1",
    author: "Mistral AI",
  },
  {
    id: "@cf/deepseek-ai/deepseek-v4-pro-0813",
    name: "DeepSeek V4 Pro",
    author: "DeepSeek",
  },
  {
    id: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash",
    author: "DeepSeek",
  },
  {
    id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    name: "DeepSeek R1 Distill 32B",
    author: "DeepSeek",
  },
  {
    id: "@cf/qwen/qwen2.5-coder-32b-instruct",
    name: "Qwen2.5 Coder 32B",
    author: "Qwen",
  },
  { id: "@cf/qwen/qwen3-30b-a3b-fp8", name: "Qwen3 30B", author: "Qwen" },
  { id: "@cf/qwen/qwen3.8-27b", name: "Qwen3.8 27B", author: "Qwen" },
  { id: "@cf/zai-org/glm-5.2", name: "GLM 5.2", author: "Z.ai" },
  { id: "@cf/zai-org/glm-5.3", name: "GLM 5.3", author: "Z.ai" },
  {
    id: "@cf/zai-org/glm-5.3-flash",
    name: "GLM 5.3 Flash",
    author: "Z.ai",
  },
  { id: "@cf/moonshotai/kimi-k2.6", name: "Kimi K2.6", author: "Moonshot AI" },
  {
    id: "@cf/moonshotai/kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    author: "Moonshot AI",
  },
  {
    id: "@cf/google/gemma-4-26b-a4b-it",
    name: "Gemma 4 26B",
    author: "Google",
  },
  {
    id: "@cf/nvidia/nemotron-3-120b-a12b",
    name: "Nemotron 3 120B",
    author: "NVIDIA",
  },
  {
    id: "@cf/meta/llama-3.1-8b-instruct-fp8",
    name: "Llama 3.1 8B",
    author: "Meta",
  },
] as const

export type ChatModelId = (typeof CHAT_MODELS)[number]["id"]

/** Recently added models that should be highlighted in the UI model pickers. */
export const NEW_CHAT_MODEL_IDS = [
  "@cf/qwen/qwen3.8-27b",
  "@cf/zai-org/glm-5.3",
  "@cf/zai-org/glm-5.3-flash",
  "@cf/moonshotai/kimi-k2.7-code",
] as const satisfies readonly ChatModelId[]

const NEW_CHAT_MODEL_ID_SET: ReadonlySet<string> = new Set(NEW_CHAT_MODEL_IDS)

export function isNewChatModelId(value: string): boolean {
  return NEW_CHAT_MODEL_ID_SET.has(value)
}

export type ModelAbilities = {
  functionCall?: boolean
  vision?: boolean
  reasoning?: boolean
}

type ModelDetails = {
  abilities?: ModelAbilities
  contextWindowTokens?: number
}

type ModelBestFor = Record<ChatModelId, string>

/**
 * Only observed facts are recorded here; an unknown ability is absent, never
 * guessed. The Record type forces an entry (possibly empty) for every model.
 *
 * Sourced from the legacy catalog's 2026-09-12 streaming probe
 * (`git show main:lib/models/data/cloudflare.ts`, `scripts/probe-tools.mjs`):
 * Workers AI advertises tools for every model and several accept an image block
 * yet answer around it, so vision is recorded only where the probe image was
 * actually described. Run the probe again to fill in the empty entries.
 */
const MODEL_DETAILS: Record<ChatModelId, ModelDetails> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {},
  "@cf/openai/gpt-oss-120b": {
    abilities: { functionCall: true, vision: false, reasoning: true },
    contextWindowTokens: 128_000,
  },
  "@cf/openai/gpt-oss-20b": {
    abilities: { functionCall: true, vision: false, reasoning: true },
    contextWindowTokens: 128_000,
  },
  "@cf/meta/llama-4-scout-17b-16e-instruct": {},
  "@cf/mistralai/mistral-small-3.1-24b-instruct": {},
  "@cf/deepseek-ai/deepseek-v4-pro-0813": {
    abilities: { functionCall: true, vision: false, reasoning: true },
    contextWindowTokens: 1_048_576,
  },
  "@cf/deepseek-ai/deepseek-v4-flash-0731": {
    abilities: { functionCall: true, vision: false, reasoning: true },
    contextWindowTokens: 1_048_576,
  },
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": {},
  "@cf/qwen/qwen2.5-coder-32b-instruct": {},
  "@cf/qwen/qwen3-30b-a3b-fp8": {},
  "@cf/qwen/qwen3.8-27b": {},
  "@cf/zai-org/glm-5.2": {},
  "@cf/zai-org/glm-5.3": {},
  "@cf/zai-org/glm-5.3-flash": {},
  "@cf/moonshotai/kimi-k2.6": {},
  "@cf/moonshotai/kimi-k2.7-code": {},
  "@cf/google/gemma-4-26b-a4b-it": {
    abilities: { functionCall: true, vision: true, reasoning: true },
    contextWindowTokens: 256_000,
  },
  "@cf/nvidia/nemotron-3-120b-a12b": {},
  "@cf/meta/llama-3.1-8b-instruct-fp8": {},
}

const MODEL_BEST_FOR: ModelBestFor = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast":
    "Balanced quality for everyday chat, analysis and writing.",
  "@cf/openai/gpt-oss-120b":
    "High-quality reasoning and long-form drafting with strong reliability.",
  "@cf/openai/gpt-oss-20b":
    "Fast general chat and lightweight drafting at lower latency.",
  "@cf/meta/llama-4-scout-17b-16e-instruct":
    "General-purpose assistant tasks with good speed and consistency.",
  "@cf/mistralai/mistral-small-3.1-24b-instruct":
    "Concise answers, summarization and practical day-to-day assistance.",
  "@cf/deepseek-ai/deepseek-v4-pro-0813":
    "Deep multi-step reasoning, complex planning and hard analysis.",
  "@cf/deepseek-ai/deepseek-v4-flash-0731":
    "Reasoning-heavy tasks when you want faster turnaround.",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b":
    "Structured problem solving and step-by-step technical thinking.",
  "@cf/qwen/qwen2.5-coder-32b-instruct":
    "Code generation, refactoring and debugging in multiple languages.",
  "@cf/qwen/qwen3-30b-a3b-fp8":
    "Strong multilingual chat and robust general-purpose assistant work.",
  "@cf/qwen/qwen3.8-27b":
    "Newer Qwen model for balanced coding, reasoning and multilingual tasks.",
  "@cf/zai-org/glm-5.2":
    "General chat and analytical tasks with broad domain coverage.",
  "@cf/zai-org/glm-5.3":
    "Newer GLM quality tier for harder reasoning and richer responses.",
  "@cf/zai-org/glm-5.3-flash":
    "Fast GLM responses for interactive chat and quick iterations.",
  "@cf/moonshotai/kimi-k2.6":
    "Research-style conversation and synthesis over larger contexts.",
  "@cf/moonshotai/kimi-k2.7-code":
    "Code-focused Kimi model for implementation and technical edits.",
  "@cf/google/gemma-4-26b-a4b-it":
    "Vision-capable tasks and grounded multimodal assistant workflows.",
  "@cf/nvidia/nemotron-3-120b-a12b":
    "Large-model depth for difficult reasoning and technical explanation.",
  "@cf/meta/llama-3.1-8b-instruct-fp8":
    "Low-cost, quick responses for simple prompts and short chats.",
}

export type ChatModelInfo = {
  id: ChatModelId
  name: string
  author: string
  bestFor: string
  abilities: ModelAbilities
  contextWindowTokens?: number
}

export const CHAT_MODEL_INFOS: readonly ChatModelInfo[] = CHAT_MODELS.map(
  (model) => ({
    id: model.id,
    name: model.name,
    author: model.author,
    bestFor: MODEL_BEST_FOR[model.id],
    abilities: MODEL_DETAILS[model.id].abilities ?? {},
    contextWindowTokens: MODEL_DETAILS[model.id].contextWindowTokens,
  })
)

/**
 * OpenChat talks to exactly one provider. The provider surface is kept (as in
 * LobeHub) so the settings UI has its familiar shape, but the registry is
 * locked to Cloudflare Workers AI; see decision 0005.
 */
export const PROVIDERS = [
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    description:
      "Open-weight models served from Cloudflare's network. Access is managed by the OpenChat server, so there is no API key to enter.",
  },
] as const

export type ProviderId = (typeof PROVIDERS)[number]["id"]

export const DEFAULT_CHAT_MODEL: ChatModelId =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
export const CLOUDFLARE_WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo"

/**
 * Embeds knowledge-base chunks and retrieval queries. Multilingual, and 1024
 * dimensions like the LobeHub embeddings it replaces, so the Vectorize index is
 * created with `--dimensions=1024 --metric=cosine`.
 */
export const CLOUDFLARE_EMBEDDING_MODEL = "@cf/baai/bge-m3"

/** Carried forward for the Phase 12 image-generation port. */
export const IMAGE_MODELS = [
  {
    id: "flux-2-dev",
    backend: "@cf/black-forest-labs/flux-2-dev",
    name: "FLUX.2 Dev",
    author: "Black Forest Labs",
  },
  {
    id: "lucid-origin",
    backend: "@cf/leonardo/lucid-origin",
    name: "Lucid Origin",
    author: "Leonardo AI",
  },
  {
    id: "phoenix-1.0",
    backend: "@cf/leonardo/phoenix-1.0",
    name: "Phoenix 1.0",
    author: "Leonardo AI",
  },
  {
    id: "flux-2-klein-9b",
    backend: "@cf/black-forest-labs/flux-2-klein-9b",
    name: "FLUX.2 Klein 9B",
    author: "Black Forest Labs",
  },
  {
    id: "flux-2-klein-4b",
    backend: "@cf/black-forest-labs/flux-2-klein-4b",
    name: "FLUX.2 Klein 4B",
    author: "Black Forest Labs",
  },
  {
    id: "flux-1-schnell",
    backend: "@cf/black-forest-labs/flux-1-schnell",
    name: "FLUX.1 Schnell",
    author: "Black Forest Labs",
  },
] as const

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"]

const CHAT_MODEL_ID_SET: ReadonlySet<string> = new Set(
  CHAT_MODELS.map((model) => model.id)
)

export function isChatModelId(value: string): value is ChatModelId {
  return CHAT_MODEL_ID_SET.has(value)
}

export function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.some((provider) => provider.id === value)
}
