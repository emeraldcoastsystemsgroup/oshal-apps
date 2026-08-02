-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Outputs: IMMUTABLE computed model snapshots (inputs_hash + engine_version, so a stale document is provable) and VERSIONED documents keyed to the model they were rendered from. Owner-or-operator RLS on every table. src-routes/venture-schema.ts applies the SAME statements at route-factory time, so this file is the migration path, not the only path.
--
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS venture_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  scenario_id UUID REFERENCES venture_scenarios(id) ON DELETE CASCADE,
  run_id UUID,
  engine_version VARCHAR(16) NOT NULL,
  inputs_hash CHAR(64) NOT NULL,
  figures JSONB NOT NULL,
  tables JSONB NOT NULL,
  coverage JSONB NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  posture VARCHAR(16) NOT NULL DEFAULT 'estimate',
  can_publish BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS venture_models_venture_idx
  ON venture_models(venture_id, scenario_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS venture_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id UUID NOT NULL REFERENCES venture_ventures(id) ON DELETE CASCADE,
  owner_sub VARCHAR(255) NOT NULL,
  doc_key VARCHAR(48) NOT NULL,
  version INTEGER NOT NULL,
  model_id UUID NOT NULL REFERENCES venture_models(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  prose_run_id UUID,
  prose_status VARCHAR(12) NOT NULL DEFAULT 'none',
  unverified_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumptions_cited JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimate_pct NUMERIC(6,3) NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE UNIQUE INDEX IF NOT EXISTS venture_documents_ver_idx
  ON venture_documents(venture_id, doc_key, version);

ALTER TABLE venture_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_models FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'venture_models_owner_or_operator' AND polrelid = 'venture_models'::regclass) THEN
    CREATE POLICY venture_models_owner_or_operator ON venture_models
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;

ALTER TABLE venture_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE venture_documents FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'venture_documents_owner_or_operator' AND polrelid = 'venture_documents'::regclass) THEN
    CREATE POLICY venture_documents_owner_or_operator ON venture_documents
      AS PERMISSIVE FOR ALL
      USING (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on')
      WITH CHECK (owner_sub = current_setting('oshal.current_sub', true) OR current_setting('oshal.is_operator', true) = 'on');
  END IF;
END $$;
