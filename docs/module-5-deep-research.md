# Module 5 – Deep Research: Implementation Plan

## Overview

Deep Research is an iterative AI agent that conducts multi-step web searches, reads and extracts content from sources, deduplicates information, and synthesizes a comprehensive research report. It leverages the existing AI SDK v6 tool-calling infrastructure (`streamText` + `maxSteps`) that is already scaffolded in the codebase but currently unused.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
│                                                                  │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │ Deep Research │    │ Streaming UI     │    │ Sources Panel │  │
│  │ Input Page    │───▶│ (tool progress)  │───▶│ (citations)   │  │
│  └──────────────┘    └──────────────────┘    └───────────────┘  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ POST /api/deep-research
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Deep Research API Route                       │
│                                                                  │
│  1. Validate user & tier                                         │
│  2. Select orchestrator model (Claude/GPT with reasoning)        │
│  3. Inject tools: webSearch, readSource, synthesize              │
│  4. streamText({ maxSteps: 20-50 })                             │
│  5. onFinish → store report + sources in DB                      │
└────────────┬──────────────────────────┬─────────────────────────┘
             │                          │
             ▼                          ▼
┌────────────────────┐    ┌────────────────────────────────┐
│   webSearch Tool   │    │      readSource Tool           │
│                    │    │                                 │
│ • Tavily API       │    │ • Fetch URL content            │
│ • Serper API       │    │ • HTML → text extraction       │
│ • Brave Search     │    │ • Chunking (if large)          │
│ • Returns titles,  │    │ • Returns extracted text       │
│   URLs, snippets   │    │ • Tracks visited URLs (dedup)  │
└────────────────────┘    └────────────────────────────────┘
```

---

## Tier Gating

| Tier  | Max Steps   | Max Sources | Models Available     | Depth     |
| ----- | ----------- | ----------- | -------------------- | --------- |
| Free  | 0 (blocked) | —           | —                    | No access |
| Pro   | 10          | 100         | Claude Sonnet, GPT-5 | Standard  |
| Power | 50          | 1000+       | Claude Opus, GPT-5.4 | Deep      |

---

## File Structure

```
lib/tools/
├── web-search.ts              # webSearch tool definition
├── read-source.ts             # readSource tool definition
├── research-tools.ts          # Combined tool set factory
└── search-providers/
    ├── index.ts               # Unified search interface
    ├── tavily.ts              # Tavily Search API
    ├── serper.ts              # Serper (Google Search) API
    └── brave.ts               # Brave Search API

app/api/deep-research/
├── route.ts                   # Main streaming endpoint
├── config.ts                  # Research-specific prompts & limits
└── utils.ts                   # Source dedup, report formatting

app/(routes)/deep-research/
├── page.tsx                   # Deep Research input page
└── components/
    ├── research-input.tsx     # Topic input + tier selector
    ├── research-progress.tsx  # Streaming progress UI
    ├── research-report.tsx    # Final rendered report
    └── source-list.tsx        # Collected sources sidebar
```

---

## Implementation Steps

### Step 1: Search Provider Abstraction

**File: `lib/tools/search-providers/index.ts`**

```typescript
import { serper } from "./serper"
import { tavily } from "./tavily"

export type SearchResult = {
  title: string
  url: string
  snippet: string
  publishedDate?: string
}

export type SearchProvider = {
  search: (
    query: string,
    options?: { maxResults?: number }
  ) => Promise<SearchResult[]>
}

export function getSearchProvider(): SearchProvider {
  if (process.env.TAVILY_API_KEY) return tavily
  if (process.env.SERPER_API_KEY) return serper
  throw new Error(
    "No search provider configured. Set TAVILY_API_KEY or SERPER_API_KEY."
  )
}
```

**File: `lib/tools/search-providers/tavily.ts`**

```typescript
import type { SearchProvider, SearchResult } from "./index"

