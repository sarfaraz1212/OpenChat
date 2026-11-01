import { expect } from "vitest"
import { TestClient, type ClientOptions } from "./client"

export const PASSWORD = "correct horse battery staple"
export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"

type TrpcEnvelope<T> = {
  result?: { data: T }
  error?: { message?: string; data?: { code?: string } }
}

export type TrpcResult<T> = {
  response: Response
  data?: T
  /** tRPC error code such as "UNAUTHORIZED" or "NOT_FOUND". */
  code?: string
  /** The error's message, when the call failed. */
  message?: string
}

async function unwrap<T>(response: Response): Promise<TrpcResult<T>> {
  const body = (await response.json()) as TrpcEnvelope<T>
  return {
    response,
    data: body.result?.data,
    code: body.error?.data?.code,
    message: body.error?.message,
  }
}

export async function trpcMutation<T = unknown>(
  client: TestClient,
  path: string,
  input: unknown
): Promise<TrpcResult<T>> {
  return unwrap<T>(
    await client.post(`/api/trpc/${path}`, { csrf: true, json: input })
  )
}

export async function trpcQuery<T = unknown>(
  client: TestClient,
  path: string,
  input?: unknown
): Promise<TrpcResult<T>> {
  const suffix =
    input === undefined
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return unwrap<T>(await client.get(`/api/trpc/${path}${suffix}`))
}

export type TokenUsage = { input: number; output: number }

function buildStream(chunks: string[], usage?: TokenUsage): Response {
  const events = chunks.map((content, index) => {
    const payload = {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: MODEL,
      choices: [
        {
          index: 0,
          delta: { ...(index === 0 ? { role: "assistant" } : {}), content },
          finish_reason: null,
        },
      ],
    }
    return `data: ${JSON.stringify(payload)}\n\n`
  })
  events.push(
    `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: MODEL,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`
  )
  if (usage) {
    // As OpenAI-compatible APIs report it: a last chunk with no choices.
    events.push(usageChunk(usage))
  }
  events.push("data: [DONE]\n\n")
  return new Response(events.join(""), {
    headers: { "content-type": "text/event-stream" },
  })
}

/** The final `usage` chunk of a stream. */
export const usageChunk = (usage: TokenUsage) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL,
    choices: [],
    usage: {
      prompt_tokens: usage.input,
      completion_tokens: usage.output,
      total_tokens: usage.input + usage.output,
    },
  })}\n\n`

/** An OpenAI-style chat-completion SSE stream, as Workers AI emits it. */
export function workersAiStream(...chunks: string[]): Response {
  return buildStream(chunks)
}

/** The same stream, with the token usage the provider reports at its end. */
export function usageStream(usage: TokenUsage, ...chunks: string[]): Response {
  return buildStream(chunks, usage)
}

const noopWorkflow = {
  create: async () => ({ id: "not-run" }),
} as unknown as Workflow

/**
 * A registered, signed-in browser stand-in whose outbound Workers AI requests
 * go to `aiFetch`, the only place a fake is injected.
 */
export async function signedInClient(
  aiFetch: typeof fetch = async () =>
    workersAiStream("Hello", " from", " OpenChat"),
  extraEnv: NonNullable<ClientOptions["env"]> = {}
): Promise<TestClient> {
  const client = new TestClient({
    env: {
      AI_FETCH: aiFetch,
      CLOUDFLARE_ACCOUNT_ID: "test-account",
      CLOUDFLARE_API_TOKEN: "test-token",
      // Memory is on by default, so every chat would start a real (local)
      // workflow run. Tests about memory or goals replace these; the rest
      // stay hermetic.
      MEMORY_WORKFLOW: noopWorkflow,
      GOAL_WORKFLOW: noopWorkflow,
      RESEARCH_WORKFLOW: noopWorkflow,
      ...extraEnv,
    },
  })
  await client.bootCsrf()
  const res = await client.post("/api/auth/register", {
    csrf: true,
    json: {
      email: `user-${crypto.randomUUID()}@openchat-tests.dev`,
      password: PASSWORD,
    },
  })
  expect(res.status).toBe(201)
  return client
}
