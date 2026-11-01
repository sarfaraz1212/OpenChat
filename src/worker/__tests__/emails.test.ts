import { afterEach, describe, expect, it, vi } from "vitest"
import { TestClient } from "../test/client"
import { fakeCustomerIo, type MailCall } from "../test/fake-mail"
import {
  PASSWORD,
  signedInClient,
  trpcMutation,
  trpcQuery,
} from "../test/helpers"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const START = Date.UTC(2026, 8, 1, 12, 0, 0)
const at = (ms: number) => vi.setSystemTime(START + ms)

const ONBOARDING_IDS = ["24", "25", "26", "27", "28", "29"]
const RELANCE_IDS = [
  "30",
  "35",
  "34",
  "36",
  "38",
  "32",
  "31",
  "33",
  "37",
  "43",
  "44",
  "45",
]
const APP = "https://app.test"

type Account = { email: string; emailUpdates: boolean }

async function emailWorld(
  options: {
    handler?: (call: MailCall) => Response | undefined
    env?: Record<string, string>
  } = {}
) {
  vi.useFakeTimers({ toFake: ["Date"] })
  at(0)
  const io = fakeCustomerIo(options.handler)
  const client = await signedInClient(undefined, {
    CUSTOMERIO_API_KEY: "cio-key",
    CRON_SECRET: "cron-secret",
    APP_URL: APP,
    OUTBOUND_FETCH: io.fetch,
    ...options.env,
  })
  const account = (await trpcQuery<Account>(client, "account.get")).data!
  const cron = () =>
    client.post("/api/cron/emails", {
      headers: { authorization: "Bearer cron-secret" },
    })
  // The cron emails every eligible user, and users registered by earlier tests
  // are still there, so assertions look only at this world's own recipient.
  const mine = () => io.calls.filter((call) => call.body.to === account.email)
  const only = (ids: string[]) =>
    mine()
      .map((call) => call.body.transactional_message_id)
      .filter((id) => ids.includes(id))
  const sent = (messageId: string) =>
    mine().find((call) => call.body.transactional_message_id === messageId)
  return { io, client, email: account.email, cron, only, mine, sent }
}

afterEach(() => vi.useRealTimers())

describe("the onboarding emails", () => {
  it("sends one a day, starting at sign-up, with the links each one needs", async () => {
    const w = await emailWorld()

    await w.cron()
    expect(w.mine()[0]).toMatchObject({
      auth: "Bearer cio-key",
      body: {
        transactional_message_id: "24",
        to: w.email,
        identifiers: { email: w.email },
        message_data: { loginUrl: APP },
      },
    })

    // The day-2 email does not follow the day-1 email an hour later.
    at(30 * 60 * 1000)
    await w.cron()
    at(HOUR)
    await w.cron()
    expect(w.only(ONBOARDING_IDS)).toEqual(["24"])

    for (const day of [1, 2, 3, 4, 5, 6]) {
      at(day * DAY)
      await w.cron()
    }
    expect(w.only(ONBOARDING_IDS)).toEqual(ONBOARDING_IDS)

    expect(w.sent("27")!.body.message_data).toEqual({
      deepSearchUrl: `${APP}/deep-research`,
    })
    expect(w.sent("28")!.body.message_data).toEqual({
      generateImageUrl: `${APP}/images`,
    })
    // Six emails, then no more, however often the cron runs.
    at(30 * DAY)
    await w.cron()
    expect(w.only(ONBOARDING_IDS)).toHaveLength(6)
  })

  it("does not send the same email twice when the cron runs again", async () => {
    const w = await emailWorld()

    await w.cron()
    await w.cron()
    await w.cron()

    expect(w.only(ONBOARDING_IDS)).toEqual(["24"])
  })
})

