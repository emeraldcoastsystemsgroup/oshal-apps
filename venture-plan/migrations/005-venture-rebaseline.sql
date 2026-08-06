-- Venture Plan: opt-in scheduled rebaseline policy and measured-cost evidence.
--
-- Policies default to disabled plus dry-run. Scheduled rows carry their UTC
-- idempotency slot and integer micro-USD authorization/settlement evidence.
-- The worker call which first reports an over-cap charge is atomic and cannot be
-- recalled; the stored gate prevents every later paid call in that run.

CREATE TABLE IF NOT EXISTS venture_rebaseline_policies (
  venture_id UUID PRIMARY KEY REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  cadence VARCHAR(12) NOT NULL DEFAULT 'weekly',
  weekly_day SMALLINT NOT NULL DEFAULT 1,
  max_cost_micros BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT venture_rebaseline_policy_cadence_ck
    CHECK (cadence IN ('nightly', 'weekly')),
  CONSTRAINT venture_rebaseline_policy_weekday_ck
    CHECK (weekly_day BETWEEN 0 AND 6),
  CONSTRAINT venture_rebaseline_policy_cap_ck
    CHECK (max_cost_micros BETWEEN 0 AND 9007199254740000),
  CONSTRAINT venture_rebaseline_policy_paid_ck
    CHECK (NOT enabled OR dry_run OR max_cost_micros > 0));
CREATE INDEX IF NOT EXISTS venture_rebaseline_policy_due_idx
  ON venture_rebaseline_policies(enabled, cadence, weekly_day)
  WHERE enabled;

CREATE OR REPLACE FUNCTION venture_validate_rebaseline_policy_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM venture_ventures
     WHERE id = NEW.venture_id AND owner_sub = NEW.owner_sub
  ) THEN
    RAISE EXCEPTION 'rebaseline policy venture is missing or owned by another account'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS venture_rebaseline_policy_validate_owner
  ON venture_rebaseline_policies;
CREATE TRIGGER venture_rebaseline_policy_validate_owner
  BEFORE INSERT OR UPDATE OF venture_id, owner_sub
  ON venture_rebaseline_policies
  FOR EACH ROW EXECUTE FUNCTION venture_validate_rebaseline_policy_owner();

ALTER TABLE venture_runs
  ADD COLUMN IF NOT EXISTS trigger_kind VARCHAR(16) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS schedule_slot VARCHAR(32),
  ADD COLUMN IF NOT EXISTS cost_cap_micros BIGINT,
  ADD COLUMN IF NOT EXISTS cost_spent_micros BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_status VARCHAR(24) NOT NULL DEFAULT 'not-capped';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'venture_runs_trigger_kind_ck'
       AND conrelid = 'venture_runs'::regclass
  ) THEN
    ALTER TABLE venture_runs ADD CONSTRAINT venture_runs_trigger_kind_ck
      CHECK (trigger_kind IN ('manual', 'scheduled')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'venture_runs_cost_status_ck'
       AND conrelid = 'venture_runs'::regclass
  ) THEN
    ALTER TABLE venture_runs ADD CONSTRAINT venture_runs_cost_status_ck
      CHECK (cost_status IN (
        'not-capped', 'within-cap', 'exhausted', 'overshot', 'capture-failed'
      )) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'venture_runs_schedule_shape_ck'
       AND conrelid = 'venture_runs'::regclass
  ) THEN
    ALTER TABLE venture_runs ADD CONSTRAINT venture_runs_schedule_shape_ck CHECK (
      (trigger_kind = 'manual'
        AND schedule_slot IS NULL
        AND cost_cap_micros IS NULL
        AND cost_spent_micros = 0
        AND cost_status = 'not-capped')
      OR
      (trigger_kind = 'scheduled'
        AND kind = 'rebaseline'
        AND schedule_slot ~ '^(nightly|weekly):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND cost_cap_micros BETWEEN 1 AND 9007199254740000
        AND cost_spent_micros BETWEEN 0 AND 9007199254740000
        AND cost_status <> 'not-capped')
    ) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS venture_runs_schedule_slot_uq
  ON venture_runs(venture_id, schedule_slot)
  WHERE schedule_slot IS NOT NULL;

CREATE OR REPLACE FUNCTION venture_validate_run_cost_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.trigger_kind <> OLD.trigger_kind
      OR NEW.schedule_slot IS DISTINCT FROM OLD.schedule_slot
      OR NEW.cost_cap_micros IS DISTINCT FROM OLD.cost_cap_micros THEN
    RAISE EXCEPTION 'run trigger, schedule slot, and cost authorization are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.cost_spent_micros < OLD.cost_spent_micros THEN
    RAISE EXCEPTION 'run measured cost cannot decrease' USING ERRCODE = '55000';
  END IF;
  IF OLD.cost_status = 'capture-failed' AND NEW.cost_status <> OLD.cost_status THEN
    RAISE EXCEPTION 'run capture failure is terminal' USING ERRCODE = '55000';
  END IF;
  IF OLD.cost_status IN ('exhausted', 'overshot')
      AND NEW.cost_status NOT IN (OLD.cost_status, 'capture-failed') THEN
    RAISE EXCEPTION 'run terminal cost status cannot regress' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS venture_runs_validate_cost_transition ON venture_runs;
CREATE TRIGGER venture_runs_validate_cost_transition
  BEFORE UPDATE OF trigger_kind, schedule_slot, cost_cap_micros,
    cost_spent_micros, cost_status
  ON venture_runs
  FOR EACH ROW EXECUTE FUNCTION venture_validate_run_cost_transition();

CREATE OR REPLACE FUNCTION venture_validate_run_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM venture_ventures
     WHERE id = NEW.venture_id AND owner_sub = NEW.owner_sub
  ) THEN
    RAISE EXCEPTION 'run venture is missing or owned by another account'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS venture_runs_validate_owner ON venture_runs;
CREATE TRIGGER venture_runs_validate_owner
  BEFORE INSERT OR UPDATE OF venture_id, owner_sub
  ON venture_runs
  FOR EACH ROW EXECUTE FUNCTION venture_validate_run_owner();

ALTER TABLE venture_rebaseline_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_rebaseline_policies FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polname = 'venture_rebaseline_policies_owner_or_operator'
       AND polrelid = 'venture_rebaseline_policies'::regclass
  ) THEN
    CREATE POLICY venture_rebaseline_policies_owner_or_operator
      ON venture_rebaseline_policies AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true)
        OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;
