import { useCallback, useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import { Link, useNavigate, useParams } from "react-router"
import remarkGfm from "remark-gfm"
import { api } from "../api"
import type { ResearchSession } from "../chat-types"
import { useShell } from "../components/AppShell"
import { ConfirmButton } from "../components/ConfirmButton"
import { Icon } from "../components/Icon"
import { modelName } from "../components/ModelSwitchPanel"
import { downloadReportPdf } from "../pdf"
import { RESEARCH_STATUS } from "./DeepResearch"

const POLL_MS = 3000

/** One research run: its progress while it works, then the report. */
export function ResearchReport() {
  const shell = useShell()
  const navigate = useNavigate()
  const { sessionId = "" } = useParams()
  const [session, setSession] = useState<ResearchSession | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setSession(await api.research.get.query({ id: sessionId }))
  }, [sessionId])

  useEffect(() => {
    void load().catch(() => setError("Could not load this research."))
  }, [load])

  // Poll while it runs; the run happens in the background, not in this page.
  const running = session?.status === "in_progress"
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => void load().catch(() => undefined), POLL_MS)
    return () => clearInterval(timer)
  }, [running, load])

  async function remove() {
    try {
      await api.research.remove.mutate({ id: sessionId })
      navigate("/deep-research")
    } catch {
      setError("Could not delete this research.")
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
          <strong>{session?.topic ?? "Research"}</strong>
          <span className="model-identity">
            <Link to="/deep-research">← All research</Link>
          </span>
        </div>
      </header>
      <div className="settings-body wide">
        {error && <p className="chat-error">{error}</p>}
        {!session && !error && <p className="panel-note">Loading…</p>}
        {session && (
          <>
            <div className="research-bar">
              <span className={`status-pill research-${session.status}`}>
                {RESEARCH_STATUS[session.status]}
              </span>
              <span className="panel-note flush">
                {session.depth === "deep" ? "Deep" : "Standard"} ·{" "}
                {modelName(session.model)}
              </span>
              <span className="research-actions">
                {session.status === "completed" && session.report && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      downloadReportPdf({
                        title: session.topic,
                        createdAt: session.createdAt,
                        markdown: session.report ?? "",
                      })
                    }
                  >
                    Download PDF
                  </button>
                )}
                <ConfirmButton label="Delete" onConfirm={() => void remove()} />
              </span>
            </div>

            {running && (
              <p className="panel-note">
                Researching in the background. You can leave this page and come
                back; this can take several minutes.
              </p>
            )}

            {session.activity.length > 0 && (
              <div className="form-card">
                <h2 className="card-title">What it did</h2>
                <ul className="activity">
                  {session.activity.map((entry, index) => (
                    <li key={index}>
                      {entry.kind === "search" ? (
                        <>
                          <span>Searched</span> “{entry.query}”{" "}
                          <small>
                            {entry.results}{" "}
                            {entry.results === 1 ? "result" : "results"}
                          </small>
                        </>
                      ) : (
                        <>
                          <span>{entry.ok ? "Read" : "Could not read"}</span>{" "}
                          {entry.url}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {session.report && (
              <article
                className={`form-card report${session.status === "failed" ? " report-failed" : ""}`}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noreferrer noopener">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {session.report}
                </ReactMarkdown>
              </article>
            )}

            {session.sources.length > 0 && (
              <div className="form-card">
                <h2 className="card-title">Sources read</h2>
                <ul className="activity">
                  {session.sources.map((url) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noreferrer noopener">
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
