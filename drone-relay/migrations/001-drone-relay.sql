-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Initial schema. A PLAN is one relay-chain design: the validated SPEC (transport, corridor, margins, spacing, fleet, speeds, endurance, timers, gap policy), the PLAN the engine sized from it (ranges, hop, relays, spares, slots, feasibility with reasons), and the LAST SIMULATED RUN (scenario, timeline, metrics, sampled frames) — cleared whenever the spec changes so a stored result can never describe a different chain. The table carries the store's owner RLS.

CREATE TABLE IF NOT EXISTS drone_relay_plan (
  plan_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub    TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  spec         JSONB       NOT NULL,                                 -- validated ChainSpec
  plan         JSONB       NOT NULL,                                 -- ChainPlan sized from the spec
  last_sim     JSONB,                                                -- last SimResult, or NULL
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drone_relay_plan_owner ON drone_relay_plan (owner_sub, updated_at DESC);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['drone_relay_plan'] LOOP
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
