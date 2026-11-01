import { createTRPCClient, httpBatchLink } from "@trpc/client"
import type { AppRouter } from "../worker/trpc/router"
import type { GeneratedImage } from "./chat-types"

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : undefined
}

export function csrfHeaders(): Record<string, string> {
  const token = readCookie("csrf_token")
  return token ? { "x-csrf-token": token } : {}
}

export async function ensureCsrf(): Promise<void> {
  const response = await fetch("/api/csrf", { credentials: "same-origin" })
  if (!response.ok) throw new Error("Could not initialise a secure session.")
}

export const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      headers: csrfHeaders,
    }),
  ],
})

export async function jsonRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...csrfHeaders(),
      ...init.headers,
    },
  })
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || "Request failed.")
  return body
}

/** Multipart upload for the knowledge base; the browser sets the boundary itself. */
export async function uploadFile(file: File) {
  const form = new FormData()
  form.set("file", file)
  const response = await fetch("/api/files", {
    method: "POST",
    credentials: "same-origin",
    headers: csrfHeaders(),
    body: form,
  })
  const body = (await response.json()) as {
    error?: string
    id?: string
    name?: string
    status?: string
  }
  if (!response.ok) throw new Error(body.error || "Upload failed.")
  return body
}

/** Multipart upload to a hosted image tool; the browser sets the boundary itself. */
export async function editImageFile(
  tool: "background-removal" | "enhance",
  file: File,
  scale?: "2" | "4"
): Promise<GeneratedImage> {
  const form = new FormData()
  form.set("image", file)
  if (scale) form.set("scale", scale)
  const response = await fetch(`/api/image-tools/${tool}`, {
    method: "POST",
    credentials: "same-origin",
    headers: csrfHeaders(),
    body: form,
  })
  const body = (await response.json()) as GeneratedImage & { error?: string }
  if (!response.ok) throw new Error(body.error || "Request failed.")
  return body
}
