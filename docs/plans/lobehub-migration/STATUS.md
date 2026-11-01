# Migration Status

Update this file after every completed unit of work, not just at phase boundaries. If you're an agent stopping mid-task, update it before you stop.

---

**Current phase**: 12 (carry-forward: 12a image gallery, 12b background removal/enhancer, 12c Deep Research, 12d email drips) and 13 (branding) are complete. **Phase 14 (hardening & cutover) is the only one left** (Phases 9 and 10 were removed).
**Phase status**: phases 1 through 8 and 11 through 13 are merged into local `master` and pushed to `origin/master`; Phase 14 (hardening & cutover) is partly done — the CSRF, security-header, upload-cap and login-timing work is in, and what remains needs the user (a real deploy, remote D1, the sandbox container image). **`main` is untouched: it is still the live legacy app, and Cloudflare Workers Builds deploys it on every push.**
**Branch base**: local `master` @ `1f9b54f` (UI restyle, not yet pushed — see log). Previously pushed base was `7498970` (Phase 1 plus the handoff docs and repository skills).
**Frozen legacy snapshot**: commit `8e6c41c`; the latest legacy app remains on `main`.

## Branch rules (this corrects ADR 0010)

`decisions/0010-branch-strategy.md` originally said all migration work lands on `main`. That was wrong:

- The user's first message said _"do code in master branch so main code has old project"_, i.e. the new code goes on `master` and `main` keeps the old project. The earlier plan inverted that.
- `main` is the deployed production branch: Cloudflare Workers Builds redeploys on every push to it (`DEPLOY.md`, legacy version). Pushing migration work there would replace the live app.

