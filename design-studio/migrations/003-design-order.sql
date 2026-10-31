-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-203 D3 as built (0.4.0): an ENGINE ORDER. A package route reaches neither a sibling package nor its engine, and a manifest cannot grant another package's tools to this package's bot, so the design partner files a closed order here and the person's open page runs it against the engine with the person's own session and writes the engine's reply back. One row per order; owner RLS as every table here.

CREATE TABLE IF NOT EXISTS design_order (
  id              TEXT        PRIMARY KEY,
  project_id      TEXT        NOT NULL REFERENCES design_project (id) ON DELETE CASCADE,
  owner_sub       TEXT        NOT NULL,
  action          TEXT        NOT NULL,                              -- read | cad-create | cad-edit | circuit-create | circuit-edit | press
  input           JSONB       NOT NULL,                              -- the validated input of the action
  status          TEXT        NOT NULL,                              -- pending | running | done | failed
  claim           TEXT,                                              -- the page that took it
  result          JSONB,                                             -- the engine's reply as the page read it, bounded
  created_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ,
  CONSTRAINT design_order_status_valid CHECK (status IN ('pending', 'running', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_design_order_owner ON design_order (owner_sub, status);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['design_order'] LOOP
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
