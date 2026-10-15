-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Events a person adds in OSHAL (routes/own-events.js): title, start, optional end, all-day flag, location and notes, keyed by the caller. Every route query is pinned to user_sub, and the native per-person scope keeps each person's rows their own. Plain statements only, so the native kernel and PostgreSQL apply the same file.

CREATE TABLE IF NOT EXISTS calendar_own_events (
 user_sub text NOT NULL,
 id text NOT NULL,
 title text NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz,
 all_day boolean NOT NULL DEFAULT false,
 location text,
 notes text,
 created_at timestamptz NOT NULL,
 PRIMARY KEY (user_sub, id)
);

CREATE INDEX IF NOT EXISTS calendar_own_events_owner_start
 ON calendar_own_events (user_sub, starts_at);
