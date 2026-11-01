/**
 * Row types for the D1 schema (migrations/0001_initial_schema.sql).
 *
 * Two conventions matter:
 *   * `*Row` types mirror storage exactly — booleans are 0/1, JSON is a string.
 *   * The un-suffixed types are what repositories return, with booleans and JSON
 *     already coerced. Routes only ever see these.
 *
 * Only the tables the current phase touches are typed here; each later phase
 * adds the row types for the tables it introduces.
 */

export type UserRow = {
  id: string
  email: string
  email_canonical: string | null
  password_hash: string | null
  anonymous: number
  display_name: string | null
  profile_image: string | null
  favorite_models: string | null
  system_prompt: string | null
  message_count: number
  onboarding_email_count: number
  relance_step: number
  opted_in_for_email_updates: number
  created_at: string
  last_active_at: string | null
  deleted_at: string | null
}

export type User = Omit<
  UserRow,
  | "anonymous"
  | "opted_in_for_email_updates"
  | "favorite_models"
  | "password_hash"
> & {
  anonymous: boolean
  opted_in_for_email_updates: boolean
  favorite_models: string[]
}

export type SessionRow = {
  id: string
  user_id: string
  expires_at: string
  created_at: string
  user_agent: string | null
}

export type TopicRow = {
  id: string
  title: string | null
  favorite: number
  content: string | null
  description: string | null
  metadata: string | null
  status: "active" | "archived"
  model: string | null
  provider: string
  agent_id: string | null
  user_id: string
  created_at: string
  updated_at: string
}

export type Topic = Omit<TopicRow, "favorite" | "metadata"> & {
  favorite: boolean
  metadata: unknown
}

export type MessageRow = {
  id: string
  role: "system" | "user" | "assistant"
  content: string | null
  metadata: string | null
  usage: string | null
  model: string | null
  provider: string
  favorite: number
  error: string | null
  user_id: string
  topic_id: string
  parent_id: string | null
  created_at: string
  updated_at: string
}

export type Message = Omit<
  MessageRow,
  "metadata" | "usage" | "error" | "favorite"
> & {
  metadata: unknown
  usage: unknown
  error: unknown
  favorite: boolean
}

export type AgentRow = {
  id: string
  slug: string | null
  title: string | null
  description: string | null
  tags: string
  avatar: string | null
  background_color: string | null
  system_role: string | null
  model: string | null
  provider: string
  params: string | null
  chat_config: string | null
  opening_message: string | null
  opening_questions: string
  pinned: number
  virtual: number
  user_id: string
  created_at: string
  updated_at: string
}

/** Sampling parameters an agent applies to every turn. */
export type AgentParams = {
  temperature?: number
  topP?: number
  maxTokens?: number
}

export type AgentChatConfig = {
  /** Send only the last N messages to the model; absent means all of them. */
  historyCount?: number
  /** Let the agent run code in a sandbox (needs a tool-calling model). */
  sandbox?: boolean
}

/**
 * Agents, groups, files and knowledge bases are exposed camelCase with JSON
 * already parsed. (Topics and messages predate this and keep their row shape.)
 */
export type Agent = {
  id: string
  slug: string | null
  title: string | null
  description: string | null
  tags: string[]
  avatar: string | null
  backgroundColor: string | null
  systemRole: string | null
  model: string | null
  provider: string
  params: AgentParams
  chatConfig: AgentChatConfig
  openingMessage: string | null
  openingQuestions: string[]
  pinned: boolean
  virtual: boolean
  createdAt: string
  updatedAt: string
}

export type ChatGroupRow = {
  id: string
  title: string | null
  description: string | null
  avatar: string | null
  background_color: string | null
  config: string | null
  pinned: number
  user_id: string
  created_at: string
  updated_at: string
}

export type ChatGroupMember = {
  id: string
  title: string | null
  avatar: string | null
  backgroundColor: string | null
  enabled: boolean
  role: string
}

/** A group of agents; `members` follow the order they were added in. */
export type ChatGroup = {
  id: string
  title: string | null
  description: string | null
  avatar: string | null
  backgroundColor: string | null
  pinned: boolean
  members: ChatGroupMember[]
  createdAt: string
  updatedAt: string
}

export type FileStatus = "pending" | "processing" | "ready" | "failed"

