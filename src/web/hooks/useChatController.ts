import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router"
import {
  DEFAULT_CHAT_MODEL,
  isChatModelId,
  type ChatModelId,
} from "../../shared/models"
import { api, csrfHeaders } from "../api"
import type { Agent, Message, TopicDetail } from "../chat-types"
import { useCurrentUser } from "../session"
import { useWorkspace } from "../workspace"

const errorMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

const INBOX = "inbox"

export function useChatController() {
  const user = useCurrentUser()
  const { topicId, agentId: routeAgentId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { addTopic, refreshTopics } = useWorkspace()
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [agent, setAgent] = useState<Agent | null>(null)
  // A model picked before the topic exists; scoped to the agent it was picked for.
  const [draft, setDraft] = useState<{
    agentId: string
    model: ChatModelId
  } | null>(null)
  const [streamingText, setStreamingText] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  // A topic we just created already holds the optimistic turn; reloading it
  // from the server on navigation would race the message insert.
  const skipReloadFor = useRef<string | null>(null)

  // Which agent this screen is about: the topic's, else the route's, else the
  // default. `null` while a topic is still loading and its agent is unknown.
  const wantedAgent = topicId
    ? topic
      ? (topic.agent_id ?? INBOX)
      : null
    : (routeAgentId ?? INBOX)
  const currentAgent =
    agent &&
    wantedAgent &&
    (wantedAgent === INBOX ? agent.virtual : agent.id === wantedAgent)
      ? agent
      : null

  const draftModel =
    draft && currentAgent && draft.agentId === currentAgent.id
      ? draft.model
      : null
  const agentModel =
    currentAgent?.model && isChatModelId(currentAgent.model)
      ? currentAgent.model
      : null
  const model: ChatModelId =
    topic?.model && isChatModelId(topic.model)
      ? topic.model
      : (draftModel ?? agentModel ?? DEFAULT_CHAT_MODEL)

  async function loadTopic(id: string) {
    setTopic(await api.topic.get.query({ id }))
  }

  useEffect(() => {
    if (!topicId) {
      setTopic(null)
      return
    }
    if (skipReloadFor.current === topicId) {
      skipReloadFor.current = null
      return
    }
    setError("")
    void loadTopic(topicId).catch((cause: unknown) => {
      setError(errorMessage(cause, "Could not load this topic."))
      navigate("/", { replace: true })
    })
  }, [location.key, navigate, topicId])

  useEffect(() => {
    if (!wantedAgent) return
    let cancelled = false
    const request =
      wantedAgent === INBOX
        ? api.agent.inbox.query()
        : api.agent.get.query({ id: wantedAgent })
    request
      .then((loaded) => {
        if (!cancelled) setAgent(loaded)
      })
      .catch(() => {
        if (cancelled) return
        setError("Could not load this agent.")
        navigate("/", { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [wantedAgent, navigate])

  async function selectModel(next: ChatModelId) {
    setError("")
    if (!topic) {
      if (currentAgent) setDraft({ agentId: currentAgent.id, model: next })
      return
    }
    try {
      const updated = await api.topic.update.mutate({
        id: topic.id,
        model: next,
      })
      setTopic((current) =>
        current ? { ...current, model: updated.model } : current
      )
    } catch (cause) {
      setError(errorMessage(cause, "Could not switch models."))
    }
  }

  async function send(content: string) {
    if (!content || sending || !currentAgent) return
    setSending(true)
    setError("")
    setStreamingText("")
    try {
      const isFirstTurn = !topic || topic.messages.length === 0
      let active = topic
      if (!active) {
        const created = await api.topic.create.mutate({
          agentId: currentAgent.id,
          model,
        })
        addTopic(created)
        active = { ...created, messages: [] }
        skipReloadFor.current = created.id
        navigate(`/chat/${created.id}`, { replace: true })
      }

      const timestamp = new Date().toISOString()
      const optimistic: Message = {
        id: `pending-${crypto.randomUUID()}`,
        role: "user",
        content,
        metadata: null,
        usage: null,
        model,
        provider: "cloudflare",
        favorite: false,
        error: null,
        user_id: user.id,
        topic_id: active.id,
        parent_id: null,
        created_at: timestamp,
        updated_at: timestamp,
      }
      setTopic({ ...active, messages: [...active.messages, optimistic] })

      const response = await fetch(`/api/chat/topics/${active.id}/messages`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ content, model }),
      })
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(body.error || "The model could not answer.")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let reply = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        reply += decoder.decode(value, { stream: true })
        setStreamingText(reply)
      }
      reply += decoder.decode()
      setStreamingText(reply)

      if (isFirstTurn) {
        const title = content.length > 48 ? `${content.slice(0, 47)}…` : content
        await api.topic.update.mutate({ id: active.id, title })
      }
      await Promise.all([loadTopic(active.id), refreshTopics()])
      setStreamingText("")
    } catch (cause) {
      setError(errorMessage(cause, "The message could not be sent."))
    } finally {
      setSending(false)
    }
  }

  return {
    user,
    agent: currentAgent,
    topic,
    model,
    streamingText,
    sending,
    error,
    selectModel,
    send,
  }
}
