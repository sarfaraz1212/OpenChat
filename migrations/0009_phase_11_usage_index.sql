-- Phase 11: usage statistics read a user's messages within a date range. The
-- existing idx_messages_user only narrows to the user, so every range query
-- would read all of their messages; this lets it seek to the range instead.
CREATE INDEX idx_messages_user_created ON messages(user_id, created_at);
