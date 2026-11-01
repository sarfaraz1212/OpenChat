# 0006 — Keep the existing custom D1-native auth; replicate LobeHub's login UI on top of it, not Better Auth

## Context

The current app already migrated off Supabase Auth onto fully custom, D1-backed auth: PBKDF2 password hashing via WebCrypto, session rows in D1, disposable-email blocking at signup/email-change, and WebCrypto-based CSRF. This is confirmed working, live code — not scaffolding (research/02).

LobeHub's own auth engine is **Better Auth** (not NextAuth/Clerk/Casdoor, despite `apps/auth`'s name), with a large pluggable-SSO surface (Google, GitHub, Microsoft, Apple, Okta, Casdoor, and more). `apps/auth` itself is a thin edge SPA shell with no independent backend — it just serves the login pages and proxies everything else to the main app.

## Decision

- Auth backend: keep the existing custom D1-native system unchanged (email/password, no OAuth, no email verification — matches what's already built and what the user asked for).
- Auth UI: replicate LobeHub's login/signup page _design_ (visual layout, component structure) but wire it to the existing backend, not Better Auth.

## Rationale

Better Auth would reintroduce a dependency and a multi-SSO surface the user explicitly declined ("no oauth just simple email password login signup no verify etc"). The existing system already does exactly what was asked for and is already debugged and working.

## Consequences

- Phase 1 ports `lib/auth/*` and `lib/csrf.ts` into Hono middleware, not Better Auth.
- If OAuth is ever wanted later, it can be added to the existing session system without needing to migrate off it first — this decision doesn't foreclose that, it just doesn't build it now.
- `apps/auth`'s pages are a UI reference only (per 0004, its backend role is dropped entirely — folded into the single main Worker).
