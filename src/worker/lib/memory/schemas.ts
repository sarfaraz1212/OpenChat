import { z } from "zod"

const decision = z.object({
  reasoning: z.string().default(""),
  shouldExtract: z.boolean(),
})

/** Which layers of the conversation are worth extracting. */
export const gatekeeperSchema = z.object({
  activity: decision,
  context: decision,
  experience: decision,
  identity: decision,
  preference: decision,
})

const fields = {
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  details: z.string().trim().max(2000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  confidence: z.number().min(0).max(1).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
}

/** What one layer extractor wants to change. */
export const layerResultSchema = z.object({
  add: z.array(z.object(fields)).default([]),
  update: z
    .array(
      z
        .object({ id: z.string().min(1) })
        .extend(z.object(fields).partial().shape)
    )
    .default([]),
  remove: z
    .array(z.object({ id: z.string().min(1), reason: z.string().default("") }))
    .default([]),
})

export type LayerResult = z.infer<typeof layerResultSchema>

export const personaSchema = z.object({
  persona: z.string().trim().max(3000),
})
