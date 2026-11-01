import { Hono } from "hono"
import { setCookie } from "hono/cookie"
import type { AppEnv } from "../env"
import { CSRF_COOKIE, generateCsrfToken } from "../lib/csrf"
import { cookieSecure } from "../lib/http"

export const csrf = new Hono<AppEnv>().get("/", async (c) => {
  const token = await generateCsrfToken(c.env.CSRF_SECRET)
  setCookie(c, CSRF_COOKIE, token, {
    // The SPA reads this cookie and echoes it back in x-csrf-token.
    httpOnly: false,
    secure: cookieSecure(c),
    sameSite: "Lax",
    path: "/",
  })
  return c.json({ ok: true })
})
