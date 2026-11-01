import { stepCountIs } from "ai"
import { CHAT_MODEL_INFOS } from "../../../shared/models"
import type { AppBindings } from "../../env"
import type { Agent } from "../db/types"
import { sandboxProvider } from "./backend"
import { sandboxTools, type SandboxTools } from "./tools"

/** Model calls per turn (tool round trips plus the final answer). */
export const MAX_TOOL_STEPS = 8

/** Read before use: what the model is told about its sandbox. */
export const SANDBOX_SYSTEM_PROMPT = [
  "You can run code and work with files in a secure Cloud Sandbox, using the runCommand, executeCode, writeFile, readFile, editFile and listFiles tools.",
  "The sandbox is NOT the user's computer. It is an isolated Linux container, private to this conversation, whose working directory is /workspace. Files you create there are temporary and only exist inside this conversation's sandbox.",
  "Commands time out after 30 seconds by default (120 at most). Python 3 and Node.js are installed; the default shell is sh, so wrap bash-specific syntax in `bash -c`. Long output is truncated.",
  "Use the sandbox when running code would give a more reliable answer than reasoning (calculations, data processing, testing a snippet, converting files). Show the user what you ran and what came back, and never claim to have run something you did not.",
].join("\n\n")

export type SandboxSetup = {
  tools: SandboxTools
  systemPrompt: string
  stopWhen: ReturnType<typeof stepCountIs>
}

/** Whether a catalog model has been observed to call tools cleanly. */
export const modelCanCallTools = (model: string) =>
  CHAT_MODEL_INFOS.find((info) => info.id === model)?.abilities.functionCall ===
  true

/**
 * The sandbox tools for one turn, or null. All of these must hold: the agent
 * opted in, the model can call tools (some Workers AI models leak tool calls as
 * raw text, so the catalog's probed `functionCall` flag decides), and a sandbox
 * backend exists. The sandbox is one per topic, so a conversation's files
 * persist across its turns and never reach another conversation.
 */
export function sandboxFor(
  env: AppBindings,
  params: { agent: Agent; model: string; topicId: string }
): SandboxSetup | null {
  if (!params.agent.chatConfig.sandbox) return null
  if (!modelCanCallTools(params.model)) return null
  const provider = sandboxProvider(env)
  if (!provider) return null
  return {
    tools: sandboxTools(provider(`topic-${params.topicId}`)),
    systemPrompt: SANDBOX_SYSTEM_PROMPT,
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
  }
}
