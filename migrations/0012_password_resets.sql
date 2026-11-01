-- Password reset links. Only a SHA-256 of the token is stored, so a copy of this
-- table cannot be used to take over an account: the token itself exists only in
-- the email. A link is single-use (used_at) and short-lived (expires_at), and
-- asking for a new one retires the older ones.
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id, created_at);
