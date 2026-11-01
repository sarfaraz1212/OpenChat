# Research 02 — Current app (pre-migration) feature inventory

**Source**: background research agent, exploring the repo root (`e:\anychat`, excluding `../new/lobehub`), during the Phase 0 grilling session, 2026-09-20.
**Purpose**: know exactly what custom, non-LobeHub features and infrastructure already exist in the current app before replacing it, so nothing is lost. Referenced throughout `MIGRATION_PLAN.md` and `decisions/0005`, `0006`, `0009`.

---

## Headline finding before the details

The repo has **already substantially executed** its own migration plan. `docs/plans/cloudflare-replatform.md` (a detailed, dated 2026-08-14 plan) describes moving Supabase→D1, deleting billing, locking models to Cloudflare, rebuilding auth, etc. — and the current code already reflects that _post_-migration state: D1 schema exists and is wired up, `@supabase/*` packages are still in `package.json`/lockfile but are **not imported by any source file anymore** (only stale comments like "Supabase realtime pushed live credit-count changes here" remain), auth is custom session/PBKDF2-based, and `lib/openproviders` is Cloudflare-only. So "replace with LobeHub" is being layered onto an app that itself just finished one full backend replatform.

## 1. AI provider wiring

Read: `lib/openproviders/index.ts`, `provider-map.ts`, `env.ts`, `types.ts`, `repair-stream.ts`.

**Verdict: 100% Cloudflare Workers AI, called through its OpenAI-compatible endpoint. No OpenAI/Anthropic/Google/etc. API calls exist in the chat path.** Display names like "GPT-OSS 120B" and icons like `openai`/`google` are _author_ branding for open-weight models Cloudflare hosts, not calls to real OpenAI/Google APIs.

- `lib/openproviders/index.ts` builds a single `createOpenAI()` client (`@ai-sdk/openai`) pointed at either:
  - `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/v1` (direct Workers AI), or
  - `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY}/workers-ai/v1` (if `CLOUDFLARE_AI_GATEWAY` is set)
  - Auth via `CLOUDFLARE_API_TOKEN`. `openproviders(modelId)` just calls `cloudflareProvider().chat(modelId)` — there is no per-provider branching.
- `provider-map.ts`: `getProviderForModel()` unconditionally returns `"cloudflare"` — comment says "The catalog is Cloudflare-only ... kept as a function because ~10 call sites depend on the shape."
- `types.ts`: `Provider = "cloudflare"` only; `CloudflareModel = string`. Comment: "These types used to enumerate seven vendors."
- `env.ts`: only reads `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_GATEWAY`. No `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/etc. anywhere.
- `repair-stream.ts`: exists purely to patch a Workers-AI-specific bug — its streaming SSE sometimes emits `delta.content` as a bare integer or empty array instead of a string, which fails the AI SDK's schema and truncates responses mid-stream. Documented against `@cf/meta/llama-4-scout-17b-16e-instruct` and found on 4 of 15 models tested.

**Full model catalog** (`lib/models/data/cloudflare.ts`), each with `apiSdk: () => openproviders("@cf/...")`, `provider: "Cloudflare"`:

| id                                             | display name            | author-icon | tools                                      | vision | reasoning |
| ---------------------------------------------- | ----------------------- | ----------- | ------------------------------------------ | ------ | --------- |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast`     | Llama 3.3 70B           | llama       | false (leaks tool calls as JSON on stream) | no     | no        |
| `@cf/openai/gpt-oss-120b`                      | GPT-OSS 120B            | openai      | true                                       | no     | true      |
| `@cf/openai/gpt-oss-20b`                       | GPT-OSS 20B             | openai      | true                                       | no     | true      |
| `@cf/meta/llama-4-scout-17b-16e-instruct`      | Llama 4 Scout           | llama       | true                                       | true   | no        |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | Mistral Small 3.1       | mistral     | true                                       | true   | no        |
| `@cf/deepseek-ai/deepseek-v4-pro-0813`         | DeepSeek V4 Pro         | deepseek    | true                                       | no     | true      |
| `@cf/deepseek-ai/deepseek-v4-flash-0731`       | DeepSeek V4 Flash       | deepseek    | true                                       | no     | true      |
| `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | DeepSeek R1 Distill 32B | deepseek    | false                                      | no     | true      |
| `@cf/qwen/qwen2.5-coder-32b-instruct`          | Qwen2.5 Coder 32B       | qwen        | false                                      | no     | no        |
| `@cf/qwen/qwen3-30b-a3b-fp8`                   | Qwen3 30B               | qwen        | true                                       | no     | true      |
| `@cf/zai-org/glm-5.2`                          | GLM 5.2                 | zai         | true                                       | no     | true      |
| `@cf/moonshotai/kimi-k2.6`                     | Kimi K2.6               | kimi        | true                                       | true   | true      |
| `@cf/google/gemma-4-26b-a4b-it`                | Gemma 4 26B             | google      | true                                       | true   | true      |
| `@cf/nvidia/nemotron-3-120b-a12b`              | Nemotron 3 120B         | nvidia      | true                                       | no     | true      |
| `@cf/meta/llama-3.1-8b-instruct-fp8`           | Llama 3.1 8B            | llama       | false                                      | no     | no        |

Plus `CLOUDFLARE_WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo"` for `/api/transcribe` (speech-to-text). Image models (`lib/image-providers/types.ts`) are all `@cf/black-forest-labs/flux-2-*`, `@cf/leonardo/lucid-origin`, `@cf/leonardo/phoenix-1.0`, `@cf/black-forest-labs/flux-1-schnell` — again all Workers AI, again authored-brand names, not real hosted APIs.

