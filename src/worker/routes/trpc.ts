import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { Hono } from "hono"
import type { AppEnv } from "../env"
import { getCurrentUser } from "../lib/auth/session"
import { appRouter } from "../trpc/router"

export const trpc = new Hono<AppEnv>().all("/*", async (c) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: async () => ({
      env: c.env,
      db: c.env.DB,
      user: await getCurrentUser(c),
    }),
    onError: ({ error, path }) => {
      console.error(`[trpc:${path ?? "unknown"}]`, error)
    },
  })
)
