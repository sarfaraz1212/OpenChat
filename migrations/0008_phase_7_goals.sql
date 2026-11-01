-- Phase 7: goals and task graphs.
--
-- Follows LobeHub's `goals`, `goal_nodes`, `goal_edges`, `goal_node_decisions`,
-- `goal_events` and `tasks`, minus the tables for work versions, traces and
-- the exploration/supervision layers (see decision 0016). jsonb is TEXT.

CREATE TABLE goals (
  id              TEXT PRIMARY KEY NOT NULL,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The agent that supervises the goal; its persona runs planning turns.
  agent_id        TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  -- "What counts as done": the acceptance requirement.
  requirement     TEXT,
  -- { taskAgentId?: string, maxManagerTurns?: number }
  config          TEXT NOT NULL DEFAULT '{}',
  max_rounds      INTEGER NOT NULL DEFAULT 8,
  rounds          INTEGER NOT NULL DEFAULT 0,
  manager_turns   INTEGER NOT NULL DEFAULT 0,
  -- Consecutive planner replies that failed validation.
  invalid_plans   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'planning'
                  CHECK (status IN ('planning','running','paused','achieved','failed','stopped')),
  status_reason   TEXT,
  -- Only one scheduler tick may run a goal at a time.
  lease_until     TEXT,
  started_at      TEXT,
  completed_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_goals_user ON goals(user_id, updated_at DESC);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id      TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  -- The executor agent.
  agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','running','completed','failed','canceled')),
  result       TEXT,
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  -- The topic holding the executor's conversation, for inspection.
  topic_id     TEXT REFERENCES topics(id) ON DELETE SET NULL,
  started_at   TEXT,
  completed_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_tasks_goal ON tasks(goal_id);

CREATE TABLE goal_nodes (
  id          TEXT PRIMARY KEY NOT NULL,
  goal_id     TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('task','verification','decision')),
  status      TEXT NOT NULL DEFAULT 'proposed'
              CHECK (status IN ('proposed','ready','running','delivered','blocked','retired')),
  title       TEXT NOT NULL,
  description TEXT,
  task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  -- The reviewer's ruling, for verification nodes.
  verdict     TEXT CHECK (verdict IN ('pass','fail')),
  priority    INTEGER NOT NULL DEFAULT 0,
  -- Which planning round created the node.
  round       INTEGER NOT NULL,
  resolved_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_goal_nodes_goal ON goal_nodes(goal_id, round, priority);

-- `source_node_id` depends on `target_node_id`.
CREATE TABLE goal_edges (
  id             TEXT PRIMARY KEY NOT NULL,
  goal_id        TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL REFERENCES goal_nodes(id) ON DELETE CASCADE,
  target_node_id TEXT NOT NULL REFERENCES goal_nodes(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'depends_on' CHECK (kind IN ('depends_on')),
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_goal_edges_goal ON goal_edges(goal_id);

-- A human-in-the-loop gate: the goal pauses until a person picks an option.
CREATE TABLE goal_node_decisions (
  id                    TEXT PRIMARY KEY NOT NULL,
  goal_id               TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  node_id               TEXT NOT NULL REFERENCES goal_nodes(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','resolved','canceled')),
  question              TEXT NOT NULL,
  -- [{ id, label }]
  options               TEXT NOT NULL DEFAULT '[]',
  recommended_option_id TEXT,
  resolved_option_id    TEXT,
  resolution            TEXT,
  resolved_at           TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX idx_goal_decisions_goal ON goal_node_decisions(goal_id, status);

CREATE TABLE goal_events (
  id          TEXT PRIMARY KEY NOT NULL,
  goal_id     TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('system','agent','user')),
  reason      TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_goal_events_goal ON goal_events(goal_id, created_at);
