import { useEffect, useState } from "react"
import { Link } from "react-router"
import { api } from "../api"
import type { KnowledgeBase, KnowledgeFile } from "../chat-types"

type Selection = { files: Set<string>; bases: Set<string> }

/** Which files and knowledge bases an agent reads from; saved as you tick them. */
export function AgentKnowledge({ agentId }: { agentId: string }) {
  const [files, setFiles] = useState<KnowledgeFile[]>([])
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.file.list.query(),
      api.knowledgeBase.list.query(),
      api.agent.getKnowledge.query({ agentId }),
    ])
      .then(([nextFiles, nextBases, attached]) => {
        if (cancelled) return
        setFiles(nextFiles)
        setBases(nextBases)
        setSelection({
          files: new Set(attached.files.map((file) => file.id)),
          bases: new Set(attached.knowledgeBases.map((base) => base.id)),
        })
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this agent's knowledge.")
      })
    return () => {
      cancelled = true
    }
  }, [agentId])

  async function toggle(kind: keyof Selection, id: string, on: boolean) {
    if (!selection) return
    const previous = selection
    const next: Selection = {
      files: new Set(selection.files),
      bases: new Set(selection.bases),
    }
    if (on) next[kind].add(id)
    else next[kind].delete(id)
    setSelection(next)
    setError("")
    try {
      await api.agent.setKnowledge.mutate({
        agentId,
        fileIds: [...next.files],
        knowledgeBaseIds: [...next.bases],
      })
    } catch {
      setSelection(previous)
      setError("Could not save that change.")
    }
  }

  const empty = files.length === 0 && bases.length === 0

  return (
    <div className="form-card">
      <h2 className="card-title">Knowledge</h2>
      <p className="panel-note flush">
        This agent reads the ticked documents when it answers. Only files that
        finished indexing are used.
      </p>
      {error && <p className="chat-error">{error}</p>}
      {empty && selection && (
        <p className="panel-note flush">
          Nothing to attach yet. <Link to="/knowledge">Add documents</Link>.
        </p>
      )}
      {bases.length > 0 && (
        <fieldset className="check-group">
          <legend>Knowledge bases</legend>
          {bases.map((base) => (
            <label key={base.id} className="field-check">
              <input
                type="checkbox"
                checked={selection?.bases.has(base.id) ?? false}
                disabled={!selection}
                onChange={(event) =>
                  void toggle("bases", base.id, event.target.checked)
                }
              />
              {base.name} <small>{base.fileCount} files</small>
            </label>
          ))}
        </fieldset>
      )}
      {files.length > 0 && (
        <fieldset className="check-group">
          <legend>Files</legend>
          {files.map((file) => (
            <label key={file.id} className="field-check">
              <input
                type="checkbox"
                checked={selection?.files.has(file.id) ?? false}
                disabled={!selection}
                onChange={(event) =>
                  void toggle("files", file.id, event.target.checked)
                }
              />
              {file.name}
              {file.status !== "ready" && <small>{file.status}</small>}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}
