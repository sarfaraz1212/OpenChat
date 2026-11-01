import { afterEach, describe, expect, it, vi } from "vitest"
import { TestClient } from "../test/client"
import { fakeEmailBinding } from "../test/fake-mail"
import { PASSWORD } from "../test/helpers"

const APP = "https://app.test"
const FROM = "noreply@mail.openchat.test"
const MINUTE = 60_000

const uniqueEmail = () => `user-${crypto.randomUUID()}@openchat-tests.dev`

type Sent = EmailMessageBuilder

/**
 * An app whose `EMAIL` binding is a recording fake, plus the browsers and
 * mailbox to drive it.
 */
function world(
  overrides: { EMAIL_FROM?: string; APP_URL?: string } = {},
  mailOptions: { reject?: string } = {}
) {
  const mail = fakeEmailBinding(mailOptions)
  const bindings = {
    EMAIL: mail.binding,
    EMAIL_FROM: FROM,
    APP_URL: APP,
    ...overrides,
  }
  const browser = async () => {
    const client = new TestClient({ env: bindings })
    await client.bootCsrf()
    return client
  }
  const post = async (path: string, json: unknown) =>
    (await browser()).post(path, { csrf: true, json })

  return {
    /** Everything the Worker has handed to the email binding, in order. */
    sent: mail.messages,
    browser,
    /** Registers an account; the returned browser stays signed in to it. */
    async account(password = PASSWORD) {
      const email = uniqueEmail()
      const client = await browser()
      const res = await client.post("/api/auth/register", {
        csrf: true,
        json: { email, password },
      })
      expect(res.status).toBe(201)
      return { email, client }
    },
    forgot: (email: string) => post("/api/auth/forgot-password", { email }),
    reset: (token: string, password: string) =>
      post("/api/auth/reset-password", { token, password }),
    login: (email: string, password: string) =>
      post("/api/auth/login", { email, password }),
    mailTo: (email: string) => mail.messages.filter((m) => m.to === email),
    /** Waits for the nth email to an address (sending finishes after the response). */
    async emails(email: string, count: number) {
      await vi.waitFor(() =>
        expect(mail.messages.filter((m) => m.to === email)).toHaveLength(count)
      )
      return mail.messages.filter((m) => m.to === email)
    },
  }
}

/** The reset link as a person reading the plain-text email would find it. */
const linkOf = (message: Sent) =>
  /https?:\/\/\S+\/reset-password\?token=[\w-]+/.exec(message.text ?? "")![0]
const tokenOf = (message: Sent) =>
  new URL(linkOf(message)).searchParams.get("token")!

