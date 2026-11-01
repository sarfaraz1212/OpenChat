import { describe, expect, it } from "vitest"
import { TestClient } from "../test/client"
import {
  MODEL,
  signedInClient,
  trpcMutation,
  trpcQuery,
  workersAiStream,
} from "../test/helpers"

describe("chat core", () => {
  it("creates a topic, streams a reply, and reloads the persisted history", async () => {
    let outbound: Request | undefined
    const client = await signedInClient(async (input, init) => {
      outbound = new Request(input, init)
      return workersAiStream("Hello", " from", " OpenChat")
    })

    const create = await trpcMutation<{ id: string; title: string }>(
      client,
      "topic.create",
      { title: "First topic", model: MODEL }
    )

    expect(create.response.status).toBe(200)
    expect(create.data?.title).toBe("First topic")
    const topicId = create.data!.id

    const stream = await client.post(`/api/chat/topics/${topicId}/messages`, {
      csrf: true,
      json: { content: "Say hello", model: MODEL },
    })

    expect(stream.status).toBe(200)
    expect(stream.headers.get("content-type")).toContain("text/plain")
    expect(await stream.text()).toContain("Hello from OpenChat")
    expect(outbound?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/chat/completions"
    )
    expect(outbound?.headers.get("authorization")).toBe("Bearer test-token")
    expect(await outbound?.clone().json()).toMatchObject({ model: MODEL })

    const history = await trpcQuery<{
      title: string
      messages: Array<{ role: string; content: string }>
    }>(client, "topic.get", { id: topicId })

    expect(history.response.status).toBe(200)
    expect(history.data).toMatchObject({
      title: "First topic",
      messages: [
        { role: "user", content: "Say hello" },
        { role: "assistant", content: "Hello from OpenChat" },
      ],
    })
  })

  it("requires authentication at both chat boundaries", async () => {
    const client = new TestClient()
    await client.bootCsrf()

    const list = await trpcQuery(client, "topic.list")
    const stream = await client.post("/api/chat/topics/missing/messages", {
      csrf: true,
      json: { content: "Hello", model: MODEL },
    })

    expect(list.response.status).toBe(401)
    expect(stream.status).toBe(401)
    expect(await stream.json()).toMatchObject({ code: "UNAUTHORIZED" })
  })

  it("repairs non-string Workers AI stream content at the outbound boundary", async () => {
    const client = await signedInClient(async () => {
      const response = workersAiStream("placeholder")
      const body = await response.text()
      return new Response(
        body.replace('"content":"placeholder"', '"content":42'),
        {
          headers: { "content-type": "text/event-stream" },
        }
      )
    })
    const created = await trpcMutation<{ id: string }>(client, "topic.create", {
      model: MODEL,
    })

    const response = await client.post(
      `/api/chat/topics/${created.data!.id}/messages`,
      { csrf: true, json: { content: "Count", model: MODEL } }
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("42")
  })

  it("rejects model ids outside the Cloudflare catalog before calling AI", async () => {
    let aiCalls = 0
    const client = await signedInClient(async () => {
      aiCalls += 1
      return workersAiStream("should not run")
    })
    const created = await trpcMutation<{ id: string }>(client, "topic.create", {
      model: MODEL,
    })

    const response = await client.post(
      `/api/chat/topics/${created.data!.id}/messages`,
      {
        csrf: true,
        json: { content: "Hello", model: "@cf/not-in-the-catalog" },
      }
    )

    expect(response.status).toBe(400)
    expect(aiCalls).toBe(0)
  })

  it("keeps topic data private to its owner", async () => {
    const owner = await signedInClient()
    const outsider = await signedInClient()
    const created = await trpcMutation<{ id: string }>(owner, "topic.create", {
      title: "Private topic",
      model: MODEL,
    })
    const topicId = created.data!.id

    const read = await trpcQuery(outsider, "topic.get", { id: topicId })
    const stream = await outsider.post(`/api/chat/topics/${topicId}/messages`, {
      csrf: true,
      json: { content: "Steal this topic", model: MODEL },
    })

    expect(read.response.status).toBe(404)
    expect(stream.status).toBe(404)
  })

  it("supports topic and message CRUD through the typed RPC boundary", async () => {
    const client = await signedInClient()
    const created = await trpcMutation<{ id: string }>(client, "topic.create", {
      title: "Draft",
      model: MODEL,
    })
    const topicId = created.data!.id
    await client
      .post(`/api/chat/topics/${topicId}/messages`, {
        csrf: true,
        json: { content: "Original", model: MODEL },
      })
      .then((response) => response.text())

    const updated = await trpcMutation<{ title: string; favorite: boolean }>(
      client,
      "topic.update",
      { id: topicId, title: "Renamed", favorite: true }
    )
    expect(updated.data).toMatchObject({ title: "Renamed", favorite: true })

    const loaded = await trpcQuery<{
      messages: Array<{ id: string; role: string; content: string }>
    }>(client, "topic.get", { id: topicId })
    const userMessage = loaded.data!.messages.find(
      (message) => message.role === "user"
    )!
    const assistantMessage = loaded.data!.messages.find(
      (message) => message.role === "assistant"
    )!

    const edited = await trpcMutation<{ content: string }>(
      client,
      "message.update",
      { id: userMessage.id, content: "Edited" }
    )
    expect(edited.data?.content).toBe("Edited")
    expect(
      (
        await trpcMutation(client, "message.remove", {
          id: assistantMessage.id,
        })
      ).response.status
    ).toBe(200)

    const afterEdit = await trpcQuery<{
      messages: Array<{ role: string; content: string }>
    }>(client, "topic.get", { id: topicId })
    expect(afterEdit.data?.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Edited" }),
    ])

    expect(
      (await trpcMutation(client, "topic.remove", { id: topicId })).response
        .status
    ).toBe(200)
    expect((await trpcQuery<unknown[]>(client, "topic.list")).data).toEqual([])
  })
})
