export const RESEARCH_DEPTHS = ["standard", "deep"] as const
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number]

export const MAX_TOPIC_CHARS = 4000

/** Runs cost searches and long model calls, so they are capped (legacy had no cap). */
export const HOURLY_RUN_LIMIT = 10

/** A run that has not finished this long after it started is reported as failed. */
export const STALE_AFTER_MS = 30 * 60 * 1000

/** Hard ceilings per run, whatever the step budget. */
export const MAX_SEARCHES = 4
export const MAX_READS = 4

export const BUDGETS = {
  standard: {
    maxSteps: 12,
    maxOutputTokens: 12000,
    targetPages: 10,
    targetWords: "4,000-5,000",
    defaultSearchResults: 4,
    maxSearchResults: 5,
    maxSourceChars: 3200,
  },
  deep: {
    maxSteps: 20,
    maxOutputTokens: 16000,
    targetPages: 15,
    targetWords: "6,000-7,500",
    defaultSearchResults: 5,
    maxSearchResults: 6,
    maxSourceChars: 4200,
  },
} as const

/** Both stream structured tool calls cleanly; a model that leaks calls as text cannot drive the loop. */
export const RESEARCH_MODELS = {
  standard: "@cf/openai/gpt-oss-20b",
  deep: "@cf/openai/gpt-oss-120b",
} as const

export const SYSTEM_PROMPT = `You are a deep research specialist. Your job is to conduct thorough, multi-step research on a given topic.

## Research Process

1. **Plan** - Break the topic into 3-5 research angles/sub-questions
2. **Search** - Use webSearch tool with varied, specific queries for each angle
3. **Read** - Use readSource tool to read the most promising/authoritative sources
4. **Verify** - Cross-reference claims across multiple sources
5. **Synthesize** - Write a comprehensive, well-structured report

## Guidelines

- Search with DIFFERENT queries each time (vary keywords, perspectives, specificity)
- Read 3-6 strong sources before writing your report; prefer quality over volume
- Keep searches focused and avoid reading duplicate or marginal sources
- Prefer primary sources and authoritative domains
- Note conflicting information and present multiple perspectives
- Cite sources with [Source Title](URL) inline
- Structure your final report with clear headings and sections
- Include a "Sources" section at the end listing all referenced URLs
- Write a substantial long-form report that matches the requested page and word-count target.
- Use detailed subsections, evidence, examples, implications, and caveats instead of brief summaries.
- Never leave a heading, sentence, conclusion, or sources list unfinished.
- Do NOT re-read URLs you have already read
- **Budget your steps.** You have a fixed step budget for the whole run. The FINAL step must be the written report. Treat your tool-call budget as roughly 70% of total steps: once you have used that many tool calls (webSearch + readSource combined), STOP calling tools and write the report with what you have. Never call a tool on what would be your last available step.
- **Hard tool-call ceilings.** Do not exceed ${MAX_SEARCHES} webSearch calls or ${MAX_READS} readSource calls in a single run, regardless of total step budget.
- **Never end the run without a report.** Your final assistant turn MUST contain the markdown report text, not just tool calls or reasoning.

## Output Format

Your final response MUST be a well-structured markdown report with:
- Executive summary (2-3 sentences)
- Main findings organized by theme/angle
- Key data points and statistics (with citations)
- Conflicting viewpoints (if any)
- Conclusion
- Sources list`

export function userPrompt(topic: string, depth: ResearchDepth): string {
  const budget = BUDGETS[depth]
  return `Research the following topic thoroughly:\n\n${topic}\n\nDepth level: ${depth}. Target report length: about ${budget.targetPages} pages (${budget.targetWords} words). Read the strongest sources first, then write a detailed long-form markdown report with substantial sections, examples, evidence, analysis, and caveats. The final report must be complete within the available output budget; if needed, slightly compress lower-priority details instead of leaving the conclusion or sources unfinished.`
}

export const EMPTY_REPORT_NOTE =
  "_The model finished without producing a report — it spent its step budget on searches and reading. Please try Deep mode for a bigger budget, narrow the topic, or switch to a different model._"

export const TRUNCATED_NOTE =
  "> Note: This report stopped early because the model reached its output limit. Please run Deep mode or narrow the topic for a complete report."

export const STALE_NOTE = "This run did not finish. Please start it again."
