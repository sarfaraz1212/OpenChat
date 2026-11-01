import { describe, expect, it } from "vitest"
import { CHAT_MODELS } from "../../shared/models"
import { TestClient } from "../test/client"
import {
  MODEL,
  signedInClient,
  trpcMutation,
  trpcQuery,
  workersAiStream,
} from "../test/helpers"

const MODEL_COUNT = CHAT_MODELS.length

type Provider = {
  id: string
  name: string
  enabled: boolean
  configured: boolean
  modelCount: number
  enabledModelCount: number
}

describe("model providers", () => {
  it("lists Cloudflare Workers AI as the only provider, enabled by default", async () => {
    const client = await signedInClient()

    const list = await trpcQuery<Provider[]>(client, "aiProvider.list")

    expect(list.response.status).toBe(200)
    expect(list.data).toEqual([
      {
        id: "cloudflare",
        name: "Cloudflare Workers AI",
        description: expect.any(String),
        enabled: true,
        configured: true,
        modelCount: MODEL_COUNT,
        enabledModelCount: MODEL_COUNT,
      },
    ])
  })

  it("says the provider is not configured when the server has no Workers AI credentials", async () => {
    const client = await signedInClient(undefined, {
      CLOUDFLARE_ACCOUNT_ID: "",
      CLOUDFLARE_API_TOKEN: "",
    })

    const list = await trpcQuery<Provider[]>(client, "aiProvider.list")

    expect(list.data?.[0]).toMatchObject({
      id: "cloudflare",
      configured: false,
    })
  })

  it("requires authentication", async () => {
    const client = new TestClient()
    await client.bootCsrf()

    const list = await trpcQuery(client, "aiProvider.list")

    expect(list.response.status).toBe(401)
    expect(list.code).toBe("UNAUTHORIZED")
  })
})

type Model = {
  id: string
  providerId: string
  displayName: string
  organization: string
  type: string
  enabled: boolean
  abilities: { functionCall?: boolean; vision?: boolean; reasoning?: boolean }
  contextWindowTokens?: number
}

describe("model catalog", () => {
  it("lists all catalog models with only the abilities that were actually probed", async () => {
    const client = await signedInClient()

    const list = await trpcQuery<Model[]>(client, "aiModel.list", {
      providerId: "cloudflare",
    })

    expect(list.response.status).toBe(200)
    expect(list.data).toHaveLength(MODEL_COUNT)
    const byId = new Map(list.data!.map((model) => [model.id, model]))
    // Probed 2026-09-12 (legacy `lib/models/data/cloudflare.ts`): sees images.
    expect(byId.get("@cf/google/gemma-4-26b-a4b-it")).toMatchObject({
      providerId: "cloudflare",
      displayName: "Gemma 4 26B",
      organization: "Google",
      type: "chat",
      enabled: true,
      abilities: { functionCall: true, vision: true, reasoning: true },
      contextWindowTokens: 256_000,
    })
    // Probed 2026-09-12: text only.
    expect(byId.get("@cf/openai/gpt-oss-120b")).toMatchObject({
      abilities: { functionCall: true, vision: false, reasoning: true },
      contextWindowTokens: 128_000,
    })
    // Never probed: claim nothing rather than guess.
    const unprobed = byId.get("@cf/meta/llama-3.3-70b-instruct-fp8-fast")!
    expect(unprobed.abilities).toEqual({})
    expect(unprobed.contextWindowTokens).toBeUndefined()
  })

  it("rejects an unknown provider", async () => {
    const client = await signedInClient()

    const list = await trpcQuery(client, "aiModel.list", {
      providerId: "openai",
    })

    expect(list.response.status).toBe(400)
  })
})

const GEMMA = "@cf/google/gemma-4-26b-a4b-it"
const SCOUT = "@cf/meta/llama-4-scout-17b-16e-instruct"

type RuntimeState = {
  providers: Array<{ id: string; name: string; models: Model[] }>
}

async function models(client: TestClient): Promise<Model[]> {
  const list = await trpcQuery<Model[]>(client, "aiModel.list", {
    providerId: "cloudflare",
  })
  return list.data!
}

