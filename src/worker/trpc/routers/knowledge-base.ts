import { TRPCError } from "@trpc/server"
import { z } from "zod"
import * as files from "../../lib/db/files"
import * as knowledge from "../../lib/db/knowledge-bases"
import { authed, router } from "../init"

const idInput = z.object({ id: z.string().min(1) })
const fileIds = z.array(z.string().min(1)).max(50)

type Owner = { db: D1Database; user: { id: string } }

async function requireBase(ctx: Owner, id: string) {
  const base = await knowledge.findOwned(ctx.db, id, ctx.user.id)
  if (!base) throw new TRPCError({ code: "NOT_FOUND" })
  return base
}

export const knowledgeBaseRouter = router({
  list: authed.query(({ ctx }) => knowledge.listForUser(ctx.db, ctx.user.id)),

  get: authed.input(idInput).query(async ({ ctx, input }) => {
    const base = await requireBase(ctx, input.id)
    const inside = await knowledge.filesOf(ctx.db, input.id, ctx.user.id)
    return { ...base, files: inside.map(files.toKnowledgeFile) }
  }),

  create: authed
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(1000).nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      knowledge.create(ctx.db, { userId: ctx.user.id, ...input })
    ),

  update: authed
    .input(
      idInput.extend({
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(1000).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const base = await knowledge.update(ctx.db, {
        ...input,
        userId: ctx.user.id,
      })
      if (!base) throw new TRPCError({ code: "NOT_FOUND" })
      return base
    }),

  remove: authed.input(idInput).mutation(async ({ ctx, input }) => {
    if (!(await knowledge.remove(ctx.db, input.id, ctx.user.id))) {
      throw new TRPCError({ code: "NOT_FOUND" })
    }
    return { ok: true }
  }),

  /** Add files (already-present ones are ignored); every id must be the caller's. */
  addFiles: authed
    .input(idInput.extend({ fileIds }))
    .mutation(async ({ ctx, input }) => {
      await requireBase(ctx, input.id)
      const ids = [...new Set(input.fileIds)]
      const owned = await files.ownedIds(ctx.db, ctx.user.id, ids)
      if (owned.size !== ids.length) throw new TRPCError({ code: "NOT_FOUND" })
      await knowledge.addFiles(ctx.db, {
        id: input.id,
        userId: ctx.user.id,
        fileIds: ids,
      })
      return requireBase(ctx, input.id)
    }),

  removeFile: authed
    .input(idInput.extend({ fileId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireBase(ctx, input.id)
      await knowledge.removeFile(ctx.db, {
        id: input.id,
        userId: ctx.user.id,
        fileId: input.fileId,
      })
      return requireBase(ctx, input.id)
    }),
})
