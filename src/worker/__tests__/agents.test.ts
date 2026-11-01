import { describe, expect, it } from "vitest"
import { TestClient } from "../test/client"
import {
  signedInClient,
  trpcMutation,
  trpcQuery,
  workersAiStream,
} from "../test/helpers"

const GEMMA = "@cf/google/gemma-4-26b-a4b-it"

type Agent = {
  id: string
  slug: string | null
  title: string | null
  description: string | null
  tags: string[]
  avatar: string | null
  backgroundColor: string | null
  systemRole: string | null
  model: string | null
  params: { temperature?: number; topP?: number; maxTokens?: number }
  chatConfig: { historyCount?: number }
  openingMessage: string | null
  openingQuestions: string[]
  pinned: boolean
  virtual: boolean
}

async function createAgent(
  client: TestClient,
  input: Record<string, unknown> = {}
): Promise<Agent> {
  const created = await trpcMutation<Agent>(client, "agent.create", input)
  expect(created.response.status).toBe(200)
  return created.data!
}

describe("agents", () => {
  it("gives every user a 'Just Chat' default agent, created on first use", async () => {
    const alice = await signedInClient()
    const bob = await signedInClient()

    const first = await trpcQuery<Agent>(alice, "agent.inbox")
    const second = await trpcQuery<Agent>(alice, "agent.inbox")
    const other = await trpcQuery<Agent>(bob, "agent.inbox")

    expect(first.data).toMatchObject({
      slug: "inbox",
      title: "Just Chat",
      virtual: true,
      pinned: false,
    })
    expect(second.data?.id).toBe(first.data?.id)
    expect(other.data?.id).not.toBe(first.data?.id)
    const list = await trpcQuery<Agent[]>(alice, "agent.list")
    expect(list.data?.map((agent) => agent.id)).toEqual([first.data?.id])
  })

  it("creates an agent with a persona, model and parameters", async () => {
    const client = await signedInClient()

    const agent = await createAgent(client, {
      title: "Code reviewer",
      description: "Reviews diffs",
      avatar: "🧐",
      backgroundColor: "#29b99f",
      tags: ["code", "review"],
      systemRole: "You review code. Be direct.",
      model: GEMMA,
      params: { temperature: 0.2, topP: 0.9, maxTokens: 1024 },
      chatConfig: { historyCount: 6 },
      openingMessage: "Paste a diff.",
      openingQuestions: ["Review this function", "Find the bug"],
    })

    expect(agent).toMatchObject({
      title: "Code reviewer",
      description: "Reviews diffs",
      avatar: "🧐",
      backgroundColor: "#29b99f",
      tags: ["code", "review"],
      systemRole: "You review code. Be direct.",
      model: GEMMA,
      params: { temperature: 0.2, topP: 0.9, maxTokens: 1024 },
      chatConfig: { historyCount: 6 },
      openingMessage: "Paste a diff.",
      openingQuestions: ["Review this function", "Find the bug"],
      virtual: false,
      pinned: false,
    })
    const loaded = await trpcQuery<Agent>(client, "agent.get", { id: agent.id })
    expect(loaded.data).toEqual(agent)
  })

  it("names an untitled agent and lists the default agent first, then pinned agents", async () => {
    const client = await signedInClient()
    const plain = await createAgent(client)
    const pinned = await createAgent(client, { title: "Pinned one" })
    await trpcMutation(client, "agent.update", { id: pinned.id, pinned: true })

    const list = await trpcQuery<Agent[]>(client, "agent.list")

    expect(plain.title).toBe("Untitled agent")
    expect(list.data?.map((agent) => agent.title)).toEqual([
      "Just Chat",
      "Pinned one",
      "Untitled agent",
    ])
  })

  it("updates an agent and validates the model and sampling parameters", async () => {
    const client = await signedInClient()
    const agent = await createAgent(client, { title: "Draft" })

    const updated = await trpcMutation<Agent>(client, "agent.update", {
      id: agent.id,
      title: "Final",
      systemRole: "Answer in haiku.",
      model: GEMMA,
      params: { temperature: 1.1 },
    })
    const badModel = await trpcMutation(client, "agent.update", {
      id: agent.id,
      model: "@cf/not-in-the-catalog",
    })
    const badTemperature = await trpcMutation(client, "agent.update", {
      id: agent.id,
      params: { temperature: 3 },
    })

    expect(updated.data).toMatchObject({
      title: "Final",
      systemRole: "Answer in haiku.",
      model: GEMMA,
      params: { temperature: 1.1 },
    })
    expect(badModel.response.status).toBe(400)
    expect(badTemperature.response.status).toBe(400)
  })

  it("removes an agent but never the default one", async () => {
    const client = await signedInClient()
    const agent = await createAgent(client, { title: "Temporary" })
    const inbox = (await trpcQuery<Agent>(client, "agent.inbox")).data!

    const removed = await trpcMutation(client, "agent.remove", { id: agent.id })
    const removeInbox = await trpcMutation(client, "agent.remove", {
      id: inbox.id,
    })

    expect(removed.response.status).toBe(200)
    expect(removeInbox.code).toBe("FORBIDDEN")
    const list = await trpcQuery<Agent[]>(client, "agent.list")
    expect(list.data?.map((item) => item.id)).toEqual([inbox.id])
  })

  it("keeps agents private to their owner", async () => {
    const owner = await signedInClient()
    const outsider = await signedInClient()
    const agent = await createAgent(owner, { title: "Private" })

    const read = await trpcQuery(outsider, "agent.get", { id: agent.id })
    const update = await trpcMutation(outsider, "agent.update", {
      id: agent.id,
      title: "Hijacked",
    })
    const remove = await trpcMutation(outsider, "agent.remove", {
      id: agent.id,
    })

    expect(read.code).toBe("NOT_FOUND")
    expect(update.code).toBe("NOT_FOUND")
    expect(remove.code).toBe("NOT_FOUND")
    const still = await trpcQuery<Agent>(owner, "agent.get", { id: agent.id })
    expect(still.data?.title).toBe("Private")
  })

  it("requires authentication", async () => {
    const anonymous = new TestClient()
    await anonymous.bootCsrf()

    const list = await trpcQuery(anonymous, "agent.list")

    expect(list.code).toBe("UNAUTHORIZED")
  })
})

