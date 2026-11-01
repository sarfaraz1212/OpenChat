import { TRPCError } from "@trpc/server"
import { z } from "zod"
import * as files from "../../lib/db/files"
import { deleteFile } from "../../lib/rag/knowledge"
import { authed, router } from "../init"

const idInput = z.object({ id: z.string().min(1) })

export const fileRouter = router({
  list: authed.query(async ({ ctx }) =>
    (await files.listForUser(ctx.db, ctx.user.id)).map(files.toKnowledgeFile)
  ),

  get: authed.input(idInput).query(async ({ ctx, input }) => {
    const file = await files.findOwned(ctx.db, input.id, ctx.user.id)
    if (!file) throw new TRPCError({ code: "NOT_FOUND" })
    return files.toKnowledgeFile(file)
  }),

  remove: authed.input(idInput).mutation(async ({ ctx, input }) => {
    const file = await files.findOwned(ctx.db, input.id, ctx.user.id)
    if (!file) throw new TRPCError({ code: "NOT_FOUND" })
    await deleteFile(ctx.env, ctx.user.id, file)
    return { ok: true }
  }),
})
