import { describe, expect, it } from "vitest"
import { TestClient } from "../test/client"

function cookieLine(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`))
}

function register(client: TestClient) {
  return client.post("/api/auth/register", {
    csrf: true,
    json: {
      email: `cookie-${crypto.randomUUID()}@openchat-tests.dev`,
      password: "correct horse battery staple",
    },
  })
}

describe("API responses", () => {
  it("answers an unknown route with a JSON 404", async () => {
    const res = await new TestClient().get("/api/does-not-exist")

    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toMatch(/application\/json/)
    expect(await res.json()).toEqual({ error: "Not found", code: "NOT_FOUND" })
  })

  it("keeps per-user data out of caches, on success and on error alike", async () => {
    const client = new TestClient()

    const ok = await client.get("/api/auth/session")
    const missing = await client.get("/api/does-not-exist")
    const rejected = await client.post("/api/auth/logout")

    expect(ok.status).toBe(200)
    expect(missing.status).toBe(404)
    expect(rejected.status).toBe(403)
    for (const res of [ok, missing, rejected]) {
      expect(res.headers.get("cache-control")).toBe("no-store")
    }
  })
})

describe("cookie attributes", () => {
  it("marks cookies Secure on any non-local host, even for a plain-http request", async () => {
    // Deciding by request scheme would hand out a non-Secure session cookie to
    // a production request that arrived over http. Deciding by host keeps
    // production strict: the browser then won't send the cookie back over http.
    const client = new TestClient({ origin: "http://openchat.test" })
    const csrf = await client.get("/api/csrf")
    const registration = await register(client)

    expect(cookieLine(csrf, "csrf_token")).toMatch(/secure/i)
    expect(cookieLine(registration, "openchat_session")).toMatch(/secure/i)
  })

  it("leaves Secure off on localhost so local development works", async () => {
    const client = new TestClient({ origin: "http://localhost:5173" })
    const csrf = await client.get("/api/csrf")
    const registration = await register(client)

    expect(cookieLine(csrf, "csrf_token")).not.toMatch(/secure/i)
    expect(cookieLine(registration, "openchat_session")).not.toMatch(/secure/i)
  })
})
