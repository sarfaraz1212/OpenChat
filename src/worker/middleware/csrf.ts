import { getCookie } from "hono/cookie"
import { createMiddleware } from "hono/factory"
import type { AppEnv } from "../env"
import { CSRF_COOKIE, CSRF_HEADER, validateCsrfToken } from "../lib/csrf"

const GUARDED_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"])

/**
 * Server-to-server endpoints that no browser calls, so there is no cookie for
 * an attacker to ride. Each one authenticates with its own shared secret (see
 * routes/cron.ts) and is closed when none is configured. Exact matches only.
 */
const CSRF_EXEMPT = new Set(["POST /api/cron/emails"])

/**
 * Compare two tokens without leaking where they differ. The cookie arrives
 * percent-encoded from `document.cookie`, so both sides are decoded first.
 */
function sameToken(header: string, cookie: string): boolean {
  const decode = (value: string) => {
    try {
      return value.includes("%") ? decodeURIComponent(value) : value
    } catch {
      return value
    }
  }
  const a = decode(header)
  const b = decode(cookie)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * CSRF protection for state-changing requests: the csrf_token cookie must be
 * present, the x-csrf-token header must be present, and the header token must
 * equal the cookie and carry a valid server signature.
 *
 * Runs before routing, so it applies to every /api endpoint without each one
 * having to opt in. Registered ahead of every route in app.ts; csrf.test.ts
 * fails if a route is ever mounted in front of it.
 */
export const csrfProtection = createMiddleware<AppEnv>(async (c, next) => {
  if (
    GUARDED_METHODS.has(c.req.method) &&
    !CSRF_EXEMPT.has(`${c.req.method} ${c.req.path}`)
  ) {
    const cookieToken = getCookie(c, CSRF_COOKIE)
    const headerToken = c.req.header(CSRF_HEADER)

    // validateCsrfToken is async (WebCrypto). The await is load-bearing: without
    // it this expression is a promise, which is always truthy, and CSRF checks
    // pass unconditionally. csrf.test.ts fails if it is ever dropped.
    // Classic double submit: the header must carry the caller's OWN cookie, not
    // merely a token this server once signed. Without this, anyone can fetch a
    // valid token from /api/csrf and send it with a victim's cookies.
    const csrfValid =
      Boolean(cookieToken) &&
      Boolean(headerToken) &&
      sameToken(headerToken as string, cookieToken as string) &&
      (await validateCsrfToken(headerToken as string, c.env.CSRF_SECRET))

    if (!csrfValid) {
      return c.json({ error: "Invalid CSRF token", code: "INVALID_CSRF" }, 403)
    }
  }

  await next()
})
