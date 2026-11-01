/** The five kinds of memory, as in LobeHub's user-memory system. */
export const MEMORY_LAYERS = [
  "identity",
  "preference",
  "experience",
  "activity",
  "context",
] as const

export type MemoryLayer = (typeof MEMORY_LAYERS)[number]

export const isMemoryLayer = (value: string): value is MemoryLayer =>
  (MEMORY_LAYERS as readonly string[]).includes(value)
