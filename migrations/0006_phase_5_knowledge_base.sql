-- Phase 5: knowledge base / RAG.
--
-- Files live in R2; their chunk *text* lives here, and their vectors live in the
-- Vectorize index (id = chunks.id, namespace = user id, metadata.file_id). Only
-- text-based files are indexed for now, and inline in the upload request, so a
-- file is `pending`/`processing` only for the length of that request.
-- Names follow LobeHub's `files`, `chunks`, `knowledge_bases`,
-- `knowledge_base_files`, `agents_knowledge_bases` and `agents_files`.

CREATE TABLE files (
  id          TEXT PRIMARY KEY NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  file_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  r2_key      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error       TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_files_user ON files(user_id, created_at DESC);

CREATE TABLE chunks (
  id          TEXT PRIMARY KEY NOT NULL,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_chunks_file ON chunks(file_id, chunk_index);

CREATE TABLE knowledge_bases (
  id          TEXT PRIMARY KEY NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_knowledge_bases_user ON knowledge_bases(user_id, updated_at DESC);

CREATE TABLE knowledge_base_files (
  knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  file_id           TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (knowledge_base_id, file_id)
);
CREATE INDEX idx_knowledge_base_files_file ON knowledge_base_files(file_id);

CREATE TABLE agents_knowledge_bases (
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (agent_id, knowledge_base_id)
);

CREATE TABLE agents_files (
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, file_id)
);