export type FileRow = {
  id: string
  user_id: string
  name: string
  file_type: string
  size: number
  r2_key: string
  status: FileStatus
  error: string | null
  chunk_count: number
  created_at: string
  updated_at: string
}

/** An uploaded knowledge file; the R2 key stays server-side. */
export type KnowledgeFile = {
  id: string
  name: string
  fileType: string
  size: number
  status: FileStatus
  error: string | null
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export type ChunkRow = {
  id: string
  file_id: string
  user_id: string
  chunk_index: number
  text: string
  created_at: string
}

export type KnowledgeBaseRow = {
  id: string
  user_id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export type KnowledgeBase = {
  id: string
  name: string
  description: string | null
  fileCount: number
  createdAt: string
  updatedAt: string
}

export type MemoryRow = {
  id: string
  user_id: string
  layer: "identity" | "preference" | "experience" | "activity" | "context"
  title: string
  summary: string
  details: string | null
  tags: string
  attributes: string
  confidence: number | null
  source_topic_id: string | null
  created_at: string
  updated_at: string
}

/** One remembered fact about the user, in one of five layers. */
export type Memory = {
  id: string
  layer: MemoryRow["layer"]
  title: string
  summary: string
  details: string | null
  tags: string[]
  attributes: Record<string, unknown>
  confidence: number | null
  sourceTopicId: string | null
  createdAt: string
  updatedAt: string
}

export type Persona = { persona: string; version: number; updatedAt: string }

export type GoalStatus =
  "planning" | "running" | "paused" | "achieved" | "failed" | "stopped"

export type GoalConfig = {
  /** Routes the tasks the manager creates to a dedicated executor agent. */
  taskAgentId?: string
  /** Cap on planning turns; defaults to 12. */
  maxManagerTurns?: number
}

export type GoalRow = {
  id: string
  user_id: string
  agent_id: string | null
  title: string
  requirement: string | null
  config: string
  max_rounds: number
  rounds: number
  manager_turns: number
  invalid_plans: number
  status: GoalStatus
  status_reason: string | null
  lease_until: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type Goal = {
  id: string
  agentId: string | null
  title: string
  requirement: string | null
  config: GoalConfig
  maxRounds: number
  rounds: number
  managerTurns: number
  invalidPlans: number
  status: GoalStatus
  statusReason: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type TaskStatus =
  "pending" | "running" | "completed" | "failed" | "canceled"

export type TaskRow = {
  id: string
  user_id: string
  goal_id: string
  agent_id: string | null
  title: string
  description: string | null
  status: TaskStatus
  result: string | null
  error: string | null
  attempts: number
  topic_id: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type Task = {
  id: string
  goalId: string
  agentId: string | null
  title: string
  description: string | null
  status: TaskStatus
  result: string | null
  error: string | null
  attempts: number
  topicId: string | null
  startedAt: string | null
  completedAt: string | null
}

export type NodeKind = "task" | "verification" | "decision"
export type NodeStatus =
  "proposed" | "ready" | "running" | "delivered" | "blocked" | "retired"

export type GoalNodeRow = {
  id: string
  goal_id: string
  kind: NodeKind
  status: NodeStatus
  title: string
  description: string | null
  task_id: string | null
  verdict: "pass" | "fail" | null
  priority: number
  round: number
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export type GoalNode = {
  id: string
  kind: NodeKind
  status: NodeStatus
  title: string
  description: string | null
  taskId: string | null
  verdict: "pass" | "fail" | null
  priority: number
  round: number
  resolvedAt: string | null
}

/** `sourceNodeId` depends on `targetNodeId`. */
export type GoalEdge = {
  id: string
  sourceNodeId: string
  targetNodeId: string
}

export type DecisionOption = { id: string; label: string }

export type GoalDecision = {
  id: string
  nodeId: string
  status: "pending" | "resolved" | "canceled"
  question: string
  options: DecisionOption[]
  recommendedOptionId: string | null
  resolvedOptionId: string | null
  resolution: string | null
  resolvedAt: string | null
  createdAt: string
}

export type GoalEvent = {
  id: string
  eventType: string
  entityType: string
  entityId: string
  actorType: "system" | "agent" | "user"
  reason: string | null
  createdAt: string
}
