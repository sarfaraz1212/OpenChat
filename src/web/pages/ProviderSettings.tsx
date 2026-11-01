import { useEffect, useState } from "react"
import { useParams } from "react-router"
import { isNewChatModelId } from "../../shared/models"
import { api } from "../api"
import type { AiModel, AiProvider } from "../chat-types"
import { useShell } from "../components/AppShell"
import { Icon } from "../components/Icon"
import {
  AbilityTags,
  formatContext,
  NewModelBadge,
  VendorIcon,
} from "../components/ModelSwitchPanel"

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

/** Settings → Model provider: enable the provider and choose which models it offers. */
export function ProviderSettings() {
  const { providerId = "" } = useParams()
  const shell = useShell()
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [models, setModels] = useState<AiModel[] | null>(null)
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")

  const provider = providers.find((item) => item.id === providerId)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      api.aiProvider.list.query(),
      api.aiModel.list.query({ providerId }),
    ])
      .then(([nextProviders, nextModels]) => {
        if (cancelled) return
        setProviders(nextProviders)
        setModels(nextModels)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(message(cause, "Could not load models."))
      })
    return () => {
      cancelled = true
    }
  }, [providerId])

  const enabledCount = models?.filter((model) => model.enabled).length ?? 0
  const visible = (models ?? []).filter((model) =>
    `${model.displayName} ${model.organization} ${model.bestFor}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )

  function setLocalEnabled(ids: string[], enabled: boolean) {
    setModels((current) =>
      current
        ? current.map((model) =>
            ids.includes(model.id) ? { ...model, enabled } : model
          )
        : current
    )
    setProviders((current) =>
      current.map((item) =>
        item.id === providerId
          ? {
              ...item,
              enabledModelCount: (models ?? []).filter((model) =>
                ids.includes(model.id) ? enabled : model.enabled
              ).length,
            }
          : item
      )
    )
  }

  async function setModelsEnabled(ids: string[], enabled: boolean) {
    if (ids.length === 0) return
    const previous = models
    setError("")
    setLocalEnabled(ids, enabled)
    try {
      await api.aiModel.batchToggle.mutate({ providerId, ids, enabled })
    } catch (cause) {
      setModels(previous)
      setError(message(cause, "Could not save that change."))
    }
  }

  async function setProviderEnabled(enabled: boolean) {
    setError("")
    setProviders((current) =>
      current.map((item) =>
        item.id === providerId ? { ...item, enabled } : item
      )
    )
    try {
      await api.aiProvider.toggle.mutate({ id: providerId, enabled })
    } catch (cause) {
      setProviders((current) =>
        current.map((item) =>
          item.id === providerId ? { ...item, enabled: !enabled } : item
        )
      )
      setError(message(cause, "Could not save that change."))
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
          <strong>Model provider</strong>
          <span className="model-identity">
            Choose which models appear in the chat
          </span>
        </div>
      </header>
      <div className="settings-body">
        {error && <p className="chat-error">{error}</p>}
        {!provider && !error && models === null && (
          <p className="panel-note">Loading…</p>
        )}
        {providers.length > 0 && !provider && (
          <p className="panel-note">That provider is not available.</p>
        )}
        {provider && (
          <>
            <div className="provider-card">
              <div className="provider-card-head">
                <div>
                  <h1>{provider.name}</h1>
                  <p>{provider.description}</p>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`Enable ${provider.name}`}
                    checked={provider.enabled}
                    onChange={(event) =>
                      void setProviderEnabled(event.target.checked)
                    }
                  />
                  <span />
                </label>
              </div>
              <p
                className={`provider-status ${provider.configured ? "ok" : "warn"}`}
              >
                {provider.configured
                  ? "Connected — managed by the OpenChat server."
                  : "The server has no Workers AI credentials configured, so replies will fail."}
              </p>
            </div>

            <div className="model-toolbar">
              <input
                type="search"
                placeholder="Search models"
                aria-label="Search models"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <span className="model-count">
                {enabledCount} of {models?.length ?? 0} enabled
              </span>
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  void setModelsEnabled(
                    visible.filter((model) => !model.enabled).map((m) => m.id),
                    true
                  )
                }
              >
                Enable all
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  void setModelsEnabled(
                    visible.filter((model) => model.enabled).map((m) => m.id),
                    false
                  )
                }
              >
                Disable all
              </button>
            </div>

            <ul className="model-list">
              {visible.map((model) => (
                <li key={model.id} className="model-row">
                  <VendorIcon organization={model.organization} />
                  <div className="model-row-copy">
                    <strong className="model-row-title">
                      {model.displayName}
                      {isNewChatModelId(model.id) && <NewModelBadge />}
                    </strong>
                    <span>
                      {model.organization}
                      {formatContext(model.contextWindowTokens) &&
                        ` · ${formatContext(model.contextWindowTokens)} context`}
                    </span>
                    <span className="model-best-for">
                      Best for: {model.bestFor}
                    </span>
                    <code>{model.id}</code>
                  </div>
                  <AbilityTags model={model} />
                  <label className="switch">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`Enable ${model.displayName}`}
                      checked={model.enabled}
                      onChange={(event) =>
                        void setModelsEnabled([model.id], event.target.checked)
                      }
                    />
                    <span />
                  </label>
                </li>
              ))}
              {visible.length === 0 && models && (
                <li className="panel-note">No models match “{query}”.</li>
              )}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