So: **do not push migration work to `main` before the Phase 14 cutover.** The new build lives on `migration/*` branches, which can fast-forward into `master` (`git checkout master && git merge --ff-only migration/phase-1-foundation`, local only; pushing is the user's call). ADR 0010 has been amended to match.

## What Phase 1 delivered

- **Worker**: Hono app in `src/worker/` (`index.ts` entry, `app.ts` composition), routes `/api/health`, `/api/csrf`, `/api/auth/{register,login,logout,session}` and, during Phase 1 only, `/api/create-guest`. JSON 404 and 500 handlers.
- **CSRF**: `middleware/csrf.ts` guards POST/PUT/DELETE/PATCH on all `/api/*`; `lib/csrf.ts` is the WebCrypto implementation with the secret injected from `env.CSRF_SECRET` (missing secret fails closed).
- **Auth**: register (email normalisation, shape check, password length, disposable-email blocking, duplicate detection), login, logout (server-side session destroy), session lookup with query-enforced expiry (30 days), and the guest route later removed by the accepted Phase 2 default. Ported from the legacy `lib/auth/*`, `lib/db/{users,sessions}.ts`, keeping behavior; git history follows the files (`git log --follow`).
- **Frontend**: Vite + React Router SPA shell in `src/web/` (health-check page + 404 route), served by the Worker's static assets. `wrangler.jsonc`: SPA fallback, `run_worker_first: ["/api/*"]`.
- **D1**: reuses migrations `0001` and `0002`. Nothing new added (see deviations).
- **Tooling**: TypeScript 6.0 (typescript-eslint doesn't support 7 yet), ESLint 10, Vitest 4 running inside workerd via `@cloudflare/vitest-pool-workers`, three `tsc` projects (worker, web, config), Husky hooks kept (`pre-commit` = lint-staged, `pre-push` runs the `build` script through npm). `pnpm lint` lints explicit paths (`src`, `scripts`, configs) because `eslint .` stalls on the 1.2 GB `new/` clone and the Playwright probe profiles.
- **Tests**: 67 passing. New behavior is covered only through the Worker's fetch interface (the seam agreed with the user, via `test/client.ts`); the existing password and disposable-email unit tests moved over unchanged. Mutation checks confirmed the guards are not vacuous: the CSRF missing-`await` test, malformed-token rejection, route-ordering (every mutating route refuses a tokenless POST), PATCH, the Secure-cookie policy, and the register/login guards.
- **Verified beyond tests**: `vite build`; `wrangler deploy --dry-run` (199 KiB / 69 KiB gzip, `env.DB` bound, nothing uploaded); a real `vite` dev server plus `vite preview` exercised with curl (register → session → logout → login, CSRF 403, disposable-email 400, SPA fallback, JSON 404 for unknown `/api/*`).

## Phase 2 progress

- **First vertical slice (green):** a signed-in user creates a topic through tRPC, sends a message to the streaming chat endpoint, receives a reply through the Cloudflare OpenAI-compatible wrapper, and reloads both persisted turns. The fetch-seam test injects a fake only at the outbound Workers AI request boundary; it never calls the network or queries D1 directly.
- **Schema:** migration `0003` applies the accepted clean cut: legacy chat/project/preferences tables are dropped without data migration, auth `sessions` becomes `auth_sessions`, and the LobeHub-aligned `topics`/`messages` tables are introduced. `research_sessions` is retained for Phase 12 with its relation renamed to `topic_id`.
- **API surface:** authenticated topic/message CRUD is mounted through tRPC; model responses use a separate text-stream endpoint. Ownership checks apply at both boundaries, all mutations remain behind CSRF, guest creation is gone, and the Workers AI wrapper retains the legacy malformed-content repair.
- **SPA:** the health placeholder is replaced by a responsive, OpenChat-branded login/register and chat experience with topic history, a pinned streaming composer, honest “Llama 3.3 70B · Cloudflare” naming, and a fresh restrictive CSP. The browser consumes the tRPC router's inferred types directly.
- **Verification:** all 74 tests pass, including six chat-core fetch-seam tests; all three TypeScript projects, lint, the production build, and `git diff --check` pass. Migration `0003` was also exercised from the old schema with a seeded Deep Research row, confirming the row survives with only its obsolete chat relation cleared.
- **UI smoke:** `probe-login.mjs` registered a real local account, then `ui-probe.mjs` ran at an iPhone 13 viewport against local D1 and a loopback Workers AI fake. It created a topic, observed the incremental response, reloaded `/chat/:topicId`, and confirmed both turns persisted. No external service was called.
- **Review fixes:** `$code-review` ran Standards and Spec reviewers against `master...HEAD`. The fixes restore the Cloudflare-only destination guard, remove the arbitrary AI base-URL override, carry forward the shared catalog (15 open-weight chat models, Whisper, and the reserved FLUX/Leonardo image entries) with server allowlisting, make UI smoke failures fatal and role/content-aware, clarify Topic versus user-facing chat terminology, rename the current-user state, and split auth/orchestration/sidebar/transcript/composer responsibilities. A post-refactor mobile inspection restored both persisted turns with a pinned composer and no document scroll.

## Phase 3 progress

Decision record: `decisions/0012-phase-3-models-providers.md`.

- **API (fetch-seam tests, 12 new):** tRPC `aiProvider.{list,toggle}`, `aiModel.{list,toggle,batchToggle}`, `aiInfra.runtimeState`; `topic.update` accepts `model`; a chat turn records its model on the topic. Migration `0004` adds per-user override tables `ai_providers` / `ai_models`.
- **Catalog:** `src/shared/models.ts` gained `PROVIDERS`, per-model `abilities` and `contextWindowTokens`. Only facts observed in the legacy 2026-09-12 probe are recorded (5 of 15 models); the rest are empty on purpose. **Pending real verification:** re-run `scripts/probe-tools.mjs` with credentials.
- **SPA:** restructured to a layout route (`AppShell`) with `SessionProvider` and `TopicsProvider`; new `ModelSwitchPanel` in the chat header and a Settings → Model provider page (`/settings/provider/:providerId`) with provider switch, model search, per-model and bulk toggles, capability tags. "New chat" navigates home instead of persisting an empty topic.
- **Server refactor:** `trpc/router.ts` split into `trpc/init.ts` plus `trpc/routers/*`; shared test helpers moved to `src/worker/test/helpers.ts`.

## Phase 4 progress

Decision record: `decisions/0013-phase-4-agents-and-groups.md`.

- **API (fetch-seam tests, 20 new):** tRPC `agent.{list,inbox,get,create,update,remove}` and `agentGroup.{list,get,create,update,remove,addAgents,removeAgent}`; `topic.create` takes `agentId` (default agent otherwise) and `topic.list` filters by it. A chat turn now uses the agent's system prompt, model, sampling parameters and history window; `model` is optional in the request body.
- **Schema:** migration `0005` (`agents`, `chat_groups`, `chat_groups_agents`, `topics.agent_id`, per-user default "Just Chat" agent, backfill of Phase 2 topics). The backfill was verified on a scratch SQLite database, not by the seam tests.
- **SPA:** sidebar gains Agents and Groups sections; routes `/agent/:agentId` (chat), `/agent/:agentId/profile` (editor: persona, model, temperature/top-p/max tokens, history window, opening message/questions, pin), `/group/:groupId` (rename, members, delete). The topics context became `workspace.tsx` (topics + agents + groups).
- **Not built (flagged):** multi-agent conversation inside a group. Groups are membership containers, which is what the phase's scope and acceptance line ask for.

## Phase 5 progress

Decision record: `decisions/0014-phase-5-knowledge-base.md`.

- **API (fetch-seam tests, 17 new):** `POST /api/files` (multipart, CSRF-guarded) and `GET /api/files/:id/content`; tRPC `file.{list,get,remove}`, `knowledgeBase.{list,get,create,update,remove,addFiles,removeFile}`, `agent.{getKnowledge,setKnowledge}`. A chat turn retrieves the top excerpts of the agent's attached documents and grounds the answer, recording sources in `metadata.retrieval`.
- **Schema / bindings:** migration `0006` (`files`, `chunks`, `knowledge_bases`, `knowledge_base_files`, `agents_knowledge_bases`, `agents_files`); `wrangler.jsonc` gains the `FILES` R2 bucket and `KB_VECTORS` Vectorize bindings (new names, not the legacy ones).
- **Pipeline:** `lib/rag/{chunk,extract,embed,vectors,knowledge,retrieve}.ts`; `bge-m3` embeddings through the existing guarded Workers AI wrapper; text files up to 1 MB, indexed inline.
- **SPA:** `/knowledge` (drag-and-drop upload, per-file status, download, delete, knowledge bases with a file picker), a Knowledge section on the agent profile (tick files and bases), and "Sources" under grounded replies.
- **Tests at the boundary:** an in-memory Vectorize and a Workers AI fake (`src/worker/test/fakes.ts`); D1 and R2 are real. Four mutation checks confirmed the retrieval tests can fail (search failure, no-embedding-when-empty, ranking order, ready-only).
- **Pending real verification (needs the user):** create the R2 bucket, the Vectorize index and its `file_id` metadata index (see `DEPLOY.md`), then a real `bge-m3` embedding, query and `$in` filter. Also still open from Phase 3: re-run `scripts/probe-tools.mjs` for model capabilities.
- **Not built (flagged):** PDF/DOCX parsing and asynchronous (Queue/Workflow) indexing for large files.
- **Browser smoke (production build):** a scripted Chromium run over `vite build` + `vite preview` passed 18/18 steps: register, model switcher (15 models, switch), provider settings (toggle persists, disabled model leaves the switcher), agent create/edit/chat (503 path shown, no AI credentials locally), group create/rename/add member, Knowledge upload (fails visibly: no credentials or index locally), download, knowledge-base attach persists, two-step delete; then iPhone 13: no horizontal overflow on six pages and the drawer lists agents, groups and Knowledge. It found and fixed: a knowledge-base checkbox that only updated after the round trip, and a cramped mobile file row. (**Fixed since:** dev used to render unstyled because the Phase 2 CSP's `style-src 'self'` blocks the `<style>` tags Vite injects; `vite.config.ts` now relaxes that one directive for the dev server only, and the built `index.html` keeps the strict policy. `pnpm dev` and `vite preview` are both fine for UI checks.)

## Phase 6 progress

Decision record: `decisions/0015-phase-6-memory.md`.

- **API (fetch-seam tests, 12 new):** tRPC `memory.{list,persona,update,remove,clear,settings,setEnabled}`. After each reply the chat route starts `MemoryExtractionWorkflow`; a turn's system prompt gains the persona plus the top 5 relevant memories, and the reply records them in `metadata.memories`.
- **Schema / bindings:** migration `0007` (`user_memories`, `user_persona`, `user_memory_settings`, `topic_memory_state`); `MEMORY_VECTORS` Vectorize binding and the `MEMORY_WORKFLOW` Workflows binding in `wrangler.jsonc`; the class is exported from `src/worker/index.ts`.
- **Pipeline:** `lib/memory/*` (gatekeeper, five layer extractors, persona, JSON-with-retry helper, vectors, retrieval, management). Layers share one table (decision 0015).
- **SPA:** `/memory` page (on/off switch, persona, memories by layer with edit and delete, forget everything), sidebar link, "Remembered: …" under replies that used memory.
- **Tests:** a scripted Workers AI fake, a second fake Vectorize and a fake Workflows engine (`test/fakes.ts`); mutation checks confirmed the idempotence, opt-out, gatekeeper and vector-cleanup tests can fail (the two opt-out checks are deliberately redundant, so only removing both is caught).
- **Judgement call to review:** memory is ON by default (as in LobeHub), which means extra model calls per reply. See the ADR.
- **Pending real verification:** create the `openchat-v2-memory` index (`DEPLOY.md`); confirm real models return parseable JSON for the prompts; confirm real Workflows retries.

## Phase 7 progress

Decision record: `decisions/0016-phase-7-goals-and-tasks.md`.

- **API (fetch-seam tests, 18 new):** tRPC `goal.{list,get,create,start,pause,resume,stop,resolveDecision,remove}`. A goal is planned round by round by a manager, its task graph runs in dependency order (independent tasks in parallel), an independent reviewer verifies it, and failures or questions pause it at human gates.
- **Schema / bindings:** migration `0008` (goals, tasks, goal_nodes, goal_edges, goal_node_decisions, goal_events); `GOAL_WORKFLOW` Workflows binding (`GoalRunWorkflow`, exported from `src/worker/index.ts`). `topic.list` now hides goal-task workspaces (`metadata.taskId`).
- **Engine:** `lib/goals/*` (prompts, planner with pre-write plan validation, executor, tick loop with a run lease, goal management and gates, scheduler) and `workflows/goal-run.ts`.
- **SPA:** `/goals` (list and create) and `/goal/:id` (controls, task graph by dependency depth, gate cards, task results, history; polls while running), sidebar link.
- **Mutation checks:** dependency order, task retry limit, round budget, plan validation and the run lease each make a test fail when removed.
- **Not built (flagged):** upstream's supervisor/recovery/exploration layers, work versions, traces and cost budget; see the ADR.
- **Pending real verification:** that real Workers AI models return usable manager/reviewer JSON and useful task results; the real Workflows engine's durability and retries.

## Phase 8 progress

Decision record: `decisions/0017-phase-8-cloud-sandbox.md`.

- **Tool calling in chat (fetch-seam tests, 10 new):** agents can opt in (`chatConfig.sandbox`) to six sandbox tools (`runCommand`, `executeCode`, `writeFile`, `readFile`, `editFile`, `listFiles`), offered only to models whose catalog `functionCall` ability was probed true. One sandbox per topic; a turn runs up to 8 model calls; tool runs are kept in the reply's `metadata.tools`. Goal task executors get the same tools.
- **Backend:** a small `SandboxSession` interface (`lib/sandbox/backend.ts`) with a `@cloudflare/sandbox` 0.12.9 adapter behind an optional `SANDBOX` binding, and a test-only `SANDBOX_BACKEND` override.
- **Not in `wrangler.jsonc` on purpose:** the `containers` block (it needs Docker to build). The snippet, migration and `sandbox/Dockerfile` are in `DEPLOY.md` for cutover. `wrangler deploy --dry-run` was checked without it.
- **SPA:** an opt-in switch on the agent profile (warns when the model cannot call tools) and a collapsible "Ran N tools" record under replies.
- **Tests:** seven guards mutation-checked (path confinement, opt-in, probed-model gate, timeout clamp, output truncation, in-order tool execution, tool errors as results). Serialising tool calls came out of a failing test: calls in one step otherwise run concurrently and race.
- **Pending real verification (Docker was not running):** build the image and run the adapter against a real container; confirm Python 3 and Node in the image; a real tool-calling model end to end.
- **Not built (flagged):** background commands, search/glob/grep/move/export, credential injection and uploaded-file sync; live streaming of tool activity (it appears after the reply).

## Phase 11 progress

Decision record: `decisions/0018-phase-11-usage-analytics.md`.

- **API (fetch-seam tests, 10 new):** tRPC `usage.{overview,byModel,byAgent,byTopic,daily}`, each taking a range (`7d`, `30d`, `90d`, `1y`, `all`) and the browser's UTC offset. Computed from the user's own messages at query time; no stats table. Migration `0009` adds the `messages(user_id, created_at)` index the range queries use.
- **Two fixes to earlier phases, found by the tests:** a chat turn that used tools stored only its last step's token usage (now the whole turn's), and goal task replies stored none (now they do).
- **SPA:** `/usage` with a range switch, overview cards, a per-day chart (messages or tokens), an activity heatmap, and model, agent and conversation rankings; sidebar link. The page states what is not counted.
- **Tests:** mutation checks confirmed the guards are not vacuous (whole-turn usage, goal task usage, range cutoff, timezone bucketing, per-user filter, ranking order, empty-day fill, goal workspaces left out of the conversation ranking).
- **Not built (flagged):** cost and spend (no pricing data; pricing is out of scope) and the Share button (sharing was removed). Calls that leave no message (memory extraction, goal planning and review) are not counted.
- **Pending real verification:** that real Workers AI sends usage on a streamed reply; the page with real data in a browser (not smoke-tested yet, see the Phase 14 list).

## Phase 12 progress

Carry-forward features, ported in slices. Reference: legacy `main` (`git show main:<path>`), decision `0009`.

- **12a AI image gallery (done, fetch-seam tests, 12 new):** tRPC `image.{list,generate,remove}`; `GET /api/files/images/:userId/:file` serves a stored image to its owner only (the legacy URL scheme, so legacy rows keep working). Workers AI image models (FLUX.2 dev/klein, FLUX.1 schnell, Lucid Origin, Phoenix) each called in their own wire format; prompt length and content-policy checks; 50 images per hour; one retry after a transient failure but never after a 4xx (the legacy code retried everything, contrary to its own comment). `IMAGES` R2 binding (new bucket name, see `DEPLOY.md`). SPA `/images` page (generate, gallery, download, delete) and sidebar link.
- **Changes from legacy:** images are served only to their owner (legacy URLs were world-readable); deleting an image also deletes its R2 object (legacy left it behind); a failed database write no longer leaves an unreachable file; results are checked to be real images by their bytes; DOMPurify is replaced by a control-character and whitespace tidy (a prompt is plain text, and DOMPurify needs a DOM).
- **Not built (flagged):** image turns inside chat threads (`chatId` / the `/images/:sessionId` replay pages); they need chat UI that renders images, which the topic/message model does not have yet.

- **12b Background removal and image enhancer (done, fetch-seam tests, 12 new):** `POST /api/image-tools/background-removal` and `/enhance` (multipart; the enhancer takes `scale` 2 or 4). Black Forest Labs' FLUX edit API is called as in the legacy app (three models tried in order, submit, poll, download); results go to the same `IMAGES` bucket and `generated_images` gallery. SPA: `/background-removal` and `/image-enhancer` pages (upload, before/after with a transparency checkerboard, download), and a tab bar shared with `/images`.
- **Changes from legacy:** sign-in is required (guest mode is gone and BFL is paid; the legacy let guests call it freely); a new cap of 20 edits per user per hour (the legacy had none); the API key is only sent to `*.bfl.ai` (the polling URL comes from the response, so it is checked); the uploaded bytes must really be an image, not just carry an image content type; one overall 100 s budget instead of 110 s per model; the recorded model is the one that actually ran (legacy always wrote "flux2-pro").
- **Not built (flagged):** the client-side WASM cutout (`@imgly/background-removal`), which only fed demo images on the legacy landing page (there is no landing page in the SPA; it would also need a CSP allowance for model downloads); the marketing layout of the legacy `/background-removal` page; image turns in chat threads.
- **Pending real verification:** a real `BFL_API_KEY` (endpoint names, the polling URL host and result URL shape were taken from the legacy code and not re-checked against BFL's current API).

- **12c Deep Research + PDF export (done, fetch-seam tests, 14 new):** tRPC `research.{list,get,start,remove}`. A run is a Cloudflare Workflow (`RESEARCH_WORKFLOW`, class `ResearchRunWorkflow`) rather than the legacy long streamed request, so it survives the page closing; the page polls `research.get`, which now includes an activity log (searches made, sources read) written as the run goes (migration `0010` adds `research_sessions.activity`). Same tools and prompt as legacy (`webSearch`, `readSource`, at most 4 of each per run); Tavily, then Perplexity, then Serper by whichever key is set. SPA: `/deep-research` (start, history) and `/deep-research/:id` (progress, markdown report, sources, PDF download; loaded on demand). The PDF is built client-side by a small dependency-free writer (`src/web/pdf.ts`), verified by opening the output in PyMuPDF (text, wrapping, page numbers), not covered by a test.
- **Changes from legacy:** a run is capped at 10 per user per hour (the legacy had none); `readSource` refuses non-http(s), local, private and metadata addresses and URLs with credentials (the model chooses the URL), reads at most 1.5 MB, and decodes `&amp;` last (the legacy double-decoded); a run that never finishes is reported failed after 30 minutes instead of running forever; only the sources actually read are listed; the report is no longer stored as chat messages (the legacy stored a chat per run), so it is not in the chat list.
- **Dependencies added:** `react-markdown` and `remark-gfm` (no raw HTML is rendered). No PDF library: the legacy used `jspdf`.
- **Not built (flagged):** Deep Research is not available from a chat thread's input bar; token usage of a run is not counted on the Usage page (it leaves no message); live streaming of the report as it is written (the page shows progress, then the finished report).
- **Pending real verification:** a real search key (Tavily's current auth header is `Authorization: Bearer`; the legacy sent the key in the body), and that a real `gpt-oss` model drives the loop and writes a report within the budget.

- **12d Email drips and account email (done, fetch-seam tests, 17 new):** the 6-email onboarding drip and the 12-step re-engagement ("relance") drip, queued into `email_jobs` and sent through Customer.io's transactional send API (called directly; the legacy used the `customerio-node` SDK). All 20 legacy transactional message ids and their link variables are carried over unchanged in `lib/email/templates.ts`. tRPC `account.{get,changeEmail,setEmailUpdates}`; `POST /api/cron/emails` runs one pass, guarded by a `CRON_SECRET` bearer token and exempt from CSRF (it is server-to-server; the exemption is an exact method-and-path match). Chatting now updates `last_active_at`, which is what the re-engagement drip measures. SPA: `/settings/account` (change email, product-email switch) and a sidebar link.
- **`scheduled()` handler:** `src/worker/index.ts` now exports one, so the legacy's trigger-without-a-handler gap is closed in code. The `triggers.crons` entry that drives it is still Phase 14's (see `DEPLOY.md`).
- **Changes from legacy:** a failed send is retried on the next run and given up on after 3 attempts (migration `0011` adds `email_jobs.attempts`; the legacy failed a job permanently on the first error, which stalled that user's whole drip); the onboarding drip only starts for sign-ups within the last 7 days, so enabling email later does not fire a burst at everyone; `opted_in_for_email_updates` is honoured both when queueing and when sending, so opting out after an email is queued still stops it; the day-2 email lands a day after day 1 rather than an hour later (the legacy compared a 1-based day number against a 0-based counter); counters only ever move forward.
- **Not built (flagged):** the legacy `WelcomeEmail` (id 42), which was sent from an unauthenticated `POST /api/emails` that any caller could trigger for any address — the onboarding day-1 email already covers the welcome, so it was dropped rather than ported.
- **Mutation checks:** 19 of 20 guards fail a test when removed (cadence, opt-out at both points, idempotent queueing, retry then give up, counter advance, cron secret and its `Bearer` scheme, activity tracking, newest-conversation link, and each email-change rejection). The one exception is the "quiet for at least an hour" filter, which only narrows the candidate scan: the step ladder already starts at 1 hour, so removing it changes nothing.
- **Pending real verification:** a real `CUSTOMERIO_API_KEY` (the send endpoint, auth header and `message_data` shape were taken from the SDK's behaviour and not re-checked against Customer.io's current API), and that the 20 transactional message ids still exist in the account.

## Phase 13 progress (branding)

- **Acceptance met, with almost nothing to do:** this build was written from scratch against the reference rather than copied from it, so no upstream name, logo or copy was ever user-facing. Audited: the client bundle, `index.html`, `public/` and every SPA string contain no "LobeHub"/"LobeChat", and no upstream logo asset exists. The app's own identity (title, favicon, theme colour, wordmark) was already OpenChat's, and no stale "AnyChat" naming survives from the earlier rebrand.
- **Six mentions remain in server-side source comments** (`shared/models.ts`, `memory/layers.ts`, `memory/prompts.ts`, `sandbox/tools.ts`, `workflows/memory-extraction.ts`), which esbuild carries into the Worker bundle. They are provenance notes for maintainers, not user-facing copy, and the Worker script is not served to browsers; keeping them is deliberate, and `ATTRIBUTION.md` says so.
- **`ATTRIBUTION.md` added** (decision 0001's "LICENSE/attribution file"): what is reimplemented from `lobehub/lobehub` and under which licence, the fact that no upstream source file is included, the condition that would require revisiting decision 0001, the Workers AI model-name trademark note, the optional third-party services, and the CC0 disposable-domain blocklist. Linked from the README.
- **Flagged for the user, not changed:** `LICENSE` is the plain Apache 2.0 carried over from this app's own history and does not reflect the LobeHub Community License obligations. Choosing this repository's licence is the owner's call, so the migration records the gap rather than editing the file.
- **Fixed while auditing:** both logo slots (auth screen, sidebar) pointed at the wide wordmark (2134x485, filled `#272830`) inside a small square box, so the mark was an invisible smear on the dark background; they now use the square white mark that already existed. The dev server's unstyled rendering was fixed at the same time (see the Phase 5 note).
- **Cutover cleanup (not done here):** `public/images/demo` (4.5 MB, six PNGs) fed the legacy landing page's client-side background-removal demo, which Phase 12b deliberately did not port; `public/button/github.svg` and `public/banner_*.jpg` are likewise unreferenced. They are still shipped as static assets. Delete them at cutover unless a landing page is planned.

## Deviations from the Phase 1 text in `MIGRATION_PLAN.md`

1. **No new feature tables yet.** The plan said Phase 1 would add the LobeHub-parity tables (agents, groups, goals, memory...). Translating dozens of tables that no code uses would be untested guesswork, so each phase now adds its own migration together with the code and tests that use it. The plan text has been updated.
2. **Legacy code is not parked in a `legacy/` folder.** The Next.js app, its `lib/`, `components/`, `supabase/`, Docker files were removed from this branch. Read them from git (`git show main:lib/db/chats.ts`) or `git worktree add ../openchat-legacy master`.
3. **Worker name is `openchat-v2` and the D1 `database_id` is a placeholder**, on purpose (see `DEPLOY.md`). The real id is in `main:wrangler.jsonc`; restore it and rename the Worker at cutover.
4. **No real deploy.** The acceptance line "`wrangler deploy` succeeds to a real Workers environment" was satisfied with `--dry-run` only, because the only environment wired up is production. A real staging deploy needs the user's go-ahead and credentials.
5. **Small deliberate behavior changes from the legacy auth**: `PATCH` is also CSRF-guarded; the 403 body is JSON (`{ error, code }`) rather than plain text; cookies are `Secure` on every non-local host (legacy: `NODE_ENV === "production"` for the session cookie, unconditionally for `csrf_token`), decided by host rather than request scheme so `http://localhost` works without weakening production; `csrf_token` now says `SameSite=Lax` explicitly (the browser default, so no change in effect); every `/api/*` response sends `Cache-Control: no-store`; malformed JSON returns 400 `INVALID_JSON` instead of 500; `/api/health` drops `uptime` (meaningless on Workers).
6. **Not ported yet** (belongs to later phases): `account/*` (email change, delete), `user-profile`, `user-preferences`, the locale-prefixed landing rewrite, and the legacy Content-Security-Policy header. The legacy CSP allowed analytics origins and `vercel.live` that no longer apply; a fresh CSP arrives with the SPA (Phase 2). API responses currently get no CSP or other security headers.
7. **Repositories trimmed to what Phase 1 exercises.** The plan said "`lib/db/*`"; only `users` and `sessions` are ported, and only the functions the auth routes use. Dropped, to return with the phase that needs them (`git show main:lib/db/users.ts`, `main:lib/db/sessions.ts`): users `canonicalExists`, `incrementMessageCount`, `updateProfile`, `softDelete`, `setEmail`, `setEmailCounterByEmail`, `listForOnboardingDrip`, `listInactiveSince`; sessions `destroyAllForUser`, `purgeExpired` (needed by the Phase 14 cron). `chats`, `messages`, `projects` and `misc` come with Phase 2 onward.
8. **`wrangler.jsonc` is smaller than the legacy one**, deliberately. Dropped and to be re-added by the phase that uses them: R2 buckets `ATTACHMENTS`/`IMAGES` (Phases 5 and 12), `triggers.crons` (Phase 14, together with a real `scheduled()` handler; the legacy declared the trigger with no handler), `vars` (`CLOUDFLARE_ACCOUNT_ID`, `NEXT_PUBLIC_SITE_URL`, ... as later phases need them), `compatibility_flags: ["nodejs_compat"]` (add it when a dependency needs it), and `assets.binding` (`ASSETS`; the Worker never fetches assets itself, because non-API paths go straight to the platform; add it if a phase ever needs to inject per-page HTML). The legacy values are in `main:wrangler.jsonc`.
9. **Legacy tests deleted with their code.** The legacy CSRF unit test is replaced by seam-level equivalents (valid token, tampered token, and the malformed cases `""`, `"nocolon"`, `":"`, `"a:"`). Tests for code that hasn't been ported yet were deleted with it and must come back with their phases: `code-language`, `db/hydrate-parts`, `email/relance-steps`, `openproviders/repair-stream` (`git show main:<path>`).
10. **Process files rewritten in the same commit as the implementation**: `AGENTS.md`, ADR 0010 (the branch correction above), the Phase 1 text in `MIGRATION_PLAN.md`, `README.md`, `DEPLOY.md`. The Phase 1 plan text changed on the user's behalf and has not been explicitly reviewed by them. `scripts/ui-probe.mjs` got a one-word lint fix (`let cls = ""` to `let cls`; behavior-neutral).

## Hardening backlog for Phase 14 (found while porting, deliberately not fixed here)

- **Upload body cap:** `POST /api/files` rejects an oversized `Content-Length` early, but a chunked upload with no `Content-Length` is buffered by `formData()` up to the platform limit before the 1 MB check. Signed-in users only; read the body through a byte-capped stream.
- **Retrieval quality:** each turn embeds only the latest user message (no query rewrite, no score threshold, top 4). Tune against real `bge-m3` scores once the index exists.
- **LobeHub `service-model` settings** (choosing the auxiliary model for topic naming and similar) are not built; a topic whose first reply fails keeps the title "New topic".
- **Browser smoke still owed** for the pages added after Phase 5: Memory, Goals and goal detail, the agent sandbox switch and tool record, and Usage (with real data, at desktop and phone widths). Only the fetch-seam tests cover them so far. Run against `vite build` + `vite preview`, with local D1 migrated through `0009` (`pnpm db:migrate:local`; only 0004 to 0006 were applied locally when this was written).

- Login is not timing-equalised: an unknown email skips PBKDF2 and answers measurably faster than a wrong password (the legacy comment claimed otherwise; the comment is now accurate).
- CSRF check verifies the header token's signature and that a cookie exists, but does not require header == cookie (classic double-submit). Custom headers already block cross-site forms, so the risk is low; tighten anyway.
- CSRF tokens use `sha256(raw + secret)` rather than HMAC.
- `.github/workflows/*` are leftover GitHub Actions in a GitLab repo (they reference `npm`/`.next`/Docker). Delete or replace with GitLab CI.
- The legacy hourly cron had no `scheduled()` handler; Phase 1 removed the (handler-less) trigger from `wrangler.jsonc`. Phase 14 adds trigger and handler together.
- The legacy exempted `/api/cron` from CSRF because it was server-to-server. Nothing is exempt now; convert those routes to `scheduled()` instead of exposing them over HTTP, or give any that remain their own shared-secret auth.
- **`frame-ancestors` is not in force.** The CSP is delivered as a `<meta>` element, and browsers ignore `frame-ancestors` there (the dev console says so on every load), so nothing currently stops the app being framed. It needs to be an HTTP response header; fold this into the Phase 14 security-headers work.
- Prettier isn't enforced (not in lint or lint-staged). Three carried-over files (`emailIdentity.ts`, `disposableEmail.ts`, `disposableOverrides.ts`) use semicolons, single quotes and 4-space indents against `.prettierrc.json`.
- Review smells consciously left alone: `timingSafeEqual` exists twice (bytes in `password.ts`, string in `csrf.ts`; both legacy); `/login` re-fetches the user because `hydrate` is private to `users.ts`; `normalizeEmail`/`canonicalizeEmail` both return plain `string` (a branded type would enforce the "never confuse them" rule); the per-route try/catch blocks duplicate `app.onError` but preserve the legacy user-facing messages.

## Resolved pre-flight questions

1. Phase 1 was fast-forwarded into local `master`; `main` remains untouched and nothing was pushed.
2. Guest mode and the legacy lifetime message caps are dropped from chat core.
3. The peer session on `main` is treated as expected legacy-app work; phases read the latest relevant legacy files before porting them.

## Pre-flight decisions for Phases 2 to 8 (ACCEPTED)

The user accepted all nine recommended defaults when starting Phase 2.

1. **Landing:** stack one branch per phase and fast-forward local `master` at the end of each phase. Never push, never touch `main`.
2. **Stop rules:** run phases in order. Each phase ends with green tests, type-check, lint and build, a code-review pass, a commit and a STATUS update. Log judgement calls instead of stopping. Stop only for destructive actions, a missing credential or permission, or low budget (then stop at a clean phase boundary).
3. **Cloud resources:** local only, with fakes at the binding boundary (Workers AI, Vectorize, Queues). Create nothing in the Cloudflare account. Wrangler is logged into the **production** account with a token scoped for Workers AI only. Real Workers AI smoke calls need `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in `.dev.vars`, which only the user may add (do not read `.env`).
4. **Docker:** Docker Desktop is installed but was not running. Phase 8 needs it for the Sandbox SDK locally. If it isn't running when Phase 8 starts, build against a fake and mark real verification pending.
5. **Model names:** show the honest open-weight names with vendor icons, not the frontier-style aliases on `main` (commit `47135be`).
6. **Guests and caps:** drop guest mode and the legacy lifetime message caps.
7. **Legacy tables:** drop `chats`, `messages`, `projects`, `chat_attachments`, `feedback` and `user_preferences` in a new migration. No data migration. Keep `research_sessions`, `generated_images` and `email_jobs` for Phase 12.
8. **Branding:** rebrand while copying (OpenChat name, `public/logo-openchat*.svg`, colour derived from the logo). No LobeHub strings shipped.
9. **UI verification:** backend is test-first at the fetch seam. The UI gets type-check, build and a Playwright smoke run via `scripts/ui-probe.mjs` and `scripts/probe-login.mjs`. No broad UI test suite.

## Phase 2 architecture decisions

The durable rationale is in `decisions/0011-phase-2-chat-architecture.md`.

- **Transport:** tRPC mounted on the Hono Worker for typed topic/message CRUD; the token stream remains a purpose-built HTTP streaming endpoint, matching the reference split between tRPC data operations and model streaming.
- **Agent gateway:** not required. Upstream enables it only when business features are on or both `ENABLE_AGENT_GATEWAY` and `AGENT_GATEWAY_URL` are configured; its runtime selector otherwise falls back to the client transport. OpenChat implements the Worker-native streaming path directly.
- **SPA without Next:** the chat route contains no `next/*` imports, but its 239-file store is coupled to later agent/tool phases. Port the Phase 2 behavior and visual structure, not that future-phase dependency graph.
- **D1:** 100 bound parameters per statement is confirmed; FTS5 is supported. Code uses prepared statements and `db.batch()` where a small atomic group is needed instead of assuming interactive transactions.
- **Local emulation:** D1, Queues, Workflows and Containers have local simulation; Workers AI and Vectorize do not. Phase 2 keeps the HTTP Workers AI wrapper and injects a fake at its outbound-fetch boundary in tests.
- **Naming:** rename the authentication table to `auth_sessions`; do not introduce upstream's deprecated agent `sessions` shell. Conversations are `topics`.
- **Locales:** en-US only for now. The reference has 18 locale directories and 972 locale files; broad localization is not needed for the Phase 2 acceptance path.

## Next concrete action

**Phase 8: Cloud sandbox.** Branch `migration/phase-8-sandbox` from the Phase 7 commit. Docker Desktop was not running at the start of the run (accepted default 4): build against a fake and mark real verification pending. Follow the same fetch-seam TDD, local-only verification, review, STATUS update and commit process. Do not push or deploy without the user's instruction.

## How to resume if you're a new agent

1. Read `AGENTS.md`, then `MIGRATION_PLAN.md` in full.
2. Read every file in `decisions/`. They're locked in, not open questions.
3. Skim `research/` for the phase you're working on (don't re-derive it).
4. Check "Current phase" and "Next concrete action" above, and the phase's acceptance criteria in `MIGRATION_PLAN.md` before marking it done.
5. Legacy code lives in git, not in the tree; the frozen snapshot is branch `master` @ `8e6c41c` (plus newer legacy commits on `main`).

## Log

- **2026-10-23**: **Cutover deploy.** One deployment of this build used the name `openchat` on its owner's own Cloudflare account. That account, database id, and hostname are not part of this source tree. `wrangler.jsonc` ships with a placeholder `database_id`. Each person creates their own D1, R2, Vectorize, Workflows, and secrets. The header above, `DEPLOY.md` and `AGENTS.md` still describe the pre-cutover setup.
- **2026-10-23**: Fixed image generation failing for every model: `workersAiRun` handed out `fetch` to be called as `run.fetcher(...)`, which workerd rejects ("Illegal invocation"). The image fake now refuses method-style calls like workerd does.
- **2026-10-23**: Fast-forwarded local `master` to `origin/feature/model-ui-brand-icons` (one commit: per-model `bestFor` descriptions, a NEW badge, and a `VendorIcon` component shared by the model switcher and provider settings). Reconciled it with the bundled LobeHub vendor marks below: `VendorIcon` draws the bundled `ModelLogo` for every chat-catalog vendor and keeps the branch's CDN/initials rendering only as a fallback for unmapped vendors. Not pushed.
- **2026-09-23**: Replaced the model switcher's letter placeholders with the matching LobeHub vendor marks for every catalog family (Meta, OpenAI, Mistral, DeepSeek, Qwen, Z.ai, Kimi, Gemma and NVIDIA), including both the active-model control and dropdown rows.
- **2026-09-23**: Added the four official 16px model marks used by LobeHub to the Home shortcut strip (Mistral, OpenAI, DeepSeek and Gemma). Each shortcut now selects its matching Cloudflare model instead of being decorative text.

- **2026-09-20**: Phase 0 complete (grilling session, decisions recorded, `master` snapshot, docs system). A peer session (`nexcoach-fb`) was found pushing to `main`; merged cleanly and pinged.
- **2026-09-20**: Phase 1 implemented on `migration/phase-1-foundation` with `/mattpocock-skills:implement`; branch-strategy error found and corrected (see above).
- **2026-09-20**: The user removed Phase 9 (messenger integrations) and Phase 10 (sharing) from scope. Phase numbers are kept (marked removed in `MIGRATION_PLAN.md`); ADRs 0002, 0003, 0004 and 0007 amended.
- **2026-09-20**: `/mattpocock-skills:code-review` run against the Phase 1 commit (Standards and Spec reviewers in parallel). Fixed in a follow-up commit: `Secure` cookies decided by host, `Cache-Control: no-store` on `/api/*`, the missing malformed-token / route-ordering / PATCH guard tests, `test/client.ts` now covers the env-override cases, constants and renames, unused `fromBool` removed, and the undisclosed deviations documented (items 7-10 above). The issue tracker isn't configured (`docs/agents/issue-tracker.md` is missing); run `/setup-matt-pocock-skills` before using `/to-tickets`, `/to-spec` or `/wayfinder`.
- **2026-09-20**: Phase 2 started on `migration/phase-2-chat-core`; the nine pre-flight defaults were accepted and the chat architecture questions were resolved in decision 0011.
- **2026-09-20**: Phase 2 chat core reached a verified checkpoint: 73 tests and the full static/build matrix pass; automated mobile registration, streaming, persistence and reload smoke passed entirely locally.
- **2026-09-21**: `$code-review` ran against the Phase 2 base with separate Standards and Spec agents. All six findings were resolved; the final matrix has 74 passing tests, and the refactored UI restored the persisted smoke conversation on mobile.
- **2026-09-21**: Phases 3, 4 and 5 implemented in one run on stacked branches (`migration/phase-3-models-providers`, `-4-agents`, `-5-knowledge-base`) with `/mattpocock-skills:implement`; 123 tests pass. Local `master` was not fast-forwarded (the Phase 2 branch was not either): run `git checkout master && git merge --ff-only migration/phase-5-knowledge-base` when ready. Nothing pushed.
- **2026-09-21**: Two Claude sessions worked on this tree at once (one "complete remaining phases" run was resumed in a second window). Symptoms: `index.lock` errors, files changing under each session, and duplicate Phase 7 commits (`8dcc8c6`, `16d7765`, then a revert `70b3ae5`). They coordinated by message and one stopped; the tree was verified healthy afterwards (153 tests). **Only one agent should edit this repository at a time; check `git status` and `git log` before committing, and stage explicit paths.**
- **2026-09-21**: Phases 6, 7 and 8 implemented on `migration/phase-6-memory`, `-7-goals` and `-8-sandbox`; the full suite passes. Remaining: 11, 12, 13, 14. Nothing pushed; local `master` still at `7498970`.
- **2026-09-22**: User reported the UI wasn't visually LobeHub-like (Phase 13's audit only checked for LobeHub _branding_, not _appearance_ — the SPA was, and remains, original code, not a copy of their component library; see decision `0003`). Restyled all of `src/web` against LobeHub's own published design tokens (`new/lobehub/DESIGN.md`/`DESIGN.dark.md`: color ramp, Geist/Geist Mono type scale, 4px spacing, radius, elevation, control-height scale), light + dark via `prefers-color-scheme`, self-hosted Geist fonts. No component logic touched; all 233 existing tests pass unmodified. Found and fixed two real bugs while verifying with Playwright screenshots: both logo slots used the "for dark backgrounds" mark unconditionally (invisible in the new light theme — fixed with a `<picture>`/media-query swap), and Windows rendered at least one Unicode icon glyph (▥, "Usage") in full color regardless of the U+FE0E text-presentation selector — replaced all 17 glyph icons app-wide with hand-drawn monochrome SVGs (`src/web/components/Icon.tsx`). Committed locally to `master` (`1f9b54f`); **not pushed** — origin/master is still at the phases-1-8/11-13 commit from 2026-09-21.
- **2026-09-23**: Corrected the root UI after the user supplied a direct OpenChat/LobeHub screenshot comparison. The previous root was a custom empty-chat screen with design-token styling, not the reference Home product surface. `/` now renders a faithful OpenChat-branded version of LobeHub's current Home hierarchy: 280px Home navigation, inset workspace surface, greeting/agent header, 817×160 dashboard composer, model shortcuts, idea starters, portrait/suggestions rail and responsive mobile drawer. The existing chat controller remains the behavior seam, so a Home send still creates a topic, navigates to `/chat/:id`, streams and persists through the same backend. Desktop Chromium verification used the screenshot's 1920×938 app viewport; mobile Chromium verified a 390px document width with no horizontal overflow and a visible drawer control. Lint, all three TypeScript projects, production build and all 18 fetch-seam test files pass. This corrects the shown Home/shell surface; feature-detail pages still use their existing OpenChat implementations and require separate page-by-page visual comparisons before claiming whole-product pixel parity.
- **2026-10-26**: Password rules relaxed to a three-character minimum (the sign-up field's `minLength={12}`, which also blocked sign-in, and the server's 8 are gone; no capital or character-mix rules existed). Added a password reset flow: `POST /api/auth/forgot-password` (same answer for known and unknown addresses, three links per account per hour, the email sent after the response) and `POST /api/auth/reset-password` (single-use link, one hour, only a SHA-256 of the token stored in `password_resets`, every session of the account ended, nobody signed in by it); UI is "Forgot your password?" on the sign-in form plus the `/reset-password` page. **Before this works in production:** apply migration `0012_password_resets.sql` to the remote D1, onboard a sending domain under Cloudflare Email Service and set `EMAIL_FROM` (the reset email goes out through the Worker's `EMAIL` binding, not Customer.io; see `DEPLOY.md`). 252 tests pass; mutation checks confirmed the session-revocation and single-use tests are not vacuous.
