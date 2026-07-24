-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                                     | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-16   | roger.murphy@emeraldcoastsystemsgroup.com  | Portrait Studio schema: one row per generated portrait (professional headshot or character portrait), user_sub-keyed. Paths point into the per-user workspace store; routes filter by user_sub on every read/write.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ps_portraits (
  portrait_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub      TEXT NOT NULL,
  mode          VARCHAR(20) NOT NULL DEFAULT 'professional',  -- professional | character
  style         TEXT NOT NULL,                                -- style/theme id from the catalog
  options       JSONB NOT NULL DEFAULT '{}'::jsonb,           -- attire, framing, free-text notes
  prompt        TEXT,                                         -- final prompt sent to the image model
  status        VARCHAR(16) NOT NULL DEFAULT 'queued',        -- queued | generating | done | failed
  source_path   TEXT,                                         -- cropped input image (what the model saw)
  original_path TEXT,                                         -- full original upload (kept for re-crops)
  output_path   TEXT,                                         -- generated portrait
  model         TEXT,                                         -- image model actually used
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ps_portraits_user ON ps_portraits (user_sub, created_at DESC);
