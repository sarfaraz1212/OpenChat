import { now } from "./client"

/** How long an emailed link stays valid. */
const RESET_TTL_MS = 60 * 60 * 1000

/** Links one account may be sent in any hour; asking for more is ignored. */
export const RESETS_PER_HOUR = 3

/** Links created for an account since `sinceIso`, used or not. */
export async function recentCount(
  db: D1Database,
  userId: string,
  sinceIso: string
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > ?"
    )
    .bind(userId, sinceIso)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/** Records a new link and retires the account's older ones, so only the latest works. */
export async function issue(
  db: D1Database,
  userId: string,
  tokenHash: string
): Promise<void> {
  const ts = now()
  await db.batch([
    db
      .prepare(
        "UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL"
      )
      .bind(ts, userId),
    db
      .prepare(
        `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(
        tokenHash,
        userId,
        ts,
        new Date(Date.now() + RESET_TTL_MS).toISOString()
      ),
  ])
}

/**
 * Uses a link up and returns the account it belongs to, or null when it is
 * unknown, already used or expired. One statement, so two requests carrying the
 * same link cannot both succeed, and expiry is judged by the database's clock
 * comparison rather than in JS.
 */
export async function consume(
  db: D1Database,
  tokenHash: string
): Promise<string | null> {
  const ts = now()
  const row = await db
    .prepare(
      `UPDATE password_resets SET used_at = ?
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
       RETURNING user_id`
    )
    .bind(ts, tokenHash, ts)
    .first<{ user_id: string }>()
  return row?.user_id ?? null
}
