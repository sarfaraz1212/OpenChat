import {
  ASPECT_RATIO_DIMENSIONS,
  IMAGE_MODEL_META,
  STYLE_MODIFIERS,
  type AspectRatio,
  type ImageStyle,
} from "../../../shared/images"
import { IMAGE_MODELS, type ImageModelId } from "../../../shared/models"
import type { AppBindings } from "../../env"
import { workersAiRun } from "../ai/run"
import { decodeBase64, sniffImageType, type ImageBytes } from "./storage"

export type ImageRequest = {
  prompt: string
  style: ImageStyle
  aspectRatio: AspectRatio
  model: ImageModelId
}

export type GeneratedBytes = ImageBytes & {
  width: number
  height: number
  model: ImageModelId
  provider: "cloudflare"
}

/** A provider call that failed; `status` is the HTTP status when there was one. */
export class ImageProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

const RETRY_DELAY_MS = 1000

const backendOf = (model: ImageModelId) =>
  IMAGE_MODELS.find((entry) => entry.id === model)!.backend

type Wire = "multipart" | "json-b64" | "json-binary"

/**
 * One Workers AI call. The models do not share a wire format (see
 * ImageWireFormat), and using the wrong one is silent, so it is per model.
 */
async function callOnce(
  env: AppBindings,
  request: ImageRequest
): Promise<GeneratedBytes> {
  const run = workersAiRun(env, backendOf(request.model))
  const { wire } = IMAGE_MODEL_META[request.model]
  const modifier = STYLE_MODIFIERS[request.style]
  const prompt = modifier ? `${request.prompt}, ${modifier}` : request.prompt

  const invoke = async (wireFormat: Wire): Promise<GeneratedBytes> => {
    let response: Response
    if (wireFormat === "multipart") {
      const form = new FormData()
      form.append("prompt", prompt)
      response = await run.fetcher(run.url, {
        method: "POST",
        headers: run.headers,
        body: form,
      })
    } else {
      response = await run.fetcher(run.url, {
        method: "POST",
        headers: { ...run.headers, "Content-Type": "application/json" },
        body: JSON.stringify(
          request.model === "flux-1-schnell" ? { prompt, steps: 4 } : { prompt }
        ),
      })
    }
    if (!response.ok) {
      throw new ImageProviderError(
        `Cloudflare image generation failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
        response.status
      )
    }

    const bytes =
      wireFormat === "json-binary"
        ? new Uint8Array(await response.arrayBuffer())
        : await readBase64Image(response)
    const contentType = sniffImageType(bytes)
    if (!contentType) {
      throw new ImageProviderError("Cloudflare returned no image")
    }

    const { width, height } = ASPECT_RATIO_DIMENSIONS[request.aspectRatio]
    return {
      bytes,
      contentType,
      width,
      height,
      model: request.model,
      provider: "cloudflare",
    }
  }

  if (wire === "multipart") {
    try {
      return await invoke("multipart")
    } catch (first) {
      if (
        first instanceof ImageProviderError &&
        (first.status === 400 ||
          first.status === 404 ||
          first.status === 405 ||
          first.status === 415)
      ) {
        // Some gateways/proxies reject multipart. Retry once as JSON for FLUX models.
        return await invoke("json-b64")
      }
      throw first
    }
  }

  return invoke(wire)
}

/** `{ result: { image: "<base64>" } }`, with no data-URI prefix on the wire. */
async function readBase64Image(response: Response): Promise<Uint8Array> {
  const payload = (await response.json()) as {
    result?: { image?: string }
    errors?: { message: string }[]
  }
  const image = payload.result?.image
  if (!image) {
    throw new ImageProviderError(
      payload.errors?.[0]?.message ?? "Cloudflare returned no image"
    )
  }
  return decodeBase64(image)
}

/** Rate limits, timeouts and 5xx are worth another go; other 4xx never are. */
function isTransient(error: unknown): boolean {
  if (error instanceof ImageProviderError) {
    const status = error.status
    // No status means a bad or empty result, which will not improve.
    return (
      status !== undefined &&
      (status === 408 || status === 429 || status >= 500)
    )
  }
  return error instanceof TypeError // fetch never got an answer
}

/**
 * Generate an image, retrying once after a transient failure. Configuration
 * problems (no credentials) are not retried: they are reported as they are.
 */
export async function generateImage(
  env: AppBindings,
  request: ImageRequest
): Promise<GeneratedBytes> {
  try {
    return await callOnce(env, request)
  } catch (first) {
    if (
      !(first instanceof ImageProviderError) &&
      !(first instanceof TypeError)
    ) {
      throw first
    }
    console.error(
      `[images] ${request.model} failed:`,
      first instanceof Error ? first.message : first
    )
    if (isTransient(first)) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      try {
        return await callOnce(env, request)
      } catch (retry) {
        console.error(
          `[images] ${request.model} retry failed:`,
          retry instanceof Error ? retry.message : retry
        )
        if (retry instanceof ImageProviderError) {
          throw retry
        }
        if (retry instanceof TypeError) {
          throw new ImageProviderError(
            `Cloudflare image generation network error: ${retry.message}`
          )
        }
      }
    }
    if (first instanceof ImageProviderError) {
      throw first
    }
    if (first instanceof TypeError) {
      throw new ImageProviderError(
        `Cloudflare image generation network error: ${first.message}`
      )
    }
    throw new ImageProviderError(
      `Image generation failed for model ${request.model}. Please try again or select a different model.`
    )
  }
}
