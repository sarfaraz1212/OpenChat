# OpenChat ⇐ LobeHub Migration Plan

**Status:** Phases 0 through 8 and 11 through 13 are complete; Phase 14 (hardening & cutover) is the only one left (9 and 10 were removed). See [STATUS.md](./STATUS.md) for the live state and implementation notes.

## If you are an agent picking this up cold

Read in this order:

1. This file, in full — it's the map.
2. [decisions/](./decisions/) — every locked-in call from the grilling session that produced this plan. Do not re-litigate any of them; if one looks wrong, say so to the user, don't silently override it.
3. [research/](./research/) — three deep research passes (LobeHub's architecture, the current app's own custom features, and Cloudflare-feasibility of LobeHub's exotic subsystems). This took ~3 long agent runs and hundreds of thousands of tokens to produce. Don't re-derive it by re-exploring the repos — read it.
4. [STATUS.md](./STATUS.md) — what phase we're actually on, last commit, next concrete action. Update it after every completed unit of work, not just at phase boundaries.

## What this is

A full rebuild of the app at the repo root (currently a Next.js app, forked from the open-source "Zola" chat UI, already deployed to Cloudflare Workers) into a close replica of `lobehub/lobehub` (a large, commercial, open-core AI-agent-operations platform — **not** the smaller classic "LobeChat" most people picture), rebranded as **OpenChat**, running entirely on Cloudflare's stack: Workers, Hono, D1, R2, Vectorize, Workflows/Queues, and the Cloudflare Sandbox SDK. Cloudflare Workers AI is the only model provider — every model in the app is an open-weight model Cloudflare hosts, regardless of the display name/icon it wears.

The reference source is a full clone of `lobehub/lobehub` at `../new/lobehub` (sibling to this repo's parent — gitignored, read-only, never modified). Copy features and structure from it; ship them under OpenChat branding.

## What's explicitly excluded

See [decisions/0002-scope-full-platform-with-exclusions.md](./decisions/0002-scope-full-platform-with-exclusions.md) for the full reasoning. Short version — excluded:

- Community/discover marketplace page
- MCP support
- Pricing/billing (including the already-stubbed business/workspace-billing UI)
- Composio (paid third-party tool marketplace, MCP-adjacent) and Klavis (already dead code upstream)
- Device Gateway (pairs a cloud account to a real Electron/CLI install — meaningless once desktop/CLI apps are out of scope)
- iMessage bot (structurally requires a Mac + BlueBubbles + a desktop bridge app — cannot exist on a pure Workers stack)
- WeChat bot (its "integration" is an unofficial, gray-market personal-account automation protocol — real ban risk to a real person's account)
- Desktop (Electron) and CLI apps — web-only deployment
- Multi-tenant RBAC/workspaces — deferred; see [decisions/0008-multi-tenancy-deferred.md](./decisions/0008-multi-tenancy-deferred.md)
- **Messenger integrations** (Feishu, QQ, LINE, on top of the WeChat/iMessage exclusions above) — removed by the user on 2026-09-20; this was Phase 9
- **Sharing** (public share links, `apps/share`, and the Share buttons/modals/routes in the copied UI) — removed by the user on 2026-09-20; this was Phase 10. There are consequently no unauthenticated read routes for user content

Everything else in `lobehub/lobehub` is in scope, including the parts that make this much bigger than "a chat app": agent groups, task graphs, goal tracking, the memory system, knowledge-base/RAG, and the cloud sandbox (code execution for agents).

## Architecture call: Hono + SPA replaces Next.js entirely

The current app is Next.js (via `@opennextjs/cloudflare`). The plan drops Next.js and OpenNext completely and rebuilds as a single Cloudflare Worker: Hono owns every route (`/api/*`, webhooks, auth) and also serves a Vite-built React Router SPA via the Workers Assets binding — the same shape LobeHub itself already uses for `apps/auth` and `apps/share` (thin Workers backend + React Router SPA), and a more idiomatic fit for "rebuild with Hono.js on Cloudflare" than bolting Hono onto Next.js's route handlers. Full reasoning and what this means for each phase: [decisions/0003-architecture-hono-spa-replaces-nextjs.md](./decisions/0003-architecture-hono-spa-replaces-nextjs.md).

This was an architectural call made by the implementing agent, not a direct answer to a question put to the user during grilling — flagged here so it's easy to challenge if wrong.

## Reused, not rebuilt

The current app already solved several things LobeHub does differently — don't redo this work, port it as-is into the new Hono routes:

- **Auth**: custom D1-backed sessions (PBKDF2, WebCrypto CSRF, disposable-email blocking at signup/email-change). Replicate LobeHub's login/signup _UI_ on top of this existing backend — do not adopt Better Auth. See [decisions/0006-auth-keep-custom-d1-native.md](./decisions/0006-auth-keep-custom-d1-native.md).
- **AI provider wiring**: `lib/openproviders` (OpenAI-compatible REST client against Cloudflare Workers AI) plus `repair-stream.ts` (a hard-won fix for a real Workers-AI streaming bug on 4 of 15 models). Port unchanged into Hono handlers. Do **not** switch to the native `env.AI` binding. See [decisions/0005-ai-provider-keep-existing-wrapper.md](./decisions/0005-ai-provider-keep-existing-wrapper.md).
- **D1 + R2**: reuse the existing bindings/resources (`DB` → database `openchat`, `ATTACHMENTS`/`IMAGES` R2 buckets) — extend the schema, don't re-provision infrastructure.
- **Carry-forward features**: background removal (2 systems), image enhancer, Deep Research (+ PDF export), AI image-gen gallery, Customer.io email drips (18 templates), disposable-email blocking. None of these exist in LobeHub — they're this app's own, and they carry forward unchanged in spirit, just re-plumbed onto the new Hono backend. See [decisions/0009-carry-forward-features.md](./decisions/0009-carry-forward-features.md).

## Cloudflare service mapping

LobeHub's Postgres/Upstash-based infrastructure maps to Cloudflare services as follows (full detail: [decisions/0004-cloudflare-service-mapping.md](./decisions/0004-cloudflare-service-mapping.md)):

| LobeHub uses                                                             | OpenChat uses                                                                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Postgres + Drizzle (174 tables)                                          | D1 (SQLite) — same schema shape, jsonb→TEXT, arrays→JSON-text, no generated columns to worry about                           |
| pgvector (RAG embeddings + 11-column memory system)                      | Cloudflare Vectorize (two indexes: knowledge-base RAG, user-memory)                                                          |
| ParadeDB `pg_search` (BM25 full-text)                                    | D1 FTS5 virtual tables (verify exact semantics when this phase starts)                                                       |
| Upstash QStash (goal/task scheduler)                                     | Cloudflare Workflows + Queues                                                                                                |
| Upstash Workflow (memory extraction)                                     | Cloudflare Workflows                                                                                                         |
| LobeHub Market SDK / proprietary "OnlyBoxes" (cloud sandbox)             | Cloudflare Sandbox SDK (Container + Durable Object) — reimplementation, not a port; neither upstream option is self-hostable |
| S3-compatible client (`@aws-sdk/client-s3`)                              | Same client, pointed at R2's S3-compatible endpoint — no code changes needed                                                 |
| 2 separate Workers (main app, `apps/auth`; `apps/share` is out of scope) | 1 Worker — `apps/auth` was a stateless proxy shell with no independent backend logic                                         |

## Phases

Each phase lists Goal / Scope / Depends on / Acceptance. Work them in order — later phases assume earlier ones are done. Update [STATUS.md](./STATUS.md) when a phase starts and when it's accepted.

### Phase 0 — Planning & scaffolding (this phase)

- **Goal**: Reach and record a shared understanding of scope; snapshot the pre-migration app; stand up the docs system.
- **Done in this phase**: grilling session (all decisions in `decisions/`), `master` branch cut from pre-migration `main` and pushed to origin, this docs folder.
- **Acceptance**: this file, STATUS.md, all decisions/ and research/ files exist and are committed to `main`.

### Phase 1 — Foundation: Worker skeleton, auth port ✅ (implemented; see STATUS.md)

- **Goal**: A deployable (even if feature-empty) Hono Worker on Cloudflare with the existing auth system ported over.
- **Scope**: Hono app skeleton (routing, middleware, error handling); Vite + React Router SPA scaffold, served from the same Worker via the Assets binding; port `lib/auth/*`, `lib/csrf.ts` and the `users`/`sessions` repositories into Hono middleware/handlers, keeping behavior. **Schema:** Phase 1 reuses the existing D1 migrations (`0001`, `0002`) and adds none. The LobeHub-parity tables (agents, chat groups, goals/tasks, memory, connectors minus MCP/Composio) are added by the phase that uses them, each with its own migration and tests. When that happens: jsonb→TEXT, arrays→JSON-text, drop every `vector(...)` column (Vectorize handles those in Phases 5/6), skip the BM25 index migrations.
- **Depends on**: Phase 0.
- **Acceptance**: `pnpm dev` serves the SPA shell; register/login/logout/session work end-to-end against local D1; CSRF protection is verified, including the missing-`await` guard (see `decisions/0009-carry-forward-features.md`); `pnpm build` and `wrangler deploy --dry-run` succeed. A _real_ deploy is not part of Phase 1: the only environment wired up is production, so it needs the user's explicit go-ahead.
- **Test seam** (agreed with the user): the Worker's fetch interface, driven by real HTTP requests against a real local D1 inside workerd. Later phases test at the same seam unless the user agrees another.

### Phase 2 — Chat core ✅

- **Goal**: Working chat: create a chat, send a message, stream a response from Cloudflare Workers AI, persist it.
- **Scope**: Port `lib/openproviders` + `repair-stream.ts` into Hono handlers; chat/topic/message CRUD against D1 (existing `chats`/`messages` tables, extended as needed); SPA chat UI ported from LobeHub's `src/routes/(main)/agent/(chat)` and `src/store/chat/`, rebranded.
- **Depends on**: Phase 1.
- **Acceptance**: a logged-in user can create a chat, send a message, see a streamed response, reload and see history persisted.

### Phase 3 — Models & providers ✅

- **Goal**: Model/provider settings surface, locked to the Cloudflare Workers AI catalog.
- **Scope**: Port LobeHub's `src/features/Settings/provider/`, `service-model/`, `ModelSelect`, `ModelSwitchPanel` UI; back it with the existing Cloudflare model catalog (`lib/models/data/cloudflare.ts`) rather than LobeHub's ~90-provider registry.
- **Depends on**: Phase 2.
- **Acceptance**: user can browse/select models in the same UI shape as LobeHub, and switch models mid-chat.

### Phase 4 — Agents & agent groups ✅

- **Goal**: Agents as personas/assistants (LobeHub's core unit — chat lives nested under an agent), plus agent groups.
- **Scope**: Port `src/routes/(main)/agent/*` (profile, sidebar, settings, builder) and `agents` list; `chatGroups`/`chatGroupsAgents` tables and minimal UI.
- **Depends on**: Phase 2, Phase 3.
- **Acceptance**: user can create an agent with a system prompt/model config, chat with it, group agents.

### Phase 5 — Knowledge base / RAG ✅

- **Goal**: File-attached retrieval for agents.
- **Scope**: File upload → R2; embeddings via Workers AI; Cloudflare Vectorize index for document chunks; retrieval wired into the chat/agent pipeline.
- **Depends on**: Phase 4.
- **Acceptance**: attach a document to an agent, ask a question whose answer requires it, get a grounded response.

### Phase 6 — Memory system ✅

- **Goal**: Cross-session user memory (identity/persona/preference/experience/activity/context extraction).
- **Scope**: Port `packages/memory-user-memory` extraction logic (provider-agnostic, already Workers-AI-compatible) and `persona.ts` (pure relational); second Vectorize index (separate from Phase 5's) for the 11 embedded fields found in research; background extraction via Cloudflare Workflows replacing the hourly Upstash Workflow job.
- **Depends on**: Phase 5 (shares the embeddings/Vectorize plumbing).
- **Acceptance**: memory extracted from a conversation is retrievable and influences a later, unrelated conversation.

### Phase 7 — Goals & task graphs ✅

- **Goal**: Port the largest single subsystem (300+ files upstream): goals, the goal-node/edge DAG, tasks, and the planner/scheduler orchestration.
- **Scope**: 16-table data model (no pgvector/BM25 — straightforward D1 port); planner/coordinator loop with per-turn budgets and human-in-the-loop gates, background wake-up scheduling via Cloudflare Workflows + Queues (LobeHub's own code already has a swappable `local.ts` fallback for its QStash scheduler — start from that shape).
- **Depends on**: Phase 4.
- **Acceptance**: create a goal, decompose it into a task graph, watch at least one task execute end-to-end via the scheduler.

### Phase 8 — Cloud sandbox (code execution) ✅

- **Goal**: Agents can execute code, reimplemented on Cloudflare's own infrastructure.
- **Scope**: Cloudflare Sandbox SDK (Container + Durable Object) wired in place of LobeHub's Market-SDK/OnlyBoxes-backed implementation; port the `builtin-tool-cloud-sandbox` tool-facing interface against the new backend.
- **Depends on**: Phase 4 (needs agents/tool-calling to exist).
- **Acceptance**: an agent can request code execution and get real stdout/stderr back from an isolated container.

### Phase 9 — ~~Messenger integrations~~ (removed 2026-09-20)

Removed from scope by the user. Nothing to build. The copied UI and server code must not include the messenger/bot channel settings, `channel` agent route, or bot webhook routes. The per-platform analysis stays in `research/03` and `decisions/0007` in case this is ever revived. The phase number is kept so references to later phases stay valid.

### Phase 10 — ~~Sharing~~ (removed 2026-09-20)

Removed from scope by the user. Nothing to build. The copied UI and server code must not include the `share` routers or routes, Share buttons/modals, or the public read-only views (`apps/share`). Consequence: there are no unauthenticated read routes for user content. The phase number is kept so references to later phases stay valid.

### Phase 11 — Usage analytics ✅

- **Goal**: Display-only usage/cost stats — no billing, no enforcement.
- **Scope**: Port the query-the-messages-table approach (`usage`/`metadata.usage` jsonb column → D1 TEXT+JSON1) and the `src/features/Settings/stats/*` dashboard UI (overview, rankings, usage trends, heatmaps).
- **Depends on**: Phase 2.
- **Acceptance**: stats dashboard shows real token/message/model counts that match what's actually been sent.

### Phase 12 — Carry-forward features ✅

- **Goal**: Re-plumb this app's own pre-existing features (not in LobeHub) onto the new Hono backend.
- **Scope**: background removal (client-side WASM demo + BFL-API-backed real tool), image enhancer, Deep Research + PDF export, AI image-gen gallery, Customer.io email drips, disposable-email blocking (mostly a straight port — the logic already exists and works, see `research/02-current-anychat-inventory.md`).
- **Depends on**: Phase 1 (auth/D1), Phase 2 (for Deep Research's chat integration).
- **Acceptance**: each ported feature works identically to how it works in the pre-migration app today (compare against the `master` branch snapshot).

### Phase 13 — Branding ✅

- **Goal**: OpenChat identity throughout — no LobeHub name/logo/copy left user-facing.
- **Scope**: Apply OpenChat branding per the existing `docs/architecture-assessment.md` rebrand notes and LobeHub's own `DESIGN.md`/`DESIGN.dark.md` token structure (swap tokens, not the design system's mechanics); LICENSE/attribution file per the license decision.
- **Depends on**: all feature phases substantially done (branding a moving target is wasted work).
- **Acceptance**: no string "LobeHub"/"LobeChat" or upstream logo reachable from the running app.

### Phase 14 — Hardening & cutover

- **Goal**: Production-ready.
- **Scope**: Re-audit every `validateCsrfToken()` call site for a missing `await` (the guard tests in `csrf.test.ts` must still pass); wire the hourly cron as a real `scheduled()` handler together with its `triggers.crons` entry (the legacy declared the trigger with no handler, and Phase 1 removed the trigger from `wrangler.jsonc`), converting the legacy email scheduler/dispatcher HTTP routes to it rather than exposing them (the legacy exempted `/api/cron` from CSRF because it was server-to-server; nothing is exempt now, so any HTTP cron endpoint that survives needs its own shared-secret auth); full regression pass using the existing Playwright-based UI probe; run D1 migrations against the remote database; deploy.
- **Hardening backlog carried from Phase 1** (see STATUS.md for detail): equalise login timing for unknown emails (they skip PBKDF2 and answer faster); require the CSRF header token to equal the cookie (proper double-submit) and consider HMAC instead of `sha256(nonce + secret)`; add a Content-Security-Policy and other security headers for the SPA and API; delete or replace the leftover `.github/workflows/*`; decide whether to enforce Prettier (three carried-over files use semicolons and 4-space indents).
- **Depends on**: everything else.
- **Acceptance**: `wrangler deploy` to production; UI probe passes; a human walks the golden path (signup → chat → agent → share) with no errors.

## Known risks (carried from research, not yet mitigated)

- **License**: this is a full replica of a commercial open-core product under the LobeHub Community License. Decision recorded in `decisions/0001-license-and-legal-risk.md` — proceed, not sold/distributed commercially. Revisit if the deployment model ever changes (e.g., if this starts being offered to other people/organizations beyond the owning team).
- **CSRF bug risk**: `validateCsrfToken()` is async; a missing `await` at any call site silently passes every request. Must be explicitly audited in Phase 14, not assumed fixed by porting.
- **Cloudflare Containers is in beta**: the Sandbox SDK (Phase 8) sits on Containers, which has no SLA yet. Acceptable for now; note it as an operational risk once in production.
- **D1 FTS5 vs. BM25 parity**: not yet verified in detail — Phase 7/anywhere search-quality matters should confirm FTS5 gives acceptable results before assuming feature parity with ParadeDB's BM25.
