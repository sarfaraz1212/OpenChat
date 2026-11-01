import type { AppBindings } from "../../env"

/**
 * Start (or wake) the background run that advances a goal. On Workers this is a
 * Cloudflare Workflow instance, replacing the QStash-backed scheduler upstream
 * (which itself has an in-process `local.ts` fallback; the durable Workflows
 * loop plays both roles). Waking a goal that is already being advanced is
 * harmless: only one tick holds the goal's lease.
 */
export async function scheduleGoal(
  env: AppBindings,
  goalId: string
): Promise<void> {
  if (!env.GOAL_WORKFLOW) {
    throw new Error("The GOAL_WORKFLOW binding is not configured")
  }
  await env.GOAL_WORKFLOW.create({ params: { goalId } })
}
