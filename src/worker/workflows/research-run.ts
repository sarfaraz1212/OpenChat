import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import type { AppBindings } from "../env"
import { runResearch } from "../lib/research/run"

export type ResearchRunParams = { sessionId: string }

/**
 * The body of the research workflow, separate from the class so tests can run
 * it directly. One durable step: the run records its own progress and turns
 * every failure into a failed session, so a retry only ever resumes a run that
 * was cut off, never repeats one that finished.
 */
export async function runResearchWorkflow(
  env: AppBindings,
  event: { payload: ResearchRunParams },
  step: Pick<WorkflowStep, "do">
): Promise<void> {
  await step.do(
    "research",
    { retries: { limit: 1, delay: "10 seconds" }, timeout: "15 minutes" },
    async () => runResearch(env, event.payload.sessionId)
  )
}

export class ResearchRunWorkflow extends WorkflowEntrypoint<
  AppBindings,
  ResearchRunParams
> {
  async run(event: WorkflowEvent<ResearchRunParams>, step: WorkflowStep) {
    await runResearchWorkflow(this.env, event, step)
  }
}
