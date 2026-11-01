import { afterEach, describe, expect, it, vi } from "vitest"
import { TestClient } from "../test/client"
import { fakeBfl, fakeImageAi, PNG_BYTES } from "../test/fakes"
import { signedInClient, trpcQuery } from "../test/helpers"

type Edited = {
  id: string
  imageUrl: string
  provider: string
  model: string
  prompt: string
}
type Failure = { error: string; code: string }

async function toolWorld(
  handlers: Parameters<typeof fakeBfl>[0] = {},
  extraEnv: Parameters<typeof signedInClient>[1] = {}
) {
  const bfl = fakeBfl(handlers)
  const client = await signedInClient(fakeImageAi().fetch, {
    BFL_API_KEY: "test-bfl-key",
    OUTBOUND_FETCH: bfl.fetch,
    ...extraEnv,
  })
  return { bfl, client }
}

const png = (name = "photo.png") =>
  new File([PNG_BYTES], name, { type: "image/png" })

function send(
  client: TestClient,
  tool: "background-removal" | "enhance",
  file: File | undefined,
  fields: Record<string, string> = {}
) {
  const form = new FormData()
  if (file) form.set("image", file)
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return client.post(`/api/image-tools/${tool}`, { csrf: true, form })
}

const gallery = (client: TestClient) =>
  trpcQuery<Edited[]>(client, "image.list").then((result) => result.data)

afterEach(() => vi.useRealTimers())

describe("background removal", () => {
  it("removes the background, keeps the cutout, and lists it in the gallery", async () => {
    const { bfl, client } = await toolWorld()

    const response = await send(client, "background-removal", png())

    expect(response.status).toBe(201)
    const image = (await response.json()) as Edited
    expect(image).toMatchObject({
      provider: "bfl",
      model: "flux-2-pro-preview",
      prompt: "Background removed",
    })
    expect(image.imageUrl).toMatch(/^\/api\/files\/images\/[^/]+\/[^/]+\.png$/)

    // The upload goes to BFL as base64 with the key in x-key, as a PNG edit.
    const [submitted] = bfl.submits()
    expect(submitted.url).toBe("https://api.bfl.ai/v1/flux-2-pro-preview")
    expect(submitted.key).toBe("test-bfl-key")
    expect(submitted.body).toMatchObject({
      input_image: btoa(String.fromCharCode(...PNG_BYTES)),
      output_format: "png",
    })
    expect(submitted.body.prompt).toMatch(/Remove the background/)

    const served = await client.get(image.imageUrl)
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG_BYTES)
    expect((await gallery(client))?.map((item) => item.id)).toEqual([image.id])
  })

  it("only takes a PNG, JPEG or WebP of at most 10 MB, from a signed-in user", async () => {
    const { bfl, client } = await toolWorld()

    const none = await send(client, "background-removal", undefined)
    const wrongType = await send(
      client,
      "background-removal",
      new File(["hello"], "note.txt", { type: "text/plain" })
    )
    const tooBig = await send(
      client,
      "background-removal",
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", {
        type: "image/png",
      })
    )
    const lying = await send(
      client,
      "background-removal",
      new File(["not really an image"], "fake.png", { type: "image/png" })
    )
    const anonymous = new TestClient()
    await anonymous.bootCsrf()
    const signedOut = await send(anonymous, "background-removal", png())

    expect(none.status).toBe(400)
    expect(wrongType.status).toBe(400)
    expect(tooBig.status).toBe(413)
    expect(lying.status).toBe(400) // the bytes decide, not the declared type
    expect(signedOut.status).toBe(401)
    expect(bfl.calls).toHaveLength(0)
  })

  it("says so when Black Forest Labs is not configured", async () => {
    const { bfl, client } = await toolWorld({}, { BFL_API_KEY: "" })

    const response = await send(client, "background-removal", png())

    expect(response.status).toBe(503)
    expect(((await response.json()) as Failure).code).toBe("NOT_CONFIGURED")
    expect(bfl.calls).toHaveLength(0)
  })

  it("moves on to the next model when one cannot take the request", async () => {
    const { bfl, client } = await toolWorld({
      submit: (endpoint) =>
        endpoint === "flux-2-pro-preview"
          ? new Response("unsupported", { status: 422 })
          : undefined,
    })

    const response = await send(client, "background-removal", png())

    expect(response.status).toBe(201)
    expect(((await response.json()) as Edited).model).toBe("flux-kontext-max")
    expect(bfl.submits().map((call) => call.url.split("/").pop())).toEqual([
      "flux-2-pro-preview",
      "flux-kontext-max",
    ])
  })

  it("stops at once on an error that another model would not fix", async () => {
    const { bfl, client } = await toolWorld({
      submit: () => new Response("bad key", { status: 401 }),
    })

    const response = await send(client, "background-removal", png())

    expect(response.status).toBe(502)
    expect(bfl.submits()).toHaveLength(1)
    expect(await gallery(client)).toEqual([])
  })

  it("waits for a result that is not ready yet", async () => {
    const { client } = await toolWorld({
      poll: (_url, attempt) =>
        attempt === 1 ? Response.json({ status: "Pending" }) : undefined,
    })

    const response = await send(client, "background-removal", png())

    expect(response.status).toBe(201)
  })

  it("fails, and keeps nothing, when every model fails", async () => {
    const { bfl, client } = await toolWorld({
      poll: () => Response.json({ status: "Error" }),
    })

    const response = await send(client, "background-removal", png())

    expect(response.status).toBe(502)
    const failure = (await response.json()) as Failure
    expect(failure.error).toMatch(/failed for all FLUX edit models/)
    expect(bfl.submits()).toHaveLength(3)
    expect(await gallery(client)).toEqual([])
  })

  it("never sends the API key anywhere but Black Forest Labs", async () => {
    const { bfl, client } = await toolWorld({
      submit: () =>
        Response.json({ id: "job", polling_url: "https://evil.example/poll" }),
    })

    const response = await send(client, "background-removal", png())

    expect(response.status).toBe(502)
    expect(
      bfl.calls.filter((call) => new URL(call.url).hostname === "evil.example")
    ).toEqual([])
  })

  it("does not keep a result that is not an image", async () => {
    const { client } = await toolWorld({
      download: () =>
        new Response("<html>oops</html>", {
          headers: { "content-type": "text/html" },
        }),
    })

    const response = await send(client, "background-removal", png())

    expect(response.status).toBe(502)
    expect(await gallery(client)).toEqual([])
  })
})

