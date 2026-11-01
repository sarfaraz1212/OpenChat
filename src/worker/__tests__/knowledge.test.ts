import { describe, expect, it } from "vitest"
import { TestClient } from "../test/client"
import { embeddingsResponse, knowledgeWorld, upload } from "../test/fakes"
import { trpcMutation, trpcQuery } from "../test/helpers"

type KnowledgeFile = {
  id: string
  name: string
  fileType: string
  size: number
  status: "pending" | "processing" | "ready" | "failed"
  error: string | null
  chunkCount: number
}

const HANDBOOK =
  "# Handbook\n\nRefunds are processed within fourteen days of the request."

async function uploaded(
  client: TestClient,
  name: string,
  content: string,
  type = "text/plain"
): Promise<KnowledgeFile> {
  const response = await upload(client, name, content, type)
  expect(response.status).toBe(201)
  return (await response.json()) as KnowledgeFile
}

describe("knowledge files", () => {
  it("stores an uploaded text file, indexes it, and lets its owner download it again", async () => {
    const { client, ai, vectors } = await knowledgeWorld()

    const file = await uploaded(
      client,
      "handbook.md",
      HANDBOOK,
      "text/markdown"
    )

    expect(file).toMatchObject({
      name: "handbook.md",
      fileType: "text/markdown",
      size: new TextEncoder().encode(HANDBOOK).length,
      status: "ready",
      error: null,
      chunkCount: 1,
    })
    // Embedded through the Workers AI wrapper with the server's credentials.
    expect(ai.embeddings()).toHaveLength(1)
    expect(ai.embeddings()[0]).toMatchObject({
      url: "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/embeddings",
      authorization: "Bearer test-token",
      body: { model: "@cf/baai/bge-m3", input: [HANDBOOK] },
    })
    expect(vectors.vectors.size).toBe(1)

    const download = await client.get(`/api/files/${file.id}/content`)
    expect(download.status).toBe(200)
    expect(download.headers.get("content-type")).toContain("text/markdown")
    expect(await download.text()).toBe(HANDBOOK)
    const list = await trpcQuery<KnowledgeFile[]>(client, "file.list")
    expect(list.data).toEqual([file])
  })

  it("splits a long document into several indexed chunks", async () => {
    const { client, vectors } = await knowledgeWorld()
    const paragraph = (n: number) =>
      `Section ${n}. ${"Cloudflare Workers run code at the edge. ".repeat(12)}`
    const longText = [1, 2, 3, 4, 5, 6].map(paragraph).join("\n\n")

    const file = await uploaded(client, "long.txt", longText)

    expect(file.status).toBe("ready")
    expect(file.chunkCount).toBeGreaterThan(2)
    expect(vectors.vectors.size).toBe(file.chunkCount)
  })

  it("refuses files it cannot read, stores nothing and calls no model", async () => {
    const { client, ai, vectors } = await knowledgeWorld()

    const pdf = await upload(client, "scan.pdf", "%PDF-1.4", "application/pdf")
    const empty = await upload(client, "blank.txt", "   \n  ")
    const huge = await upload(client, "huge.txt", "a".repeat(1_048_577))
    const noFile = await client.post("/api/files", {
      csrf: true,
      form: new FormData(),
    })

    expect(pdf.status).toBe(415)
    expect(await pdf.json()).toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" })
    expect(empty.status).toBe(400)
    expect(huge.status).toBe(413)
    expect(noFile.status).toBe(400)
    expect(ai.calls).toHaveLength(0)
    expect(vectors.vectors.size).toBe(0)
    expect((await trpcQuery(client, "file.list")).data).toEqual([])
  })

  it("requires a signed-in user and a CSRF token to upload", async () => {
    const { client } = await knowledgeWorld()
    const anonymous = new TestClient()
    await anonymous.bootCsrf()

    const unauthenticated = await upload(anonymous, "a.txt", "hello world")
    const form = new FormData()
    form.set("file", new File(["hello world"], "a.txt", { type: "text/plain" }))
    const noCsrf = await client.post("/api/files", { form })

    expect(unauthenticated.status).toBe(401)
    expect(noCsrf.status).toBe(403)
  })

  it("keeps a file whose embedding failed, marked failed, with nothing indexed", async () => {
    const { client, vectors } = await knowledgeWorld({
      embeddings: () => new Response("upstream down", { status: 500 }),
    })

    const file = await uploaded(client, "handbook.md", HANDBOOK)

    expect(file).toMatchObject({ status: "failed", chunkCount: 0 })
    expect(file.error).toEqual(expect.any(String))
    expect(vectors.vectors.size).toBe(0)
    const list = await trpcQuery<KnowledgeFile[]>(client, "file.list")
    expect(list.data?.map((item) => item.status)).toEqual(["failed"])
  })

  it("deletes a file with its stored object and its vectors", async () => {
    const { client, vectors } = await knowledgeWorld()
    const file = await uploaded(client, "handbook.md", HANDBOOK)

    const removed = await trpcMutation(client, "file.remove", { id: file.id })

    expect(removed.response.status).toBe(200)
    expect(vectors.vectors.size).toBe(0)
    expect((await trpcQuery(client, "file.list")).data).toEqual([])
    expect((await client.get(`/api/files/${file.id}/content`)).status).toBe(404)
  })

  it("keeps files private to their owner", async () => {
    const { client: owner, newClient } = await knowledgeWorld()
    const outsider = await newClient()
    const file = await uploaded(
      owner,
      "secret.txt",
      "The launch code is swordfish."
    )

    const download = await outsider.get(`/api/files/${file.id}/content`)
    const read = await trpcQuery(outsider, "file.get", { id: file.id })
    const remove = await trpcMutation(outsider, "file.remove", { id: file.id })
    const list = await trpcQuery<KnowledgeFile[]>(outsider, "file.list")

    expect(download.status).toBe(404)
    expect(read.code).toBe("NOT_FOUND")
    expect(remove.code).toBe("NOT_FOUND")
    expect(list.data).toEqual([])
    expect(
      (await trpcQuery<KnowledgeFile[]>(owner, "file.list")).data
    ).toHaveLength(1)
  })
})

