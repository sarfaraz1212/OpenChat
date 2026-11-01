import { now } from "./client"

/**
 * Per-user overrides of the catalog defaults. A missing row means "use the
 * default" (enabled), so both readers return only the deviations.
 */

export async function listProviderOverrides(
  db: D1Database,
  userId: string
): Promise<Map<string, boolean>> {
  const { results } = await db
    .prepare("SELECT id, enabled FROM ai_providers WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string; enabled: number }>()
  return new Map((results ?? []).map((row) => [row.id, row.enabled === 1]))
}

export async function listModelOverrides(
  db: D1Database,
  userId: string,
  providerId: string
): Promise<Map<string, boolean>> {
  const { results } = await db
    .prepare(
      "SELECT id, enabled FROM ai_models WHERE user_id = ? AND provider_id = ?"
    )
    .bind(userId, providerId)
    .all<{ id: string; enabled: number }>()
  return new Map((results ?? []).map((row) => [row.id, row.enabled === 1]))
}

export async function setProviderEnabled(
  db: D1Database,
  params: { userId: string; providerId: string; enabled: boolean }
): Promise<void> {
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO ai_providers (id, user_id, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id, user_id)
       DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
    )
    .bind(
      params.providerId,
      params.userId,
      Number(params.enabled),
      timestamp,
      timestamp
    )
    .run()
}

export async function setModelsEnabled(
  db: D1Database,
  params: {
    userId: string
    providerId: string
    ids: string[]
    enabled: boolean
  }
): Promise<void> {
  const timestamp = now()
  await db.batch(
    params.ids.map((id) =>
      db
        .prepare(
          `INSERT INTO ai_models
             (id, provider_id, user_id, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (id, provider_id, user_id)
           DO UPDATE SET enabled = excluded.enabled,
                         updated_at = excluded.updated_at`
        )
        .bind(
          id,
          params.providerId,
          params.userId,
          Number(params.enabled),
          timestamp,
          timestamp
        )
    )
  )
}
