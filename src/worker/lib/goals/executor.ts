import { generateText } from "ai"
import { z } from "zod"
import type { AppBindings } from "../../env"
import { openproviders } from "../ai/openproviders"
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_SYSTEM_PROMPT,
  resolveModel,
} from "../chat/prepare-turn"
import * as agentsRepo from "../db/agents"
import { now } from "../db/client"
import * as goals from "../db/goals"
import * as messages from "../db/messages"
import * as topics from "../db/topics"
import type { Goal, GoalNode } from "../db/types"
import { generateJson } from "../memory/llm"
import { sandboxFor } from "../sandbox/enable"
import { toolRuns, type ToolRun } from "../sandbox/trace"
import { executorUser, verifierSystem, verifierUser } from "./prompts"

export type NodeOutcome =
  | { ok: true; result: string; verdict?: "pass" | "fail" }
  | { ok: false; error: string }

const verdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string().default(""),
})

const shorten = (error: unknown) =>
  (error instanceof Error ? error.message : "Unknown error").slice(0, 300)

/**
 * Run one graph node: a task is done by its executor agent (a plain
 * completion for now; code execution arrives with the sandbox), a
 * verification by an independent reviewer. The work happens in its own topic,
 * hidden from the chat list but open to inspection, and the outcome is written
 * to the node's task. Never throws.
 */
export async function executeNode(
  env: AppBindings,
  params: {
    goal: Goal
    userId: string
    node: GoalNode
    prerequisites: Array<{ title: string; result: string | null }>
  }
): Promise<NodeOutcome> {
  const { goal, userId, node, prerequisites } = params
  const db = env.DB
  const task = node.taskId ? await goals.getTask(db, node.taskId) : null
  if (!task) return { ok: false, error: "The node has no task to run" }

  await goals.updateTask(db, task.id, {
    status: "running",
    attempts: task.attempts + 1,
    started_at: now(),
    error: null,
  })
  try {
    const agent =
      (task.agentId &&
        (await agentsRepo.findOwned(db, task.agentId, userId))) ||
      (await agentsRepo.ensureInbox(db, userId))
    const model = resolveModel(agent.model)
    const topic = await topics.create(db, {
      userId,
      agentId: agent.id,
      title: node.title,
      model,
      // Marks the topic as a task's workspace so it stays out of the chat list.
      metadata: { goalId: goal.id, taskId: task.id },
    })
    await goals.updateTask(db, task.id, { topic_id: topic.id })

    const prompt =
      node.kind === "verification"
        ? verifierUser({ goal, delivered: prerequisites })
        : executorUser({
            goal,
            title: task.title,
            description: task.description,
            prerequisites,
          })
    await messages.insert(db, {
      topicId: topic.id,
      userId,
      role: "user",
      content: prompt,
    })

    let result: string
    let verdict: "pass" | "fail" | undefined
    let runs: ToolRun[] = []
    let usage: unknown
    if (node.kind === "verification") {
      const ruling = await generateJson(env, {
        system: verifierSystem(),
        prompt,
        schema: verdictSchema,
      })
      verdict = ruling.verdict
      result = `${ruling.verdict}: ${ruling.reason}`
    } else {
      // The task's executor may run code, like a chat with the same agent.
      const sandbox = sandboxFor(env, { agent, model, topicId: topic.id })
      const { text, steps, totalUsage } = await generateText({
        model: openproviders(model, env),
        system: [
          agent.systemRole?.trim() || DEFAULT_SYSTEM_PROMPT,
          sandbox?.systemPrompt,
        ]
          .filter(Boolean)
          .join("\n\n"),
        prompt,
        temperature: agent.params.temperature,
        topP: agent.params.topP,
        maxOutputTokens: agent.params.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        tools: sandbox?.tools,
        stopWhen: sandbox?.stopWhen,
        // Retrying is the scheduler's job, with attempt limits and a gate.
        maxRetries: 0,
      })
      runs = toolRuns(steps)
      usage = totalUsage
      result = text.trim()
      if (!result) throw new Error("The model returned no text")
    }

    await messages.insert(db, {
      topicId: topic.id,
      userId,
      role: "assistant",
      content: result,
      model,
      usage,
      metadata: runs.length > 0 ? { tools: runs } : undefined,
    })
    await topics.touch(db, topic.id, userId)
    await goals.updateTask(db, task.id, {
      status: "completed",
      result,
      completed_at: now(),
    })
    return { ok: true, result, verdict }
  } catch (error) {
    const message = shorten(error)
    await goals.updateTask(db, task.id, {
      status: "failed",
      error: message,
      completed_at: now(),
    })
    return { ok: false, error: message }
  }
}
