import { TRPCError } from "@trpc/server"
import { z } from "zod"
import * as research from "../../lib/db/research"
import {
  HOURLY_RUN_LIMIT,
  MAX_TOPIC_CHARS,
  RESEARCH_DEPTHS,
  RESEARCH_MODELS,
  STALE_AFTER_MS,
  STALE_NOTE,
} from "../../lib/research/config"
import { searchProvider } from "../../lib/research/search"
import { modelCanCallTools } from "../../lib/sandbox/enable"
import { authed, router } from "../init"

const HOUR_MS = 60 * 60 * 1000
const idInput = z.object({ id: z.string().min(1) })

const startInput = z.object({
  topic: z
    .string()
    .trim()
    .min(1, "Enter a topic to research")
    .max(
      MAX_TOPIC_CHARS,
      `Research topic is too long. Please keep it under ${MAX_TOPIC_CHARS.toLocaleString()} characters.`
    ),
  depth: z.enum(RESEARCH_DEPTHS).default("standard"),
  /** Honoured only for a catalog model that can call tools. */
  model: z.string().optional(),
})

export const researchRouter = router({
  list: authed.query(async ({ ctx }) => {
    await failStale(ctx.db, ctx.user.id)
    return research.listForUser(ctx.db, ctx.user.id)
  }),

  get: authed.input(idInput).query(async ({ ctx, input }) => {
    await failStale(ctx.db, ctx.user.id)
    const session = await research.findOwned(ctx.db, input.id, ctx.user.id)
    if (!session) throw new TRPCError({ code: "NOT_FOUND" })
    return session
  }),

  /** Start a run in the background; the page polls `get` for its progress. */
  start: authed.input(startInput).mutation(async ({ ctx, input }) => {
    if (!searchProvider(ctx.env) || !ctx.env.RESEARCH_WORKFLOW) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Deep Research is not configured: no web search provider.",
      })
    }
    const since = new Date(Date.now() - HOUR_MS).toISOString()
    if (
      (await research.countSince(ctx.db, ctx.user.id, since)) >=
      HOURLY_RUN_LIMIT
    ) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Rate limit exceeded. You can start up to ${HOURLY_RUN_LIMIT} research runs per hour.`,
      })
    }

    // A run needs a model that drives the search/read loop through real tool
    // calls, so an unsuitable (or unknown) choice falls back to the depth's default.
    const model =
      input.model && modelCanCallTools(input.model)
        ? input.model
        : RESEARCH_MODELS[input.depth]
    const session = await research.create(ctx.db, {
      userId: ctx.user.id,
      topic: input.topic,
      depth: input.depth,
      model,
    })
    try {
      await ctx.env.RESEARCH_WORKFLOW.create({
        id: session.id,
        params: { sessionId: session.id },
      })
    } catch (error) {
      await research.finish(ctx.db, session.id, {
        status: "failed",
        report: "The research run could not be started.",
      })
      console.error("[research] could not start the workflow", error)
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "The research run could not be started. Please try again.",
      })
    }
    return (
      (await research.findOwned(ctx.db, session.id, ctx.user.id)) ?? session
    )
  }),

  remove: authed.input(idInput).mutation(async ({ ctx, input }) => {
    const session = await research.findOwned(ctx.db, input.id, ctx.user.id)
    if (!session) throw new TRPCError({ code: "NOT_FOUND" })
    await research.deleteOwned(ctx.db, session.id, ctx.user.id)
    return { ok: true }
  }),
})

/** A run that started long ago and never finished (a lost instance) is failed, not "running" forever. */
function failStale(db: D1Database, userId: string) {
  return research.failStale(
    db,
    userId,
    new Date(Date.now() - STALE_AFTER_MS).toISOString(),
    STALE_NOTE
  )
}
