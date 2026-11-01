# 0003 — Hono + Vite/React Router SPA replaces Next.js entirely

## Context

The current app is Next.js, deployed to Cloudflare via `@opennextjs/cloudflare`. LobeHub's own main app is also Next.js (with a React-Router SPA mounted inside it), but LobeHub's `apps/auth` and `apps/share` are a _different_ shape: a thin Hono/Workers backend plus a Vite-built React Router SPA, with the SPA served directly by the Worker and all API calls proxied to the main backend.

The user's very first instruction, before any of the LobeHub-replica discussion, was to rebuild the app "with Hono.js ... to make Cloudflare compatible." Two readings were possible:

1. Keep Next.js/OpenNext for the frontend, add Hono only as an API layer (e.g. mounted at a Next.js catch-all route).
2. Drop Next.js/OpenNext entirely; Hono becomes the single Worker entry point, serving both the SPA's static assets and every API/webhook route.

## Decision

**Reading 2.** Hono is the whole backend and the asset server; the frontend is a Vite + React Router SPA (mirroring the shape of LobeHub's own `src/spa` + `apps/auth`/`apps/share`, not its Next.js shell). No Next.js, no OpenNext adapter.

## Rationale

- Matches the literal first instruction ("rebuild ... with Hono.js") more directly than bolting Hono onto Next.js.
- Matches the architecture LobeHub itself already uses for its edge-deployed pieces (`apps/auth`, `apps/share`) — both were found to be exactly this shape (thin Workers backend + SPA), which is what's being folded into the single main Worker per 0004.
- Avoids OpenNext's adapter complexity/quirks (edge-runtime caveats, SSR streaming edge cases) in favor of a Workers-native request/response model that's simpler to reason about and debug.
- The current app's actual business logic (`lib/`, `app/api/*`) is portable to Hono handlers with minimal change — it's already Workers-runtime code (no Node built-ins outside `nodejs_compat`), just wrapped in Next.js route handler signatures instead of Hono's.

## Important caveat

**This was an architectural call made by the implementing agent during planning, not a decision explicitly put to and confirmed by the user.** It follows directly from the user's first, literal instruction and from what was found in LobeHub's own repo, but it was not itself one of the grilling questions. Flagged here deliberately so it's easy to spot and challenge if it turns out to be wrong — if the user actually wanted Next.js kept (e.g. for SSR/SEO reasons, or to minimize the diff against the current app), this decision is the one to revisit, and it should be revisited _before_ Phase 1 produces a lot of code built on top of it.

## Consequences

- Every Next.js-specific piece of the current app (`app/` router, `middleware.ts`, `next.config.ts`, `open-next.config.ts`) is replaced during Phase 1, not reused.
- SEO/SSR for any public-facing page (a landing page; share links were removed from scope on 2026-09-20) needs its own answer under a pure SPA model — likely server-rendered-at-the-edge-in-Hono for those specific routes rather than full Next.js SSR. Not yet designed; decide it in whichever phase first needs a public page.
- `wrangler.jsonc`'s `main` entry changes from `.open-next/worker.js` to the new Hono app's built entry; the `assets` binding points at the Vite build output instead of OpenNext's.
