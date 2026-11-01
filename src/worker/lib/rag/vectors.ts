/**
 * The slice of the Vectorize index the app uses. Vectors are namespaced per
 * user and carry only `file_id` as metadata: chunk text stays in D1, so a
 * vector alone reveals nothing.
 *
 * Deploy note: a metadata filter needs a metadata index created *before* any
 * vector is inserted (`wrangler vectorize create-metadata-index
 * openchat-v2-kb --property-name=file_id --type=string`). Vectorize is also
 * eventually consistent: new vectors take seconds to become queryable.
 */
export type VectorStore = Pick<
  VectorizeIndex,
  "upsert" | "query" | "deleteByIds"
>

const UPSERT_BATCH = 500
const DELETE_BATCH = 500
/** `$in` filters are queried in slices of this many files, then merged. */
const FILES_PER_QUERY = 20

export async function upsertVectors(
  store: VectorStore,
  userId: string,
  vectors: Array<{ id: string; fileId: string; values: number[] }>
): Promise<void> {
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
    await store.upsert(
      vectors.slice(i, i + UPSERT_BATCH).map((vector) => ({
        id: vector.id,
        values: vector.values,
        namespace: userId,
        metadata: { file_id: vector.fileId },
      }))
    )
  }
}

export async function deleteVectors(
  store: VectorStore,
  ids: string[]
): Promise<void> {
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    await store.deleteByIds(ids.slice(i, i + DELETE_BATCH))
  }
}

/** The closest chunks to `vector` among the given files, best first. */
export async function queryVectors(
  store: VectorStore,
  params: { userId: string; fileIds: string[]; vector: number[]; topK: number }
): Promise<Array<{ id: string; score: number }>> {
  const hits: Array<{ id: string; score: number }> = []
  for (let i = 0; i < params.fileIds.length; i += FILES_PER_QUERY) {
    const { matches } = await store.query(params.vector, {
      topK: params.topK,
      namespace: params.userId,
      filter: {
        file_id: { $in: params.fileIds.slice(i, i + FILES_PER_QUERY) },
      },
      returnMetadata: "none",
    })
    hits.push(...matches.map(({ id, score }) => ({ id, score })))
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, params.topK)
}
