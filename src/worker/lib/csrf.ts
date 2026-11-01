/**
 * CSRF tokens, on WebCrypto rather than node:crypto so this runs on Workers.
 *
 * ⚠️ Both functions are ASYNC — `crypto.subtle` has no synchronous form. The
 * node:crypto version was synchronous, and a promise is always truthy, so a
 * caller that forgets `await` on validateCsrfToken() silently passes every
 * request. Every call site must await. See middleware/csrf.ts, and the
 * regression test in __tests__/csrf.test.ts that fails if the await is lost.
 *
 * The secret is passed in (from the Worker's env) rather than read from
 * process.env at module scope, and a missing secret fails closed. Signing with
 * `undefined` would produce tokens anyone could forge.
 *
 * A token is `<nonce>:<signature>`, where the signature is
 * HMAC-SHA256(secret, nonce). HMAC rather than a plain `sha256(nonce+secret)`
 * digest: that construction lets anyone holding one valid token extend it into
 * further valid tokens (a length-extension forgery), which HMAC does not.
 */

export const CSRF_COOKIE = "csrf_token"
export const CSRF_HEADER = "x-csrf-token"

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
}

async function signHex(nonce: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    new TextEncoder().encode(nonce)
  )
  return toHex(new Uint8Array(signature))
}

export async function generateCsrfToken(secret: string): Promise<string> {
  if (!secret) throw new Error("CSRF_SECRET is not configured")
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)))
  const signature = await signHex(nonce, secret)
  return `${nonce}:${signature}`
}

/** Constant-time compare so a mismatch doesn't leak its position via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function validateCsrfToken(
  fullToken: string,
  secret: string
): Promise<boolean> {
  if (!secret) return false

  // Tolerate a percent-encoded token. `document.cookie` hands back the encoded
  // form, so the separator can arrive as %3A; decoding here means a caller that
  // forgets to decode fails closed on a real mismatch rather than on encoding.
  let candidate = fullToken ?? ""
  if (candidate.includes("%")) {
    try {
      candidate = decodeURIComponent(candidate)
    } catch {
      return false
    }
  }

  const [nonce, signature] = candidate.split(":")
  if (!nonce || !signature) return false
  const expected = await signHex(nonce, secret)
  return timingSafeEqual(expected, signature)
}
