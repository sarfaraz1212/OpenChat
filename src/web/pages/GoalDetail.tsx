import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { api } from "../api"
import type { GoalDetail as Detail } from "../chat-types"
import { useShell } from "../components/AppShell"
import { ConfirmButton } from "../components/ConfirmButton"
import { Icon } from "../components/Icon"
import { GOAL_STATUS } from "./Goals"

type GraphNode = Detail["nodes"][number]

const POLL_MS = 2500

const NODE_STATUS: Record<GraphNode["status"], string> = {
  proposed: "Waiting",
  ready: "Ready",
  running: "Running",
  delivered: "Done",
  blocked: "Needs you",
  retired: "Skipped",
}

const EVENT_LABEL: Record<string, string> = {
  goal_created: "Goal created",
  goal_started: "Started",
  goal_resumed: "Resumed",
  goal_paused: "Paused",
  goal_stopped: "Stopped",
  goal_achieved: "Achieved",
  goal_failed: "Failed",
  plan_applied: "Plan",
  plan_rejected: "Plan refused",
  node_started: "Started task",
  node_delivered: "Finished",
  node_failed: "Task failed",
  decision_opened: "Question",
  decision_resolved: "Answered",
}

/** Group nodes into columns by dependency depth: prerequisites come first. */
function layers(detail: Detail): GraphNode[][] {
  const prerequisites = new Map<string, string[]>()
  for (const edge of detail.edges) {
    prerequisites.set(edge.sourceNodeId, [
      ...(prerequisites.get(edge.sourceNodeId) ?? []),
      edge.targetNodeId,
    ])
  }
  const depth = new Map<string, number>()
  const visit = (id: string, path: Set<string>): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (path.has(id)) return 0
    path.add(id)
    const value =
      Math.max(
        -1,
        ...(prerequisites.get(id) ?? []).map((p) => visit(p, path))
      ) + 1
    depth.set(id, value)
    return value
  }
  const columns: GraphNode[][] = []
  for (const node of detail.nodes) {
    const d = visit(node.id, new Set())
    ;(columns[d] ??= []).push(node)
  }
  return columns.filter(Boolean)
}

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

