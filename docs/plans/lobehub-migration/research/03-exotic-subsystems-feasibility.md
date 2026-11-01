# Research 03 — Cloudflare-feasibility of LobeHub's exotic subsystems

**Source**: background research agent, exploring `../new/lobehub`, during the Phase 0 grilling session, 2026-09-20. Cross-checked against live Cloudflare docs (via the `cloudflare` and `agents-sdk` skills) in the same session — see the "Platform facts" section at the end.
**Purpose**: determine, subsystem by subsystem, what's actually portable to Cloudflare Workers before scoping them in or out. Directly informs `decisions/0002`, `0004`, `0007`, `0008`.

---

Deep-dive research on 7 previously un-inventoried lobehub/lobehub subsystems, all findings from `../new/lobehub`. File paths are repo-relative to that clone.

## 1. Device Gateway

What it is: a registry + RPC relay that pairs a desktop (Electron) install or the `lh` CLI to a LobeHub account (personal pool, or a workspace-shared pool via `lh connect --workspace`), then lets the cloud reach that specific machine for: remote git ops (branch/PR/worktree/diff), remote file browse/read/write/move/rename, dispatching "heterogeneous agent" runs (Claude Code/Codex/Cursor/etc. CLIs) to execute ON the device, tunneling MCP calls only the device can reach (stdio / localhost / LAN HTTP servers), sampling Claude/Codex subscription quota, and relaying outbound iMessage bot replies through a Desktop-hosted BlueBubbles bridge (see §3).

Key files:

- `packages/device-gateway-client/src/client.ts` — `GatewayClient`: the device-side (CLI/desktop) persistent WebSocket client (uses `ws`), heartbeat/backoff/reconnect, default URL `https://device-gateway.lobehub.com`.
- `packages/device-gateway-client/src/http.ts` — `GatewayHttpClient`: the **server**-side client, plain `fetch()` POSTs to `/api/device/{status,devices,tool-call,rpc,agent/run,message-api}`.
- `apps/server/src/services/deviceGateway/{index.ts,scopedDevices.ts,authorizedToolCall.ts}` — server wrapper (`DeviceGateway` class).
- `apps/server/src/routers/lambda/{device.ts,deviceWorkspaceGuard.ts}` — tRPC surface.
- `packages/database/src/schemas/device.ts` — `devices` table.
- `apps/desktop/src/main/{controllers/GatewayConnectionCtr.ts,services/gatewayConnectionSrv.ts}` and `apps/cli/src/commands/connect.ts` — the device-side WS client wiring.
- `packages/env/src/gateway.ts` — `DEVICE_GATEWAY_URL` / `DEVICE_GATEWAY_SERVICE_TOKEN` env.
- `.agents/acceptance/references/agent-gateway.md` — reveals the architecture (below).

Transport (two distinct legs):

- **Server ↔ Gateway**: plain stateless HTTP/JSON POST — fully Workers/fetch-compatible.
- **Device (CLI/Electron) ↔ Gateway**: a persistent, heartbeated WebSocket opened _from_ the device.

Critical structural fact: the Gateway service that terminates/hosts those WebSockets is **not in this repo**. `.agents/acceptance/references/agent-gateway.md` states: "The gateway worker lives in a **sibling repo: look for `agent-gateway/` next to `lobehub/`**… It's a Cloudflare Worker (`wrangler dev`, Durable Objects in local mode)." A second, related "agent-gateway" (distinct from "device-gateway") pushes streaming operation events to the browser, same architecture. LobeHub's own production device/agent gateway is **already a Cloudflare Worker + Durable Objects** — outside this clone, nothing to port, only to reimplement or acquire.

Does it need Electron/CLI? Yes — a "device" is definitionally an Electron install or `lh` CLI daemon on a real machine; there's no pure-web device. The relay/registry itself is ordinary Workers-shaped request/response code, but meaningless without a device to pair with.

