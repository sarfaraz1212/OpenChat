import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
  ASPECT_RATIOS,
  IMAGE_MODEL_IDS,
  IMAGE_STYLES,
  MAX_PROMPT_CHARS,
} from "../../../shared/images"
import { WorkersAiNotConfiguredError } from "../../lib/ai/run"
import * as images from "../../lib/db/images"
import { generateImage, ImageProviderError } from "../../lib/images/generate"
import { cleanPrompt, isPromptSafe } from "../../lib/images/policy"
import { deleteStoredImage, storeImage } from "../../lib/images/storage"
import { authed, router } from "../init"

const HOURLY_LIMIT = 50
const HOUR_MS = 60 * 60 * 1000

const generateInput = z.object({
  prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
  style: z.enum(IMAGE_STYLES),
  aspectRatio: z.enum(ASPECT_RATIOS),
  model: z.enum(IMAGE_MODEL_IDS),
})

export const imageRouter = router({
  /** The user's own images, newest first. */
  list: authed.query(({ ctx }) => images.listForUser(ctx.db, ctx.user.id)),

  generate: authed.input(generateInput).mutation(async ({ ctx, input }) => {
    const prompt = cleanPrompt(input.prompt)
    if (!prompt)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Prompt is required",
      })
    if (!isPromptSafe(prompt)) {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: "Prompt contains content that violates our usage policy",
      })
    }

    const since = new Date(Date.now() - HOUR_MS).toISOString()
    if ((await images.countSince(ctx.db, ctx.user.id, since)) >= HOURLY_LIMIT) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Rate limit exceeded. You can generate up to ${HOURLY_LIMIT} images per hour.`,
      })
    }

    let generated
    try {
      generated = await generateImage(ctx.env, { ...input, prompt })
    } catch (error) {
      if (error instanceof WorkersAiNotConfiguredError) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Image generation is not configured",
        })
      }
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof ImageProviderError
            ? error.message
            : "Image generation failed. Please try again.",
      })
    }

    // The bytes live in R2; the row only points at them.
    const imageUrl = await storeImage(ctx.env, ctx.user.id, generated).catch(
      () => {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not save the image. Please try again.",
        })
      }
    )
    try {
      return await images.insert(ctx.db, {
        userId: ctx.user.id,
        prompt,
        style: input.style,
        aspectRatio: input.aspectRatio,
        model: generated.model,
        provider: generated.provider,
        imageUrl,
        width: generated.width,
        height: generated.height,
      })
    } catch (error) {
      // No row means no way to ever delete the file, so do not keep it.
      await deleteStoredImage(ctx.env, ctx.user.id, imageUrl)
      throw error
    }
  }),

  remove: authed
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const image = await images.findOwned(ctx.db, input.id, ctx.user.id)
      if (!image) throw new TRPCError({ code: "NOT_FOUND" })
      await images.deleteOwned(ctx.db, image.id, ctx.user.id)
      try {
        await deleteStoredImage(ctx.env, ctx.user.id, image.imageUrl)
      } catch (error) {
        // The image is already gone from the gallery; a stray file is harmless.
        console.error("[images] could not delete the stored file", error)
      }
      return { ok: true }
    }),
})
