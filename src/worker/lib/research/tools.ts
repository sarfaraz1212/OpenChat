import { tool } from "ai"
import { z } from "zod"
import type { AppBindings } from "../../env"
import { BUDGETS, MAX_READS, MAX_SEARCHES, type ResearchDepth } from "./config"
import { readSource } from "./read-source"
import { searchProvider } from "./search"

export type Activity =
  | { kind: "search"; query: string; results: number }
  | { kind: "read"; url: string; ok: boolean }

/**
 * The two tools of a research run: search the web, and read a page. Each run
 * gets its own counters, so the per-run ceilings hold even when a model asks
 * for many calls in one step. `onActivity` records progress as it happens.
 */
export function researchTools(
  env: AppBindings,
  params: {
    depth: ResearchDepth
    onActivity: (entry: Activity) => Promise<void>
  }
) {
  const budget = BUDGETS[params.depth]
  const search = searchProvider(env)
  let searches = 0
  let reads = 0
  const sources = new Set<string>()

  const tools = {
    webSearch: tool({
      description:
        "Search the web for information on a topic. Use this to find relevant sources, " +
        "recent information, and supporting evidence. You can call this multiple times " +
        "with different queries to gather comprehensive information.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("The search query. Be specific and varied across calls."),
        maxResults: z
          .number()
          .optional()
          .describe("Number of results to return (1-20)."),
      }),
      execute: async ({ query, maxResults }) => {
        if (!search) return { error: "Web search is not configured." }
        if (searches >= MAX_SEARCHES) {
          return {
            error: `Search limit reached (${MAX_SEARCHES}). Write the report with what you have.`,
          }
        }
        searches++
        const wanted = Math.round(maxResults ?? budget.defaultSearchResults)
        const count = Math.max(1, Math.min(budget.maxSearchResults, wanted))
        try {
          const results = await search(query, count)
          await params.onActivity({
            kind: "search",
            query,
            results: results.length,
          })
          return results
        } catch (error) {
          await params.onActivity({ kind: "search", query, results: 0 })
          return {
            error: `Search failed: ${error instanceof Error ? error.message : "unknown error"}`,
          }
        }
      },
    }),

    readSource: tool({
      description:
        "Fetch and read the full content of a web page. Use this after webSearch " +
        "to read promising sources in full. Returns extracted text content.",
      inputSchema: z.object({
        url: z.string().describe("The URL to fetch and read."),
        reason: z
          .string()
          .describe("Why you're reading this source (helps track research)."),
      }),
      execute: async ({ url }) => {
        if (reads >= MAX_READS) {
          return {
            url,
            content: `Source limit reached (${MAX_READS}). Write the report with what you have.`,
            success: false,
          }
        }
        reads++
        const result = await readSource(env, url, budget.maxSourceChars)
        if (result.success) sources.add(url)
        await params.onActivity({ kind: "read", url, ok: result.success })
        return result
      },
    }),
  }

  return { tools, sources: () => [...sources] }
}