type Agent = { id: string }
type Turn = { text: string; system: string; messageId?: string }

async function agentFor(client: TestClient, title: string): Promise<Agent> {
  const created = await trpcMutation<Agent>(client, "agent.create", { title })
  return created.data!
}

async function attach(
  client: TestClient,
  agentId: string,
  fileIds: string[],
  knowledgeBaseIds: string[] = []
) {
  return trpcMutation(client, "agent.setKnowledge", {
    agentId,
    fileIds,
    knowledgeBaseIds,
  })
}

/** Ask an agent one question in a fresh topic. */
async function ask(
  client: TestClient,
  ai: Awaited<ReturnType<typeof knowledgeWorld>>["ai"],
  agentId: string,
  question: string
): Promise<Turn & { topicId: string }> {
  const topic = await trpcMutation<{ id: string }>(client, "topic.create", {
    agentId,
  })
  const before = ai.chat().length
  const reply = await client.post(
    `/api/chat/topics/${topic.data!.id}/messages`,
    {
      csrf: true,
      json: { content: question },
    }
  )
  expect(reply.status).toBe(200)
  const text = await reply.text()
  const call = ai.chat()[before]
  return {
    text,
    system: call.body.messages[0].content,
    topicId: topic.data!.id,
  }
}

const REFUNDS = "Refunds are processed within fourteen days of the request."
const SHIPPING =
  "Parcels ship from the Rotterdam warehouse every weekday morning."