/** Lets a deferred send, if one were wrongly scheduled, run before we look. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 40))

afterEach(() => vi.useRealTimers())

describe("POST /api/auth/forgot-password", () => {
  it("emails a reset link to a registered address", async () => {
    const w = world()
    const { email } = await w.account()

    const res = await w.forgot(email)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const [message] = await w.emails(email, 1)
    expect(message.from).toEqual({ email: FROM, name: "OpenChat" })
    expect(message.subject).toBe("Reset your OpenChat password")
    expect(linkOf(message)).toMatch(
      new RegExp(`^${APP}/reset-password\\?token=[\\w-]{32,}$`)
    )
    // The HTML part carries the same link, for mail clients that show it.
    expect(message.html).toContain(linkOf(message))
  })

  it("finds the account whatever the letter case of the address", async () => {
    const w = world()
    const { email } = await w.account()

    const res = await w.forgot(`  ${email.toUpperCase()}  `)

    expect(res.status).toBe(200)
    await w.emails(email, 1)
  })

  it("answers an unknown address exactly as a known one, and sends nothing", async () => {
    // Anything else would turn this form into an account-enumeration oracle.
    const w = world()
    const { email } = await w.account()

    const unknown = await w.forgot(uniqueEmail())
    const known = await w.forgot(email)

    expect(unknown.status).toBe(known.status)
    expect(await unknown.json()).toEqual(await known.json())
    await w.emails(email, 1)
    await settle()
    expect(w.sent).toHaveLength(1)
  })

  it("sends at most three links an hour for one account", async () => {
    const w = world()
    const { email } = await w.account()

    for (let i = 0; i < 4; i++) {
      expect((await w.forgot(email)).status).toBe(200)
    }

    await w.emails(email, 3)
    await settle()
    expect(w.mailTo(email)).toHaveLength(3)
  })

  it("still answers, and sends nothing, when no sender address is configured", async () => {
    const w = world({ EMAIL_FROM: "" })
    const { email } = await w.account()

    const res = await w.forgot(email)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    await settle()
    expect(w.sent).toHaveLength(0)
  })

  it("answers as usual when the email service refuses the send", async () => {
    // E.g. the sending domain was never onboarded. The person at the form must
    // not learn anything from it, and the Worker must not fall over.
    const w = world({}, { reject: "E_SENDER_DOMAIN_NOT_AVAILABLE" })
    const { email } = await w.account()

    const res = await w.forgot(email)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    await settle()
    expect(w.sent).toHaveLength(0)
  })

  it("rejects a malformed address and a malformed body", async () => {
    const w = world()

    const badEmail = await w.forgot("not-an-email")
    expect(badEmail.status).toBe(400)
    expect(await badEmail.json()).toMatchObject({ code: "INVALID_EMAIL" })

    const badBody = await (
      await w.browser()
    ).request("POST", "/api/auth/forgot-password", {
      csrf: true,
      headers: { "content-type": "application/json" },
      raw: "{not json",
    })
    expect(badBody.status).toBe(400)
    expect(await badBody.json()).toMatchObject({ code: "INVALID_JSON" })
  })
})

describe("POST /api/auth/reset-password", () => {
  async function emailedToken(w: ReturnType<typeof world>, email: string) {
    // Counted before asking: the send can land as soon as the response does.
    const before = w.mailTo(email).length
    expect((await w.forgot(email)).status).toBe(200)
    const calls = await w.emails(email, before + 1)
    return tokenOf(calls[calls.length - 1])
  }

  it("sets the new password, retires the old one, and does not sign anyone in", async () => {
    const w = world()
    const { email } = await w.account()
    const token = await emailedToken(w, email)

    const res = await w.reset(token, "new pass")

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(
      res.headers.getSetCookie().some((c) => c.startsWith("openchat_session="))
    ).toBe(false)
    expect((await w.login(email, PASSWORD)).status).toBe(401)
    expect((await w.login(email, "new pass")).status).toBe(200)
  })

  it("takes the same minimal passwords as sign-up", async () => {
    const w = world()
    const { email } = await w.account()

    const res = await w.reset(await emailedToken(w, email), "abc")

    expect(res.status).toBe(200)
    expect((await w.login(email, "abc")).status).toBe(200)
  })

  it("signs the account out everywhere", async () => {
    const w = world()
    const { email, client: signedInElsewhere } = await w.account()
    const token = await emailedToken(w, email)
    expect(
      await (await signedInElsewhere.get("/api/auth/session")).json()
    ).toMatchObject({ user: { email } })

    await w.reset(token, "new pass")

    expect(
      await (await signedInElsewhere.get("/api/auth/session")).json()
    ).toEqual({ user: null })
  })

  it("works once", async () => {
    const w = world()
    const { email } = await w.account()
    const token = await emailedToken(w, email)
    expect((await w.reset(token, "first pass")).status).toBe(200)

    const again = await w.reset(token, "second pass")

    expect(again.status).toBe(400)
    expect(await again.json()).toMatchObject({ code: "INVALID_RESET_TOKEN" })
    expect((await w.login(email, "first pass")).status).toBe(200)
    expect((await w.login(email, "second pass")).status).toBe(401)
  })

  it("expires after an hour", async () => {
    const w = world()
    const { email } = await w.account()
    const token = await emailedToken(w, email)

    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 61 * MINUTE)
    const res = await w.reset(token, "new pass")

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "INVALID_RESET_TOKEN" })
    expect((await w.login(email, PASSWORD)).status).toBe(200)
  })

  it("is still good just inside the hour", async () => {
    const w = world()
    const { email } = await w.account()
    const token = await emailedToken(w, email)

    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 59 * MINUTE)

    expect((await w.reset(token, "new pass")).status).toBe(200)
  })

  it("lets a newer link replace an older one", async () => {
    const w = world()
    const { email } = await w.account()
    const older = await emailedToken(w, email)
    const newer = await emailedToken(w, email)

    const withOlder = await w.reset(older, "new pass")
    expect(withOlder.status).toBe(400)
    expect(await withOlder.json()).toMatchObject({
      code: "INVALID_RESET_TOKEN",
    })
    expect((await w.reset(newer, "new pass")).status).toBe(200)
  })

  it("refuses an unknown or missing token the same way", async () => {
    const w = world()

    for (const token of ["nonsense", "", undefined]) {
      const res = await w.reset(token as string, "new pass")
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: "INVALID_RESET_TOKEN" })
    }
  })

  it("refuses a too-short password without using up the link", async () => {
    const w = world()
    const { email } = await w.account()
    const token = await emailedToken(w, email)

    const tooShort = await w.reset(token, "ab")
    expect(tooShort.status).toBe(400)
    expect(await tooShort.json()).toMatchObject({ code: "INVALID_PASSWORD" })

    expect((await w.reset(token, "abc")).status).toBe(200)
  })
})
