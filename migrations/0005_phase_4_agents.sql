-- Phase 4: agents (LobeHub's core unit: chat lives nested under an agent) and
-- agent groups. Column names follow LobeHub's `agents`, `chat_groups` and
-- `chat_groups_agents`; jsonb becomes TEXT holding JSON, arrays become
-- JSON-text, and tables the app has no use for yet (workspace, market,
-- editor, agency and TTS columns) are not carried over.

CREATE TABLE agents (
  id                TEXT PRIMARY KEY NOT NULL,
  -- 'inbox' marks the per-user default agent; custom agents have no slug.
  slug              TEXT,
  title             TEXT,
  description       TEXT,
  tags              TEXT NOT NULL DEFAULT '[]',
  avatar            TEXT,
  background_color  TEXT,
  system_role       TEXT,
  model             TEXT,
  provider          TEXT NOT NULL DEFAULT 'cloudflare',
  params            TEXT,
  chat_config       TEXT,
  opening_message   TEXT,
  opening_questions TEXT NOT NULL DEFAULT '[]',
  pinned            INTEGER NOT NULL DEFAULT 0,
  virtual           INTEGER NOT NULL DEFAULT 0,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_agents_user_slug ON agents(user_id, slug) WHERE slug IS NOT NULL;
CREATE INDEX idx_agents_user ON agents(user_id, updated_at DESC);

CREATE TABLE chat_groups (
  id               TEXT PRIMARY KEY NOT NULL,
  title            TEXT,
  description      TEXT,
  avatar           TEXT,
  background_color TEXT,
  config           TEXT,
  pinned           INTEGER NOT NULL DEFAULT 0,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_chat_groups_user ON chat_groups(user_id, updated_at DESC);

CREATE TABLE chat_groups_agents (
  chat_group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled       INTEGER NOT NULL DEFAULT 1,
  position      INTEGER NOT NULL DEFAULT 0,
  role          TEXT NOT NULL DEFAULT 'participant',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (chat_group_id, agent_id)
);
CREATE INDEX idx_chat_groups_agents_agent ON chat_groups_agents(agent_id);

-- Topics now belong to an agent. Deleting an agent deletes its topics (and,
-- through the existing cascade, their messages).
ALTER TABLE topics ADD COLUMN agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE;
CREATE INDEX idx_topics_agent ON topics(agent_id, updated_at DESC);

-- Phase 2 topics have no agent: give each user who has any a default "Just
-- Chat" agent and move them under it. Users without topics get theirs lazily.
INSERT INTO agents (id, slug, title, virtual, user_id, created_at, updated_at)
SELECT lower(hex(randomblob(16))), 'inbox', 'Just Chat', 1, user_id,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (SELECT DISTINCT user_id FROM topics);

UPDATE topics
SET agent_id = (
  SELECT agents.id FROM agents
  WHERE agents.user_id = topics.user_id AND agents.slug = 'inbox'
);
