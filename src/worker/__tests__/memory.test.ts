import { describe, expect, it } from "vitest"
import { TestClient } from "../test/client"
import { memoryWorld } from "../test/fakes"
import { trpcMutation, trpcQuery } from "../test/helpers"

type Memory = {
  id: string
  layer: string
  title: string
  summary: string
  details: string | null
  tags: string[]
  attributes: Record<string, unknown>
  confidence: number | null
  sourceTopicId: string | null
}

type Persona = { persona: string; version: number } | null

const PREFERENCE = {
  title: "Prefers concise answers",
  summary: "The user always wants short, direct replies.",
  details: null,
  tags: ["style"],
  confidence: 0.9,
  attributes: { scope: "all conversations" },
}

async function newTopic(client: TestClient, agentId?: string): Promise<string> {
  const created = await trpcMutation<{ id: string }>(client, "topic.create", {
    ...(agentId ? { agentId } : {}),
  })
  return created.data!.id
}

/** Send one message and read the whole reply. */
async function say(
  client: TestClient,
  topicId: string,
  content: string
): Promise<string> {
  const response = await client.post(`/api/chat/topics/${topicId}/messages`, {
    csrf: true,
    json: { content },
  })
  expect(response.status).toBe(200)
  return response.text()
}

describe("memory extraction", () => {
  it("remembers a durable preference from a conversation and writes a persona", async () => {
    const world = await memoryWorld({
      gatekeeper: { preference: true },
      layers: { preference: { add: [PREFERENCE] } },
      persona: "Prefers short, direct answers.",
    })
    const topicId = await newTopic(world.client)

    const reply = await say(
      world.client,
      topicId,
      "From now on, please keep your answers short. I always want them concise."
    )

    expect(reply).toBe("ok")
    const memories = await trpcQuery<Memory[]>(world.client, "memory.list")
    expect(memories.data).toEqual([
      expect.objectContaining({
        layer: "preference",
        title: PREFERENCE.title,
        summary: PREFERENCE.summary,
        tags: ["style"],
        attributes: { scope: "all conversations" },
        confidence: 0.9,
        sourceTopicId: topicId,
      }),
    ])
    const persona = await trpcQuery<Persona>(world.client, "memory.persona")
    expect(persona.data).toMatchObject({
      persona: "Prefers short, direct answers.",
      version: 1,
    })
    expect(world.memoryVectors.vectors.size).toBe(1)
    // The gatekeeper saw the conversation it was asked to judge.
    expect(world.extractionCalls()[0].body.messages[1].content).toContain(
      "I always want them concise"
    )
  })
})

describe("using memory", () => {
  it("shapes a later, unrelated conversation with the persona and relevant memories", async () => {
    const world = await memoryWorld({
      gatekeeper: { preference: true },
      layers: { preference: { add: [PREFERENCE] } },
      persona: "Prefers short, direct answers.",
    })
    await say(
      world.client,
      await newTopic(world.client),
      "From now on, please keep your answers short. I always want them concise."
    )
    world.script.gatekeeper = {} // nothing further worth remembering
    const [memory] = (await trpcQuery<Memory[]>(world.client, "memory.list"))
      .data!
    const cook = await trpcMutation<{ id: string }>(
      world.client,
      "agent.create",
      {
        title: "Botanist",
      }
    )
    const topicId = await newTopic(world.client, cook.data!.id)

    await say(
      world.client,
      topicId,
      "Explain how photosynthesis works in a concise way"
    )

    const system = world.chatCalls().at(-1)!.body.messages[0].content as string
    expect(system).toContain("Prefers short, direct answers.")
    expect(system).toContain(
      `[preference] ${PREFERENCE.title}: ${PREFERENCE.summary}`
    )
    const loaded = await trpcQuery<{
      messages: Array<{ role: string; metadata: unknown }>
    }>(world.client, "topic.get", { id: topicId })
    expect(
      loaded.data!.messages.find((m) => m.role === "assistant")?.metadata
    ).toMatchObject({
      memories: [
        { id: memory.id, layer: "preference", title: PREFERENCE.title },
      ],
    })
  })

  it("adds nothing to the prompt for a user who has no memories", async () => {
    const world = await memoryWorld()

    await say(world.client, await newTopic(world.client), "Hello there")

    const system = world.chatCalls().at(-1)!.body.messages[0].content as string
    expect(system).not.toContain("What you know about the user")
  })
})

const LATER = "Explain how photosynthesis works in a concise way"

