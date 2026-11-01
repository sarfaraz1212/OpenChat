import { env as baseEnv } from "cloudflare:workers"
import { CLOUDFLARE_EMBEDDING_MODEL } from "../../shared/models"
import type { AppBindings } from "../env"
import { GOAL_MANAGER_ROLE, VERIFIER_ROLE } from "../lib/goals/prompts"
import type { ExtractionParams } from "../lib/memory/extract"
import { MEMORY_LAYERS, type MemoryLayer } from "../lib/memory/layers"
import { GATEKEEPER_ROLE, layerRole, PERSONA_ROLE } from "../lib/memory/prompts"
import type { ExecResult, SandboxProvider } from "../lib/sandbox/backend"
import { runGoalWorkflow, type GoalRunParams } from "../workflows/goal-run"
import { runMemoryExtraction } from "../workflows/memory-extraction"
import {
  runResearchWorkflow,
  type ResearchRunParams,
} from "../workflows/research-run"
import type { TestClient } from "./client"
import {
  MODEL,
  signedInClient,
  usageChunk,
  usageStream,
  workersAiStream,
  type TokenUsage,
} from "./helpers"

/**
 * Fakes for the two Cloudflare services with no local simulation (Workers AI
 * and Vectorize), injected only at the boundary the Worker already crosses:
 * the outbound `fetch` and the `KB_VECTORS` binding. Everything behind the
 * Worker's own fetch interface (D1, R2, routing) is real.
 */

/**
 * Deterministic bag-of-words embedding: texts sharing (longer) words land close
 * in cosine distance, which is enough to make retrieval order meaningful.
 */
export function hashEmbedding(text: string, dims = 512): number[] {
  const vector = new Array<number>(dims).fill(0)
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (word.length < 4) continue
    let hash = 2166136261
    for (const char of word) {
      hash ^= char.charCodeAt(0)
      hash = Math.imul(hash, 16777619)
    }
    vector[(hash >>> 0) % dims] += 1
  }
  const norm = Math.hypot(...vector) || 1
  return vector.map((value) => value / norm)
}

const cosine = (a: number[], b: number[]) =>
  a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0) /
  ((Math.hypot(...a) || 1) * (Math.hypot(...b) || 1))

type StoredVector = {
  id: string
  values: number[]
  namespace?: string
  metadata?: Record<string, unknown>
}

type Filter = Record<string, unknown> | undefined

function matchesFilter(metadata: Record<string, unknown>, filter: Filter) {
  return Object.entries(filter ?? {}).every(([key, condition]) => {
    if (condition && typeof condition === "object" && "$in" in condition) {
      return (condition.$in as unknown[]).includes(metadata[key])
    }
    return metadata[key] === condition
  })
}

/**
 * In-memory stand-in for a Vectorize index: upsert, query (cosine, namespace
 * and equality / `$in` metadata filters) and delete. Unlike the real index it
 * is immediately consistent; production takes seconds to make new vectors
 * queryable.
 */
export class FakeVectorize {
  readonly vectors = new Map<string, StoredVector>()

  async upsert(vectors: StoredVector[]) {
    for (const vector of vectors) this.vectors.set(vector.id, vector)
    return { mutationId: "fake" }
  }

  async deleteByIds(ids: string[]) {
    for (const id of ids) this.vectors.delete(id)
    return { mutationId: "fake" }
  }

