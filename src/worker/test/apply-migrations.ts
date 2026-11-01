import { applyD1Migrations, type D1Migration } from "cloudflare:test"
import { env } from "cloudflare:workers"

// TEST_MIGRATIONS is injected by vitest.config.ts; it is not part of the
// deployed Worker's Env, so it is read through a local cast rather than typed
// into worker-configuration.d.ts.
const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] }

await applyD1Migrations(env.DB, TEST_MIGRATIONS)
