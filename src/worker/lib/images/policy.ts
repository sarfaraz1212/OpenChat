/** A small blocklist for clearly harmful requests, carried over unchanged. */
const BLOCKED_TERMS = [
  "nude",
  "naked",
  "nsfw",
  "pornograph",
  "sexual",
  "gore",
  "violence against",
  "child abuse",
  "terrorism",
  "hate speech",
]

export function isPromptSafe(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  return !BLOCKED_TERMS.some((term) => lower.includes(term))
}

/**
 * Tidy a prompt before it is stored and sent on: control characters out,
 * whitespace runs collapsed. (The legacy app ran DOMPurify over it, which needs
 * a DOM; a prompt is plain text that is never rendered as HTML.)
 */
export function cleanPrompt(prompt: string): string {
  // Keep tab, line feed and carriage return; drop every other control character.
  const isControl = (code: number) =>
    (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
  return [...prompt]
    .filter((char) => !isControl(char.charCodeAt(0)))
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim()
}