export const tavily: SearchProvider = {
  async search(
    query: string,
    options?: { maxResults?: number }
  ): Promise<SearchResult[]> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: options?.maxResults ?? 10,
        include_answer: false,
        include_raw_content: false,
      }),
    })

    if (!response.ok) {
      throw new Error(`Tavily search failed: ${response.statusText}`)
    }

    const data = await response.json()
    return data.results.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      publishedDate: r.published_date,
    }))
  },
}
```

---

### Step 2: Tool Definitions

**File: `lib/tools/web-search.ts`**

```typescript
import { tool } from "ai"
import { z } from "zod"
import { getSearchProvider, SearchResult } from "./search-providers"

export const webSearchTool = tool({
  description:
    "Search the web for information on a topic. Use this to find relevant sources, " +
    "recent information, and supporting evidence. You can call this multiple times " +
    "with different queries to gather comprehensive information.",
  parameters: z.object({
    query: z
      .string()
      .describe("The search query. Be specific and varied across calls."),
    maxResults: z
      .number()
      .min(1)
      .max(20)
      .default(10)
      .describe("Number of results to return (1-20)."),
  }),
  execute: async ({ query, maxResults }): Promise<SearchResult[]> => {
    const provider = getSearchProvider()
    const results = await provider.search(query, { maxResults })
    return results
  },
})
```

**File: `lib/tools/read-source.ts`**

```typescript
import { tool } from "ai"
import { z } from "zod"

export const readSourceTool = tool({
  description:
    "Fetch and read the full content of a web page. Use this after webSearch " +
    "to read promising sources in full. Returns extracted text content.",
  parameters: z.object({
    url: z.string().url().describe("The URL to fetch and read."),
    reason: z
      .string()
      .describe("Why you're reading this source (helps track research)."),
  }),
  execute: async ({
    url,
    reason,
  }): Promise<{ url: string; content: string; success: boolean }> => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000) // 15s timeout

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; UseAI-Research/1.0)",
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
      })
      clearTimeout(timeout)

      if (!response.ok) {
        return {
          url,
          content: `Failed to fetch: ${response.statusText}`,
          success: false,
        }
      }

      const contentType = response.headers.get("content-type") || ""
      const text = await response.text()

      let extracted: string
      if (contentType.includes("text/html")) {
        extracted = extractTextFromHTML(text)
      } else {
        extracted = text
      }

      // Limit content to ~8000 chars to avoid context overflow
      const truncated = extracted.slice(0, 8000)
      return { url, content: truncated, success: true }
    } catch (error) {
      return {
        url,
        content: `Error reading source: ${error instanceof Error ? error.message : "Unknown error"}`,
        success: false,
      }
    }
  },
})

function extractTextFromHTML(html: string): string {
  // Remove script/style/nav/header/footer tags and their content
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ")

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim()

  // Remove common boilerplate patterns
  text = text.replace(/cookie[s]? (policy|consent|notice)/gi, "")

  return text
}
```

**File: `lib/tools/research-tools.ts`**

```typescript
import { ToolSet } from "ai"
import { readSourceTool } from "./read-source"
import { webSearchTool } from "./web-search"

export type ResearchDepth = "standard" | "deep"

export function getResearchTools(): ToolSet {
  return {
    webSearch: webSearchTool,
    readSource: readSourceTool,
  }
}
```

---

### Step 3: Deep Research API Route

**File: `app/api/deep-research/config.ts`**

```typescript
export const DEEP_RESEARCH_SYSTEM_PROMPT = `You are a deep research specialist. Your job is to conduct thorough, multi-step research on a given topic.

## Research Process

1. **Plan** - Break the topic into 3-5 research angles/sub-questions
2. **Search** - Use webSearch tool with varied, specific queries for each angle
3. **Read** - Use readSource tool to read the most promising/authoritative sources
4. **Verify** - Cross-reference claims across multiple sources
5. **Synthesize** - Write a comprehensive, well-structured report

## Guidelines

- Search with DIFFERENT queries each time (vary keywords, perspectives, specificity)
- Read at least 5-10 sources before writing your report
- Prefer primary sources and authoritative domains
- Note conflicting information and present multiple perspectives
- Cite sources with [Source Title](URL) inline
- Structure your final report with clear headings and sections
- Include a "Sources" section at the end listing all referenced URLs

## Output Format

Your final response MUST be a well-structured markdown report with:
- Executive summary (2-3 sentences)
- Main findings organized by theme/angle
- Key data points and statistics (with citations)
- Conflicting viewpoints (if any)
- Conclusion
- Sources list`