The **only** non-Cloudflare model calls in the whole app are Black Forest Labs' _hosted_ editing API (`api.bfl.ai`) used solely by background-removal and image-enhancer (see §4), gated behind `BFL_API_KEY`; that's a real third-party service, but it's outside the chat/model catalog entirely.

`wrangler.jsonc`'s comment is accurate: no `ai` binding is declared, and the reasoning given ("declaring it forces a _remote_ dev session requiring Workers Scripts permissions") is stated inline.

## 2. Supabase usage

`@supabase/ssr` (^0.10.3) and `@supabase/supabase-js` (^2.106.0) are still listed in `package.json`/`pnpm-lock.yaml`, but **grep for `from ["']@supabase` across the whole app/lib/components tree returns zero hits.** Supabase has already been fully removed from the runtime code; the packages are dead weight left in `package.json` (not yet `npm uninstall`ed).

What's left are only comments/error strings documenting the removal:

- `lib/db/index.ts:4` — "D1 has no Row Level Security, so the ownership predicates that Supabase RLS used to enforce ..."
- `lib/db/types.ts:4` — "These replace the generated Supabase types."
- `lib/storage/r2.ts:4` — "R2 object storage. Replaces Supabase Storage."
- `lib/user-store/api.ts:49`, `lib/user-store/provider.tsx:69` — "Supabase realtime pushed live credit-count/user-row changes here. D1 has no equivalent."
- `app/api/rate-limits/route.ts:19` and `app/api/create-chat/route.ts:24` — literal string `"Supabase not available in this deployment."` (dead-code guard branches, presumably unreachable now that D1 is authoritative).

Auth is now fully custom: `lib/auth/session.ts`, `lib/auth/password.ts` (PBKDF2 via WebCrypto), `lib/auth/emailIdentity.ts`, `lib/auth/disposableEmail.ts` + routes `app/api/auth/{register,login,logout,session}/route.ts`, storing a `sessions` row in D1 and a session-id cookie. So: **Supabase, when it existed, was used for both auth and as the Postgres app database — but today it is used for neither; D1 replaced both roles**, and the Supabase packages are just unused leftovers to prune.

## 3. D1 usage today

`migrations/0001_initial_schema.sql` is **not empty scaffolding — it's a fully-populated, actively-used schema**, already wired to real app code (`lib/db/{users,chats,messages,projects,sessions,misc}.ts`, `lib/db/client.ts`). Tables:

- `users` (id, email, email_canonical, password_hash, anonymous, display_name, profile_image, favorite_models, system_prompt, message_count, onboarding_email_count, relance_step, opted_in_for_email_updates, timestamps)
- `sessions` (replaces Supabase Auth — id, user_id, expires_at, created_at, user_agent)
- `projects`
- `chats` (with `public`, `pinned`, `model`, `system_prompt`)
- `messages` (parts/experimental_attachments as JSON TEXT)
- `chat_attachments`
- `feedback`
- `user_preferences` (layout, prompt_suggestions, hidden_models JSON, etc.)
- `email_jobs` (queue for onboarding/relance emails, `UNIQUE(user_id, type, template_id)`)
- `research_sessions` (Deep Research)
- `generated_images`

