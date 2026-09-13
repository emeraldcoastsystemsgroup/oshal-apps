-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Initial schema. A MODEL is one parametric part: its BASE (a box, a cylinder, a sketch, the scan bridge's view outlines, or a reference to an uploaded mesh file), its ORDERED FEATURE LIST (the parametric history the kernel replays), the number of the last built REVISION, the last report and per-feature status, and where it came from (a scan job, or nothing). A REVISION is one successful rebuild: the exact list that built it, the report, the engine build hash — so "undo" is restoring a revision's list and rebuilding, and a drawing on disk can always be traced to the list that produced it. Every table carries the store's owner RLS.

CREATE TABLE IF NOT EXISTS cad_model (
  model_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sub       TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  base            JSONB       NOT NULL,                              -- validated base; a mesh base references base.stl on disk
  features        JSONB       NOT NULL DEFAULT '[]'::jsonb,          -- ordered CadFeature[]
  revision        INTEGER     NOT NULL DEFAULT 0,                    -- last BUILT revision (0 = never built)
  state           TEXT        NOT NULL DEFAULT 'draft',              -- draft | built | failed
  report          JSONB,                                             -- last engine report
  feature_status  JSONB,                                             -- last per-feature status list
  failure_reason  TEXT,
  source          JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- {kind:'scan', jobId, title} provenance, or {}
  settings        JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- densityGcm3, stlToleranceMm
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cad_model_state_valid CHECK (state IN ('draft', 'built', 'failed')),
  CONSTRAINT cad_model_revision_valid CHECK (revision >= 0)
);

CREATE INDEX IF NOT EXISTS idx_cad_model_owner ON cad_model (owner_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS cad_revision (
  model_id        UUID        NOT NULL REFERENCES cad_model (model_id) ON DELETE CASCADE,
  revision        INTEGER     NOT NULL,
  owner_sub       TEXT        NOT NULL,
  features        JSONB       NOT NULL,                              -- the list that built this revision
  report          JSONB       NOT NULL,
  feature_status  JSONB       NOT NULL,
  engine_build    TEXT,                                              -- bridge build hash that answered
  ms              INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_cad_revision_owner ON cad_revision (owner_sub, model_id, revision DESC);

-- ── Owner RLS (the store-package convention) ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cad_model', 'cad_revision'] LOOP
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
