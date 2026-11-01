# 0012 — Phase 3 models and providers

The model catalog stays in code (`src/shared/models.ts`). OpenChat has one provider, so a registry table would only store constants. D1 holds just each user's deviations from the defaults: `ai_providers` and `ai_models`, keyed by `(id, [provider_id,] user_id)`, with everything enabled until a row says otherwise. This mirrors the shape of LobeHub's tables of the same names but drops the registry columns (key vault, base URL, pricing, settings): credentials are server-managed, and the wrapper refuses any host that is not `cloudflare.com` (decisions 0005 and 0011).

The provider settings page therefore shows a read-only **configured** flag, derived from whether the Worker has both Workers AI credentials, instead of API-key and proxy-URL fields. No secret value ever reaches the browser.

**Capability facts are only recorded when observed.** `MODEL_DETAILS` is a `Record<ChatModelId, …>`, so every model needs an entry, but 10 of the 15 are `{}`: they were never in the legacy 2026-09-12 streaming probe (`main:lib/models/data/cloudflare.ts`), and Workers AI's own advertised flags are unreliable (several models accept an image block and then answer around it). The UI omits a tag rather than guess it. Re-running `scripts/probe-tools.mjs` needs real Workers AI credentials, which only the user adds, so this is pending real verification.

**Disabling a model is a picker preference, not a server block.** The model switcher offers only enabled models of enabled providers (`aiInfra.runtimeState`), as upstream does. The chat endpoint still accepts any catalog model, because the catalog is the security boundary and a preference is not.

**A topic remembers its model.** `topics.model` is written by `topic.update` and by each chat turn (in the same `UPDATE` that bumps `updated_at`), so switching mid-chat needs no separate step. Every message already records the model that produced it, and the transcript shows it.

Structural changes made alongside: the single-file tRPC router is split into per-domain routers (`src/worker/trpc/routers/*`, shared `init.ts`), and the SPA moved from one page that owned the sidebar to a layout route with a session provider and a topics provider, so Settings, Agents and Knowledge can share the shell. "New chat" now navigates home instead of persisting an empty topic; the first send creates it.
