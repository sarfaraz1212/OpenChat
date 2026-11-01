# Deploying OpenChat

**This branch is not deployed anywhere, and nothing here should deploy it until the Phase 14 cutover** (see `docs/plans/lobehub-migration/MIGRATION_PLAN.md`).

## Why it's locked down

The live production Worker is named `openchat` and runs the legacy Next.js app from `main`. Cloudflare Workers Builds is connected to `main` and deploys on every push, so:

- Migration work must not be pushed to `main`.
- `wrangler.jsonc` here names the Worker `openchat-v2`, so a stray `wrangler deploy` creates a separate Worker instead of replacing production.
- The D1 `database_id` in `wrangler.jsonc` is a placeholder. The real id is in `main:wrangler.jsonc`. With the placeholder, `--remote` D1 commands fail to resolve the database rather than touching production data.

## Local development

```sh
pnpm install
cp .dev.vars.example .dev.vars    # set CSRF_SECRET
pnpm db:migrate:local
pnpm dev
```

## Checking a deploy bundle without deploying

```sh
pnpm build
npx wrangler deploy --dry-run
```

`--dry-run` bundles the Worker and prints the upload size and bindings; it uploads nothing. Keep an eye on the size line as dependencies grow (the paid plan limit is 10 MB gzipped).

## Cutover checklist (Phase 14)

Do these deliberately, with the user's go-ahead, not as part of routine work:

1. Restore the real D1 `database_id` from `main:wrangler.jsonc`, and reconcile everything else in `wrangler.jsonc` against it: the R2 buckets, `triggers.crons`, `vars` and `compatibility_flags` that the legacy config carried and this one deliberately dropped (see `docs/plans/lobehub-migration/STATUS.md`, deviation 8), plus any bindings later phases added.
2. Rename the Worker from `openchat-v2` to `openchat`.
3. Apply migrations to the remote D1 (`npx wrangler d1 migrations apply openchat --remote`); take a Time Travel bookmark or export first.
4. Set secrets: `CSRF_SECRET` and whatever later phases require (`npx wrangler secret put <NAME>`).
5. Point Workers Builds at the new build command (`pnpm build`) and deploy command (`npx wrangler deploy`), and merge the new build into `main`.

## Phase 5 resources (create at the Phase 14 cutover, not before)

The knowledge base needs one R2 bucket and one Vectorize index. `wrangler.jsonc` already binds them under new names, so the legacy `openchat` Worker and its bucket are untouched:

```sh
npx wrangler r2 bucket create openchat-v2-files
npx wrangler vectorize create openchat-v2-kb --dimensions=1024 --metric=cosine
# Must exist BEFORE any vector is inserted, or the file_id filter won't work:
npx wrangler vectorize create-metadata-index openchat-v2-kb --property-name=file_id --type=string
```

Vectorize is eventually consistent, so a document can take a few seconds to become searchable after upload. Until the index exists, uploads are stored but marked `failed`.

## Phase 6 resources (create at the Phase 14 cutover)

User memory has its own Vectorize index, separate from the knowledge base's. It uses only the namespace (no metadata filter), so no metadata index is needed:

```sh
npx wrangler vectorize create openchat-v2-memory --dimensions=1024 --metric=cosine
```

The `MEMORY_WORKFLOW` Workflow is deployed with the Worker (class `MemoryExtractionWorkflow`); nothing to create by hand.

## Phase 8: the code-execution sandbox (enable at the Phase 14 cutover)

Agents can run code in a per-conversation container through the Cloudflare Sandbox SDK (`@cloudflare/sandbox`, a Durable Object plus a Container). The `Sandbox` class is already exported from the Worker, but the **`containers` block is deliberately not in `wrangler.jsonc`**: it makes `vite dev`, the test runner and `wrangler dev` build a Docker image, which fails on any machine without Docker running. Until you add it, `env.SANDBOX` is absent and agents simply get no code-execution tools (chat is unaffected).

To enable it, with Docker running, add this to `wrangler.jsonc` and deploy:

