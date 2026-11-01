import { z } from "zod"
import {
  isChatModelId,
  isProviderId,
  type ProviderId,
} from "../../../shared/models"
import * as catalog from "../../lib/ai-infra"
import * as aiInfra from "../../lib/db/ai-infra"
import { authed, router } from "../init"

const providerId = z
  .string()
  .refine(isProviderId, "Unknown provider")
  .transform((value) => value as ProviderId)
const modelId = z.string().refine(isChatModelId, "Unsupported chat model")

export const aiProviderRouter = router({
  list: authed.query(({ ctx }) =>
    catalog.listProviders(ctx.db, ctx.env, ctx.user.id)
  ),

  toggle: authed
    .input(z.object({ id: providerId, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await aiInfra.setProviderEnabled(ctx.db, {
        userId: ctx.user.id,
        providerId: input.id,
        enabled: input.enabled,
      })
      return { ok: true }
    }),
})

export const aiModelRouter = router({
  list: authed
    .input(z.object({ providerId }))
    .query(({ ctx, input }) =>
      catalog.listModels(ctx.db, ctx.user.id, input.providerId)
    ),

  toggle: authed
    .input(z.object({ providerId, id: modelId, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await aiInfra.setModelsEnabled(ctx.db, {
        userId: ctx.user.id,
        providerId: input.providerId,
        ids: [input.id],
        enabled: input.enabled,
      })
      return { ok: true }
    }),

  batchToggle: authed
    .input(
      z.object({
        providerId,
        ids: z.array(modelId).min(1).max(100),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await aiInfra.setModelsEnabled(ctx.db, {
        userId: ctx.user.id,
        providerId: input.providerId,
        ids: input.ids,
        enabled: input.enabled,
      })
      return { ok: true }
    }),
})

/** The read model behind the chat's model switcher. */
export const aiInfraRouter = router({
  runtimeState: authed.query(({ ctx }) =>
    catalog.runtimeState(ctx.db, ctx.user.id)
  ),
})
