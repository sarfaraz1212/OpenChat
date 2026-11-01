/**
 * Usage statistics, computed from what is stored on messages: each reply's
 * `usage` (the token counts the provider reported), its model, and the topic's
 * agent. Nothing is estimated and nothing is stored separately, so the numbers
 * are exactly as complete as that record. In particular, calls that leave no
 * message (memory extraction, goal planning and review) are not counted.
 */

export const USAGE_RANGES = ["7d", "30d", "90d", "1y", "all"] as const
export type UsageRange = (typeof USAGE_RANGES)[number]

const DAY_MS = 24 * 60 * 60 * 1000
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 } as const

export type UsageWindow = {
  /** Start of the window (UTC ISO), or null for all time. */
  since: string | null
  /** Each local day of the window, oldest first, as YYYY-MM-DD. */
  days: string[]
  /** The SQLite date modifier that shifts UTC timestamps to the user's day. */
  modifier: string
}

/**
 * The last N local days including today, in the user's timezone
 * (`tzOffsetMinutes` east of UTC). "all" has no start, and its daily series
 * shows the last year.
 */
export function usageWindow(
  range: UsageRange,
  tzOffsetMinutes: number,
  nowMs = Date.now()
): UsageWindow {
  const offsetMs = tzOffsetMinutes * 60_000
  const localToday = Math.floor((nowMs + offsetMs) / DAY_MS) * DAY_MS
  const dayCount = range === "all" ? 365 : RANGE_DAYS[range]
  const firstDay = localToday - (dayCount - 1) * DAY_MS
  return {
    since: range === "all" ? null : new Date(firstDay - offsetMs).toISOString(),
    days: Array.from({ length: dayCount }, (_, i) =>
      new Date(firstDay + i * DAY_MS).toISOString().slice(0, 10)
    ),
    modifier: `${tzOffsetMinutes >= 0 ? "+" : "-"}${Math.abs(tzOffsetMinutes)} minutes`,
  }
}

/** Token sums over the messages in scope (usage JSON may be null or empty). */
const INPUT = "COALESCE(SUM(json_extract(m.usage, '$.inputTokens')), 0)"
const OUTPUT = "COALESCE(SUM(json_extract(m.usage, '$.outputTokens')), 0)"
const TOTAL = `COALESCE(SUM(COALESCE(
  json_extract(m.usage, '$.totalTokens'),
  COALESCE(json_extract(m.usage, '$.inputTokens'), 0) +
  COALESCE(json_extract(m.usage, '$.outputTokens'), 0)
)), 0)`

export type Overview = {
  messages: number
  userMessages: number
  assistantMessages: number
  topics: number
  agents: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** Replies for which the provider reported token counts. */
  repliesWithUsage: number
}

