/**
 * The image-generation catalog shared by the Worker (validation, request
 * shaping) and the SPA (pickers). Carried forward from the pre-migration app;
 * every model is hosted on Workers AI.
 */
import { IMAGE_MODELS, type ImageModelId } from "./models"

export const IMAGE_STYLES = [
  "none",
  "photorealistic",
  "cartoon",
  "3d-render",
  "anime",
  "digital-art",
  "abstract",
] as const
export type ImageStyle = (typeof IMAGE_STYLES)[number]

export const ASPECT_RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "16:9",
  "21:9",
  "9:16",
] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

/**
 * How a model wants to be called. Verified per model against Workers AI in the
 * legacy app; getting it wrong is silent (a JSON POST to a multipart-only model
 * answers 200 with an empty result rather than an error):
 *
 *   json-b64     POST JSON {prompt}  -> { result: { image: <base64> } }
 *   json-binary  POST JSON {prompt}  -> raw image bytes in the response body
 *   multipart    POST multipart/form-data prompt=...  -> { result: { image } }
 */
export type ImageWireFormat = "json-b64" | "json-binary" | "multipart"

export type ImageQuality = "excellent" | "good" | "average"

export const QUALITY_LABELS: Record<ImageQuality, string> = {
  excellent: "Excellent",
  good: "Good",
  average: "Average",
}

/**
 * Picker metadata. `quality` comes from published comparisons, not our own
 * testing (FLUX.2 dev is the family's 32B top tier; the klein models trade
 * quality for speed; schnell is a 2-step draft model; Leonardo's Lucid Origin
 * and Phoenix report ~95% prompt adherence).
 */
export const IMAGE_MODEL_META: Record<
  ImageModelId,
  { quality: ImageQuality; bestFor: string; wire: ImageWireFormat }
> = {
  "flux-2-dev": {
    quality: "excellent",
    bestFor: "Highest detail: 32B, 50 steps",
    wire: "multipart",
  },
  "lucid-origin": {
    quality: "excellent",
    bestFor: "Photorealism and style range, ~95% prompt adherence",
    wire: "json-b64",
  },
  "phoenix-1.0": {
    quality: "excellent",
    bestFor: "Highest resolution (~5MP) and text rendering",
    wire: "json-binary",
  },
  "flux-2-klein-9b": {
    quality: "good",
    bestFor: "Balanced: near-FLUX.2 quality, much faster",
    wire: "multipart",
  },
  "flux-2-klein-4b": {
    quality: "good",
    bestFor: "Fastest: sub-second, some artifacts on realism",
    wire: "multipart",
  },
  "flux-1-schnell": {
    quality: "average",
    bestFor: "Quick drafts: 2 steps, lowest detail",
    wire: "json-b64",
  },
}

/** Display order for every picker: best quality first (the catalog's order). */
export const IMAGE_MODEL_IDS = IMAGE_MODELS.map((model) => model.id) as [
  ImageModelId,
  ...ImageModelId[],
]

export const STYLE_MODIFIERS: Record<ImageStyle, string> = {
  none: "",
  photorealistic:
    "photorealistic, 8k resolution, ultra high detail, sharp focus",
  cartoon: "cartoon style, bold outlines, flat colors, playful illustration",
  "3d-render": "3D render, octane render, volumetric lighting, cinematic",
  anime: "anime style, cel-shaded, vibrant, Japanese animation",
  "digital-art":
    "digital art, vibrant colors, detailed illustration, concept art",
  abstract:
    "abstract art, non-representational, expressive shapes, bold composition",
}

export const ASPECT_RATIO_DIMENSIONS: Record<
  AspectRatio,
  { width: number; height: number }
> = {
  "1:1": { width: 1024, height: 1024 },
  "3:4": { width: 768, height: 1024 },
  "4:3": { width: 1024, height: 768 },
  "16:9": { width: 1344, height: 768 },
  "21:9": { width: 1536, height: 640 },
  "9:16": { width: 768, height: 1344 },
}

export const STYLE_NAMES: Record<ImageStyle, string> = {
  none: "None",
  photorealistic: "Realistic",
  cartoon: "Cartoon",
  "3d-render": "3D Render",
  anime: "Anime",
  "digital-art": "Digital",
  abstract: "Abstract",
}

export const ASPECT_RATIO_NAMES: Record<AspectRatio, string> = {
  "1:1": "1:1 (Square)",
  "4:3": "4:3 (Standard)",
  "3:4": "3:4 (Portrait)",
  "16:9": "16:9 (Widescreen)",
  "9:16": "9:16 (Mobile)",
  "21:9": "21:9 (Ultrawide)",
}

export const MAX_PROMPT_CHARS = 2000
