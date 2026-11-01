import { newId, now, toBool } from "./client"
import type { ChatGroup, ChatGroupMember, ChatGroupRow } from "./types"

type MemberRow = {
  chat_group_id: string
  id: string
  title: string | null
  avatar: string | null
  background_color: string | null
  enabled: number
  role: string
}

const hydrate = (row: ChatGroupRow, members: ChatGroupMember[]): ChatGroup => ({
  id: row.id,
  title: row.title,
  description: row.description,
  avatar: row.avatar,
  backgroundColor: row.background_color,
  pinned: toBool(row.pinned),
  members,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/** Members of the user's groups (or of one group), keyed by group id, in order. */
async function membersByGroup(
  db: D1Database,
  userId: string,
  groupId?: string
): Promise<Map<string, ChatGroupMember[]>> {
  const { results } = await db
    .prepare(
      `SELECT m.chat_group_id, a.id, a.title, a.avatar, a.background_color,
              m.enabled, m.role
       FROM chat_groups_agents m
       JOIN agents a ON a.id = m.agent_id
       WHERE m.user_id = ? AND (? IS NULL OR m.chat_group_id = ?)
       ORDER BY m.chat_group_id, m.position ASC, m.created_at ASC`
    )
    .bind(userId, groupId ?? null, groupId ?? null)
    .all<MemberRow>()
  const byGroup = new Map<string, ChatGroupMember[]>()
  for (const row of results ?? []) {
    const members = byGroup.get(row.chat_group_id) ?? []
    members.push({
      id: row.id,
      title: row.title,
      avatar: row.avatar,
      backgroundColor: row.background_color,
      enabled: toBool(row.enabled),
      role: row.role,
    })
    byGroup.set(row.chat_group_id, members)
  }
  return byGroup
}

export async function listForUser(
  db: D1Database,
  userId: string
): Promise<ChatGroup[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM chat_groups WHERE user_id = ?
       ORDER BY pinned DESC, updated_at DESC`
    )
    .bind(userId)
    .all<ChatGroupRow>()
  const members = await membersByGroup(db, userId)
  return (results ?? []).map((row) => hydrate(row, members.get(row.id) ?? []))
}

export async function findOwned(
  db: D1Database,
  id: string,
  userId: string
): Promise<ChatGroup | null> {
  const row = await db
    .prepare("SELECT * FROM chat_groups WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<ChatGroupRow>()
  if (!row) return null
  const members = await membersByGroup(db, userId, id)
  return hydrate(row, members.get(id) ?? [])
}

export async function create(
  db: D1Database,
  params: {
    userId: string
    title?: string
    description?: string | null
    avatar?: string | null
    backgroundColor?: string | null
    pinned?: boolean
    agentIds?: string[]
  }
): Promise<ChatGroup> {
  const id = newId()
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO chat_groups
         (id, title, description, avatar, background_color, pinned, user_id,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.title ?? "Untitled group",
      params.description ?? null,
      params.avatar ?? null,
      params.backgroundColor ?? null,
      Number(params.pinned ?? false),
      params.userId,
      timestamp,
      timestamp
    )
    .run()
  if (params.agentIds?.length) {
    await addAgents(db, {
      groupId: id,
      userId: params.userId,
      agentIds: params.agentIds,
    })
  }
  const group = await findOwned(db, id, params.userId)
  if (!group) throw new Error("Failed to create group")
  return group
}

/** Fields left out are kept; fields given (including null) replace the old value. */
export async function update(
  db: D1Database,
  params: {
    id: string
    userId: string
    title?: string
    description?: string | null
    avatar?: string | null
    backgroundColor?: string | null
    pinned?: boolean
  }
): Promise<ChatGroup | null> {
  const existing = await findOwned(db, params.id, params.userId)
  if (!existing) return null
  await db
    .prepare(
      `UPDATE chat_groups
       SET title = ?, description = ?, avatar = ?, background_color = ?,
           pinned = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .bind(
      params.title ?? existing.title,
      params.description === undefined
        ? existing.description
        : params.description,
      params.avatar === undefined ? existing.avatar : params.avatar,
      params.backgroundColor === undefined
        ? existing.backgroundColor
        : params.backgroundColor,
      Number(params.pinned ?? existing.pinned),
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
    .prepare("DELETE FROM chat_groups WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

/**
 * Append agents after the current members; agents already in the group stay
 * where they are. The caller must have checked that the user owns both the
 * group and every agent.
 */
export async function addAgents(
  db: D1Database,
  params: { groupId: string; userId: string; agentIds: string[] }
): Promise<void> {
  const timestamp = now()
  await db.batch([
    ...params.agentIds.map((agentId) =>
      db
        .prepare(
          `INSERT INTO chat_groups_agents
             (chat_group_id, agent_id, user_id, position, created_at, updated_at)
           VALUES (?, ?, ?,
             (SELECT COALESCE(MAX(position), -1) + 1
                FROM chat_groups_agents WHERE chat_group_id = ?),
             ?, ?)
           ON CONFLICT (chat_group_id, agent_id) DO NOTHING`
        )
        .bind(
          params.groupId,
          agentId,
          params.userId,
          params.groupId,
          timestamp,
          timestamp
        )
    ),
    db
      .prepare("UPDATE chat_groups SET updated_at = ? WHERE id = ?")
      .bind(timestamp, params.groupId),
  ])
}

export async function removeAgent(
  db: D1Database,
  params: { groupId: string; userId: string; agentId: string }
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `DELETE FROM chat_groups_agents
         WHERE chat_group_id = ? AND agent_id = ? AND user_id = ?`
      )
      .bind(params.groupId, params.agentId, params.userId),
    db
      .prepare("UPDATE chat_groups SET updated_at = ? WHERE id = ?")
      .bind(now(), params.groupId),
  ])
}
