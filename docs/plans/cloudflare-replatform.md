# OpenChat — Cloudflare Re-platform

**Status:** planned, not started · **Created:** 2026-08-14 · **Branch:** `feat/cloudflare-replatform`

Seven changes, one plan:

| #   | Change                                                         | Decided                              |
| --- | -------------------------------------------------------------- | ------------------------------------ |
| 1   | Delete the subscription/billing feature entirely               | —                                    |
| 2   | Lock the model catalog to Cloudflare-hosted models only        | via **AI Gateway**                   |
| 3   | Usage caps: **10 lifetime** guest, **500 lifetime** registered | lifetime, not daily                  |
| 4   | Email + password auth only — no magic link, no Google, no OTP  | —                                    |
| 5   | Block disposable/spam signup domains                           | port NexCoach's module               |
| 6   | Migrate Supabase → **Cloudflare D1** (+ R2, + custom auth)     | **clean cutover**, no data migration |
| 7   | Make the whole app edge-runtime compatible for Workers         | OpenNext                             |
| 8   | Rebrand **AnyChat → OpenChat**; drop the privacy policy        | —                                    |
| 9   | Remove the git remote                                          | —                                    |

**Greenfield.** The existing deployment and its users are explicitly out of scope. D1 starts empty, nothing is migrated, no cutover announcement is owed, and no account or chat carries over. Treat the Supabase project as decommissioned once the new deploy is verified. This removes an entire class of work from the plan — no export scripts, no dual-write window, no compatibility shims.

**No email verification.** The disposable-domain block is the only signup gate. There is no `email_verified` column, no verification mail path, and no OTP anywhere in this plan.

---

## The one sequencing decision that matters

**Delete before you migrate.** Phase 1 removes ~45 files and ~4,000 LOC, 20 of which touch Supabase. Doing the D1 migration first means porting billing code you are about to throw away, then throwing away the port. Phase 1 shrinks the migration surface by roughly a quarter before it begins.

The rest follows from that:

```
Phase 0  Detach & baseline           (30 min)
Phase 1  Delete subscriptions        ← shrinks everything downstream
Phase 1B Rebrand → OpenChat          ← do it while the file count is lowest
Phase 2  D1 schema + repository seam ← the seam every later phase writes against
Phase 3  Auth rebuild + spam blocking
Phase 4  Model lock → AI Gateway
Phase 5  Usage caps 10/500
Phase 6  Storage → R2
Phase 7  Edge compat + OpenNext deploy
Phase 8  Verification
```

Phases 3–6 are independent of one another once Phase 2 lands. Phase 7 must be last: it is the only phase that can't be verified locally against `next dev`.

### Measured baseline

Numbers taken from the repo at `bb86512`, so you can tell progress from drift:

