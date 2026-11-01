/**
 * Password reset tokens.
 *
 * A token is 256 random bits, so unlike a password it needs no slow key
 * derivation: a plain SHA-256 is enough to keep the stored value useless to
 * anyone who reads the table.
 */

const TOKEN_BYTES = 32

/** URL-safe, so it can sit in a query string unescaped. */
const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

export function newResetToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
}

/** What is stored and looked up: the token itself never touches the database. */
export async function hashResetToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
