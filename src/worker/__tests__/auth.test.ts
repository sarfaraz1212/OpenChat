import { describe, expect, it, vi } from "vitest"
import { TestClient } from "../test/client"

const PASSWORD = "correct horse battery staple"

const uniqueEmail = () => `user-${crypto.randomUUID()}@openchat-tests.dev`

/** A browser that has already fetched its CSRF cookie, as the SPA does on boot. */
async function newClient(): Promise<TestClient> {
  const client = new TestClient()
  await client.bootCsrf()
  return client
}

async function register(
  client: TestClient,
  fields: { email?: string; password?: string; displayName?: string } = {}
) {
  return client.post("/api/auth/register", {
    csrf: true,
    json: {
      email: fields.email ?? uniqueEmail(),
      password: fields.password ?? PASSWORD,
      displayName: fields.displayName,
    },
  })
}

describe("POST /api/auth/register", () => {
  it("creates an account, signs the user in, and never returns the password hash", async () => {
    const client = await newClient()
    const email = uniqueEmail()

    const res = await register(client, { email, displayName: "  Ada  " })

    expect(res.status).toBe(201)
    const { user } = (await res.json()) as { user: Record<string, unknown> }
    expect(user).toMatchObject({ email, anonymous: false, display_name: "Ada" })
    expect(user).not.toHaveProperty("password_hash")

    const cookie = res.headers
      .getSetCookie()
      .find((line) => line.startsWith("openchat_session="))
    expect(cookie).toBeDefined()
    expect(cookie).toMatch(/httponly/i)
    expect(cookie).toMatch(/samesite=lax/i)
    expect(cookie).toMatch(/path=\//i)
    expect(cookie).toMatch(/secure/i)
    const expires = Date.parse(/expires=([^;]+)/i.exec(cookie!)![1])
    const days = (expires - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThan(31)

    const session = await client.get("/api/auth/session")
    expect(await session.json()).toMatchObject({ user: { id: user.id, email } })
  })

  it("stores the address lowercased and trimmed", async () => {
    const client = await newClient()
    const email = uniqueEmail()

    const res = await register(client, { email: `  ${email.toUpperCase()}  ` })

    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ user: { email } })
  })

  it("rejects a malformed email address", async () => {
    const client = await newClient()

    const res = await register(client, { email: "not-an-email" })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "INVALID_EMAIL" })
    expect(client.cookie("openchat_session")).toBeUndefined()
  })

  it("rejects a password that is too short", async () => {
    const client = await newClient()

    const res = await register(client, { password: "ab" })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "INVALID_PASSWORD" })
  })

  it("accepts a short, all-lowercase password and lets it sign in", async () => {
    // The only rule is a three-character minimum: no capitals, digits or symbols.
    const email = uniqueEmail()

    const res = await register(await newClient(), { email, password: "abc" })
    expect(res.status).toBe(201)

    const login = await (
      await newClient()
    ).post("/api/auth/login", { csrf: true, json: { email, password: "abc" } })
    expect(login.status).toBe(200)
  })

  it("rejects disposable email addresses without creating anything", async () => {
    const client = await newClient()

    const res = await register(client, { email: "someone@yopmail.com" })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "DISPOSABLE_EMAIL" })
    expect(client.cookie("openchat_session")).toBeUndefined()
  })

  it("rejects a second registration for the same address, in any letter case", async () => {
    const email = uniqueEmail()
    expect((await register(await newClient(), { email })).status).toBe(201)

    const again = await register(await newClient(), {
      email: email.toUpperCase(),
    })

    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ code: "EMAIL_TAKEN" })
  })

  it("answers malformed JSON with a client error, not a server error", async () => {
    const client = await newClient()

    const res = await client.request("POST", "/api/auth/register", {
      csrf: true,
      headers: { "content-type": "application/json" },
      raw: "{not json",
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "INVALID_JSON" })
  })
})

