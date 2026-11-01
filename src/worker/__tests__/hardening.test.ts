import { describe, expect, it } from "vitest"
import { TestClient } from "../test/client"
import { signedInClient } from "../test/helpers"

/** A second valid token, minted for a different browser session. */
async function freshToken(): Promise<string> {
  const other = new TestClient()
  await other.bootCsrf()
  return other.cookie("csrf_token")!
}

describe("CSRF double submit", () => {
  it("rejects a validly signed header token that is not the caller's cookie", async () => {
    const client = new TestClient()
    await client.bootCsrf()
    const someoneElses = await freshToken()
    expect(someoneElses).not.toBe(client.cookie("csrf_token"))

    const response = await client.post("/api/auth/register", {
      headers: { "x-csrf-token": someoneElses },
      json: { email: "a@b.co", password: "correct horse battery staple" },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "INVALID_CSRF" })
  })

  it("still accepts the caller's own token", async () => {
    const client = new TestClient()
    await client.bootCsrf()

    const response = await client.post("/api/auth/register", {
      csrf: true,
      json: {
        email: `ok-${crypto.randomUUID()}@openchat-tests.dev`,
        password: "correct horse battery staple",
      },
    })

    expect(response.status).toBe(201)
  })
})

describe("security headers", () => {
  it("are set on every API response, including errors", async () => {
    const client = new TestClient()
    const ok = await client.get("/api/health")
    const notFound = await client.get("/api/nothing-here")

    for (const response of [ok, notFound]) {
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("referrer-policy")).toBe("no-referrer")
      expect(response.headers.get("cache-control")).toBe("no-store")
      // An API response is data; nothing should ever frame or execute it.
      expect(response.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'"
      )
    }
  })
})

describe("the upload size cap", () => {
  /** A chunked body of `chunks` x 64 KB, sent without a Content-Length. */
  function chunked(chunks: number): ReadableStream<Uint8Array> {
    let sent = 0
    return new ReadableStream({
      pull(controller) {
        if (sent++ >= chunks) return controller.close()
        controller.enqueue(new Uint8Array(64 * 1024))
      },
    })
  }

  it("holds for a chunked upload that declares no length", async () => {
    const client = await signedInClient()

    const response = await client.post("/api/files", {
      csrf: true,
      headers: { "content-type": "multipart/form-data; boundary=x" },
      stream: chunked(40), // 2.5 MB, over the 1 MB limit
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ code: "FILE_TOO_LARGE" })
  })

  it("holds for the image tools too", async () => {
    const client = await signedInClient()

    const response = await client.post("/api/image-tools/background-removal", {
      csrf: true,
      headers: { "content-type": "multipart/form-data; boundary=x" },
      stream: chunked(200), // 12.5 MB, over the 10 MB limit
    })

    expect(response.status).toBe(413)
  })
})