export const DEEP_RESEARCH_LIMITS = {
  free: { maxSteps: 0, maxSources: 0, allowed: false },
  pro: { maxSteps: 15, maxSources: 100, allowed: true },
  power: { maxSteps: 50, maxSources: 1000, allowed: true },
} as const

export const RESEARCH_MODELS = {
  standard: "claude-sonnet-4-6", // Pro tier default
  deep: "claude-opus-4", // Power tier default
} as const
```

**File: `app/api/deep-research/route.ts`**

```typescript
import {
  incrementMessageCount,
  validateAndTrackUsage,
} from "@/app/api/chat/api"
import { createErrorResponse, extractErrorMessage } from "@/app/api/chat/utils"
import { getAllModels } from "@/lib/models"
import { getProviderForModel } from "@/lib/openproviders/provider-map"
import { createClient } from "@/lib/supabase/server"
import { getResearchTools } from "@/lib/tools/research-tools"
import type { ProviderWithoutOllama } from "@/lib/user-keys"
import { Message as MessageAISDK, streamText } from "ai"
import {
  DEEP_RESEARCH_LIMITS,
  DEEP_RESEARCH_SYSTEM_PROMPT,
  RESEARCH_MODELS,
} from "./config"

export const maxDuration = 300 // 5 minutes for deep research

type DeepResearchRequest = {
  topic: string
  chatId: string
  userId: string
  isAuthenticated: boolean
  depth: "standard" | "deep" // standard = Pro, deep = Power
  model?: string // optional model override
}

export async function POST(req: Request) {
  try {
    const {
      topic,
      chatId,
      userId,
      isAuthenticated,
      depth = "standard",
      model: requestedModel,
    } = (await req.json()) as DeepResearchRequest

    if (!topic || !chatId || !userId) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: topic, chatId, userId",
        }),
        { status: 400 }
      )
    }

    if (!isAuthenticated) {
      return new Response(
        JSON.stringify({ error: "Authentication required for Deep Research" }),
        { status: 401 }
      )
    }

    // --- Tier Gating ---
    const supabase = await createClient()
    const { data: userData } = await supabase
      .from("users")
      .select("plan")
      .eq("id", userId)
      .single()

    const userPlan = (userData?.plan ||
      "free") as keyof typeof DEEP_RESEARCH_LIMITS
    const limits = DEEP_RESEARCH_LIMITS[userPlan]

    if (!limits.allowed) {
      return new Response(
        JSON.stringify({
          error: "Deep Research requires a Pro or Power subscription",
          code: "TIER_REQUIRED",
          requiredTier: "pro",
        }),
        { status: 402 }
      )
    }

    // --- Usage Tracking ---
    const supabaseValidated = await validateAndTrackUsage({
      userId,
      model: requestedModel || RESEARCH_MODELS[depth],
      isAuthenticated,
    })

    if (supabaseValidated) {
      await incrementMessageCount({ supabase: supabaseValidated, userId })
    }

    // --- Model Selection ---
    const modelId = requestedModel || RESEARCH_MODELS[depth]
    const allModels = await getAllModels()
    const modelConfig = allModels.find((m) => m.id === modelId)

    if (!modelConfig || !modelConfig.apiSdk) {
      throw new Error(`Model ${modelId} not found or not available`)
    }

    // --- API Key ---
    let apiKey: string | undefined
    const { getEffectiveApiKey } = await import("@/lib/user-keys")
    const provider = getProviderForModel(modelId)
    apiKey =
      (await getEffectiveApiKey(userId, provider as ProviderWithoutOllama)) ||
      undefined

    // --- Log User Message ---
    if (supabaseValidated) {
      await supabaseValidated.from("messages").insert({
        chat_id: chatId,
        role: "user",
        content: `[Deep Research] ${topic}`,
        model: modelId,
      })
    }

    // --- Research Session ---
    if (supabaseValidated) {
      await supabaseValidated.from("research_sessions").insert({
        user_id: userId,
        chat_id: chatId,
        topic,
        depth,
        status: "in_progress",
      })
    }

    // --- Stream Research ---
    const tools = getResearchTools()

    const messages: MessageAISDK[] = [
      {
        role: "user",
        content: `Research the following topic thoroughly:\n\n${topic}\n\nDepth level: ${depth}. Use multiple searches and read key sources before synthesizing your report.`,
      },
    ]

    const result = streamText({
      model: modelConfig.apiSdk(apiKey),
      system: DEEP_RESEARCH_SYSTEM_PROMPT,
      messages,
      tools,
      maxSteps: limits.maxSteps,
      onError: (err: unknown) => {
        console.error("Deep research streaming error:", err)
      },
      onFinish: async ({ response }) => {
        if (supabaseValidated) {
          // Store assistant message with all parts (tools, reasoning, text)
          const { storeAssistantMessage } = await import("@/app/api/chat/api")
          await storeAssistantMessage({
            supabase: supabaseValidated,
            chatId,
            messages: response.messages as any,
            model: modelId,
          })

          // Update research session status
          await supabaseValidated
            .from("research_sessions")
            .update({ status: "completed" })
            .eq("chat_id", chatId)
            .eq("status", "in_progress")
        }
      },
    })

    return result.toDataStreamResponse({
      sendReasoning: true,
      sendSources: true,
      getErrorMessage: (error: unknown) => {
        console.error("Deep research error forwarded to client:", error)
        return extractErrorMessage(error)
      },
    })
  } catch (err: unknown) {
    console.error("Error in /api/deep-research:", err)
    const error = err as {
      code?: string
      message?: string
      statusCode?: number
    }
    return createErrorResponse(error)
  }
}
```

---

### Step 4: Database Migration

**File: `supabase/migrations/XXXXXX_add_research_sessions.sql`**

```sql
-- Research sessions table
CREATE TABLE IF NOT EXISTS research_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  sources JSONB DEFAULT '[]'::jsonb,
  depth TEXT NOT NULL DEFAULT 'standard' CHECK (depth IN ('standard', 'deep')),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Index for user's research history
