import { useEffect, useRef, useState, type FormEvent } from "react"
import type { ChatModelId } from "../../shared/models"
import type { Agent, CurrentUser, TopicDetail } from "../chat-types"
import { AgentAvatar } from "./AgentAvatar"
import { Icon } from "./Icon"
import { modelName, ModelSwitchPanel } from "./ModelSwitchPanel"
import { userInitial } from "./Sidebar"

type WorkspaceProps = {
  user: CurrentUser
  agent: Agent | null
  topic: TopicDetail | null
  model: string
  streamingText: string
  sending: boolean
  error: string
  onOpenSidebar: () => void
  onSelectModel: (model: ChatModelId) => void
  onSend: (content: string) => void
}

/** File names a grounded reply drew on, from the message's retrieval metadata. */
function sourceNames(metadata: unknown): string[] {
  const retrieval = (metadata as { retrieval?: Array<{ fileName?: string }> })
    ?.retrieval
  if (!Array.isArray(retrieval)) return []
  return [...new Set(retrieval.flatMap((hit) => hit.fileName ?? []))]
}

/** Titles of the memories a reply used, from the message's metadata. */
function memoryTitles(metadata: unknown): string[] {
  const used = (metadata as { memories?: Array<{ title?: string }> })?.memories
  if (!Array.isArray(used)) return []
  return [...new Set(used.flatMap((memory) => memory.title ?? []))]
}

type ToolRun = { name: string; input: unknown; output: unknown }

/** The tool calls (code runs, file operations) a reply made, from its metadata. */
function toolRunsOf(metadata: unknown): ToolRun[] {
  const runs = (metadata as { tools?: ToolRun[] } | null)?.tools
  return Array.isArray(runs) ? runs : []
}

/** What a run did, in one readable block: the command or code, then what came back. */
function describeRun(run: ToolRun) {
  const input = (run.input ?? {}) as Record<string, unknown>
  const output = (run.output ?? {}) as Record<string, unknown>
  const request =
    typeof input.command === "string"
      ? input.command
      : typeof input.code === "string"
        ? input.code
        : typeof input.path === "string"
          ? input.path
          : JSON.stringify(input)
  const text = (value: unknown) => (typeof value === "string" ? value : "")
  const result = output.error
    ? `Error: ${text(output.error)}`
    : [text(output.stdout), text(output.stderr), text(output.content)]
        .filter(Boolean)
        .join("\n")
  const exit = typeof output.exitCode === "number" && output.exitCode !== 0
  return {
    request,
    result: exit ? `${result}\n(exit code ${output.exitCode})` : result,
  }
}

