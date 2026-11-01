import type { AppBindings } from "../../env"

/** Workers AI (or the credentials for it) is not set up on this deployment. */
export class WorkersAiNotConfiguredError extends Error {
  constructor(message = "Workers AI is not configured") {
    super(message)
  }
}

/**
 * A single-model Workers AI call (`.../ai/run/<model>`), used by image
 * generation. Like the chat client, this is the only place the API token is
 * attached, and it refuses any host but Cloudflare's.
 */
export function workersAiRun(env: AppBindings, model: string) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  const token = env.CLOUDFLARE_API_TOKEN
  if (!accountId || !token) throw new WorkersAiNotConfiguredError()
  const url = env.CLOUDFLARE_AI_GATEWAY
    ? `https://gateway.ai.cloudflare.com/v1/${accountId}/${env.CLOUDFLARE_AI_GATEWAY}/workers-ai/${model}`
    : `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`
  if (!/^https:\/\/[^/]*\.cloudflare\.com\//.test(url)) {
    throw new Error(
      "Refusing to send a Workers AI token to a non-Cloudflare host"
    )
  }
  const fetcher = env.AI_FETCH ?? fetch
  return {
    url,
    headers: { Authorization: `Bearer ${token}` },
    // Callers use `run.fetcher(...)`, and workerd's fetch throws "Illegal
    // invocation" when called as a method, so always call it bare.
    fetcher: (...args: Parameters<typeof fetch>) => fetcher(...args),
  }
}