describe("the re-engagement emails", () => {
  it("follow a quiet user at 1, 5, 24, 48 ... 216 hours, each once", async () => {
    const w = await emailWorld()
    // Silent for the first half hour: nothing to say yet.
    at(30 * 60 * 1000)
    await w.cron()
    expect(w.only(RELANCE_IDS)).toEqual([])

    const ladder: Array<[number, string]> = [
      [1.5, "30"],
      [5.5, "35"],
      [24.5, "34"],
      [48.5, "36"],
      [60.5, "38"],
      [72.5, "32"],
      [96.5, "31"],
      [120.5, "33"],
      [144.5, "37"],
      [168.5, "43"],
      [192.5, "44"],
      [216.5, "45"],
    ]
    for (const [hours, id] of ladder) {
      at(hours * HOUR)
      await w.cron()
      await w.cron() // a second run in the same hour adds nothing
      expect(w.only(RELANCE_IDS).at(-1)).toBe(id)
    }
    expect(w.only(RELANCE_IDS)).toEqual(ladder.map(([, id]) => id))
  })

  it("send the step the user has reached, not the ones they slept through", async () => {
    const w = await emailWorld()

    at(6 * HOUR)
    await w.cron()

    expect(w.only(RELANCE_IDS)).toEqual(["35"])
  })

  it("link to the latest conversation, or to the app when there is none", async () => {
    const w = await emailWorld()
    at(90 * 60 * 1000)
    await w.cron()
    expect(w.sent("30")!.body.message_data).toEqual({
      loginUrl: APP,
      conversationUrl: APP,
    })

    at(2 * HOUR)
    await trpcMutation<{ id: string }>(w.client, "topic.create", {})
    at(3 * HOUR)
    const newest = await trpcMutation<{ id: string }>(
      w.client,
      "topic.create",
      {}
    )
    at(25 * HOUR)
    await w.cron()

    // The most recent conversation, not the first one they ever started.
    expect(w.sent("34")!.body.message_data).toEqual({
      conversationUrl: `${APP}/chat/${newest.data!.id}`,
    })
  })

  it("stop for a user who is chatting", async () => {
    const w = await emailWorld()
    at(30 * HOUR)
    const topic = await trpcMutation<{ id: string }>(
      w.client,
      "topic.create",
      {}
    )
    const sent = await w.client.post(
      `/api/chat/topics/${topic.data!.id}/messages`,
      { csrf: true, json: { content: "Hello" } }
    )
    await sent.text()

    at(30.5 * HOUR)
    await w.cron()

    expect(w.only(RELANCE_IDS)).toEqual([])
  })
})

describe("who gets email", () => {
  it("nobody who has turned product emails off, until they turn them back on", async () => {
    const w = await emailWorld()
    await trpcMutation(w.client, "account.setEmailUpdates", { enabled: false })
    expect(
      (await trpcQuery<Account>(w.client, "account.get")).data?.emailUpdates
    ).toBe(false)

    at(2 * DAY)
    await w.cron()
    expect(w.mine()).toHaveLength(0)

    await trpcMutation(w.client, "account.setEmailUpdates", { enabled: true })
    await w.cron()
    expect(w.mine().length).toBeGreaterThan(0)
  })

  it("nobody who opts out after an email is already queued", async () => {
    let refuse = true
    const w = await emailWorld({
      handler: () =>
        refuse ? new Response("try later", { status: 503 }) : undefined,
    })

    // Queued and attempted, so the job is waiting to be retried.
    await w.cron()
    expect(w.only(ONBOARDING_IDS)).toEqual(["24"])

    refuse = false
    await trpcMutation(w.client, "account.setEmailUpdates", { enabled: false })
    await w.cron()

    expect(w.only(ONBOARDING_IDS)).toEqual(["24"])
  })

  it("nobody at all while Customer.io is not configured", async () => {
    const w = await emailWorld({ env: { CUSTOMERIO_API_KEY: "" } })

    const response = await w.cron()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ skipped: "not configured" })
    expect(w.io.calls).toHaveLength(0)
  })
})

describe("when sending fails", () => {
  it("tries again on the next run", async () => {
    let refuse = true
    const w = await emailWorld({
      handler: () =>
        refuse ? new Response("try later", { status: 503 }) : undefined,
    })

    await w.cron()
    expect(w.only(ONBOARDING_IDS)).toEqual(["24"]) // attempted
    refuse = false
    await w.cron()

    expect(w.only(ONBOARDING_IDS)).toEqual(["24", "24"]) // and delivered
    await w.cron()
    expect(w.only(ONBOARDING_IDS)).toEqual(["24", "24"]) // then not again
  })

  it("gives up on one email after three tries and carries on with the next", async () => {
    const w = await emailWorld({
      handler: (call) =>
        call.body.transactional_message_id === "24"
          ? new Response("rejected", { status: 400 })
          : undefined,
    })

    for (let i = 0; i < 5; i++) await w.cron()
    expect(w.only(["24"])).toHaveLength(3)

    at(DAY)
    await w.cron()
    expect(w.only(ONBOARDING_IDS)).toEqual(["24", "24", "24", "25"])
  })
})

