-- OpenChat initial schema (Cloudflare D1 / SQLite).
--
-- Ported from the Supabase/Postgres schema with these deliberate differences:
--   * No subscriptions / subscription_plans / user_keys — billing and BYOK are gone.
--   * No daily_* counters — message caps are LIFETIME, so `users.message_count`
--     is the only counter and nothing resets.
--   * No RLS. D1 has none; every query is scoped by user_id in lib/db/*.
--   * UUIDs are generated in the app (crypto.randomUUID()) and stored as TEXT.
--   * Timestamps are ISO-8601 TEXT so they sort lexicographically.
--   * Booleans are INTEGER 0/1, coerced at the repository boundary.
--   * JSON columns are TEXT, parsed at the repository boundary.

PRAGMA foreign_keys = ON;

-- ── users ────────────────────────────────────────────────────────────────────
-- password_hash is NULL for guests (anonymous = 1). email_canonical is
-- anti-abuse ONLY (+tag and Gmail dots collapsed) and must never be used for
-- login or identity — see lib/auth/emailIdentity.ts.
CREATE TABLE users (
  id                         TEXT PRIMARY KEY NOT NULL,
  email                      TEXT NOT NULL,
  email_canonical            TEXT,
  password_hash              TEXT,
  anonymous                  INTEGER NOT NULL DEFAULT 0,
  display_name               TEXT,
  profile_image              TEXT,
  favorite_models            TEXT,
  system_prompt              TEXT,
  message_count              INTEGER NOT NULL DEFAULT 0,
  onboarding_email_count     INTEGER NOT NULL DEFAULT 0,
  relance_step               INTEGER NOT NULL DEFAULT 0,
  opted_in_for_email_updates INTEGER NOT NULL DEFAULT 1,
  created_at                 TEXT NOT NULL,
  last_active_at             TEXT,
  deleted_at                 TEXT
);
CREATE UNIQUE INDEX idx_users_email     ON users(email);
CREATE INDEX idx_users_canonical        ON users(email_canonical);
CREATE INDEX idx_users_anonymous        ON users(anonymous);
CREATE INDEX idx_users_last_active      ON users(last_active_at);

-- ── sessions ─────────────────────────────────────────────────────────────────
-- Replaces Supabase Auth. The cookie carries `id` and nothing else.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ── projects ─────────────────────────────────────────────────────────────────
CREATE TABLE projects (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_projects_user ON projects(user_id);

-- ── chats ────────────────────────────────────────────────────────────────────
CREATE TABLE chats (
  id            TEXT PRIMARY KEY NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT,
  model         TEXT,
  system_prompt TEXT,
  public        INTEGER NOT NULL DEFAULT 0,
  pinned        INTEGER NOT NULL DEFAULT 0,
  pinned_at     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT
);
CREATE INDEX idx_chats_user       ON chats(user_id);
CREATE INDEX idx_chats_project    ON chats(project_id);
CREATE INDEX idx_chats_updated    ON chats(user_id, updated_at DESC);
CREATE INDEX idx_chats_public     ON chats(public);

-- ── messages ─────────────────────────────────────────────────────────────────
-- experimental_attachments and parts are JSON-encoded TEXT.
CREATE TABLE messages (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id                  TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id                  TEXT REFERENCES users(id) ON DELETE CASCADE,
  content                  TEXT,
  role                     TEXT NOT NULL CHECK (role IN ('system','user','assistant','data')),
  experimental_attachments TEXT,
  parts                    TEXT,
  message_group_id         TEXT,
  model                    TEXT,
  created_at               TEXT NOT NULL
);
CREATE INDEX idx_messages_chat    ON messages(chat_id, created_at);
CREATE INDEX idx_messages_user    ON messages(user_id);

-- ── chat_attachments ─────────────────────────────────────────────────────────
CREATE TABLE chat_attachments (
  id         TEXT PRIMARY KEY NOT NULL,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_url   TEXT NOT NULL,
  file_name  TEXT,
  file_type  TEXT,
  file_size  INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_attachments_chat ON chat_attachments(chat_id);
CREATE INDEX idx_attachments_user ON chat_attachments(user_id);

-- ── feedback ─────────────────────────────────────────────────────────────────
CREATE TABLE feedback (
  id         TEXT PRIMARY KEY NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_feedback_user ON feedback(user_id);

-- ── user_preferences ─────────────────────────────────────────────────────────
-- hidden_models is a JSON array in TEXT. The Postgres trigger that maintained
-- updated_at is gone; the repository sets it explicitly.
CREATE TABLE user_preferences (
  user_id                    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  layout                     TEXT    NOT NULL DEFAULT 'fullscreen',
  prompt_suggestions         INTEGER NOT NULL DEFAULT 1,
  show_tool_invocations      INTEGER NOT NULL DEFAULT 1,
  show_conversation_previews INTEGER NOT NULL DEFAULT 1,
  multi_model_enabled        INTEGER NOT NULL DEFAULT 0,
  hidden_models              TEXT    NOT NULL DEFAULT '[]',
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT
);

-- ── email_jobs ───────────────────────────────────────────────────────────────
CREATE TABLE email_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL,
  type        TEXT NOT NULL DEFAULT 'onboarding',
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, type, template_id)
);
CREATE INDEX idx_email_jobs_status ON email_jobs(status);

-- ── research_sessions ────────────────────────────────────────────────────────
CREATE TABLE research_sessions (
  id           TEXT PRIMARY KEY NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id      TEXT REFERENCES chats(id) ON DELETE CASCADE,
  topic        TEXT NOT NULL,
  depth        TEXT NOT NULL DEFAULT 'standard' CHECK (depth IN ('standard','deep')),
  status       TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed')),
  report_text  TEXT,
  sources      TEXT NOT NULL DEFAULT '[]',
  model        TEXT,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_research_user ON research_sessions(user_id, created_at DESC);
CREATE INDEX idx_research_chat ON research_sessions(chat_id);

-- ── generated_images ─────────────────────────────────────────────────────────
CREATE TABLE generated_images (
  id           TEXT PRIMARY KEY NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt       TEXT NOT NULL,
  style        TEXT NOT NULL DEFAULT 'none',
  aspect_ratio TEXT NOT NULL DEFAULT '1:1',
  model        TEXT NOT NULL,
  provider     TEXT NOT NULL,
  image_url    TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_images_user ON generated_images(user_id, created_at DESC);