describe("grounded chat", () => {
  it("puts the most relevant excerpt of an attached document in front of the model and records its source", async () => {
    const { client, ai } = await knowledgeWorld()
    const docs = [
      await uploaded(client, "refunds.md", REFUNDS),
      await uploaded(client, "shipping.md", SHIPPING),
      await uploaded(
        client,
        "returns.md",
        "Returned items must be unopened and dry."
      ),
      await uploaded(
        client,
        "hours.md",
        "The support desk answers questions between nine and five."
      ),
      await uploaded(
        client,
        "careers.md",
        "Engineers work remotely across many countries."
      ),
    ]
    const agent = await agentFor(client, "Support")
    await attach(
      client,
      agent.id,
      docs.map((doc) => doc.id)
    )

    const turn = await ask(client, ai, agent.id, "How long do refunds take?")

    expect(turn.system).toContain(REFUNDS)
    expect(turn.system).toContain("refunds.md")
    // Best match first, and no more than a handful of excerpts however many files.
    const marks = turn.system.match(/^\[\d+\] /gm) ?? []
    expect(marks.length).toBeGreaterThan(0)
    expect(marks.length).toBeLessThan(docs.length)
    expect(turn.system.indexOf(REFUNDS)).toBeLessThan(
      turn.system.indexOf("[2] ")
    )
    // The question was embedded to search with; the agent's own prompt is kept.
    expect(ai.embeddings().at(-1)?.body.input).toEqual([
      "How long do refunds take?",
    ])

    const loaded = await trpcQuery<{
      messages: Array<{ role: string; metadata: unknown }>
    }>(client, "topic.get", { id: turn.topicId })
    const assistant = loaded.data!.messages.find((m) => m.role === "assistant")
    const sources = (
      assistant?.metadata as {
        retrieval: Array<{ fileName: string; score: number }>
      }
    ).retrieval
    expect(sources[0].fileName).toBe("refunds.md")
    expect(sources.length).toBeLessThan(docs.length)
    expect(sources.map((source) => source.score)).toEqual(
      [...sources.map((source) => source.score)].sort((a, b) => b - a)
    )
  })

  it("uses no knowledge, and makes no embedding call, for an agent with nothing attached", async () => {
    const { client, ai } = await knowledgeWorld()
    await uploaded(client, "refunds.md", REFUNDS)
    const agent = await agentFor(client, "Plain")
    const embeddingsBefore = ai.embeddings().length

    const turn = await ask(client, ai, agent.id, "How long do refunds take?")

    expect(turn.system).not.toContain("fourteen days")
    expect(ai.embeddings()).toHaveLength(embeddingsBefore)
  })

  it("stops grounding once the document is detached or deleted", async () => {
    const { client, ai } = await knowledgeWorld()
    const doc = await uploaded(client, "refunds.md", REFUNDS)
    const other = await uploaded(client, "shipping.md", SHIPPING)
    const agent = await agentFor(client, "Support")

    await attach(client, agent.id, [doc.id, other.id])
    expect((await ask(client, ai, agent.id, "refunds?")).system).toContain(
      "fourteen days"
    )
    await attach(client, agent.id, [other.id])
    expect((await ask(client, ai, agent.id, "refunds?")).system).not.toContain(
      "fourteen days"
    )

    await attach(client, agent.id, [doc.id, other.id])
    await trpcMutation(client, "file.remove", { id: doc.id })
    expect((await ask(client, ai, agent.id, "refunds?")).system).not.toContain(
      "fourteen days"
    )
  })

  it("still answers, without excerpts, when the search itself fails", async () => {
    let searchDown = false
    const { client, ai } = await knowledgeWorld({
      embeddings: (input) =>
        searchDown
          ? new Response("upstream down", { status: 500 })
          : embeddingsResponse(input),
    })
    const doc = await uploaded(client, "refunds.md", REFUNDS)
    const agent = await agentFor(client, "Support")
    await attach(client, agent.id, [doc.id])
    searchDown = true

    const turn = await ask(client, ai, agent.id, "How long do refunds take?")

    expect(turn.text).toBe("ok")
    expect(turn.system).not.toContain("fourteen days")
  })

  it("ignores an attached file that failed to index, without searching", async () => {
    let embeddingsDown = true
    const { client, ai } = await knowledgeWorld({
      embeddings: (input) =>
        embeddingsDown
          ? new Response("upstream down", { status: 500 })
          : embeddingsResponse(input),
    })
    const broken = await uploaded(client, "broken.md", REFUNDS)
    expect(broken.status).toBe("failed")
    embeddingsDown = false
    const agent = await agentFor(client, "Support")
    await attach(client, agent.id, [broken.id])
    const embeddingsBefore = ai.embeddings().length

    const turn = await ask(client, ai, agent.id, "How long do refunds take?")

    expect(turn.text).toBe("ok")
    expect(turn.system).not.toContain("fourteen days")
    expect(ai.embeddings()).toHaveLength(embeddingsBefore)
  })

  it("lists what is attached and refuses files or agents that are not the caller's", async () => {
    const { client, newClient } = await knowledgeWorld()
    const outsider = await newClient()
    const mine = await uploaded(client, "mine.md", REFUNDS)
    const theirs = await uploaded(outsider, "theirs.md", SHIPPING)
    const agent = await agentFor(client, "Support")

    await attach(client, agent.id, [mine.id])
    const stolenFile = await attach(client, agent.id, [mine.id, theirs.id])
    const stolenAgent = await attach(outsider, agent.id, [theirs.id])
    const attached = await trpcQuery<{ files: KnowledgeFile[] }>(
      client,
      "agent.getKnowledge",
      { agentId: agent.id }
    )
    const peeking = await trpcQuery(outsider, "agent.getKnowledge", {
      agentId: agent.id,
    })

    expect(stolenFile.code).toBe("NOT_FOUND")
    expect(stolenAgent.code).toBe("NOT_FOUND")
    expect(peeking.code).toBe("NOT_FOUND")
    expect(attached.data?.files.map((file) => file.name)).toEqual(["mine.md"])
  })
})

type KnowledgeBase = {
  id: string
  name: string
  description: string | null
  fileCount: number
}

async function knowledgeBase(
  client: TestClient,
  input: Record<string, unknown>
): Promise<KnowledgeBase> {
  const created = await trpcMutation<KnowledgeBase>(
    client,
    "knowledgeBase.create",
    input
  )
  expect(created.response.status).toBe(200)
  return created.data!
}

