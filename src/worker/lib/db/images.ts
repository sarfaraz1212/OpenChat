import type { AspectRatio, ImageStyle } from "../../../shared/images"
import { newId, now } from "./client"

/** A row of `generated_images`, kept as the legacy app created it. */
type ImageRow = {
  id: string
  user_id: string
  prompt: string
  style: string
  aspect_ratio: string
  model: string
  provider: string
  image_url: string
  width: number | null
  height: number | null
  created_at: string
}

export type GeneratedImage = {
  id: string
  prompt: string
  style: ImageStyle
  aspectRatio: AspectRatio
  model: string
  provider: string
  imageUrl: string
  width: number | null
  height: number | null
  createdAt: string
}

const toImage = (row: ImageRow): GeneratedImage => ({
  id: row.id,
  prompt: row.prompt,
  style: row.style as ImageStyle,
  aspectRatio: row.aspect_ratio as AspectRatio,
  model: row.model,
  provider: row.provider,
  imageUrl: row.image_url,
  width: row.width,
  height: row.height,
  createdAt: row.created_at,
})

/** The user's images, newest first. */
export async function listForUser(
  db: D1Database,
  userId: string
): Promise<GeneratedImage[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM generated_images WHERE user_id = ? ORDER BY created_at DESC, id DESC"
    )
    .bind(userId)
    .all<ImageRow>()
  return (results ?? []).map(toImage)
}

export async function findOwned(
  db: D1Database,
  id: string,
  userId: string
): Promise<GeneratedImage | null> {
  const row = await db
    .prepare("SELECT * FROM generated_images WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<ImageRow>()
  return row ? toImage(row) : null
}

export async function insert(
  db: D1Database,
  params: {
    userId: string
    prompt: string
    style: ImageStyle
    aspectRatio: AspectRatio
    model: string
    provider: string
    imageUrl: string
    width: number | null
    height: number | null
  }
): Promise<GeneratedImage> {
  const row: ImageRow = {
    id: newId(),
    user_id: params.userId,
    prompt: params.prompt,
    style: params.style,
    aspect_ratio: params.aspectRatio,
    model: params.model,
    provider: params.provider,
    image_url: params.imageUrl,
    width: params.width,
    height: params.height,
    created_at: now(),
  }
  await db
    .prepare(
      `INSERT INTO generated_images
         (id, user_id, prompt, style, aspect_ratio, model, provider, image_url, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.user_id,
      row.prompt,
      row.style,
      row.aspect_ratio,
      row.model,
      row.provider,
      row.image_url,
      row.width,
      row.height,
      row.created_at
    )
    .run()
  return toImage(row)
}

/** There is no row-level security on D1: the user_id predicate is the check. */
export async function deleteOwned(
  db: D1Database,
  id: string,
  userId: string
): Promise<void> {
  await db
    .prepare("DELETE FROM generated_images WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run()
}

/**
 * How many images the user made since `isoSince` (optionally by one provider),
 * for the hourly limits.
 */
export async function countSince(
  db: D1Database,
  userId: string,
  isoSince: string,
  provider: string | null = null
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM generated_images
       WHERE user_id = ? AND created_at >= ? AND (? IS NULL OR provider = ?)`
    )
    .bind(userId, isoSince, provider, provider)
    .first<{ n: number }>()
  return row?.n ?? 0
}