CREATE INDEX idx_research_sessions_user_id ON research_sessions(user_id);
CREATE INDEX idx_research_sessions_chat_id ON research_sessions(chat_id);

-- RLS
ALTER TABLE research_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own research sessions"
  ON research_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own research sessions"
  ON research_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own research sessions"
  ON research_sessions FOR UPDATE
  USING (auth.uid() = user_id);
```

---

### Step 5: Client-Side Integration

**File: `app/(routes)/deep-research/page.tsx`**

```typescript
"use client"

import { useState } from "react"
import { useChat } from "@ai-sdk/react"
import { ResearchInput } from "./components/research-input"
import { ResearchProgress } from "./components/research-progress"
import { ResearchReport } from "./components/research-report"

export default function DeepResearchPage() {
  const [topic, setTopic] = useState("")
  const [depth, setDepth] = useState<"standard" | "deep">("standard")
  const [isResearching, setIsResearching] = useState(false)

  const { messages, status, append } = useChat({
    api: "/api/deep-research",
    body: {
      depth,
    },
    onFinish: () => {
      setIsResearching(false)
    },
    onError: (error) => {
      setIsResearching(false)
      console.error("Research error:", error)
    },
  })

  const startResearch = async () => {
    if (!topic.trim()) return
    setIsResearching(true)
    await append({
      role: "user",
      content: topic,
    })
  }

  return (
    <div className="flex h-full flex-col">
      {!isResearching && messages.length === 0 && (
        <ResearchInput
          topic={topic}
          setTopic={setTopic}
          depth={depth}
          setDepth={setDepth}
          onSubmit={startResearch}
        />
      )}

      {(isResearching || messages.length > 0) && (
        <div className="flex flex-1 gap-4 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6">
            <ResearchProgress messages={messages} status={status} />
            <ResearchReport messages={messages} />
          </div>
        </div>
      )}
    </div>
  )
}
```

**File: `app/(routes)/deep-research/components/research-progress.tsx`**

```typescript
"use client"

import type { Message } from "@ai-sdk/react"
import { Loader2, Search, FileText, CheckCircle } from "lucide-react"

type Props = {
  messages: Message[]
  status: string
}

