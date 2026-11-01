import { afterEach, describe, expect, it, vi } from "vitest"
import { TestClient } from "../test/client"
import { fakeImageAi, PNG_BYTES, type ImageCall } from "../test/fakes"
import { signedInClient, trpcMutation, trpcQuery } from "../test/helpers"

type Generated = {
  id: string
  imageUrl: string
  width: number
  height: number
  model: string
  provider: string
  prompt: string
  style: string
  aspectRatio: string
}

async function imageWorld(
  handler?: (call: ImageCall) => Response | undefined,
  extraEnv: Parameters<typeof signedInClient>[1] = {}
) {
  const ai = fakeImageAi(handler)
  const client = await signedInClient(ai.fetch, extraEnv)
  return { ai, client }
}

const generate = (client: TestClient, input: Record<string, unknown> = {}) =>
  trpcMutation<Generated>(client, "image.generate", {
    prompt: "A red fox in the snow",
    style: "none",
    aspectRatio: "1:1",
    model: "flux-2-dev",
    ...input,
  })

const gallery = (client: TestClient) =>
  trpcQuery<Generated[]>(client, "image.list").then((result) => result.data)

afterEach(() => vi.useRealTimers())

describe("image generation", () => {
  it("makes an image, keeps it, and serves it back to its owner", async () => {
    const { ai, client } = await imageWorld()

    const made = await generate(client, {
      style: "photorealistic",
      aspectRatio: "16:9",
    })

    expect(made.data).toMatchObject({
      model: "flux-2-dev",
      provider: "cloudflare",
      prompt: "A red fox in the snow",
      style: "photorealistic",
      aspectRatio: "16:9",
      width: 1344,
      height: 768,
    })
    expect(made.data?.imageUrl).toMatch(
      /^\/api\/files\/images\/[^/]+\/[^/]+\.png$/
    )
    expect(ai.calls).toHaveLength(1)
    expect(ai.calls[0]).toMatchObject({
      model: "@cf/black-forest-labs/flux-2-dev",
      authorization: "Bearer test-token",
      body: {
        prompt:
          "A red fox in the snow, photorealistic, 8k resolution, ultra high detail, sharp focus",
      },
    })

    const served = await client.get(made.data!.imageUrl)
    expect(served.status).toBe(200)
    expect(served.headers.get("content-type")).toBe("image/png")
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG_BYTES)
    expect(await gallery(client)).toEqual([
      expect.objectContaining({ id: made.data?.id }),
    ])
  })

  it("speaks each model's own wire format", async () => {
    const { ai, client } = await imageWorld()

    for (const model of [
      "flux-2-klein-4b",
      "lucid-origin",
      "flux-1-schnell",
      "phoenix-1.0",
    ]) {
      const made = await generate(client, { model })
      expect(made.data?.model).toBe(model)
    }

    const [klein, lucid, schnell, phoenix] = ai.calls
    // FLUX.2 only accepts multipart; JSON would silently return nothing.
    expect(klein).toMatchObject({
      wire: "multipart",
      body: { prompt: "A red fox in the snow" },
    })
    expect(lucid).toMatchObject({
      wire: "json",
      body: { prompt: "A red fox in the snow" },
    })
    expect(schnell).toMatchObject({
      wire: "json",
      body: { prompt: "A red fox in the snow", steps: 4 },
    })
    expect(phoenix.wire).toBe("json") // and its reply is raw bytes, which still store
    expect((await gallery(client))?.length).toBe(4)
  })

  it("rejects requests that are not valid, before calling the model", async () => {
    const { ai, client } = await imageWorld()

    const bad = [
      { prompt: "   " },
      { prompt: "x".repeat(2001) },
      { model: "not-a-model" },
      { style: "watercolour" },
      { aspectRatio: "5:1" },
    ]
    for (const input of bad) {
      expect((await generate(client, input)).code).toBe("BAD_REQUEST")
    }

    expect(ai.calls).toHaveLength(0)
    expect(await gallery(client)).toEqual([])
  })

  it("refuses prompts that break the content policy", async () => {
    const { ai, client } = await imageWorld()

    const refused = await generate(client, { prompt: "A NSFW picture" })

    expect(refused.code).toBe("UNPROCESSABLE_CONTENT")
    expect(refused.message).toMatch(/usage policy/)
    expect(ai.calls).toHaveLength(0)
  })

  it("allows 50 images an hour, then again once the hour has passed", async () => {
    const { ai, client } = await imageWorld()
    vi.useFakeTimers({ toFake: ["Date"] })
    const start = Date.UTC(2026, 8, 21, 12, 0, 0)
    vi.setSystemTime(start)

    for (let i = 0; i < 50; i++) {
      expect((await generate(client)).code).toBeUndefined()
    }
    const over = await generate(client)
    expect(over.code).toBe("TOO_MANY_REQUESTS")
    expect(over.message).toMatch(/50 images per hour/)
    expect(ai.calls).toHaveLength(50)

    vi.setSystemTime(start + 61 * 60 * 1000)
    expect((await generate(client)).code).toBeUndefined()
  })

  it("retries a transient provider failure once, but not a permanent one", async () => {
    let attempts = 0
    const flaky = await imageWorld((call) => {
      attempts++
      if (call.body.prompt === "flaky" && attempts === 1) {
        return new Response("upstream busy", { status: 503 })
      }
      if (call.body.prompt === "rejected") {
        return new Response("bad prompt", { status: 400 })
      }
      return undefined
    })

    expect(
      (await generate(flaky.client, { prompt: "flaky" })).code
    ).toBeUndefined()
    expect(flaky.ai.calls).toHaveLength(2)

    flaky.ai.calls.length = 0
    const refused = await generate(flaky.client, { prompt: "rejected" })
    expect(refused.code).toBe("INTERNAL_SERVER_ERROR")
    expect(refused.message).toMatch(
      /Cloudflare image generation failed \(400\)/
    )
    expect(flaky.ai.calls).toHaveLength(2) // multipart failed, then JSON fallback
    expect((await gallery(flaky.client))?.length).toBe(1) // nothing stored for the failure
  })

  it("falls back to JSON when a FLUX multipart request is rejected", async () => {
    const { ai, client } = await imageWorld((call) => {
      if (
        call.model === "@cf/black-forest-labs/flux-2-dev" &&
        call.wire === "multipart"
      ) {
        return new Response("multipart unsupported", { status: 415 })
      }
      return undefined
    })

    const made = await generate(client)

    expect(made.code).toBeUndefined()
    expect(ai.calls).toHaveLength(2)
    expect(ai.calls[0]).toMatchObject({
      wire: "multipart",
      body: { prompt: "A red fox in the snow" },
    })
    expect(ai.calls[1]).toMatchObject({
      wire: "json",
      body: { prompt: "A red fox in the snow" },
    })
  })

  it("keeps a failed generation out of the gallery when every attempt fails", async () => {
    const { ai, client } = await imageWorld(
      () => new Response("down", { status: 500 })
    )

    const failed = await generate(client)

    expect(failed.code).toBe("INTERNAL_SERVER_ERROR")
    expect(ai.calls).toHaveLength(2) // the attempt and one retry
    expect(await gallery(client)).toEqual([])
  })

  it("surfaces network errors with a specific message", async () => {
    const fetcher: typeof fetch = async () => {
      throw new TypeError("fetch failed")
    }
    const client = await signedInClient(fetcher)

    const failed = await generate(client)

    expect(failed.code).toBe("INTERNAL_SERVER_ERROR")
    expect(failed.message).toMatch(/network error/i)
  })

  it("does not keep a reply that is not an image, even when it says 200", async () => {
    const { ai, client } = await imageWorld(() =>
      Response.json({ result: { image: btoa("this is not an image") } })
    )

    const failed = await generate(client)

    expect(failed.code).toBe("INTERNAL_SERVER_ERROR")
    expect(ai.calls).toHaveLength(1) // a bad result would not improve on retry
    expect(await gallery(client)).toEqual([])
  })

  it("says so when image generation is not configured", async () => {
    const { ai, client } = await imageWorld(undefined, {
      CLOUDFLARE_API_TOKEN: "",
    })

    const result = await generate(client)

    expect(result.code).toBe("SERVICE_UNAVAILABLE")
    expect(ai.calls).toHaveLength(0)
  })
})

