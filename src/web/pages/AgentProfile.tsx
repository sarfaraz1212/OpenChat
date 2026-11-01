import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { CHAT_MODEL_INFOS } from "../../shared/models"
import { api } from "../api"
import type { Agent } from "../chat-types"
import { AgentAvatar } from "../components/AgentAvatar"
import { AgentKnowledge } from "../components/AgentKnowledge"
import { useShell } from "../components/AppShell"
import { ConfirmButton } from "../components/ConfirmButton"
import { Icon } from "../components/Icon"
import { useWorkspace } from "../workspace"

type Form = {
  title: string
  description: string
  avatar: string
  backgroundColor: string
  tags: string
  systemRole: string
  model: string
  temperature: string
  topP: string
  maxTokens: string
  historyCount: string
  sandbox: boolean
  openingMessage: string
  openingQuestions: string
  pinned: boolean
}

const toForm = (agent: Agent): Form => ({
  title: agent.title ?? "",
  description: agent.description ?? "",
  avatar: agent.avatar ?? "",
  backgroundColor: agent.backgroundColor ?? "",
  tags: agent.tags.join(", "),
  systemRole: agent.systemRole ?? "",
  model: agent.model ?? "",
  temperature: agent.params.temperature?.toString() ?? "",
  topP: agent.params.topP?.toString() ?? "",
  maxTokens: agent.params.maxTokens?.toString() ?? "",
  historyCount: agent.chatConfig.historyCount?.toString() ?? "",
  sandbox: agent.chatConfig.sandbox === true,
  openingMessage: agent.openingMessage ?? "",
  openingQuestions: agent.openingQuestions.join("\n"),
  pinned: agent.pinned,
})

const optionalNumber = (value: string) =>
  value.trim() === "" ? undefined : Number(value)
const orNull = (value: string) => value.trim() || null
const lines = (value: string, separator: RegExp) =>
  value
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean)