  async query(
    vector: number[],
    options: { topK?: number; namespace?: string; filter?: Filter } = {}
  ) {
    const matches = [...this.vectors.values()]
      .filter(
        (stored) =>
          options.namespace === undefined ||
          stored.namespace === options.namespace
      )
      .filter((stored) => matchesFilter(stored.metadata ?? {}, options.filter))
      .map((stored) => ({
        id: stored.id,
        score: cosine(vector, stored.values),
        namespace: stored.namespace,
        metadata: stored.metadata,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK ?? 5)
    return { matches, count: matches.length }
  }
}

export function embeddingsResponse(input: string[]): Response {
  return Response.json({
    object: "list",
    model: CLOUDFLARE_EMBEDDING_MODEL,
    data: input.map((text, index) => ({
      object: "embedding",
      index,
      embedding: hashEmbedding(text),
    })),
    usage: { prompt_tokens: 0, total_tokens: 0 },
  })
}

/** A non-streaming OpenAI-style chat completion, as `generateText` expects. */
export function completionResponse(content: string): Response {
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: MODEL,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
}

export type AiCall = {
  kind: "chat" | "embeddings"
  url: string
  authorization: string | null
  body: any
}

type AiHandlers = {
  /**
   * Override the chat reply. Receives the request body; return `undefined` to
   * fall through to the default ("ok", streamed or not as requested).
   */
  chat?: (body: AiCall["body"]) => Response | undefined
  /** Override the embeddings reply, e.g. to fail. */
  embeddings?: (input: string[]) => Response
}

/** A Workers AI `fetch` that records every call and answers chat and embeddings. */
export function fakeWorkersAi(handlers: AiHandlers = {}) {
  const calls: AiCall[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const body: AiCall["body"] = await request.json()
    const kind = request.url.endsWith("/embeddings") ? "embeddings" : "chat"
    calls.push({
      kind,
      url: request.url,
      authorization: request.headers.get("authorization"),
      body,
    })
    if (kind === "embeddings") {
      return handlers.embeddings?.(body.input) ?? embeddingsResponse(body.input)
    }
    return (
      handlers.chat?.(body) ??
      (body.stream ? workersAiStream("ok") : completionResponse("ok"))
    )
  }
  return {
    fetch: fetcher,
    calls,
    chat: () => calls.filter((call) => call.kind === "chat"),
    embeddings: () => calls.filter((call) => call.kind === "embeddings"),
  }
}

/** Signed-in clients that share one fake Workers AI and one fake Vectorize. */
export async function knowledgeWorld(handlers: AiHandlers = {}) {
  const ai = fakeWorkersAi(handlers)
  const vectors = new FakeVectorize()
  const newClient = () =>
    signedInClient(ai.fetch, {
      KB_VECTORS: vectors as unknown as VectorizeIndex,
    })
  return { ai, vectors, client: await newClient(), newClient }
}

/** Upload one file the way the SPA does. */
export function upload(
  client: TestClient,
  name: string,
  content: string | Uint8Array<ArrayBuffer>,
  type = "text/plain"
): Promise<Response> {
  const form = new FormData()
  form.set("file", new File([content], name, { type }))
  return client.post("/api/files", { csrf: true, form })
}

/* ── Memory ───────────────────────────────────────────────────────────────── */

/**
 * Stands in for the Workflows engine: creating an instance runs the real
 * workflow body inline, with steps executed directly, as the platform would
 * (minus durability and retries).
 */
export class FakeWorkflows {
  readonly calls: Array<{ id: string; params: unknown }> = []
  /** The Worker environment the workflow runs with; set by the world. */
  env!: AppBindings
  /** When false, `create` only records the instance; `replay` runs it. */
  autoRun = true

  constructor(
    private readonly runner: (
      env: AppBindings,
      payload: unknown
    ) => Promise<void>
  ) {}

  async create(options: { id?: string; params: unknown }) {
    const id = options.id ?? crypto.randomUUID()
    this.calls.push({ id, params: options.params })
    if (this.autoRun) await this.runner(this.env, options.params)
    return { id }
  }

  /** Run an earlier instance again, as a retried workflow would. */
  async replay(index = -1) {
    await this.runner(this.env, this.calls.at(index)!.params)
  }
}

/** A Workflows step that runs its callback directly (no durability or retries). */
const directStep = {
  do: async (_name: string, first: unknown, second?: unknown) =>
    (typeof first === "function" ? first : (second as () => unknown))(),
  sleep: async () => undefined,
} as never

export type MemoryScript = {
  /** Which layers the gatekeeper says are worth extracting (default: none). */
  gatekeeper: Partial<Record<MemoryLayer, boolean>>
  /** What each layer extractor returns (default: nothing to change). */
  layers: Partial<
    Record<
      MemoryLayer,
      { add?: unknown[]; update?: unknown[]; remove?: unknown[] }
    >
  >
  persona: string
  /** Make every extraction model call fail. */
  failExtraction: boolean
}

/**
 * Signed-in clients over a fake Workers AI whose non-streaming answers follow a
 * mutable script, plus separate fake Vectorize indexes for knowledge and
 * memory and a fake Workflows engine.
 */
export async function memoryWorld(
  initial: Partial<MemoryScript> = {},
  handlers: Omit<AiHandlers, "chat"> = {}
) {
  const script: MemoryScript = {
    gatekeeper: {},
    layers: {},
    persona: "",
    failExtraction: false,
    ...initial,
  }
  const ai = fakeWorkersAi({
    ...handlers,
    chat: (body) => {
      if (body.stream) return undefined // an ordinary chat reply
      if (script.failExtraction) {
        return new Response("upstream down", { status: 500 })
      }
      const system: string = body.messages[0].content
      if (system.includes(GATEKEEPER_ROLE)) {
        return completionResponse(
          JSON.stringify(
            Object.fromEntries(
              MEMORY_LAYERS.map((layer) => [
                layer,
                {
                  reasoning: "test",
                  shouldExtract: script.gatekeeper[layer] ?? false,
                },
              ])
            )
          )
        )
      }
      const layer = MEMORY_LAYERS.find((name) =>
        system.includes(layerRole(name))
      )
      if (layer) {
        return completionResponse(
          JSON.stringify({
            add: [],
            update: [],
            remove: [],
            ...script.layers[layer],
          })
        )
      }
      if (system.includes(PERSONA_ROLE)) {
        return completionResponse(JSON.stringify({ persona: script.persona }))
      }
      return undefined
    },
  })
  const vectors = new FakeVectorize()
  const memoryVectors = new FakeVectorize()
  const workflows = new FakeWorkflows((env, payload) =>
    runMemoryExtraction(
      env,
      { payload: payload as ExtractionParams },
      directStep
    )
  )
  const bindings = {
    KB_VECTORS: vectors as unknown as VectorizeIndex,
    MEMORY_VECTORS: memoryVectors as unknown as VectorizeIndex,
    MEMORY_WORKFLOW: workflows as unknown as Workflow,
  }
  workflows.env = {
    ...baseEnv,
    AI_FETCH: ai.fetch,
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_API_TOKEN: "test-token",
    ...bindings,
  } as AppBindings
  const newClient = () => signedInClient(ai.fetch, bindings)
  return {
    ai,
    script,
    vectors,
    memoryVectors,
    workflows,
    client: await newClient(),
    newClient,
    /** The streamed chat replies' requests (not extraction's JSON calls). */
    chatCalls: () => ai.chat().filter((call) => call.body.stream),
    /** Gatekeeper, layer and persona calls, in order. */
    extractionCalls: () => ai.chat().filter((call) => !call.body.stream),
  }
}

/* ── Goals ────────────────────────────────────────────────────────────────── */

export type GoalScript = {
  /** The goal manager's replies in order; once exhausted it asks to verify. */
  plans: unknown[]
  /** The reviewer's rulings in order; once exhausted it passes. */
  verdicts: Array<"pass" | "fail">
  /** Task title -> how many executions should fail before one succeeds. */
  failures: Record<string, number>
  /** Task title -> the text its execution returns. */
  results: Record<string, string>
  /** Task title -> tool calls its executor makes before answering. */
  toolCalls: Record<string, ToolCall[]>
}

/** The title a task execution is about, from the "Task: <title>" first line. */
export const taskTitleOf = (call: AiCall): string | undefined =>
  /^Task: (.*)$/m.exec(lastUserText(call.body))?.[1]

/** The last user message's text; after a tool round trip it is not the last message. */
const lastUserText = (body: AiCall["body"]): string =>
  [...body.messages].reverse().find((m: { role: string }) => m.role === "user")
    ?.content ?? ""

/**
 * Signed-in clients over a fake Workers AI that plays the goal manager, the
 * reviewer and the task executor from a mutable script, plus a fake Workflows
 * engine that runs the real goal workflow body inline.
 */
export async function goalWorld(initial: Partial<GoalScript> = {}) {
  const script: GoalScript = {
    plans: [],
    verdicts: [],
    failures: {},
    results: {},
    toolCalls: {},
    ...initial,
  }
  const sandbox = new FakeSandbox()
  const ai = fakeWorkersAi({
    chat: (body) => {
      if (body.stream) return undefined
      const system: string = body.messages[0].content
      if (system.includes(GOAL_MANAGER_ROLE)) {
        return completionResponse(
          JSON.stringify(
            script.plans.shift() ?? { action: "verify", reason: "ready" }
          )
        )
      }
      if (system.includes(VERIFIER_ROLE)) {
        return completionResponse(
          JSON.stringify({
            verdict: script.verdicts.shift() ?? "pass",
            reason: "checked",
          })
        )
      }
      const title = /^Task: (.*)$/m.exec(lastUserText(body))?.[1]
      if (title === undefined) return undefined
      if ((script.failures[title] ?? 0) > 0) {
        script.failures[title] -= 1
        return new Response("upstream down", { status: 500 })
      }
      const calls = script.toolCalls[title]
      const usedTools = body.messages.some(
        (m: { role: string }) => m.role === "tool"
      )
      if (calls && !usedTools) return toolCallCompletion(calls)
      return completionResponse(script.results[title] ?? `Result of ${title}`)
    },
  })
  const workflows = new FakeWorkflows((env, payload) =>
    runGoalWorkflow(env, { payload: payload as GoalRunParams }, directStep)
  )
  const bindings = {
    GOAL_WORKFLOW: workflows as unknown as Workflow,
    SANDBOX_BACKEND: sandbox.provider,
  }
  workflows.env = {
    ...baseEnv,
    AI_FETCH: ai.fetch,
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_API_TOKEN: "test-token",
    ...bindings,
  } as AppBindings
  const newClient = () => signedInClient(ai.fetch, bindings)
  const nonStream = () => ai.chat().filter((call) => !call.body.stream)
  return {
    ai,
    script,
    sandbox,
    workflows,
    client: await newClient(),
    newClient,
    /** Task executions, in order. */
    taskCalls: () =>
      nonStream().filter((call) => taskTitleOf(call) !== undefined),
    /** Goal-manager planning turns, in order. */
    plannerCalls: () =>
      nonStream().filter((call) =>
        (call.body.messages[0].content as string).includes(GOAL_MANAGER_ROLE)
      ),
  }
}

/* ── Sandbox and tool calling ─────────────────────────────────────────────── */

export type ToolCall = { name: string; args: unknown }

const toolCallDeltas = (calls: ToolCall[]) =>
  calls.map((call, index) => ({
    index,
    id: `call_${index + 1}`,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  }))

/** A streamed reply that asks for tool calls, as Workers AI emits them. */
export function toolCallStream(
  calls: ToolCall[],
  usage?: TokenUsage
): Response {
  const chunk = (delta: unknown, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: MODEL,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`
  return new Response(
    chunk({ role: "assistant", tool_calls: toolCallDeltas(calls) }, null) +
      chunk({}, "tool_calls") +
      (usage ? usageChunk(usage) : "") +
      "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } }
  )
}

/** The same request for tool calls, as a non-streaming completion. */
export function toolCallCompletion(calls: ToolCall[]): Response {
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: toolCallDeltas(calls).map(
            ({ index: _index, ...call }) => call
          ),
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
}

/**
 * An in-memory stand-in for the sandbox backend: files per sandbox id, a log of
 * commands, and a scriptable answer to `exec`. Unlike a real container it runs
 * nothing; it records what the app asked for.
 */
export class FakeSandbox {
  readonly files = new Map<string, Map<string, string>>()
  readonly execLog: Array<{ id: string; command: string; timeoutMs?: number }> =
    []
  /** Answers commands; by default echoes them back. */
  onExec: (id: string, command: string) => ExecResult | Promise<ExecResult> = (
    _id,
    command
  ) => ({ stdout: `ran: ${command}\n`, stderr: "", exitCode: 0 })

  readonly provider: SandboxProvider = (id) => {
    const files = () =>
      this.files.get(id) ?? this.files.set(id, new Map()).get(id)!
    return {
      exec: async (command, options) => {
        this.execLog.push({ id, command, timeoutMs: options?.timeoutMs })
        return this.onExec(id, command)
      },
      readFile: async (path) => {
        const content = files().get(path)
        if (content === undefined) throw new Error(`No such file: ${path}`)
        return content
      },
      writeFile: async (path, content) => {
        files().set(path, content)
      },
      listFiles: async (path) =>
        [...files()]
          .filter(([file]) => file.slice(0, file.lastIndexOf("/")) === path)
          .map(([file, content]) => ({
            name: file.slice(file.lastIndexOf("/") + 1),
            type: "file" as const,
            size: content.length,
          })),
    }
  }
}

/** What each scripted model call reports having used. */
export const STEP_USAGE: TokenUsage = { input: 10, output: 5 }

/** One scripted model reply: plain text, or a request for tool calls. */
export type ChatStep = { text: string } | { calls: ToolCall[] }

/**
 * Signed-in clients over a fake Workers AI that answers each streamed chat
 * request from `steps` (text, or tool calls the app must run), with a fake
 * sandbox behind it. `noBackend` leaves the sandbox unconfigured.
 */
export async function sandboxWorld(
  options: { steps?: ChatStep[]; noBackend?: boolean } = {}
) {
  const steps = options.steps ?? []
  const sandbox = new FakeSandbox()
  const ai = fakeWorkersAi({
    chat: (body) => {
      if (!body.stream) return undefined
      const step = steps.shift() ?? { text: "ok" }
      // Every model call reports usage, as a real provider does.
      return "calls" in step
        ? toolCallStream(step.calls, STEP_USAGE)
        : usageStream(STEP_USAGE, step.text)
    },
  })
  const bindings = options.noBackend
    ? {}
    : { SANDBOX_BACKEND: sandbox.provider }
  const newClient = () => signedInClient(ai.fetch, bindings)
  return {
    ai,
    sandbox,
    steps,
    client: await newClient(),
    newClient,
    /** Streamed chat requests, in order. */
    chatCalls: () => ai.chat().filter((call) => call.body.stream),
  }
}

/* ── Image generation ─────────────────────────────────────────────────────── */

/** A 1x1 PNG, so stored images have real, sniffable bytes. */
export const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="
  ),
  (char) => char.charCodeAt(0)
)

export type ImageCall = {
  url: string
  /** The Workers AI model id from the URL, e.g. "@cf/leonardo/lucid-origin". */
  model: string
  wire: "json" | "multipart"
  /** The parsed JSON body, or the form fields. */
  body: Record<string, unknown>
  authorization: string | null
}

/**
 * A Workers AI `fetch` that records image requests (`.../ai/run/<model>`) and
 * answers each in the shape that model really uses: bytes for Phoenix, JSON
 * with a base64 image for the rest.
 */
export function fakeImageAi(
  handler?: (call: ImageCall) => Response | undefined
) {
  const calls: ImageCall[] = []
  const fetcher: typeof fetch = async function (this: unknown, input, init) {
    // Like workerd's real fetch, refuse to be called as another object's method.
    if (this !== undefined && this !== globalThis) {
      throw new TypeError(
        "Illegal invocation: function called with incorrect `this` reference."
      )
    }
    const request = new Request(input, init)
    const contentType = request.headers.get("content-type") ?? ""
    const multipart = contentType.startsWith("multipart/form-data")
    const body: Record<string, unknown> = multipart
      ? Object.fromEntries((await request.formData()).entries())
      : ((await request.json()) as Record<string, unknown>)
    const call: ImageCall = {
      url: request.url,
      model: request.url.split("/ai/run/")[1] ?? "",
      wire: multipart ? "multipart" : "json",
      body,
      authorization: request.headers.get("authorization"),
    }
    calls.push(call)
    const custom = handler?.(call)
    if (custom) return custom
    if (call.model === "@cf/leonardo/phoenix-1.0") {
      return new Response(PNG_BYTES, {
        headers: { "content-type": "image/jpeg" },
      })
    }
    return Response.json({
      result: { image: btoa(String.fromCharCode(...PNG_BYTES)) },
      success: true,
    })
  }
  return { fetch: fetcher, calls }
}

/* ── Black Forest Labs (background removal, enhancer) ─────────────────────── */

export type BflCall = {
  url: string
  method: string
  /** The `x-key` header, i.e. where the API key was sent. */
  key: string | null
  body?: any
}

/**
 * A fake for the outbound HTTP boundary that plays Black Forest Labs: submit
 * (POST .../v1/<endpoint>) answers a polling URL, polling answers Ready with a
 * result URL, and that URL answers image bytes. Each step can be overridden.
 */
export function fakeBfl(
  handlers: {
    submit?: (endpoint: string, body: any) => Response | undefined
    /** `attempt` counts polls of the same URL, from 1. */
    poll?: (url: string, attempt: number) => Response | undefined
    download?: (url: string) => Response | undefined
  } = {}
) {
  const calls: BflCall[] = []
  const polls = new Map<string, number>()
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const call: BflCall = {
      url: request.url,
      method: request.method,
      key: request.headers.get("x-key"),
    }
    if (request.method === "POST") {
      call.body = await request.json()
      calls.push(call)
      const endpoint = url.pathname.split("/").pop()!
      return (
        handlers.submit?.(endpoint, call.body) ??
        Response.json({
          id: "job",
          polling_url: `https://api.bfl.ai/v1/get_result?id=${endpoint}`,
        })
      )
    }
    calls.push(call)
    if (url.pathname.endsWith("/get_result")) {
      const attempt = (polls.get(request.url) ?? 0) + 1
      polls.set(request.url, attempt)
      return (
        handlers.poll?.(request.url, attempt) ??
        Response.json({
          status: "Ready",
          result: {
            sample: `https://delivery.bfl.ai/${url.searchParams.get("id")}.png`,
          },
        })
      )
    }
    return (
      handlers.download?.(request.url) ??
      new Response(PNG_BYTES, { headers: { "content-type": "image/png" } })
    )
  }
  return {
    fetch: fetcher,
    calls,
    submits: () => calls.filter((call) => call.method === "POST"),
  }
}

