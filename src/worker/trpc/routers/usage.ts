import { z } from "zod"
import * as usage from "../../lib/db/usage"
import { authed, router } from "../init"

const input = z.object({
  range: z.enum(usage.USAGE_RANGES).default("30d"),
  /** Minutes east of UTC, so days follow the user's own clock. */
  tzOffsetMinutes: z.number().int().min(-840).max(840).default(0),
})

const windowOf = (query: z.infer<typeof input>) =>
  usage.usageWindow(query.range, query.tzOffsetMinutes)

/** Display-only statistics from the user's own message history. */
export const usageRouter = router({
  overview: authed
    .input(input)
    .query(({ ctx, input }) =>
      usage.overview(ctx.db, ctx.user.id, windowOf(input))
    ),

  byModel: authed
    .input(input)
    .query(({ ctx, input }) =>
      usage.byModel(ctx.db, ctx.user.id, windowOf(input))
    ),

  byAgent: authed
    .input(input)
    .query(({ ctx, input }) =>
      usage.byAgent(ctx.db, ctx.user.id, windowOf(input))
    ),

  byTopic: authed
    .input(input)
    .query(({ ctx, input }) =>
      usage.byTopic(ctx.db, ctx.user.id, windowOf(input))
    ),

  daily: authed
    .input(input)
    .query(({ ctx, input }) =>
      usage.daily(ctx.db, ctx.user.id, windowOf(input))
    ),
})
