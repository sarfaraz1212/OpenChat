import type { Agent } from "../chat-types"

type AvatarSource = Pick<
  Agent,
  "avatar" | "title" | "backgroundColor" | "virtual"
>

/** An agent's emoji (or first letter) on its chosen background colour. */
export function AgentAvatar({
  agent,
  size = 26,
}: {
  agent: AvatarSource
  size?: number
}) {
  const glyph = agent.virtual
    ? "O"
    : agent.avatar || (agent.title?.trim()[0] ?? "A").toUpperCase()
  return (
    <span
      className="agent-avatar"
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        background: agent.backgroundColor ?? undefined,
      }}
    >
      {glyph}
    </span>
  )
}
