/**
 * Password hashing for the edge runtime.
 *
 * PBKDF2 via WebCrypto, NOT bcrypt or argon2 — both are native Node modules and
 * will not run on Cloudflare Workers. PBKDF2-HMAC-SHA256 is supported natively
 * by SubtleCrypto, so it needs no dependency and no WASM.
 *
 * The algorithm, iteration count and salt are all encoded in the stored string,
 * so the cost can be raised later without invalidating existing hashes.
 */

const ALGORITHM = "pbkdf2"
/** ~30ms on Workers. Comfortable against the paid plan's 30s CPU budget. */
const ITERATIONS = 100_000
const KEY_BYTES = 32
const SALT_BYTES = 16

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))

const unb64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    key,
    KEY_BYTES * 8
  )
  return new Uint8Array(bits)
}

/** Returns `pbkdf2$<iterations>$<salt-b64>$<hash-b64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(password, salt, ITERATIONS)
  return `${ALGORITHM}$${ITERATIONS}$${b64(salt)}$${b64(hash)}`
}

/**
 * Constant-time comparison. A plain `===` on the derived hash leaks timing
 * information about how many leading bytes matched, which is enough to mount a
 * byte-at-a-time attack against the stored value.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function verifyPassword(
  password: string,
  stored: string | null
): Promise<boolean> {
  if (!stored) return false

  const parts = stored.split("$")
  if (parts.length !== 4) return false
  const [algo, iterationsRaw, saltB64, hashB64] = parts
  if (algo !== ALGORITHM) return false

  const iterations = Number(iterationsRaw)
  if (!Number.isFinite(iterations) || iterations <= 0) return false

  try {
    const salt = unb64(saltB64)
    const expected = unb64(hashB64)
    const actual = await derive(password, salt, iterations)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** The only rule on a password's content: no case, digit or symbol requirements. */
export const PASSWORD_MIN_LENGTH = 3

export function validatePasswordShape(password: string): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  if (password.length > 256) {
    return "Password must be 256 characters or fewer."
  }
  return null
}

/**
 * A stored hash in the current format, over a value nobody can supply. Used to
 * spend the same PBKDF2 work on an unknown email as on a wrong password, so
 * login timing does not reveal which accounts exist. Computed once per isolate
 * on first use, which is exactly what a real lookup would also cost.
 */
let decoy: Promise<string> | null = null

export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(`no-such-account-${crypto.randomUUID()}`)
  return decoy
}