describe("the image gallery", () => {
  it("keeps each user's images private", async () => {
    const owner = await imageWorld()
    const other = await signedInClient(owner.ai.fetch)
    const made = await generate(owner.client)

    expect(await gallery(other)).toEqual([])
    expect((await other.get(made.data!.imageUrl)).status).toBe(404)
    expect(
      (await trpcMutation(other, "image.remove", { id: made.data!.id })).code
    ).toBe("NOT_FOUND")
    // Untouched for the owner.
    expect((await gallery(owner.client))?.length).toBe(1)
    expect((await owner.client.get(made.data!.imageUrl)).status).toBe(200)

    const anonymous = new TestClient()
    await anonymous.bootCsrf()
    expect((await anonymous.get(made.data!.imageUrl)).status).toBe(401)
    expect((await trpcQuery(anonymous, "image.list")).code).toBe("UNAUTHORIZED")
    expect((await generate(anonymous)).code).toBe("UNAUTHORIZED")
  })

  it("lists the newest image first", async () => {
    const { client } = await imageWorld()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.UTC(2026, 8, 21, 9, 0, 0))
    await generate(client, { prompt: "first" })
    vi.setSystemTime(Date.UTC(2026, 8, 21, 10, 0, 0))
    await generate(client, { prompt: "second" })

    expect((await gallery(client))?.map((image) => image.prompt)).toEqual([
      "second",
      "first",
    ])
  })

  it("deletes the record and the stored file together", async () => {
    const { client } = await imageWorld()
    const made = await generate(client)

    const removed = await trpcMutation(client, "image.remove", {
      id: made.data!.id,
    })

    expect(removed.code).toBeUndefined()
    expect(await gallery(client)).toEqual([])
    expect((await client.get(made.data!.imageUrl)).status).toBe(404)
  })
})
