-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Initial schema. A DESIGN is one circuit: its PARTS (typed, placed, with properties), its WIRES (electrical, shaft or teeth links between pins), the transient SETTINGS, the number of the last RUN, the last report and failure. A RUN is one successful solve: the exact circuit that was solved, the report (readings, mechanism, warnings), the engine build hash — so a waveform on disk can always be traced to the circuit that produced it. Every table carries the store's owner RLS.

CREATE TABLE IF NOT EXISTS circuit_design (
  design_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub       TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  parts           JSONB       NOT NULL DEFAULT '[]'::jsonb,          -- validated CircuitPart[]
  wires           JSONB       NOT NULL DEFAULT '[]'::jsonb,          -- validated CircuitWire[]
  sim             JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- stopSeconds, stepSeconds, startFromRest
  run_count       INTEGER     NOT NULL DEFAULT 0,                    -- last successful run (0 = never solved)
  state           TEXT        NOT NULL DEFAULT 'draft',              -- draft | ran | failed
  report          JSONB,                                             -- last run's report (readings, mechanism, warnings)
  failure_reason  TEXT,
  source          JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- {kind:'example', example} provenance, or {}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT circuit_design_state_valid CHECK (state IN ('draft', 'ran', 'failed')),
  CONSTRAINT circuit_design_run_count_valid CHECK (run_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_circuit_design_owner ON circuit_design (owner_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS circuit_run (
  design_id       UUID        NOT NULL REFERENCES circuit_design (design_id) ON DELETE CASCADE,
  run             INTEGER     NOT NULL,
  owner_sub       TEXT        NOT NULL,
  parts           JSONB       NOT NULL,                              -- the circuit that was solved
  wires           JSONB       NOT NULL,
  sim             JSONB       NOT NULL,
  report          JSONB       NOT NULL,
  engine_build    TEXT,                                              -- bridge build hash that answered
  ms              INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (design_id, run)
);

CREATE INDEX IF NOT EXISTS idx_circuit_run_owner ON circuit_run (owner_sub, design_id, run DESC);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['circuit_design', 'circuit_run'] LOOP
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