`wrangler.jsonc` declares the `DB` binding (`database_name: "openchat"`, real `database_id`), `migrations_dir: "migrations"`. This is live production infrastructure, not a stub.

## 4. Background removal

`@imgly/background-removal` (WASM, client-only) is used in exactly one place, `app/background-removal/page.tsx`, and only for **instant homepage demo previews** — it lazy-imports `removeBackground` from `@imgly/background-removal` to process the pre-baked demo images (`/images/demo/hero.png`, `tiles.png`, and per-category demo images for people/products/animals/cars) entirely in-browser, with no network round-trip, purely so the landing page shows a live cutout without hitting a server.

**The actual user-facing "Remove" button does NOT use @imgly.** It POSTs the uploaded file to `app/api/background-removal/route.ts`, which calls **Black Forest Labs' hosted FLUX editing endpoints** (`api.bfl.ai/v1/flux-2-pro-preview`, `flux-kontext-max`, `flux-kontext-pro`, tried in order, with polling), authenticated by `BFL_API_KEY`. Feature scope:

- Standalone marketing-style page (hero, comparison slider, workflow cards, Trustpilot strip) — a full landing-page tool, not a small utility.
- For signed-in users, results are persisted to R2 (`persistGeneratedImage`) and recorded in the shared `generated_images` table, and (if launched from a chat) appended as a synthetic user/assistant turn in that chat via `misc.appendImageTurn`.
- For guests, the cutout is returned inline, not persisted.
- `app/api/image-enhancer/route.ts` is a sibling feature using the same BFL pattern.

## 5. Other custom features

**customerio-node** — `lib/customerio-client.ts` wraps a singleton `APIClient` from `customerio-node`; `app/api/emails/Email.ts` is an abstract base class every template extends, calling `sendEmail()` with a `transactional_message_id`. Triggers, all server-side (no client-initiated sends except the immediate email-change notice):

- **Onboarding drip** — 6 templates (`OnboardingDayOne`…`SixEmail`), scheduled by `app/api/cron/EmailSchedulerCron/route.ts` (`scheduleOnboardingEmails`) for every registered (non-guest) user based on days since signup, queued into `email_jobs`.
- **Re-engagement ("relance")** — 12 templates at hour marks 1,5,24,48,60,72,96,120,144,168,192,216 (`lib/email/relance-steps.ts`), scheduled by the same cron for inactive users (`listInactiveSince`).
- Both drips are only _enqueued_ by `EmailSchedulerCron`; `app/api/cron/EmailDispatcherCron/route.ts` reads up to 20 `pending` `email_jobs` and actually calls `.dispatchEmail()` (Customer.io send), marking `sent`/`failed`. `ON CONFLICT DO NOTHING` on `(user_id, type, template_id)` prevents double-sends.
- **Immediate, non-queued** sends: `EmailUpdatedEmail` (dispatched directly from `app/api/account/request-email-change/route.ts` right after an email change — no verification flow exists anywhere in this app, by design), and `WelcomeEmail` via a generic `app/api/emails/route.ts` POST handler (`type: "trial_started"`).
- `.env.example`: `CUSTOMERIO_API_KEY` — "Unset = no email sent."

**exa-js** — Declared as a dependency (`package.json`, `pnpm-lock.yaml`) but **not imported or called anywhere in the app's source.** Actual web search for chat + Deep Research is implemented in `lib/tools/search-providers/` (`tavily.ts`, `perplexity.ts`, `serper.ts`, selected in `index.ts`'s `getSearchProvider()` by whichever of `TAVILY_API_KEY` / `PERPLEXITY_API_KEY` / `SERPER_API_KEY` is set, in that priority order). The tool itself is `lib/tools/web-search.ts` (`createWebSearchTool`), invoked from the chat/deep-research route's tool set. `exa-js` appears to be another unused leftover dependency, like `@supabase/*`.