describe("POST /api/auth/login", () => {
  it("signs in with the right credentials, whatever the email's letter case", async () => {
    const email = uniqueEmail()
    await register(await newClient(), { email })

    const client = await newClient()
    const res = await client.post("/api/auth/login", {
      csrf: true,
      json: { email: email.toUpperCase(), password: PASSWORD },
    })

    expect(res.status).toBe(200)
    const { user } = (await res.json()) as { user: Record<string, unknown> }
    expect(user).toMatchObject({ email })
    expect(user).not.toHaveProperty("password_hash")

    const session = await client.get("/api/auth/session")
    expect(await session.json()).toMatchObject({ user: { email } })
  })

  it("gives one answer for a wrong password and an unknown account", async () => {
    // Distinguishing the two would turn the login form into an
    // account-enumeration oracle.
    const email = uniqueEmail()
    await register(await newClient(), { email })

    const wrongPassword = await (
      await newClient()
    ).post("/api/auth/login", {
      csrf: true,
      json: { email, password: "definitely the wrong password" },
    })
    const unknownAccount = await (
      await newClient()
    ).post("/api/auth/login", {
      csrf: true,
      json: { email: uniqueEmail(), password: PASSWORD },
    })

    expect(wrongPassword.status).toBe(401)
    expect(unknownAccount.status).toBe(401)
    expect(await wrongPassword.json()).toEqual({
      error: "Incorrect email or password.",
      code: "INVALID_CREDENTIALS",
    })
    expect(await unknownAccount.json()).toEqual({
      error: "Incorrect email or password.",
      code: "INVALID_CREDENTIALS",
    })
  })

  it("does not start a session when the credentials are wrong", async () => {
    const email = uniqueEmail()
    await register(await newClient(), { email })
    const client = await newClient()

    await client.post("/api/auth/login", {
      csrf: true,
      json: { email, password: "definitely the wrong password" },
    })

    expect(client.cookie("openchat_session")).toBeUndefined()
  })
})

describe("POST /api/auth/logout", () => {
  it("ends the session on the server, not just in the browser", async () => {
    const client = await newClient()
    await register(client)
    const sessionId = client.cookie("openchat_session")!

    const res = await client.post("/api/auth/logout", { csrf: true })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(client.cookie("openchat_session")).toBeUndefined()
    expect(await (await client.get("/api/auth/session")).json()).toEqual({
      user: null,
    })

    // Replaying the old cookie from elsewhere must not resurrect the session.
    const thief = new TestClient()
    thief.setCookie("openchat_session", sessionId)
    expect(await (await thief.get("/api/auth/session")).json()).toEqual({
      user: null,
    })
  })

  it("is harmless when nobody is signed in", async () => {
    const res = await (
      await newClient()
    ).post("/api/auth/logout", {
      csrf: true,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe("GET /api/auth/session", () => {
  it("reports no user when there is no session cookie", async () => {
    const res = await new TestClient().get("/api/auth/session")

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: null })
  })

  it("reports no user for a session id the server never issued", async () => {
    const client = new TestClient()
    client.setCookie("openchat_session", crypto.randomUUID())

    expect(await (await client.get("/api/auth/session")).json()).toEqual({
      user: null,
    })
  })

  it("reports no user once the session has expired", async () => {
    const client = await newClient()
    await register(client)
    expect(
      (
        (await (await client.get("/api/auth/session")).json()) as {
          user: unknown
        }
      ).user
    ).not.toBeNull()

    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      vi.setSystemTime(Date.now() + 31 * 86_400_000)
      expect(await (await client.get("/api/auth/session")).json()).toEqual({
        user: null,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("POST /api/create-guest", () => {
  it("is not available because Phase 2 requires registered accounts", async () => {
    const client = await newClient()

    const res = await client.post("/api/create-guest", { csrf: true })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: "Not found",
      code: "NOT_FOUND",
    })
  })
})
