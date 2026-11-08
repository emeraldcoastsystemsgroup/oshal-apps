-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | RP-KL-01: per-child watch history and parent brief profiles (up to 8 per signed-in parent), keyed by (user_sub, child_id).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS oshal_youtube_children (
  user_sub TEXT NOT NULL,
  child_id TEXT NOT NULL,
  name TEXT NOT NULL,
  aggregate JSONB,
  raw_blob TEXT,
  total_watched INT,
  brief TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_at TIMESTAMPTZ,
  brief_at TIMESTAMPTZ,
  PRIMARY KEY (user_sub, child_id)
);

CREATE INDEX IF NOT EXISTS idx_oshal_youtube_children_owner
  ON oshal_youtube_children (user_sub, created_at ASC);
