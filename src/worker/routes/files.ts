import { Hono } from "hono"
import type { AppEnv } from "../env"
import { getCurrentUser } from "../lib/auth/session"
import * as files from "../lib/db/files"
import { readCappedFormData } from "../lib/http"
import { isServableImageType } from "../lib/images/storage"
import { MAX_FILE_BYTES } from "../lib/rag/extract"
import { uploadFile } from "../lib/rag/knowledge"

/** Slack for the multipart envelope around a file of MAX_FILE_BYTES. */
const MULTIPART_OVERHEAD = 64 * 1024

export const filesRoute = new Hono<AppEnv>()
  // Multipart upload: `file` (required). Processed inline; see lib/rag/knowledge.
  .post("/", async (c) => {
    const user = await getCurrentUser(c)
    if (!user) {
      return c.json({ error: "Sign in required", code: "UNAUTHORIZED" }, 401)
    }
    const body = await readCappedFormData(
      c.req.raw,
      MAX_FILE_BYTES + MULTIPART_OVERHEAD
    )
    if (!body.ok && body.reason === "too-large") {
      return c.json(
        { error: "Files can be at most 1 MB.", code: "FILE_TOO_LARGE" },
        413
      )
    }
    const upload: unknown = body.ok ? body.form.get("file") : null
    if (!(upload instanceof File)) {
      return c.json(
        { error: "Attach a file in the `file` field", code: "INVALID_INPUT" },
        400
      )
    }

    const result = await uploadFile(c.env, user.id, upload)
    if (!result.ok) {
      return c.json({ error: result.error, code: result.code }, result.status)
    }
    return c.json(result.file, 201)
  })

  // The original bytes, for the owner only. Served as a download so uploaded
  // HTML can never run on the app's origin.
  .get("/:id/content", async (c) => {
    const user = await getCurrentUser(c)
    if (!user) {
      return c.json({ error: "Sign in required", code: "UNAUTHORIZED" }, 401)
    }
    const file = await files.findOwned(c.env.DB, c.req.param("id"), user.id)
    const object = file && (await c.env.FILES.get(file.r2_key))
    if (!file || !object) {
      return c.json({ error: "File not found", code: "NOT_FOUND" }, 404)
    }
    return new Response(object.body, {
      headers: {
        "content-type": file.file_type,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "x-content-type-options": "nosniff",
      },
    })
  })

  // A generated or edited image, for its owner only: the first path segment is
  // the owner's id (the same URLs the legacy app wrote), so another user's link
  // answers 404 as if it did not exist. Served inline, but only as a known
  // image type and with a policy that forbids running anything.
  .get("/images/:userId/:name", async (c) => {
    const user = await getCurrentUser(c)
    if (!user) {
      return c.json({ error: "Sign in required", code: "UNAUTHORIZED" }, 401)
    }
    const { userId, name } = c.req.param()
    const object =
      userId === user.id ? await c.env.IMAGES.get(`${userId}/${name}`) : null
    if (!object) {
      return c.json({ error: "Image not found", code: "NOT_FOUND" }, 404)
    }
    const type = object.httpMetadata?.contentType
    return new Response(object.body, {
      headers: {
        "content-type": isServableImageType(type)
          ? type
          : "application/octet-stream",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      },
    })
  })
