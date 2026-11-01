import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import type { AppBindings } from "../env"
import { extractMemories, type ExtractionParams } from "../lib/memory/extract"

/**
 * The body of the memory-extraction workflow, separate from the class so tests
 * can run it without the runtime's own entrypoint machinery. Extraction calls
 * models and can fail or take a while, so it runs as a retried Workflows step
 * rather than inside the chat request.
 */
export async function runMemoryExtraction(
  env: AppBindings,
  event: { payload: ExtractionParams },
  step: Pick<WorkflowStep, "do">
): Promise<void> {
  await step.do(
    "extract memories",
    {
      retries: { limit: 2, delay: "15 seconds", backoff: "exponential" },
      timeout: "5 minutes",
    },
    async () => {
      await extractMemories(env, event.payload)
    }
  )
}

/**
 * Background memory extraction for one topic, started after each assistant
 * reply. Replaces LobeHub's hosted Upstash Workflow.
 */
export class MemoryExtractionWorkflow extends WorkflowEntrypoint<
  AppBindings,
  ExtractionParams
> {
  async run(event: WorkflowEvent<ExtractionParams>, step: WorkflowStep) {
    await runMemoryExtraction(this.env, event, step)
  }
}
