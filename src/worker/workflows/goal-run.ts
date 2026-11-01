import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import type { AppBindings } from "../env"
import { advanceGoal } from "../lib/goals/advance"
import { scheduleGoal } from "../lib/goals/scheduler"

export type GoalRunParams = { goalId: string }

/** Ticks one run may take before it hands over to a fresh instance. */
const MAX_TICKS_PER_RUN = 200

/**
 * The body of the goal-run workflow, separate from the class so tests can run
 * it directly: tick until the goal has nothing more to do (finished, paused
 * for a person, or stopped). Each tick is a retried, durable Workflows step.
 */
export async function runGoalWorkflow(
  env: AppBindings,
  event: { payload: GoalRunParams },
  step: Pick<WorkflowStep, "do">
): Promise<void> {
  const { goalId } = event.payload
  for (let i = 0; i < MAX_TICKS_PER_RUN; i++) {
    const outcome = await step.do(
      `tick ${i}`,
      {
        retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
        timeout: "10 minutes",
      },
      async () => advanceGoal(env, goalId)
    )
    if (!outcome.continue) return
  }
  // A very long goal continues in a new run rather than growing one instance.
  await step.do("continue in a new run", async () => {
    await scheduleGoal(env, goalId)
  })
}

export class GoalRunWorkflow extends WorkflowEntrypoint<
  AppBindings,
  GoalRunParams
> {
  async run(event: WorkflowEvent<GoalRunParams>, step: WorkflowStep) {
    await runGoalWorkflow(this.env, event, step)
  }
}
