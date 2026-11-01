import { now } from "./client"

/** The user counters the drips advance, so a step is not repeated. */
type Counter = "onboarding_email_count" | "relance_step"

export type Recipient = {
  id: string
  email: string
  created_at: string
  last_active_at: string | null
  onboarding_email_count: number
}

export type PendingJob = {
  id: number
  user_id: string
  type: "onboarding" | "relance"
  template_id: number
  attempts: number
  email: string | null
  opted_in: number
  deleted_at: string | null
}

const ELIGIBLE =
  "anonymous = 0 AND deleted_at IS NULL AND opted_in_for_email_updates = 1"

/**
 * Users still in the onboarding drip who signed up since `since`. Older
 * sign-ups are not caught up: a drip that starts late would arrive in a burst.
 */
export async function onboardingCandidates(
  db: D1Database,
  since: string,
  steps: number,
  limit: number
): Promise<Recipient[]> {
  const { results } = await db
    .prepare(
      `SELECT id, email, created_at, last_active_at, onboarding_email_count
         FROM users
        WHERE ${ELIGIBLE} AND onboarding_email_count < ? AND created_at >= ?
        ORDER BY created_at ASC LIMIT ?`
    )
    .bind(steps, since, limit)
    .all<Recipient>()
  return results ?? []
}

/** Users last active between `activeAfter` and `inactiveBefore`: quiet, but within the drip. */
export async function quietCandidates(
  db: D1Database,
  activeAfter: string,
  inactiveBefore: string,
  limit: number
): Promise<Recipient[]> {
  const { results } = await db
    .prepare(
      `SELECT id, email, created_at, last_active_at, onboarding_email_count
         FROM users
        WHERE ${ELIGIBLE} AND last_active_at IS NOT NULL
          AND last_active_at > ? AND last_active_at < ?
        ORDER BY last_active_at ASC LIMIT ?`
    )
    .bind(activeAfter, inactiveBefore, limit)
    .all<Recipient>()
  return results ?? []
}

/** Queue one email for a user. The (user, type, template) key makes this idempotent. */
export async function enqueue(
  db: D1Database,
  job: { userId: string; type: "onboarding" | "relance"; templateId: number }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_jobs (user_id, type, template_id, status, created_at)
       VALUES (?, ?, ?, 'pending', ?)
       ON CONFLICT(user_id, type, template_id) DO NOTHING`
    )
    .bind(job.userId, job.type, job.templateId, now())
    .run()
}

export async function pendingJobs(
  db: D1Database,
  limit: number
): Promise<PendingJob[]> {
  const { results } = await db
    .prepare(
      `SELECT j.id, j.user_id, j.type, j.template_id, j.attempts,
              u.email AS email,
              COALESCE(u.opted_in_for_email_updates, 0) AS opted_in,
              u.deleted_at AS deleted_at
         FROM email_jobs j LEFT JOIN users u ON u.id = j.user_id
        WHERE j.status = 'pending'
        ORDER BY j.created_at ASC, j.id ASC LIMIT ?`
    )
    .bind(limit)
    .all<PendingJob>()
  return results ?? []
}

export async function setJobStatus(
  db: D1Database,
  id: number,
  status: "sent" | "failed" | "skipped"
): Promise<void> {
  await db
    .prepare("UPDATE email_jobs SET status = ? WHERE id = ?")
    .bind(status, id)
    .run()
}

/** Record a failed attempt; after `maxAttempts` the job is failed for good. Returns whether it was. */
export async function recordFailure(
  db: D1Database,
  id: number,
  maxAttempts: number
): Promise<boolean> {
  const row = await db
    .prepare(
      `UPDATE email_jobs
          SET attempts = attempts + 1,
              status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
        WHERE id = ? RETURNING status`
    )
    .bind(maxAttempts, id)
    .first<{ status: string }>()
  return row?.status === "failed"
}

/** Move a user's counter past a template, never backwards. */
export async function advanceCounter(
  db: D1Database,
  userId: string,
  column: Counter,
  value: number
): Promise<void> {
  await db
    .prepare(`UPDATE users SET ${column} = MAX(${column}, ?) WHERE id = ?`)
    .bind(value, userId)
    .run()
}

/** The user's most recent conversation (a goal task's workspace is not one). */
export async function latestConversationId(
  db: D1Database,
  userId: string
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM topics
        WHERE user_id = ?
          AND json_extract(COALESCE(metadata, '{}'), '$.taskId') IS NULL
        ORDER BY updated_at DESC LIMIT 1`
    )
    .bind(userId)
    .first<{ id: string }>()
  return row?.id ?? null
}
