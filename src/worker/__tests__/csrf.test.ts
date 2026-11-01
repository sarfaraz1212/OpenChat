import { describe, expect, it } from "vitest"
import { TestClient } from "../test/client"

const TOKEN_SHAPE = /^[0-9a-f]{64}(:|%3A)[0-9a-f]{64}$/i

describe("GET /api/csrf", () => {
  it("issues a signed csrf_token cookie the SPA can read", async () => {
    const client = new TestClient()

    const res = await client.get("/api/csrf")

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const setCookie = res.headers
      .getSetCookie()
      .find((line) => line.startsWith("csrf_token="))
    expect(setCookie).toBeDefined()
    // The SPA reads this cookie and echoes it in a header, so it cannot be
    // HttpOnly.
    expect(setCookie).not.toMatch(/httponly/i)
    expect(setCookie).toMatch(/path=\//i)
    expect(setCookie).toMatch(/secure/i)
    expect(client.cookie("csrf_token")).toMatch(TOKEN_SHAPE)
  })

  it("issues a different token every time", async () => {
    const a = new TestClient()
    const b = new TestClient()
    await a.get("/api/csrf")
    await b.get("/api/csrf")

    expect(a.cookie("csrf_token")).not.toBe(b.cookie("csrf_token"))
  })

  it("refuses to issue tokens when CSRF_SECRET is not configured", async () => {
    // A missing secret must fail loudly. Signing with an undefined secret would
    // hand out tokens anyone can forge.
    const res = await new TestClient({ env: { CSRF_SECRET: "" } }).get(
      "/api/csrf"
    )

    expect(res.status).toBe(500)
    expect(res.headers.getSetCookie()).toEqual([])
  })
})

describe("CSRF protection on state-changing requests", () => {
  // The check runs before routing, so a request that clears it falls through to
  // the 404 for an unknown path. That lets these tests observe the middleware
  // on its own, independent of any particular endpoint.
  const PROBE = "/api/csrf-probe"

  async function clientWithToken(): Promise<TestClient> {
    const client = new TestClient()
    await client.bootCsrf()
    return client
  }

  async function expectRejected(res: Response) {
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "INVALID_CSRF" })
  }

  it("rejects a POST with neither cookie nor header", async () => {
    await expectRejected(await new TestClient().post(PROBE))
  })

  it("rejects a POST whose header is missing", async () => {
    const client = await clientWithToken()

    await expectRejected(await client.post(PROBE))
  })

  it("rejects a POST whose cookie is missing", async () => {
    const source = await clientWithToken()
    const token = source.cookie("csrf_token")!

    const res = await new TestClient().post(PROBE, {
      headers: { "x-csrf-token": token },
    })

    await expectRejected(res)
  })

  it("rejects a token the server never signed", async () => {
    // Regression guard for the missing-await hazard: validateCsrfToken is
    // async, so a caller that forgets to await it gets a promise, which is
    // always truthy, and every request passes. If that happens this forged token
    // sails through to the 404 instead of being refused.
    const client = new TestClient()
    client.setCookie("csrf_token", `${"a".repeat(64)}:${"b".repeat(64)}`)

    await expectRejected(await client.post(PROBE, { csrf: true }))
  })

  it("rejects a token whose signature was tampered with", async () => {
    const client = await clientWithToken()
    const token = decodeURIComponent(client.cookie("csrf_token")!)
    const [nonce, signature] = token.split(":")
    const flipped = signature.startsWith("0") ? "1" : "0"
    client.setCookie("csrf_token", `${nonce}:${flipped}${signature.slice(1)}`)

    await expectRejected(await client.post(PROBE, { csrf: true }))
  })

  it.each([
    ["empty", ""],
    ["no separator", "nocolon"],
    ["separator only", ":"],
    ["missing signature", "a:"],
    ["missing nonce", ":b"],
    ["undecodable percent-encoding", "%E0%A4%A"],
  ])("rejects a malformed token (%s)", async (_label, malformed) => {
    const client = new TestClient()
    client.setCookie("csrf_token", malformed)

    await expectRejected(await client.post(PROBE, { csrf: true }))
  })

  it("lets a POST carrying a valid cookie and header through", async () => {
    const client = await clientWithToken()

    const res = await client.post(PROBE, { csrf: true })

    expect(res.status).toBe(404)
  })

  it("guards PUT, PATCH and DELETE as well", async () => {
    const client = await clientWithToken()

    for (const method of ["PUT", "PATCH", "DELETE"]) {
      await expectRejected(await client.request(method, PROBE))
      expect(
        (await client.request(method, PROBE, { csrf: true })).status,
        method
      ).toBe(404)
    }
  })

  it("does not require a token for safe methods", async () => {
    const res = await new TestClient().get(PROBE)

    expect(res.status).toBe(404)
  })

  it("rejects every mutation when CSRF_SECRET is not configured", async () => {
    // A token that is valid under the real secret must not be honoured by a
    // deployment that has lost its secret.
    const token = (await clientWithToken()).cookie("csrf_token")!
    const unconfigured = new TestClient({ env: { CSRF_SECRET: "" } })
    unconfigured.setCookie("csrf_token", token)

    await expectRejected(await unconfigured.post(PROBE, { csrf: true }))
  })

  // The middleware only protects routes registered after it. These fail if a
  // route is ever mounted ahead of the CSRF check, or under a path it skips.
  it.each([
    ["/api/auth/register"],
    ["/api/auth/login"],
    ["/api/auth/logout"],
    ["/api/trpc/topic.create"],
    ["/api/chat/topics/missing/messages"],
  ])("refuses a tokenless POST to %s", async (path) => {
    await expectRejected(await new TestClient().post(path, { json: {} }))
  })
})