/* ── Deep Research ────────────────────────────────────────────────────────── */

export type SearchCall = {
  provider: "tavily" | "serper" | "perplexity"
  query: string
  maxResults: number | undefined
  /** Where the key was sent: an Authorization or X-API-KEY header. */
  auth: string | null
}

type SearchHit = { title: string; url: string; snippet: string }

const defaultHits = (query: string): SearchHit[] => [
  {
    title: "Result A",
    url: "https://example.com/a",
    snippet: `About ${query}`,
  },
  {
    title: "Result B",
    url: "https://example.org/b",
    snippet: `More on ${query}`,
  },
]

const DEFAULT_PAGE = `<html><head><style>.hidden{}</style></head><body>
<nav>Site menu</nav><h1>Findings</h1>
<p>Solar module prices fell 20% in 2025 &amp; kept falling.</p>
<script>trackVisitor()</script><footer>Copyright Example</footer></body></html>`

/**
 * A fake for the outbound HTTP boundary that plays the three search providers
 * (Tavily, Serper, Perplexity) and serves web pages for `readSource`.
 */
export function fakeWeb(
  handlers: {
    search?: (call: SearchCall) => SearchHit[] | undefined
    page?: (url: string) => Response | undefined
  } = {}
) {
  const searches: SearchCall[] = []
  const pages: string[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const { hostname } = new URL(request.url)
    if (hostname === "api.tavily.com") {
      const body: any = await request.json()
      const call: SearchCall = {
        provider: "tavily",
        query: body.query,
        maxResults: body.max_results,
        auth: request.headers.get("authorization"),
      }
      searches.push(call)
      const hits = handlers.search?.(call) ?? defaultHits(call.query)
      return Response.json({
        results: hits.map((hit) => ({
          title: hit.title,
          url: hit.url,
          content: hit.snippet,
        })),
      })
    }
    if (hostname === "google.serper.dev") {
      const body: any = await request.json()
      const call: SearchCall = {
        provider: "serper",
        query: body.q,
        maxResults: body.num,
        auth: request.headers.get("x-api-key"),
      }
      searches.push(call)
      const hits = handlers.search?.(call) ?? defaultHits(call.query)
      return Response.json({
        organic: hits.map((hit) => ({
          title: hit.title,
          link: hit.url,
          snippet: hit.snippet,
        })),
      })
    }
    if (hostname === "api.perplexity.ai") {
      const body: any = await request.json()
      const asked: string = body.messages.at(-1).content
      const call: SearchCall = {
        provider: "perplexity",
        query: /Search for: (.*)\. Return up to/.exec(asked)?.[1] ?? asked,
        maxResults: Number(/up to (\d+)/.exec(asked)?.[1]),
        auth: request.headers.get("authorization"),
      }
      searches.push(call)
      const hits = handlers.search?.(call) ?? defaultHits(call.query)
      return Response.json({
        choices: [{ message: { content: JSON.stringify(hits) } }],
      })
    }
    pages.push(request.url)
    return (
      handlers.page?.(request.url) ??
      new Response(DEFAULT_PAGE, { headers: { "content-type": "text/html" } })
    )
  }
  return { fetch: fetcher, searches, pages }
}

