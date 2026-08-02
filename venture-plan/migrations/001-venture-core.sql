-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Ventures, the APPEND-ONLY assumption ledger (a vendor quote supersedes a guess, it never overwrites it — the evidence that the plan once rested on an estimate is the product), scenarios, and the out-of-band run log. Owner-or-operator RLS on every table. src-routes/venture-schema.ts applies the SAME statements at route-factory time, so this file is the migration path, not the only path.
--
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS venture_ventures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  idea_text TEXT NOT NULL,
  spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  target_launch_date DATE,
  stage VARCHAR(24) NOT NULL DEFAULT 'scoped',
  horizon_months INTEGER NOT NULL DEFAULT 36,
  open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_ventures_owner_idx ON venture_ventures(owner_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS venture_assumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  key VARCHAR(160) NOT NULL,
  domain VARCHAR(24) NOT NULL,
  label TEXT NOT NULL,
  unit VARCHAR(24) NOT NULL,
  value_num NUMERIC(24,6),
  value_text TEXT,
  low_num NUMERIC(24,6),
  high_num NUMERIC(24,6),
  source_kind VARCHAR(24) NOT NULL,
  source_detail TEXT,
  source_url TEXT,
  confidence VARCHAR(12) NOT NULL,
  authored_by VARCHAR(120) NOT NULL,
  run_id UUID,
  superseded_by UUID REFERENCES venture_assumptions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE UNIQUE INDEX IF NOT EXISTS venture_assumptions_live_idx
  ON venture_assumptions(venture_id, key) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS venture_assumptions_hist_idx
  ON venture_assumptions(venture_id, key, created_at DESC);

CREATE TABLE IF NOT EXISTS venture_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  volume_units INTEGER,
  retail_price_cents INTEGER,
  channel_mix JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_base BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_scenarios_venture_idx ON venture_scenarios(venture_id, created_at);

CREATE TABLE IF NOT EXISTS venture_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  phase VARCHAR(24),
  phases JSONB NOT NULL DEFAULT '[]'::jsonb,
  bots_requested INTEGER NOT NULL DEFAULT 0,
  bots_completed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS venture_runs_venture_idx ON venture_runs(venture_id, started_at DESC);

ALTER TABLE venture_ventures ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_ventures FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'venture_ventures_owner_or_operator' AND polrelid = 'venture_ventures'::regclass) THEN
    CREATE POLICY venture_ventures_owner_or_operator ON venture_ventures
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;

ALTER TABLE venture_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_assumptions FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'venture_assumptions_owner_or_operator' AND polrelid = 'venture_assumptions'::regclass) THEN
    CREATE POLICY venture_assumptions_owner_or_operator ON venture_assumptions
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;

ALTER TABLE venture_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_scenarios FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'venture_scenarios_owner_or_operator' AND polrelid = 'venture_scenarios'::regclass) THEN
    CREATE POLICY venture_scenarios_owner_or_operator ON venture_scenarios
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;

ALTER TABLE venture_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_runs FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'venture_runs_owner_or_operator' AND polrelid = 'venture_runs'::regclass) THEN
    CREATE POLICY venture_runs_owner_or_operator ON venture_runs
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;
