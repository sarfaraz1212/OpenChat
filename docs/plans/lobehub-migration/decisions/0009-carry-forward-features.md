# 0009 — Carry forward the current app's own features (not in LobeHub)

## Context

The current app is not a blank slate being replaced wholesale — it's an already-Cloudflare-native app (D1, R2, custom auth, Workers AI) with its own features that have no LobeHub equivalent. The user flagged this directly (background removal specifically) and confirmed carrying all of them forward by default. Full detail in `research/02-current-anychat-inventory.md`.

## Decision — carried forward as-is, re-plumbed onto the new Hono backend

- **Background removal** — two systems: instant client-side WASM cutouts (`@imgly/background-removal`) for homepage demo images, and the real user-facing tool backed by Black Forest Labs' hosted FLUX editing API, with R2 persistence and chat-thread integration for signed-in users.
- **Image enhancer** — sibling feature, same BFL-backed pattern.
- **Deep Research** — multi-step web-search/read/synthesize loop (Tavily/Serper/Perplexity, priority-ordered by whichever API key is set) with its own PDF export (`jsPDF`).
- **AI image-generation gallery** — Workers AI FLUX/Leonardo models, persisted to R2 and the `generated_images` table.
- **Customer.io transactional email** — 18 templates total: 6-email onboarding drip + 12-step re-engagement ("relance") drip, both queued into an `email_jobs` table and dispatched by a cron-triggered route; plus two immediate, non-queued sends (email-change notice, welcome email).
- **Disposable-email signup blocking** — an 8,000+ domain blocklist (auto-synced from a public GitHub list, with sanity gates against ever blocking mainstream providers), enforced at both signup and email-change.

## Known pre-existing gap, unrelated to LobeHub, worth fixing while rebuilding this code anyway

The hourly cron declared in `wrangler.jsonc` (`triggers.crons`) has **no actual `scheduled()` handler** anywhere in the app — `EmailSchedulerCron`/`EmailDispatcherCron` exist only as plain HTTP routes with no caller found in the repo. Wire a real `scheduled()` handler in Phase 14 (Hardening & cutover) rather than carrying the gap forward silently.

## Known risk to explicitly verify, not just assume fixed by porting

`lib/csrf.ts`'s `validateCsrfToken()` is `async`; a caller that forgets `await` gets a promise, which is always truthy, so the check silently passes every request. This is already flagged in the pre-existing `docs/plans/cloudflare-replatform.md` risk register. Audit every call site explicitly in Phase 14 — don't assume it's fine because the pre-migration app "worked."

## Consequences

Phase 12 is dedicated to this list. None of it is new design work — it's a straight port of already-working logic onto new routing, verified against the `master` branch snapshot as the reference for "did this port correctly."
