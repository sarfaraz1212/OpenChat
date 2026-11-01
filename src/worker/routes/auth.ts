import { Hono, type Context } from "hono"
import type { AppEnv } from "../env"
import { isDisposableEmail } from "../lib/auth/disposableEmail"
import { canonicalizeEmail, normalizeEmail } from "../lib/auth/emailIdentity"
import {
  decoyHash,
  hashPassword,
  validatePasswordShape,
  verifyPassword,
} from "../lib/auth/password"
import { hashResetToken, newResetToken } from "../lib/auth/resetToken"
import { endSession, getCurrentUser, startSession } from "../lib/auth/session"
import * as resets from "../lib/db/password-resets"
import * as sessionsRepo from "../lib/db/sessions"
import * as users from "../lib/db/users"
import { appUrl } from "../lib/email/customerio"
import {
  resetEmailConfigured,
  sendPasswordResetEmail,
} from "../lib/email/reset"

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The parsed body when it is a JSON object, otherwise null. */
async function readJsonObject<T>(c: Context<AppEnv>): Promise<T | null> {
  try {
    const body: unknown = await c.req.json()
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as T)
      : null
  } catch {
    return null
  }
}

const invalidJson = (c: Context<AppEnv>) =>
  c.json(
    { error: "Request body must be a JSON object.", code: "INVALID_JSON" },
    400
  )

export const auth = new Hono<AppEnv>()

auth.post("/register", async (c) => {
  try {
    const body = await readJsonObject<{
      email?: string
      password?: string
      displayName?: string
    }>(c)
    if (!body) return invalidJson(c)

    // Normalize before anything else so the duplicate check and the stored row
    // agree. Without this `Foo@x.com` slips past the existing-user check and
    // becomes a second account.
    const email = normalizeEmail(body.email ?? "")
    const password = body.password ?? ""

    if (!EMAIL_SHAPE.test(email)) {
      return c.json(
        { error: "Enter a valid email address.", code: "INVALID_EMAIL" },
        400
      )
    }

    const passwordError = validatePasswordShape(password)
    if (passwordError) {
      return c.json({ error: passwordError, code: "INVALID_PASSWORD" }, 400)
    }

    // Reject disposable addresses before creating anything. Doing it here rather
    // than later keeps junk rows out of D1 and avoids sending mail to domains
    // that bounce, which would damage our sending reputation.
    //
    // Some blocked domains WILL be false positives (upstream makes no currency
    // guarantee), so the message names a way out and ALLOW_OVERRIDE exists for
    // support to unblock in one line.
    if (isDisposableEmail(email)) {
      return c.json(
        {
          error:
            "Please sign up with a permanent email address. Temporary or disposable " +
            "email addresses are not supported. If this is your regular address, " +
            "contact support and we will enable it.",
          code: "DISPOSABLE_EMAIL",
        },
        400
      )
    }

    if (await users.findByEmail(c.env.DB, email)) {
      return c.json(
        {
          error: "An account with this email already exists.",
          code: "EMAIL_TAKEN",
        },
        409
      )
    }

    const passwordHash = await hashPassword(password)
    const user = await users.createRegistered(c.env.DB, {
      email,
      // Anti-abuse only — never consulted for login. See emailIdentity.ts.
      emailCanonical: canonicalizeEmail(email),
      passwordHash,
      displayName: body.displayName?.trim() || null,
    })

    await startSession(c, user.id, c.req.header("user-agent"))

    return c.json({ user }, 201)
  } catch (err) {
    console.error("[/api/auth/register]", err)
    return c.json(
      { error: "Could not create your account. Please try again." },
      500
    )
  }
})

auth.post("/login", async (c) => {
  try {
    const body = await readJsonObject<{ email?: string; password?: string }>(c)
    if (!body) return invalidJson(c)

    const email = normalizeEmail(body.email ?? "")
    const password = body.password ?? ""

    const row = await users.findByEmailWithSecret(c.env.DB, email)

    // One message and one status for "no such user" and "wrong password" alike:
    // distinguishing them turns the login form into an account-enumeration
    // oracle. An unknown email is verified against a decoy hash rather than
    // skipped, so both answers cost the same PBKDF2 work and the timing does
    // not give away which accounts exist.
    const passwordMatches = await verifyPassword(
      password,
      row?.password_hash ?? (await decoyHash())
    )
    if (!row || !passwordMatches) {
      return c.json(
        { error: "Incorrect email or password.", code: "INVALID_CREDENTIALS" },
        401
      )
    }

    await startSession(c, row.id, c.req.header("user-agent"))
    await users.touchLastActive(c.env.DB, row.id)

    const user = await users.findById(c.env.DB, row.id)
    return c.json({ user }, 200)
  } catch (err) {
    console.error("[/api/auth/login]", err)
    return c.json({ error: "Could not sign you in." }, 500)
  }
})

