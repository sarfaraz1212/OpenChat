-- Phase 2 replaces the legacy Zola chat tables with the LobeHub vocabulary.
-- The user explicitly chose a clean cut: no legacy chat data is migrated.
PRAGMA defer_foreign_keys = ON;

ALTER TABLE sessions RENAME TO auth_sessions;
ALTER TABLE research_sessions RENAME TO research_sessions_legacy;

DROP TABLE chat_attachments;
DROP TABLE messages;

CREATE TABLE topics (
  id          TEXT PRIMARY KEY NOT NULL,
  title       TEXT,
  favorite    INTEGER NOT NULL DEFAULT 0,
  content     TEXT,
  description TEXT,
  metadata    TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  model       TEXT,
  provider    TEXT NOT NULL DEFAULT 'cloudflare',
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_topics_user ON topics(user_id, updated_at DESC);
CREATE INDEX idx_topics_id_user ON topics(id, user_id);

CREATE TABLE messages (
  id         TEXT PRIMARY KEY NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
  content    TEXT,
  metadata   TEXT,
  usage      TEXT,
  model      TEXT,
  provider   TEXT NOT NULL DEFAULT 'cloudflare',
  favorite   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id   TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_messages_topic ON messages(topic_id, created_at, id);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_parent ON messages(parent_id);

-- Retained for the carry-forward Deep Research feature in Phase 12, but its
-- legacy chat foreign key now follows the canonical Topic vocabulary.
CREATE TABLE research_sessions (
  id           TEXT PRIMARY KEY NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id     TEXT REFERENCES topics(id) ON DELETE CASCADE,
  topic        TEXT NOT NULL,
  depth        TEXT NOT NULL DEFAULT 'standard' CHECK (depth IN ('standard','deep')),
  status       TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed')),
  report_text  TEXT,
  sources      TEXT NOT NULL DEFAULT '[]',
  model        TEXT,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

-- Preserve the carry-forward Deep Research history. Its old chats are
-- deliberately not migrated, so the obsolete relation becomes NULL.
INSERT INTO research_sessions (
  id, user_id, topic_id, topic, depth, status, report_text, sources, model,
  created_at, completed_at
)
SELECT
  id, user_id, NULL, topic, depth, status, report_text, sources, model,
  created_at, completed_at
FROM research_sessions_legacy;

DROP TABLE research_sessions_legacy;
CREATE INDEX idx_research_user ON research_sessions(user_id, created_at DESC);
CREATE INDEX idx_research_topic ON research_sessions(topic_id);

DROP TABLE chats;
DROP TABLE projects;
DROP TABLE feedback;
DROP TABLE user_preferences;
