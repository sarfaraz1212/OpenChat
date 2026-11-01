-- Phase 6: cross-session user memory.
--
-- LobeHub splits memory over six tables (a base table plus one per layer) with
-- eleven pgvector columns. Here the layers share one table, `user_memories`,
-- with a `layer` column and layer-specific fields in the `attributes` JSON, and
-- each memory has ONE vector (title + summary + details) in the Vectorize
-- `MEMORY_VECTORS` index, keyed by the memory id in the user's namespace.
-- `user_persona` is LobeHub's rolling profile and has no vector, as upstream.

CREATE TABLE user_memories (
  id              TEXT PRIMARY KEY NOT NULL,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  layer           TEXT NOT NULL
                  CHECK (layer IN ('identity','preference','experience','activity','context')),
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  details         TEXT,
  tags            TEXT NOT NULL DEFAULT '[]',
  attributes      TEXT NOT NULL DEFAULT '{}',
  confidence      REAL,
  source_topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_user_memories_user ON user_memories(user_id, layer, updated_at DESC);

CREATE TABLE user_persona (
  user_id    TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona    TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- Memory is on for everyone until a row says otherwise.
CREATE TABLE user_memory_settings (
  user_id    TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled    INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- How many of a topic's messages have been through extraction, so a retried
-- workflow does not process (and duplicate) the same conversation twice.
CREATE TABLE topic_memory_state (
  topic_id                TEXT PRIMARY KEY NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  extracted_message_count INTEGER NOT NULL,
  updated_at              TEXT NOT NULL
);
