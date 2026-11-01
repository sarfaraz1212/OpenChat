import { app } from "./app"
import type { AppBindings } from "./env"
import { runEmailCron } from "./lib/email/run"

export { Sandbox } from "@cloudflare/sandbox"
export { GoalRunWorkflow } from "./workflows/goal-run"
export { MemoryExtractionWorkflow } from "./workflows/memory-extraction"
export { ResearchRunWorkflow } from "./workflows/research-run"

export default {
  fetch: app.fetch,

  /**
   * Scheduled work. The legacy app declared an hourly trigger with no handler
   * at all; this is that handler. The `triggers.crons` entry that drives it is
   * added at the Phase 14 cutover, together with the rest of the deploy config,
   * so until then this runs only when invoked (`wrangler dev --test-scheduled`)
   * or through the secret-guarded `/api/cron/emails` route.
   */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runEmailCron(env).catch((error: unknown) => {
        console.error("[cron] email run failed", error)
      })
    )
  },
} satisfies ExportedHandler<AppBindings>
