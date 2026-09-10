-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the caller's linked ESPN Fantasy league, the cached public projection feed, and the start/sit ledger that grades every call against what the benched player actually scored.
--
-- A SEPARATE FILE from 001 on purpose: migrations are tracked per (app, file), so 001 has already
-- run on any box carrying 0.1.0 and editing it would never re-apply. sports-fantasy-store.ts also
-- creates these on first use, because APP_PACKAGE_MIGRATIONS is a flag and the app must work where
-- it is off.

-- The league a person has linked. One row per (user, season, league) so a manager in two leagues
-- sees both, and re-linking is idempotent.
--
-- NOTE WHAT IS *NOT* HERE: the espn_s2/SWID cookies. Those live in the encrypted connector store
-- like every other credential and are resolved per request through the broker. A league id is not
-- a secret — it appears in the league's own URL — so it is stored in the clear on purpose, and the
-- credential is not.
CREATE TABLE IF NOT EXISTS sports_fantasy_leagues (
  id           BIGSERIAL PRIMARY KEY,
  user_sub     TEXT NOT NULL,
  season       INTEGER NOT NULL,
  league_id    TEXT NOT NULL,
  league_name  TEXT,
  team_id      INTEGER,
  team_name    TEXT,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sports_fantasy_leagues_unique UNIQUE (user_sub, season, league_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_fantasy_leagues_user ON sports_fantasy_leagues (user_sub);

-- The public projection feed, distilled and cached. ESPN's player endpoint returns ~39MB and
-- IGNORES the x-fantasy-filter limit (measured 2026-09-08, every shape tried), so this is fetched
-- on a slow cadence and never on a request path. The payload here is the DISTILLED form — six
-- fields per player — not the raw feed; caching 39MB per week to read six fields is how a cache
-- becomes the problem it was meant to solve.
--
-- It is per (season, week) and shared by every user: these projections are the same for everybody,
-- and only the SCORING that turns them into points is league-specific.
CREATE TABLE IF NOT EXISTS sports_fantasy_projections (
  season         INTEGER NOT NULL,
  scoring_period INTEGER NOT NULL,
  payload        JSONB NOT NULL,
  players        INTEGER NOT NULL DEFAULT 0,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  build_ms       INTEGER,
  PRIMARY KEY (season, scoring_period)
);

-- THE START/SIT LEDGER. Every recommendation is written here BEFORE kickoff and graded afterwards
-- against what the two players ACTUALLY scored under that league's rules.
--
-- `projected_gain` is what we claimed; `actual_gain` is what the swap was really worth. The
-- difference between those two columns is the only honest measure of whether this is advice or
-- noise, and it is why the ledger stores both rather than a win/loss flag. A recommendation that
-- was right for the wrong reason still shows up as a small actual gain.
CREATE TABLE IF NOT EXISTS sports_fantasy_calls (
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
  -- One call per swap per week. Re-running the advisor must UPDATE, never append a second opinion
  -- on the same decision — a ledger that double-counts one recommendation cannot be graded.
  CONSTRAINT sports_fantasy_calls_unique UNIQUE (user_sub, season, league_id, week, start_player_id, sit_player_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_fantasy_calls_open ON sports_fantasy_calls (settled, season, week);
CREATE INDEX IF NOT EXISTS idx_sports_fantasy_calls_user ON sports_fantasy_calls (user_sub, created_at DESC);