type OutboundChat = {
  model: string
  temperature?: number
  top_p?: number
  max_tokens?: number
  messages: Array<{ role: string; content: string }>
}

type TopicRow = { id: string; agent_id: string | null; model: string | null }

/** A client whose Workers AI fake records each chat request and answers R1, R2… */
async function recordingClient() {
  const outbound: OutboundChat[] = []
  const client = await signedInClient(async (input, init) => {
    outbound.push((await new Request(input, init).json()) as OutboundChat)
    return workersAiStream(`R${outbound.length}`)
  })
  return { client, outbound }
}

async function send(
  client: TestClient,
  topicId: string,
  content: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const response = await client.post(`/api/chat/topics/${topicId}/messages`, {
    csrf: true,
    json: { content, ...extra },
  })
  expect(response.status).toBe(200)
  return response.text()
}

describe("chatting with an agent", () => {
  it("applies the agent's persona, model and sampling parameters to the turn", async () => {
    const { client, outbound } = await recordingClient()
    const agent = await createAgent(client, {
      title: "Pirate",
      systemRole: "You are a pirate. Answer in one line.",
      model: GEMMA,
      params: { temperature: 0.2, topP: 0.9, maxTokens: 512 },
    })
    const topic = await trpcMutation<TopicRow>(client, "topic.create", {
      agentId: agent.id,
    })

    // No model in the request: the topic inherits the agent's.
    expect(topic.data).toMatchObject({ agent_id: agent.id, model: GEMMA })
    expect(await send(client, topic.data!.id, "Ahoy?")).toBe("R1")

    expect(outbound[0]).toMatchObject({
      model: GEMMA,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 512,
    })
    expect(outbound[0].messages).toEqual([
      { role: "system", content: "You are a pirate. Answer in one line." },
      { role: "user", content: "Ahoy?" },
    ])
  })

  it("falls back to the OpenChat prompt when the agent has no persona", async () => {
    const { client, outbound } = await recordingClient()
    const topic = await trpcMutation<TopicRow>(client, "topic.create", {})

    await send(client, topic.data!.id, "Hello")

    expect(outbound[0].messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("OpenChat"),
    })
  })

  it("sends only the last N messages when the agent limits history", async () => {
    const { client, outbound } = await recordingClient()
    const agent = await createAgent(client, {
      title: "Forgetful",
      chatConfig: { historyCount: 2 },
    })
    const topic = await trpcMutation<TopicRow>(client, "topic.create", {
      agentId: agent.id,
    })

    await send(client, topic.data!.id, "first")
    await send(client, topic.data!.id, "second")
    await send(client, topic.data!.id, "third")

    expect(outbound[2].messages.filter((m) => m.role !== "system")).toEqual([
      { role: "assistant", content: "R2" },
      { role: "user", content: "third" },
    ])
  })

  it("nests topics under agents and files un-nested ones under the default agent", async () => {
    const client = await signedInClient()
    const inbox = (await trpcQuery<Agent>(client, "agent.inbox")).data!
    const coder = await createAgent(client, { title: "Coder" })
    const inInbox = await trpcMutation<TopicRow>(client, "topic.create", {})
    const inCoder = await trpcMutation<TopicRow>(client, "topic.create", {
      agentId: coder.id,
    })

    const inboxTopics = await trpcQuery<TopicRow[]>(client, "topic.list", {
      agentId: inbox.id,
    })
    const coderTopics = await trpcQuery<TopicRow[]>(client, "topic.list", {
      agentId: coder.id,
    })
    const everything = await trpcQuery<TopicRow[]>(client, "topic.list")

    expect(inInbox.data?.agent_id).toBe(inbox.id)
    expect(inboxTopics.data?.map((t) => t.id)).toEqual([inInbox.data?.id])
    expect(coderTopics.data?.map((t) => t.id)).toEqual([inCoder.data?.id])
    expect(everything.data).toHaveLength(2)
  })

  it("does not let a topic be created under someone else's agent", async () => {
    const owner = await signedInClient()
    const outsider = await signedInClient()
    const agent = await createAgent(owner, { title: "Private" })

    const stolen = await trpcMutation(outsider, "topic.create", {
      agentId: agent.id,
    })

    expect(stolen.code).toBe("NOT_FOUND")
  })

  it("deletes an agent's topics with it", async () => {
    const client = await signedInClient()
    const agent = await createAgent(client, { title: "Short-lived" })
    const topic = await trpcMutation<TopicRow>(client, "topic.create", {
      agentId: agent.id,
    })

    await trpcMutation(client, "agent.remove", { id: agent.id })

    const gone = await trpcQuery(client, "topic.get", { id: topic.data!.id })
    expect(gone.code).toBe("NOT_FOUND")
  })
})
