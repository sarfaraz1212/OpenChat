import { afterEach, describe, expect, it, vi } from "vitest"
import { TestClient } from "../test/client"
import { researchWorld, type ChatStep } from "../test/fakes"
import { trpcMutation, trpcQuery } from "../test/helpers"

const STANDARD_MODEL = "@cf/openai/gpt-oss-20b"
const DEEP_MODEL = "@cf/openai/gpt-oss-120b"
const NO_TOOLS_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"

type Session = {
  id: string
  topic: string
  depth: "standard" | "deep"
  status: "in_progress" | "completed" | "failed"
  report: string | null
  sources: string[]
  activity: Array<
    | { kind: "search"; query: string; results: number }
    | { kind: "read"; url: string; ok: boolean }
  >
  model: string | null
  createdAt: string
  completedAt: string | null
}
type SessionRow = Pick<
  Session,
  "id" | "topic" | "status" | "depth" | "createdAt"
>

const REPORT = `# Solar prices\n\n${"Module prices fell steadily and installers passed the savings on. ".repeat(4)}\n\n## Sources\n- https://example.com/a`

const search = (query: string): ChatStep => ({
  calls: [{ name: "webSearch", args: { query } }],
})
const read = (url: string): ChatStep => ({
  calls: [{ name: "readSource", args: { url, reason: "Primary source" } }],
})

const start = (client: TestClient, input: Record<string, unknown> = {}) =>
  trpcMutation<Session>(client, "research.start", {
    topic: "How fast are solar prices falling?",
    depth: "standard",
    ...input,
  })

const get = (client: TestClient, id: string) =>
  trpcQuery<Session>(client, "research.get", { id }).then((r) => r.data!)

afterEach(() => vi.useRealTimers())

