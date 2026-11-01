import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router"
import { editImageFile } from "../api"
import type { GeneratedImage } from "../chat-types"
import { useShell } from "../components/AppShell"
import { Icon } from "../components/Icon"
import { ImageTabs } from "../components/ImageTabs"

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"]
const MAX_BYTES = 10 * 1024 * 1024

type ToolProps = {
  tool: "background-removal" | "enhance"
  title: string
  blurb: string
  action: string
  /** The enhancer offers 2x and 4x. */
  scales?: boolean
}

/** Upload one image, have it edited by the hosted model, keep the result. */
function ImageToolPage({ tool, title, blurb, action, scales }: ToolProps) {
  const shell = useShell()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState("")
  const [scale, setScale] = useState<"2" | "4">("2")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<GeneratedImage | null>(null)

  useEffect(() => {
    if (!file) {
      setPreview("")
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function choose(next: File | null) {
    setResult(null)
    setError("")
    if (next && !ACCEPTED.includes(next.type)) {
      setError("Only PNG, JPEG and WebP images are supported.")
      setFile(null)
    } else if (next && next.size > MAX_BYTES) {
      setError("The image must be under 10 MB.")
      setFile(null)
    } else {
      setFile(next)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file || busy) return
    setBusy(true)
    setError("")
    setResult(null)
    try {
      setResult(await editImageFile(tool, file, scales ? scale : undefined))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.")
    } finally {
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
          <strong>{title}</strong>
          <span className="model-identity">{blurb}</span>
        </div>
      </header>
      <div className="settings-body wide">
        <ImageTabs />
        {error && <p className="chat-error">{error}</p>}

        <form className="form-card" onSubmit={(event) => void submit(event)}>
          <label className="field">
            Image <span>PNG, JPEG or WebP, up to 10 MB</span>
            <input
              type="file"
              accept={ACCEPTED.join(",")}
              onChange={(event) => choose(event.target.files?.[0] ?? null)}
            />
          </label>
          {scales && (
            <div className="field">
              Enlarge by
              <div className="segmented" role="group" aria-label="Scale">
                {(["2", "4"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={scale === option}
                    className={scale === option ? "active" : ""}
                    onClick={() => setScale(option)}
                  >
                    {option}x
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="form-actions">
            <button className="primary-button" disabled={busy || !file}>
              {busy ? "Working… this can take a minute" : action}
            </button>
          </div>
        </form>

        {(preview || result) && (
          <div className="compare">
            {preview && (
              <figure>
                <img src={preview} alt="Your image" />
                <figcaption>Original</figcaption>
              </figure>
            )}
            {result && (
              <figure>
                <img className="checker" src={result.imageUrl} alt="Result" />
                <figcaption>
                  Result ·{" "}
                  <a
                    className="link-button"
                    href={result.imageUrl}
                    download={`openchat-${result.id}.png`}
                  >
                    Download
                  </a>{" "}
                  · <Link to="/images">Saved to your gallery</Link>
                </figcaption>
              </figure>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export function BackgroundRemoval() {
  return (
    <ImageToolPage
      tool="background-removal"
      title="Remove background"
      blurb="Cut the subject out onto a transparent background"
      action="Remove background"
    />
  )
}

export function ImageEnhancer() {
  return (
    <ImageToolPage
      tool="enhance"
      title="Enhance image"
      blurb="Sharpen and enlarge a photo without changing it"
      action="Enhance image"
      scales
    />
  )
}