export async function overview(
  db: D1Database,
  userId: string,
  window: UsageWindow
): Promise<Overview> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS messages,
         COALESCE(SUM(m.role = 'user'), 0) AS user_messages,
         COALESCE(SUM(m.role = 'assistant'), 0) AS assistant_messages,
         COUNT(DISTINCT CASE
           WHEN json_extract(COALESCE(t.metadata, '{}'), '$.taskId') IS NULL
           THEN m.topic_id END) AS topics,
         COUNT(DISTINCT t.agent_id) AS agents,
         ${INPUT} AS input_tokens,
         ${OUTPUT} AS output_tokens,
         ${TOTAL} AS total_tokens,
         COALESCE(SUM(m.role = 'assistant'
           AND json_extract(m.usage, '$.totalTokens') IS NOT NULL), 0)
           AS replies_with_usage
       FROM messages m JOIN topics t ON t.id = m.topic_id
       WHERE m.user_id = ? AND m.role IN ('user', 'assistant')
         AND (? IS NULL OR m.created_at >= ?)`
    )
    .bind(userId, window.since, window.since)
    .first<{
      messages: number
      user_messages: number
      assistant_messages: number
      topics: number
      agents: number
      input_tokens: number
      output_tokens: number
      total_tokens: number
      replies_with_usage: number
    }>()
  return {
    messages: row?.messages ?? 0,
    userMessages: row?.user_messages ?? 0,
    assistantMessages: row?.assistant_messages ?? 0,
    topics: row?.topics ?? 0,
    agents: row?.agents ?? 0,
    inputTokens: row?.input_tokens ?? 0,
    outputTokens: row?.output_tokens ?? 0,
    totalTokens: row?.total_tokens ?? 0,
    repliesWithUsage: row?.replies_with_usage ?? 0,
  }
}

export type ModelUsage = {
  model: string | null
  replies: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** Models ranked by the tokens their replies used. */
export async function byModel(
  db: D1Database,
  userId: string,
  window: UsageWindow
): Promise<ModelUsage[]> {
  const { results } = await db
    .prepare(
      `SELECT m.model AS model, COUNT(*) AS replies,
              ${INPUT} AS input_tokens, ${OUTPUT} AS output_tokens,
              ${TOTAL} AS total_tokens
       FROM messages m
       WHERE m.user_id = ? AND m.role = 'assistant'
         AND (? IS NULL OR m.created_at >= ?)
       GROUP BY m.model
       ORDER BY total_tokens DESC, replies DESC, m.model ASC`
    )
    .bind(userId, window.since, window.since)
    .all<{
      model: string | null
      replies: number
      input_tokens: number
      output_tokens: number
      total_tokens: number
    }>()
  return (results ?? []).map((row) => ({
    model: row.model,
    replies: row.replies,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
  }))
}

export type AgentUsage = {
  agentId: string | null
  title: string | null
  replies: number
  totalTokens: number
}

/** Agents ranked by the tokens their conversations' replies used. */
export async function byAgent(
  db: D1Database,
  userId: string,
  window: UsageWindow
): Promise<AgentUsage[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id AS agent_id, a.title AS title, COUNT(*) AS replies,
              ${TOTAL} AS total_tokens
       FROM messages m
       JOIN topics t ON t.id = m.topic_id
       LEFT JOIN agents a ON a.id = t.agent_id
       WHERE m.user_id = ? AND m.role = 'assistant'
         AND (? IS NULL OR m.created_at >= ?)
       GROUP BY a.id, a.title
       ORDER BY total_tokens DESC, replies DESC, a.title ASC`
    )
    .bind(userId, window.since, window.since)
    .all<{
      agent_id: string | null
      title: string | null
      replies: number
      total_tokens: number
    }>()
  return (results ?? []).map((row) => ({
    agentId: row.agent_id,
    title: row.title,
    replies: row.replies,
    totalTokens: row.total_tokens,
  }))
}

export type TopicUsage = {
  id: string
  title: string
  agentId: string | null
  messages: number
  totalTokens: number
}

/** How many conversations the ranking shows. */
export const TOP_TOPICS = 10

/**
 * The most active conversations by message count. A goal task's workspace is
 * not a chat and is left out, as it is from the chat list.
 */
export async function byTopic(
  db: D1Database,
  userId: string,
  window: UsageWindow
): Promise<TopicUsage[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id AS id, t.title AS title, t.agent_id AS agent_id,
              COUNT(*) AS messages, ${TOTAL} AS total_tokens
       FROM messages m JOIN topics t ON t.id = m.topic_id
       WHERE m.user_id = ? AND m.role IN ('user', 'assistant')
         AND (? IS NULL OR m.created_at >= ?)
         AND json_extract(COALESCE(t.metadata, '{}'), '$.taskId') IS NULL
       GROUP BY t.id, t.title, t.agent_id
       ORDER BY messages DESC, total_tokens DESC, t.updated_at DESC
       LIMIT ${TOP_TOPICS}`
    )
    .bind(userId, window.since, window.since)
    .all<{
      id: string
      title: string
      agent_id: string | null
      messages: number
      total_tokens: number
    }>()
  return (results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    agentId: row.agent_id,
    messages: row.messages,
    totalTokens: row.total_tokens,
  }))
}

export type DayUsage = {
  date: string
  userMessages: number
  assistantMessages: number
  totalTokens: number
}

/** One entry per day of the window, empty days included, oldest first. */
export async function daily(
  db: D1Database,
  userId: string,
  window: UsageWindow
): Promise<DayUsage[]> {
  const { results } = await db
    .prepare(
      `SELECT date(m.created_at, ?) AS day,
              COALESCE(SUM(m.role = 'user'), 0) AS user_messages,
              COALESCE(SUM(m.role = 'assistant'), 0) AS assistant_messages,
              ${TOTAL} AS total_tokens
       FROM messages m
       WHERE m.user_id = ? AND m.role IN ('user', 'assistant')
         AND (? IS NULL OR m.created_at >= ?)
       GROUP BY day`
    )
    .bind(window.modifier, userId, window.since, window.since)
    .all<{
      day: string
      user_messages: number
      assistant_messages: number
      total_tokens: number
    }>()
  const byDay = new Map((results ?? []).map((row) => [row.day, row]))
  return window.days.map((date) => {
    const row = byDay.get(date)
    return {
      date,
      userMessages: row?.user_messages ?? 0,
      assistantMessages: row?.assistant_messages ?? 0,
      totalTokens: row?.total_tokens ?? 0,
    }
  })
}