auth.post("/logout", async (c) => {
  try {
    await endSession(c)
    return c.json({ ok: true })
  } catch (err) {
    console.error("[/api/auth/logout]", err)
    return c.json({ error: "Could not sign you out." }, 500)
  }
})

const HOUR_MS = 60 * 60 * 1000

/**
 * Asks for a password reset link by email.
 *
 * Every well-formed request gets the same `{ ok: true }`, whether or not the
 * address has an account, so this cannot be used to find out who is registered.
 * The email itself goes out after the response (the slow part, which would
 * otherwise make known addresses measurably slower to answer); what is left
 * different is one database write.
 */
auth.post("/forgot-password", async (c) => {
  try {
    const body = await readJsonObject<{ email?: string }>(c)
    if (!body) return invalidJson(c)

    const email = normalizeEmail(body.email ?? "")
    if (!EMAIL_SHAPE.test(email)) {
      return c.json(
        { error: "Enter a valid email address.", code: "INVALID_EMAIL" },
        400
      )
    }

    if (!resetEmailConfigured(c.env)) {
      console.warn(
        "[/api/auth/forgot-password] not sent: set EMAIL_FROM and APP_URL"
      )
      return c.json({ ok: true })
    }

    const user = await users.findByEmail(c.env.DB, email)
    if (!user || user.anonymous) return c.json({ ok: true })

    // A cap per account, so the form cannot be used to flood someone's inbox.
    const since = new Date(Date.now() - HOUR_MS).toISOString()
    if (
      (await resets.recentCount(c.env.DB, user.id, since)) >=
      resets.RESETS_PER_HOUR
    ) {
      return c.json({ ok: true })
    }

    const token = newResetToken()
    await resets.issue(c.env.DB, user.id, await hashResetToken(token))
    c.executionCtx.waitUntil(
      sendPasswordResetEmail(c.env, {
        to: user.email,
        resetUrl: `${appUrl(c.env)}/reset-password?token=${token}`,
      }).catch((err: unknown) =>
        console.error("[/api/auth/forgot-password] send failed", err)
      )
    )
    return c.json({ ok: true })
  } catch (err) {
    console.error("[/api/auth/forgot-password]", err)
    return c.json(
      { error: "Could not send a reset link. Please try again." },
      500
    )
  }
})

/**
 * Sets a new password using a link from the email. The link is used up, every
 * existing session is ended, and nobody is signed in by this call: whoever
 * holds the link has to sign in with the new password like anyone else.
 */
auth.post("/reset-password", async (c) => {
  try {
    const body = await readJsonObject<{ token?: unknown; password?: string }>(c)
    if (!body) return invalidJson(c)

    const password = body.password ?? ""
    const passwordError = validatePasswordShape(password)
    if (passwordError) {
      // Checked before the link is touched, so a typo does not cost the link.
      return c.json({ error: passwordError, code: "INVALID_PASSWORD" }, 400)
    }

    const passwordHash = await hashPassword(password)
    const token = typeof body.token === "string" ? body.token : ""
    const userId = token
      ? await resets.consume(c.env.DB, await hashResetToken(token))
      : null
    if (!userId) {
      return c.json(
        {
          error:
            "This reset link is invalid or has expired. Request a new one.",
          code: "INVALID_RESET_TOKEN",
        },
        400
      )
    }

    await users.setPasswordHash(c.env.DB, userId, passwordHash)
    await sessionsRepo.destroyAllForUser(c.env.DB, userId)
    return c.json({ ok: true })
  } catch (err) {
    console.error("[/api/auth/reset-password]", err)
    return c.json(
      { error: "Could not reset your password. Please try again." },
      500
    )
  }
})

auth.get("/session", async (c) => {
  try {
    return c.json({ user: await getCurrentUser(c) })
  } catch (err) {
    console.error("[/api/auth/session]", err)
    return c.json({ user: null })
  }
})
