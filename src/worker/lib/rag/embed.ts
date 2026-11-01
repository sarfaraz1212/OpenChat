import { embedMany } from "ai"
import type { AppBindings } from "../../env"
import { embeddingModel } from "../ai/openproviders"

/** Texts per Workers AI call; well under the per-request limit. */
const BATCH_SIZE = 32

/** Embed texts in order, one Workers AI call per batch. */
export async function embedTexts(
  env: AppBindings,
  texts: string[]
): Promise<number[][]> {
  const model = embeddingModel(env)
  const embeddings: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const result = await embedMany({
      model,
      values: texts.slice(i, i + BATCH_SIZE),
      maxRetries: 1,
    })
    embeddings.push(...result.embeddings)
  }
  return embeddings
}
