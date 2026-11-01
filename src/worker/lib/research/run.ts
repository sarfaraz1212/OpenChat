import { generateText, stepCountIs } from "ai"
import type { ChatModelId } from "../../../shared/models"
import type { AppBindings } from "../../env"
import { openproviders } from "../ai/openproviders"
import * as research from "../db/research"
import {
  BUDGETS,
  EMPTY_REPORT_NOTE,
  SYSTEM_PROMPT,
  TRUNCATED_NOTE,
  userPrompt,
} from "./config"
import { researchTools } from "./tools"

/** A report shorter than this is treated as no report at all. */
const MIN_REPORT_CHARS = 50

const describe = (error: unknown) =>
  (error instanceof Error ? error.message : "Unknown error").slice(0, 500)

/**
 * Run one research session to the end: the model searches and reads through its
 * tools, then writes the report. Every outcome, including failure, is written
 * to the session, and nothing is thrown, so a workflow retry never repeats a
 * run that already finished (a session that is not in progress is skipped).
 */
export async function runResearch(
  env: AppBindings,
  sessionId: string
): Promise<void> {
  const db = env.DB
  const session = await research.find(db, sessionId)
  if (!session || session.status !== "in_progress") return

  // A retried run starts over, so its log describes one attempt.
  await research.resetActivity(db, sessionId)
  const budget = BUDGETS[session.depth]
  try {
    const run = researchTools(env, {
      depth: session.depth,
      onActivity: (entry) => research.appendActivity(db, sessionId, entry),
    })
    const { text, steps, finishReason } = await generateText({
      model: openproviders(session.model as ChatModelId, env),
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userPrompt(session.topic, session.depth) },
      ],
      tools: run.tools,
      stopWhen: stepCountIs(budget.maxSteps),
      // A guardrail against a runaway report, not a target.
      maxOutputTokens: budget.maxOutputTokens,
      maxRetries: 1,
    })

    // The final step's `text` is only the last step's; a model that wrote part
    // of its report in an earlier step would lose it, so keep the longest.
    const stepTexts = steps.map((step) => step.text).filter(Boolean)
    const joined = stepTexts.join("\n\n").trim()
    const report = joined.length > text.trim().length ? joined : text.trim()

    const empty = report.length < MIN_REPORT_CHARS
    const cutOff = finishReason === "length"
    await research.finish(db, sessionId, {
      status: empty || cutOff ? "failed" : "completed",
      report: empty
        ? EMPTY_REPORT_NOTE
        : cutOff
          ? `${report}\n\n${TRUNCATED_NOTE}`
          : report,
      sources: run.sources(),
    })
  } catch (error) {
    await research.finish(db, sessionId, {
      status: "failed",
      report: describe(error),
    })
  }
}
