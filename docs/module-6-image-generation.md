# Module 6 – Image Generation: Implementation Plan

## Overview

Image Generation is a multi-provider AI image creation tool that supports 7 models across 3 providers. Users can generate images from text prompts with configurable styles, aspect ratios, and model selection. Generated images are persisted per-user and accessible via a gallery on the Images page and sidebar.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
│                                                                  │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │ Images Page   │    │ Generation Form  │    │  My Gallery   │  │
│  │ /images       │───▶│ (prompt+options) │───▶│ (grid view)   │  │
│  └──────────────┘    └──────────────────┘    └───────────────┘  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ POST /api/images/generate
                                  │ GET  /api/images
                                  │ DELETE /api/images/[id]
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Image Generation API                          │
│                                                                  │
│  1. Validate user & rate-limit                                   │
│  2. Select provider based on model                               │
│  3. Call provider API with prompt + options                       │
│  4. Store result (URL/base64) in Supabase Storage + DB           │
│  5. Return image metadata to client                              │
└────────────┬──────────────────────┬──────────────┬──────────────┘
             │                      │              │
             ▼                      ▼              ▼
┌────────────────────┐  ┌──────────────────┐  ┌───────────────────┐
│ Black Forest Labs  │  │    ByteDance     │  │   Nano Banana     │
│                    │  │                  │  │                    │
│ • FLUX.2 Pro       │  │ • Seedream 4.5   │  │ • Nano Banana      │
│ • FLUX.2 Flex      │  │                  │  │ • NB2              │
│ • FLUX.2 Max       │  │                  │  │ • NB Pro           │
└────────────────────┘  └──────────────────┘  └───────────────────┘
```

---

## Models & Providers

| Model        | Provider          | API Endpoint                                   | Strengths              |
| ------------ | ----------------- | ---------------------------------------------- | ---------------------- |
| Nano Banana  | Nano Banana       | `https://api.nanobanana.ai/v1/generate`        | Fast, lightweight      |
| NB2          | Nano Banana       | `https://api.nanobanana.ai/v1/generate`        | Balanced quality/speed |
| NB Pro       | Nano Banana       | `https://api.nanobanana.ai/v1/generate`        | High quality           |
| Seedream 4.5 | ByteDance         | `https://api.bytedance.com/v1/images/generate` | Artistic, creative     |
| FLUX.2 Pro   | Black Forest Labs | `https://api.bfl.ml/v1/flux-pro`               | Professional quality   |
| FLUX.2 Flex  | Black Forest Labs | `https://api.bfl.ml/v1/flux-flex`              | Fast, flexible         |
| FLUX.2 Max   | Black Forest Labs | `https://api.bfl.ml/v1/flux-max`               | Maximum quality        |

---

## Style Options (7)

| Style          | Description                  | Prompt Modifier                                  |
| -------------- | ---------------------------- | ------------------------------------------------ |
| None           | Raw prompt, no modification  | —                                                |
| Photorealistic | Ultra-realistic photography  | "photorealistic, 8k, high detail"                |
| Digital Art    | Modern digital illustration  | "digital art, vibrant colors, detailed"          |
| Oil Painting   | Classical oil painting style | "oil painting, textured brushstrokes, classical" |
| Watercolor     | Soft watercolor illustration | "watercolor painting, soft edges, artistic"      |
| 3D Render      | 3D CGI rendering             | "3D render, octane render, volumetric lighting"  |
| Anime          | Japanese anime style         | "anime style, cel-shaded, vibrant"               |

---

## Aspect Ratios (6)

| Label     | Ratio | Dimensions (approx) |
| --------- | ----- | ------------------- |
| Square    | 1:1   | 1024×1024           |
| Portrait  | 3:4   | 768×1024            |
| Landscape | 4:3   | 1024×768            |
| Wide      | 16:9  | 1344×768            |
| Ultrawide | 21:9  | 1536×640            |
| Tall      | 9:16  | 768×1344            |

---

## File Structure

