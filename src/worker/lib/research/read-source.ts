import type { AppBindings } from "../../env"

export type SourceRead = { url: string; content: string; success: boolean }

const TIMEOUT_MS = 15_000
/** A page is read up to this many bytes; the rest is ignored. */
const MAX_BYTES = 1_500_000
const READABLE_TYPES = /^(text\/|application\/(xhtml\+xml|json|xml))/

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain"]

/** Whether a dotted IPv4 address is loopback, private, link-local or otherwise not public. */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".").map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n)))
    return false
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

/**
 * The URL, if it is one a research run may fetch: plain http(s) to a public
 * host. The model picks these URLs, so local, private and metadata addresses
 * (and anything with embedded credentials) are refused.
 */
export function publicWebUrl(value: string): URL | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  if (host === "localhost" || host.startsWith("[")) return null // IPv6 literals
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null
  if (isPrivateIPv4(host)) return null
  return url
}

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
}

function htmlToText(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
    // Last, so "&amp;lt;" reads as the text "&lt;" rather than "<".
    .replace(/&amp;/g, "&")
  return text.replace(/\s+/g, " ").trim()
}

/** Keeps the start and the end of a long text, which is where the substance usually is. */
function limitText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const head = text.slice(0, Math.floor(maxChars * 0.7)).trim()
  const tailChars = Math.max(0, maxChars - head.length - 80)
  const tail = tailChars > 0 ? text.slice(-tailChars).trim() : ""
  return `${head}\n\n[Source excerpt trimmed to stay within the research token budget.]\n\n${tail}`.trim()
}

/** Reads at most MAX_BYTES of the body. */
async function readBounded(response: Response): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  await reader.cancel().catch(() => undefined)
  const bytes = new Uint8Array(Math.min(total, MAX_BYTES))
  let offset = 0
  for (const chunk of chunks) {
    const room = bytes.length - offset
    if (room <= 0) break
    bytes.set(chunk.subarray(0, room), offset)
    offset += Math.min(chunk.length, room)
  }
  return new TextDecoder().decode(bytes)
}

/** Fetch a page and return its readable text, trimmed to `maxChars`. Never throws. */
export async function readSource(
  env: AppBindings,
  value: string,
  maxChars: number
): Promise<SourceRead> {
  const url = publicWebUrl(value)
  if (!url) {
    return {
      url: value,
      content: "Refused: only public http(s) pages can be read.",
      success: false,
    }
  }
  try {
    const response = await (env.OUTBOUND_FETCH ?? fetch)(url.href, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OpenChat-Research/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
    })
    if (!response.ok) {
      return {
        url: value,
        content: `Failed to fetch: ${response.status}`,
        success: false,
      }
    }
    const type = response.headers.get("content-type") ?? ""
    if (!READABLE_TYPES.test(type)) {
      return {
        url: value,
        content: "Not a readable text page.",
        success: false,
      }
    }
    const body = await readBounded(response)
    const text = type.includes("html") ? htmlToText(body) : body
    return { url: value, content: limitText(text, maxChars), success: true }
  } catch (error) {
    return {
      url: value,
      content: `Error reading source: ${error instanceof Error ? error.message : "Unknown error"}`,
      success: false,
    }
  }
}
