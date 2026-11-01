import { useState } from "react"
import { NavLink, useNavigate } from "react-router"
import type { Agent, AgentGroup, CurrentUser, Topic } from "../chat-types"
import { AgentAvatar } from "./AgentAvatar"
import { Icon } from "./Icon"

type SidebarProps = {
  open: boolean
  collapsed: boolean
  user: CurrentUser
  topicId?: string
  activeAgentId?: string
  groupId?: string
  topics: Topic[]
  agents: Agent[]
  groups: AgentGroup[]
  error: string
  onClose: () => void
  onCollapse: () => void
  onCreateAgent: () => void
  onCreateGroup: () => void
  onRemoveTopic: (id: string) => void
  onSignOut: () => void
}

export const userInitial = (user: CurrentUser) =>
  (user.display_name || user.email)[0].toUpperCase()

export function Sidebar(props: SidebarProps) {
  const navigate = useNavigate()
  const [searching, setSearching] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [query, setQuery] = useState("")
  const displayName = props.user.display_name || props.user.email.split("@")[0]
  const match = (value: string | null | undefined) =>
    !query || value?.toLowerCase().includes(query.toLowerCase())
  const visibleTopics = props.topics.filter((topic) => match(topic.title))
  const visibleAgents = props.agents.filter((agent) => match(agent.title))
  const go = (path: string) => {
    props.onClose()
    navigate(path)
  }

  return (
    <aside
      className={`sidebar home-sidebar ${props.open ? "sidebar-open" : ""} ${props.collapsed ? "home-sidebar-collapsed" : ""}`}
    >
      <div className="home-sidebar-user">
        <button
          type="button"
          className="home-user-menu-trigger"
          aria-expanded={userMenuOpen}
          onClick={() => setUserMenuOpen((value) => !value)}
        >
          <div className="avatar home-user-avatar">
            {userInitial(props.user)}
          </div>
          <strong>{displayName}</strong>
        </button>
        <button
          type="button"
          aria-label="Collapse sidebar"
          onClick={props.onCollapse}
        >
          <Icon name="panel-left" size={16} />
        </button>
        <button type="button" aria-label="Notifications">
          <Icon name="bell" size={16} />
        </button>
        <button
          className="mobile-close"
          onClick={props.onClose}
          aria-label="Close menu"
        >
          <Icon name="x" size={20} />
        </button>
      </div>
      {userMenuOpen && (
        <div className="home-user-menu">
          <NavLink to="/settings/account" onClick={props.onClose}>
            <Icon name="user" size={16} /> Account
          </NavLink>
          <NavLink to="/settings/provider/cloudflare" onClick={props.onClose}>
            <Icon name="sliders" size={16} /> Models
          </NavLink>
          <button type="button" onClick={props.onSignOut}>
            <Icon name="log-out" size={16} /> Sign out
          </button>
        </div>
      )}

      {searching ? (
        <div className="home-sidebar-search">
          <Icon name="search" size={16} />
          <input
            autoFocus
            aria-label="Search chats and agents"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            aria-label="Close search"
            onClick={() => {
              setSearching(false)
              setQuery("")
            }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ) : (
        <nav className="home-primary-nav" aria-label="Main navigation">
          <button type="button" onClick={() => setSearching(true)}>
            <Icon name="search" size={17} /> Search
          </button>
          <NavLink to="/" end onClick={props.onClose}>
            <Icon name="home" size={17} /> Home
          </NavLink>
          <NavLink to="/goals" onClick={props.onClose}>
            <Icon name="list-check" size={17} /> Tasks
          </NavLink>
          <NavLink to="/knowledge" onClick={props.onClose}>
            <Icon name="book" size={17} /> Resources
          </NavLink>
        </nav>
      )}

      <div className="sidebar-scroll">
        <nav className="topic-list" aria-label="Agents">
          <div className="topic-label section-label home-section-label">
            RECENTS <Icon name="chevron-down" size={10} />
          </div>
          {visibleTopics.slice(0, 6).map((topic) => (
            <div
              className={`topic-row ${topic.id === props.topicId ? "active" : ""}`}
              key={topic.id}
            >
              <button
                className="topic-link"
                type="button"
                onClick={() => go(`/chat/${topic.id}`)}
              >
                <span className="topic-icon">
                  <Icon name="file" size={14} />
                </span>
                <span>{topic.title || "Untitled"}</span>
              </button>
              <button
                className="topic-delete"
                type="button"
                aria-label={`Delete ${topic.title || "chat"}`}
                onClick={() => props.onRemoveTopic(topic.id)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <div className="topic-label section-label home-section-label home-agents-label">
            AGENTS <Icon name="chevron-down" size={10} />
          </div>
          {visibleAgents.map((agent) => (
            <div
              key={agent.id}
              className={`topic-row ${agent.id === props.activeAgentId ? "active" : ""}`}
            >
              <button
                className="topic-link"
                type="button"
                onClick={() => go(agent.virtual ? "/" : `/agent/${agent.id}`)}
              >
                <AgentAvatar agent={agent} size={22} />
                <span>
                  {agent.virtual
                    ? "OpenChat AI"
                    : agent.title || "Untitled agent"}
                </span>
              </button>
              {!agent.virtual && (
                <button
                  className="topic-delete"
                  type="button"
                  aria-label={`Edit ${agent.title || "agent"}`}
                  onClick={() => go(`/agent/${agent.id}/profile`)}
                >
                  <Icon name="more" size={14} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="home-add-agent"
            onClick={props.onCreateAgent}
          >
            <Icon name="plus" size={15} /> Add Agent
          </button>
          {props.groups.length > 0 && (
            <div className="topic-label section-label home-section-label home-agents-label">
              GROUPS
            </div>
          )}
          {props.groups.map((group) => (
            <div
              key={group.id}
              className={`topic-row ${group.id === props.groupId ? "active" : ""}`}
            >
              <button
                className="topic-link"
                type="button"
                onClick={() => go(`/group/${group.id}`)}
              >
                <span className="topic-icon">
                  {group.avatar || <Icon name="grid" size={14} />}
                </span>
                <span>{group.title || "Untitled group"}</span>
              </button>
            </div>
          ))}
          <button
            type="button"
            className="home-add-agent"
            onClick={props.onCreateGroup}
          >
            <Icon name="plus" size={15} /> Add Group
          </button>
        </nav>
      </div>

      {props.error && <p className="chat-error sidebar-error">{props.error}</p>}
      <nav className="home-secondary-nav" aria-label="Workspace navigation">
        <NavLink to="/images" onClick={props.onClose}>
          <Icon name="image" size={17} /> Generation
        </NavLink>
        <NavLink to="/usage" onClick={props.onClose}>
          <Icon name="bar-chart" size={17} /> Usage
        </NavLink>
        <NavLink to="/deep-research" onClick={props.onClose}>
          <Icon name="file" size={17} /> Pages
        </NavLink>
        <NavLink to="/memory" onClick={props.onClose}>
          <Icon name="gem" size={17} /> Memory
        </NavLink>
      </nav>
      <div className="home-workspace-card">
        <span className="home-ai-avatar">
          <img src="/logo-openchat-mark.svg" alt="" />
        </span>
        <span>
          <strong>OpenChat workspace</strong>
          <small>Cloudflare Workers AI</small>
        </span>
      </div>
      <button type="button" className="home-sidebar-help" aria-label="Help">
        ?
      </button>
    </aside>
  )
}
