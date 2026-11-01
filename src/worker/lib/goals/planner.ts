import { z } from "zod"
import type { AppBindings } from "../../env"
import * as goals from "../db/goals"
import type { Goal, GoalNode } from "../db/types"
import { generateJson } from "../memory/llm"
import { managerSystem, managerUser, type Snapshot } from "./prompts"

const taskSpec = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  /** Existing node ids, or 0-based positions of earlier tasks in the same plan. */
  dependsOn: z
    .array(z.union([z.number().int().min(0), z.string()]))
    .default([]),
})

export const planSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("tasks"),
    reason: z.string().default(""),
    tasks: z.array(taskSpec).min(1).max(10),
  }),
  z.object({ action: z.literal("verify"), reason: z.string().default("") }),
  z.object({ action: z.literal("escalate"), reason: z.string().default("") }),
])

export type Plan = z.infer<typeof planSchema>

/** One planning turn: ask the goal manager what to do next. */
export async function planNextMove(
  env: AppBindings,
  snapshot: Snapshot,
  model?: Parameters<typeof generateJson>[1]["model"]
): Promise<Plan> {
  return generateJson(env, {
    system: managerSystem(),
    prompt: managerUser(snapshot),
    schema: planSchema,
    model,
  })
}

export type Validation = { ok: true } | { ok: false; reason: string }

/**
 * Check a `tasks` plan against the graph before anything is written: a
 * dependency must be an existing, not-retired node, or an EARLIER task of the
 * same plan, so the graph stays acyclic and one bad entry refuses the plan.
 */
export function validateTasksPlan(
  plan: Extract<Plan, { action: "tasks" }>,
  nodes: GoalNode[]
): Validation {
  const live = new Map(
    nodes
      .filter((node) => node.status !== "retired")
      .map((node) => [node.id, node])
  )
  for (const [index, task] of plan.tasks.entries()) {
    for (const dependency of task.dependsOn) {
      if (typeof dependency === "number") {
        if (dependency >= index) {
          return {
            ok: false,
            reason: `Task ${index} ("${task.title}") depends on position ${dependency}, which is not an earlier task in the plan.`,
          }
        }
      } else if (!live.has(dependency)) {
        return {
          ok: false,
          reason: `Task ${index} ("${task.title}") depends on "${dependency}", which is not a live node of this goal.`,
        }
      }
    }
  }
  return { ok: true }
}

/** Write a validated `tasks` plan: one task and one graph node per entry. */
export async function applyTasksPlan(
  db: D1Database,
  params: {
    goal: Goal
    userId: string
    executorAgentId: string | null
    plan: Extract<Plan, { action: "tasks" }>
  }
): Promise<GoalNode[]> {
  const round = params.goal.rounds + 1
  const created: GoalNode[] = []
  const edges: Array<{ sourceNodeId: string; targetNodeId: string }> = []
  for (const [index, spec] of params.plan.tasks.entries()) {
    const task = await goals.insertTask(db, {
      userId: params.userId,
      goalId: params.goal.id,
      agentId: params.executorAgentId,
      title: spec.title,
      description: spec.description,
    })
    const node = await goals.insertNode(db, {
      goalId: params.goal.id,
      kind: "task",
      title: spec.title,
      description: spec.description,
      taskId: task.id,
      round,
      priority: index,
    })
    created.push(node)
    for (const dependency of spec.dependsOn) {
      edges.push({
        sourceNodeId: node.id,
        targetNodeId:
          typeof dependency === "number" ? created[dependency].id : dependency,
      })
    }
  }
  await goals.insertEdges(db, params.goal.id, edges)
  await goals.updateGoalCounters(db, params.goal.id, { rounds: round })
  return created
}
