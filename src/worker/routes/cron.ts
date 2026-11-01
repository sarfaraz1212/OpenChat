import { Hono } from "hono"
import type { AppEnv } from "../env"
import { runEmailCron } from "../lib/email/run"

/** Compare two secrets without leaking, by length or timing, how much matched. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    )
  const [a, b] = await Promise.all([digest(given), digest(expected)])
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}

/**
 * Server-to-server endpoints for scheduled work. They are exempt from CSRF (no
 * browser calls them) and guarded by a shared secret instead; without one
 * configured they are closed. The hourly cron trigger runs the same work
 * in-process.
 */
export const cron = new Hono<AppEnv>().post("/emails", async (c) => {
  const secret = c.env.CRON_SECRET
  if (!secret) {
    return c.json(
      { error: "Cron endpoints are not configured", code: "NOT_CONFIGURED" },
      503
    )
  }
  const header = c.req.header("authorization") ?? ""
  const given = header.startsWith("Bearer ") ? header.slice(7) : ""
  if (!(await sameSecret(given, secret))) {
    return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401)
  }
  return c.json({ ok: true, ...(await runEmailCron(c.env)) })
})
