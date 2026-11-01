# use.ai – Architecture Assessment & Implementation Approach

## Current Stack

| Layer     | Technology                                                                  | Version               |
| --------- | --------------------------------------------------------------------------- | --------------------- |
| AI SDK    | Vercel AI SDK                                                               | **v6.0.185** (latest) |
| Framework | Next.js (App Router)                                                        | Latest                |
| Auth      | Supabase Auth                                                               | v2.106                |
| DB        | Supabase (PostgreSQL)                                                       | -                     |
| State     | Zustand + IndexedDB + TanStack Query                                        | -                     |
| Providers | 8 (OpenAI, Anthropic, Google, Mistral, Perplexity, XAI, OpenRouter, Ollama) | -                     |

## Key Finding: No Major Architectural Changes Needed for AI

The codebase is already on AI SDK v6 with a well-abstracted provider layer. The earlier concern about a v4→v6 migration is **already resolved; this repo is on v6**.

---

## Module-by-Module Approach

### Module 1 – Setup, Rebrand & Reskin (No AI changes)

Pure UI/config work. No architectural impact.

---

### Module 2 – Landing Page & Marketing Site

Static pages, no AI involvement.

---

### Module 3 – Stripe Billing (Schema Extension Only)

**What to add:**

- New columns on `users` table: `plan`, `stripe_customer_id`, `subscription_id`, `trial_ends_at`, `subscription_status`
- New API routes: `/api/billing/checkout`, `/api/billing/webhook`, `/api/billing/portal`
- RLS policies on billing columns

**Architecture impact:** None. Extends existing schema, does not touch AI layer.

---

### Module 4 – Paywall & Tier Gating

**Approach:** Modify the existing rate-limiting system in `lib/usage.ts`:

```
Current:  FREE_MODELS → 1000/day | PRO_MODELS → 500/day
Needed:   Free tier → 5/day | Pro tier → X/day | Power tier → 10X/day
```

**Changes required:**

1. `checkUsageByModel()` in `lib/usage.ts` → add tier-aware logic reading `users.plan`
2. `lib/config.ts` → add tier-specific limits and model access lists
3. Chat route → return `402` when tier blocks a model (already returns errors gracefully)

**Architecture impact:** Minimal. The rate-limiting hooks into `validateAndTrackUsage()` which is already called before streaming. Just add plan awareness.

---

### Module 5 – Deep Research (NEW – Biggest AI Addition)

**This is the only module requiring new AI architecture.**

#### Recommended Approach: Tool-based Agent Loop

The chat route already has:

- `tools: {} as ToolSet` (empty, ready to populate)
- `maxSteps: 10` (supports multi-step agentic loops)
- Tool invocation UI rendering (built but unused)

**Implementation:**

1. **Create `lib/tools/web-search.ts`** – Define a `webSearch` tool using AI SDK's `tool()` helper
2. **Create `lib/tools/read-source.ts`** – Tool to fetch and extract content from URLs
3. **Create `app/api/deep-research/route.ts`** – New route that:
   - Uses `streamText()` with research-specific system prompt
   - Injects `webSearch` + `readSource` tools
   - Sets `maxSteps: 20-50` for iterative search loops
   - Tier-gates depth (Pro = 5 iterations, Power = 20+ iterations / 1000+ sources)
4. **Source dedup** – Track visited URLs in tool state across steps

**Why this works without architecture changes:**

- AI SDK v6's `maxSteps` already supports iterative tool-calling loops
- The tool invocation UI already renders tool calls/results
- Streaming with `sendSources: true` already works
- Just populate the `tools` object and create a dedicated route

---

### Module 6 – Image Generation (NEW Route + Provider)

**Approach:**

1. **Create `lib/image-providers/`** – Abstraction layer similar to `lib/openproviders/`:

   ```
   lib/image-providers/
   ├── index.ts          (unified generateImage function)
   ├── types.ts          (ImageGenRequest, ImageGenResponse)
   ├── flux.ts           (Black Forest Labs FLUX.2)
   ├── nano-banana.ts    (Nano Banana / NB2 / NB Pro)
   └── seedream.ts       (ByteDance Seedream 4.5)
   ```

2. **Create `app/api/images/generate/route.ts`** – Image generation endpoint:
   - Accepts: prompt, model, style, aspect_ratio
   - Returns: image URL (stored in Supabase Storage)
   - Tier-gated: Pro gets standard models, Power gets all