describe("switching models mid-chat", () => {
  it("uses the newly chosen model for the next turn and remembers it on the topic", async () => {
    const outbound: string[] = []
    const client = await signedInClient(async (input, init) => {
      const body = (await new Request(input, init).json()) as { model: string }
      outbound.push(body.model)
      return workersAiStream("ok")
    })
    const created = await trpcMutation<{ id: string }>(client, "topic.create", {
      model: MODEL,
    })
    const topicId = created.data!.id

    for (const model of [MODEL, GEMMA]) {
      const reply = await client.post(`/api/chat/topics/${topicId}/messages`, {
        csrf: true,
        json: { content: `Hello via ${model}`, model },
      })
      expect(reply.status).toBe(200)
      await reply.text()
    }

    expect(outbound).toEqual([MODEL, GEMMA])
    const loaded = await trpcQuery<{
      model: string
      messages: Array<{ role: string; model: string }>
    }>(client, "topic.get", { id: topicId })
    expect(loaded.data?.model).toBe(GEMMA)
    expect(
      loaded.data?.messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.model)
    ).toEqual([MODEL, GEMMA])
  })

  it("switches a topic's model without sending a message, and rejects unknown models", async () => {
    const client = await signedInClient()
    const created = await trpcMutation<{ id: string }>(client, "topic.create", {
      model: MODEL,
    })
    const topicId = created.data!.id

    const switched = await trpcMutation<{ model: string }>(
      client,
      "topic.update",
      { id: topicId, model: SCOUT }
    )
    const rejected = await trpcMutation(client, "topic.update", {
      id: topicId,
      model: "@cf/not-in-the-catalog",
    })

    expect(switched.data?.model).toBe(SCOUT)
    expect(rejected.response.status).toBe(400)
    const loaded = await trpcQuery<{ model: string }>(client, "topic.get", {
      id: topicId,
    })
    expect(loaded.data?.model).toBe(SCOUT)
  })
})

describe("model preferences", () => {
  it("lets a user hide a model without affecting anyone else", async () => {
    const alice = await signedInClient()
    const bob = await signedInClient()

    const toggled = await trpcMutation(alice, "aiModel.toggle", {
      providerId: "cloudflare",
      id: GEMMA,
      enabled: false,
    })

    expect(toggled.response.status).toBe(200)
    expect((await models(alice)).find((m) => m.id === GEMMA)?.enabled).toBe(
      false
    )
    expect((await models(bob)).find((m) => m.id === GEMMA)?.enabled).toBe(true)
    const providers = await trpcQuery<Provider[]>(alice, "aiProvider.list")
    expect(providers.data?.[0]).toMatchObject({
      modelCount: MODEL_COUNT,
      enabledModelCount: MODEL_COUNT - 1,
    })
  })

  it("can turn a model back on, and disable or enable several at once", async () => {
    const client = await signedInClient()

    await trpcMutation(client, "aiModel.batchToggle", {
      providerId: "cloudflare",
      ids: [GEMMA, SCOUT],
      enabled: false,
    })
    const afterDisable = await models(client)
    expect(
      afterDisable
        .filter((m) => !m.enabled)
        .map((m) => m.id)
        .sort()
    ).toEqual([GEMMA, SCOUT].sort())

    await trpcMutation(client, "aiModel.toggle", {
      providerId: "cloudflare",
      id: GEMMA,
      enabled: true,
    })
    expect(
      (await models(client)).filter((m) => !m.enabled).map((m) => m.id)
    ).toEqual([SCOUT])
  })

  it("rejects toggling a model that is not in the Cloudflare catalog", async () => {
    const client = await signedInClient()

    const toggled = await trpcMutation(client, "aiModel.toggle", {
      providerId: "cloudflare",
      id: "@cf/not-in-the-catalog",
      enabled: false,
    })

    expect(toggled.response.status).toBe(400)
  })

  it("offers the model switcher only enabled models of enabled providers", async () => {
    const client = await signedInClient()

    const initial = await trpcQuery<RuntimeState>(
      client,
      "aiInfra.runtimeState"
    )
    expect(initial.data?.providers).toHaveLength(1)
    expect(initial.data?.providers[0]).toMatchObject({
      id: "cloudflare",
      name: "Cloudflare Workers AI",
    })
    expect(initial.data?.providers[0].models).toHaveLength(MODEL_COUNT)

    await trpcMutation(client, "aiModel.toggle", {
      providerId: "cloudflare",
      id: GEMMA,
      enabled: false,
    })
    const withoutGemma = await trpcQuery<RuntimeState>(
      client,
      "aiInfra.runtimeState"
    )
    expect(withoutGemma.data?.providers[0].models).toHaveLength(MODEL_COUNT - 1)
    expect(
      withoutGemma.data?.providers[0].models.map((m) => m.id)
    ).not.toContain(GEMMA)

    await trpcMutation(client, "aiProvider.toggle", {
      id: "cloudflare",
      enabled: false,
    })
    const providerOff = await trpcQuery<RuntimeState>(
      client,
      "aiInfra.runtimeState"
    )
    expect(providerOff.data?.providers).toEqual([])
    const listed = await trpcQuery<Provider[]>(client, "aiProvider.list")
    expect(listed.data?.[0]).toMatchObject({ enabled: false })
  })

  it("keeps preferences behind authentication and CSRF", async () => {
    const anonymous = new TestClient()
    await anonymous.bootCsrf()
    const unauthenticated = await trpcMutation(anonymous, "aiModel.toggle", {
      providerId: "cloudflare",
      id: MODEL,
      enabled: false,
    })
    expect(unauthenticated.response.status).toBe(401)

    const client = await signedInClient()
    const noCsrf = await client.post("/api/trpc/aiModel.toggle", {
      json: { providerId: "cloudflare", id: MODEL, enabled: false },
    })
    expect(noCsrf.status).toBe(403)
  })
})
