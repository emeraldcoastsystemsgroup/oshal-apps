-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com   | Hand-typed leagues (ff_manual_leagues) and the week ledger (ff_weeks), both user_sub-keyed under the same FORCED exact-owner row security as migration 001, with no operator arm, and the same catalog read-back.
--
-- A SEPARATE FILE from 001: migrations are tracked per (app, file), so 001 has already run on any
-- box carrying 0.1.0 and editing it would never re-apply there.
--
-- ff_manual_leagues — A LEAGUE TYPED IN BY HAND IS A FIRST-CLASS INPUT, NOT A FALLBACK. The
-- operator's ESPN team "is having some issues", and every weekly recommendation must be reachable
-- without the connector. One row is one person's hand-typed league: the scoring map (ESPN stat id to
-- points — the same keys the projections carry, never a stat dictionary), the starting slots, every
-- team's roster by ESPN player id (the trade finder is worthless without the other rosters), the
-- schedule, the pro-team bye weeks, the FAAB budget and the season's shape. It is one JSONB document
-- because it is edited and validated as one; the routes validate it before it is written.
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

-- ff_weeks — THE WEEK LEDGER. The start/sit ledger (ff_calls) grades each swap; this grades the
-- WEEK: the lineup advised, the highest-projected lineup, the win probability each claimed and the
-- swaps that justified the difference — recorded when the lineup is served, before kickoff — and,
-- once the week is complete, what the advised lineup actually scored against the lineup actually
-- started. That makes "a week where the recommendation differed from the mean-maximal lineup, and
-- what it bought" readable from the ledger rather than from a screenshot.
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

ALTER TABLE ff_manual_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE ff_manual_leagues FORCE ROW LEVEL SECURITY;
ALTER TABLE ff_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ff_weeks FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['ff_manual_leagues', 'ff_weeks'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = target || '_owner' AND polrelid = target::regclass) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS PERMISSIVE FOR ALL '
        || 'USING (user_sub = nullif(current_setting(''oshal.current_sub'', true), '''')) '
        || 'WITH CHECK (user_sub = nullif(current_setting(''oshal.current_sub'', true), ''''))',
        target || '_owner', target);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  broken TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO broken
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = current_schema()
     AND c.relkind = 'r'
     AND c.relname IN ('ff_manual_leagues', 'ff_weeks')
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = c.relname || '_owner'));
  IF broken IS NOT NULL THEN
    RAISE EXCEPTION 'fantasy-football: row security is not forced with an owner policy on: %', broken;
  END IF;
END $$;
