import { newId, now, parseJson, stringifyJson, toBool } from "./client"
import type { Agent, AgentChatConfig, AgentParams, AgentRow } from "./types"

export const INBOX_SLUG = "inbox"
export const INBOX_TITLE = "Just Chat"

const hydrate = (row: AgentRow): Agent => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  description: row.description,
  tags: parseJson<string[]>(row.tags, []),
  avatar: row.avatar,
  backgroundColor: row.background_color,
  systemRole: row.system_role,
  model: row.model,
  provider: row.provider,
  params: parseJson<AgentParams>(row.params, {}),
  chatConfig: parseJson<AgentChatConfig>(row.chat_config, {}),
  openingMessage: row.opening_message,
  openingQuestions: parseJson<string[]>(row.opening_questions, []),
  pinned: toBool(row.pinned),
  virtual: toBool(row.virtual),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/** The user-editable fields; every one is optional on create and update. */
export type AgentFields = Partial<
  Pick<
    Agent,
    | "title"
    | "description"
    | "avatar"
    | "backgroundColor"
    | "tags"
    | "systemRole"
    | "model"
    | "params"
    | "chatConfig"
    | "openingMessage"
    | "openingQuestions"
    | "pinned"
  >
>

/** The default agent comes first, then pinned agents, then most recent. */
export async function listForUser(
  db: D1Database,
  userId: string
): Promise<Agent[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM agents WHERE user_id = ?
       ORDER BY virtual DESC, pinned DESC, updated_at DESC`
    )
    .bind(userId)
    .all<AgentRow>()
  return (results ?? []).map(hydrate)
}

export async function findOwned(
  db: D1Database,
  id: string,
  userId: string
): Promise<Agent | null> {
  const row = await db
    .prepare("SELECT * FROM agents WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<AgentRow>()
  return row ? hydrate(row) : null
}

/** Idempotent and safe under concurrent first requests. */
export async function ensureInbox(
  db: D1Database,
  userId: string
): Promise<Agent> {
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO agents (id, slug, title, virtual, user_id, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT (user_id, slug) WHERE slug IS NOT NULL DO NOTHING`
    )
    .bind(newId(), INBOX_SLUG, INBOX_TITLE, userId, timestamp, timestamp)
    .run()
  const row = await db
    .prepare("SELECT * FROM agents WHERE user_id = ? AND slug = ?")
    .bind(userId, INBOX_SLUG)
    .first<AgentRow>()
  if (!row) throw new Error("Failed to create the default agent")
  return hydrate(row)
}

export async function create(
  db: D1Database,
  params: { userId: string } & AgentFields
): Promise<Agent> {
  const id = newId()
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO agents
         (id, title, description, tags, avatar, background_color, system_role,
          model, params, chat_config, opening_message, opening_questions,
          pinned, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.title ?? "Untitled agent",
      params.description ?? null,
      stringifyJson(params.tags ?? []),
      params.avatar ?? null,
      params.backgroundColor ?? null,
      params.systemRole ?? null,
      params.model ?? null,
      stringifyJson(params.params ?? {}),
      stringifyJson(params.chatConfig ?? {}),
      params.openingMessage ?? null,
      stringifyJson(params.openingQuestions ?? []),
      Number(params.pinned ?? false),
      params.userId,
      timestamp,
      timestamp
    )
    .run()
  const agent = await findOwned(db, id, params.userId)
  if (!agent) throw new Error("Failed to create agent")
  return agent
}

/** Fields left out are kept; fields given (including null) replace the old value. */
export async function update(
  db: D1Database,
  params: { id: string; userId: string } & AgentFields
): Promise<Agent | null> {
  const existing = await findOwned(db, params.id, params.userId)
  if (!existing) return null
  const next = {
    title: params.title ?? existing.title,
    description:
      params.description === undefined
        ? existing.description
        : params.description,
    avatar: params.avatar === undefined ? existing.avatar : params.avatar,
    backgroundColor:
      params.backgroundColor === undefined
        ? existing.backgroundColor
        : params.backgroundColor,
    tags: params.tags ?? existing.tags,
    systemRole:
      params.systemRole === undefined ? existing.systemRole : params.systemRole,
    model: params.model === undefined ? existing.model : params.model,
    params: params.params ?? existing.params,
    chatConfig: params.chatConfig ?? existing.chatConfig,
    openingMessage:
      params.openingMessage === undefined
        ? existing.openingMessage
        : params.openingMessage,
    openingQuestions: params.openingQuestions ?? existing.openingQuestions,
    pinned: params.pinned ?? existing.pinned,
  }
  await db
    .prepare(
      `UPDATE agents
       SET title = ?, description = ?, tags = ?, avatar = ?,
           background_color = ?, system_role = ?, model = ?, params = ?,
           chat_config = ?, opening_message = ?, opening_questions = ?,
           pinned = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .bind(
      next.title,
      next.description,
      stringifyJson(next.tags),
      next.avatar,
      next.backgroundColor,
      next.systemRole,
      next.model,
      stringifyJson(next.params),
      stringifyJson(next.chatConfig),
      next.openingMessage,
      stringifyJson(next.openingQuestions),
      Number(next.pinned),
      now(),
      params.id,
      params.userId
    )
    .run()
  return await findOwned(db, params.id, params.userId)
}

export async function remove(
  db: D1Database,
  id: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM agents WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

/** Which of `ids` are agents this user owns (at most 50 ids per call). */
export async function ownedIds(
  db: D1Database,
  userId: string,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { results } = await db
    .prepare(
      `SELECT id FROM agents
       WHERE user_id = ? AND id IN (${ids.map(() => "?").join(", ")})`
    )
    .bind(userId, ...ids)
    .all<{ id: string }>()
  return new Set((results ?? []).map((row) => row.id))
}
