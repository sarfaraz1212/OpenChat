import type { AppBindings } from "../../env"

/**
 * Image storage in the `IMAGES` R2 bucket, under `{userId}/{uuid}.{ext}`, and
 * served only to their owner from `/api/files/images/{userId}/{uuid}.{ext}`.
 * The URL scheme matches the legacy app's, so rows written by it keep working.
 */

export type ImageBytes = { bytes: Uint8Array; contentType: string }

const URL_PREFIX = "/api/files/images/"
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

/** The image type the bytes really are, from their signature, or null. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const at = (offset: number, text: string) =>
    [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0))
  if (bytes[0] === 0x89 && at(1, "PNG")) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (at(0, "GIF8")) return "image/gif"
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp"
  return null
}

/** Only these are ever served as images; anything else stays a download. */
export const isServableImageType = (type: string | undefined): type is string =>
  type !== undefined && type in EXTENSIONS

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Base64 of the bytes, in chunks so a large image cannot overflow the call stack. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export const imageUrlFor = (key: string) => `${URL_PREFIX}${key}`

/** The R2 key behind one of our image URLs, or null for anything else. */
export function keyFromUrl(url: string): string | null {
  return url.startsWith(URL_PREFIX) ? url.slice(URL_PREFIX.length) : null
}

/** Store the bytes (which must be a real image) and return the URL for them. */
export async function storeImage(
  env: AppBindings,
  userId: string,
  image: ImageBytes
): Promise<string> {
  const contentType = sniffImageType(image.bytes)
  if (!contentType) throw new Error("The data is not a supported image")
  const key = `${userId}/${crypto.randomUUID()}.${EXTENSIONS[contentType]}`
  await env.IMAGES.put(key, image.bytes, { httpMetadata: { contentType } })
  return imageUrlFor(key)
}

/**
 * Remove the stored file behind an image URL. Only ever the user's own: a key
 * outside `{userId}/` (or a URL that is not ours, like a remote fallback) is
 * left alone.
 */
export async function deleteStoredImage(
  env: AppBindings,
  userId: string,
  url: string
): Promise<void> {
  const key = keyFromUrl(url)
  if (key?.startsWith(`${userId}/`)) await env.IMAGES.delete(key)
}