function EmptyChat({
  agent,
  model,
  sending,
  onSend,
}: Pick<WorkspaceProps, "agent" | "model" | "sending" | "onSend">) {
  const custom = agent && !agent.virtual
  return (
    <div className="empty-chat">
      {agent ? (
        <AgentAvatar agent={agent} size={54} />
      ) : (
        <div className="assistant-mark">O</div>
      )}
      <h1>{custom ? agent.title : "What can I help with?"}</h1>
      <p>
        {custom && agent.description
          ? agent.description
          : `Start a conversation with ${modelName(model)} on Cloudflare Workers AI.`}
      </p>
      {agent?.openingMessage && (
        <div className="opening-message">{agent.openingMessage}</div>
      )}
      {agent && agent.openingQuestions.length > 0 && (
        <div className="opening-questions">
          {agent.openingQuestions.map((question) => (
            <button
              key={question}
              type="button"
              disabled={sending}
              onClick={() => onSend(question)}
            >
              {question}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Transcript({
  user,
  agent,
  topic,
  model,
  sending,
  streamingText,
  onSend,
}: Pick<
  WorkspaceProps,
  "user" | "agent" | "topic" | "model" | "sending" | "streamingText" | "onSend"
>) {
  const transcriptRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = transcriptRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [topic?.messages.length, streamingText])

  return (
    <div
      className="transcript"
      ref={transcriptRef}
      data-conversation-transcript
    >
      {!topic?.messages.length && !streamingText ? (
        <EmptyChat
          agent={agent}
          model={model}
          sending={sending}
          onSend={onSend}
        />
      ) : (
        <div className="message-column">
          {topic?.messages.map((message) => (
            <article
              key={message.id}
              data-message-role={message.role}
              className={`message ${message.role}`}
            >
              <div className="message-avatar">
                {message.role === "user" ? userInitial(user) : "O"}
              </div>
              <div className="message-body">
                <strong>
                  {message.role === "user" ? "You" : "OpenChat"}
                  {message.role === "assistant" && message.model && (
                    <span className="message-model">
                      {modelName(message.model)}
                    </span>
                  )}
                </strong>
                <p>{message.content}</p>
                {toolRunsOf(message.metadata).length > 0 && (
                  <details className="tool-runs">
                    <summary>
                      Ran {toolRunsOf(message.metadata).length} tool
                      {toolRunsOf(message.metadata).length === 1 ? "" : "s"} in
                      the sandbox
                    </summary>
                    {toolRunsOf(message.metadata).map((run, index) => {
                      const { request, result } = describeRun(run)
                      return (
                        <div className="tool-run" key={index}>
                          <b>{run.name}</b>
                          <pre>{request}</pre>
                          {result && (
                            <pre className="tool-output">{result}</pre>
                          )}
                        </div>
                      )
                    })}
                  </details>
                )}
                {sourceNames(message.metadata).length > 0 && (
                  <p className="message-sources">
                    Sources: {sourceNames(message.metadata).join(", ")}
                  </p>
                )}
                {memoryTitles(message.metadata).length > 0 && (
                  <p className="message-sources">
                    Remembered: {memoryTitles(message.metadata).join(", ")}
                  </p>
                )}
              </div>
            </article>
          ))}
          {streamingText && (
            <article
              data-message-role="assistant"
              data-streaming="true"
              className="message assistant streaming"
            >
              <div className="message-avatar">O</div>
              <div className="message-body">
                <strong>
                  OpenChat
                  <span className="message-model">{modelName(model)}</span>
                </strong>
                <p>{streamingText}</p>
              </div>
            </article>
          )}
        </div>
      )}
    </div>
  )
}

function Composer({
  error,
  sending,
  onSend,
}: Pick<WorkspaceProps, "error" | "sending" | "onSend">) {
  const [draft, setDraft] = useState("")

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || sending) return
    setDraft("")
    onSend(content)
  }

  return (
    <div className="composer-wrap">
      {error && <p className="chat-error">{error}</p>}
      <form className="composer" onSubmit={submit}>
        <textarea
          id="prompt-textarea"
          aria-label="Message OpenChat"
          placeholder="Message OpenChat…"
          rows={1}
          value={draft}
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={!draft.trim() || sending}
        >
          {sending ? "…" : <Icon name="arrow-up" size={18} />}
        </button>
      </form>
      <p className="model-note">
        OpenChat can make mistakes. Check important information.
      </p>
    </div>
  )
}

export function ChatWorkspace(props: WorkspaceProps) {
  return (
    <section className="conversation">
      <header className="chat-header">
        <button
          className="menu-button"
          type="button"
          onClick={props.onOpenSidebar}
          aria-label="Open menu"
        >
          <Icon name="menu" size={18} />
        </button>
        <div>
          <strong>
            {props.topic?.title || props.agent?.title || "New chat"}
          </strong>
          <span className="header-meta">
            {props.agent && !props.agent.virtual && (
              <span className="agent-chip">
                <AgentAvatar agent={props.agent} size={16} />
                {props.agent.title}
              </span>
            )}
            <ModelSwitchPanel
              current={props.model}
              disabled={props.sending}
              onSelect={props.onSelectModel}
            />
          </span>
        </div>
      </header>
      <Transcript
        user={props.user}
        agent={props.agent}
        topic={props.topic}
        model={props.model}
        sending={props.sending}
        streamingText={props.streamingText}
        onSend={props.onSend}
      />
      <Composer
        error={props.error}
        sending={props.sending}
        onSend={props.onSend}
      />
    </section>
  )
}
