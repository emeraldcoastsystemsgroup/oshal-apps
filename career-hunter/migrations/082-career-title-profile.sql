-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-07-15 17:28:14 | roger.murphy@emeraldcoastsystemsgroup.com   | Per-user career scoring settings: title_terms[] drives the daily BOUNDED title-based AI-score pass (productizes the one-off score_batch(title_any=[...]) run for a second user — the keyword prefilter is operator-calibrated, so new users need a title lane of their own). Also carries the two persistent once-per-~day cursors (last_title_pass_at, last_cron_score_at) that stop an api recreate from re-running hours of scoring — same last_digest_at pattern as 077.

CREATE TABLE IF NOT EXISTS career_score_settings (
  user_sub               VARCHAR(255) PRIMARY KEY,
  title_terms            TEXT[] NOT NULL DEFAULT '{}',            -- LIKE terms matched against posting titles (engine lowercases both sides)
  title_terms_source     VARCHAR(16) NOT NULL DEFAULT 'unset',    -- 'derived' (seeded from the user's parsed resume roles) | 'user' (edited in Career Settings)
  last_title_pass_at     TIMESTAMPTZ,                             -- persistent once/~day guard for the title pass (>20h, survives api recreates)
  last_cron_score_at     TIMESTAMPTZ,                             -- persistent guard for the cron/boot-catch-up keyword score (>20h, survives api recreates)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
