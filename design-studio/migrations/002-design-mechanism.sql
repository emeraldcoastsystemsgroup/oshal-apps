-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-203 D9 (lane @ds-plant). The MECHANISM of a product's design: the part that is ground, the joints between parts (hinge, slide or fixed; axis, range, where the child sits in the parent's frame), which bought motor row drives each joint through what gear ratio, the payload the brief names and the task read from the brief's requirement line. One row per project, written whole on every save (`revision` counts the saves); the plant embodied's engine builds from it is never stored here, only the references and the stated numbers. Text ids minted by the package, a plain INSERT then whole-row UPDATEs, no ON CONFLICT. Owner RLS as the other three tables.

CREATE TABLE IF NOT EXISTS design_mechanism (
  id              TEXT        PRIMARY KEY,
  project_id      TEXT        NOT NULL REFERENCES design_project (id) ON DELETE CASCADE,
  owner_sub       TEXT        NOT NULL,
  mechanism       JSONB       NOT NULL,                              -- {parts[], base, joints[], motors[], payload, task}
  revision        INTEGER     NOT NULL,                              -- the n-th save
  saved_at        TIMESTAMPTZ NOT NULL,
  CONSTRAINT design_mechanism_revision_valid CHECK (revision >= 1)
);

CREATE INDEX IF NOT EXISTS idx_design_mechanism_owner ON design_mechanism (owner_sub, project_id);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['design_mechanism'] LOOP
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
