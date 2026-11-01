import { useState, type FormEvent } from "react"
import type { ChatModelId } from "../../shared/models"
import type { CurrentUser } from "../chat-types"
import { Icon } from "./Icon"
import { ModelLogo, type ModelLogoName } from "./ModelLogo"
import { ModelSwitchPanel } from "./ModelSwitchPanel"

type HomeDashboardProps = {
  user: CurrentUser
  model: ChatModelId
  ready: boolean
  sending: boolean
  error: string
  onOpenSidebar: () => void
  onSelectModel: (model: ChatModelId) => void
  onSend: (content: string) => void
}

const starters = [
  {
    icon: "file" as const,
    title: "Summarize something",
    description: "Turn rough notes into a concise summary",
    prompt: "Summarize the following for me: ",
  },
  {
    icon: "list-check" as const,
    title: "Make a plan",
    description: "Break an outcome into clear next steps",
    prompt: "Make a practical step-by-step plan for: ",
  },
  {
    icon: "search" as const,
    title: "Research a topic",
    description: "Explore a topic and organize the findings",
    prompt: "Research this topic and organize the key findings: ",
  },
]

const suggestions = [
  ["file", "Summarize my recent work"],
  ["book", "Find insights in my resources"],
  ["graduation", "Teach me something new"],
] as const

const modelShortcuts = [
  {
    id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    label: "Mistral Small 3.1",
    logo: "mistral",
  },
  {
    id: "@cf/openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    logo: "openai",
  },
  {
    id: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    label: "DeepSeek V4 Flash",
    logo: "deepseek",
  },
  {
    id: "@cf/google/gemma-4-26b-a4b-it",
    label: "Gemma 4",
    logo: "gemma",
  },
] satisfies readonly {
  id: ChatModelId
  label: string
  logo: ModelLogoName
}[]

const greeting = () => {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

export function HomeDashboard(props: HomeDashboardProps) {
  const [content, setContent] = useState("")
  const [customizing, setCustomizing] = useState(false)
  const [showStarters, setShowStarters] = useState(true)
  const [showSuggestions, setShowSuggestions] = useState(true)
  const name = props.user.display_name || props.user.email.split("@")[0]

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = content.trim()
    if (!value || !props.ready || props.sending) return
    props.onSend(value)
    setContent("")
  }

  return (
    <section className="home-dashboard">
      <header className="home-toolbar">
        <button
          className="home-mobile-menu"
          type="button"
          aria-label="Open menu"
          onClick={props.onOpenSidebar}
        >
          <Icon name="menu" size={19} />
        </button>
        <span />
        <button
          type="button"
          aria-label="Customize home"
          aria-expanded={customizing}
          onClick={() => setCustomizing((value) => !value)}
        >
          <Icon name="sliders" size={16} />
        </button>
        <button
          type="button"
          aria-label="Toggle details panel"
          aria-pressed={!showSuggestions}
          onClick={() => setShowSuggestions((value) => !value)}
        >
          <Icon name="panel-left" size={16} />
        </button>
      </header>

      {customizing && (
        <div className="home-customize-menu">
          <strong>Customize Home</strong>
          <label>
            <input
              type="checkbox"
              checked={showStarters}
              onChange={(event) => setShowStarters(event.target.checked)}
            />
            Idea starters
          </label>
          <label>
            <input
              type="checkbox"
              checked={showSuggestions}
              onChange={(event) => setShowSuggestions(event.target.checked)}
            />
            Suggestions panel
          </label>
        </div>
      )}

      <div className="home-page-content">
        <div className="home-hero-row">
          <div className="home-heading">
            <div className="home-agent-label">
              <span className="home-ai-avatar">
                <img src="/logo-openchat-mark.svg" alt="" />
              </span>
              <strong>OpenChat AI</strong>
            </div>
            <h1>
              {greeting()}, {name}.
            </h1>
          </div>
          <div className="home-announcement">
            <span className="announcement-mark">
              <Icon name="sparkles" size={15} />
            </span>
            <span>Open-weight AI, ready when you are</span>
            <b>Explore</b>
            <Icon name="x" size={13} />
          </div>
        </div>

        <div
          className={`home-work-grid ${showSuggestions ? "" : "rail-hidden"}`}
        >
          <div className="home-main-column">
            <form className="home-composer" onSubmit={submit}>
              <textarea
                id="prompt-textarea"
                aria-label="Message OpenChat"
                rows={3}
                value={content}
                placeholder="Ask, create, or start a task"
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              <div className="home-composer-actions">
                <div className="home-composer-left">
                  <button type="button" className="home-agent-picker">
                    <Icon name="infinity" size={17} />
                    <span>Agent</span>
                    <Icon name="chevron-down" size={11} />
                  </button>
                  <button
                    type="button"
                    className="home-add-button"
                    aria-label="Add attachment"
                  >
                    <Icon name="plus" size={18} />
                  </button>
                </div>
                <div className="home-composer-right">
                  <ModelSwitchPanel
                    current={props.model}
                    disabled={props.sending}
                    onSelect={props.onSelectModel}
                  />
                  <button
                    type="submit"
                    className="home-send-button"
                    aria-label="Send message"
                    disabled={!content.trim() || !props.ready || props.sending}
                  >
                    <Icon name="arrow-up" size={17} strokeWidth={2.2} />
                  </button>
                </div>
              </div>
            </form>

            <div className="home-model-strip" aria-label="Model shortcuts">
              <span>New</span>
              {modelShortcuts.map((shortcut) => (
                <button
                  key={shortcut.id}
                  type="button"
                  aria-pressed={props.model === shortcut.id}
                  onClick={() => props.onSelectModel(shortcut.id)}
                >
                  <ModelLogo name={shortcut.logo} />
                  <span>{shortcut.label}</span>
                </button>
              ))}
              <Icon name="x" size={13} />
            </div>

            {props.error && (
              <p className="chat-error home-error">{props.error}</p>
            )}

            {showStarters && (
              <div className="home-starters">
                <strong>Start with an idea</strong>
                <p>Choose a starting point or write your own request.</p>
                <div className="home-starter-list">
                  {starters.map((starter) => (
                    <button
                      key={starter.title}
                      type="button"
                      onClick={() => setContent(starter.prompt)}
                    >
                      <Icon name={starter.icon} size={18} />
                      <span>
                        <b>{starter.title}</b>
                        <small>{starter.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {showSuggestions && (
            <aside className="home-suggestions">
              <div className="home-portrait" aria-hidden>
                <span className="portrait-orbit portrait-orbit-a" />
                <span className="portrait-orbit portrait-orbit-b" />
                <span className="portrait-orbit portrait-orbit-c" />
                <img src="/logo-openchat-mark.svg" alt="" />
              </div>
              <div className="suggestions-card">
                <div className="suggestions-heading">
                  <strong>Suggestions</strong>
                  <Icon name="refresh" size={14} />
                </div>
                {suggestions.map(([icon, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setContent(label)}
                  >
                    <span>
                      <Icon name={icon} size={14} />
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </aside>
          )}
        </div>
      </div>
    </section>
  )
}
