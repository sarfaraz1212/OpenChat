import { streamText } from "ai"
import { Hono } from "hono"
import { z } from "zod"
import { isChatModelId } from "../../shared/models"
import type { AppEnv } from "../env"
import { openproviders } from "../lib/ai/openproviders"
import { getCurrentUser } from "../lib/auth/session"
import { prepareTurn, resolveModel } from "../lib/chat/prepare-turn"
import * as agents from "../lib/db/agents"
import * as messages from "../lib/db/messages"
import * as topics from "../lib/db/topics"
import type { Memory } from "../lib/db/types"
import * as users from "../lib/db/users"
import { enqueueMemoryExtraction } from "../lib/memory/extract"
import { NO_MEMORY, retrieveMemoryContext } from "../lib/memory/retrieve"
import { retrieveExcerpts, type Excerpt } from "../lib/rag/retrieve"
import { sandboxFor } from "../lib/sandbox/enable"
import { toolRuns, type ToolRun } from "../lib/sandbox/trace"

const requestSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
  /** Omit to use the topic's model, then the agent's. */
  model: z.string().refine(isChatModelId, "Unsupported chat model").optional(),
})

const STEP_LIMIT_NOTE =
  "I used all my steps without finishing an answer. Ask me to continue and I will pick up from here."

/** What the reply drew on, kept on the message so the UI can cite it. */
function replyMetadata(
  excerpts: Excerpt[],
  remembered: Memory[],
  tools: ToolRun[]
) {
  const metadata = {
    ...(excerpts.length
      ? {
          retrieval: excerpts.map(({ fileId, fileName, chunkId, score }) => ({
            fileId,
            fileName,
            chunkId,
            score,
          })),
        }
      : {}),
    ...(remembered.length
      ? {
          memories: remembered.map(({ id, layer, title }) => ({
            id,
            layer,
            title,
          })),
        }
      : {}),
    ...(tools.length ? { tools } : {}),
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

export const chat = new Hono<AppEnv>().post(
  "/topics/:topicId/messages",
  async (c) => {
    const user = await getCurrentUser(c)
    if (!user) {
      return c.json({ error: "Sign in required", code: "UNAUTHORIZED" }, 401)
    }

    let input: z.infer<typeof requestSchema>
    try {
      input = requestSchema.parse(await c.req.json())
    } catch {
      return c.json(
        { error: "Invalid chat request", code: "INVALID_INPUT" },
        400
      )
    }

    const topicId = c.req.param("topicId")
    const topic = await topics.findOwned(c.env.DB, topicId, user.id)
    if (!topic) {
      return c.json({ error: "Topic not found", code: "NOT_FOUND" }, 404)
    }

    // Chatting is activity: it keeps the re-engagement emails away.
    await users.touchLastActive(c.env.DB, user.id)
    const agent =
      (topic.agent_id &&
        (await agents.findOwned(c.env.DB, topic.agent_id, user.id))) ||
      (await agents.ensureInbox(c.env.DB, user.id))

    // The user's message goes in first so it is part of the history we send.
    const model = resolveModel(input.model, topic.model, agent.model)
    await messages.insert(c.env.DB, {
      topicId,
      userId: user.id,
      role: "user",
      content: input.content,
      model,
    })
    await topics.touch(c.env.DB, topicId, user.id, model)

    // Grounding is best-effort: a search outage must not stop the reply.
    let excerpts: Excerpt[] = []
    try {
      excerpts = await retrieveExcerpts(c.env, {
        userId: user.id,
        agentId: agent.id,
        query: input.content,
      })
    } catch (error) {
      console.error("[/api/chat] retrieval failed", error)
    }
    const memory = await retrieveMemoryContext(c.env, {
      userId: user.id,
      query: input.content,
    }).catch((error) => {
      console.error("[/api/chat] memory lookup failed", error)
      return NO_MEMORY
    })
    // Code execution: only for agents that opted in, on models that can call tools.
    const sandbox = sandboxFor(c.env, { agent, model, topicId })
    const turn = prepareTurn({
      agent,
      model,
      excerpts,
      memory,
      sandboxPrompt: sandbox?.systemPrompt,
      history: await messages.listForOwnedTopic(c.env.DB, topicId, user.id),
    })
    try {
      const result = streamText({
        model: openproviders(turn.model, c.env),
        system: turn.system,
        messages: turn.messages,
        temperature: turn.temperature,
        topP: turn.topP,
        maxOutputTokens: turn.maxOutputTokens,
        maxRetries: 1,
        tools: sandbox?.tools,
        stopWhen: sandbox?.stopWhen,
        onFinish: async ({ text, totalUsage, steps }) => {
          const runs = toolRuns(steps)
          await messages.insert(c.env.DB, {
            topicId,
            userId: user.id,
            role: "assistant",
            // A model that keeps calling tools can hit the step cap without ever
            // answering; leave a note rather than an empty reply.
            content: text || (runs.length > 0 ? STEP_LIMIT_NOTE : text),
            model: turn.model,
            // Every model call of the turn, not just the last (tool loops).
            usage: totalUsage,
            metadata: replyMetadata(excerpts, memory.memories, runs),
          })
          await topics.touch(c.env.DB, topicId, user.id)
          // Remembering is background work; it must never fail the reply.
          await enqueueMemoryExtraction(c.env, {
            userId: user.id,
            topicId,
          }).catch((error) =>
            console.error("[/api/chat] memory extraction not started", error)
          )
        },
      })
      return result.toTextStreamResponse()
    } catch (error) {
      console.error("[/api/chat]", error)
      return c.json(
        { error: "Could not start the model response", code: "AI_UNAVAILABLE" },
        503
      )
    }
  }
)
