-- Phase 3: per-user model/provider preferences.
--
-- The model catalog itself is code (src/shared/models.ts): OpenChat is locked to
-- Cloudflare Workers AI, so there is no provider registry to store. Like
-- LobeHub's `ai_providers` / `ai_models`, these tables hold only a user's
-- overrides of the catalog defaults (everything is enabled until a row says
-- otherwise), keyed by (id, [provider_id,] user_id).

CREATE TABLE ai_providers (
  id         TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled    INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE ai_models (
  id          TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled     INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (id, provider_id, user_id)
);
CREATE INDEX idx_ai_models_user ON ai_models(user_id, provider_id);
