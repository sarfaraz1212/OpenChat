import type { AppBindings } from "../../env"
import { encodeBase64, sniffImageType, type ImageBytes } from "./storage"

/**
 * Black Forest Labs' hosted FLUX editing API, used by background removal and
 * the image enhancer. An edit is submitted, then its polling URL is polled until
 * the result is ready, then the result image is downloaded.
 */

export class BflNotConfiguredError extends Error {
  constructor() {
    super("Image editing is not configured")
  }
}

/** The service could not produce the edit. */
export class BflError extends Error {}

export type EditResult = ImageBytes & {
  /** The BFL model that made it, e.g. "flux-2-pro-preview". */
  model: string
}

/** Tried in order; the first that can take the request wins. */
const ENDPOINTS = [
  { name: "FLUX.2 Pro Preview", id: "flux-2-pro-preview" },
  { name: "FLUX.1 Kontext Max", id: "flux-kontext-max" },
  { name: "FLUX.1 Kontext Pro", id: "flux-kontext-pro" },
] as const

const API_BASE = "https://api.bfl.ai/v1/"
/** A model that cannot take this request: try the next one. Any other status stops. */
const NEXT_MODEL_STATUSES = [400, 404, 422]
const POLL_INTERVAL_MS = 1000
/** For the whole edit, all models together; a request should not run for minutes. */
const TOTAL_BUDGET_MS = 100_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The API key is only ever sent to Black Forest Labs' own hosts. */
function isBflUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      (url.hostname === "bfl.ai" || url.hostname.endsWith(".bfl.ai"))
    )
  } catch {
    return false
  }
}

async function pollUntilReady(
  fetcher: typeof fetch,
  pollingUrl: string,
  key: string,
  deadline: number
): Promise<string> {
  for (;;) {
    const response = await fetcher(pollingUrl, {
      headers: { accept: "application/json", "x-key": key },
    })
    if (!response.ok) throw new Error(`BFL polling error (${response.status})`)
    const data = (await response.json()) as {
      status?: string
      result?: { sample?: string }
    }
    if (data.status === "Ready" && data.result?.sample)
      return data.result.sample
    if (data.status === "Error" || data.status === "Failed") {
      throw new Error(`BFL generation failed: ${data.status}`)
    }
    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      throw new Error("BFL generation timed out")
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

async function downloadResult(
  fetcher: typeof fetch,
  url: string
): Promise<ImageBytes> {
  if (!url.startsWith("https://")) throw new Error("BFL returned an unsafe URL")
  const response = await fetcher(url)
  if (!response.ok) {
    throw new Error(`Failed to download the result (${response.status})`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const contentType = sniffImageType(bytes)
  if (!contentType) throw new Error("BFL returned no image")
  return { bytes, contentType }
}

/** Edit an image with a text instruction. `label` names the task in errors. */
export async function editImage(
  env: AppBindings,
  params: { prompt: string; image: Uint8Array; label: string }
): Promise<EditResult> {
  const key = env.BFL_API_KEY
  if (!key) throw new BflNotConfiguredError()
  const fetcher = env.OUTBOUND_FETCH ?? fetch
  const inputImage = encodeBase64(params.image)
  const deadline = Date.now() + TOTAL_BUDGET_MS

  const attempted: string[] = []
  let lastError = "Unknown error"
  for (const endpoint of ENDPOINTS) {
    attempted.push(endpoint.name)
    const submitted = await fetcher(`${API_BASE}${endpoint.id}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "x-key": key,
      },
      body: JSON.stringify({
        prompt: params.prompt,
        input_image: inputImage,
        output_format: "png",
        prompt_upsampling: false,
        safety_tolerance: 2,
      }),
    })
    if (!submitted.ok) {
      const body = await submitted.text().catch(() => "Unknown error")
      lastError = `BFL API error (${submitted.status}) for ${endpoint.name}: ${body.slice(0, 300)}`
      if (NEXT_MODEL_STATUSES.includes(submitted.status)) continue
      throw new BflError(lastError)
    }

    const { polling_url: pollingUrl } = (await submitted
      .json()
      .catch(() => ({}))) as { polling_url?: string }
    if (!pollingUrl || !isBflUrl(pollingUrl)) {
      lastError = `No usable polling URL returned from ${endpoint.name}.`
      continue
    }
    try {
      const sample = await pollUntilReady(fetcher, pollingUrl, key, deadline)
      return { ...(await downloadResult(fetcher, sample)), model: endpoint.id }
    } catch (error) {
      lastError = `${endpoint.name}: ${error instanceof Error ? error.message : "Failed to retrieve the result"}`
    }
  }
  throw new BflError(
    `${params.label} failed for all FLUX edit models. Attempted: ${attempted.join(", ")}. Last error: ${lastError}`
  )
}
