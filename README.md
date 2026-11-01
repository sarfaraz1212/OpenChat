# OpenChat

OpenChat is a chat and agent platform on Cloudflare Workers, backed by open-weight models hosted on Workers AI. It is being rebuilt as a close replica of `lobehub/lobehub`; see `docs/plans/lobehub-migration/` for the plan and current status.

## Stack

| Layer    | Technology                                                                  |
| -------- | --------------------------------------------------------------------------- |
| Backend  | Hono on a single Cloudflare Worker (`src/worker`)                           |
| Frontend | Vite + React Router SPA (`src/web`), served from the Worker's static assets |
| Database | Cloudflare D1 (SQLite)                                                      |
| Auth     | Email + password, sessions in D1, WebCrypto CSRF                            |
| Tests    | Vitest inside workerd (`@cloudflare/vitest-pool-workers`)                   |

## Getting started

```bash
pnpm install
cp .dev.vars.example .dev.vars   # then set CSRF_SECRET to 32+ random characters
pnpm db:migrate:local
pnpm dev
```

`pnpm db:migrate:local` applies `migrations/` to the local D1 only.

## Scripts

| Command                        | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `pnpm dev`                     | Vite dev server with the Worker running in workerd |
| `pnpm build`                   | Production build                                   |
| `pnpm test`                    | Vitest                                             |
| `pnpm type-check`              | TypeScript, no emit                                |
| `pnpm lint`                    | ESLint                                             |
| `pnpm cf-typegen`              | Regenerate Worker binding types                    |
| `pnpm sync:disposable-domains` | Refresh the disposable-email blocklist             |

## Deployment

Not deployed yet. See [DEPLOY.md](./DEPLOY.md).

## License and attribution

See [LICENSE](./LICENSE) for this app's own code, and
[ATTRIBUTION.md](./ATTRIBUTION.md) for what OpenChat reimplements from
`lobehub/lobehub`, the third-party services it can call, and the bundled
blocklist data.
