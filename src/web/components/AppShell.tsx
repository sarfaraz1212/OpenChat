import { useState } from "react"
import { Outlet, useNavigate, useOutletContext, useParams } from "react-router"
import { api } from "../api"
import type { CurrentUser } from "../chat-types"
import { useSession } from "../session"
import { useWorkspace, WorkspaceProvider } from "../workspace"
import { AuthScreen } from "./AuthScreen"
import { Sidebar } from "./Sidebar"

/** What pages rendered in the shell can ask of it. */
export type ShellContext = { openSidebar: () => void }

export const useShell = () => useOutletContext<ShellContext>()

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

function Frame({ user }: { user: CurrentUser }) {
  const session = useSession()
  const navigate = useNavigate()
  const { topicId, agentId, groupId } = useParams()
  const workspace = useWorkspace()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [error, setError] = useState("")

  const activeAgentId =
    agentId ??
    workspace.topics.find((topic) => topic.id === topicId)?.agent_id ??
    undefined

  async function attempt(action: () => Promise<void>, fallback: string) {
    setError("")
    try {
      await action()
    } catch (cause) {
      setError(message(cause, fallback))
    }
  }

  const removeTopic = (id: string) =>
    attempt(async () => {
      await api.topic.remove.mutate({ id })
      workspace.removeTopic(id)
      if (topicId === id) navigate("/")
    }, "Could not delete the chat.")

  const createAgent = () =>
    attempt(async () => {
      const agent = await api.agent.create.mutate({})
      await workspace.refreshAgents()
      setSidebarOpen(false)
      navigate(`/agent/${agent.id}/profile`)
    }, "Could not create the agent.")

  const createGroup = () =>
    attempt(async () => {
      const group = await api.agentGroup.create.mutate({})
      await workspace.refreshGroups()
      setSidebarOpen(false)
      navigate(`/group/${group.id}`)
    }, "Could not create the group.")

  const signOut = () =>
    attempt(async () => {
      await session.signOut()
      navigate("/")
    }, "Could not sign out.")

  return (
    <main
      className={`chat-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}
    >
      <Sidebar
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        user={user}
        topicId={topicId}
        activeAgentId={activeAgentId}
        groupId={groupId}
        topics={workspace.topics}
        agents={workspace.agents}
        groups={workspace.groups}
        error={error}
        onClose={() => setSidebarOpen(false)}
        onCollapse={() => setSidebarCollapsed(true)}
        onCreateAgent={() => void createAgent()}
        onCreateGroup={() => void createGroup()}
        onRemoveTopic={(id) => void removeTopic(id)}
        onSignOut={() => void signOut()}
      />
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Outlet
        context={{
          openSidebar: () => {
            setSidebarCollapsed(false)
            setSidebarOpen(true)
          },
        }}
      />
    </main>
  )
}

/** Layout route: signs the visitor in, then frames every page with the sidebar. */
export function AppShell() {
  const session = useSession()

  if (session.user === undefined) {
    return <main className="loading-page">Opening OpenChat…</main>
  }
  if (!session.user) {
    return <AuthScreen onSignedIn={session.signedIn} />
  }
  return (
    <WorkspaceProvider>
      <Frame user={session.user} />
    </WorkspaceProvider>
  )
}
