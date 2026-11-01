import { newId, now, parseJson, toBool } from "./client"
import type { User, UserRow } from "./types"

function hydrate(row: UserRow): User {
  const { password_hash: _password_hash, ...rest } = row
  return {
    ...rest,
    anonymous: toBool(row.anonymous),
    opted_in_for_email_updates: toBool(row.opted_in_for_email_updates),
    favorite_models: parseJson<string[]>(row.favorite_models, []),
  }
}

export async function findById(
  db: D1Database,
  userId: string
): Promise<User | null> {
  const row = await db
    .prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL")
    .bind(userId)
    .first<UserRow>()
  return row ? hydrate(row) : null
}

/**
 * Lookup by IDENTITY (normalized email), not canonical form. `a+work@gmail.com`
 * and `a@gmail.com` are legitimately separate accounts.
 */
export async function findByEmail(
  db: D1Database,
  email: string
): Promise<User | null> {
  const row = await db
    .prepare("SELECT * FROM users WHERE email = ? AND deleted_at IS NULL")
    .bind(email)
    .first<UserRow>()
  return row ? hydrate(row) : null
}

/** Includes password_hash — only for the login path. */
export async function findByEmailWithSecret(
  db: D1Database,
  email: string
): Promise<UserRow | null> {
  return await db
    .prepare("SELECT * FROM users WHERE email = ? AND deleted_at IS NULL")
    .bind(email)
    .first<UserRow>()
}

export async function createRegistered(
  db: D1Database,
  params: {
    email: string
    emailCanonical: string
    passwordHash: string
    displayName?: string | null
  }
): Promise<User> {
  const id = newId()
  const ts = now()
  await db
    .prepare(
      `INSERT INTO users (id, email, email_canonical, password_hash, anonymous,
                          display_name, message_count, created_at, last_active_at)
       VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?)`
    )
    .bind(
      id,
      params.email,
      params.emailCanonical,
      params.passwordHash,
      params.displayName ?? null,
      ts,
      ts
    )
    .run()
  const created = await findById(db, id)
  if (!created) throw new Error("Failed to create user")
  return created
}

export async function touchLastActive(
  db: D1Database,
  userId: string
): Promise<void> {
  await db
    .prepare("UPDATE users SET last_active_at = ? WHERE id = ?")
    .bind(now(), userId)
    .run()
}

export async function setPasswordHash(
  db: D1Database,
  userId: string,
  passwordHash: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET password_hash = ? WHERE id = ? AND deleted_at IS NULL"
    )
    .bind(passwordHash, userId)
    .run()
}

export async function setEmail(
  db: D1Database,
  userId: string,
  email: string,
  emailCanonical: string
): Promise<void> {
  await db
    .prepare("UPDATE users SET email = ?, email_canonical = ? WHERE id = ?")
    .bind(email, emailCanonical, userId)
    .run()
}

/** Whether the onboarding and re-engagement emails may be sent to this user. */
export async function setEmailUpdates(
  db: D1Database,
  userId: string,
  enabled: boolean
): Promise<void> {
  await db
    .prepare("UPDATE users SET opted_in_for_email_updates = ? WHERE id = ?")
    .bind(enabled ? 1 : 0, userId)
    .run()
}
