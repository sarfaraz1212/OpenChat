import { TRPCError } from "@trpc/server"
import { z } from "zod"
import * as goals from "../../lib/db/goals"
import {
  createGoal,
  deleteGoal,
  GoalError,
  pauseGoal,
  resolveGate,
  resumeGoal,
  startGoal,
  stopGoal,
} from "../../lib/goals/manage"
import { authed, router } from "../init"

const idInput = z.object({ id: z.string().min(1) })

/** Turn the goal engine's refusals into the matching tRPC errors. */
async function guard<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof GoalError) {
      throw new TRPCError({ code: error.code, message: error.message })
    }
    throw error
  }
}

export const goalRouter = router({
  list: authed.query(({ ctx }) => goals.listGoals(ctx.db, ctx.user.id)),

  /** A goal with its task graph, results, open questions and audit trail. */
  get: authed.input(idInput).query(async ({ ctx, input }) => {
    const goal = await goals.findOwnedGoal(ctx.db, input.id, ctx.user.id)
    if (!goal) throw new TRPCError({ code: "NOT_FOUND" })
    const [nodes, edges, tasks, decisions, events] = await Promise.all([
      goals.listNodes(ctx.db, goal.id),
      goals.listEdges(ctx.db, goal.id),
      goals.listTasks(ctx.db, goal.id),
      goals.listDecisions(ctx.db, goal.id),
      goals.listEvents(ctx.db, goal.id),
    ])
    return { ...goal, nodes, edges, tasks, decisions, events }
  }),

  create: authed
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        requirement: z.string().trim().max(4000).nullable().optional(),
        agentId: z.string().min(1).optional(),
        taskAgentId: z.string().min(1).optional(),
        maxRounds: z.number().int().min(1).max(30).optional(),
        maxManagerTurns: z.number().int().min(1).max(30).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      guard(() => createGoal(ctx.env, ctx.user.id, input))
    ),

  start: authed.input(idInput).mutation(({ ctx, input }) =>
    guard(async () => {
      await startGoal(ctx.env, ctx.user.id, input.id)
      return { ok: true }
    })
  ),

  pause: authed.input(idInput).mutation(({ ctx, input }) =>
    guard(async () => {
      await pauseGoal(ctx.env, ctx.user.id, input.id)
      return { ok: true }
    })
  ),

  resume: authed.input(idInput).mutation(({ ctx, input }) =>
    guard(async () => {
      await resumeGoal(ctx.env, ctx.user.id, input.id)
      return { ok: true }
    })
  ),

  stop: authed.input(idInput).mutation(({ ctx, input }) =>
    guard(async () => {
      await stopGoal(ctx.env, ctx.user.id, input.id)
      return { ok: true }
    })
  ),

  /** Answer an open question the goal paused on. */
  resolveDecision: authed
    .input(
      z.object({
        goalId: z.string().min(1),
        decisionId: z.string().min(1),
        optionId: z.string().min(1),
        note: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      guard(async () => {
        await resolveGate(ctx.env, ctx.user.id, input)
        return { ok: true }
      })
    ),

  remove: authed.input(idInput).mutation(({ ctx, input }) =>
    guard(async () => {
      await deleteGoal(ctx.env, ctx.user.id, input.id)
      return { ok: true }
    })
  ),
})
