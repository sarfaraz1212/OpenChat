# 0011 — Phase 2 chat architecture

Phase 2 keeps LobeHub's split API shape: typed topic/message data operations use tRPC mounted on the existing Hono Worker, while model output uses a purpose-built HTTP streaming endpoint. This keeps the copied frontend's service boundary recognizable without forcing a token stream through request/response RPC semantics.

The external Agent Gateway is not part of chat core. Upstream only enables gateway mode when business features are enabled or both its gateway flag and URL are configured, and otherwise selects its client runtime. OpenChat runs its Workers AI stream directly in the Worker and retains the existing OpenAI-compatible Cloudflare HTTP wrapper, with the outbound fetch injectable for hermetic tests.

The wrapper will only send its bearer token to an HTTPS `cloudflare.com` host. Both topic creation and streaming validate model IDs against the shared 15-model Cloudflare catalog in `src/shared/models.ts`; accepting an arbitrary `@cf/*` string would bypass the catalog as the product's source of truth. Display names remain the honest open-weight model names.

OpenChat calls a conversation a **topic**, matching current LobeHub vocabulary. The custom login table is renamed from `sessions` to `auth_sessions`; upstream's own `sessions` table is a deprecated agent shell and is not ported. This prevents two unrelated concepts from sharing a schema name before later agent phases arrive.

Only en-US ships in this phase. The reference has 18 locale directories and 972 locale files, while localization is not part of the chat-core acceptance path. The Phase 2 UI ports the reference conversation layout and behavior without copying its 239-file chat store, whose gateway, heterogeneous-agent, tools, work, and group execution paths belong to later phases.

D1-specific constraints are explicit: queries stay below the confirmed 100-parameter limit, JSON remains TEXT at repository boundaries, and small atomic write groups use `db.batch()` rather than assuming an interactive transaction API. FTS5 is available but is deferred until a search phase needs it. Local simulation exists for D1, Queues, Workflows, and Containers; Workers AI and Vectorize require remote bindings, so tests use local fakes instead.