describe("memory extraction rules", () => {
  it("keeps nothing, and runs no layer extractor, when the gatekeeper finds nothing worth remembering", async () => {
    const world = await memoryWorld()

    await say(world.client, await newTopic(world.client), "Hi, how are you?")

    expect(
      (await trpcQuery<Memory[]>(world.client, "memory.list")).data
    ).toEqual([])
    expect(
      (await trpcQuery<Persona>(world.client, "memory.persona")).data
    ).toBeNull()
    expect(world.extractionCalls()).toHaveLength(1) // the gatekeeper alone
    expect(world.memoryVectors.vectors.size).toBe(0)
  })

  it("stops extracting and using memory when the user turns it off, and keeps what it has", async () => {
    const world = await memoryWorld({
      gatekeeper: { preference: true },
      layers: { preference: { add: [PREFERENCE] } },
      persona: "Prefers short, direct answers.",
    })
    const topicId = await newTopic(world.client)
    await say(world.client, topicId, "I always want concise answers.")
    const callsBefore = world.extractionCalls().length

    const off = await trpcMutation(world.client, "memory.setEnabled", {
      enabled: false,
    })
    await say(world.client, topicId, "Also, my name is Ada and I like tea.")
    await say(world.client, await newTopic(world.client), LATER)

    expect(off.response.status).toBe(200)
    expect(
      (await trpcQuery<{ enabled: boolean }>(world.client, "memory.settings"))
        .data
    ).toEqual({ enabled: false })
    expect(world.extractionCalls()).toHaveLength(callsBefore)
    const system = world.chatCalls().at(-1)!.body.messages[0].content as string
    expect(system).not.toContain("Prefers short, direct answers.")
    expect(
      (await trpcQuery<Memory[]>(world.client, "memory.list")).data
    ).toHaveLength(1)

    await trpcMutation(world.client, "memory.setEnabled", { enabled: true })
    await say(world.client, await newTopic(world.client), LATER)
    expect(
      world.chatCalls().at(-1)!.body.messages[0].content as string
    ).toContain("Prefers short, direct answers.")
  })

  it("still answers when extraction fails", async () => {
    const world = await memoryWorld({
      gatekeeper: { preference: true },
      layers: { preference: { add: [PREFERENCE] } },
    })
    world.script.failExtraction = true

    const reply = await say(
      world.client,
      await newTopic(world.client),
      "I always want concise answers."
    )

    expect(reply).toBe("ok")
    expect(
      (await trpcQuery<Memory[]>(world.client, "memory.list")).data
    ).toEqual([])
  })

  it("does not duplicate memories when a retried workflow sees the same messages", async () => {
    const world = await memoryWorld({
      gatekeeper: { preference: true },
      layers: { preference: { add: [PREFERENCE] } },
      persona: "Prefers short, direct answers.",
    })
    await say(
      world.client,
      await newTopic(world.client),
      "I always want concise answers."
    )
    const callsBefore = world.extractionCalls().length

    await world.workflows.replay()

    expect(
      (await trpcQuery<Memory[]>(world.client, "memory.list")).data
    ).toHaveLength(1)
    expect(world.extractionCalls()).toHaveLength(callsBefore)
    expect(world.memoryVectors.vectors.size).toBe(1)
  })

  it("updates and retracts the memories it was shown, and ignores ids it was not", async () => {
    const world = await memoryWorld({
      gatekeeper: { preference: true },
      layers: { preference: { add: [PREFERENCE] } },
      persona: "Prefers short, direct answers.",
    })
    const other = await world.newClient() // someone else's memory must stay untouched
    await say(other, await newTopic(other), "I always want verbose answers.")
    const [theirs] = (await trpcQuery<Memory[]>(other, "memory.list")).data!
    const topicId = await newTopic(world.client)
    await say(world.client, topicId, "I always want concise answers.")
    const mine = (
      await trpcQuery<Memory[]>(world.client, "memory.list")
    ).data!.find((m) => m.sourceTopicId === topicId)!

    world.script.layers = {
      preference: {
        update: [
          { id: mine.id, summary: "Wants answers under three sentences." },
          { id: theirs.id, summary: "Hijacked." },
          { id: "no-such-memory", summary: "Nothing." },
        ],
      },
    }
    world.script.persona = "Wants answers under three sentences."
    await say(world.client, topicId, "Actually, keep it under three sentences.")

    const afterUpdate = (await trpcQuery<Memory[]>(world.client, "memory.list"))
      .data!
    expect(afterUpdate.find((m) => m.id === mine.id)?.summary).toBe(
      "Wants answers under three sentences."
    )
    expect(afterUpdate.find((m) => m.id === mine.id)?.title).toBe(
      PREFERENCE.title
    )
    expect(
      (await trpcQuery<Memory[]>(other, "memory.list")).data![0].summary
    ).toBe(PREFERENCE.summary)
    expect(
      (await trpcQuery<Persona>(world.client, "memory.persona")).data
    ).toMatchObject({
      persona: "Wants answers under three sentences.",
      version: 2,
    })

    world.script.layers = {
      preference: {
        remove: [{ id: mine.id, reason: "The user asked to forget it" }],
      },
    }
    await say(world.client, topicId, "Please forget that preference.")

    expect(
      (await trpcQuery<Memory[]>(world.client, "memory.list")).data
    ).toEqual([])
    expect(world.memoryVectors.vectors.has(mine.id)).toBe(false)
    expect(world.memoryVectors.vectors.has(theirs.id)).toBe(true)
  })
})