```
lib/image-providers/
├── index.ts                   # Unified provider interface & factory
├── types.ts                   # Shared types (ImageGenerationRequest, etc.)
├── black-forest-labs.ts       # FLUX.2 Pro/Flex/Max provider
├── bytedance.ts               # Seedream 4.5 provider
└── nano-banana.ts             # Nano Banana / NB2 / NB Pro provider

app/api/images/
├── route.ts                   # GET (list user images), POST not used here
├── generate/
│   └── route.ts               # POST - Generate image endpoint
└── [id]/
    └── route.ts               # DELETE - Remove image from gallery

app/images/
├── page.tsx                   # Images page (generation form + gallery)
└── components/
    ├── image-generation-form.tsx   # Prompt input + style/ratio/model selectors
    ├── style-selector.tsx          # 7 style options grid
    ├── aspect-ratio-selector.tsx   # 6 ratio options
    ├── model-selector.tsx          # 7 model dropdown
    ├── image-gallery.tsx           # Grid gallery of generated images
    └── image-card.tsx              # Individual image card with actions

supabase/migrations/
└── 20260525000000_add_generated_images.sql  # Images table
```

---

## Database Schema

### Table: `generated_images`

```sql
CREATE TABLE public.generated_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT 'none',
  aspect_ratio TEXT NOT NULL DEFAULT '1:1',
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  image_url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: Users can only access their own images
ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own images"
  ON public.generated_images FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own images"
  ON public.generated_images FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own images"
  ON public.generated_images FOR DELETE
  USING (auth.uid() = user_id);

-- Index for fast user gallery queries
CREATE INDEX idx_generated_images_user_id ON public.generated_images(user_id, created_at DESC);
```

---

## Implementation Steps

### Step 1: Image Provider Abstraction

**File: `lib/image-providers/types.ts`**

```typescript
export type ImageStyle =
  | "none"
  | "photorealistic"
  | "digital-art"
  | "oil-painting"
  | "watercolor"
  | "3d-render"
  | "anime"

export type AspectRatio = "1:1" | "3:4" | "4:3" | "16:9" | "21:9" | "9:16"

export type ImageModel =
  | "nano-banana"
  | "nb2"
  | "nb-pro"
  | "seedream-4.5"
  | "flux2-pro"
  | "flux2-flex"
  | "flux2-max"

export type ImageProvider = "black-forest-labs" | "bytedance" | "nano-banana"

export interface ImageGenerationRequest {
  prompt: string
  style: ImageStyle
  aspectRatio: AspectRatio
  model: ImageModel
  userId: string
}

export interface ImageGenerationResult {
  imageUrl: string
  width: number
  height: number
  model: ImageModel
  provider: ImageProvider
}

export interface ImageProviderAdapter {
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>
  supportedModels: ImageModel[]
}
```

### Step 2: Provider Implementations

Each provider implements the `ImageProviderAdapter` interface with:

- API key validation
- Request transformation to provider-specific format
- Response parsing and URL extraction
- Error handling with descriptive messages
- Timeout protection (30s)

### Step 3: API Routes

- `POST /api/images/generate` — Validates auth, rate-limits, calls provider, stores in DB
- `GET /api/images` — Returns paginated user gallery
- `DELETE /api/images/[id]` — Soft-deletes image from gallery

### Step 4: Frontend Components

- Generation form with animated transitions
- Real-time generation status indicator
- Responsive gallery grid (masonry-like)
- Image lightbox with download option
- Voice input via Web Speech API

---

## Security Considerations

1. **Authentication Required**: All image endpoints require authenticated user
2. **Rate Limiting**: Max 10 generations per hour (free), 50 (pro), 200 (power)
3. **Input Sanitization**: Prompts are sanitized via DOMPurify before processing
4. **Content Policy**: Prompts are checked against a blocklist for harmful content
5. **Row-Level Security**: Supabase RLS ensures users can only access their own images
6. **API Key Security**: Provider API keys stored server-side only, never exposed to client
7. **CSRF Protection**: All mutating endpoints validate CSRF tokens
8. **File Size Limits**: Generated images capped at 10MB storage per image

---

## Error Handling & Fallback

```
Provider Request Failed?
├── Retry once with exponential backoff (1s delay)
├── If still failed → try fallback provider (if available)
│   ├── FLUX.2 Pro fails → try FLUX.2 Flex
│   ├── NB Pro fails → try NB2
│   └── Seedream fails → try FLUX.2 Flex
└── If all fail → return user-friendly error with retry option
```

---

## Rate Limits

| Tier  | Generations/Hour | Max Resolution | Models Available              |
| ----- | ---------------- | -------------- | ----------------------------- |
| Free  | 5                | 1024×1024      | Nano Banana, NB2, FLUX.2 Flex |
| Pro   | 50               | 1536×1536      | All models                    |
| Power | 200              | 2048×2048      | All models + priority queue   |
