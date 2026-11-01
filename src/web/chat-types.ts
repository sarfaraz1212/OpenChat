import { api } from "./api"

export type CurrentUser = {
  id: string
  email: string
  display_name: string | null
}

export type Topic = Awaited<ReturnType<typeof api.topic.list.query>>[number]
export type TopicDetail = Awaited<ReturnType<typeof api.topic.get.query>>
export type Message = TopicDetail["messages"][number]

export type AiProvider = Awaited<
  ReturnType<typeof api.aiProvider.list.query>
>[number]
export type AiModel = Awaited<ReturnType<typeof api.aiModel.list.query>>[number]
export type RuntimeState = Awaited<
  ReturnType<typeof api.aiInfra.runtimeState.query>
>

export type Agent = Awaited<ReturnType<typeof api.agent.list.query>>[number]
export type AgentGroup = Awaited<
  ReturnType<typeof api.agentGroup.list.query>
>[number]

export type KnowledgeFile = Awaited<
  ReturnType<typeof api.file.list.query>
>[number]
export type KnowledgeBase = Awaited<
  ReturnType<typeof api.knowledgeBase.list.query>
>[number]

export type Memory = Awaited<ReturnType<typeof api.memory.list.query>>[number]
export type Persona = NonNullable<
  Awaited<ReturnType<typeof api.memory.persona.query>>
>

export type GoalSummary = Awaited<
  ReturnType<typeof api.goal.list.query>
>[number]
export type GoalDetail = Awaited<ReturnType<typeof api.goal.get.query>>

export type UsageOverview = Awaited<ReturnType<typeof api.usage.overview.query>>
export type UsageModel = Awaited<
  ReturnType<typeof api.usage.byModel.query>
>[number]
export type UsageAgent = Awaited<
  ReturnType<typeof api.usage.byAgent.query>
>[number]
export type UsageDay = Awaited<ReturnType<typeof api.usage.daily.query>>[number]
export type UsageTopic = Awaited<
  ReturnType<typeof api.usage.byTopic.query>
>[number]

export type GeneratedImage = Awaited<
  ReturnType<typeof api.image.list.query>
>[number]

export type ResearchSummary = Awaited<
  ReturnType<typeof api.research.list.query>
>[number]
export type ResearchSession = Awaited<ReturnType<typeof api.research.get.query>>

export type Account = Awaited<ReturnType<typeof api.account.get.query>>
