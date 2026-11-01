/**
 * Manual overrides on top of the generated upstream blocklist.
 *
 * The upstream maintainers explicitly do NOT guarantee current accuracy:
 * "We cannot guarantee all of these can still be considered disposable but we
 * do basic checking so chances are they were disposable at one point in time."
 *
 * So a domain that was disposable in 2019 may be a real business today. When a
 * genuine customer is blocked, support needs a fix that ships in minutes rather
 * than waiting on an upstream pull request — that is what ALLOW_OVERRIDE is for.
 *
 * See docs/plans/cloudflare-replatform.md §3.4.
 */

/**
 * Domains the upstream list gets WRONG. Checked FIRST and wins over everything.
 *
 * When adding an entry, include the date and who reported it, e.g.:
 *   'realbusiness.com',   // 2026-08-02 — blocked a paying customer (ticket #412)
 */
export const ALLOW_OVERRIDE: ReadonlySet<string> = new Set<string>([])

/**
 * Disposable domains not yet in the upstream list. Checked before the list.
 * Prefer opening an upstream PR too, so the entry eventually becomes redundant.
 */
export const BLOCK_OVERRIDE: ReadonlySet<string> = new Set<string>([
  // RFC 2606 / IANA reserved documentation domains. Upstream will never list
  // these — it catalogues disposable *services*, and these are not services
  // at all — but they are the placeholders people actually type into a signup
  // form, and mail to them is undeliverable by definition.
  "example.com",
  "example.net",
  "example.org",
  "example.edu",
])

/**
 * RFC 2606 / RFC 6761 reserved top-level domains. Nothing under these resolves
 * on the public internet, so any address using one is undeliverable.
 *
 * Kept separate from BLOCK_OVERRIDE because the parent walk in
 * isDisposableDomain deliberately stops at two labels (so it never tests a bare
 * public suffix). That means a single-label entry here would only ever match an
 * exact bare domain — these need a suffix check instead.
 */
export const RESERVED_TLDS: readonly string[] = [
  "test",
  "example",
  "invalid",
  "localhost",
  "local",
]