3. **Create `app/api/images/route.ts`** – Gallery CRUD (list user's generated images)

4. **Schema extension:**
   - New table: `generated_images` (id, user_id, prompt, model, style, aspect_ratio, image_url, created_at)

5. **In-chat generation** – Add an `imageGeneration` tool to the chat route's `tools` object:
   ```typescript
   tools: {
     generateImage: tool({
       description: "Generate an image based on user's description",
       parameters: z.object({
         prompt: z.string(),
         style: z.string().optional(),
       }),
       execute: async ({ prompt, style }) => {
         /* call image provider */
       },
     })
   }
   ```

**Architecture impact:** New provider layer (parallel to text providers). Does NOT modify existing chat architecture.

---

### Module 7 – Apps (Background Removal, Image Enhancer)

**Approach:** Standalone API routes calling external providers (Replicate, remove.bg). No AI SDK involvement.

```
app/api/apps/
├── background-removal/route.ts
├── image-enhancer/route.ts
```

These are simple request-response endpoints, not streaming. No architecture changes needed.

---

### Module 8 – Multimodal (PDF, Voice)

**PDF Analysis:** Already supported. OpenChat handles PDF uploads via `lib/file-handling.ts` and passes them as attachments. Vision models can read them. For text extraction/chunking, add a utility in `lib/file-handling.ts` using `pdf-parse`.

**Voice Input:** Client-side only. Use Web Speech API or Whisper:

- Add mic button component (UI only)
- For Whisper: `app/api/transcribe/route.ts` calling OpenAI's Whisper API
- No streaming architecture impact

---

## Architecture Change Summary

| Area                 | Change Needed?                | Why                                                  |
| -------------------- | ----------------------------- | ---------------------------------------------------- |
| AI SDK version       | **No**                        | Already on v6                                        |
| Provider abstraction | **No**                        | Well-designed, extensible                            |
| Streaming            | **No**                        | `streamText()` + `toDataStreamResponse()` is correct |
| Tool calling         | **Populate, not restructure** | Framework exists, just add tool definitions          |
| Rate limiting        | **Extend, not replace**       | Add plan/tier awareness to existing hooks            |
| Database schema      | **Add tables/columns**        | Billing, generated_images, deep_research_sessions    |
| Image generation     | **New parallel layer**        | Doesn't touch text chat architecture                 |
| MCP                  | **Already coded**             | Wire into chat route if needed                       |

---

## Critical Architecture Decisions

1. **Deep Research should be a separate route** (`/api/deep-research`) rather than overloading `/api/chat`. Different system prompts, different tool sets, different step limits, different billing.

2. **Image generation is NOT a chat model** – it's a tool or standalone endpoint. Don't try to route it through `streamText()`. Use AI SDK's `generateImage()` or direct REST calls to providers.

3. **Tier gating should live in a middleware/utility**, not be repeated in every route. Create `lib/server/tier-gate.ts` that reads `users.plan` and returns allowed features/models/limits.

4. **Keep the empty `tools` object as the extension point** – populate it conditionally based on model capabilities and user tier.

---

## Existing Infrastructure Ready for Use

| Feature                       | Status                     | Location                                  |
| ----------------------------- | -------------------------- | ----------------------------------------- |
| Tool invocation UI            | Built, unused              | `app/components/chat/tool-invocation.tsx` |
| MCP client loaders            | Coded, not wired           | `lib/mcp/`                                |
| File upload + validation      | Production-ready           | `lib/file-handling.ts`                    |
| Web search toggle             | Working (Perplexity, Grok) | Chat input + provider SDK                 |
| Reasoning/thinking display    | Working                    | `app/components/chat/reasoning.tsx`       |
| Source citations UI           | Working                    | Message parts rendering                   |
| IndexedDB offline cache       | Working                    | `lib/chat-store/persist.ts`               |
| BYOK encryption (AES-256-GCM) | Working                    | `lib/encryption.ts`                       |

---

## New Files/Directories to Create

```
app/api/billing/
├── checkout/route.ts
├── webhook/route.ts
└── portal/route.ts

app/api/deep-research/route.ts

app/api/images/
├── generate/route.ts
└── route.ts (gallery CRUD)

app/api/apps/
├── background-removal/route.ts
└── image-enhancer/route.ts

app/api/transcribe/route.ts

lib/tools/
├── web-search.ts
├── read-source.ts
└── image-generation.ts

lib/image-providers/
├── index.ts
├── types.ts
├── flux.ts
├── nano-banana.ts
└── seedream.ts

lib/server/tier-gate.ts
```

---

## Database Migrations Needed

```sql
-- Billing columns on users table
ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free';
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN subscription_id TEXT;
ALTER TABLE users ADD COLUMN subscription_status TEXT;
ALTER TABLE users ADD COLUMN trial_ends_at TIMESTAMPTZ;

-- Generated images table
CREATE TABLE generated_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  style TEXT,
  aspect_ratio TEXT,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Deep research sessions (optional, for history)
CREATE TABLE research_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  sources JSONB DEFAULT '[]',
  depth TEXT DEFAULT 'standard',
  status TEXT DEFAULT 'in_progress',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Conclusion

The OpenChat codebase is architecturally sound for all planned use.ai features. The AI SDK v6 + provider abstraction + tool rendering infrastructure means all 8 modules can be implemented **without restructuring the core**. The main work is:

- **New routes** (billing, deep-research, image-gen, apps, transcribe)
- **New tables** (billing fields, generated_images, research_sessions)
- **Populated tools** (web search, image generation for in-chat use)
- **Tier-aware rate limiting** (extend existing `checkUsageByModel`)

No breaking migration, no SDK version conflicts, no architecture overhaul required.