describe("managing memory", () => {
  const IDENTITY = {
    title: "Botanist",
    summary: "The user works as a botanist studying alpine plants.",
    tags: ["work"],
  }

  async function withTwoMemories() {
    const world = await memoryWorld({
      gatekeeper: { preference: true, identity: true },
      layers: {
        preference: { add: [PREFERENCE] },
        identity: { add: [IDENTITY] },
      },
      persona: "A botanist who prefers short answers.",
    })
    await say(
      world.client,
      await newTopic(world.client),
      "I am a botanist and I always want concise answers."
    )
    return world
  }

  it("lists memories by layer, edits one and deletes one, keeping the index in step", async () => {
    const world = await withTwoMemories()
    const all = (await trpcQuery<Memory[]>(world.client, "memory.list")).data!
    const identity = (
      await trpcQuery<Memory[]>(world.client, "memory.list", {
        layer: "identity",
      })
    ).data!
    const target = all.find((m) => m.layer === "identity")!
    const before = world.memoryVectors.vectors.get(target.id)!.values

    const edited = await trpcMutation<Memory>(world.client, "memory.update", {
      id: target.id,
      title: "Alpine botanist",
      summary: "Studies glacier-foreland vegetation.",
    })
    const removed = await trpcMutation(world.client, "memory.remove", {
      id: all.find((m) => m.layer === "preference")!.id,
    })

    expect(all).toHaveLength(2)
    expect(identity.map((m) => m.title)).toEqual(["Botanist"])
    expect(edited.data).toMatchObject({
      title: "Alpine botanist",
      summary: "Studies glacier-foreland vegetation.",
      layer: "identity",
    })
    expect(world.memoryVectors.vectors.get(target.id)!.values).not.toEqual(
      before
    )
    expect(removed.response.status).toBe(200)
    expect(
      (await trpcQuery<Memory[]>(world.client, "memory.list")).data
    ).toHaveLength(1)
    expect(world.memoryVectors.vectors.size).toBe(1)
  })

  it("forgets everything on request, persona included", async () => {
    const world = await withTwoMemories()

    const cleared = await trpcMutation(world.client, "memory.clear", {})

    expect(cleared.response.status).toBe(200)
    expect(
      (await trpcQuery<Memory[]>(world.client, "memory.list")).data
    ).toEqual([])
    expect(
      (await trpcQuery<Persona>(world.client, "memory.persona")).data
    ).toBeNull()
    expect(world.memoryVectors.vectors.size).toBe(0)
  })

  it("keeps memory private to its owner, in the API and in the prompt", async () => {
    const world = await withTwoMemories()
    world.script.gatekeeper = {} // the outsider's own chats must not extract
    const outsider = await world.newClient()
    const [mine] = (await trpcQuery<Memory[]>(world.client, "memory.list"))
      .data!

    const update = await trpcMutation(outsider, "memory.update", {
      id: mine.id,
      title: "Hijacked",
    })
    const remove = await trpcMutation(outsider, "memory.remove", {
      id: mine.id,
    })
    await trpcMutation(outsider, "memory.clear", {})
    await say(outsider, await newTopic(outsider), LATER)

    expect([update.code, remove.code]).toEqual(["NOT_FOUND", "NOT_FOUND"])
    expect((await trpcQuery<Memory[]>(outsider, "memory.list")).data).toEqual(
      []
    )
    expect(
      (await trpcQuery<Memory[]>(world.client, "memory.list")).data
    ).toHaveLength(2)
    const system = world.chatCalls().at(-1)!.body.messages[0].content as string
    expect(system).not.toContain("botanist")
    expect(system).not.toContain(PREFERENCE.title)
  })

  it("requires authentication", async () => {
    const anonymous = new TestClient()
    await anonymous.bootCsrf()

    expect((await trpcQuery(anonymous, "memory.list")).code).toBe(
      "UNAUTHORIZED"
    )
    expect((await trpcMutation(anonymous, "memory.clear", {})).code).toBe(
      "UNAUTHORIZED"
    )
  })
})
