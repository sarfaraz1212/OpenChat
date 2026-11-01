import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { api } from "./api"
import type { Agent, AgentGroup, Topic } from "./chat-types"

type WorkspaceState = {
  topics: Topic[]
  agents: Agent[]
  groups: AgentGroup[]
  refreshTopics: () => Promise<void>
  refreshAgents: () => Promise<void>
  refreshGroups: () => Promise<void>
  addTopic: (topic: Topic) => void
  removeTopic: (id: string) => void
}

const WorkspaceContext = createContext<WorkspaceState | null>(null)

/** The signed-in user's topics, agents and groups, shared by sidebar and pages. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [groups, setGroups] = useState<AgentGroup[]>([])

  const refreshTopics = useCallback(async () => {
    setTopics(await api.topic.list.query())
  }, [])
  const refreshAgents = useCallback(async () => {
    setAgents(await api.agent.list.query())
  }, [])
  const refreshGroups = useCallback(async () => {
    setGroups(await api.agentGroup.list.query())
  }, [])

  useEffect(() => {
    for (const refresh of [refreshTopics, refreshAgents, refreshGroups]) {
      void refresh().catch(() => undefined)
    }
  }, [refreshTopics, refreshAgents, refreshGroups])

  const value = useMemo<WorkspaceState>(
    () => ({
      topics,
      agents,
      groups,
      refreshTopics,
      refreshAgents,
      refreshGroups,
      addTopic: (topic) => setTopics((current) => [topic, ...current]),
      removeTopic: (id) =>
        setTopics((current) => current.filter((item) => item.id !== id)),
    }),
    [topics, agents, groups, refreshTopics, refreshAgents, refreshGroups]
  )

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>
}

export function useWorkspace(): WorkspaceState {
  const state = useContext(WorkspaceContext)
  if (!state) throw new Error("useWorkspace needs a WorkspaceProvider")
  return state
}
