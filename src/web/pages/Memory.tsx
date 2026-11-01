import { useCallback, useEffect, useState } from "react"
import { api } from "../api"
import type { Memory, Persona } from "../chat-types"
import { useShell } from "../components/AppShell"
import { ConfirmButton } from "../components/ConfirmButton"
import { Icon } from "../components/Icon"

const LAYERS: Array<{ id: Memory["layer"]; label: string; hint: string }> = [
  { id: "identity", label: "Identity", hint: "Who you are" },
  { id: "preference", label: "Preferences", hint: "How you like things done" },
  { id: "experience", label: "Experiences", hint: "Lessons worth reusing" },
  {
    id: "activity",
    label: "Activities",
    hint: "Things that happened or are planned",
  },
  { id: "context", label: "Contexts", hint: "What you are in the middle of" },
]

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

type Draft = { id: string; title: string; summary: string }

/** What OpenChat remembers about you: review, correct, or forget it. */
export function MemoryPage() {
  const shell = useShell()
  const [memories, setMemories] = useState<Memory[] | null>(null)
  const [persona, setPersona] = useState<Persona | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    const [list, nextPersona, settings] = await Promise.all([
      api.memory.list.query(),
      api.memory.persona.query(),
      api.memory.settings.query(),
    ])
    setMemories(list)
    setPersona(nextPersona)
    setEnabled(settings.enabled)
  }, [])

  useEffect(() => {
    void reload().catch(() => setError("Could not load your memory."))
  }, [reload])

  async function attempt(action: () => Promise<void>, fallback: string) {
    setError("")
    try {
      await action()
    } catch (cause) {
      setError(message(cause, fallback))
    }
  }

  const toggle = (next: boolean) =>
    attempt(async () => {
      setEnabled(next)
      try {
        await api.memory.setEnabled.mutate({ enabled: next })
      } catch (cause) {
        setEnabled(!next)
        throw cause
      }
    }, "Could not change that setting.")

  const save = () =>
    attempt(async () => {
      if (!draft) return
      await api.memory.update.mutate(draft)
      setDraft(null)
      await reload()
    }, "Could not save that memory.")

  const remove = (id: string) =>
    attempt(async () => {
      await api.memory.remove.mutate({ id })
      await reload()
    }, "Could not delete that memory.")

  const clear = () =>
    attempt(async () => {
      await api.memory.clear.mutate()
      setDraft(null)
      await reload()
    }, "Could not clear your memory.")

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
          <strong>Memory</strong>
          <span className="model-identity">
            What OpenChat remembers about you across conversations
          </span>
        </div>
      </header>
      <div className="settings-body">
        {error && <p className="chat-error">{error}</p>}

        <div className="provider-card">
          <div className="provider-card-head">
            <div>
              <h1>Remember things about me</h1>
              <p>
                After each reply, OpenChat can note lasting facts and
                preferences from the conversation and use them in later chats.
                Turning this off stops both; what is already saved is kept until
                you delete it.
              </p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                aria-label="Remember things about me"
                checked={enabled}
                onChange={(event) => void toggle(event.target.checked)}
              />
              <span />
            </label>
          </div>
        </div>

        <div className="form-card">
          <h2 className="card-title">Persona</h2>
          {persona ? (
            <p className="persona-text">{persona.persona}</p>
          ) : (
            <p className="panel-note flush">
              Nothing yet. A short profile appears here once OpenChat has
              remembered something.
            </p>
          )}
        </div>

        {memories === null && !error && <p className="panel-note">Loading…</p>}
        {LAYERS.map((layer) => {
          const items = (memories ?? []).filter((m) => m.layer === layer.id)
          if (items.length === 0) return null
          return (
            <div className="form-card" key={layer.id}>
              <h2 className="card-title">
                {layer.label} <span>{items.length}</span>
              </h2>
              <p className="panel-note flush">{layer.hint}</p>
              <ul className="memory-list">
                {items.map((memory) => (
                  <li key={memory.id} className="memory-item">
                    {draft?.id === memory.id ? (
                      <div className="memory-edit">
                        <input
                          className="inline-input"
                          aria-label="Memory title"
                          value={draft.title}
                          maxLength={120}
                          onChange={(event) =>
                            setDraft({ ...draft, title: event.target.value })
                          }
                        />
                        <textarea
                          className="inline-input"
                          aria-label="Memory summary"
                          rows={3}
                          value={draft.summary}
                          maxLength={600}
                          onChange={(event) =>
                            setDraft({ ...draft, summary: event.target.value })
                          }
                        />
                        <div className="form-actions">
                          <button
                            type="button"
                            className="primary-button"
                            disabled={
                              !draft.title.trim() || !draft.summary.trim()
                            }
                            onClick={() => void save()}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => setDraft(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="memory-copy">
                          <strong>{memory.title}</strong>
                          <span>{memory.summary}</span>
                          {memory.tags.length > 0 && (
                            <span className="memory-tags">
                              {memory.tags.map((tag) => (
                                <b key={tag}>{tag}</b>
                              ))}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() =>
                            setDraft({
                              id: memory.id,
                              title: memory.title,
                              summary: memory.summary,
                            })
                          }
                        >
                          Edit
                        </button>
                        <ConfirmButton
                          label="Delete"
                          onConfirm={() => void remove(memory.id)}
                        />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
        {memories?.length === 0 && (
          <p className="panel-note">
            No memories yet. Chat for a while and they will appear here.
          </p>
        )}

        {(memories?.length ?? 0) > 0 && (
          <div className="form-actions">
            <ConfirmButton
              label="Forget everything"
              confirmLabel="Yes, forget everything"
              onConfirm={() => void clear()}
            />
          </div>
        )}
      </div>
    </section>
  )
}
