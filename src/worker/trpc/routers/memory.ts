import { TRPCError } from "@trpc/server"
import { z } from "zod"
import * as memories from "../../lib/db/memories"
import { MEMORY_LAYERS } from "../../lib/memory/layers"
import {
  editMemory,
  forgetEverything,
  forgetMemory,
} from "../../lib/memory/manage"
import { authed, router } from "../init"

const idInput = z.object({ id: z.string().min(1) })

export const memoryRouter = router({
  list: authed
    .input(z.object({ layer: z.enum(MEMORY_LAYERS).optional() }).optional())
    .query(({ ctx, input }) =>
      memories.listForUser(ctx.db, ctx.user.id, input?.layer)
    ),

  /** The rolling profile written from the memories, or null before the first. */
  persona: authed.query(({ ctx }) => memories.getPersona(ctx.db, ctx.user.id)),

  update: authed
    .input(
      idInput.extend({
        title: z.string().trim().min(1).max(120).optional(),
        summary: z.string().trim().min(1).max(600).optional(),
        details: z.string().trim().max(2000).nullable().optional(),
        tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const memory = await editMemory(ctx.env, ctx.user.id, input)
      if (!memory) throw new TRPCError({ code: "NOT_FOUND" })
      return memory
    }),

  remove: authed.input(idInput).mutation(async ({ ctx, input }) => {
    if (!(await forgetMemory(ctx.env, ctx.user.id, input.id))) {
      throw new TRPCError({ code: "NOT_FOUND" })
    }
    return { ok: true }
  }),

  /** Forget everything: memories, persona and extraction state. */
  clear: authed.mutation(async ({ ctx }) => {
    await forgetEverything(ctx.env, ctx.user.id)
    return { ok: true }
  }),

  settings: authed.query(async ({ ctx }) => ({
    enabled: await memories.isEnabled(ctx.db, ctx.user.id),
  })),

  /** Turn extraction and use of memory on or off; existing memories are kept. */
  setEnabled: authed
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await memories.setEnabled(ctx.db, ctx.user.id, input.enabled)
      return { ok: true }
    }),
})
