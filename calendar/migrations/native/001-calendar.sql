-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Native final shape of 001-calendar-preparation.sql and 002-meeting-briefs.sql, which the native kernel skips: the snapshot and meeting-brief tables and their indexes. Their RLS ENABLE/FORCE and pg_policies-guarded CREATE POLICY blocks stay PostgreSQL-only; the native per-person scope keeps each person's snapshot and briefs their own. On PostgreSQL every statement here is a no-op after 001-002.

-- 001-calendar-preparation.sql
CREATE TABLE IF NOT EXISTS calendar_preparation_snapshots (
 user_sub text PRIMARY KEY,
 events jsonb NOT NULL DEFAULT '[]',
 synced_at timestamptz NOT NULL
);

-- 002-meeting-briefs.sql
CREATE TABLE IF NOT EXISTS calendar_meeting_briefs (
 user_sub text NOT NULL,
 event_id text NOT NULL,
 series_key text NOT NULL,
 title text NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz,
 brief jsonb NOT NULL DEFAULT '{}'::jsonb,
 built_at timestamptz NOT NULL,
 PRIMARY KEY (user_sub, event_id)
);

CREATE INDEX IF NOT EXISTS calendar_meeting_briefs_owner_start
 ON calendar_meeting_briefs (user_sub, starts_at DESC);

CREATE INDEX IF NOT EXISTS calendar_meeting_briefs_owner_series
 ON calendar_meeting_briefs (user_sub, series_key, starts_at DESC);
