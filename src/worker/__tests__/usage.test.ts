import { afterEach, describe, expect, it, vi } from "vitest"
import { TestClient } from "../test/client"
import { fakeWorkersAi, goalWorld, sandboxWorld } from "../test/fakes"
import {
  MODEL,
  signedInClient,
  trpcMutation,
  trpcQuery,
  usageStream,
  workersAiStream,
  type TokenUsage,
} from "../test/helpers"

const GEMMA = "@cf/google/gemma-4-26b-a4b-it"
const TOOL_MODEL = "@cf/openai/gpt-oss-120b"

type Overview = {
  messages: number
  userMessages: number
  assistantMessages: number
  topics: number
  agents: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  repliesWithUsage: number
}
type ModelRow = {
  model: string | null
  replies: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}
type AgentRow = {
  agentId: string | null
  title: string | null
  replies: number
  totalTokens: number
}
type TopicRow = {
  id: string
  title: string
  agentId: string | null
  messages: number
  totalTokens: number
}
type Day = {
  date: string
  userMessages: number
  assistantMessages: number
  totalTokens: number
}

/** A signed-in client whose model reports the given usage, per model id. */
async function usageWorld(usageByModel: Record<string, TokenUsage | null>) {
  const ai = fakeWorkersAi({
    chat: (body) => {
      if (!body.stream) return undefined
      const usage = usageByModel[body.model]
      return usage ? usageStream(usage, "reply") : workersAiStream("reply")
    },
  })
  return { ai, client: await signedInClient(ai.fetch) }
}

async function chat(
  client: TestClient,
  input: { agentId?: string; model?: string } = {},
  messages = 1
): Promise<string> {
  const created = await trpcMutation<{ id: string }>(client, "topic.create", {
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.model ? { model: input.model } : {}),
  })
  const topicId = created.data!.id
  for (let i = 0; i < messages; i++) {
    const response = await client.post(`/api/chat/topics/${topicId}/messages`, {
      csrf: true,
      json: { content: `Question ${i + 1}` },
    })
    expect(response.status).toBe(200)
    await response.text()
  }
  return topicId
}

const overview = (client: TestClient, range = "all") =>
  trpcQuery<Overview>(client, "usage.overview", { range }).then((r) => r.data!)

afterEach(() => vi.useRealTimers())

describe("usage statistics", () => {
  it("reports the messages and tokens that were actually sent and received", async () => {
    const { client } = await usageWorld({
      [MODEL]: { input: 10, output: 5 },
      [GEMMA]: { input: 20, output: 8 },
    })
    const coder = await trpcMutation<{ id: string }>(client, "agent.create", {
      title: "Coder",
      model: GEMMA,
    })
    await chat(client, {}, 2) // two turns with the default model
    await chat(client, { agentId: coder.data!.id }) // one turn with Gemma

    expect(await overview(client)).toEqual({
      messages: 6,
      userMessages: 3,
      assistantMessages: 3,
      topics: 2,
      agents: 2,
      inputTokens: 40,
      outputTokens: 18,
      totalTokens: 58,
      repliesWithUsage: 3,
    })
  })

  it("ranks models and agents by the tokens they used", async () => {
    const { client } = await usageWorld({
      [MODEL]: { input: 10, output: 5 },
      [GEMMA]: { input: 20, output: 8 },
    })
    const coder = await trpcMutation<{ id: string }>(client, "agent.create", {
      title: "Coder",
      model: GEMMA,
    })
    await chat(client, {}, 2)
    await chat(client, { agentId: coder.data!.id })

    const models = await trpcQuery<ModelRow[]>(client, "usage.byModel", {
      range: "all",
    })
    const agents = await trpcQuery<AgentRow[]>(client, "usage.byAgent", {
      range: "all",
    })

    expect(models.data).toEqual([
      {
        model: MODEL,
        replies: 2,
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
      },
      {
        model: GEMMA,
        replies: 1,
        inputTokens: 20,
        outputTokens: 8,
        totalTokens: 28,
      },
    ])
    expect(agents.data).toEqual([
      expect.objectContaining({
        title: "Just Chat",
        replies: 2,
        totalTokens: 30,
      }),
      expect.objectContaining({ title: "Coder", replies: 1, totalTokens: 28 }),
    ])
  })

  it("ranks conversations by how many messages they hold, most active first", async () => {
    const { client } = await usageWorld({ [MODEL]: { input: 10, output: 5 } })
    const quiet = await chat(client)
    const busy = await chat(client, {}, 3)

    const ranked = await trpcQuery<TopicRow[]>(client, "usage.byTopic", {
      range: "all",
    })

    expect(ranked.data).toEqual([
      expect.objectContaining({ id: busy, messages: 6, totalTokens: 45 }),
      expect.objectContaining({ id: quiet, messages: 2, totalTokens: 15 }),
    ])
    expect(typeof ranked.data?.[0].title).toBe("string")
  })

  it("counts a reply whose provider reported no usage as a reply with no tokens", async () => {
    const { client } = await usageWorld({ [MODEL]: null })
    await chat(client, {}, 2)

    expect(await overview(client)).toMatchObject({
      assistantMessages: 2,
      totalTokens: 0,
      repliesWithUsage: 0,
    })
  })

  it("adds up every model call of a turn that used tools, not only the last", async () => {
    const world = await sandboxWorld({
      steps: [
        { calls: [{ name: "runCommand", args: { command: "true" } }] },
        { text: "Done." },
      ],
    })
    const agent = await trpcMutation<{ id: string }>(
      world.client,
      "agent.create",
      {
        title: "Coder",
        model: TOOL_MODEL,
        chatConfig: { sandbox: true },
      }
    )

    await chat(world.client, { agentId: agent.data!.id })

    // Two calls at 10 in / 5 out each.
    expect(await overview(world.client)).toMatchObject({
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    })
  })

  it("counts what goal tasks use", async () => {
    const world = await goalWorld({
      plans: [
        {
          action: "tasks",
          reason: "One task",
          tasks: [{ title: "Do it", description: "Do the thing." }],
        },
      ],
    })
    const goal = await trpcMutation<{ id: string }>(
      world.client,
      "goal.create",
      {
        title: "Get it done",
      }
    )
    await trpcMutation(world.client, "goal.start", { id: goal.data!.id })

    // The task's completion reported 1 in / 1 out; it appears in the totals.
    const totals = await overview(world.client)
    expect(totals.inputTokens).toBe(1)
    expect(totals.outputTokens).toBe(1)
    expect(totals.repliesWithUsage).toBe(1)
    expect(totals.topics).toBe(0) // its workspace is not a conversation
    // The task's workspace is not a chat, so it is not a ranked conversation.
    const ranked = await trpcQuery<TopicRow[]>(world.client, "usage.byTopic", {
      range: "all",
    })
    expect(ranked.data).toEqual([])
  })

  it("keeps each user's statistics to themselves and needs a sign-in", async () => {
    const { ai, client } = await usageWorld({
      [MODEL]: { input: 10, output: 5 },
    })
    const outsider = await signedInClient(ai.fetch)
    await chat(client)

    expect(await overview(outsider)).toMatchObject({
      messages: 0,
      totalTokens: 0,
    })
    expect(
      (await trpcQuery<ModelRow[]>(outsider, "usage.byModel", { range: "all" }))
        .data
    ).toEqual([])
    expect(
      (await trpcQuery<TopicRow[]>(outsider, "usage.byTopic", { range: "all" }))
        .data
    ).toEqual([])
    const anonymous = new TestClient()
    await anonymous.bootCsrf()
    expect(
      (await trpcQuery(anonymous, "usage.overview", { range: "all" })).code
    ).toBe("UNAUTHORIZED")
    expect(
      (await trpcQuery(client, "usage.overview", { range: "forever" })).response
        .status
    ).toBe(400)
  })
})

