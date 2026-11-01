import { TRPCError } from "@trpc/server"
import { z } from "zod"
import * as messages from "../../lib/db/messages"
import { authed, router } from "../init"

export const messageRouter = router({
  update: authed
    .input(
      z.object({
        id: z.string().min(1),
        content: z.string().trim().min(1).max(10_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const message = await messages.updateContent(ctx.db, {
        id: input.id,
        userId: ctx.user.id,
        content: input.content,
      })
      if (!message) throw new TRPCError({ code: "NOT_FOUND" })
      return message
    }),

  remove: authed
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await messages.remove(ctx.db, input.id, ctx.user.id))) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      return { ok: true }
    }),
})