export function ResearchProgress({ messages, status }: Props) {
  // Extract tool invocations from assistant messages
  const toolCalls = messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.parts?.filter((p) => p.type === "tool-invocation") ?? [])

  const searchCalls = toolCalls.filter(
    (t) => t.toolInvocation?.toolName === "webSearch"
  )
  const readCalls = toolCalls.filter(
    (t) => t.toolInvocation?.toolName === "readSource"
  )

  const isActive = status === "streaming"

  return (
    <div className="mb-6 space-y-3">
      {/* Progress indicators */}
      <div className="flex items-center gap-3 text-sm">
        <div className="flex items-center gap-2">
          {isActive ? (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          ) : (
            <CheckCircle className="h-4 w-4 text-green-500" />
          )}
          <span className="text-muted-foreground">
            {isActive ? "Researching..." : "Research complete"}
          </span>
        </div>
      </div>

      {/* Search queries made */}
      {searchCalls.length > 0 && (
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Search className="h-4 w-4" />
            Searches ({searchCalls.length})
          </div>
          <div className="space-y-1">
            {searchCalls.map((call, i) => (
              <div key={i} className="text-muted-foreground text-xs">
                • {call.toolInvocation?.args?.query}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sources read */}
      {readCalls.length > 0 && (
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4" />
            Sources Read ({readCalls.length})
          </div>
          <div className="space-y-1">
            {readCalls.map((call, i) => (
              <div key={i} className="text-muted-foreground truncate text-xs">
                • {call.toolInvocation?.args?.url}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

---

### Step 6: Entry Points

The Deep Research feature needs to be accessible from:

1. **Sidebar menu item** – "Deep Research" link to `/deep-research`
2. **Chat input '+' dropdown** – "Deep Research" option that navigates or opens modal
3. **In-chat trigger** – When user says "research X deeply", detect intent and offer to redirect

**Sidebar addition** (in existing layout component):

```typescript
// Add to sidebar navigation items
{ label: "Deep Research", href: "/deep-research", icon: SearchIcon }
```

**Chat input dropdown** (in existing chat-input component):

```typescript
// Add to existing '+' dropdown menu
{ label: "Deep Research", action: () => router.push("/deep-research") }
```

---

### Step 7: Environment Variables

Add to `.env.local`:

```bash
# Search Provider (pick one)
TAVILY_API_KEY=tvly-xxxxxxxxxxxxx
# OR
SERPER_API_KEY=xxxxxxxxxxxxxxxx
# OR
BRAVE_SEARCH_API_KEY=BSAxxxxxxxxxxxxxxxx
```

---

## Streaming UX Flow

```
User enters topic → clicks "Research"
       │
       ▼
┌─ Phase 1: Planning ──────────────────────────┐
│ AI outputs: "I'll research this from          │
│ 4 angles: [angle1], [angle2], ..."            │
│ UI: Shows planning text streaming             │
└───────────────────────────────────────────────┘
       │
       ▼
┌─ Phase 2: Searching ─────────────────────────┐
│ Tool call: webSearch({ query: "..." })        │
│ UI: "🔍 Searching: [query]..." badge appears  │
│ Tool result: [{ title, url, snippet }, ...]   │
│ UI: Sources count increments                  │
│                                               │
│ (Repeats 3-10 times with varied queries)      │
└───────────────────────────────────────────────┘
       │
       ▼
┌─ Phase 3: Reading ───────────────────────────┐
│ Tool call: readSource({ url: "..." })         │
│ UI: "📄 Reading: [domain]..." badge appears   │
│ Tool result: { content: "extracted text" }    │
│ UI: "Read sources" count increments           │
│                                               │
│ (Repeats 5-20 times for key sources)          │
└───────────────────────────────────────────────┘
       │
       ▼
┌─ Phase 4: Synthesis ─────────────────────────┐
│ AI streams final markdown report              │
│ UI: Report renders progressively             │
│ Inline citations: [Source](url)               │
│ Sources panel populates on right              │
└───────────────────────────────────────────────┘
       │
       ▼
┌─ Phase 5: Complete ──────────────────────────┐
│ Status: "Research complete"                   │
│ Sources panel: All referenced URLs listed     │
│ Actions: Copy report, Share, New research     │
└───────────────────────────────────────────────┘
```

---

## Key Design Decisions

### 1. Separate Route vs. Overloading `/api/chat`

**Decision:** Separate `/api/deep-research` route.

**Rationale:**

- Different `maxDuration` (300s vs 60s)
- Different system prompt (research-focused)
- Different tool set (search + read vs. empty)
- Different tier gating logic
- Different `maxSteps` (15-50 vs 10)
- Easier to maintain, test, and monitor independently

### 2. Search Provider Choice

**Decision:** Tavily as primary, with provider abstraction for swapping.

**Rationale:**

- Tavily is purpose-built for AI research (returns clean snippets)
- $0.01/search at scale, generous free tier (1000/month)
- Falls back to Serper (Google) or Brave if Tavily unavailable
- Abstraction layer means client never needs to know which provider

### 3. Content Extraction Strategy

**Decision:** Server-side fetch + HTML stripping (no headless browser).

**Rationale:**

- Fast (< 2s per page vs. 5-10s with Puppeteer)
- No infrastructure overhead
- Works for 90% of content; paywalled/JS-rendered content gracefully fails
- Can upgrade to Jina Reader API or Firecrawl later if needed

### 4. Source Deduplication

**Decision:** Model-level dedup via system prompt + URL tracking in tool results.

**Rationale:**

- AI SDK's `maxSteps` loop naturally allows the model to see previous tool results
- System prompt instructs to "not re-read URLs you've already read"
- For hard enforcement, wrap `readSource` to check a Set of visited URLs
- No need for external state management

### 5. Streaming vs. Background Job

**Decision:** Streaming (same as chat).

**Rationale:**

- User sees progress in real-time (searches happening, sources being read)
- Leverages existing `useChat` hook and streaming UI
- No need for polling, WebSocket, or job queue infrastructure
- `maxDuration: 300` gives enough time for deep research

---

## Error Handling

| Error Scenario             | Handling                                                |
| -------------------------- | ------------------------------------------------------- |
| Search provider down       | Retry once, then return partial results with error note |
| Source fetch timeout (15s) | Return `{ success: false }`, model skips that source    |
| Model rate limited         | Return 429 with retry-after header                      |
| Max steps exhausted        | Model synthesizes with whatever it has (graceful)       |
| User not on required tier  | Return 402 with upgrade prompt                          |
| Network error mid-stream   | Client reconnects, shows partial results                |

---

## Testing Strategy

### Unit Tests

- `web-search.ts` – Mock Tavily API, verify result mapping
- `read-source.ts` – Mock fetch, test HTML extraction, timeout handling
- `config.ts` – Verify tier limits are correct

### Integration Tests

- Full research flow with mocked search results
- Tier gating (free blocked, pro limited, power full access)
- Stream interruption and recovery
- Tool call deduplication in stored messages

### E2E Tests (Playwright)

- Navigate to /deep-research
- Enter topic, select depth
- Verify progress UI shows searches and sources
- Verify final report renders with citations
- Verify sources panel populates

---

## Performance Considerations

| Concern               | Mitigation                                                        |
| --------------------- | ----------------------------------------------------------------- |
| Long-running requests | `maxDuration: 300`, Vercel supports up to 900s on Pro             |
| Token cost            | Standard depth (Pro) limited to 15 steps → ~15-30K input tokens   |
| Search API costs      | Tavily: $0.01/search × 10 searches = $0.10/research               |
| Memory per request    | Content truncated to 8000 chars/source, no accumulation in memory |
| Concurrent users      | Stateless, scales horizontally with Vercel                        |

---

## Future Enhancements (Post-Launch)

1. **Citation verification** – Check if cited claims actually appear in source
2. **PDF source reading** – Extend readSource to handle PDF URLs
3. **Academic search** – Add Semantic Scholar, arXiv, PubMed as search providers
4. **Research history** – Full history page showing past research with reports
5. **Export** – Download report as PDF/Word
6. **Collaborative research** – Share research sessions with team
7. **Follow-up questions** – After report, allow Q&A on the gathered sources
8. **Source quality scoring** – Rank sources by domain authority
