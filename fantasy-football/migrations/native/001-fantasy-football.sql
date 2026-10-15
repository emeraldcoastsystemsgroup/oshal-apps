-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Native final shape of 001-fantasy-football.sql and 002-fantasy-manual-and-weeks.sql, which the native kernel skips: the league, projection, player-week, call, manual-league and week tables and their indexes. Their RLS ENABLE/FORCE, the pg_policy-guarded owner-policy loops and the pg_class read-back checks stay PostgreSQL-only; the native per-person scope keeps each person's rows their own. On PostgreSQL every statement here is a no-op after 001-002.

-- 001-fantasy-football.sql
CREATE TABLE IF NOT EXISTS ff_leagues (
  id           BIGSERIAL PRIMARY KEY,
  user_sub     TEXT NOT NULL,
  season       INTEGER NOT NULL,
  league_id    TEXT NOT NULL,
  league_name  TEXT,
  team_id      INTEGER,
  team_name    TEXT,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ff_leagues_unique UNIQUE (user_sub, season, league_id)
);

CREATE TABLE IF NOT EXISTS ff_projections (
  user_sub       TEXT NOT NULL,
  season         INTEGER NOT NULL,
  scoring_period INTEGER NOT NULL,
  payload        JSONB NOT NULL,
  players        INTEGER NOT NULL DEFAULT 0,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  build_ms       INTEGER,
  PRIMARY KEY (user_sub, season, scoring_period)
);

CREATE TABLE IF NOT EXISTS ff_player_weeks (
  user_sub   TEXT NOT NULL,
  season     INTEGER NOT NULL,
  week       INTEGER NOT NULL,
  player_id  INTEGER NOT NULL,
  stats      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_sub, season, week, player_id)
);

CREATE TABLE IF NOT EXISTS ff_calls (
  id                BIGSERIAL PRIMARY KEY,
  user_sub          TEXT NOT NULL,
  season            INTEGER NOT NULL,
  league_id         TEXT NOT NULL,
  week              INTEGER NOT NULL,
  start_player_id   INTEGER NOT NULL,
  start_player_name TEXT,
  sit_player_id     INTEGER NOT NULL,
  sit_player_name   TEXT,
  slot_id           INTEGER,
  projected_start   NUMERIC(7,2),
  projected_sit     NUMERIC(7,2),
  projected_gain    NUMERIC(7,2) NOT NULL,
  reason            TEXT,
  settled           BOOLEAN NOT NULL DEFAULT FALSE,
  actual_start      NUMERIC(7,2),
  actual_sit        NUMERIC(7,2),
  actual_gain       NUMERIC(7,2),
  graded_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ff_calls_unique UNIQUE (user_sub, season, league_id, week, start_player_id, sit_player_id)
);

CREATE INDEX IF NOT EXISTS idx_ff_calls_open ON ff_calls (user_sub, settled, season, week);

CREATE INDEX IF NOT EXISTS idx_ff_calls_user ON ff_calls (user_sub, created_at DESC);

-- 002-fantasy-manual-and-weeks.sql
CREATE TABLE IF NOT EXISTS ff_manual_leagues (
  id          BIGSERIAL PRIMARY KEY,
  user_sub    TEXT NOT NULL,
  name        TEXT NOT NULL,
  season      INTEGER NOT NULL,
  doc         JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ff_manual_leagues_user ON ff_manual_leagues (user_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS ff_weeks (
  user_sub             TEXT NOT NULL,
  season               INTEGER NOT NULL,
  league_key           TEXT NOT NULL,
  week                 INTEGER NOT NULL,
  source               TEXT NOT NULL,
  advised              JSONB NOT NULL,
  mean_lineup          JSONB NOT NULL,
  started              JSONB NOT NULL,
  swaps                JSONB NOT NULL DEFAULT '[]'::jsonb,
  win_probability      NUMERIC(6,4),
  mean_win_probability NUMERIC(6,4),
  projected_advised    NUMERIC(7,2),
  projected_started    NUMERIC(7,2),
  graded               BOOLEAN NOT NULL DEFAULT FALSE,
  actual_advised       NUMERIC(7,2),
  actual_started       NUMERIC(7,2),
  actual_gain          NUMERIC(7,2),
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  graded_at            TIMESTAMPTZ,
  PRIMARY KEY (user_sub, season, league_key, week)
);
