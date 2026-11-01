-- Phase 12: an email that fails to send is retried on later cron runs, a few
-- times, instead of being lost (and stalling the user's whole drip) at once.
ALTER TABLE email_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
