# 0018 — Phase 11 usage analytics

**Computed from messages, at query time.** There is no stats table and no rollup job: each statistic is an aggregate over the signed-in user's own `messages` (joined to `topics` for the agent). This is upstream's approach too (a `usage` JSON column on the message, summed by queries), with Postgres jsonb replaced by SQLite `json_extract`. It keeps the numbers exactly as trustworthy as what is stored, and there is nothing to keep in sync. Migration `0009` adds one index, `messages(user_id, created_at)`, so a date-range query seeks to the range instead of reading all of a user's messages (D1 bills rows read).

**What is counted.** User and assistant messages, and the token counts the provider reported for each reply (`inputTokens`, `outputTokens`, `totalTokens`, the AI SDK's field names). Nothing is estimated: a reply whose provider reported no usage counts as a reply with zero tokens, and the page says how many replies had a report. Two fixes came out of the tests: a chat turn that used tools now stores the **whole turn's** usage (`totalUsage`, all model calls) rather than only the last step's, and goal task replies now store their usage, so agent-run work is not invisible.

**What is not counted (flagged on the page).** Calls that leave no message: memory extraction, and goal planning and review. Those are real model calls, and the totals under-state them. Recording them would need a separate usage log, which is a bigger change than this display-only phase warrants; revisit if the numbers are ever used for anything but display.

**What was left out of upstream's dashboard.** Cost and spend (`TodaySpend`, `MonthSpend`, the usage table by billing key): pricing is out of scope and the catalog has no price data, so there is nothing honest to show. The overview's Share button: sharing was removed in Phase 10. Upstream's per-model "active models" table is folded into the model ranking.

**Built:** overview cards (messages sent and received, tokens in and out, conversations, agents used), a per-day chart (messages or tokens), an activity heatmap (messages sent per day), and rankings for models and agents (by tokens) and conversations (by message count, top 10, each linking to the chat). Ranges are 7 days, 30 days, 90 days, 1 year and all time. Totals cover the whole range; for "all time" the daily chart and heatmap show the last 365 days.

**Goal task workspaces** (topics with `metadata.taskId`) are not chats, so they are not counted as conversations and never appear in that ranking, the same as in the chat list. Their messages and tokens do count in the totals, and by model and agent, because the work was done.

**Time zones.** The browser sends its current UTC offset and days are bucketed on that clock. A fixed offset is not daylight-saving-aware for past dates, so a message sent within an hour of midnight in a past period that crossed a clock change can land on the neighbouring day. Accepted as a display-only imprecision.

**Privacy.** Every query is scoped to the signed-in user; there are no workspace-wide or admin statistics (multi-tenancy is deferred, decision 0008).

**Pending real verification:** the queries were exercised through the Worker's fetch interface against local D1 with fake providers. Not yet seen: real Workers AI actually returning usage on a streamed reply (the code reads the SDK's `totalUsage`, which depends on the provider sending a usage chunk), and the page with real data in a browser (a smoke of all the new pages is in the Phase 14 list).
