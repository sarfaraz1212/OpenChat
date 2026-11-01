import { generateText } from "ai"
import type { ZodType } from "zod"
import { DEFAULT_CHAT_MODEL, type ChatModelId } from "../../../shared/models"
import type { AppBindings } from "../../env"
import { openproviders } from "../ai/openproviders"

/** The default model for structured-output calls; the open-weight chat default. */
const MEMORY_MODEL = DEFAULT_CHAT_MODEL

/** The first JSON object in a reply, tolerating code fences and chatter. */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/**
 * Ask the model for one JSON object and validate it. Workers AI models do not
 * all honour structured-output modes, so this asks for JSON in the prompt and
 * retries once, telling the model what was wrong.
 */
export async function generateJson<T>(
  env: AppBindings,
  params: {
    system: string
    prompt: string
    schema: ZodType<T>
    /** Defaults to the memory model (the open-weight chat default). */
    model?: ChatModelId
  }
): Promise<T> {
  let feedback = ""
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await generateText({
      model: openproviders(params.model ?? MEMORY_MODEL, env),
      system: params.system,
      prompt: params.prompt + feedback,
      temperature: 0,
      maxOutputTokens: 2048,
      maxRetries: 1,
    })
    const parsed = parseJsonObject(text)
    const result = params.schema.safeParse(parsed)
    if (result.success) return result.data
    feedback = `\n\nYour previous reply was not a valid answer (${
      parsed === undefined
        ? "no JSON object found"
        : result.error.message.slice(0, 300)
    }). Reply with ONLY the JSON object.`
  }
  throw new Error("The model did not return valid JSON")
}