/**
 * Signed-in clients over a scripted research model (each non-streamed model
 * call takes the next step: tool calls or text), a fake web, and a fake
 * Workflows engine that runs the real research body inline.
 */
export async function researchWorld(
  options: {
    steps?: ChatStep[]
    web?: Parameters<typeof fakeWeb>[0]
    /** Search keys; defaults to Tavily only. Pass {} for none. */
    keys?: Record<string, string>
  } = {}
) {
  const steps = options.steps ?? []
  const web = fakeWeb(options.web)
  const ai = fakeWorkersAi({
    chat: (body) => {
      if (body.stream) return undefined
      const step = steps.shift() ?? { text: "ok" }
      return "calls" in step
        ? toolCallCompletion(step.calls)
        : completionResponse(step.text)
    },
  })
  const workflows = new FakeWorkflows((env, payload) =>
    runResearchWorkflow(
      env,
      { payload: payload as ResearchRunParams },
      directStep
    )
  )
  const bindings = {
    RESEARCH_WORKFLOW: workflows as unknown as Workflow,
    OUTBOUND_FETCH: web.fetch,
    ...(options.keys ?? { TAVILY_API_KEY: "test-tavily" }),
  }
  workflows.env = {
    ...baseEnv,
    AI_FETCH: ai.fetch,
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_API_TOKEN: "test-token",
    ...bindings,
  } as AppBindings
  const newClient = () => signedInClient(ai.fetch, bindings)
  return {
    ai,
    web,
    steps,
    workflows,
    client: await newClient(),
    newClient,
    /** The model calls the research loop made, in order. */
    modelCalls: () => ai.chat().filter((call) => !call.body.stream),
  }
}
