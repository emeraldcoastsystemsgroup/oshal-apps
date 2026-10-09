-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the four tables the management engine moved from sports-edge needs (linked leagues, the projection cache, each player's completed weeks, the start/sit ledger), every one user_sub-keyed under FORCED exact-owner row-level security with no operator arm (ADR-146 Q2, operator decision 2026-09-27). Ends by reading pg_class and pg_policy back and raising when any table is not forced or has no owner policy, so a partial application cannot report success.
--
-- OWNERSHIP IS PER PERSON, AND IT IS THE DATABASE THAT SAYS SO. The operator's words: "the table
-- and connection should be user based.. only i can control my team.. no one else can see my team
-- and connection." So every row here names its owner, and a row is visible or writable only when
-- the framework's per-request identity (oshal.current_sub, stamped by the GUC pool from the signed-in
-- subject) is that owner. There is deliberately no `oshal.is_operator` arm: an operator's session
-- sees nothing in these tables that is not their own.
--
-- FORCE, NOT ONLY ENABLE. The api both owns these tables and is the role that reads them, and
-- PostgreSQL exempts a table's owner from its own row security unless the table is FORCEd. ENABLE
-- alone would install a policy that reads as protection in every audit and never runs.
--
-- WHAT IS *NOT* HERE: the ESPN cookies (SWID + espn_s2). They live in the encrypted connector store
-- and are resolved per request through the broker, never written to a row. A league id is not a
-- secret — it is in the league's own URL — so it is stored in the clear.
--
-- sports-edge's sports_fantasy_* tables are NOT read or migrated from here: a package reading
-- another package's tables is a coupling the platform does not sanction, and those rows were
-- keyed for a shared cache this package no longer has.

-- The leagues a person has linked. One row per (user, season, league); re-linking is idempotent.
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

-- The public projection feed, distilled (a handful of fields per player, never the ~39MB raw feed)
-- and cached per person per (season, week). Public data, but a shared cache would be a table one
-- person's refresh writes and another's lineup reads, and nothing in this package is shared.
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

-- Each player's completed weeks as RAW STAT LINES, never points: a week's points do not exist until
-- a league's scoring rules are applied, and one person can be in two leagues that price the same
-- line differently. This is the sample the spread model shrinks toward.
CREATE TABLE IF NOT EXISTS ff_player_weeks (
  user_sub   TEXT NOT NULL,
  season     INTEGER NOT NULL,
  week       INTEGER NOT NULL,
  player_id  INTEGER NOT NULL,
  stats      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_sub, season, week, player_id)
);

-- THE START/SIT LEDGER. Every recommendation is written here BEFORE kickoff and graded afterwards
-- against what the two players actually scored under that league's rules. projected_gain is the
-- claim; actual_gain is what the swap was really worth.
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
  -- One call per swap per week: re-running the advisor updates, never appends a second opinion.
  CONSTRAINT ff_calls_unique UNIQUE (user_sub, season, league_id, week, start_player_id, sit_player_id)
);

CREATE INDEX IF NOT EXISTS idx_ff_calls_open ON ff_calls (user_sub, settled, season, week);
CREATE INDEX IF NOT EXISTS idx_ff_calls_user ON ff_calls (user_sub, created_at DESC);

ALTER TABLE ff_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE ff_leagues FORCE ROW LEVEL SECURITY;
ALTER TABLE ff_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ff_projections FORCE ROW LEVEL SECURITY;
ALTER TABLE ff_player_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ff_player_weeks FORCE ROW LEVEL SECURITY;
ALTER TABLE ff_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE ff_calls FORCE ROW LEVEL SECURITY;

-- Exact owner, both directions: USING hides another person's rows, WITH CHECK refuses writing a row
-- in another person's name. Created only when absent, so a re-run never leaves security on with no
-- policy for an instant.
DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['ff_leagues', 'ff_projections', 'ff_player_weeks', 'ff_calls'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = target || '_owner' AND polrelid = target::regclass) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS PERMISSIVE FOR ALL '
        || 'USING (user_sub = nullif(current_setting(''oshal.current_sub'', true), '''')) '
        || 'WITH CHECK (user_sub = nullif(current_setting(''oshal.current_sub'', true), ''''))',
        target || '_owner', target);
    END IF;
  END LOOP;
END $$;

-- Read the catalog back rather than trusting the statements above: relforcerowsecurity decides
-- whether the owner policy runs for the role that owns the table, and a table with security on and
-- no policy would deny the app its own rows.
DO $$
DECLARE
  broken TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO broken
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = current_schema()
     AND c.relkind = 'r'
     AND c.relname IN ('ff_leagues', 'ff_projections', 'ff_player_weeks', 'ff_calls')
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = c.relname || '_owner'));
  IF broken IS NOT NULL THEN
    RAISE EXCEPTION 'fantasy-football: row security is not forced with an owner policy on: %', broken;
  END IF;
END $$;