describe("image enhancer", () => {
  it("enhances at 2x or 4x and records which", async () => {
    const { bfl, client } = await toolWorld()

    const response = await send(client, "enhance", png(), { scale: "4" })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      provider: "bfl",
      prompt: "Enhanced 4x",
    })
    expect(bfl.submits()[0].body.prompt).toMatch(/4x resolution/)
  })

  it("needs a scale of 2 or 4", async () => {
    const { bfl, client } = await toolWorld()

    for (const scale of [undefined, "3", "8", "abc"]) {
      const response = await send(
        client,
        "enhance",
        png(),
        scale ? { scale } : {}
      )
      expect(response.status).toBe(400)
    }
    expect(bfl.calls).toHaveLength(0)
  })
})

describe("edit limits", () => {
  it("allows 20 edits an hour, then again once the hour has passed", async () => {
    const { bfl, client } = await toolWorld()
    vi.useFakeTimers({ toFake: ["Date"] })
    const start = Date.UTC(2026, 8, 21, 12, 0, 0)
    vi.setSystemTime(start)

    // A picture made with Workers AI does not count against the edit limit.
    const generated = await client.post("/api/trpc/image.generate", {
      csrf: true,
      json: {
        prompt: "A fox",
        style: "none",
        aspectRatio: "1:1",
        model: "flux-2-dev",
      },
    })
    expect(generated.status).toBe(200)

    for (let i = 0; i < 20; i++) {
      expect((await send(client, "background-removal", png())).status).toBe(201)
    }
    const over = await send(client, "enhance", png(), { scale: "2" })
    expect(over.status).toBe(429)
    expect(((await over.json()) as Failure).code).toBe("RATE_LIMITED")
    expect(bfl.submits()).toHaveLength(20)

    vi.setSystemTime(start + 61 * 60 * 1000)
    expect((await send(client, "background-removal", png())).status).toBe(201)
  })
})
