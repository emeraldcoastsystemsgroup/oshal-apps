-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Declare the "My decks" record table in its final shape (the lazy bootstrap's CREATE plus its outline, theme and format columns) so the native kernel provisions it. Live 2026-10-11 every saved deck's record was refused "SQL table oshal_presentations is not provisioned (package migration pending)", so My files listed decks with no date ('Dec 31'), no slide count, and Delete answered rows: 0. The native per-person scope keeps each person's rows on user_sub; on PostgreSQL the routes' bootstrap still adds the owner policy, and every statement here is a no-op on a database that already has the table.

CREATE TABLE IF NOT EXISTS oshal_presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  provider TEXT,
  download_url TEXT,
  url TEXT,
  slides INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outline JSONB,
  theme TEXT,
  format TEXT NOT NULL DEFAULT 'pptx'
);

CREATE INDEX IF NOT EXISTS idx_presentations_user ON oshal_presentations (user_sub, created_at);