| Metric                                                     | Value                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Files importing Supabase                                   | **93**                                                                               |
| `auth.getUser` / `getSession` / `admin` call sites         | **42**                                                                               |
| Client components calling `createClient()` (RLS-dependent) | **11**                                                                               |
| Node-builtin imports (hard edge blockers)                  | **2** — [lib/csrf.ts:1](lib/csrf.ts#L1), [lib/encryption.ts:1](lib/encryption.ts#L1) |
| Tables in Supabase migrations                              | **13** (11 survive Phase 1)                                                          |
| Subscription-related files                                 | **~45**                                                                              |
| i18n locales carrying billing strings                      | **30**                                                                               |

---

## Phase 0 — Detach & baseline

### 0.1 Remove the git remote

Current remote (Bitbucket, from `.git/config`):

```
origin  https://sarfaraz8@bitbucket.org/itechnolabsca/anychat.git
```

```bash
git remote -v                        # record it somewhere first
git remote remove origin
git remote -v                        # expect: empty
```

`.git/config` also carries `[branch "main"] vscode-merge-base = origin/main`, which becomes a dangling reference once the remote is gone. Clear it so tooling stops resolving against a remote that no longer exists:

```bash
git config --unset branch.main.vscode-merge-base
```

Local branches, history and reflog are untouched. Nothing is pushed anywhere after this point — re-add a remote deliberately when you have a new destination.

### 0.2 Baseline

```bash
git checkout -b feat/cloudflare-replatform
npm run type-check 2>&1 | tee /tmp/typecheck-before.txt   # expect existing errors; record the count
npm run test       2>&1 | tee /tmp/test-before.txt
```

`next.config.ts` sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`, so **the build will not catch what you break.** `npm run type-check` is your only real signal — run it at the end of every phase and compare against this baseline.

---

## Phase 1 — Delete the subscription feature

### 1.1 Delete outright

```
app/api/stripe/                                     # webhook + api.ts
app/api/subscriptions/                              # 12 routes + api.ts (808 LOC)
app/api/subscription-plans/
app/pricing/page.tsx                                # 288 LOC
app/components/layout/go-pro/                       # 15 files, incl. feature-comparison.tsx (99 KB)
app/components/layout/go-pro-dialog.tsx
app/components/layout/upgrade-dialog.tsx
app/components/layout/checkout-form.tsx
app/components/layout/cancel-subscription-intent.tsx
app/components/layout/settings/general/cancel-subscription.tsx
app/api/emails/templates/AbandonedCheckout1Email.ts  # …2, 3, 4
lib/email/abandoned-checkout-steps.ts
app/api/cron/__tests__/abandoned-checkout-scheduler.test.ts
lib/analytics/track-purchase.ts
supabase/seed/seed-power-plan.ts
supabase/seed/subscription-plans.ts
```

`app/components/layout/go-pro/plan-names.ts` is imported from four places outside its own directory ([lib/usage.ts](lib/usage.ts), [app/api/deep-research/tier.ts](app/api/deep-research/tier.ts), [app/api/subscription-plans/route.ts](app/api/subscription-plans/route.ts), [app/components/layout/go-pro/plan-selector.tsx](app/components/layout/go-pro/plan-selector.tsx)). Delete the consumers first, then the file, or you will chase import errors.

### 1.2 Edit — premium gating removal

| File                                                                                                             | Change                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [lib/usage.ts](lib/usage.ts)                                                                                     | Delete `isPowerUser()` (lines 17–37). Remove every call in `checkUsage`, `checkProUsage`, `incrementProUsage`. Fully rewritten in Phase 5 — the minimum here is making it compile. |
| [lib/config.ts:16-19](lib/config.ts#L16-L19)                                                                     | Delete `POWER_PLAN_DAILY_MESSAGE_LIMIT`, `DAILY_LIMIT_PRO_MODELS`, `GUEST_FREE_MESSAGES`                                                                                           |
| [app/api/deep-research/tier.ts](app/api/deep-research/tier.ts)                                                   | **Delete the file.** Decision: Deep Research is free for all registered users.                                                                                                     |
| [app/api/deep-research/route.ts:170-192](app/api/deep-research/route.ts#L170-L192)                               | Delete both `402 TIER_REQUIRED` gates. Keep the `isAuthenticated` check — guests still can't run it.                                                                               |
| [app/components/deep-research/deep-research-session.tsx](app/components/deep-research/deep-research-session.tsx) | Remove `PowerUpgradeDialog` import (L29), `usePowerGate` import (L30), the `powerGate` call (L98), and the `<PowerUpgradeDialog>` render (L720)                                    |
| [app/api/cron/EmailSchedulerCron/route.ts](app/api/cron/EmailSchedulerCron/route.ts)                             | Remove `.eq("premium", true)` at L35 and L80; delete the abandoned-checkout block at L127–L135 entirely                                                                            |
| [app/api/account/delete/route.ts:48](app/api/account/delete/route.ts#L48)                                        | Drop `premium: false` from the update                                                                                                                                              |
| [app/api/auth/post-login/route.ts:67](app/api/auth/post-login/route.ts#L67)                                      | Drop `premium: false`                                                                                                                                                              |
| [app/api/create-guest/route.ts:39](app/api/create-guest/route.ts#L39)                                            | Drop `premium: false`                                                                                                                                                              |
| [app/auth/callback/route.ts:92](app/auth/callback/route.ts#L92)                                                  | Drop `premium: false` (file is deleted in Phase 3 anyway)                                                                                                                          |
| [lib/user-store/provider.tsx](lib/user-store/provider.tsx)                                                       | Remove `premium` from the user shape                                                                                                                                               |

### 1.3 Edit — UI entry points

Remove upgrade/pricing affordances from: [app/components/layout/Footer.tsx:80](app/components/layout/Footer.tsx#L80) (pricing link), [app/components/layout/header.tsx](app/components/layout/header.tsx), [app/components/layout/user-menu-items.tsx](app/components/layout/user-menu-items.tsx), [app/components/layout/profile-dialog.tsx](app/components/layout/profile-dialog.tsx), [app/layout.tsx](app/layout.tsx) (Stripe provider/script), [components/common/model-selector/pro-dialog.tsx](components/common/model-selector/pro-dialog.tsx).

Also strip billing copy from [app/help/content.ts](app/help/content.ts), [app/terms/page.tsx](app/terms/page.tsx), [app/privacy-policy/page.tsx](app/privacy-policy/page.tsx) — these are prose files, read them rather than pattern-matching.

### 1.4 CSP — remove Stripe origins

[middleware.ts](middleware.ts) has two near-identical CSP strings (dev at L45, prod at L46). Remove from **both**:

```
script-src  … https://js.stripe.com
frame-src   … https://js.stripe.com https://hooks.stripe.com
connect-src … https://api.stripe.com
```

### 1.5 Dependencies

```bash
npm uninstall @stripe/react-stripe-js @stripe/stripe-js stripe
```

### 1.6 i18n — 30 locales

[lib/i18n/messages/en.ts](lib/i18n/messages/en.ts) carries four billing blocks: `upgrade:` (L611), `pricing:` (L755), `goPro:` (L908), plus `nav.goPro` (L14) and `footer.pricing` (L176). The same shape repeats across all 30 locale files.

Do `en.ts` by hand first to establish the exact block boundaries, then script the rest and **type-check after** — the locale files are typed against `en.ts`, so a missed key in one locale surfaces as a type error rather than a silent runtime gap.

### 1.7 Database

Per your decision, the schema moves to D1 wholesale in Phase 2 — so there is no drop migration here. Simply **do not port** `subscriptions`, `subscription_plans`, `users.premium`, `users.stripe_customer_id`, or `users.abandoned_checkout_step` when you write the D1 schema. The Supabase project stays untouched as your rollback.

### Phase 1 exit criteria

- `grep -ril "stripe\|subscription\|premium\|goPro" app lib components --include=*.ts --include=*.tsx` returns only `app/api/cron/` test fixtures you have consciously kept
- `npm run type-check` error count ≤ baseline
- App boots, chat works, Deep Research runs for a logged-in user with no 402

---

## Phase 1B — Rebrand to OpenChat

Run this immediately after Phase 1, while the file count is at its lowest — Phase 1 deletes ~45 files that would otherwise each need a brand pass, and Phase 4 deletes eleven more.

### 1B.1 Scope

Measured at `bb86512`: **197 occurrences of "anychat" across 57 files.** There is also a second, older brand layer — this repo is a **Zola** fork, and `package.json` still declares `"name": "zola"`. Both go.

### 1B.2 Source of truth

[lib/config.ts:26-28](lib/config.ts#L26-L28):

```ts
export const APP_NAME = "OpenChat"
export const APP_DOMAIN =
  process.env.NEXT_PUBLIC_SITE_URL || "https://<new-domain>"
```

`APP_DOMAIN` is consumed by ~15 email templates and [app/api/account/request-email-change/route.ts:58](app/api/account/request-email-change/route.ts#L58). **The production domain is still unknown** — leave the env fallback pointing at a placeholder and set `NEXT_PUBLIC_SITE_URL` in `wrangler.jsonc` vars. Do not hardcode `anychat.itechnolabs.tech` forward.

Most UI copy already reads brand from i18n (`nav.brand` at [en.ts:164](lib/i18n/messages/en.ts#L164)), not from `APP_NAME` — so changing the constant alone will _not_ rebrand the interface. Both paths need doing.

### 1B.3 Code and assets

| Target                                                                                              | Change                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                                                      | `"name": "zola"` → `"openchat"`                                                                                                                                                                                                                                                                                              |
| [components/icons/zola.tsx](components/icons/zola.tsx)                                              | → `components/icons/openchat.tsx`; `ZolaIcon` → `OpenChatIcon`, `ZolaIconProps` → `OpenChatIconProps`                                                                                                                                                                                                                        |
| `ZolaIcon` importers                                                                                | [header.tsx:65](app/components/layout/header.tsx#L65), [app-sidebar.tsx:6,129](app/components/layout/sidebar/app-sidebar.tsx#L6), [legal-layout.tsx:25](app/components/layout/legal/legal-layout.tsx#L25) (commented out — delete the comment)                                                                               |
| [app/layout.tsx:93](app/layout.tsx#L93)                                                             | `data-debug: "zola.chat"` → `"openchat"`; plus metadata title/description/OG                                                                                                                                                                                                                                                 |
| `app/opengraph-image.alt`                                                                           | rewrite                                                                                                                                                                                                                                                                                                                      |
| `public/`                                                                                           | `favicon-anychat.svg`, `logo-anychat.svg`, `logo-anychat-dark.svg`, `logo-anychat-mark.svg`, `logo-anychat-mark-dark.svg` → `-openchat` names. **New artwork is a design task, not a rename** — if none exists yet, rename the files to unblock the build and track the real assets separately. Also `favicon-16/32/48.png`. |
| `README.md`, `CODE_OF_CONDUCT.md`, `docs/architecture-assessment.md`, `docs/conversion-tracking.md` | prose — read and rewrite, don't sed                                                                                                                                                                                                                                                                                          |
| `docker-compose.yml`                                                                                | service `zola` → `openchat`                                                                                                                                                                                                                                                                                                  |
| `.itechnolabs/`                                                                                     | vendor automation tied to the old Bitbucket remote; review whether it survives Phase 0 at all                                                                                                                                                                                                                                |

**⚠️ `ZOLA_OFFICIAL` is functional, not cosmetic.** [app/layout.tsx:56](app/layout.tsx#L56) reads `process.env.ZOLA_OFFICIAL === "true"` to gate the onedollarstats analytics script ([docs/conversion-tracking.md:155](docs/conversion-tracking.md#L155)). Renaming it to `OPENCHAT_OFFICIAL` means updating the env var **everywhere it is set** — `.env.example`, and `wrangler.jsonc` vars in Phase 7. Miss one and analytics silently stops firing in production, which is the kind of bug nobody notices for a month. Rename it deliberately or leave it alone; do not half-do it.

**Two files should be deleted rather than renamed:**

- **`docker-compose.ollama.yml`** — Ollama support is removed in Phase 4, and Phase 7 deploys to Workers. The whole file is dead. (`Dockerfile` and `docker-compose.yml` are likely dead too once OpenNext lands — confirm in Phase 7 before deleting, since they may still serve local dev.)
- **`INSTALL.md`** — 650 lines of upstream Zola documentation covering Supabase setup, Ollama integration, BYOK encryption keys and `git clone github.com/ibelick/zola.git`. Every one of those is removed by this plan. This is not a rename; it is a rewrite against the Cloudflare stack, and it should happen at the end of Phase 7 when the real deploy steps are known. Leave it stale until then rather than rewriting it twice.

Note `INSTALL.md:5` references `./public/cover_zola.webp`, which **does not exist** — a broken image link inherited from upstream. It disappears with the rewrite.

Ten app components carry inline brand strings — [message-assistant.tsx](app/components/chat/message-assistant.tsx), [utils.ts](app/components/chat/utils.ts), [Footer.tsx](app/components/layout/Footer.tsx), [chat-header-actions.tsx](app/components/layout/chat-header-actions.tsx), [dialog-publish.tsx](app/components/layout/dialog-publish.tsx), [header.tsx](app/components/layout/header.tsx), [incognito-header-actions.tsx](app/components/layout/incognito-header-actions.tsx), [research-header-actions.tsx](app/deep-research/components/research-header-actions.tsx), [research-report.tsx](app/deep-research/components/research-report.tsx), [export-utils.ts](app/deep-research/export-utils.ts), [base.tsx](components/common/multi-model-selector/base.tsx), [read-source.ts](lib/tools/read-source.ts), [lib/user/api.ts](lib/user/api.ts).

### 1B.4 i18n — 30 locales

Six English strings at [en.ts](lib/i18n/messages/en.ts) lines 69, 95, 164, 589, 590, 900, with equivalents in all 30 locales.

Line 69 and line 900 are not simple substitutions — they name the old model lineup (_"Chat with Claude, OpenAI, Gemini, and Grok"_) and BYOK-via-OpenRouter. Both become false in Phase 4. Rewrite the copy rather than swapping the brand token inside a sentence that is about to be wrong.

Order the work: rewrite `en.ts` by hand, then script the mechanical `AnyChat` → `OpenChat` replacement across the other 29, then hand-fix lines 69 and 900 per locale. Type-check after — locales are typed against `en.ts`.

### 1B.5 Legal pages — privacy and cookie policies removed

**Delete both pages:**

```
app/privacy-policy/page.tsx
app/cookie-policy/page.tsx
```

**The Footer legal block collapses to a single link.** All four entries at [Footer.tsx:70-73](app/components/layout/Footer.tsx#L70-L73) except Terms are now dead:

| Line | Link                         | Fate                                                                                      |
| ---- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| 70   | `/privacy-policy`            | removed                                                                                   |
| 71   | `/terms`                     | **kept** — the only survivor                                                              |
| 72   | `/cookie-policy`             | removed                                                                                   |
| 73   | `/terms#cancellation-refund` | removed — Phase 1 killed billing, so a refund policy for a product that takes no payments |

A "Legal" heading over one link looks like a bug. Either fold Terms into the adjacent Help column or drop the heading. Also remove the now-orphaned `footer.privacyPolicy`, `footer.cookiePolicy`, `footer.refundPolicy` i18n keys across all 30 locales.

**Terms still references both deleted pages in prose.** [app/terms/page.tsx:28](app/terms/page.tsx#L28) reads _"be bound by these Terms, our Privacy Policy, our Cookie Policy, any…"_. Deleting the pages without editing this sentence leaves Terms pointing at documents that 404. Rewrite the clause, and remove the `#cancellation-refund` section while you are in the file.

**Entity name — resolved.** These pages were written for QUANTUM95 LLC, which a blind `anychat` → `OpenChat` pass would not have caught. All 95 references across Terms and the 30 locale files are now "OpenChat". See the open item below about the postal address.

One factual note, recorded once: the app still collects email addresses, passwords, chat content and (if §5.3 ships) hashed IPs. Shipping without a privacy or cookie policy is a GDPR/CCPA exposure and blocks some ad and app-store channels. Removal is planned as decided — noted here because reinstating is a page, and being caught without one is not.

### Phase 1B exit criteria

- `grep -ril "anychat\|zola" . --exclude-dir=node_modules --exclude-dir=.git` returns nothing outside `docs/plans/`
- Favicon, OG image and sidebar mark all show the new brand
- `npm run type-check` error count ≤ baseline
- No link resolves to `/privacy-policy`

---

## Phase 2 — D1 schema and the repository seam

### 2.1 Why a repository layer

93 files import Supabase directly. If each one gets hand-converted to raw D1 SQL, you get 93 chances to write a subtly different query and no single place to fix an index. Introduce `lib/db/` as a seam: route handlers call repositories, repositories own SQL.

This also solves a problem you cannot avoid: **D1 has no Row Level Security.** Supabase RLS is silently enforcing authorization today for 11 client components that query directly. Every one of those checks must become explicit server-side code, and the repository is where it lives.

```
lib/db/
  client.ts          # getDb() → D1Database from the request context
  types.ts           # row types (replaces app/types/database.types.ts)
  users.ts           # findById, findByEmail, create, incrementMessageCount, softDelete
  chats.ts           # listForUser, create, updateModel, togglePin, softDelete
  messages.ts        # listForChat, insert, insertAssistantFinal
  projects.ts
  attachments.ts
  userPreferences.ts
  feedback.ts
  emailJobs.ts
  researchSessions.ts
  generatedImages.ts
  sessions.ts        # Phase 3
```

**Rule: every repository method takes the acting `userId` and scopes its WHERE clause by it.** That is the RLS replacement. A method that returns rows without an ownership predicate is a bug, not a shortcut.

### 2.2 Postgres → D1 (SQLite) translation

D1 is SQLite. These differences will bite:

| Postgres               | D1 / SQLite               | Action                                                                                                                                        |
| ---------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `uuid_generate_v4()`   | none                      | Generate in app: `crypto.randomUUID()`. Store as `TEXT`.                                                                                      |
| `timestamptz`          | none                      | `TEXT` ISO-8601 (`new Date().toISOString()`). Sorts correctly as text — keep the format uniform or ordering silently breaks.                  |
| `jsonb`                | none                      | `TEXT`; `JSON.parse` at the repository boundary, never in a route                                                                             |
| `text[]`               | none                      | JSON `TEXT`                                                                                                                                   |
| `boolean`              | `INTEGER` 0/1             | Coerce in the repository — `!!row.anonymous`. JS truthiness makes `0` falsy, so a raw pass-through mostly works and then fails on `=== true`. |
| Row Level Security     | none                      | Explicit `WHERE user_id = ?` everywhere                                                                                                       |
| Realtime subscriptions | none                      | See 2.4                                                                                                                                       |
| `ON CONFLICT`          | supported                 | no change                                                                                                                                     |
| Foreign keys           | off by default            | D1 enables them per-session; still declare `REFERENCES`                                                                                       |
| `RETURNING`            | supported (SQLite ≥ 3.35) | no change                                                                                                                                     |

### 2.3 Schema

Port these 11 tables from `supabase/migrations/`: `users`, `projects`, `chats`, `messages`, `chat_attachments`, `feedback`, `user_keys`*, `user_preferences`, `email_jobs`, `research_sessions`, `generated_images`.

\* `user_keys` is dropped in Phase 4 (BYOK goes away when all models are server-hosted). Skip it.

Create the D1 database and the migration:

```bash
npx wrangler d1 create anychat
# copy the returned database_id into wrangler.jsonc
npx wrangler d1 migrations create anychat initial_schema
```

The `users` table, post-Phase-1 and pre-Phase-3:

```sql
CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  email_canonical   TEXT,                        -- Phase 3, anti-abuse only
  password_hash     TEXT,                        -- Phase 3; NULL for guests
  display_name      TEXT,
  profile_image     TEXT,
  anonymous         INTEGER NOT NULL DEFAULT 0,
  message_count     INTEGER NOT NULL DEFAULT 0,  -- lifetime; the cap in Phase 5
  onboarding_email_count INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  last_active_at    TEXT,
  deleted_at        TEXT
);
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_canonical   ON users(email_canonical);
CREATE INDEX idx_users_anonymous   ON users(anonymous);
```

Dropped vs. Supabase: `premium`, `stripe_customer_id`, `abandoned_checkout_step`, `daily_message_count`, `daily_reset`, `daily_pro_message_count`, `daily_pro_reset` (Phase 5 makes the daily counters dead — lifetime caps need only `message_count`).

Apply:

```bash
npx wrangler d1 migrations apply anychat --local     # dev
npx wrangler d1 migrations apply anychat --remote    # prod, after verifying local
```

### 2.4 Realtime has no D1 equivalent

[lib/user-store/api.ts:84-97](lib/user-store/api.ts#L84-L97) opens a Supabase realtime channel on the user row; [lib/user-store/provider.tsx:69-78](lib/user-store/provider.tsx#L69-L78) consumes it. It exists to push credit-count changes live.

Replace with refetch-on-mutation: the chat send path already knows when the count changed, so invalidate the TanStack Query key for the user after a successful send. Delete the channel code. Do not attempt to reproduce realtime with polling — it is a counter, not a feed.

### 2.5 Data migration — none

**Decided: greenfield.** D1 starts empty. Do not write an export/transform script, do not budget time for one, and do not build compatibility shims for old row shapes.

The existing project is out of scope entirely — no users carry over, no history carries over, nothing is owed to the old deployment. Delete `supabase/` (migrations and seed) once the D1 schema is authoritative; leaving two schema sources invites drift.

The only thing worth seeding is a local dev fixture: one guest and one registered user, so Phase 5's caps can be exercised without clicking through signup 500 times.

### Phase 2 exit criteria

- `npx wrangler d1 execute anychat --local --command "SELECT name FROM sqlite_master WHERE type='table'"` lists all expected tables
- Every `lib/db/*.ts` method scopes by `userId`
- No route handler imports `@supabase/*` for data reads any more (auth still does until Phase 3)

---

## Phase 3 — Auth rebuild + disposable-email blocking

### 3.1 Delete

```
app/api/auth/route.ts            # magic link via Customer.io template 40
app/auth/confirm/page.tsx        # magic-link landing
app/auth/callback/route.ts       # Google OAuth PKCE callback
app/api/emails/templates/MagicLinkEmail.ts
public/google-icon.svg
```

And from [lib/api.ts](lib/api.ts): `signInWithGoogle` (L105–L142) and `signInWithEmail` (L157–L180).

### 3.2 Password hashing — PBKDF2, not bcrypt

**bcrypt and argon2 are native Node modules and will not run on Workers.** Use PBKDF2 through WebCrypto, which Workers supports natively:

```ts
// lib/auth/password.ts
const ITERATIONS = 100_000 // ~30ms; fine on the paid plan's 30s CPU budget
const KEY_LEN = 32

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  )
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    KEY_LEN * 8
  )
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`
}
```

`verifyPassword` re-derives with the stored salt/iterations and compares in **constant time** — a plain `===` on the hash leaks timing. Store the algorithm and iteration count in the string so the cost can be raised later without invalidating existing hashes.

### 3.3 Sessions

```sql
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- crypto.randomUUID()
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30 days). Store only the session id — never the user id, never anything derived from the password.

New routes, all `runtime = "edge"`:

| Route                     | Behaviour                                                                    |
| ------------------------- | ---------------------------------------------------------------------------- |
| `POST /api/auth/register` | normalize → **disposable check** → duplicate check → hash → insert → session |
| `POST /api/auth/login`    | normalize → lookup → verify → session                                        |
| `POST /api/auth/logout`   | delete session row, clear cookie                                             |
| `GET  /api/auth/session`  | current user or `null`                                                       |

Guests keep working the same way conceptually — a `users` row with `anonymous = 1` — but the identity now comes from your own session cookie instead of `supabase.auth.signInAnonymously()`. Rewrite `getOrCreateGuestUserId` in [lib/api.ts:172-230](lib/api.ts#L172-L230) to call `POST /api/create-guest`, which mints the row and the cookie server-side.

### 3.4 Disposable-email blocking — port from NexCoach

NexCoach's implementation is well-shaped; port it as-is rather than re-deriving. Source files:

```
E:\NexCoach\nexcoach-webapp\src\server\auth\emailIdentity.ts
E:\NexCoach\nexcoach-webapp\src\server\auth\disposableEmail.ts
E:\NexCoach\nexcoach-webapp\src\server\auth\disposableOverrides.ts
E:\NexCoach\nexcoach-webapp\src\server\auth\disposableDomains.generated.ts
E:\NexCoach\nexcoach-webapp\scripts\sync-disposable-domains.mjs
E:\NexCoach\nexcoach-webapp\src\server\__tests__\disposableEmail.test.ts
```

→ `lib/auth/` and `scripts/` here. They are dependency-free and already edge-safe.

**The four ideas that make it work — keep all of them:**

1. **Two email functions, never conflated.** `normalizeEmail` (lowercase + trim) is _identity_ — what you store, index and look up. `canonicalizeEmail` (strip `+tag`, strip dots at Gmail only) is _anti-abuse_ — consulted only when deciding whether a free allowance may be claimed. Using canonicalization for identity would merge `a+work@gmail.com` and `a@gmail.com` into one account, which is wrong.

2. **Parent-domain walk.** Services hand out `user@foo.mailinator.com` while only `mailinator.com` is listed. The walk stops at two labels so a bare public suffix like `co.uk` is never tested.

3. **Manual overrides beat the list.** `ALLOW_OVERRIDE` is checked first and wins. Upstream explicitly does not guarantee currency — a domain disposable in 2019 may be a real business today. When support hits a false positive they need a one-line fix, not an upstream PR.

4. **The sync script refuses to write a bad list.** It hard-fails if the fetch returns < 7,000 domains, if the new list is >10% smaller than the current one, or if any mainstream provider (`gmail.com`, `outlook.com`, `icloud.com`, …) appears. This list gates signup — a bad upstream merge would lock every new registration out of the product.

Yes, `@yopmail.com` is in the 8,183-domain list.

Add to `package.json`:

```json
"sync:disposable-domains": "node scripts/sync-disposable-domains.mjs",
"check:disposable-domains": "node scripts/sync-disposable-domains.mjs --check"
```

Wire into register, before any write — matching [RegisterTrainerAction.ts:29-36](E:/NexCoach/nexcoach-webapp/src/server/actions/user/RegisterTrainerAction.ts#L29-L36):

```ts
const email = normalizeEmail(payload.email)

if (isDisposableEmail(email)) {
  return json(
    {
      error:
        "Please sign up with a permanent email address. Temporary or " +
        "disposable email addresses are not supported. If this is your " +
        "regular address, contact support and we will enable it.",
      code: "DISPOSABLE_EMAIL",
    },
    { status: 400 }
  )
}
```

Reject **before** creating anything: it keeps junk rows out of D1 and avoids sending mail to domains that bounce, which damages sending reputation.

**Bundle-size note:** the domain list is a single ~130 KB string literal. That is deliberate — V8 parses one large literal far faster than 8,183 array elements, and the cost is paid on every isolate cold start. It fits comfortably in the Workers bundle limit.

### 3.5 Rewrite the login UI

[app/components/layout/login-dialog.tsx](app/components/layout/login-dialog.tsx) is 429 lines, most of it testimonial carousel and Google buttons. Rewrite as a two-tab (Sign in / Create account) email+password form. Keep the testimonial panel if you want the layout — it is inert markup. Remove: `signInWithGoogle` (L136–L160), the four Google favicon buttons (L306–L420), `magicLinkSent` state and copy (L327–L332).

[app/auth/login-page.tsx](app/auth/login-page.tsx) (101 lines) is Google-only — rewrite against the same form component.

Client-side validation: valid email shape, password ≥ 8 chars. Server-side is authoritative; the client copy just avoids a round-trip.

### 3.6 i18n

Remove `loginDialog.magicLinkSent`, `common.buttons.continueWithGoogle`, `auth.login.googleLogoAlt`, `auth.login.continueWithGoogle` across all 30 locales. Add `auth.password`, `auth.confirmPassword`, `auth.signUp`, `auth.signIn`, `auth.errors.disposableEmail`, `auth.errors.emailTaken`, `auth.errors.invalidCredentials`.

### Phase 3 exit criteria

- Register with `test@yopmail.com` → 400 `DISPOSABLE_EMAIL`
- Register with `test@gmail.com` → succeeds
- `Foo@Gmail.com` and `foo@gmail.com` resolve to one account
- Guest → registered upgrade preserves chat history
- No `@supabase/*` import remains anywhere in `app/` or `lib/`

---

## Phase 4 — Lock models to Cloudflare (AI Gateway)

### 4.1 Get the real catalog first

Do not hand-write model IDs from memory. Ask the platform:

```bash
npx wrangler ai models
```

Take text-generation, tool-capable models from that output. As a starting shape — **verify each against the command above**:

```
@cf/meta/llama-3.3-70b-instruct-fp8-fast
@cf/meta/llama-4-scout-17b-16e-instruct
@cf/openai/gpt-oss-120b
@cf/openai/gpt-oss-20b
@cf/qwen/qwen2.5-coder-32b-instruct
@cf/deepseek-ai/deepseek-r1-distill-qwen-32b
@cf/mistralai/mistral-small-3.1-24b-instruct
```

Tool-calling support varies per model and matters: [app/api/chat/route.ts:233](app/api/chat/route.ts#L233) passes tools, and Deep Research needs a model that can drive the `webSearch`/`readSource` loop. Set `tools: true` in `ModelConfig` only for models you have actually tested with a tool call.

### 4.2 Provision the gateway

```bash
npx wrangler ai gateway create anychat
```

Base URL:

```
https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/anychat/workers-ai/v1
```

This is OpenAI-compatible, so it plugs into the existing `createOpenAI` factory — the same pattern [lib/openproviders/index.ts:60-67](lib/openproviders/index.ts#L60-L67) already uses for Ollama. No new dependency.

```ts
// lib/openproviders/index.ts
const createCloudflareProvider = () =>
  createOpenAI({
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_AI_GATEWAY}/workers-ai/v1`,
    apiKey: env.CLOUDFLARE_API_TOKEN,
    name: "cloudflare",
  })
```

Going through the gateway rather than direct Workers AI buys you request logging, caching and per-gateway rate limiting server-side — worth having with a fixed lifetime quota per user.

### 4.3 Collapse the model layer

**Decided: only Cloudflare models enabled, everything else disabled.** The catalog is locked; the model picker stays and shows Cloudflare models only.

The codebase already has the exact mechanism for this. [lib/models/index.ts](lib/models/index.ts) filters every model through `ALLOWED_MODEL_IDS_ORDERED` — _"Anything not in this list is hidden everywhere; the order here is the dropdown's display order."_ Replacing the contents of that list **is** the lock. Keep the mechanism; swap the list.

**Disabled here means removed, not greyed out.** Two reasons, both worth stating because the alternative is a defensible reading of "disabled":

- Rendering permanently-locked models with no unlock path is a dead end for the user. The old lock UI ([components/common/model-selector/pro-dialog.tsx](components/common/model-selector/pro-dialog.tsx)) existed to sell an upgrade — and the upgrade is gone in Phase 1.
- Keeping the model definitions alive means keeping six AI SDK provider packages in the bundle, unused, against a Workers size limit. Git history is the rollback if a provider ever comes back.

**Delete** from `lib/models/data/`: `claude.ts`, `openai.ts`, `gemini.ts`, `grok.ts`, `mistral.ts`, `perplexity.ts`, `deepseek.ts`, `llama.ts`, `openrouter.ts`, `ollama.ts`, `openai-localized-descriptions.ts`.

**Create** `lib/models/data/cloudflare.ts` exporting `cloudflareModels: ModelConfig[]`. Keep `localized-descriptions.ts` and `provider-localized-descriptions.ts` and re-point them.

**Rewrite** [lib/models/index.ts](lib/models/index.ts): `ALLOWED_MODEL_IDS_ORDERED` becomes the Cloudflare list; `STATIC_MODELS` becomes `cloudflareModels` alone. The existing allow-list-and-sort mechanism is exactly right — it already hides anything not explicitly listed. Keep it.

**Rewrite** [lib/openproviders/provider-map.ts](lib/openproviders/provider-map.ts): every entry maps to `"cloudflare"`. Delete `isOllamaModel()` and its pattern list.

**Update** [lib/openproviders/env.ts](lib/openproviders/env.ts):

```ts
export const env = {
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID!,
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN!,
  CLOUDFLARE_AI_GATEWAY: process.env.CLOUDFLARE_AI_GATEWAY!,
}
```

Delete `createEnvWithUserKeys` — there are no user keys any more.

**Update** [lib/config.ts](lib/config.ts):

```ts
export const MODEL_DEFAULT = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
export const NON_AUTH_ALLOWED_MODELS = [MODEL_DEFAULT] // guests get one model
export const FREE_MODELS_IDS = [/* every CF model id */]
```

### 4.4 BYOK goes away

All models are server-hosted on one account, so per-user API keys are meaningless. Delete:

```
app/components/layout/settings/apikeys/byok-section.tsx
app/api/user-keys/route.ts
app/api/user-key-status/route.ts
lib/user-keys.ts
lib/encryption.ts          # only consumer was user_keys — also removes an edge blocker
```

Then simplify [app/api/chat/api.ts:41-58](app/api/chat/api.ts#L41-L58): drop the `getEffectiveApiKey` round-trip and the "requires an API key" branch. `apiKey` becomes the server token, resolved once from env.

This is a two-for-one: deleting `lib/encryption.ts` removes one of the only two Node-builtin imports in the codebase.

### 4.5 Dependencies

```bash
npm uninstall @ai-sdk/anthropic @ai-sdk/google @ai-sdk/mistral \
              @ai-sdk/perplexity @ai-sdk/xai @openrouter/ai-sdk-provider
```

Keep `@ai-sdk/openai` (the gateway speaks its protocol), `@ai-sdk/react`, `ai`.

### 4.6 CSP

Add the gateway to `connect-src` in both middleware CSP strings; remove `https://api.openai.com` and `https://api.mistral.ai`:

```
connect-src … https://gateway.ai.cloudflare.com
```

### Phase 4 exit criteria

- Model dropdown shows only `@cf/*` models
- A chat completes end-to-end through the gateway
- Gateway dashboard shows the request logged
- `grep -rn "OPENAI_API_KEY\|ANTHROPIC_API_KEY\|XAI_API_KEY" app lib` returns nothing

---

## Phase 5 — Lifetime usage caps

### 5.1 The model

`users.message_count` already exists and already increments on every message ([lib/usage.ts:107-155](lib/usage.ts#L107-L155)). It is never reset. That is exactly a lifetime counter — so this phase is mostly **deletion**.

```ts
// lib/config.ts
export const GUEST_TOTAL_MESSAGE_LIMIT = 10
export const AUTH_TOTAL_MESSAGE_LIMIT = 500
export const REMAINING_QUERY_ALERT_THRESHOLD = 2
```

### 5.2 Rewrite `lib/usage.ts`

Delete: `isPowerUser`, `checkProUsage`, `incrementProUsage`, `checkUsageByModel`'s pro branch, all daily-reset logic (the UTC rollover block at L79–L100 and its pro twin at L180–L200), and the `isFreeModel`/`isProModel` helpers — with a single provider there is no pro tier.

`checkUsage` becomes:

```ts
export async function checkUsage(db: D1Database, userId: string) {
  const user = await users.findById(db, userId)
  if (!user) throw new Error(`User record not found for id: ${userId}`)

  const limit = user.anonymous
    ? GUEST_TOTAL_MESSAGE_LIMIT
    : AUTH_TOTAL_MESSAGE_LIMIT

  if (user.message_count >= limit) {
    throw new UsageLimitError(
      user.anonymous
        ? "Guest limit reached. Create a free account to continue."
        : "You have reached your message limit."
    )
  }
  return { user, count: user.message_count, limit }
}
```

`incrementUsage` becomes one statement — and make it atomic, because the read-then-write in the current implementation can lose increments under concurrent requests:

```sql
UPDATE users
   SET message_count = message_count + 1,
       last_active_at = ?
 WHERE id = ?
```

### 5.3 Guest limits are cookie-bound — say so out loud

A lifetime guest cap keyed to a session cookie is trivially reset by clearing cookies or opening an incognito window. This is a real limitation of the decision, not a bug in the implementation.

If 10-per-guest needs to actually hold, add a second key. The cheapest meaningful one on Workers: hash `CF-Connecting-IP` + a server secret into a `guest_usage` table and take `min(cookie_count, ip_count)`.

```sql
CREATE TABLE guest_usage (
  ip_hash       TEXT PRIMARY KEY,
  message_count INTEGER NOT NULL DEFAULT 0,
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL
);
```

Store only the hash, never the raw IP, and note it in the privacy policy. Shared NATs (offices, universities, mobile carriers) will make several people share one 10-message budget — which is the trade-off, and the reason it is proposed as opt-in hardening rather than baked into Phase 5.

Registered users have no such hole: the disposable-domain block plus `email_canonical` already makes cheap re-registration hard.

### 5.4 Surfaces

- [app/api/rate-limits/route.ts](app/api/rate-limits/route.ts) + its `api.ts` — return `{ count, limit, remaining }`; drop `dailyProCount` and reset dates from the payload
- [app/api/chat/api.ts:61](app/api/chat/api.ts#L61) — `checkUsageByModel` → `checkUsage`
- Guest wall copy: [app/components/chat/dialog-auth.tsx](app/components/chat/dialog-auth.tsx), [app/components/chat-input/popover-content-auth.tsx](app/components/chat-input/popover-content-auth.tsx)
- i18n: every "daily limit" / "resets tomorrow" string across 30 locales is now **wrong**, not just stale. Find them and rewrite — a user told their quota resets tomorrow when it never resets is a support ticket.

### Phase 5 exit criteria

- Guest is blocked on message 11 with a signup prompt
- Registered user is blocked on message 501
- No `daily_` column is read or written anywhere
- No UI copy promises a reset

---

## Phase 6 — Storage → R2

Two call sites:

| File                                                                    | Bucket             |
| ----------------------------------------------------------------------- | ------------------ |
| [lib/file-handling.ts:73](lib/file-handling.ts#L73)                     | `chat-attachments` |
| [lib/image-providers/storage.ts:66](lib/image-providers/storage.ts#L66) | `generated-images` |

```bash
npx wrangler r2 bucket create anychat-attachments
npx wrangler r2 bucket create anychat-images
```

Both currently call `.getPublicUrl()`, which means objects are world-readable by URL today. Preserve that with a public R2 custom domain, or tighten to signed URLs — but decide deliberately, since "same behaviour" here means "still public".

Update [next.config.ts](next.config.ts) `images.remotePatterns`: replace the `*.supabase.co` entry with your R2 domain, or Next's image optimizer will refuse to load them.

Also drop the `supabase/` migrations directory and `supabase/seed/` once D1 is authoritative — leaving two schema sources invites drift.

---

## Phase 7 — Edge compatibility & Workers deploy

### 7.1 The two hard blockers

Only two files import Node builtins:

**[lib/encryption.ts](lib/encryption.ts)** — deleted in Phase 4. Nothing to do.

**[lib/csrf.ts](lib/csrf.ts)** — `createHash`, `randomBytes` from `crypto`. Port to WebCrypto:

- `randomBytes(n)` → `crypto.getRandomValues(new Uint8Array(n))`
- `createHash("sha256")` → `await crypto.subtle.digest("SHA-256", data)`

⚠️ **This is an API change, not a swap.** `crypto.subtle` is async, so `validateCsrfToken` becomes `async`. It is called synchronously at [middleware.ts:31](middleware.ts#L31):

```ts
if (!csrfCookie || !headerToken || !validateCsrfToken(headerToken)) {
```

A promise is always truthy, so **this check will silently pass for every request** if you make the function async and forget the `await`. Add the `await` and the surrounding `if` stays correct. Grep for all call sites before you change the signature.

### 7.2 Middleware

[middleware.ts:56](middleware.ts#L56) declares `runtime: "nodejs"`. Remove it — Workers middleware is edge. Then re-verify `updateSession` from `utils/supabase/middleware` is gone (Phase 3 replaces it with your own session read).

### 7.3 Build target

`next.config.ts` currently sets `output: "standalone"`, which is the Node-server target and wrong for Workers.

```bash
npm install --save-dev @opennextjs/cloudflare
```

- Remove `output: "standalone"`
- Add `open-next.config.ts`
- Build with `npx opennextjs-cloudflare build`, deploy with `npx opennextjs-cloudflare deploy`

### 7.4 `wrangler.jsonc`

```jsonc
{
  "name": "anychat",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-08-14",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "anychat",
      "database_id": "<from wrangler d1 create>",
    },
  ],
  "r2_buckets": [
    { "binding": "ATTACHMENTS", "bucket_name": "anychat-attachments" },
    { "binding": "IMAGES", "bucket_name": "anychat-images" },
  ],
  "ai": { "binding": "AI" },
  "triggers": { "crons": ["0 * * * *"] },
}
```

`nodejs_compat` covers most polyfill gaps but is not a licence to keep Node imports — it is a safety net for transitive dependencies, not for your own code.

### 7.5 Cron

`app/api/cron/EmailSchedulerCron` and `EmailDispatcherCron` are HTTP routes today, presumably driven by an external scheduler. On Workers, drive them from the `triggers.crons` above via a `scheduled()` handler that calls the same functions. Keep the logic in shared modules so both the route and the handler call one implementation.

### 7.6 Sweep for remaining incompatibilities

```bash
npx wrangler deploy --dry-run --outdir /tmp/wdry     # surfaces bundle errors before prod
```

Watch specifically for:

- **`serverExternalPackages: ["shiki", "vscode-oniguruma"]`** — `vscode-oniguruma` is WASM-backed and is the most likely thing to break the bundle. If it does, switch Shiki to its `web`/WASM-inlined build or move syntax highlighting client-side.
- **`@imgly/background-removal`** — heavy WASM. Confirm it is client-only; if it is imported from a route handler it will blow the bundle limit.
- **Bundle size** — **10 MB gzipped** on the paid plan. Check the dry-run output; the disposable-domain list (~130 KB) and Shiki's grammars are the two largest additions.
- **CPU time** — **30 s per request** on the paid plan. PBKDF2 at 100k iterations (~30 ms) is a rounding error against that; no tuning needed. Deep Research's long tool loops are the only thing that will approach this ceiling.
- Any `process.env` read at module scope in a route — on Workers, env arrives through the request context.

### 7.7 Secrets

```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put CSRF_SECRET
npx wrangler secret put SESSION_SECRET
```

Update `.env.example` — remove `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE`, `OPENAI_API_KEY`, `MISTRAL_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `PERPLEXITY_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_BASE_URL`; add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_GATEWAY`, `SESSION_SECRET`.

---

## Phase 8 — Verification

| #   | Check                                                                       | Pass                                                 |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | `grep -ril "stripe\|subscription\|premium" app lib components`              | no hits                                              |
| 2   | `grep -rl "@supabase/" app lib utils components`                            | no hits                                              |
| 3   | `grep -rn "from \"node:\|from \"crypto\"" app lib`                          | no hits                                              |
| 4   | Model dropdown                                                              | only `@cf/*`                                         |
| 5   | Guest message 11                                                            | blocked, signup prompt                               |
| 6   | Registered message 501                                                      | blocked                                              |
| 7   | `test@yopmail.com` register                                                 | 400 `DISPOSABLE_EMAIL`                               |
| 8   | `test@gmail.com` register                                                   | succeeds                                             |
| 9   | `Foo@Gmail.com` vs `foo@gmail.com`                                          | one account                                          |
| 10  | Google / magic-link entry points                                            | none in UI, none in routes                           |
| 11  | Deep Research as registered user                                            | runs, no 402                                         |
| 12  | `npx wrangler deploy --dry-run`                                             | clean                                                |
| 13  | CSRF on a POST                                                              | rejects a bad token _(verify the `await` — see 7.1)_ |
| 14  | Chat attachment upload → R2                                                 | round-trips                                          |
| 15  | `grep -ril "anychat\|zola" . --exclude-dir=node_modules --exclude-dir=.git` | nothing outside `docs/plans/`                        |
| 16  | `/privacy-policy` and `/cookie-policy`                                      | both 404, no link to either anywhere                 |
| 17  | Favicon, OG image, sidebar mark                                             | show OpenChat                                        |
| 18  | `npm run type-check`                                                        | ≤ baseline                                           |

### Tests worth writing

- `lib/auth/__tests__/disposableEmail.test.ts` — port NexCoach's, including the guard test asserting no mainstream provider is in the list
- `lib/auth/__tests__/password.test.ts` — hash/verify round-trip, wrong password fails, constant-time compare
- `lib/__tests__/usage.test.ts` — guest blocked at 10, user at 500, increment is atomic under concurrency
- `lib/db/__tests__/*.test.ts` — every repository refuses cross-user reads (the RLS replacement; this is the highest-value test suite in the plan)

---

## Risk register

| Risk                                                    | Severity     | Mitigation                                                                                                              |
| ------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| RLS removal opens cross-user data access                | **critical** | Repository seam + ownership tests (Phase 2/8). The 11 client components that query directly are where a miss will hide. |
| Async CSRF silently disables protection                 | **critical** | Explicit check #13; grep all call sites when changing the signature                                                     |
| `vscode-oniguruma` WASM breaks the bundle               | high         | Dry-run early — do not leave this to deploy day                                                                         |
| No privacy or cookie policy while collecting PII        | high         | Business decision, taken knowingly (§1B.5). Reinstating is a page, not a refactor.                                      |
| Partial `ZOLA_OFFICIAL` rename kills analytics silently | medium       | Rename in code, `.env.example` and `wrangler.jsonc` together, or not at all (§1B.3)                                     |
| Unverified emails let anyone register any address       | medium       | Accepted — no verification by decision. Disposable block + `email_canonical` are the only gates.                        |
| Model IDs guessed rather than verified                  | high         | `npx wrangler ai models` is the only source of truth                                                                    |
| Guest cap resets on cookie clear                        | medium       | Accepted; IP-hash hardening in 5.3 if it matters                                                                        |
| Tool calling unsupported on some CF models              | medium       | Test per model; set `tools` honestly in `ModelConfig`                                                                   |
| i18n drift across 30 locales                            | medium       | `en.ts` by hand, script the rest, type-check                                                                            |
| Timestamp format drift breaks ordering                  | low          | ISO-8601 everywhere, enforced at the repository boundary                                                                |

---

## Decisions locked

| Question                  | Answer                                                 |
| ------------------------- | ------------------------------------------------------ |
| Usage caps                | 10 lifetime guest, 500 lifetime registered             |
| Deep Research             | free for all registered users                          |
| Model access              | Cloudflare **AI Gateway**                              |
| Model catalog             | Cloudflare only; all other providers removed           |
| Data migration            | **none** — greenfield, D1 starts empty                 |
| Workers plan              | **paid** — 30 s CPU, 10 MB bundle                      |
| Email verification        | **none** — disposable block is the only gate           |
| Brand                     | **OpenChat** — confirmed, collision noted and accepted |
| Both brand layers         | AnyChat **and** Zola renamed                           |
| Privacy + cookie policies | **both removed**                                       |

## Open items

1. **Production domain.** `APP_DOMAIN` feeds ~15 email templates and the email-change flow. Phase 1B leaves a placeholder; the real value must be set in `wrangler.jsonc` vars before Phase 7 deploys.
2. **Brand assets.** Phase 1B renames the AnyChat SVGs and favicons so the build stays green. Actual OpenChat artwork — wordmark, icon mark, OG image, favicon set — is a design task with no owner in this plan.
3. **`ZOLA_OFFICIAL` → `OPENCHAT_OFFICIAL`?** (§1B.3) Functional env var gating analytics. Rename it everywhere or leave it; a partial rename silently kills analytics.
4. **Footer postal address.** `footer.address` still carries QUANTUM95 LLC's registered address (8206 Louisiana Blvd NE, Albuquerque, NM). The company name is gone but the address is not — replace it with OpenChat's own, or blank the string.
5. **Guest IP-hash hardening** (§5.3) — in or out? It stores a hashed IP, which is the kind of thing a privacy policy would normally disclose.
