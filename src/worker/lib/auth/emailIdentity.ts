/**
 * Email identity helpers.
 *
 * TWO functions that must never be confused:
 *
 *   normalizeEmail   — IDENTITY. What we store, index and look up.
 *   canonicalizeEmail — ANTI-ABUSE. Only ever consulted to decide free-trial
 *                       eligibility.
 *
 * See docs/plans/cloudflare-replatform.md §3.4.
 */

/**
 * IDENTITY. The address as we store, index and look up. Lowercased + trimmed
 * only — nothing is removed.
 *
 * Safe because email domains are case-insensitive per RFC 1035, and every
 * mainstream provider treats the local part case-insensitively too. Without
 * this, `Foo@x.com` and `foo@x.com` are two accounts (and two free trials),
 * because `user.email` is a case-sensitive UNIQUE column and findByEmail does
 * an exact match.
 */
export function normalizeEmail(raw: string): string {
  return (raw ?? "").trim().toLowerCase()
}

/** Providers where a dot in the local part is NOT significant. */
const DOTLESS_DOMAINS = new Set(["gmail.com", "googlemail.com"])

/** Domains that are aliases of another domain, mapped to the canonical one. */
const DOMAIN_ALIASES: Record<string, string> = {
  "googlemail.com": "gmail.com",
}

/**
 * ANTI-ABUSE ONLY. Collapses aliases that reach the same inbox, so one person
 * cannot claim several free trials with `me+1@gmail.com`, `me+2@gmail.com`,
 * `m.e@gmail.com`, …
 *
 * NEVER use this for login, uniqueness, or account identity: `a+work@gmail.com`
 * and `a@gmail.com` are legitimately allowed to be separate accounts. It is only
 * consulted when deciding whether a free trial may be CLAIMED.
 *
 * Returns the normalized input unchanged when it isn't a parseable address —
 * callers store the result, so this must never throw or return empty.
 */
export function canonicalizeEmail(raw: string): string {
  const normalized = normalizeEmail(raw)

  // Split on the LAST '@': quoted local parts may legally contain one.
  const at = normalized.lastIndexOf("@")
  if (at <= 0 || at === normalized.length - 1) return normalized

  const localRaw = normalized.slice(0, at)
  const domainRaw = normalized.slice(at + 1)

  const domain = DOMAIN_ALIASES[domainRaw] ?? domainRaw

  // Strip the +tag. Practically universal (Gmail, Outlook, Fastmail, Proton…).
  let local = localRaw.split("+")[0]

  // Dots are insignificant ONLY at Gmail. Other providers treat them as real
  // characters, so stripping them everywhere would merge unrelated people.
  if (DOTLESS_DOMAINS.has(domainRaw)) {
    local = local.replace(/\./g, "")
  }

  // A local part that was entirely a +tag (e.g. "+foo@gmail.com") collapses to
  // empty; keep the normalized form rather than emitting "@gmail.com".
  if (!local) return normalized

  return `${local}@${domain}`
}
