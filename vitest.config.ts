import path from "node:path"
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

// Tests must be hermetic: never load a developer's .env / .dev.vars secrets.
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false"

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations")
  )

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            CSRF_SECRET:
              "test-only-csrf-secret-0123456789abcdef0123456789abcdef",
          },
        },
      }),
    ],
    test: {
      include: ["src/worker/**/*.test.ts"],
      setupFiles: ["./src/worker/test/apply-migrations.ts"],
    },
  }
})
