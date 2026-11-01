/**
 * Disposable email domain detection.
 *
 * Data comes from disposableDomains.generated.ts (upstream, CC0); POLICY lives
 * here. See docs/plans/cloudflare-replatform.md §3.4.
 */
import { DISPOSABLE_DOMAINS_RAW } from "./disposableDomains.generated"
import {
  ALLOW_OVERRIDE,
  BLOCK_OVERRIDE,
  RESERVED_TLDS,
} from "./disposableOverrides"
import { normalizeEmail } from "./emailIdentity"

/**
 * Built once per isolate at module scope, not per call. The list is ~8k entries;
 * rebuilding the Set on every signup would be pure waste (this is exactly the
 * bug in the `disposable-email-domains-js` npm package, which calls
 * `new Set(require(json))` inside its own `isDisposableEmailDomain`).
 */
const DISPOSABLE: ReadonlySet<string> = new Set(
  DISPOSABLE_DOMAINS_RAW.split("\n")
)

/** Exposed for the guard test in the guard test — do not use for lookups. */
export function disposableDomains(): ReadonlySet<string> {
  return DISPOSABLE
}

/**
 * True when `domain` — or any parent of it — is a known disposable provider.
 *
 * The parent walk matters: services hand out `user@foo.mailinator.com` while
 * only `mailinator.com` is listed.
 *
 * The walk stops at two labels so we never test a bare public suffix such as
 * "co.uk". That is an approximation of the real public-suffix rules (upstream
 * ships publicsuffixlist.local for the exact version) and is safe today because
 * no public suffix appears in the list — asserted by the guard test.
 */
export function isDisposableDomain(domain: string): boolean {
  const d = (domain ?? "").trim().toLowerCase().replace(/\.$/, "")
  if (!d) return false

  if (ALLOW_OVERRIDE.has(d)) return false
  if (BLOCK_OVERRIDE.has(d)) return true

  // Reserved TLDs (.test, .invalid, .localhost, .local, .example). The parent
  // walk below stops at two labels so it can never test a bare suffix, so
  // these are matched here instead — this also catches any depth of
  // subdomain, e.g. mail.corp.invalid.
  const tld = d.slice(d.lastIndexOf(".") + 1)
  if (RESERVED_TLDS.includes(tld)) return true

  const parts = d.split(".")
  for (let i = 0; i <= parts.length - 2; i++) {
    const candidate = parts.slice(i).join(".")
    // An allow-listed parent protects its subdomains too.
    if (ALLOW_OVERRIDE.has(candidate)) return false
    if (BLOCK_OVERRIDE.has(candidate) || DISPOSABLE.has(candidate)) return true
  }
  return false
}

/**
 * True when the address uses a disposable domain. Returns false for anything
 * that isn't a parseable address — rejecting malformed input is the validator's
 * job, not this function's, and returning true here would produce a confusing
 * "use a permanent email" error for what is really a typo.
 */
export function isDisposableEmail(email: string): boolean {
  const normalized = normalizeEmail(email)
  const at = normalized.lastIndexOf("@")
  if (at <= 0 || at === normalized.length - 1) return false
  return isDisposableDomain(normalized.slice(at + 1))
}
