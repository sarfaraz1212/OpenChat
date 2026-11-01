export const CHUNK_SIZE = 1000
export const CHUNK_OVERLAP = 150

/** Split one over-long paragraph on sentence ends, hard-slicing what still won't fit. */
function splitLong(paragraph: string, size: number): string[] {
  const sentences = paragraph.match(/[^.!?\n]+[.!?]*\s*/g) ?? [paragraph]
  const pieces: string[] = []
  let current = ""
  const flush = () => {
    if (current.trim()) pieces.push(current.trim())
    current = ""
  }
  for (const sentence of sentences) {
    if (sentence.length > size) {
      flush()
      for (let i = 0; i < sentence.length; i += size) {
        pieces.push(sentence.slice(i, i + size).trim())
      }
    } else if (current.length + sentence.length > size) {
      flush()
      current = sentence
    } else {
      current += sentence
    }
  }
  flush()
  return pieces.filter(Boolean)
}

/** The end of `previous`, from a word boundary, to carry into the next chunk. */
function overlapTail(previous: string, overlap: number): string {
  const tail = previous.slice(-overlap)
  const space = tail.indexOf(" ")
  return `${space >= 0 ? tail.slice(space + 1) : tail} `
}

/**
 * Split text into retrieval chunks of about `size` characters: paragraphs are
 * packed together where they fit, long paragraphs are split on sentences, and
 * each chunk after the first starts with a short tail of the one before so an
 * answer that straddles a boundary is still found.
 */
export function chunkText(
  text: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP
): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim()
  if (!normalized) return []

  const units = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) =>
      paragraph.length > size ? splitLong(paragraph, size) : [paragraph]
    )

  const chunks: string[] = []
  let current = ""
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > size) {
      chunks.push(current)
      current = unit
    } else {
      current = current ? `${current}\n\n${unit}` : unit
    }
  }
  if (current) chunks.push(current)

  return chunks.map((chunk, index) =>
    index === 0 ? chunk : `${overlapTail(chunks[index - 1], overlap)}${chunk}`
  )
}
