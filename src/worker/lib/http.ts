import type { Context } from "hono"
import type { AppEnv } from "../env"

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * Whether cookies should carry the Secure attribute: always, except on local
 * development hosts.
 *
 * Decided by host rather than by the request's scheme so production stays
 * strict even if a plain-http request slips through: the browser then refuses
 * to send the cookie back over http, which fails safe.
 */
export function cookieSecure(c: Context<AppEnv>): boolean {
  return !LOCAL_HOSTNAMES.has(new URL(c.req.url).hostname)
}

/**
 * Read a multipart body, refusing one that is larger than `maxBytes`.
 *
 * `Request.formData()` buffers the whole body first, so a `Content-Length`
 * check alone is not a limit: a chunked upload declares no length and is
 * buffered up to the platform's own ceiling before anything of ours runs. This
 * counts bytes as they arrive and tears the stream down the moment the cap is
 * passed, so nothing larger is ever held.
 */
export async function readCappedFormData(
  request: Request,
  maxBytes: number
): Promise<
  | { ok: true; form: FormData }
  | { ok: false; reason: "too-large" | "unreadable" }
> {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too-large" }
  }
  if (!request.body) return { ok: false, reason: "unreadable" }

  let total = 0
  let exceeded = false
  const counted = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength
        if (total > maxBytes) {
          exceeded = true
          controller.error(new Error("Body exceeds the size limit"))
          return
        }
        controller.enqueue(chunk)
      },
    })
  )

  try {
    const form = await new Response(counted, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData()
    return { ok: true, form }
  } catch {
    return { ok: false, reason: exceeded ? "too-large" : "unreadable" }
  }
}
