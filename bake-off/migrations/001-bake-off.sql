-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial schema for the bake-off package: jobs (the prompt + rubric + economics), runs (one race), and results (one lane's observed cost/model/score). Owner-or-operator RLS on all three — a bake-off holds the caller's prompts, the model outputs, and their spend. bake-off-store.ts applies the same statements at factory time, so this file is the migration-path copy, not the only path.
--
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS bake_off_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub VARCHAR(255) NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  rubric JSONB NOT NULL DEFAULT '[]'::jsonb,
  reference TEXT,
  quality_bar NUMERIC(5,2) NOT NULL DEFAULT 70,
  monthly_volume INTEGER NOT NULL DEFAULT 100,
  lane_agent_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE INDEX IF NOT EXISTS bake_off_jobs_owner_idx ON bake_off_jobs(owner_sub, created_at DESC);

CREATE TABLE IF NOT EXISTS bake_off_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES bake_off_jobs(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  lanes_requested INTEGER NOT NULL DEFAULT 0,
  lanes_completed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ);

CREATE INDEX IF NOT EXISTS bake_off_runs_job_idx ON bake_off_runs(job_id, started_at DESC);

-- observed_model / cost_usd are OBSERVED, never declared: the model is whatever the harness
-- resolved at call time and the cost is what the bot reported. A NULL or 0 cost means capture
-- failed for that lane, which the scoring module treats as unknown — never as free.
CREATE TABLE IF NOT EXISTS bake_off_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES bake_off_runs(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  lane_bot TEXT NOT NULL,
  lane_agent_id VARCHAR(64) NOT NULL,
  lane_harness TEXT NOT NULL,
  lane_provider TEXT NOT NULL,
  observed_model TEXT,
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  output TEXT,
  cost_usd NUMERIC(12,6),
  total_tokens INTEGER,
  duration_ms INTEGER,
  judge_score NUMERIC(5,2),
  judge_mode VARCHAR(32),
  judge_rationale TEXT,
  dimensions JSONB,
  task_id VARCHAR(64),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE INDEX IF NOT EXISTS bake_off_results_run_idx ON bake_off_results(run_id, created_at);

-- Owner-or-operator RLS. Mirrors buildOwnerRlsPolicyStatements() so the migration path and the
-- runtime bootstrap path converge on the same policy rather than two nearly-identical ones.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['bake_off_jobs', 'bake_off_runs', 'bake_off_results']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy WHERE polname = t || '_owner_or_operator' AND polrelid = t::regclass
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS PERMISSIVE FOR ALL
           USING (owner_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')
           WITH CHECK (owner_sub = current_setting(''oshal.current_sub'', true)
                  OR current_setting(''oshal.is_operator'', true) = ''on'')',
        t || '_owner_or_operator', t);
    END IF;
  END LOOP;
END $$;
