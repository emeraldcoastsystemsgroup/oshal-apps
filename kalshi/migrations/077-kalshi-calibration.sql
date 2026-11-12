-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | The calibration rebuild (lib/kalshi-calibration-store.js): the walk of Kalshi's settled-market tape in short turns, the samples it finds, and the tables it builds. The table the package ships (data/kalshi-calibration.json) was built on 2026-07-13 by a command-line study nothing runs any more; these tables let the package rebuild it itself.

-- One row per rebuild. `cursor` is where the next turn carries on (lib/kalshi-calibration-walk.js freshCursor); a walk
-- with no `finished_at` is the one in progress.
CREATE TABLE IF NOT EXISTS kalshi_calibration_walks (
  id          TEXT PRIMARY KEY,
  cursor      JSONB NOT NULL,
  markets     INTEGER NOT NULL DEFAULT 0,
  requests    INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  samples     INTEGER NOT NULL DEFAULT 0,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- What a walk found: a settled market's YES price at one horizon and how it settled. `seq` keeps the order they were
-- found, which the table's averages are summed in; the key is "<walk>:<seq>". Only the newest walk's samples are kept.
-- A whole rebuild can hold about 14,000 rows and the native kernel answers at most 10,000 at once, so the build reads
-- one horizon at a time (WHERE walk_id AND horizon_hours) and puts them in order itself.
CREATE TABLE IF NOT EXISTS kalshi_calibration_samples (
  id            TEXT PRIMARY KEY,
  seq           INTEGER NOT NULL,
  walk_id       TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  category      TEXT NOT NULL,
  horizon_hours INTEGER NOT NULL,
  price         DOUBLE PRECISION NOT NULL,
  settled_yes   BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kalshi_calibration_samples_walk ON kalshi_calibration_samples (walk_id, horizon_hours);

-- A finished walk's table, in the shape the scan reads (generatedAt, sampleCounts, horizons).
CREATE TABLE IF NOT EXISTS kalshi_calibration_tables (
  walk_id      TEXT PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  markets      INTEGER NOT NULL,
  samples      INTEGER NOT NULL,
  table_json   JSONB NOT NULL
);