describe("usage over time", () => {
  const DAY = 24 * 60 * 60 * 1000

  /** Send one chat as if it were `daysAgo` days before `now`. */
  async function chatAt(client: TestClient, now: number, daysAgo: number) {
    vi.setSystemTime(now - daysAgo * DAY)
    await chat(client)
    vi.setSystemTime(now)
  }

  it("limits the totals to the chosen range", async () => {
    const { client } = await usageWorld({ [MODEL]: { input: 10, output: 5 } })
    vi.useFakeTimers({ toFake: ["Date"] })
    const now = Date.UTC(2026, 8, 21, 12, 0, 0)
    vi.setSystemTime(now)

    await chatAt(client, now, 40)
    await chatAt(client, now, 3)
    await chatAt(client, now, 0)

    expect((await overview(client, "7d")).messages).toBe(4)
    expect((await overview(client, "30d")).messages).toBe(4)
    expect((await overview(client, "90d")).messages).toBe(6)
    expect((await overview(client, "all")).messages).toBe(6)
    expect((await overview(client, "7d")).totalTokens).toBe(30)
  })

  it("gives one entry per day of the range, empty days included", async () => {
    const { client } = await usageWorld({ [MODEL]: { input: 10, output: 5 } })
    vi.useFakeTimers({ toFake: ["Date"] })
    const now = Date.UTC(2026, 8, 21, 12, 0, 0)
    vi.setSystemTime(now)
    await chatAt(client, now, 3)
    await chatAt(client, now, 0)

    const daily = await trpcQuery<Day[]>(client, "usage.daily", { range: "7d" })

    expect(daily.data?.map((day) => day.date)).toEqual([
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
    ])
    const busy = { userMessages: 1, assistantMessages: 1, totalTokens: 15 }
    expect(daily.data?.filter((day) => day.userMessages > 0)).toEqual([
      { date: "2026-09-18", ...busy },
      { date: "2026-09-21", ...busy },
    ])
    expect(daily.data?.find((day) => day.date === "2026-09-19")).toEqual({
      date: "2026-09-19",
      userMessages: 0,
      assistantMessages: 0,
      totalTokens: 0,
    })
  })

  it("buckets days in the user's own timezone", async () => {
    const { client } = await usageWorld({ [MODEL]: { input: 10, output: 5 } })
    vi.useFakeTimers({ toFake: ["Date"] })
    const lateEvening = Date.UTC(2026, 8, 20, 23, 30, 0) // 23:30 UTC
    vi.setSystemTime(lateEvening)
    await chat(client)

    const utc = await trpcQuery<Day[]>(client, "usage.daily", { range: "7d" })
    const plus2h = await trpcQuery<Day[]>(client, "usage.daily", {
      range: "7d",
      tzOffsetMinutes: 120,
    })

    const activeDay = (days?: Day[]) =>
      days?.find((d) => d.userMessages > 0)?.date
    expect(activeDay(utc.data)).toBe("2026-09-20")
    expect(activeDay(plus2h.data)).toBe("2026-09-21") // already past midnight there
    expect(plus2h.data?.at(-1)?.date).toBe("2026-09-21")
  })
})
