import { Hono, type Context } from "hono"
import type { AppEnv } from "../env"
import { getCurrentUser } from "../lib/auth/session"
import * as images from "../lib/db/images"
import { readCappedFormData } from "../lib/http"
import { BflError, BflNotConfiguredError, editImage } from "../lib/images/bfl"
import {
  deleteStoredImage,
  sniffImageType,
  storeImage,
} from "../lib/images/storage"

const MAX_BYTES = 10 * 1024 * 1024
/** Slack for the multipart envelope around an upload of MAX_BYTES. */
const MULTIPART_OVERHEAD = 64 * 1024
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"]
const SCALES = ["2", "4"]
/** Hosted editing costs money, so it is capped per user (the legacy had no cap). */
const HOURLY_LIMIT = 20
const HOUR_MS = 60 * 60 * 1000

const REMOVE_BACKGROUND_PROMPT =
  "Remove the background from this image completely. Keep the main subject unchanged with clean, precise edges and natural detail. Output a PNG with a fully transparent background."

const enhancePrompt = (scale: string) =>
  [
    `Enhance and upscale this image to ${scale}x resolution.`,
    "Preserve the original subject, framing, colors, and identity.",
    "Improve sharpness, fine detail, texture clarity, and reduce compression noise.",
    "Do not add new objects, text, watermarks, borders, or stylized effects.",
  ].join(" ")

type Tool = "background-removal" | "enhance"

const fail = (
  c: Context<AppEnv>,
  status: 400 | 401 | 413 | 429 | 502 | 503,
  code: string,
  error: string
) => c.json({ error, code }, status)

/**
 * Upload an image, have Black Forest Labs edit it, keep the result in the
 * gallery. Signed-in users only: the guest mode of the legacy app is gone, and
 * this is a paid service.
 */
async function run(c: Context<AppEnv>, tool: Tool) {
  const user = await getCurrentUser(c)
  if (!user) return fail(c, 401, "UNAUTHORIZED", "Sign in required")

  const body = await readCappedFormData(
    c.req.raw,
    MAX_BYTES + MULTIPART_OVERHEAD
  )
  if (!body.ok) {
    return body.reason === "too-large"
      ? fail(c, 413, "FILE_TOO_LARGE", "File size must be under 10MB")
      : fail(c, 400, "INVALID_INPUT", "Send the image as multipart form data")
  }
  const form = body.form
  const upload = form.get("image")
  if (!(upload instanceof File)) {
    return fail(c, 400, "INVALID_INPUT", "Image file is required")
  }
  if (!ALLOWED_TYPES.includes(upload.type)) {
    return fail(
      c,
      400,
      "INVALID_INPUT",
      "Only PNG, JPEG, and WebP images are supported"
    )
  }
  if (upload.size > MAX_BYTES) {
    return fail(c, 413, "FILE_TOO_LARGE", "File size must be under 10MB")
  }
  const scale = String(form.get("scale") ?? "")
  if (tool === "enhance" && !SCALES.includes(scale)) {
    return fail(c, 400, "INVALID_INPUT", "Scale must be 2x or 4x")
  }

  // The declared type is the client's word; the bytes must really be an image.
  const image = new Uint8Array(await upload.arrayBuffer())
  const actual = sniffImageType(image)
  if (!actual || !ALLOWED_TYPES.includes(actual)) {
    return fail(
      c,
      400,
      "INVALID_INPUT",
      "Only PNG, JPEG, and WebP images are supported"
    )
  }

  const since = new Date(Date.now() - HOUR_MS).toISOString()
  if (
    (await images.countSince(c.env.DB, user.id, since, "bfl")) >= HOURLY_LIMIT
  ) {
    return fail(
      c,
      429,
      "RATE_LIMITED",
      `Rate limit exceeded. You can make up to ${HOURLY_LIMIT} edits per hour.`
    )
  }

  const label = tool === "enhance" ? "Image enhancement" : "Background removal"
  let edited
  try {
    edited = await editImage(c.env, {
      image,
      label,
      prompt:
        tool === "enhance" ? enhancePrompt(scale) : REMOVE_BACKGROUND_PROMPT,
    })
  } catch (error) {
    if (error instanceof BflNotConfiguredError) {
      return fail(c, 503, "NOT_CONFIGURED", "Image editing is not configured")
    }
    console.error("[image-tools] edit failed", error)
    return fail(
      c,
      502,
      "PROVIDER_FAILED",
      error instanceof BflError
        ? error.message
        : `${label} failed. Please try again.`
    )
  }

  const imageUrl = await storeImage(c.env, user.id, edited)
  try {
    const saved = await images.insert(c.env.DB, {
      userId: user.id,
      prompt: tool === "enhance" ? `Enhanced ${scale}x` : "Background removed",
      style: "none",
      aspectRatio: "1:1",
      model: edited.model,
      provider: "bfl",
      imageUrl,
      width: null,
      height: null,
    })
    return c.json(saved, 201)
  } catch (error) {
    // No row means no way to ever delete the file, so do not keep it.
    await deleteStoredImage(c.env, user.id, imageUrl)
    throw error
  }
}

export const imageTools = new Hono<AppEnv>()
  .post("/background-removal", (c) => run(c, "background-removal"))
  .post("/enhance", (c) => run(c, "enhance"))