describe("knowledge bases", () => {
  it("groups files under a name and keeps them when the group is deleted", async () => {
    const { client } = await knowledgeWorld()
    const refunds = await uploaded(client, "refunds.md", REFUNDS)
    const shipping = await uploaded(client, "shipping.md", SHIPPING)
    const base = await knowledgeBase(client, {
      name: "Support docs",
      description: "Everything support needs",
    })

    expect(base).toMatchObject({ name: "Support docs", fileCount: 0 })
    await trpcMutation(client, "knowledgeBase.addFiles", {
      id: base.id,
      fileIds: [refunds.id, shipping.id, refunds.id],
    })
    const loaded = await trpcQuery<KnowledgeBase & { files: KnowledgeFile[] }>(
      client,
      "knowledgeBase.get",
      { id: base.id }
    )
    await trpcMutation(client, "knowledgeBase.removeFile", {
      id: base.id,
      fileId: shipping.id,
    })
    const renamed = await trpcMutation<KnowledgeBase>(
      client,
      "knowledgeBase.update",
      { id: base.id, name: "Support handbook" }
    )
    await trpcMutation(client, "knowledgeBase.remove", { id: base.id })

    expect(loaded.data?.fileCount).toBe(2)
    expect(loaded.data?.files.map((file) => file.name).sort()).toEqual([
      "refunds.md",
      "shipping.md",
    ])
    expect(renamed.data).toMatchObject({
      name: "Support handbook",
      fileCount: 1,
    })
    expect((await trpcQuery(client, "knowledgeBase.list")).data).toEqual([])
    expect(
      (await trpcQuery<KnowledgeFile[]>(client, "file.list")).data
    ).toHaveLength(2)
  })

  it("grounds an agent in every file of an attached knowledge base, as it changes", async () => {
    const { client, ai } = await knowledgeWorld()
    const refunds = await uploaded(client, "refunds.md", REFUNDS)
    const base = await knowledgeBase(client, { name: "Support docs" })
    const agent = await agentFor(client, "Support")
    await attach(client, agent.id, [], [base.id])

    expect((await ask(client, ai, agent.id, "refunds?")).system).not.toContain(
      "fourteen days"
    )
    await trpcMutation(client, "knowledgeBase.addFiles", {
      id: base.id,
      fileIds: [refunds.id],
    })
    expect((await ask(client, ai, agent.id, "refunds?")).system).toContain(
      "fourteen days"
    )
    const attached = await trpcQuery<{ knowledgeBases: KnowledgeBase[] }>(
      client,
      "agent.getKnowledge",
      { agentId: agent.id }
    )
    await trpcMutation(client, "knowledgeBase.removeFile", {
      id: base.id,
      fileId: refunds.id,
    })

    expect(attached.data?.knowledgeBases).toEqual([
      expect.objectContaining({ id: base.id, fileCount: 1 }),
    ])
    expect((await ask(client, ai, agent.id, "refunds?")).system).not.toContain(
      "fourteen days"
    )
  })

  it("drops a deleted file from its knowledge bases", async () => {
    const { client } = await knowledgeWorld()
    const file = await uploaded(client, "refunds.md", REFUNDS)
    const base = await knowledgeBase(client, { name: "Docs" })
    await trpcMutation(client, "knowledgeBase.addFiles", {
      id: base.id,
      fileIds: [file.id],
    })

    await trpcMutation(client, "file.remove", { id: file.id })

    const list = await trpcQuery<KnowledgeBase[]>(client, "knowledgeBase.list")
    expect(list.data?.[0]).toMatchObject({ name: "Docs", fileCount: 0 })
  })

  it("keeps knowledge bases and their use private to their owner", async () => {
    const { client: owner, newClient } = await knowledgeWorld()
    const outsider = await newClient()
    const file = await uploaded(owner, "refunds.md", REFUNDS)
    const base = await knowledgeBase(owner, { name: "Private" })
    const theirBase = await knowledgeBase(outsider, { name: "Theirs" })
    const theirAgent = await agentFor(outsider, "Theirs")

    const results = await Promise.all([
      trpcQuery(outsider, "knowledgeBase.get", { id: base.id }),
      trpcMutation(outsider, "knowledgeBase.update", {
        id: base.id,
        name: "x",
      }),
      trpcMutation(outsider, "knowledgeBase.remove", { id: base.id }),
      trpcMutation(outsider, "knowledgeBase.addFiles", {
        id: base.id,
        fileIds: [],
      }),
      // Someone else's file into my base, and someone else's base onto my agent.
      trpcMutation(outsider, "knowledgeBase.addFiles", {
        id: theirBase.id,
        fileIds: [file.id],
      }),
      attach(outsider, theirAgent.id, [], [base.id]),
    ])

    expect(results.map((result) => result.code)).toEqual(
      Array(6).fill("NOT_FOUND")
    )
    expect(
      (await trpcQuery<KnowledgeBase[]>(owner, "knowledgeBase.list")).data
    ).toHaveLength(1)
  })
})
