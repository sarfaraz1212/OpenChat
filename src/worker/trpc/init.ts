import { initTRPC, TRPCError } from "@trpc/server"
import type { AppBindings } from "../env"
import type { User } from "../lib/db/types"

export type TrpcContext = {
  env: AppBindings
  db: D1Database
  user: User | null
}

const t = initTRPC.context<TrpcContext>().create()

export const router = t.router

/** A procedure that requires a signed-in user; `ctx.user` is non-null in it. */
export const authed = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" })
  return next({ ctx: { ...ctx, user: ctx.user } })
})
