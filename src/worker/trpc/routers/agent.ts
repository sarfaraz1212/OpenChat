import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { isChatModelId } from "../../../shared/models"
import * as agents from "../../lib/db/agents"
import * as files from "../../lib/db/files"
import * as knowledge from "../../lib/db/knowledge-bases"
import { authed, router } from "../init"

const text = (max: number) => z.string().trim().max(max)

const agentFields = {
  title: text(100).min(1),
  description: text(1000).nullable(),
  avatar: text(200).nullable(),
  backgroundColor: text(32).nullable(),
  tags: z.array(text(30).min(1)).max(20),
  systemRole: z.string().max(20_000).nullable(),
  model: z.string().refine(isChatModelId, "Unsupported chat model").nullable(),
  params: z.object({
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().min(1).max(16_384).optional(),
  }),
  chatConfig: z.object({
    historyCount: z.number().int().min(1).max(200).optional(),
    sandbox: z.boolean().optional(),
  }),
  openingMessage: z.string().max(4000).nullable(),
  openingQuestions: z.array(text(200).min(1)).max(8),
  pinned: z.boolean(),
}

const idInput = z.object({ id: z.string().min(1) })

export const agentRouter = router({
  list: authed.query(async ({ ctx }) => {
    await agents.ensureInbox(ctx.db, ctx.user.id)
    return agents.listForUser(ctx.db, ctx.user.id)
  }),

  /** The default "Just Chat" agent, created on first use. */
  inbox: authed.query(({ ctx }) => agents.ensureInbox(ctx.db, ctx.user.id)),

  get: authed.input(idInput).query(async ({ ctx, input }) => {
    const agent = await agents.findOwned(ctx.db, input.id, ctx.user.id)
    if (!agent) throw new TRPCError({ code: "NOT_FOUND" })
    return agent
  }),

  create: authed
    .input(z.object(agentFields).partial())
    .mutation(({ ctx, input }) =>
      agents.create(ctx.db, { userId: ctx.user.id, ...input })
    ),

  update: authed
    .input(idInput.extend(z.object(agentFields).partial().shape))
    .mutation(async ({ ctx, input }) => {
      const agent = await agents.update(ctx.db, {
        ...input,
        userId: ctx.user.id,
      })
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" })
      return agent
    }),

  /** The files and knowledge bases this agent draws on when it answers. */
  getKnowledge: authed
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      if (!(await agents.findOwned(ctx.db, input.agentId, ctx.user.id))) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      const attached = await knowledge.agentKnowledge(
        ctx.db,
        input.agentId,
        ctx.user.id
      )
      return {
        files: attached.files.map(files.toKnowledgeFile),
        knowledgeBases: attached.knowledgeBases,
      }
    }),

  /** Replace what the agent draws on; every id must be the caller's own. */
  setKnowledge: authed
    .input(
      z.object({
        agentId: z.string().min(1),
        fileIds: z.array(z.string().min(1)).max(50),
        knowledgeBaseIds: z.array(z.string().min(1)).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const fileIds = [...new Set(input.fileIds)]
      const knowledgeBaseIds = [...new Set(input.knowledgeBaseIds)]
      const [agent, ownedFiles, ownedBases] = await Promise.all([
        agents.findOwned(ctx.db, input.agentId, ctx.user.id),
        files.ownedIds(ctx.db, ctx.user.id, fileIds),
        knowledge.ownedIds(ctx.db, ctx.user.id, knowledgeBaseIds),
      ])
      if (
        !agent ||
        ownedFiles.size !== fileIds.length ||
        ownedBases.size !== knowledgeBaseIds.length
      ) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      await knowledge.setAgentKnowledge(ctx.db, {
        agentId: input.agentId,
        userId: ctx.user.id,
        fileIds,
        knowledgeBaseIds,
      })
      return { ok: true }
    }),

  remove: authed.input(idInput).mutation(async ({ ctx, input }) => {
    const agent = await agents.findOwned(ctx.db, input.id, ctx.user.id)
    if (!agent) throw new TRPCError({ code: "NOT_FOUND" })
    if (agent.virtual) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "The default agent cannot be deleted",
      })
    }
    await agents.remove(ctx.db, input.id, ctx.user.id)
    return { ok: true }
  }),
})
