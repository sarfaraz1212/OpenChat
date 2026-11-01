import { newId, now } from "./client"
import type { SessionRow, User } from "./types"
import { findById } from "./users"

/** 30 days. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function create(
  db: D1Database,
  userId: string,
  userAgent?: string | null
): Promise<{ id: string; expiresAt: string }> {
  const id = newId()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  await db
    .prepare(
      `INSERT INTO auth_sessions (id, user_id, expires_at, created_at, user_agent)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, userId, expiresAt, now(), userAgent ?? null)
    .run()
  return { id, expiresAt }
}

/**
 * Resolves a session cookie to a user. Expiry is enforced in the query rather
 * than compared in JS, so a clock difference between isolate and database can
 * never extend a session.
 */
export async function resolve(
  db: D1Database,
  sessionId: string
): Promise<User | null> {
  const row = await db
    .prepare("SELECT * FROM auth_sessions WHERE id = ? AND expires_at > ?")
    .bind(sessionId, now())
    .first<SessionRow>()
  if (!row) return null
  return await findById(db, row.user_id)
}

export async function destroy(
  db: D1Database,
  sessionId: string
): Promise<void> {
  await db
    .prepare("DELETE FROM auth_sessions WHERE id = ?")
    .bind(sessionId)
    .run()
}

/** Signs a user out of every device, e.g. once their password has been reset. */
export async function destroyAllForUser(
  db: D1Database,
  userId: string
): Promise<void> {
  await db
    .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
    .bind(userId)
    .run()
}
