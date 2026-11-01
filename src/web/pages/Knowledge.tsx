import { useCallback, useEffect, useState, type DragEvent } from "react"
import { api, uploadFile } from "../api"
import type { KnowledgeBase, KnowledgeFile } from "../chat-types"
import { useShell } from "../components/AppShell"
import { ConfirmButton } from "../components/ConfirmButton"
import { Icon } from "../components/Icon"

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`

const STATUS_LABEL: Record<KnowledgeFile["status"], string> = {
  pending: "Waiting",
  processing: "Indexing…",
  ready: "Ready",
  failed: "Failed",
}

/** Files and knowledge bases: what agents can draw on when they answer. */
export function Knowledge() {
  const shell = useShell()
  const [files, setFiles] = useState<KnowledgeFile[]>([])
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [newBase, setNewBase] = useState("")
  const [openBase, setOpenBase] = useState<string | null>(null)
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set())
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    const [nextFiles, nextBases] = await Promise.all([
      api.file.list.query(),
      api.knowledgeBase.list.query(),
    ])
    setFiles(nextFiles)
    setBases(nextBases)
  }, [])

  useEffect(() => {
    void reload().catch(() => setError("Could not load your knowledge."))
  }, [reload])

  async function attempt(action: () => Promise<void>, fallback: string) {
    setError("")
    try {
      await action()
    } catch (cause) {
      setError(message(cause, fallback))
    }
  }

  async function upload(list: FileList | File[]) {
    const chosen = [...list]
    if (chosen.length === 0) return
    setError("")
    setUploading((count) => count + chosen.length)
    for (const file of chosen) {
      try {
        await uploadFile(file)
      } catch (cause) {
        setError(message(cause, `Could not upload ${file.name}.`))
      } finally {
        setUploading((count) => count - 1)
      }
    }
    await reload().catch(() => undefined)
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void upload(event.dataTransfer.files)
  }

  const removeFile = (id: string) =>
    attempt(async () => {
      await api.file.remove.mutate({ id })
      setOpenFiles((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
      await reload()
    }, "Could not delete that file.")

  const createBase = () =>
    attempt(async () => {
      const name = newBase.trim()
      if (!name) return
      const created = await api.knowledgeBase.create.mutate({ name })
      setNewBase("")
      await reload()
      await open(created.id)
    }, "Could not create the knowledge base.")

  async function open(id: string | null) {
    setOpenBase(id)
    if (!id) return
    const detail = await api.knowledgeBase.get.query({ id })
    setOpenFiles(new Set(detail.files.map((file) => file.id)))
  }

  const toggleInBase = (baseId: string, fileId: string, inside: boolean) => {
    const set = (on: boolean) =>
      setOpenFiles((current) => {
        const next = new Set(current)
        if (on) next.add(fileId)
        else next.delete(fileId)
        return next
      })
    set(inside) // Tick immediately; put it back if the server refuses.
    return attempt(async () => {
      try {
        if (inside) {
          await api.knowledgeBase.addFiles.mutate({
            id: baseId,
            fileIds: [fileId],
          })
        } else {
          await api.knowledgeBase.removeFile.mutate({ id: baseId, fileId })
        }
      } catch (cause) {
        set(!inside)
        throw cause
      }
      await reload()
    }, "Could not update the knowledge base.")
  }

  const removeBase = (id: string) =>
    attempt(async () => {
      await api.knowledgeBase.remove.mutate({ id })
      if (openBase === id) setOpenBase(null)
      await reload()
    }, "Could not delete the knowledge base.")

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
          <strong>Knowledge</strong>
          <span className="model-identity">
            Documents your agents can read when they answer
          </span>
        </div>
      </header>
      <div className="settings-body">
        {error && <p className="chat-error">{error}</p>}

        <label
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            type="file"
            multiple
            aria-label="Upload files"
            onChange={(event) => {
              void upload(event.target.files ?? [])
              event.target.value = ""
            }}
          />
          <strong>
            {uploading > 0
              ? `Uploading and indexing ${uploading} file${uploading === 1 ? "" : "s"}…`
              : "Drop files here or click to upload"}
          </strong>
          <span>Text-based files up to 1 MB: txt, md, csv, json, code…</span>
        </label>

        <div className="form-card">
          <h2 className="card-title">
            Files <span>{files.length}</span>
          </h2>
          <ul className="file-list">
            {files.map((file) => (
              <li key={file.id} className="file-row">
                <div className="file-row-copy">
                  <strong>{file.name}</strong>
                  <span>
                    {formatBytes(file.size)}
                    {file.status === "ready" &&
                      ` · ${file.chunkCount} excerpt${file.chunkCount === 1 ? "" : "s"}`}
                  </span>
                  {file.status === "failed" && file.error && (
                    <span className="file-error">{file.error}</span>
                  )}
                </div>
                <span className={`status-pill ${file.status}`}>
                  {STATUS_LABEL[file.status]}
                </span>
                <a
                  className="link-button"
                  href={`/api/files/${file.id}/content`}
                  download={file.name}
                >
                  Download
                </a>
                <ConfirmButton
                  label="Delete"
                  onConfirm={() => void removeFile(file.id)}
                />
              </li>
            ))}
            {files.length === 0 && (
              <li className="panel-note">No files yet. Upload one above.</li>
            )}
          </ul>
        </div>

        <div className="form-card">
          <h2 className="card-title">
            Knowledge bases <span>{bases.length}</span>
          </h2>
          <form
            className="add-member"
            onSubmit={(event) => {
              event.preventDefault()
              void createBase()
            }}
          >
            <input
              className="inline-input"
              aria-label="Knowledge base name"
              placeholder="New knowledge base…"
              value={newBase}
              maxLength={100}
              onChange={(event) => setNewBase(event.target.value)}
            />
            <button className="primary-button" disabled={!newBase.trim()}>
              Create
            </button>
          </form>
          <ul className="file-list">
            {bases.map((base) => (
              <li key={base.id} className="base-block">
                <div className="file-row">
                  <div className="file-row-copy">
                    <strong>{base.name}</strong>
                    <span>
                      {base.fileCount} file{base.fileCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      void open(openBase === base.id ? null : base.id)
                    }
                  >
                    {openBase === base.id ? "Done" : "Choose files"}
                  </button>
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete (files are kept)"
                    onConfirm={() => void removeBase(base.id)}
                  />
                </div>
                {openBase === base.id && (
                  <ul className="base-files">
                    {files.map((file) => (
                      <li key={file.id}>
                        <label className="field-check">
                          <input
                            type="checkbox"
                            checked={openFiles.has(file.id)}
                            onChange={(event) =>
                              void toggleInBase(
                                base.id,
                                file.id,
                                event.target.checked
                              )
                            }
                          />
                          {file.name}
                        </label>
                      </li>
                    ))}
                    {files.length === 0 && (
                      <li className="panel-note">Upload files first.</li>
                    )}
                  </ul>
                )}
              </li>
            ))}
            {bases.length === 0 && (
              <li className="panel-note">
                Group files into a knowledge base to attach them to agents
                together.
              </li>
            )}
          </ul>
        </div>
      </div>
    </section>
  )
}