```jsonc
"containers": [
  {
    "class_name": "Sandbox",
    "image": "./sandbox/Dockerfile",
    "instance_type": "lite",   // start small; raise if code needs more memory
    "max_instances": 5         // caps concurrent containers, and the bill
  }
],
"durable_objects": {
  "bindings": [{ "class_name": "Sandbox", "name": "SANDBOX" }]
},
"migrations": [{ "new_sqlite_classes": ["Sandbox"], "tag": "v1" }]
```

Then turn on **"Let this agent run code in a secure sandbox"** on an agent whose model shows the "Tools" tag. Operational notes: Containers is in beta with no SLA; a sandbox can make outbound network requests unless you restrict it; the `Sandbox` image tag in `sandbox/Dockerfile` must match the SDK version in `package.json`.

## Phase 12 resources (create at the Phase 14 cutover)

Generated and edited images (gallery, background removal, enhancer) live in an R2 bucket bound as `IMAGES`. The name is not the legacy bucket's, so this Worker cannot touch production objects:

```sh
npx wrangler r2 bucket create openchat-v2-images
```

The legacy `generated_images` rows point at `/api/files/images/{userId}/{file}`, and the new Worker serves exactly those URLs (to their owner only), so at cutover copy the legacy bucket's objects into the new one under the same keys, for example with `rclone copy legacy:<bucket> openchat-v2:openchat-v2-images`, before switching traffic.

Third-party secrets, set with `wrangler secret put` (never in `wrangler.jsonc`); each feature simply reports "not configured" without its key:

| Secret                                                     | Feature                                                                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BFL_API_KEY`                                              | Background removal and image enhancer (Black Forest Labs)                                                                                                                                          |
| `TAVILY_API_KEY`, `PERPLEXITY_API_KEY` or `SERPER_API_KEY` | Deep Research web search (first one set wins, in that order)                                                                                                                                       |
| `CUSTOMERIO_API_KEY`                                       | Onboarding and re-engagement emails (unset means no email is sent)                                                                                                                                 |
| `APP_URL`                                                  | The app's public URL, used in every email link. Email is not sent until this is set too                                                                                                            |
| `EMAIL_FROM`                                               | The address password-reset emails are sent from, on a domain onboarded to Email Service (below). Needs `APP_URL` too. Unset means no reset link is emailed, though the form still answers normally |
| `CRON_SECRET`                                              | Bearer secret for `POST /api/cron/emails`; without it that route answers 503                                                                                                                       |

### Password reset emails

Reset links are sent by the Worker itself through the `EMAIL` binding (`send_email` in `wrangler.jsonc`, Cloudflare Email Service), not Customer.io, and their wording lives in `src/worker/lib/email/reset.ts`. Nothing is sent until you:

1. In the Cloudflare dashboard open **Compute → Email Service → Email Sending → Onboard Domain** and onboard the domain to send from (it must use Cloudflare DNS). Wait for its SPF, DKIM and DMARC records to verify.
2. Set `EMAIL_FROM` to an address on that domain, for example `noreply@yourdomain.com`.
3. Make sure `APP_URL` is set: the link in the email is `{APP_URL}/reset-password?token=…`.

Once a domain is onboarded the binding can send to any recipient. The service is in beta, and a new account starts with a conservative daily quota. A failed send is logged (`[/api/auth/forgot-password] send failed`, with the service's error `code`) and the form still answers the same way, so check the Worker logs if people say no email arrives. In `pnpm dev` a send is only simulated; add `"remote": true` to the binding to really send from a local run.

### The hourly email cron

`src/worker/index.ts` exports a real `scheduled()` handler that runs the drip
(queue what is due, then send a small batch). It has no trigger yet, so add one
at cutover:

```jsonc
"triggers": { "crons": ["0 * * * *"] }
```

Until then it can be exercised with `wrangler dev --test-scheduled` or through
the secret-guarded route. The route exists because the legacy app had one;
prefer the trigger in production and consider dropping the route.
