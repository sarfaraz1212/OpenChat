# 0013 — Phase 4 agents and agent groups

**The agent is the unit; chat nests under it.** Migration `0005` adds `agents`, `chat_groups` and `chat_groups_agents` (LobeHub's column names, jsonb as JSON text, workspace/market/editor/TTS columns not carried) and `topics.agent_id`, cascading: deleting an agent deletes its topics and, through the existing cascade, their messages. Every user has a default **"Just Chat"** agent (`slug = 'inbox'`, `virtual = 1`), created lazily and idempotently (`ON CONFLICT … DO NOTHING` on a partial unique index, so concurrent first requests cannot collide). It cannot be deleted. Topics created without an agent land under it.

The fetch-seam tests start from an empty schema, so they cannot cover the migration's backfill of Phase 2 topics into each user's default agent. That was checked separately against a scratch SQLite database: migrations `0001`–`0004`, seeded users/topics/messages, then `0005`. Each user with topics got exactly one default agent and kept all topics and messages; `PRAGMA foreign_key_check` was clean.

**A turn is prepared by a pure function.** `lib/chat/prepare-turn.ts` maps an agent plus the topic's history to the model call: the system prompt is the agent's `systemRole` (else the OpenChat default), the history is windowed to `chatConfig.historyCount` if set, and `params` (temperature, top-p, max tokens) are passed through. The model is resolved as request → topic → agent → default, and the topic remembers the result (decision 0012). Retrieval (Phase 5) hooks in here.

**API shape.** Agents and groups are exposed camelCase with JSON already parsed (`systemRole`, `openingQuestions`), unlike the older row-shaped topics and messages (`agent_id`, `user_id`). Both conventions are documented in `lib/db/types.ts`; unifying them would be a separate change.

**Groups are membership containers only.** `agentGroup.*` creates, edits and deletes groups and manages their ordered members, and all ownership is validated (a rejected add writes nothing). Multi-agent conversation inside a group (supervisor, turn-taking) is not built: the phase's stated scope is "tables and minimal UI", and that orchestration is a large subsystem of its own. **Flagging this for the user**: if group chat is wanted it needs its own phase.

**Client-only details.** An agent's opening message and opening questions render in the empty chat state and are not persisted as messages. Destructive buttons use an inline two-step confirm (`ConfirmButton`) because the repo lints `window.confirm` (`no-alert`).
