import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import {
  CHAT_MODEL_INFOS,
  isNewChatModelId,
  type ChatModelId,
} from "../../shared/models"
import { api } from "../api"
import type { AiModel, RuntimeState } from "../chat-types"
import { Icon } from "./Icon"
import { ModelLogo, type ModelLogoName } from "./ModelLogo"

export const modelName = (id: string | null | undefined) =>
  CHAT_MODEL_INFOS.find((model) => model.id === id)?.name ??
  id ??
  "Unknown model"

const VENDOR_LOGOS: Record<string, ModelLogoName> = {
  Meta: "meta",
  OpenAI: "openai",
  "Mistral AI": "mistral",
  DeepSeek: "deepseek",
  Qwen: "qwen",
  "Z.ai": "zai",
  "Moonshot AI": "kimi",
  Google: "gemma",
  NVIDIA: "nvidia",
}

const VENDOR_ICON_META: Record<
  string,
  { label: string; tone: string; slug?: string; src?: string }
> = {
  Cloudflare: { label: "CF", tone: "cloudflare", slug: "cloudflare" },
  Meta: { label: "M", tone: "meta", slug: "meta" },
  OpenAI: {
    label: "OA",
    tone: "openai",
    src: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/openai.svg",
  },
  "Mistral AI": { label: "MI", tone: "mistral", slug: "mistralai" },
  DeepSeek: { label: "DS", tone: "deepseek", slug: "deepseek" },
  Qwen: { label: "Q", tone: "qwen", slug: "qwen" },
  "Z.ai": { label: "Z", tone: "zai" },
  "Moonshot AI": { label: "K", tone: "moonshot" },
  Google: { label: "G", tone: "google", slug: "google" },
  NVIDIA: { label: "NV", tone: "nvidia", slug: "nvidia" },
}

function vendorIcon(organization: string): {
  label: string
  tone: string
  slug?: string
  src?: string
} {
  const known = VENDOR_ICON_META[organization]
  if (known) return known
  const initials = organization
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
  return { label: initials || "?", tone: "default" }
}

export function VendorIcon({ organization }: { organization: string }) {
  const { label, tone, slug, src } = vendorIcon(organization)
  const [failed, setFailed] = useState(false)
  const logo = VENDOR_LOGOS[organization]
  if (logo) {
    return (
      <span className="vendor-icon" aria-hidden>
        <ModelLogo name={logo} />
      </span>
    )
  }
  const imageSrc = src ?? (slug ? `https://cdn.simpleicons.org/${slug}` : null)
  return (
    <span className={`vendor-icon vendor-icon--${tone}`} aria-hidden>
      {imageSrc && !failed ? (
        <img
          className="vendor-icon-image"
          src={imageSrc}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        label
      )}
    </span>
  )
}

export function NewModelBadge() {
  return <span className="model-new-badge">NEW</span>
}

export function AbilityTags({ model }: { model: Pick<AiModel, "abilities"> }) {
  const { vision, functionCall, reasoning } = model.abilities
  return (
    <span className="ability-tags">
      {vision && <b title="Understands images">Vision</b>}
      {functionCall && <b title="Can call tools">Tools</b>}
      {reasoning && <b title="Reasons before answering">Reasoning</b>}
    </span>
  )
}

export const formatContext = (tokens?: number) =>
  tokens
    ? tokens >= 1_000_000
      ? `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`
      : `${Math.round(tokens / 1000)}K`
    : undefined

type Props = {
  current: string
  disabled?: boolean
  onSelect: (model: ChatModelId) => void
}

/** The model picker in the chat header, listing what the user has enabled. */
export function ModelSwitchPanel({ current, disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<RuntimeState | null>(null)
  const [error, setError] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const currentAuthor =
    CHAT_MODEL_INFOS.find((model) => model.id === current)?.author ?? "Unknown"

  useEffect(() => {
    if (!open) return
    let cancelled = false
    api.aiInfra.runtimeState
      .query()
      .then((next) => {
        if (!cancelled) setState(next)
      })
      .catch(() => {
        if (!cancelled) setError("Could not load models.")
      })
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      cancelled = true
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <div className="model-switch" ref={rootRef}>
      <button
        type="button"
        className="model-switch-button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <VendorIcon organization={currentAuthor} />
        <span>{modelName(current)}</span>
        <span className="model-switch-caret">
          <Icon name="chevron-down" size={12} />
        </span>
      </button>
      {open && (
        <div
          className="model-switch-panel"
          role="menu"
          aria-label="Choose model"
        >
          {error && <p className="chat-error">{error}</p>}
          {!state && !error && <p className="panel-note">Loading models…</p>}
          {state?.providers.length === 0 && (
            <p className="panel-note">
              No models are enabled. Turn some on in model settings.
            </p>
          )}
          {state?.providers.map((provider) => (
            <div key={provider.id} className="model-group">
              <div className="topic-label">{provider.name.toUpperCase()}</div>
              {provider.models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={model.id === current}
                  className={`model-option ${model.id === current ? "selected" : ""}`}
                  onClick={() => {
                    setOpen(false)
                    if (model.id !== current) onSelect(model.id as ChatModelId)
                  }}
                >
                  <VendorIcon organization={model.organization} />
                  <span className="model-option-name">
                    <span className="model-option-title">
                      {model.displayName}
                      {isNewChatModelId(model.id) && <NewModelBadge />}
                    </span>
                    <small>
                      {model.organization} · {model.bestFor}
                    </small>
                  </span>
                  <AbilityTags model={model} />
                  {model.id === current && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          ))}
          <Link
            className="model-switch-manage"
            to="/settings/provider/cloudflare"
            onClick={() => setOpen(false)}
          >
            Manage models
          </Link>
        </div>
      )}
    </div>
  )
}
