# 0005 — Keep the existing Cloudflare Workers AI wrapper; don't switch to the native `env.AI` binding

## Context

The current app already calls Cloudflare Workers AI exclusively, through its OpenAI-compatible REST endpoint (`lib/openproviders`), rather than the native `env.AI.run(...)` Workers binding. `wrangler.jsonc` has an explicit comment explaining why: declaring an `ai` binding forces `wrangler dev` into a _remote_ session, which then fails without Workers Scripts permissions on the API token. There's also a hard-won fix already in place, `lib/openproviders/repair-stream.ts`, patching a real Workers-AI-specific bug where streamed SSE `delta.content` sometimes arrives as a bare integer or empty array instead of a string — found on 4 of the 15 chat models.

The initial instinct during planning was to switch to the native binding for a "cleaner," Workers-native rebuild. LobeHub's own Cloudflare provider (`packages/model-runtime/src/providers/cloudflare/`) was checked as a sanity comparison — it also calls the same public REST API over HTTP (`https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/`), not the native binding, treating Workers AI as a remote provider like any other.

## Decision

Keep `lib/openproviders` as-is, unchanged, ported into the new Hono handlers. Do not switch to `env.AI`.

## Rationale

- The REST wrapper was a deliberate choice, not an oversight (the wrangler.jsonc comment says so directly), made for local-dev-experience reasons that still apply.
- `repair-stream.ts` represents real, already-solved debugging work against a live vendor bug. Switching to `env.AI` would mean rediscovering (or worse, not discovering) that same bug from scratch with no guarantee the native binding doesn't have its own version of it.
- LobeHub's own team — presumably with direct Cloudflare context — made the identical choice (REST over native binding) in their own Cloudflare provider implementation.
- No user-facing capability is gained by switching; the only theoretical benefit (avoiding one HTTP hop) doesn't offset the cost of re-deriving a working streaming implementation.

## Consequences

Phase 2 (Chat core) ports this module unchanged. The model catalog (`lib/models/data/cloudflare.ts`, 15 chat models + Whisper + FLUX/Leonardo image models) also carries forward as-is — it's the source of truth for "which Cloudflare models exist in the app under which display name," used again in Phase 3.
