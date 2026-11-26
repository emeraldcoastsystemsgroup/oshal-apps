-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.14: add owner-scoped oshal_presentation_recaps table with ENABLE + FORCE row-level security and two-arm owner policy for Meeting Recap.

CREATE TABLE IF NOT EXISTS oshal_presentation_recaps (
  id TEXT PRIMARY KEY,
  owner_sub TEXT NOT NULL,
  title TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  source_sha256 TEXT,
  source_bytes BIGINT NOT NULL DEFAULT 0,
  duration_seconds DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN (
    'queued',
    'extracting',
    'transcribing',
    'detecting_scenes',
    'assembling_timeline',
    'summarizing',
    'rendering_deck',
    'completed',
    'failed'
  )),
  stage_message TEXT NOT NULL DEFAULT '',
  minutes_processed DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_minutes DOUBLE PRECISION NOT NULL DEFAULT 0,
  keyframes_count INTEGER NOT NULL DEFAULT 0,
  crop_mode TEXT NOT NULL DEFAULT 'right-strip',
  sample_interval_sec INTEGER NOT NULL DEFAULT 15,
  theme TEXT NOT NULL DEFAULT 'executive',
  saved_deck_path TEXT,
  saved_deck_open_url TEXT,
  error_code TEXT,
  error_message TEXT,
  meta_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presentation_recaps_owner
  ON oshal_presentation_recaps (owner_sub, created_at DESC);

ALTER TABLE oshal_presentation_recaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_presentation_recaps FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oshal_presentation_recaps_owner_or_operator ON oshal_presentation_recaps;
CREATE POLICY oshal_presentation_recaps_owner_or_operator ON oshal_presentation_recaps
  FOR ALL
  USING (
    owner_sub = current_setting('oshal.current_sub', true)
    OR owner_sub = current_setting('app.current_user_sub', true)
    OR current_setting('oshal.is_operator', true) = 'true'
  )
  WITH CHECK (
    owner_sub = current_setting('oshal.current_sub', true)
    OR owner_sub = current_setting('app.current_user_sub', true)
    OR current_setting('oshal.is_operator', true) = 'true'
  );