**Portability flag: server-side relay is stateless HTTP, portable to Workers; the persistent-WebSocket host is a separate, already-Workers-native (Durable Objects) service living outside this repo; the device endpoint it pairs with is inherently non-Workers (the user's own desktop/CLI).** → Excluded per `decisions/0002` (nothing to pair with once desktop/CLI is out of scope).

## 2. Sandboxes — two unrelated meanings

**(a) Cloud sandbox** — arbitrary code/shell execution for agent tool calls ("code interpreter"):

- `apps/server/src/services/sandbox/{index.ts,factory.ts,types.ts,service.ts}`, `providers/{market.ts,onlyboxes.ts}`
- `packages/builtin-tool-cloud-sandbox/src/*` (the LLM-facing tool)
- `packages/env/src/sandbox.ts` — `SANDBOX_PROVIDER` env (`'market' | 'onlyboxes'`, default `market`)

Two swappable providers:

- **`market`** (default): proxies to `@lobehub/market-sdk`'s hosted "code interpreter" plugin — i.e. the sandbox execution runs on LobeHub's **Marketplace** backend, the same product family explicitly excluded from this migration.
- **`onlyboxes`**: a separate LobeHub-proprietary hosted REST sandbox API, HMAC-signed JIT bearer tokens, no public docs, no self-host option found anywhere in the repo.

Both are plain REST/JSON over `fetch` (Workers-compatible on the _calling_ side), but both are hard dependencies on an externally hosted execution backend that Cloudflare Workers cannot itself provide (Workers cannot run arbitrary shell/Python/Node processes) and that this migration cannot self-host or legally replicate.

**(b) Device sandbox** — OS-level local process sandboxing, unrelated to (a):

- `packages/device-sandbox/src/*`, built on `@anthropic-ai/sandbox-runtime` (macOS Seatbelt, Linux bwrap/landlock, Windows WFP filters + restricted user account). Only ever runs inside the Electron desktop app or CLI, on the end user's own machine. Zero relationship to Cloudflare Workers.

**Portability flag: cloud sandbox requires an external service with no self-host option (excluded as a port); device sandbox is architecturally incompatible with Workers (local-OS-process isolation only).** → Per `decisions/0004`, the _user-facing capability_ (agent code execution) is kept, reimplemented from scratch on Cloudflare's own `@cloudflare/sandbox` SDK (Container + Durable Object — confirmed real and available via the `cloudflare` skill during this same session). This is Phase 8.

## 3. Messenger integrations

All five live under `apps/server/src/services/bot/platforms/<platform>/` with a matching thin client package `packages/chat-adapter-<platform>/src/*`.

- **Feishu/Lark** — Official Open Platform HTTP/JSON REST API; auth = `app_id`+`app_secret` → `tenant_access_token` (2h). Default stateless webhook/"Event Subscription" mode (Workers-friendly); an optional persistent long-connection mode (`FeishuWSConnection` wrapping `@larksuiteoapi/node-sdk`'s `WSClient`) exists for apps that can't expose a public URL — not needed here. Needs a self-registered Feishu/Lark app.
- **WeChat** — **not** the standard Official Account webhook API — an unofficial/gray "iLink Bot / ClawBot" protocol requiring interactive QR-code scan-and-confirm login by a real personal WeChat account, then a ~35-second HTTP long-poll loop with a `context_token` that must be cached per-conversation. Inherently stateful long-polling (needs a Durable Object or Queue+cron to sustain it), and the credential requirement (a personal account willing to be QR-scanned) carries real ban risk.
- **QQ** — Official QQ Open Platform Bot API; `appId`+`clientSecret` → `access_token`; stateless HTTP webhook, Ed25519-signature verified. Platform caveat (not implementation): QQ disabled proactive bot messages in April 2025, so only passive `msg_id`-triggered replies work.
- **iMessage** — requires a physical/virtual Mac signed into Messages, running the third-party open-source BlueBubbles Server, plus the LobeHub Desktop (Electron) app running a local loopback webhook bridge on that same Mac. Flow: iMessage → macOS Messages → BlueBubbles → 127.0.0.1 Desktop bridge → cloud webhook → bot router; outbound replies go back through the Device Gateway (§1) to the Desktop bridge, which calls BlueBubbles' REST API. The repo's own doc states: "LobeHub Desktop must stay online for inbound forwarding and outbound replies." Only the cloud-side webhook receiver is Workers-portable — the channel as a whole cannot exist without a Mac + BlueBubbles + Desktop app.
- **LINE** — Official LINE Messaging API; stateless webhook, `X-Line-Signature` (HMAC-SHA256) verified; replies use the push-message API (reply tokens expire in ~60s, too short for LLM latency). Needs a LINE Developers Console channel.

**Portability flags: Feishu = stateless HTTP, portable; WeChat = requires external service (long-poll + gray-market protocol, needs a DO/queue); QQ = stateless HTTP, portable; iMessage = architecturally incompatible with Workers (needs a Mac); LINE = stateless HTTP, portable.** → Per `decisions/0007`: Feishu, QQ, LINE kept; WeChat and iMessage excluded.

## 4. Composio and Klavis

**Composio** — a hosted SaaS tool-calling marketplace/OAuth broker for 20+ third-party apps (Gmail, Calendar/Sheets/Docs/Drive, Slack, Jira, Notion, Salesforce, etc. — full catalog in `packages/const/src/composio.ts`). LobeHub's server never calls those apps directly: it calls Composio's own hosted `tools.execute` API (`apps/server/src/services/composio/index.ts`). Requires a Composio.dev account + API key; **no self-hosted option** anywhere in the repo. Composio-sourced tool manifests are explicitly tagged `['composio', 'mcp']` in the in-app catalog — the product positions Composio as an MCP-adjacent/alternative tool-discovery surface, even though the wire protocol is Composio's own proprietary REST API, not MCP itself.

**Klavis** — fully deprecated. `apps/server/src/routers/lambda/klavis.ts` is now a pure legacy no-op (`getKlavisPlugins: publicProcedure.query(() => [])`), with the file's own comment: "Legacy compatibility for clients released before the Klavis to Composio migration." No other Klavis integration code exists anywhere in the repo — nothing live to migrate.

**Portability flag: requires external service (Composio.dev account + API key, no self-host option); Klavis code path is dead — legacy no-op only.** → Per `decisions/0002`: both excluded (Composio under the "no MCP" umbrella per its own in-repo tagging; Klavis has nothing to exclude, it's already inert).

## 5. Agent groups / task graphs / goal tracking

DB tables (`packages/database/src/schemas/`), 16 total, none with `vector(...)`/`tsvector`/BM25 columns (pure relational — uuid/text/jsonb/timestamps, D1-portable in shape):

- `chatGroup.ts` → `chatGroups`, `chatGroupsAgents` (2) — "agent groups."
- `goal.ts` → `goals` (1).
- `goalGraph.ts` → `goalNodes`, `goalEdges`, `goalNodeWorkVersions`, `goalNodeDecisions`, `goalEvents` (5) — the literal "task graph": a DAG of nodes/edges with decision + event history.
- `goalTrace.ts` → `goalTraces` (1).
- `task.ts` → `tasks`, `taskDependencies`, `taskDocuments`, `taskTopics`, `briefs`, `taskComments`, `taskActivities` (7).

Scale: `packages/builtin-tool-{goal,group-management,group-agent-builder,task,agent-management,agent-builder}` = 81 files in dedicated builtin-tool packages alone; `apps/server/src/services/goal/` is 37 files by itself (includes `scheduler/` and `supervisor/` subdirectories) plus ~15 more "group"-named server-service files; repo-wide grep hits ~173 files touching chat groups, ~98 touching the goal graph, ~162 touching goal/task; under `src/` (web UI) there are 75/65/142 files matching "group"/"goal"/"task" by filename respectively. Well over 300 files end-to-end — the largest single subsystem in scope.

Beyond the data model, `apps/server/src/services/goal/manager.README.md` and `EXPLORATION.md` describe real orchestration logic: a planner/coordinator loop with per-turn budgets, retry/escalation policy, human-in-the-loop "Gate" pausing, row-locked plan submission (idempotent, first-submission-wins), and a background wake-up scheduler at `apps/server/src/services/goal/scheduler/impls/{qstash.ts,local.ts,type.ts}` — the production path uses Upstash QStash for "restart durability," but a `local.ts` in-process fallback also exists, so it's pluggable rather than a hard dependency.

Coupling to §1/§2: the goal/task schema has no pgvector/BM25/device/sandbox coupling, but goal execution dispatches through the shared `apps/server/src/services/aiAgent/pipeline/heteroDispatch.ts` pipeline, which _can_ route a task's execution to a paired device or a cloud sandbox depending on the agent's configured execution target — reused infrastructure, not a hard dependency (an LLM-only agent never touches either).

**Portability flag: large but straightforward data-model port (16 tables, no pgvector/BM25), plus a genuinely nontrivial planner/scheduler orchestration layer currently built on an external hosted queue (Upstash QStash, with a swappable local fallback already in the code).** → In scope, Phase 7. Use Cloudflare Workflows + Queues in place of QStash (`decisions/0004`), starting from the existing `local.ts` shape.

## 6. RBAC

Schema:

- `packages/database/src/schemas/rbac.ts` — generic, code-driven engine: `rbac_roles`, `rbac_permissions` (permission `code`s like `chat:create`), `rbac_role_permissions`, `rbac_user_roles`; every table optionally `workspaceId`-scoped.
- `packages/database/src/schemas/workspace.ts` — `workspaces`, `workspace_members`, `workspace_invitations`.
- `packages/database/src/schemas/resourcePermission.ts` — polymorphic per-resource ACL (`agent`/`agentGroup`/`document`/`knowledgeBase` at `view`/`use`/`edit`).

Enforcement middlewares are consumed across **at least 67 files** in `apps/server/src` (lambda routers for device, connector, composio, brief, expertise, oauthApp, topic, agentSkills, aiModel/aiProvider, webBrowsing, user, verify, etc.) — RBAC/workspace-role gating is threaded through most of the tRPC API surface, not isolated to one module.

Is it multi-tenant/workspace-scoped? Entirely, yes. A single-tenant/personal deployment resolves to exactly one implicit workspace owner with no other members, so every RBAC check trivially passes — the tables and the ~67 call sites all still exist and still run, they just always resolve the same way. Bypassing the machinery outright (rather than just always-satisfying it) would touch most lambda routers since the middleware is applied per-router, not centrally.

**Portability flag: large but straightforward data-model port (relational, D1-portable); deeply woven into ~67 server call sites as multi-tenant middleware — simplifiable for a single-tenant deployment but not cleanly removable without touching most routers.** → Deferred per `decisions/0008`. No phase in `MIGRATION_PLAN.md` currently builds the enforcement middleware or workspace UI.

## 7. Memory / user-memory system

Location:

- `packages/memory-user-memory/src/` — pure LLM-prompting/extraction logic (extractors for identity/persona/preference/experience/activity/context, gatekeeper prompts, a LoCoMo benchmark harness) — no storage code here.
- `packages/database/src/{models,repositories}/userMemory/*` — data access.
- `packages/database/src/schemas/userMemories/{index.ts,persona.ts}` — schema.
- `apps/server/src/services/memory/userMemory/{extract.ts,embedding.ts,persona/service.ts}` — server orchestration.
- `apps/server/src/routers/lambda/{userMemory.ts,userMemories.ts}` — tRPC API.
- `apps/server/src/router-hono/workflows/memory-user-memory/workflows/*` — background extraction jobs.

**pgvector dependency: yes, heavily**, and confirmed independent of the KB/RAG pgvector usage flagged in §2 of `research/01`. `packages/database/src/schemas/userMemories/index.ts` defines 6 tables — `user_memories`, `user_memories_contexts`, `user_memories_preferences`, `user_memories_activities`, `user_memories_identities`, `user_memories_experiences` — carrying **11 separate `vector(dimensions: 1024)` columns** in total, each with its own Postgres HNSW index. `persona.ts` (the LLM-synthesized rolling user-profile table) has **no** vector columns — purely relational/text.

Relationship to the KB/RAG pgvector pipeline: separate pipeline, separate tables, separate extraction code — but architecturally identical in kind (Postgres + pgvector + HNSW for semantic retrieval), so the migration fix is the same category of work (swap for Cloudflare Vectorize) applied twice, as two independent indexes rather than a shared one.

Embedding generation is provider-agnostic: `apps/server/src/services/memory/userMemory/embedding.ts` calls the shared `ModelRuntime['embeddings']` abstraction used everywhere else in the app, so it already works with any wired embedding provider — including Cloudflare Workers AI. Only the **vector storage/index side** is pgvector-specific.

Background extraction runs on a hosted **Upstash Workflow** durable-step-function pipeline (`@upstash/workflow`), triggered hourly — the same external-orchestrator family as the QStash goal scheduler in §5, conceptually mappable to Cloudflare Workflows/Queues but not currently self-hosted.

**Portability flag: requires external service (Postgres pgvector — 11 vector columns across 6 tables — needs Cloudflare Vectorize equivalents); separate from, but architecturally identical to, the already-flagged KB/RAG pgvector dependency; extraction pipeline runs on hosted Upstash Workflow (swappable for Cloudflare Workflows/Queues).** → In scope, Phase 6. Two separate Vectorize indexes needed (this one, and the KB/RAG one from Phase 5) — see `decisions/0004`.

---

## Platform facts (confirmed live against Cloudflare docs, same session)

Fetched via the `cloudflare` and `agents-sdk` skills to check feasibility claims above, rather than relying on pre-trained knowledge:

- **Cloudflare Sandbox SDK** (`@cloudflare/sandbox`) — real, GA-adjacent (Containers platform is in beta, no SLA yet). Each sandbox = a Durable Object + Container; persistent filesystem/process/network isolation; `sandbox.exec()`, `readFile`/`writeFile`, `startProcess`, `exposePort` for preview URLs, `mountBucket` for S3-compatible storage. This is the reimplementation target for §2(a).
- **Vectorize** — GA. 10M vectors/index, up to 1536 dimensions, cosine/euclidean/dot-product metrics, metadata filtering, namespaces (up to 50K on paid plans) for multi-tenancy. Gotchas worth remembering when implementing Phase 5/6: inserts take 5–10s to become queryable (eventual consistency), Workers API batch limit is 500 vectors/call, metadata indexes must be created before inserting vectors.
- **D1** — SQLite-compatible, 10GB/database on paid plans, 30s query timeout (900s with the Sessions API), 10,000 batch statements on paid plans. No FTS5-specific confirmation was pulled in this pass — verify directly when Phase 7 (or wherever BM25 parity matters) starts.
- **Workers limits** — CPU time 30s default / 5min max configurable on paid plans (not wall-clock — response streaming is unlimited, so long LLM streams are fine; heavy compute should go through Workflows/Queues/the Sandbox container rather than inline in a request handler). 10,000 subrequests/invocation on paid plans.
- **Queues** — at-least-once delivery, 5,000 msgs/sec/queue, delays up to 12 hours, dead-letter queues. Good fit for the higher-throughput async dispatch pieces (e.g. email job dispatch, already used for that in the current app's own `email_jobs` pattern).
- **Workflows** — durable multi-step execution, automatic retries (configurable backoff), `step.sleep()`/`sleepUntil()` from minutes to weeks, `waitForEvent()` for webhook/approval-style steps. This is the direct replacement for both Upstash QStash (§5) and Upstash Workflow (§7) — a near-exact conceptual match for LobeHub's own scheduler shape.
