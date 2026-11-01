import { TRPCError } from "@trpc/server"
import { z } from "zod"
import * as agents from "../../lib/db/agents"
import * as groups from "../../lib/db/chat-groups"
import { authed, router } from "../init"

const text = (max: number) => z.string().trim().max(max)
const agentIds = z.array(z.string().min(1)).max(50)

const groupFields = {
  title: text(100).min(1),
  description: text(1000).nullable(),
  avatar: text(200).nullable(),
  backgroundColor: text(32).nullable(),
  pinned: z.boolean(),
}
const idInput = z.object({ id: z.string().min(1) })

type Owner = { db: D1Database; user: { id: string } }

/** Every id must be one of the caller's agents, or nothing is written. */
async function requireOwnedAgents(ctx: Owner, ids: string[]) {
  const unique = [...new Set(ids)]
  const owned = await agents.ownedIds(ctx.db, ctx.user.id, unique)
  if (owned.size !== unique.length) throw new TRPCError({ code: "NOT_FOUND" })
  return unique
}

async function requireGroup(ctx: Owner, id: string) {
  const group = await groups.findOwned(ctx.db, id, ctx.user.id)
  if (!group) throw new TRPCError({ code: "NOT_FOUND" })
  return group
}

export const agentGroupRouter = router({
  list: authed.query(({ ctx }) => groups.listForUser(ctx.db, ctx.user.id)),

  get: authed
    .input(idInput)
    .query(({ ctx, input }) => requireGroup(ctx, input.id)),

  create: authed
    .input(z.object({ ...groupFields, agentIds }).partial())
    .mutation(async ({ ctx, input }) => {
      const members = await requireOwnedAgents(ctx, input.agentIds ?? [])
      return groups.create(ctx.db, {
        ...input,
        userId: ctx.user.id,
        agentIds: members,
      })
    }),

  update: authed
    .input(idInput.extend(z.object(groupFields).partial().shape))
    .mutation(async ({ ctx, input }) => {
      const group = await groups.update(ctx.db, {
        ...input,
        userId: ctx.user.id,
      })
      if (!group) throw new TRPCError({ code: "NOT_FOUND" })
      return group
    }),

  remove: authed.input(idInput).mutation(async ({ ctx, input }) => {
    if (!(await groups.remove(ctx.db, input.id, ctx.user.id))) {
      throw new TRPCError({ code: "NOT_FOUND" })
    }
    return { ok: true }
  }),

  addAgents: authed
    .input(idInput.extend({ agentIds: agentIds.min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireGroup(ctx, input.id)
      const members = await requireOwnedAgents(ctx, input.agentIds)
      await groups.addAgents(ctx.db, {
        groupId: input.id,
        userId: ctx.user.id,
        agentIds: members,
      })
      return requireGroup(ctx, input.id)
    }),

  removeAgent: authed
    .input(idInput.extend({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireGroup(ctx, input.id)
      await groups.removeAgent(ctx.db, {
        groupId: input.id,
        userId: ctx.user.id,
        agentId: input.agentId,
      })
      return requireGroup(ctx, input.id)
    }),
})
