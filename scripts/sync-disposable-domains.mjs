/**
 * Regenerate src/worker/lib/auth/disposableDomains.generated.ts from the upstream
 * disposable-email-domains blocklist (CC0).
 *
 *   node scripts/sync-disposable-domains.mjs        # write
 *   node scripts/sync-disposable-domains.mjs --check # CI: fail if out of date
 *
 * WHY NOT AN NPM PACKAGE: the `disposable-email-domains-js` mirror tracks
 * upstream through a PINNED git submodule, so it runs thousands of domains
 * behind (5,438 vs 8,183 when checked on 2026-07-29 — 1,838 of the missing ones
 * were plain 2-label domains that no subdomain walk can recover). The other npm
 * package, `disposable-email-domains`, is a different repo and has been
 * unpublished-stale since 2022. Upstream is the only current source.
 *
 * See docs/plans/cloudflare-replatform.md §3.4.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SOURCE =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf"

const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/worker/lib/auth/disposableDomains.generated.ts"
)

/** Mainstream providers that must NEVER appear in the list (§6.1). */
const MUST_NOT_CONTAIN = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "zoho.com",
  "gmx.com",
  "gmx.de",
  "yandex.com",
  "mail.ru",
  "fastmail.com",
  "hey.com",
  "msn.com",
  "qq.com",
]

const MIN_DOMAINS = 7000

function die(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

const res = await fetch(SOURCE)
if (!res.ok) die(`fetch failed: HTTP ${res.status}`)

const domains = [
  ...new Set(
    (await res.text())
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith("#"))
  ),
].sort()

// ── Sanity gate ───────────────────────────────────────────────────────────────
// This list gates SIGNUP. A bad upstream merge that adds a mainstream provider
// would lock every new registration out of the product, so refuse to write it.
if (domains.length < MIN_DOMAINS) {
  die(
    `only ${domains.length} domains (expected >= ${MIN_DOMAINS}) — upstream broke or the fetch truncated.`
  )
}

const banned = MUST_NOT_CONTAIN.filter((d) => domains.includes(d))
if (banned.length) {
  die(
    `REFUSING TO WRITE — mainstream provider(s) present in upstream list: ${banned.join(", ")}`
  )
}

if (existsSync(OUT)) {
  const prev = (readFileSync(OUT, "utf8").match(
    /^\/\/ Synced: .* · (\d+) domains$/m
  ) ?? [])[1]
  if (prev && domains.length < Number(prev) * 0.9) {
    die(
      `new list (${domains.length}) is >10% smaller than the current one (${prev}) — refusing.`
    )
  }
}

// ── Emit ──────────────────────────────────────────────────────────────────────
// ONE newline-joined string literal, not N array elements: V8 parses a single
// large literal far faster than thousands of small ones, and this is paid on
// every isolate cold start.
const body = `// GENERATED FILE — do not edit by hand.
// Regenerate with: pnpm sync:disposable-domains
//
// Source: https://github.com/disposable-email-domains/disposable-email-domains
// License: CC0-1.0 (public domain)
// Synced: ${new Date().toISOString().slice(0, 10)} · ${domains.length} domains

/**
 * The raw blocklist as a single newline-delimited string. Kept as one literal
 * rather than an array so isolate cold-start parse cost stays low; the Set is
 * built once per isolate in disposableEmail.ts.
 */
export const DISPOSABLE_DOMAINS_RAW =
    ${JSON.stringify(domains.join("\n"))};

/** Number of domains in this snapshot (asserted by the guard test). */
export const DISPOSABLE_DOMAIN_COUNT = ${domains.length};
`

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : ""
  // Compare payload only — the Synced: date line is expected to differ.
  const strip = (s) => s.replace(/^\/\/ Synced: .*$/m, "")
  if (strip(current) !== strip(body)) {
    die(
      "disposableDomains.generated.ts is out of date. Run: pnpm sync:disposable-domains"
    )
  }
  console.log(`✓ up to date (${domains.length} domains)`)
  process.exit(0)
}

writeFileSync(OUT, body, "utf8")
console.log(`✓ wrote ${domains.length} domains → ${OUT}`)
