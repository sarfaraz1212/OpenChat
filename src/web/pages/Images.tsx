import { useCallback, useEffect, useState, type FormEvent } from "react"
import {
  ASPECT_RATIO_NAMES,
  ASPECT_RATIOS,
  IMAGE_MODEL_META,
  IMAGE_STYLES,
  MAX_PROMPT_CHARS,
  QUALITY_LABELS,
  STYLE_NAMES,
  type AspectRatio,
  type ImageStyle,
} from "../../shared/images"
import { IMAGE_MODELS, type ImageModelId } from "../../shared/models"
import { api } from "../api"
import type { GeneratedImage } from "../chat-types"
import { useShell } from "../components/AppShell"
import { ConfirmButton } from "../components/ConfirmButton"
import { Icon } from "../components/Icon"
import { ImageTabs } from "../components/ImageTabs"

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

const EDIT_MODEL_NAMES: Record<string, string> = {
  "flux-2-pro-preview": "FLUX.2 Pro",
  "flux-kontext-max": "FLUX.1 Kontext Max",
  "flux-kontext-pro": "FLUX.1 Kontext Pro",
}

const modelName = (id: string) =>
  IMAGE_MODELS.find((model) => model.id === id)?.name ??
  EDIT_MODEL_NAMES[id] ??
  id

/** Image generation: describe a picture, pick a model, keep what you make. */
export function Images() {
  const shell = useShell()
  const [images, setImages] = useState<GeneratedImage[] | null>(null)
  const [prompt, setPrompt] = useState("")
  const [style, setStyle] = useState<ImageStyle>("none")
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1")
  const [model, setModel] = useState<ImageModelId>(IMAGE_MODELS[0].id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    setImages(await api.image.list.query())
  }, [])

  useEffect(() => {
    void reload().catch(() => setError("Could not load your images."))
  }, [reload])

  async function generate(event: FormEvent) {
    event.preventDefault()
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError("")
    try {
      const made = await api.image.generate.mutate({
        prompt,
        style,
        aspectRatio,
        model,
      })
      setImages((current) => [made, ...(current ?? [])])
    } catch (cause) {
      setError(message(cause, "Image generation failed."))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    try {
      await api.image.remove.mutate({ id })
      setImages(
        (current) => current?.filter((image) => image.id !== id) ?? null
      )
    } catch (cause) {
      setError(message(cause, "Could not delete the image."))
    }
  }

  const meta = IMAGE_MODEL_META[model]

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
          <strong>Images</strong>
          <span className="model-identity">
            Describe a picture and keep what you make
          </span>
        </div>
      </header>
      <div className="settings-body wide">
        <ImageTabs />
        {error && <p className="chat-error">{error}</p>}

        <form className="form-card" onSubmit={(event) => void generate(event)}>
          <h2 className="card-title">New image</h2>
          <label className="field">
            Prompt
            <textarea
              rows={3}
              value={prompt}
              maxLength={MAX_PROMPT_CHARS}
              placeholder="A red fox in fresh snow at dawn…"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <div className="field">
            Style
            <div className="segmented" role="group" aria-label="Style">
              {IMAGE_STYLES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={style === option}
                  className={style === option ? "active" : ""}
                  onClick={() => setStyle(option)}
                >
                  {STYLE_NAMES[option]}
                </button>
              ))}
            </div>
          </div>
          <div className="image-options">
            <label className="field">
              Model
              <select
                value={model}
                onChange={(event) =>
                  setModel(event.target.value as ImageModelId)
                }
              >
                {IMAGE_MODELS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ·{" "}
                    {QUALITY_LABELS[IMAGE_MODEL_META[option.id].quality]}
                  </option>
                ))}
              </select>
              <span>{meta.bestFor}</span>
            </label>
            <label className="field">
              Shape
              <select
                value={aspectRatio}
                onChange={(event) =>
                  setAspectRatio(event.target.value as AspectRatio)
                }
              >
                {ASPECT_RATIOS.map((option) => (
                  <option key={option} value={option}>
                    {ASPECT_RATIO_NAMES[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button
              className="primary-button"
              disabled={busy || !prompt.trim()}
            >
              {busy ? "Generating…" : "Generate"}
            </button>
          </div>
        </form>

        {images === null && !error && <p className="panel-note">Loading…</p>}
        {images?.length === 0 && (
          <p className="panel-note">
            Nothing here yet. Your images appear here.
          </p>
        )}
        {images && images.length > 0 && (
          <ul className="image-grid">
            {images.map((image) => (
              <li key={image.id} className="image-card">
                <a href={image.imageUrl} target="_blank" rel="noreferrer">
                  <img
                    src={image.imageUrl}
                    alt={image.prompt}
                    loading="lazy"
                    width={image.width ?? undefined}
                    height={image.height ?? undefined}
                  />
                </a>
                <p className="image-prompt">{image.prompt}</p>
                <p className="image-meta">
                  {modelName(image.model)} · {STYLE_NAMES[image.style]} ·{" "}
                  {image.aspectRatio}
                </p>
                <div className="image-actions">
                  <a
                    className="link-button"
                    href={image.imageUrl}
                    download={`openchat-${image.id}`}
                  >
                    Download
                  </a>
                  <ConfirmButton
                    label="Delete"
                    onConfirm={() => void remove(image.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
