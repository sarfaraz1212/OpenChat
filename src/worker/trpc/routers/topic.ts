import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { isChatModelId } from "../../../shared/models"
import * as agents from "../../lib/db/agents"
import * as messages from "../../lib/db/messages"
import * as topics from "../../lib/db/topics"
import { authed, router } from "../init"

const topicId = z.object({ id: z.string().min(1) })

export const topicRouter = router({
  list: authed
    .input(z.object({ agentId: z.string().min(1).optional() }).optional())
    .query(({ ctx, input }) =>
      topics.listForUser(ctx.db, ctx.user.id, input?.agentId)
    ),

  /** Files the topic under `agentId`, or under the default agent if omitted. */
  create: authed
    .input(
      z.object({
        agentId: z.string().min(1).optional(),
        title: z.string().trim().max(120).optional(),
        model: z
          .string()
          .refine(isChatModelId, "Unsupported chat model")
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const agent = input.agentId
        ? await agents.findOwned(ctx.db, input.agentId, ctx.user.id)
        : await agents.ensureInbox(ctx.db, ctx.user.id)
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" })
      return topics.create(ctx.db, {
        userId: ctx.user.id,
        agentId: agent.id,
        title: input.title || "New topic",
        model: input.model ?? agent.model,
      })
    }),

  get: authed.input(topicId).query(async ({ ctx, input }) => {
    const topic = await topics.findOwned(ctx.db, input.id, ctx.user.id)
    if (!topic) throw new TRPCError({ code: "NOT_FOUND" })
    return {
      ...topic,
      messages: await messages.listForOwnedTopic(ctx.db, input.id, ctx.user.id),
    }
  }),

  update: authed
    .input(
      topicId.extend({
        title: z.string().trim().min(1).max(120).optional(),
        favorite: z.boolean().optional(),
        model: z
          .string()
          .refine(isChatModelId, "Unsupported chat model")
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const topic = await topics.update(ctx.db, {
        id: input.id,
        userId: ctx.user.id,
        title: input.title,
        favorite: input.favorite,
        model: input.model,
      })
      if (!topic) throw new TRPCError({ code: "NOT_FOUND" })
      return topic
    }),

  remove: authed.input(topicId).mutation(async ({ ctx, input }) => {
    if (!(await topics.remove(ctx.db, input.id, ctx.user.id))) {
      throw new TRPCError({ code: "NOT_FOUND" })
    }
    return { ok: true }
  }),
})
