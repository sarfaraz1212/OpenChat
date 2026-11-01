import { useEffect, useState, type FormEvent } from "react"
import { useNavigate, useParams } from "react-router"
import { api } from "../api"
import type { AgentGroup } from "../chat-types"
import { AgentAvatar } from "../components/AgentAvatar"
import { useShell } from "../components/AppShell"
import { ConfirmButton } from "../components/ConfirmButton"
import { Icon } from "../components/Icon"
import { useWorkspace } from "../workspace"

/** An agent group: its name and which agents belong to it. */
export function GroupPage() {
  const { groupId = "" } = useParams()
  const navigate = useNavigate()
  const shell = useShell()
  const { agents, refreshGroups } = useWorkspace()
  const [group, setGroup] = useState<AgentGroup | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [toAdd, setToAdd] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    api.agentGroup.get
      .query({ id: groupId })
      .then((loaded) => {
        if (cancelled) return
        setGroup(loaded)
        setTitle(loaded.title ?? "")
        setDescription(loaded.description ?? "")
      })
      .catch(() => {
        if (!cancelled) setError("That group could not be found.")
      })
    return () => {
      cancelled = true
    }
  }, [groupId])

  async function run(action: () => Promise<AgentGroup | void>) {
    setError("")
    try {
      const next = await action()
      if (next) setGroup(next)
      await refreshGroups()
    } catch {
      setError("That change could not be saved.")
    }
  }

  const memberIds = new Set(group?.members.map((member) => member.id))
  const candidates = agents.filter(
    (agent) => !agent.virtual && !memberIds.has(agent.id)
  )

  function saveDetails(event: FormEvent) {
    event.preventDefault()
    void run(() =>
      api.agentGroup.update.mutate({
        id: groupId,
        title: title.trim() || "Untitled group",
        description: description.trim() || null,
      })
    )
  }

  return (
    <section className="conversation settings-page">
      <header className="chat-header">
        <button
          className="menu-button"
          type="button"
          onClick={shell.openSidebar}
          aria-label="Open menu"
        >
          <Icon name="menu" size={18} />
        </button>
        <div>
          <strong>{group?.title || "Group"}</strong>
          <span className="model-identity">Agent group</span>
        </div>
      </header>
      <div className="settings-body">
        {error && <p className="chat-error">{error}</p>}
        {!group && !error && <p className="panel-note">Loading…</p>}
        {group && (
          <>
            <form className="form-card" onSubmit={saveDetails}>
              <label className="field">
                Name
                <input
                  value={title}
                  maxLength={100}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="field">
                Description
                <input
                  value={description}
                  maxLength={1000}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div className="form-actions">
                <button className="primary-button">Save</button>
                <ConfirmButton
                  label="Delete group"
                  confirmLabel="Delete group (agents are kept)"
                  onConfirm={() =>
                    void run(async () => {
                      await api.agentGroup.remove.mutate({ id: groupId })
                      navigate("/")
                    })
                  }
                />
              </div>
            </form>

            <div className="form-card">
              <h2 className="card-title">
                Members <span>{group.members.length}</span>
              </h2>
              <ul className="member-list">
                {group.members.map((member) => (
                  <li key={member.id}>
                    <AgentAvatar
                      agent={{ ...member, virtual: false }}
                      size={28}
                    />
                    <span>{member.title || "Untitled agent"}</span>
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`Remove ${member.title ?? "agent"}`}
                      onClick={() =>
                        void run(() =>
                          api.agentGroup.removeAgent.mutate({
                            id: groupId,
                            agentId: member.id,
                          })
                        )
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
                {group.members.length === 0 && (
                  <li className="panel-note">No agents in this group yet.</li>
                )}
              </ul>
              <div className="add-member">
                <select
                  aria-label="Agent to add"
                  value={toAdd}
                  onChange={(event) => setToAdd(event.target.value)}
                >
                  <option value="">Add an agent…</option>
                  {candidates.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!toAdd}
                  onClick={() => {
                    const agentId = toAdd
                    setToAdd("")
                    void run(() =>
                      api.agentGroup.addAgents.mutate({
                        id: groupId,
                        agentIds: [agentId],
                      })
                    )
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
