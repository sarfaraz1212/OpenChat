-- Phase 12: Deep Research runs in the background and the page polls it, so the
-- run records what it is doing (searches made, sources read) as it goes.
ALTER TABLE research_sessions ADD COLUMN activity TEXT NOT NULL DEFAULT '[]';
