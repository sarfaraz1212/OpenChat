/** One tool call and what it returned, kept on the reply for the UI. */
export type ToolRun = { name: string; input: unknown; output: unknown }

/** Stored outputs are already capped by the tools; this bounds the record. */
const MAX_STORED_OUTPUT = 4000

function bounded(output: unknown): unknown {
  const text = JSON.stringify(output) ?? ""
  return text.length > MAX_STORED_OUTPUT
    ? { truncated: true, preview: text.slice(0, MAX_STORED_OUTPUT) }
    : output
}

/** The tool runs of a multi-step generation, in order. */
export function toolRuns(
  steps: ReadonlyArray<{
    toolResults: ReadonlyArray<{
      toolName: string
      input: unknown
      output: unknown
    }>
  }>
): ToolRun[] {
  return steps.flatMap((step) =>
    step.toolResults.map((result) => ({
      name: result.toolName,
      input: result.input,
      output: bounded(result.output),
    }))
  )
}
