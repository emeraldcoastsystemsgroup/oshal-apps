-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Initial schema. A TASK is one drafted skill plan: the plan itself (the exact typed steps the executor runs), the REHEARSAL that validated it on a clone of the world at draft time, its status, the step it reached and why it stopped. The COMMAND LOG is every command any actor — the plan or a human holding manual command — issued to any node, with its outcome (accepted / refused / completed / failed) and the refusal reason, so "what did the swarm do to the machine" is a row rather than a memory (ADR-151 D4). The simulated world is in memory and is not stored. Both tables carry the store's owner RLS.

CREATE TABLE IF NOT EXISTS embodied_task (
  task_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub     TEXT        NOT NULL,
  task          TEXT        NOT NULL,                              -- clear-surface
  title         TEXT        NOT NULL,
  plan          JSONB       NOT NULL,                              -- SkillPlan
  rehearsal     JSONB       NOT NULL,                              -- PlanValidation at draft time
  status        TEXT        NOT NULL DEFAULT 'draft',              -- draft | executing | done | failed | aborted
  current_step  INTEGER     NOT NULL DEFAULT -1,
  failure       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT embodied_task_status_valid CHECK (status IN ('draft', 'executing', 'done', 'failed', 'aborted'))
);

CREATE INDEX IF NOT EXISTS idx_embodied_task_owner ON embodied_task (owner_sub, created_at DESC);

CREATE TABLE IF NOT EXISTS embodied_command_log (
  log_id      BIGSERIAL PRIMARY KEY,
  owner_sub   TEXT        NOT NULL,
  task_id     UUID        REFERENCES embodied_task (task_id) ON DELETE SET NULL,
  sim_ms      INTEGER     NOT NULL,                                -- simulated clock when issued
  actor       TEXT        NOT NULL,                                -- plan:<step> | rehearsal:<step> | <user sub>
  node_id     TEXT        NOT NULL,
  command     TEXT        NOT NULL,
  params      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  outcome     TEXT        NOT NULL,                                -- accepted | refused | completed | failed
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT embodied_command_log_outcome_valid CHECK (outcome IN ('accepted', 'refused', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_embodied_command_log_owner ON embodied_command_log (owner_sub, log_id DESC);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['embodied_task', 'embodied_command_log'] LOOP
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
