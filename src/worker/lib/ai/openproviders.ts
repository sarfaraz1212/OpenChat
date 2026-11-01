import { createOpenAI } from "@ai-sdk/openai"
import {
  CLOUDFLARE_EMBEDDING_MODEL,
  type ChatModelId,
} from "../../../shared/models"
import type { AppBindings } from "../../env"
import { createRepairingFetch } from "./repair-stream"

function baseUrl(env: AppBindings): string {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured")
  if (env.CLOUDFLARE_AI_GATEWAY) {
    return `https://gateway.ai.cloudflare.com/v1/${accountId}/${env.CLOUDFLARE_AI_GATEWAY}/workers-ai/v1`
  }
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
}

/** Workers AI's OpenAI-compatible endpoint; the only place a model token is sent. */
function workersAi(env: AppBindings) {
  if (!env.CLOUDFLARE_API_TOKEN) {
    throw new Error("CLOUDFLARE_API_TOKEN is not configured")
  }
  const url = baseUrl(env)
  if (!/^https:\/\/[^/]*\.cloudflare\.com\//.test(url)) {
    throw new Error(
      "Refusing to send a Workers AI token to a non-Cloudflare host"
    )
  }
  return createOpenAI({
    name: "cloudflare",
    baseURL: url,
    apiKey: env.CLOUDFLARE_API_TOKEN,
    fetch: createRepairingFetch(env.AI_FETCH ?? fetch),
  })
}

export function openproviders(model: ChatModelId, env: AppBindings) {
  return workersAi(env).chat(model)
}

/** The embedding model for knowledge-base chunks and retrieval queries. */
export function embeddingModel(env: AppBindings) {
  return workersAi(env).embedding(CLOUDFLARE_EMBEDDING_MODEL)
}