**Disposable-email blocking** — `lib/auth/disposableEmail.ts` + `disposableDomains.generated.ts` (~8,183-domain blocklist, generated file) + `disposableOverrides.ts` (manual allow/deny overrides) + `emailIdentity.ts` (`normalizeEmail` for identity vs. `canonicalizeEmail` for anti-abuse, stripping `+tag`/Gmail dots). Regenerated by `scripts/sync-disposable-domains.mjs` from the `disposable-email-domains/disposable-email-domains` GitHub blocklist, with hard-fail sanity gates (refuses to write if < 7,000 domains or if any mainstream provider like gmail.com/outlook.com appears in the fetched list). Enforced at **signup** (`app/api/auth/register/route.ts`, before any DB write) and again at **email-change** (`app/api/account/request-email-change/route.ts`).

**Hourly cron (`wrangler.jsonc` → `"triggers": {"crons": ["0 * * * *"]}`)** — The comment claims it drives "email scheduler/dispatcher and expired-session cleanup," but **no `scheduled()`/`ScheduledEvent` handler exists anywhere in `app/` or `lib/`, and `open-next.config.ts` is just the unmodified `defineCloudflareConfig()` default.** `EmailSchedulerCron` and `EmailDispatcherCron` exist only as plain HTTP `POST` route handlers with no visible caller in the repo. Also **no expired-session cleanup code** at all (no query against `sessions.expires_at` anywhere in `lib/auth/` or `lib/db/`) despite the wrangler.jsonc comment claiming the cron does this — this looks like an aspirational comment describing work not yet done, not a fact about current behavior. (Tracked as a fast-follow in `MIGRATION_PLAN.md` Phase 14.)

**jspdf** — Used in exactly one place: `app/deep-research/export-utils.ts`, function `printChatPdf()`. Lazy-imports `jsPDF`, builds a styled multi-page PDF (brand wordmark, blue title with underline rule, wrapped paragraphs, page-break handling via `ensureSpace`) directly from a Deep Research report's markdown (via a small local `tokenizeMarkdown`/`stripMarkdown`). Called from `app/deep-research/components/research-header-actions.tsx` and `research-report.tsx` — i.e., "Export Deep Research report to PDF," not a chat-wide export feature.

**`lib/csrf.ts`** — Deliberately WebCrypto-only (no `node:crypto`), matching the wrangler.jsonc comment about avoiding Node builtins. `generateCsrfToken()`/`validateCsrfToken()` are both **async** (uses `crypto.subtle.digest("SHA-256", ...)`), token format `${raw}:${sha256Hex(raw+secret)}`, compared with a constant-time `timingSafeEqual`. Secret comes from `process.env.CSRF_SECRET!`. `setCsrfCookie()` sets a non-`httpOnly` `csrf_token` cookie (must be readable by client JS to echo back as a header). The file's own top comment explicitly warns: "a promise is always truthy, so a caller that forgets `await` on `validateCsrfToken()` silently passes every request" — flagged as a critical risk in `docs/plans/cloudflare-replatform.md`'s risk register too. (Tracked for explicit audit in `MIGRATION_PLAN.md` Phase 14.)

## 6. Top-level routes under `app/`

```
app/
├── [sessionId]/        (dynamic — likely shareable/incognito session route)
├── api/                (~45 route handlers — chat, auth, cron, emails, images, deep-research, background-removal, image-enhancer, transcribe, projects, feedback, etc.)
├── apps/               (single page.tsx — hub/index for the "apps" tools like background-removal/image-enhancer)
├── auth/               (login, login-page.tsx, error; no separate /register page — folded into the login dialog)
├── background-removal/ (page.tsx — described in §4)
├── c/[chatId]/         (main chat view)
├── deep-research/       (Deep Research UI + export-utils.ts)
├── image-enhancer/      (sibling to background-removal)
├── images/              (image-generation gallery UI)
├── models/              (page.tsx — model catalog/info page)
├── p/                   (likely "public" shared chat view, mirrors publish route)
├── share/               (share UI)
```

Plus root-level `layout.tsx`, `layout-client.tsx`, `page.tsx`, `global-error.tsx`, `not-found.tsx`, icons/OG image.

Notably **absent**: `/pricing`, `/privacy-policy`, `/cookie-policy` — the pre-existing plan's Phase 1/1B (delete billing, delete legal pages) already appears reflected in the current routes (none of those directories exist under `app/`). Confirmed again by the successful `next build` route table produced when cutting the `master` snapshot branch — 47 routes total, matching this list.