describe("deep research", () => {
  it("searches, reads a source, writes a report, and keeps all of it", async () => {
    const world = await researchWorld({
      steps: [
        search("solar module prices"),
        read("https://example.com/a"),
        { text: REPORT },
      ],
    })

    const started = await start(world.client)
    const session = await get(world.client, started.data!.id)

    expect(session).toMatchObject({
      topic: "How fast are solar prices falling?",
      depth: "standard",
      status: "completed",
      report: REPORT,
      sources: ["https://example.com/a"],
      model: STANDARD_MODEL,
    })
    expect(session.completedAt).toBeTruthy()
    expect(session.activity).toEqual([
      { kind: "search", query: "solar module prices", results: 2 },
      { kind: "read", url: "https://example.com/a", ok: true },
    ])
    // The model saw the page's text, without its scripts, menus or markup.
    const lastPrompt = JSON.stringify(world.modelCalls().at(-1)?.body.messages)
    expect(lastPrompt).toContain(
      "Solar module prices fell 20% in 2025 & kept falling."
    )
    expect(lastPrompt).not.toContain("trackVisitor")
    expect(lastPrompt).not.toContain("Site menu")
    expect(lastPrompt).not.toContain("<p>")
  })

  it("uses a bigger model and budget for a deep run, and the user's model when it can call tools", async () => {
    const world = await researchWorld({
      steps: [{ text: REPORT }, { text: REPORT }, { text: REPORT }],
    })

    const standard = await start(world.client)
    const deep = await start(world.client, { depth: "deep" })
    const chosen = await start(world.client, { model: DEEP_MODEL })
    const unfit = await start(world.client, { model: NO_TOOLS_MODEL })

    const models = await Promise.all(
      [standard, deep, chosen, unfit].map(
        async (r) => (await get(world.client, r.data!.id)).model
      )
    )
    expect(models).toEqual([
      STANDARD_MODEL,
      DEEP_MODEL,
      DEEP_MODEL,
      STANDARD_MODEL,
    ])
    const [first, second] = world.modelCalls()
    expect(first.body.max_tokens).toBe(12000)
    expect(second.body.max_tokens).toBe(16000)
  })

  it("uses whichever search provider is configured: Tavily, then Perplexity, then Serper", async () => {
    const both = await researchWorld({
      steps: [search("a"), { text: REPORT }],
      keys: { TAVILY_API_KEY: "tav", SERPER_API_KEY: "ser" },
    })
    await start(both.client)
    expect(both.web.searches.map((s) => [s.provider, s.auth])).toEqual([
      ["tavily", "Bearer tav"],
    ])

    const perplexity = await researchWorld({
      steps: [search("b"), { text: REPORT }],
      keys: { PERPLEXITY_API_KEY: "per", SERPER_API_KEY: "ser" },
    })
    await start(perplexity.client)
    expect(perplexity.web.searches.map((s) => [s.provider, s.auth])).toEqual([
      ["perplexity", "Bearer per"],
    ])

    const serper = await researchWorld({
      steps: [search("c"), { text: REPORT }],
      keys: { SERPER_API_KEY: "ser" },
    })
    const started = await start(serper.client)
    expect(serper.web.searches.map((s) => [s.provider, s.auth])).toEqual([
      ["serper", "ser"],
    ])
    expect(
      (await get(serper.client, started.data!.id)).activity[0]
    ).toMatchObject({
      kind: "search",
      results: 2,
    })
  })

  it("refuses to start without a search provider, and keeps nothing", async () => {
    const world = await researchWorld({ keys: {} })

    const result = await start(world.client)

    expect(result.code).toBe("SERVICE_UNAVAILABLE")
    expect(world.workflows.calls).toHaveLength(0)
    expect(
      (await trpcQuery<SessionRow[]>(world.client, "research.list")).data
    ).toEqual([])
  })

  it("stops searching after 4 searches and 4 sources", async () => {
    const many = (name: "webSearch" | "readSource", n: number): ChatStep => ({
      calls: Array.from({ length: n }, (_, i) => ({
        name,
        args:
          name === "webSearch"
            ? { query: `query ${i}` }
            : { url: `https://example.com/${i}`, reason: "read" },
      })),
    })
    const world = await researchWorld({
      steps: [many("webSearch", 6), many("readSource", 6), { text: REPORT }],
    })

    const started = await start(world.client)
    const session = await get(world.client, started.data!.id)

    expect(world.web.searches).toHaveLength(4)
    expect(world.web.pages).toHaveLength(4)
    expect(session.status).toBe("completed")
    expect(session.activity.filter((a) => a.kind === "search")).toHaveLength(4)
    expect(session.sources).toHaveLength(4)
  })

  it("will not read local, private or non-web addresses", async () => {
    const refused = [
      "file:///etc/passwd",
      "ftp://example.com/file",
      "http://localhost/admin",
      "http://foo.localhost/",
      "http://127.0.0.1:8080/",
      "http://2130706433/", // 127.0.0.1 written as one number
      "http://0.0.0.0/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://192.168.1.1/",
      "http://100.64.0.1/",
      "http://[::1]/",
      "http://intranet.local/",
      "http://app.internal/",
      "http://user:secret@example.com/",
    ]
    // A run may read 4 pages, so each group of 4 is its own run.
    const groups = Array.from({ length: refused.length / 4 }, (_, i) =>
      refused.slice(i * 4, i * 4 + 4)
    )
    const world = await researchWorld({
      steps: groups.flatMap((urls): ChatStep[] => [
        {
          calls: urls.map((url) => ({
            name: "readSource",
            args: { url, reason: "x" },
          })),
        },
        { text: REPORT },
      ]),
    })

    for (const urls of groups) {
      const started = await start(world.client)
      const session = await get(world.client, started.data!.id)
      expect(session.activity.map((a) => a.kind === "read" && a.url)).toEqual(
        urls
      )
      expect(session.activity.every((a) => a.kind === "read" && !a.ok)).toBe(
        true
      )
      expect(session.sources).toEqual([])
    }
    expect(world.web.pages).toEqual([])
  })

  it("fails with an explanation when the model writes no report", async () => {
    const world = await researchWorld({ steps: [search("q"), { text: "hi" }] })

    const started = await start(world.client)
    const session = await get(world.client, started.data!.id)

    expect(session.status).toBe("failed")
    expect(session.report).toMatch(/finished without producing a report/)
  })

  it("fails and keeps the reason when the model is down", async () => {
    const world = await researchWorldDown()

    const started = await start(world.client)
    const session = await get(world.client, started.data!.id)

    expect(session.status).toBe("failed")
    expect(session.report).toBeTruthy()
    expect(session.completedAt).toBeTruthy()
  })

  it("reports a run that never finished as failed after half an hour", async () => {
    const world = await researchWorld()
    world.workflows.autoRun = false
    vi.useFakeTimers({ toFake: ["Date"] })
    const created = Date.UTC(2026, 8, 21, 12, 0, 0)
    vi.setSystemTime(created)

    const started = await start(world.client)
    expect((await get(world.client, started.data!.id)).status).toBe(
      "in_progress"
    )

    vi.setSystemTime(created + 31 * 60 * 1000)
    const later = await get(world.client, started.data!.id)
    expect(later.status).toBe("failed")
    expect(later.report).toMatch(/did not finish/)
  })

  it("only takes a topic that is not empty and not too long", async () => {
    const world = await researchWorld()

    for (const topic of ["   ", "x".repeat(4001)]) {
      expect((await start(world.client, { topic })).code).toBe("BAD_REQUEST")
    }
    expect((await start(world.client, { depth: "extreme" })).code).toBe(
      "BAD_REQUEST"
    )
    expect(world.workflows.calls).toHaveLength(0)
  })

  it("allows 10 runs an hour, then again once the hour has passed", async () => {
    const world = await researchWorld({
      steps: Array(20).fill({ text: REPORT }),
    })
    vi.useFakeTimers({ toFake: ["Date"] })
    const first = Date.UTC(2026, 8, 21, 12, 0, 0)
    vi.setSystemTime(first)

    for (let i = 0; i < 10; i++) {
      expect((await start(world.client)).code).toBeUndefined()
    }
    const over = await start(world.client)
    expect(over.code).toBe("TOO_MANY_REQUESTS")

    vi.setSystemTime(first + 61 * 60 * 1000)
    expect((await start(world.client)).code).toBeUndefined()
  })

  it("lists past runs newest first, without their reports", async () => {
    const world = await researchWorld({
      steps: [{ text: REPORT }, { text: REPORT }],
    })
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.UTC(2026, 8, 21, 9, 0, 0))
    await start(world.client, { topic: "First topic" })
    vi.setSystemTime(Date.UTC(2026, 8, 21, 10, 0, 0))
    await start(world.client, { topic: "Second topic" })

    const list = await trpcQuery<SessionRow[]>(world.client, "research.list")

    expect(list.data?.map((row) => row.topic)).toEqual([
      "Second topic",
      "First topic",
    ])
    expect(list.data?.[0]).not.toHaveProperty("report")
  })

  it("keeps each user's research private, and can delete a run", async () => {
    const world = await researchWorld({ steps: [{ text: REPORT }] })
    const other = await world.newClient()
    const started = await start(world.client)
    const id = started.data!.id

    expect((await trpcQuery(other, "research.get", { id })).code).toBe(
      "NOT_FOUND"
    )
    expect((await trpcMutation(other, "research.remove", { id })).code).toBe(
      "NOT_FOUND"
    )
    expect(
      (await trpcQuery<SessionRow[]>(other, "research.list")).data
    ).toEqual([])
    const anonymous = new TestClient()
    await anonymous.bootCsrf()
    expect((await trpcQuery(anonymous, "research.list")).code).toBe(
      "UNAUTHORIZED"
    )
    expect((await start(anonymous)).code).toBe("UNAUTHORIZED")

    expect(
      (await trpcMutation(world.client, "research.remove", { id })).code
    ).toBeUndefined()
    expect((await trpcQuery(world.client, "research.get", { id })).code).toBe(
      "NOT_FOUND"
    )
  })

  it("does nothing when a finished run is delivered again", async () => {
    const world = await researchWorld({
      steps: [search("q"), { text: REPORT }],
    })
    const started = await start(world.client)
    const before = await get(world.client, started.data!.id)
    const callsBefore = world.modelCalls().length

    await world.workflows.replay()

    expect(world.modelCalls()).toHaveLength(callsBefore)
    expect(await get(world.client, started.data!.id)).toEqual(before)
  })
})

/** A research world whose model always answers 500. */
async function researchWorldDown() {
  const world = await researchWorld()
  const failing: typeof fetch = async () =>
    new Response("model down", { status: 500 })
  ;(world.workflows.env as { AI_FETCH?: typeof fetch }).AI_FETCH = failing
  return world
}