describe("the cron endpoint", () => {
  it("answers only to its own secret, and needs no CSRF token", async () => {
    const w = await emailWorld()
    const anonymous = new TestClient({ env: { CRON_SECRET: "cron-secret" } })

    expect((await anonymous.post("/api/cron/emails")).status).toBe(401)
    expect(
      (
        await anonymous.post("/api/cron/emails", {
          headers: { authorization: "Bearer wrong" },
        })
      ).status
    ).toBe(401)
    expect(
      (
        await anonymous.post("/api/cron/emails", {
          headers: { authorization: "cron-secret" },
        })
      ).status
    ).toBe(401)
    expect((await w.cron()).status).toBe(200)
  })

  it("is closed when no secret is configured", async () => {
    const w = await emailWorld({ env: { CRON_SECRET: "" } })

    const response = await w.client.post("/api/cron/emails", {
      headers: { authorization: "Bearer " },
    })

    expect(response.status).toBe(503)
    expect(w.io.calls).toHaveLength(0)
  })
})

describe("changing the account email", () => {
  it("changes it, tells the new address, and signs in with it", async () => {
    const w = await emailWorld()
    const next = `changed-${crypto.randomUUID()}@openchat-tests.dev`

    const result = await trpcMutation<Account>(
      w.client,
      "account.changeEmail",
      { newEmail: next.toUpperCase() }
    )

    expect(result.data?.email).toBe(next)
    expect(w.mine()).toHaveLength(0) // the notice goes to the NEW address
    expect(w.io.calls).toHaveLength(1)
    expect(w.io.calls[0].body).toMatchObject({
      transactional_message_id: "39",
      to: next,
      message_data: { loginUrl: APP, email: next },
    })
    const fresh = new TestClient()
    await fresh.bootCsrf()
    const login = await fresh.post("/api/auth/login", {
      csrf: true,
      json: { email: next, password: PASSWORD },
    })
    expect(login.status).toBe(200)
  })

  it("refuses a bad, unchanged, disposable or taken address", async () => {
    const w = await emailWorld()
    const other = await signedInClient(undefined, {})
    const taken = (await trpcQuery<Account>(other, "account.get")).data!.email

    const refusals = []
    for (const newEmail of [
      "not-an-email",
      w.email,
      "someone@mailinator.com",
      taken,
    ]) {
      refusals.push(
        await trpcMutation(w.client, "account.changeEmail", { newEmail })
      )
    }

    expect(refusals.map((r) => r.code)).toEqual([
      "BAD_REQUEST",
      "BAD_REQUEST",
      "BAD_REQUEST",
      "CONFLICT",
    ])
    expect(refusals[2].message).toMatch(/permanent email address/)
    expect(
      (await trpcQuery<Account>(w.client, "account.get")).data?.email
    ).toBe(w.email)
    expect(w.io.calls).toHaveLength(0)
  })

  it("still changes it when the notice cannot be sent", async () => {
    const w = await emailWorld({
      handler: () => new Response("down", { status: 500 }),
    })
    const next = `changed-${crypto.randomUUID()}@openchat-tests.dev`

    const result = await trpcMutation(w.client, "account.changeEmail", {
      newEmail: next,
    })

    expect(result.code).toBeUndefined()
    expect(
      (await trpcQuery<Account>(w.client, "account.get")).data?.email
    ).toBe(next)
  })

  it("needs a signed-in user", async () => {
    const anonymous = new TestClient()
    await anonymous.bootCsrf()

    expect((await trpcQuery(anonymous, "account.get")).code).toBe(
      "UNAUTHORIZED"
    )
    expect(
      (
        await trpcMutation(anonymous, "account.changeEmail", {
          newEmail: "a@b.co",
        })
      ).code
    ).toBe("UNAUTHORIZED")
  })
})