## 7. Existing `docs/` folder (pre-migration)

Four documents, genuinely relevant prior art:

- **`docs/architecture-assessment.md`** — an 8-module feature-addition plan (rebrand, marketing, Stripe billing, paywall tiers, Deep Research, image generation, "Apps" like background-removal/enhancer, multimodal PDF/voice) written against a _pre-Cloudflare_ snapshot (still describes "Auth: Supabase Auth," "DB: Supabase (PostgreSQL)," "8 providers: OpenAI, Anthropic, Google, Mistral, Perplexity, XAI, OpenRouter, Ollama") — i.e. this describes the **state before** the Cloudflare replatform, useful as a feature inventory but stale on backend facts.
- **`docs/plans/cloudflare-replatform.md`** — the big one: a fully worked 8-phase plan (delete billing → rebrand AnyChat→OpenChat → D1 schema/repository seam → auth rebuild + disposable-email blocking → lock models to Cloudflare AI Gateway → lifetime usage caps → storage→R2 → edge/OpenNext deploy → verification), with a measured baseline ("93 files importing Supabase," "42 auth call sites," "13 Supabase tables, 11 survive"), a Postgres→SQLite/D1 translation table, and a risk register. Marked "planned, not started" at the top but — per direct code inspection — is **largely already executed** (D1 schema matches Phase 2's design almost verbatim, csrf.ts already matches Phase 7.1's WebCrypto rewrite, provider-map/env/types already match Phase 4's "collapse to Cloudflare" design, disposable-email code already ported per Phase 3.4). The status line at the top is stale relative to the code — trust the code over that header.
- **`docs/module-5-deep-research.md`** — an earlier design doc for Deep Research; describes a webSearch/readSource tool loop via Tavily/Serper/Brave (mentions "Brave" — not actually implemented; real code uses Tavily/Perplexity/Serper) and an "orchestrator model (Claude/GPT with reasoning)" — this predates the Cloudflare-only model lock, so it's stale on model choice but the tool-loop architecture it describes matches what was actually built.
- **`docs/module-6-image-generation.md`** — earlier design doc describing "7 models across 3 providers" (Black Forest Labs FLUX.2, ByteDance Seedream, Nano Banana) and "Supabase Storage" — the as-built system (`lib/image-providers/types.ts`) instead ended up as 6 Cloudflare Workers AI image models only, stored in R2. Useful as a record of the original _intent_ but not accurate to final implementation.

None of these are formal ADRs, but `cloudflare-replatform.md` in particular is close to one and is the single most load-bearing doc for understanding "why the backend looks the way it does today." This new `docs/plans/lobehub-migration/` folder sits alongside these, doesn't replace them.

## 8. `.env.example` — environment variables

```
# REQUIRED
CLOUDFLARE_ACCOUNT_ID     # owns D1 + R2
CLOUDFLARE_API_TOKEN      # Workers AI access — chat + transcription
CSRF_SECRET               # 32+ char random string, guards POST/PUT/DELETE via middleware.ts

# OPTIONAL
CLOUDFLARE_AI_GATEWAY     # optional AI Gateway name; empty = call Workers AI directly
NEXT_PUBLIC_SITE_URL      # absolute URL for emails/OG tags; falls back to APP_DOMAIN in lib/config.ts
TAVILY_API_KEY            # web search (chat + Deep Research) — set ANY ONE of these three
SERPER_API_KEY
PERPLEXITY_API_KEY
BFL_API_KEY               # Black Forest Labs — image enhancer + background-removal ONLY (plain image generation needs no key, runs on Workers AI FLUX.1 schnell)
CUSTOMERIO_API_KEY        # transactional email; unset = no email sent
```

The file's own header states "Every key below is read somewhere in the code; nothing here is unused" — consistent with what was found (no orphaned env vars in `.env.example` itself; the orphans are instead the `@supabase/*` and `exa-js` _npm packages_ that no longer have corresponding env vars or imports).

`wrangler.jsonc` additionally declares as **secrets** (not in `.env.example`, set via `wrangler secret put`): `CLOUDFLARE_API_TOKEN`, `CSRF_SECRET` — same two as above, just via Wrangler's secret store for the deployed Worker rather than a local `.env`.
