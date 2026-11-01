import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { api } from "../api"
import type {
  UsageAgent,
  UsageDay,
  UsageModel,
  UsageOverview,
  UsageTopic,
} from "../chat-types"
import { useShell } from "../components/AppShell"
import { Icon } from "../components/Icon"
import { modelName } from "../components/ModelSwitchPanel"

const RANGES = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "1y", label: "1 year" },
  { id: "all", label: "All time" },
] as const

type RangeId = (typeof RANGES)[number]["id"]

const exact = new Intl.NumberFormat("en")
const compact = new Intl.NumberFormat("en", { notation: "compact" })
const tokens = (value: number) =>
  value >= 10_000 ? compact.format(value) : exact.format(value)

type Data = {
  overview: UsageOverview
  models: UsageModel[]
  agents: UsageAgent[]
  topics: UsageTopic[]
  days: UsageDay[]
}

function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  )
}

/** One bar per day; the numbers are also in each bar's tooltip and the label. */
function Bars({
  days,
  metric,
}: {
  days: UsageDay[]
  metric: "messages" | "tokens"
}) {
  const values = days.map((day) =>
    metric === "tokens"
      ? day.totalTokens
      : day.userMessages + day.assistantMessages
  )
  const max = Math.max(1, ...values)
  const total = values.reduce((sum, value) => sum + value, 0)
  return (
    <div>
      <div
        className="bars"
        role="img"
        aria-label={`${metric === "tokens" ? "Tokens" : "Messages"} per day: ${exact.format(total)} in total over ${days.length} days`}
      >
        {days.map((day, index) => (
          <div
            className="bar-slot"
            key={day.date}
            title={`${day.date}: ${exact.format(values[index])} ${metric}`}
          >
            <span
              className="bar"
              style={{ height: `${(values[index] / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="bars-axis">
        <span>{days[0]?.date}</span>
        <span>{days.at(-1)?.date}</span>
      </div>
    </div>
  )
}

/** A calendar grid of the days, shaded by how many messages you sent. */
function Heatmap({ days }: { days: UsageDay[] }) {
  const max = Math.max(1, ...days.map((day) => day.userMessages))
  const level = (count: number) =>
    count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4))
  // Weeks run Sunday to Saturday; pad the first week so days line up.
  const firstWeekday = new Date(`${days[0]?.date}T00:00:00Z`).getUTCDay()
  const cells: Array<UsageDay | null> = [
    ...Array<null>(Number.isNaN(firstWeekday) ? 0 : firstWeekday).fill(null),
    ...days,
  ]
  const weeks: Array<Array<UsageDay | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const active = days.filter((day) => day.userMessages > 0).length
  return (
    <div>
      <div
        className="heatmap"
        role="img"
        aria-label={`Activity heatmap: you were active on ${active} of ${days.length} days`}
      >
        {weeks.map((week, index) => (
          <div className="heat-col" key={index}>
            {week.map((day, slot) =>
              day ? (
                <span
                  key={day.date}
                  className={`heat level-${level(day.userMessages)}`}
                  title={`${day.date}: ${day.userMessages} message${day.userMessages === 1 ? "" : "s"} sent`}
                />
              ) : (
                <span key={`pad-${slot}`} className="heat pad" />
              )
            )}
          </div>
        ))}
      </div>
      <div className="heat-legend" aria-hidden>
        Less
        {[0, 1, 2, 3, 4].map((n) => (
          <span key={n} className={`heat level-${n}`} />
        ))}
        More
      </div>
    </div>
  )
}

type RankRow = {
  key: string
  label: string
  detail: string
  value: number
  to?: string
}

function Ranking({ rows, empty }: { rows: RankRow[]; empty: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value))
  if (rows.length === 0) return <p className="panel-note flush">{empty}</p>
  return (
    <ul className="ranking">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="ranking-head">
            {row.to ? (
              <Link className="link-button" to={row.to}>
                {row.label}
              </Link>
            ) : (
              <strong>{row.label}</strong>
            )}
            <span>{row.detail}</span>
          </div>
          <div className="ranking-track" aria-hidden>
            <span style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const replies = (count: number) =>
  `${exact.format(count)} ${count === 1 ? "reply" : "replies"}`

/** Your own usage, from the messages you have sent and received. */
export function Usage() {
  const shell = useShell()
  const [range, setRange] = useState<RangeId>("30d")
  const [metric, setMetric] = useState<"messages" | "tokens">("messages")
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState("")
  const tzOffsetMinutes = useMemo(() => -new Date().getTimezoneOffset(), [])

  useEffect(() => {
    let cancelled = false
    const query = { range, tzOffsetMinutes }
    void Promise.all([
      api.usage.overview.query(query),
      api.usage.byModel.query(query),
      api.usage.byAgent.query(query),
      api.usage.byTopic.query(query),
      api.usage.daily.query(query),
    ])
      .then(([overview, models, agents, topics, days]) => {
        if (cancelled) return
        setError("")
        setData({ overview, models, agents, topics, days })
      })
      .catch(() => {
        if (!cancelled) setError("Could not load your usage.")
      })
    return () => {
      cancelled = true
    }
  }, [range, tzOffsetMinutes])

  const overview = data?.overview
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
          <strong>Usage</strong>
          <span className="model-identity">
            What you have sent and received. Display only: nothing is limited or
            billed
          </span>
        </div>
      </header>
      <div className="settings-body wide">
        {error && <p className="chat-error">{error}</p>}

        <div className="segmented" role="group" aria-label="Time range">
          {RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={range === option.id}
              className={range === option.id ? "active" : ""}
              onClick={() => setRange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {!data && !error && <p className="panel-note">Loading…</p>}
        {data && overview && (
          <>
            <div className="stat-grid">
              <Stat
                label="Messages"
                value={exact.format(overview.messages)}
                note={`${exact.format(overview.userMessages)} sent · ${exact.format(overview.assistantMessages)} received`}
              />
              <Stat
                label="Tokens"
                value={tokens(overview.totalTokens)}
                note={`${tokens(overview.inputTokens)} in · ${tokens(overview.outputTokens)} out`}
              />
              <Stat
                label="Conversations"
                value={exact.format(overview.topics)}
              />
              <Stat label="Agents used" value={exact.format(overview.agents)} />
            </div>
            <p className="panel-note flush">
              Token counts are what the model reported for each reply.
              {overview.assistantMessages > overview.repliesWithUsage && (
                <>
                  {" "}
                  It reported them for {exact.format(
                    overview.repliesWithUsage
                  )}{" "}
                  of {exact.format(overview.assistantMessages)} replies; the
                  rest count as zero.
                </>
              )}{" "}
              Memory, goal planning and review calls leave no message and are
              not counted.
            </p>

            <div className="form-card">
              <div className="chart-head">
                <h2 className="card-title">Per day</h2>
                <div
                  className="segmented small"
                  role="group"
                  aria-label="Chart metric"
                >
                  {(["messages", "tokens"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={metric === option}
                      className={metric === option ? "active" : ""}
                      onClick={() => setMetric(option)}
                    >
                      {option === "messages" ? "Messages" : "Tokens"}
                    </button>
                  ))}
                </div>
              </div>
              <Bars days={data.days} metric={metric} />
            </div>

            <div className="form-card">
              <h2 className="card-title">Activity</h2>
              <Heatmap days={data.days} />
            </div>

            <div className="form-card">
              <h2 className="card-title">Models</h2>
              <Ranking
                empty="No replies in this range."
                rows={data.models.map((row) => ({
                  key: row.model ?? "unknown",
                  label: row.model ? modelName(row.model) : "Unknown model",
                  detail: `${tokens(row.totalTokens)} tokens · ${replies(row.replies)}`,
                  value: row.totalTokens,
                }))}
              />
            </div>

            <div className="form-card">
              <h2 className="card-title">Agents</h2>
              <Ranking
                empty="No replies in this range."
                rows={data.agents.map((row) => ({
                  key: row.agentId ?? "none",
                  label: row.title ?? "No agent",
                  detail: `${tokens(row.totalTokens)} tokens · ${replies(row.replies)}`,
                  value: row.totalTokens,
                }))}
              />
            </div>

            <div className="form-card">
              <h2 className="card-title">Most active conversations</h2>
              <Ranking
                empty="No conversations in this range."
                rows={data.topics.map((row) => ({
                  key: row.id,
                  label: row.title,
                  detail: `${exact.format(row.messages)} messages · ${tokens(row.totalTokens)} tokens`,
                  value: row.messages,
                  to: `/chat/${row.id}`,
                }))}
              />
            </div>
          </>
        )}
      </div>
    </section>
  )
}
