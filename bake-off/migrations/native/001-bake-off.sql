-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Native final shape of 001-bake-off.sql, which the native kernel skips: the three tables and their indexes. The owner-or-operator RLS DO loop stays PostgreSQL-only; the native per-person scope and its owner-field check already keep a person's jobs, runs and results their own. On PostgreSQL every statement here is a no-op after 001.

-- 001-bake-off.sql
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
