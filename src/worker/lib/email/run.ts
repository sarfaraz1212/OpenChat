import type { AppBindings } from "../../env"
import * as email from "../db/email"
import { appUrl, emailConfigured, sendTransactional } from "./customerio"
import {
  ONBOARDING,
  RELANCE,
  relanceStepForHours,
  type EmailContext,
} from "./templates"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Emails sent per run: a small batch, as the legacy dispatcher sent. */
const BATCH = 20
/** Users looked at per run, per drip. */
const CANDIDATES = 500
/** Only recent sign-ups start the onboarding drip (late starters would get a burst). */
const ONBOARDING_WINDOW_MS = 7 * DAY_MS
/** Past this many hours away a user is beyond the last re-engagement email. */
const RELANCE_WINDOW_MS = 240 * HOUR_MS
/** A user who has been away less than this is not yet quiet. */
const QUIET_AFTER_MS = HOUR_MS
const MAX_ATTEMPTS = 3

const iso = (ms: number) => new Date(ms).toISOString()

/**
 * The onboarding "day" a user is on: 1 during the first 24 hours, 2 during the
 * second, and so on. The email with template id `n` is sent once the user
 * reaches day n + 1, so the day-2 email comes a day after the day-1 email (the
 * legacy comparison sent them an hour apart).
 */
export function onboardingDay(createdAt: string, nowMs: number): number {
  return Math.floor((nowMs + DAY_MS - Date.parse(createdAt)) / DAY_MS)
}

/** Queue the next onboarding email for each user who is due one. */
export async function scheduleOnboarding(
  env: AppBindings,
  nowMs: number
): Promise<number> {
  const users = await email.onboardingCandidates(
    env.DB,
    iso(nowMs - ONBOARDING_WINDOW_MS),
    ONBOARDING.length,
    CANDIDATES
  )
  let queued = 0
  for (const user of users) {
    if (user.onboarding_email_count >= onboardingDay(user.created_at, nowMs)) {
      continue
    }
    await email.enqueue(env.DB, {
      userId: user.id,
      type: "onboarding",
      templateId: user.onboarding_email_count,
    })
    queued++
  }
  return queued
}

/**
 * Queue a re-engagement email for each quiet user: the furthest step their time
 * away has reached. Queuing is idempotent, so a step is sent once per user.
 */
export async function scheduleRelance(
  env: AppBindings,
  nowMs: number
): Promise<number> {
  const users = await email.quietCandidates(
    env.DB,
    iso(nowMs - RELANCE_WINDOW_MS),
    iso(nowMs - QUIET_AFTER_MS),
    CANDIDATES
  )
  let queued = 0
  for (const user of users) {
    const away = (nowMs - Date.parse(user.last_active_at!)) / HOUR_MS
    const step = relanceStepForHours(away)
    if (step === null) continue
    await email.enqueue(env.DB, {
      userId: user.id,
      type: "relance",
      templateId: step,
    })
    queued++
  }
  return queued
}

export type DispatchResult = {
  sent: number
  retrying: number
  failed: number
  skipped: number
}

/** Send the oldest queued emails. A failure is retried on later runs, then given up on. */
export async function dispatchPending(
  env: AppBindings
): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, retrying: 0, failed: 0, skipped: 0 }
  for (const job of await email.pendingJobs(env.DB, BATCH)) {
    const templates = job.type === "relance" ? RELANCE : ONBOARDING
    const template = templates[job.template_id]
    const counter =
      job.type === "relance" ? "relance_step" : "onboarding_email_count"

    if (!job.email || job.deleted_at || !template) {
      await email.setJobStatus(env.DB, job.id, "failed")
      result.failed++
      continue
    }
    // Someone who turned product emails off after the email was queued.
    if (!job.opted_in) {
      await email.setJobStatus(env.DB, job.id, "skipped")
      result.skipped++
      continue
    }

    try {
      const conversation = await email.latestConversationId(env.DB, job.user_id)
      const base = appUrl(env)
      const context: EmailContext = {
        appUrl: base,
        conversationUrl: conversation ? `${base}/chat/${conversation}` : base,
      }
      await sendTransactional(env, {
        messageId: template.messageId,
        to: job.email,
        data: template.variables(context),
      })
      await email.setJobStatus(env.DB, job.id, "sent")
      await email.advanceCounter(
        env.DB,
        job.user_id,
        counter,
        job.template_id + 1
      )
      result.sent++
    } catch (error) {
      console.error(`[email] job ${job.id} failed`, error)
      if (await email.recordFailure(env.DB, job.id, MAX_ATTEMPTS)) {
        // Given up on: move past it so it does not stall the rest of the drip.
        await email.advanceCounter(
          env.DB,
          job.user_id,
          counter,
          job.template_id + 1
        )
        result.failed++
      } else {
        result.retrying++
      }
    }
  }
  return result
}

/** One hourly pass: queue what is due, then send. Does nothing until email is configured. */
export async function runEmailCron(
  env: AppBindings,
  nowMs = Date.now()
): Promise<
  | { skipped: "not configured" }
  | {
      scheduled: { onboarding: number; relance: number }
      dispatched: DispatchResult
    }
> {
  if (!emailConfigured(env)) return { skipped: "not configured" }
  const scheduled = {
    onboarding: await scheduleOnboarding(env, nowMs),
    relance: await scheduleRelance(env, nowMs),
  }
  return { scheduled, dispatched: await dispatchPending(env) }
}
