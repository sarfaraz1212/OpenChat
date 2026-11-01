import { Hono } from "hono"
import type { AppEnv } from "./env"
import { csrfProtection } from "./middleware/csrf"
import { auth } from "./routes/auth"
import { chat } from "./routes/chat"
import { cron } from "./routes/cron"
import { csrf } from "./routes/csrf"
import { filesRoute } from "./routes/files"
import { health } from "./routes/health"
import { imageTools } from "./routes/image-tools"
import { trpc } from "./routes/trpc"

export const app = new Hono<AppEnv>()

// Registered first so it also wraps responses the CSRF check returns early:
// everything under /api is per-user or per-session and must not be cached.
app.use("/api/*", async (c, next) => {
  await next()
  c.header("Cache-Control", "no-store")
  // An API response is data. Nothing here should ever be sniffed into another
  // type, framed, or treated as a document that can load anything.
  c.header("X-Content-Type-Options", "nosniff")
  c.header("Referrer-Policy", "no-referrer")
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'"
  )
})

// Ahead of every route: it only protects routes registered after it.
app.use("/api/*", csrfProtection)

app.route("/api/health", health)
app.route("/api/auth", auth)
app.route("/api/csrf", csrf)
app.route("/api/cron", cron)
app.route("/api/trpc", trpc)
app.route("/api/chat", chat)
app.route("/api/files", filesRoute)
app.route("/api/image-tools", imageTools)

app.notFound((c) => c.json({ error: "Not found", code: "NOT_FOUND" }, 404))

app.onError((err, c) => {
  console.error("[worker] unhandled error", err)
  return c.json({ error: "Internal server error", code: "INTERNAL" }, 500)
})