/** The agent editor: persona, model, sampling parameters and opening prompts. */
export function AgentProfile() {
  const { agentId = "" } = useParams()
  const navigate = useNavigate()
  const shell = useShell()
  const { refreshAgents, refreshTopics } = useWorkspace()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    api.agent.get
      .query({ id: agentId })
      .then((loaded) => {
        if (cancelled) return
        setAgent(loaded)
        setForm(toForm(loaded))
      })
      .catch(() => {
        if (!cancelled) setError("That agent could not be found.")
      })
    return () => {
      cancelled = true
    }
  }, [agentId])

  const selectedModel =
    CHAT_MODEL_INFOS.find((model) => model.id === form?.model) ??
    CHAT_MODEL_INFOS[0]
  const canCallTools = selectedModel.abilities.functionCall === true

  const set = (patch: Partial<Form>) => {
    setSaved(false)
    setForm((current) => (current ? { ...current, ...patch } : current))
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    setBusy(true)
    setError("")
    try {
      const updated = await api.agent.update.mutate({
        id: agentId,
        title: form.title.trim() || "Untitled agent",
        description: orNull(form.description),
        avatar: orNull(form.avatar),
        backgroundColor: orNull(form.backgroundColor),
        tags: lines(form.tags, /,/),
        systemRole: orNull(form.systemRole),
        model: (form.model || null) as Agent["model"],
        params: {
          temperature: optionalNumber(form.temperature),
          topP: optionalNumber(form.topP),
          maxTokens: optionalNumber(form.maxTokens),
        },
        chatConfig: {
          historyCount: optionalNumber(form.historyCount),
          sandbox: form.sandbox || undefined,
        },
        openingMessage: orNull(form.openingMessage),
        openingQuestions: lines(form.openingQuestions, /\n/),
        pinned: form.pinned,
      })
      setAgent(updated)
      setSaved(true)
      await refreshAgents()
    } catch {
      setError("Could not save. Check the values and try again.")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!agent) return
    try {
      await api.agent.remove.mutate({ id: agent.id })
      await Promise.all([refreshAgents(), refreshTopics()])
      navigate("/")
    } catch {
      setError("Could not delete this agent.")
    }
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
          <strong>{agent?.title || "Agent"}</strong>
          <span className="model-identity">Agent profile</span>
        </div>
      </header>
      <div className="settings-body">
        {error && <p className="chat-error">{error}</p>}
        {!form && !error && <p className="panel-note">Loading…</p>}
        {agent && form && (
          <>
            <form className="form-card" onSubmit={(event) => void save(event)}>
              <div className="form-head">
                <AgentAvatar
                  agent={{
                    ...agent,
                    avatar: form.avatar || null,
                    backgroundColor: form.backgroundColor || null,
                    title: form.title,
                  }}
                  size={48}
                />
                <div className="form-head-actions">
                  <Link className="link-button" to={`/agent/${agent.id}`}>
                    Start a chat →
                  </Link>
                </div>
              </div>

              <div className="field-row">
                <label className="field">
                  Name
                  <input
                    value={form.title}
                    maxLength={100}
                    onChange={(event) => set({ title: event.target.value })}
                  />
                </label>
                <label className="field field-small">
                  Avatar
                  <input
                    value={form.avatar}
                    maxLength={8}
                    placeholder="🙂"
                    onChange={(event) => set({ avatar: event.target.value })}
                  />
                </label>
                <label className="field field-small">
                  Colour
                  <input
                    type="color"
                    value={form.backgroundColor || "#29b99f"}
                    onChange={(event) =>
                      set({ backgroundColor: event.target.value })
                    }
                  />
                </label>
              </div>

              <label className="field">
                Description
                <input
                  value={form.description}
                  maxLength={1000}
                  onChange={(event) => set({ description: event.target.value })}
                />
              </label>
              <label className="field">
                Tags <span>comma separated</span>
                <input
                  value={form.tags}
                  onChange={(event) => set({ tags: event.target.value })}
                />
              </label>
              <label className="field">
                System prompt
                <textarea
                  rows={7}
                  value={form.systemRole}
                  maxLength={20000}
                  placeholder="You are…"
                  onChange={(event) => set({ systemRole: event.target.value })}
                />
              </label>

              <label className="field">
                Model
                <select
                  value={form.model}
                  onChange={(event) => set({ model: event.target.value })}
                >
                  <option value="">Default ({CHAT_MODEL_INFOS[0].name})</option>
                  {CHAT_MODEL_INFOS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} · {model.author}
                    </option>
                  ))}
                </select>
              </label>

              <div className="field-row">
                <label className="field">
                  Temperature <span>0–2</span>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={form.temperature}
                    onChange={(event) =>
                      set({ temperature: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Top P <span>0–1</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={form.topP}
                    onChange={(event) => set({ topP: event.target.value })}
                  />
                </label>
                <label className="field">
                  Max tokens
                  <input
                    type="number"
                    min={1}
                    max={16384}
                    value={form.maxTokens}
                    onChange={(event) => set({ maxTokens: event.target.value })}
                  />
                </label>
                <label className="field">
                  History <span>last N messages</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={form.historyCount}
                    onChange={(event) =>
                      set({ historyCount: event.target.value })
                    }
                  />
                </label>
              </div>

              <label className="field">
                Opening message
                <textarea
                  rows={2}
                  value={form.openingMessage}
                  maxLength={4000}
                  onChange={(event) =>
                    set({ openingMessage: event.target.value })
                  }
                />
              </label>
              <label className="field">
                Opening questions <span>one per line, up to 8</span>
                <textarea
                  rows={3}
                  value={form.openingQuestions}
                  onChange={(event) =>
                    set({ openingQuestions: event.target.value })
                  }
                />
              </label>

              <div className="sandbox-setting">
                <label className="field-check">
                  <input
                    type="checkbox"
                    checked={form.sandbox}
                    onChange={(event) => set({ sandbox: event.target.checked })}
                  />
                  Let this agent run code in a secure sandbox
                </label>
                <p className="panel-note flush">
                  Each conversation gets its own isolated Linux container where
                  the agent can run Python, Node and shell commands and work
                  with files. It needs a model that can call tools.
                </p>
                {form.sandbox && !canCallTools && (
                  <p className="chat-error">
                    {selectedModel.name} has not been verified to call tools, so
                    the sandbox will stay off for it. Pick a model tagged
                    “Tools”, such as GPT-OSS, DeepSeek V4 or Gemma 4.
                  </p>
                )}
              </div>

              <label className="field-check">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  disabled={agent.virtual}
                  onChange={(event) => set({ pinned: event.target.checked })}
                />
                Pin to the top of the list
              </label>

              <div className="form-actions">
                <button className="primary-button" disabled={busy}>
                  {busy ? "Saving…" : "Save changes"}
                </button>
                {saved && <span className="saved-note">Saved</span>}
                {!agent.virtual && (
                  <ConfirmButton
                    label="Delete agent"
                    confirmLabel="Delete agent and its chats"
                    onConfirm={() => void remove()}
                  />
                )}
              </div>
            </form>
            <AgentKnowledge agentId={agent.id} />
          </>
        )}
      </div>
    </section>
  )
}
