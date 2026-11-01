# OpenChat: agent guide

OpenChat is being rebuilt as a one-to-one replica of `lobehub/lobehub` (minus community, MCP, pricing and a few named features), on Cloudflare Workers + Hono + D1. The full plan lives in `docs/plans/lobehub-migration/`. Read it before changing anything:

1. `MIGRATION_PLAN.md`: the phases, with acceptance criteria.
2. `STATUS.md`: which phase we're on, what's done, the next concrete action. Update it after every unit of work.
3. `decisions/`: locked-in calls. Don't re-litigate them; if one looks wrong, tell the user.
4. `research/`: what the reference repo and the legacy app contain. Read it instead of re-exploring.

## Stack

- One Cloudflare Worker: Hono routes in `src/worker/` (entry `src/worker/index.ts`).
- A Vite + React Router SPA in `src/web/`, served from the Worker's static assets. The Worker only runs first for `/api/*`.
- D1 (SQLite) for data; migrations in `migrations/`. No Next.js, no OpenNext.
- Reference source for features to copy: a clone of `lobehub/lobehub` at `new/lobehub` (gitignored, read-only, never edit it).

## Commands

| Command                 | What it does                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm dev`              | Vite dev server with the Worker running in workerd (needs `.dev.vars`, see `.dev.vars.example`) |
| `pnpm db:migrate:local` | Apply `migrations/` to the **local** D1                                                         |
| `pnpm test`             | Vitest inside workerd (`@cloudflare/vitest-pool-workers`)                                       |
| `pnpm type-check`       | `tsc` for the worker, web and config projects                                                   |
| `pnpm lint`             | ESLint over `src`, `scripts` and the config files                                               |
| `pnpm build`            | Vite build (client assets + Worker bundle)                                                      |
| `pnpm cf-typegen`       | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc`                           |

## Rules that are easy to get wrong

- **Never push migration work to `main`.** `main` is the live legacy app, and Cloudflare Workers Builds deploys it on every push. The new build lives on separate branches until the Phase 14 cutover.
- **Never deploy, and never run remote D1 commands** (`--remote`), without the user saying so. The Worker is named `openchat-v2` and its D1 `database_id` is a placeholder on purpose, so nothing here can touch production; keep it that way until cutover. `npx wrangler deploy --dry-run` is safe.
- **New tests go at one seam only: the Worker's fetch interface** (agreed with the user). Send real HTTP requests through `src/worker/test/client.ts` (`new TestClient({ origin?, env? })` overrides where requests appear to come from and which bindings the Worker sees, e.g. an empty `CSRF_SECRET`) and assert on status, JSON and cookies. Don't test routes' internals or query D1 directly to verify behavior. Write the failing test first. The one exception is old, not new: the legacy unit tests for password hashing and email identity / disposable-domain rules (`src/worker/lib/auth/__tests__/`) moved over unchanged with the code they cover, as agreed when the seam was chosen. Don't add more tests at that level.
- **`validateCsrfToken` is async.** A missing `await` makes CSRF checks pass unconditionally. `src/worker/__tests__/csrf.test.ts` guards this; never weaken it.
- Legacy code (the Next.js app, its `lib/`, `components/`, chat/deep-research/image code) is not in this tree. Read it from git when a phase ports it: `git show main:lib/db/chats.ts`, or `git worktree add ../openchat-legacy master`.
- Secrets never go in `wrangler.jsonc`. Local: `.dev.vars` (gitignored). Deployed: `wrangler secret put`.
