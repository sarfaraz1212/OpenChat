import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router"
import { CHAT_MODEL_INFOS } from "../../shared/models"
import { api } from "../api"
import type { ResearchSummary } from "../chat-types"
import { useShell } from "../components/AppShell"
import { Icon } from "../components/Icon"
import { modelName } from "../components/ModelSwitchPanel"

export const RESEARCH_STATUS: Record<ResearchSummary["status"], string> = {
  in_progress: "Researching",
  completed: "Done",
  failed: "Failed",
}

const DEPTHS = [
  { id: "standard", label: "Standard", note: "About 10 pages" },
  { id: "deep", label: "Deep", note: "About 15 pages, bigger model" },
] as const

/** Only models that call tools cleanly can drive the search and read loop. */
const TOOL_MODELS = CHAT_MODEL_INFOS.filter(
  (model) => model.abilities.functionCall
)

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

/** Deep Research: a topic in, a cited report out, produced in the background. */
export function DeepResearch() {
  const shell = useShell()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<ResearchSummary[] | null>(null)
  const [topic, setTopic] = useState("")
  const [depth, setDepth] = useState<"standard" | "deep">("standard")
  const [model, setModel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    setSessions(await api.research.list.query())
  }, [])

  useEffect(() => {
    void reload().catch(() => setError("Could not load your research."))
  }, [reload])

  async function start(event: FormEvent) {
    event.preventDefault()
    if (!topic.trim() || busy) return
    setBusy(true)
    setError("")
    try {
      const session = await api.research.start.mutate({
        topic,
        depth,
        model: model || undefined,
      })
      navigate(`/deep-research/${session.id}`)
    } catch (cause) {
      setError(message(cause, "Could not start the research."))
      setBusy(false)
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
          <strong>Deep Research</strong>
          <span className="model-identity">
            Searches the web, reads sources, and writes a cited report
          </span>
        </div>
      </header>
      <div className="settings-body wide">
        {error && <p className="chat-error">{error}</p>}

        <form className="form-card" onSubmit={(event) => void start(event)}>
          <h2 className="card-title">New research</h2>
          <label className="field">
            What do you want to know?
            <textarea
              rows={4}
              value={topic}
              maxLength={4000}
              placeholder="How fast are solar module prices falling, and why?"
              onChange={(event) => setTopic(event.target.value)}
            />
          </label>
          <div className="field">
            Depth
            <div className="segmented" role="group" aria-label="Depth">
              {DEPTHS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={depth === option.id}
                  className={depth === option.id ? "active" : ""}
                  onClick={() => setDepth(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span>{DEPTHS.find((option) => option.id === depth)?.note}</span>
          </div>
          <label className="field">
            Model
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="">Automatic for this depth</option>
              {TOOL_MODELS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button className="primary-button" disabled={busy || !topic.trim()}>
              {busy ? "Starting…" : "Start research"}
            </button>
          </div>
        </form>

        {sessions === null && !error && <p className="panel-note">Loading…</p>}
        {sessions?.length === 0 && (
          <p className="panel-note">
            No research yet. Your reports appear here.
          </p>
        )}
        {sessions && sessions.length > 0 && (
          <ul className="goal-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <Link to={`/deep-research/${session.id}`} className="goal-row">
                  <span className="goal-row-copy">
                    <strong>{session.topic}</strong>
                    <span>
                      {session.depth === "deep" ? "Deep" : "Standard"} ·{" "}
                      {modelName(session.model)} ·{" "}
                      {new Date(session.createdAt).toLocaleString()}
                    </span>
                  </span>
                  <span className={`status-pill research-${session.status}`}>
                    {RESEARCH_STATUS[session.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
