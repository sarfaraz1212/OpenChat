import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router"
import { api } from "../api"
import type { GoalSummary } from "../chat-types"
import { useShell } from "../components/AppShell"
import { Icon } from "../components/Icon"

export const GOAL_STATUS: Record<GoalSummary["status"], string> = {
  planning: "Not started",
  running: "Running",
  paused: "Needs you",
  achieved: "Achieved",
  failed: "Failed",
  stopped: "Stopped",
}

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

/** Goals: describe an outcome, and a manager plans and runs the tasks for it. */
export function Goals() {
  const shell = useShell()
  const navigate = useNavigate()
  const [goals, setGoals] = useState<GoalSummary[] | null>(null)
  const [title, setTitle] = useState("")
  const [requirement, setRequirement] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    setGoals(await api.goal.list.query())
  }, [])

  useEffect(() => {
    void reload().catch(() => setError("Could not load your goals."))
  }, [reload])

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setError("")
    try {
      const goal = await api.goal.create.mutate({
        title: title.trim(),
        requirement: requirement.trim() || null,
      })
      navigate(`/goal/${goal.id}`)
    } catch (cause) {
      setError(message(cause, "Could not create the goal."))
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
          <strong>Goals</strong>
          <span className="model-identity">
            Describe an outcome; a manager plans and runs the work
          </span>
        </div>
      </header>
      <div className="settings-body">
        {error && <p className="chat-error">{error}</p>}

        <form className="form-card" onSubmit={(event) => void create(event)}>
          <h2 className="card-title">New goal</h2>
          <label className="field">
            What do you want done?
            <input
              value={title}
              maxLength={200}
              placeholder="Research and summarise…"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            What counts as done <span>optional</span>
            <textarea
              rows={3}
              value={requirement}
              maxLength={4000}
              placeholder="A one-page summary with three sources…"
              onChange={(event) => setRequirement(event.target.value)}
            />
          </label>
          <div className="form-actions">
            <button className="primary-button" disabled={busy || !title.trim()}>
              {busy ? "Creating…" : "Create goal"}
            </button>
          </div>
        </form>

        {goals === null && !error && <p className="panel-note">Loading…</p>}
        {goals && goals.length === 0 && (
          <p className="panel-note">No goals yet.</p>
        )}
        {goals && goals.length > 0 && (
          <ul className="goal-list">
            {goals.map((goal) => (
              <li key={goal.id}>
                <Link to={`/goal/${goal.id}`} className="goal-row">
                  <span className="goal-row-copy">
                    <strong>{goal.title}</strong>
                    <span>
                      {goal.rounds} of {goal.maxRounds} rounds
                      {goal.statusReason ? ` · ${goal.statusReason}` : ""}
                    </span>
                  </span>
                  <span className={`status-pill goal-${goal.status}`}>
                    {GOAL_STATUS[goal.status]}
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