/** One goal: its controls, task graph, open questions, results and history. */
export function GoalDetail() {
  const { goalId = "" } = useParams()
  const shell = useShell()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    setDetail(await api.goal.get.query({ id: goalId }))
  }, [goalId])

  useEffect(() => {
    void reload().catch(() => setError("That goal could not be found."))
  }, [reload])

  // The goal runs in the background; keep the page current while it does.
  const running = detail?.status === "running"
  useEffect(() => {
    if (!running) return
    const timer = setInterval(
      () => void reload().catch(() => undefined),
      POLL_MS
    )
    return () => clearInterval(timer)
  }, [running, reload])

  async function act(action: () => Promise<unknown>, fallback: string) {
    setBusy(true)
    setError("")
    try {
      await action()
      await reload()
    } catch (cause) {
      setError(message(cause, fallback))
    } finally {
      setBusy(false)
    }
  }

  const columns = useMemo(() => (detail ? layers(detail) : []), [detail])
  const titleOf = useMemo(
    () => new Map(detail?.nodes.map((n) => [n.id, n.title])),
    [detail]
  )
  const taskOf = useMemo(
    () => new Map(detail?.tasks.map((t) => [t.id, t])),
    [detail]
  )
  const pending = detail?.decisions.filter((d) => d.status === "pending") ?? []
  const chosen = detail?.nodes.find((n) => n.id === selected)
  const chosenTask = chosen?.taskId ? taskOf.get(chosen.taskId) : undefined

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
          <strong>{detail?.title ?? "Goal"}</strong>
          <span className="model-identity">
            <Link to="/goals">All goals</Link>
          </span>
        </div>
      </header>
      <div className="settings-body wide">
        {error && <p className="chat-error">{error}</p>}
        {!detail && !error && <p className="panel-note">Loading…</p>}
        {detail && (
          <>
            <div className="provider-card">
              <div className="provider-card-head">
                <div>
                  <h1>{detail.title}</h1>
                  <p>
                    {detail.requirement ||
                      "No acceptance requirement was given."}
                  </p>
                </div>
                <span className={`status-pill goal-${detail.status}`}>
                  {GOAL_STATUS[detail.status]}
                </span>
              </div>
              <p className="provider-status ok">
                {detail.statusReason ??
                  (detail.status === "running"
                    ? "Working on it in the background."
                    : "Ready when you are.")}{" "}
                Round {detail.rounds} of {detail.maxRounds}, planning turn{" "}
                {detail.managerTurns}.
              </p>
              <div className="form-actions">
                {detail.status === "planning" && (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api.goal.start.mutate({ id: goalId }),
                        "Could not start the goal."
                      )
                    }
                  >
                    Start
                  </button>
                )}
                {detail.status === "running" && (
                  <button
                    className="link-button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api.goal.pause.mutate({ id: goalId }),
                        "Could not pause the goal."
                      )
                    }
                  >
                    Pause
                  </button>
                )}
                {detail.status === "paused" && pending.length === 0 && (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api.goal.resume.mutate({ id: goalId }),
                        "Could not resume the goal."
                      )
                    }
                  >
                    Resume
                  </button>
                )}
                {["running", "paused"].includes(detail.status) && (
                  <ConfirmButton
                    label="Stop"
                    confirmLabel="Yes, stop this goal"
                    onConfirm={() =>
                      void act(
                        () => api.goal.stop.mutate({ id: goalId }),
                        "Could not stop the goal."
                      )
                    }
                  />
                )}
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Delete goal and its work"
                  onConfirm={() =>
                    void act(async () => {
                      await api.goal.remove.mutate({ id: goalId })
                      navigate("/goals")
                    }, "Could not delete the goal.")
                  }
                />
              </div>
            </div>

            {pending.map((decision) => (
              <div className="form-card gate-card" key={decision.id}>
                <h2 className="card-title">A decision is waiting for you</h2>
                <p className="persona-text">{decision.question}</p>
                <label className="field">
                  Note for the manager <span>optional</span>
                  <textarea
                    rows={2}
                    value={note}
                    maxLength={2000}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                <div className="form-actions">
                  {decision.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={
                        option.id === "stop"
                          ? "danger-button"
                          : "primary-button"
                      }
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api.goal.resolveDecision.mutate({
                            goalId,
                            decisionId: decision.id,
                            optionId: option.id,
                            note: note.trim() || undefined,
                          })
                          setNote("")
                        }, "Could not save your answer.")
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="form-card">
              <h2 className="card-title">
                Task graph <span>{detail.nodes.length}</span>
              </h2>
              {detail.nodes.length === 0 ? (
                <p className="panel-note flush">
                  Nothing planned yet. The manager plans the first round when
                  the goal starts.
                </p>
              ) : (
                <div className="graph" role="list" aria-label="Task graph">
                  {columns.map((column, index) => (
                    <div className="graph-layer" key={index}>
                      {column.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          role="listitem"
                          className={`graph-node ${node.status} ${node.id === selected ? "selected" : ""}`}
                          onClick={() =>
                            setSelected(node.id === selected ? null : node.id)
                          }
                        >
                          <span className="graph-node-kind">
                            {node.kind === "verification"
                              ? "Review"
                              : node.kind === "decision"
                                ? "Decision"
                                : "Task"}
                            <b className={`status-pill node-${node.status}`}>
                              {NODE_STATUS[node.status]}
                            </b>
                          </span>
                          <strong>{node.title}</strong>
                          {detail.edges.some(
                            (e) => e.sourceNodeId === node.id
                          ) && (
                            <span className="graph-node-deps">
                              after{" "}
                              {detail.edges
                                .filter((e) => e.sourceNodeId === node.id)
                                .map((e) => titleOf.get(e.targetNodeId))
                                .join(", ")}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {chosen && (
                <div className="node-detail">
                  <h3>{chosen.title}</h3>
                  {chosen.description && <p>{chosen.description}</p>}
                  {chosenTask?.error && (
                    <p className="file-error">Error: {chosenTask.error}</p>
                  )}
                  {chosenTask?.result ? (
                    <pre className="task-result">{chosenTask.result}</pre>
                  ) : (
                    <p className="panel-note flush">No result yet.</p>
                  )}
                  {chosenTask?.topicId && (
                    <Link
                      className="link-button"
                      to={`/chat/${chosenTask.topicId}`}
                    >
                      Open the conversation →
                    </Link>
                  )}
                </div>
              )}
            </div>

            <div className="form-card">
              <h2 className="card-title">History</h2>
              <ol className="event-list">
                {[...detail.events].reverse().map((event) => (
                  <li key={event.id}>
                    <b>{EVENT_LABEL[event.eventType] ?? event.eventType}</b>
                    {event.reason && <span>{event.reason}</span>}
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
