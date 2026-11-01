import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import type { AppEnv } from "../../env"
import * as sessionsRepo from "../db/sessions"
import type { User } from "../db/types"
import { cookieSecure } from "../http"

export const SESSION_COOKIE = "openchat_session"

/**
 * Reads the session cookie and resolves it to a user.
 *
 * Returns null for absent, expired or unknown sessions alike — callers must not
 * be able to distinguish those cases.
 */
export async function getCurrentUser(c: Context<AppEnv>): Promise<User | null> {
  const sessionId = getCookie(c, SESSION_COOKIE)
  if (!sessionId) return null
  return await sessionsRepo.resolve(c.env.DB, sessionId)
}

export async function startSession(
  c: Context<AppEnv>,
  userId: string,
  userAgent?: string | null
): Promise<void> {
  const { id, expiresAt } = await sessionsRepo.create(
    c.env.DB,
    userId,
    userAgent
  )
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    secure: cookieSecure(c),
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
  })
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const sessionId = getCookie(c, SESSION_COOKIE)
  if (sessionId) await sessionsRepo.destroy(c.env.DB, sessionId)
  deleteCookie(c, SESSION_COOKIE, { path: "/" })
}
