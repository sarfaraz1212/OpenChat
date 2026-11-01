import type { AppBindings } from "../../env"

export type SearchResult = {
  title: string
  url: string
  snippet: string
  publishedDate?: string
}

export type Search = (
  query: string,
  maxResults: number
) => Promise<SearchResult[]>

const TIMEOUT_MS = 15_000
const MAX_SNIPPET_CHARS = 600

const clip = (text: unknown) => String(text ?? "").slice(0, MAX_SNIPPET_CHARS)

async function post(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  name: string
): Promise<any> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`${name} search failed: ${response.status}`)
  }
  return response.json()
}

const tavily =
  (fetcher: typeof fetch, key: string): Search =>
  async (query, maxResults) => {
    const data = await post(
      fetcher,
      "https://api.tavily.com/search",
      { Authorization: `Bearer ${key}` },
      {
        query,
        // "basic" is much faster than "advanced" and is enough for a run's queries.
        search_depth: "basic",
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
      },
      "Tavily"
    )
    return (data.results ?? []).map(
      (r: {
        title: string
        url: string
        content: string
        published_date?: string
      }) => ({
        title: r.title,
        url: r.url,
        snippet: clip(r.content),
        publishedDate: r.published_date,
      })
    )
  }

const serper =
  (fetcher: typeof fetch, key: string): Search =>
  async (query, maxResults) => {
    const data = await post(
      fetcher,
      "https://google.serper.dev/search",
      { "X-API-KEY": key },
      { q: query, num: maxResults },
      "Serper"
    )
    return (data.organic ?? []).map(
      (r: { title: string; link: string; snippet: string; date?: string }) => ({
        title: r.title,
        url: r.link,
        snippet: clip(r.snippet),
        publishedDate: r.date,
      })
    )
  }

const perplexity =
  (fetcher: typeof fetch, key: string): Search =>
  async (query, maxResults) => {
    const data = await post(
      fetcher,
      "https://api.perplexity.ai/chat/completions",
      { Authorization: `Bearer ${key}` },
      {
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You are a search assistant. Return search results as JSON array with objects containing: title, url, snippet. Return ONLY valid JSON, no other text.",
          },
          {
            role: "user",
            content: `Search for: ${query}. Return up to ${maxResults} results.`,
          },
        ],
        return_citations: true,
      },
      "Perplexity"
    )
    const content: string = data.choices?.[0]?.message?.content || ""
    const citations: string[] = data.citations || []
    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        return parsed
          .slice(0, maxResults)
          .map((r: { title?: string; url?: string; snippet?: string }) => ({
            title: r.title || "",
            url: r.url || "",
            snippet: clip(r.snippet),
          }))
      }
    } catch {
      // Not JSON: fall back to the citations.
    }
    return citations.slice(0, maxResults).map((url, i) => ({
      title: `Source ${i + 1}`,
      url,
      snippet: clip(content),
    }))
  }

/**
 * The configured search provider, or null. Whichever key is set is used, in the
 * legacy priority order: Tavily, Perplexity, Serper.
 */
export function searchProvider(env: AppBindings): Search | null {
  const fetcher = env.OUTBOUND_FETCH ?? fetch
  if (env.TAVILY_API_KEY) return tavily(fetcher, env.TAVILY_API_KEY)
  if (env.PERPLEXITY_API_KEY) return perplexity(fetcher, env.PERPLEXITY_API_KEY)
  if (env.SERPER_API_KEY) return serper(fetcher, env.SERPER_API_KEY)
  return null
}
