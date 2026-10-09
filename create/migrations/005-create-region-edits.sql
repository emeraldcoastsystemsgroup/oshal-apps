-- CHANGE LOG
-- SEQ | AUTHOR | DESCRIPTION
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Region edits: one row per request to regenerate a selected image region. Each row records the exact source revision, the target layer and source image, the validated source-pixel selection and the instruction, and the candidate raster once composited. Accepting one records the child revision it became; rejection, cancellation and failure never touch the project. The table is private per verified issuer and subject, FORCEd, with the same two-arm exact-owner policy as every other table this package owns, and no operator arm. No role or grant changes.

CREATE TABLE IF NOT EXISTS create_region_edits (
  edit_id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  source_revision INTEGER NOT NULL CHECK (source_revision BETWEEN 1 AND 1000),
  layer_id TEXT NOT NULL CHECK (length(layer_id) BETWEEN 1 AND 100),
  source_asset_id UUID NOT NULL,
  selection JSONB NOT NULL CHECK (jsonb_typeof(selection) = 'object' AND octet_length(selection::text) <= 131072),
  instruction TEXT NOT NULL CHECK (length(instruction) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'ready', 'accepted', 'rejected', 'cancelled', 'failed')),
  result_asset_id UUID NULL,
  accepted_revision INTEGER NULL CHECK (accepted_revision BETWEEN 2 AND 1000),
  provider TEXT NULL CHECK (length(provider) <= 200),
  model TEXT NULL CHECK (length(model) <= 200),
  cost_usd NUMERIC(12,6) NULL CHECK (cost_usd >= 0),
  error TEXT NULL CHECK (error ~ '^[a-z0-9_]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A ready candidate always names its raster; an accepted one also names the revision it became.
  CHECK (status NOT IN ('ready', 'accepted') OR result_asset_id IS NOT NULL),
  CHECK ((status = 'accepted') = (accepted_revision IS NOT NULL)),
  FOREIGN KEY (project_id, owner_issuer, owner_sub) REFERENCES create_projects (project_id, owner_issuer, owner_sub) ON DELETE CASCADE,
  FOREIGN KEY (project_id, source_revision, owner_issuer, owner_sub)
    REFERENCES create_project_revisions (project_id, revision, owner_issuer, owner_sub) ON DELETE CASCADE,
  FOREIGN KEY (result_asset_id, owner_issuer, owner_sub) REFERENCES create_project_assets (asset_id, owner_issuer, owner_sub) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS create_region_edits_owner_created ON create_region_edits (owner_issuer, owner_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS create_region_edits_project ON create_region_edits (owner_issuer, owner_sub, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS create_region_edits_result ON create_region_edits (owner_issuer, owner_sub, result_asset_id);

-- Identity is installed transaction-locally by the package from the verified framework actor, or
-- session-scoped by the platform GUC pool under the same person, exactly as for the project tables.
-- Empty/unset context denies every row. Operator status does not bypass ownership.
ALTER TABLE create_region_edits ENABLE ROW LEVEL SECURITY;
-- ENABLE alone exempts the table OWNER, which is the role the api connects as.
ALTER TABLE create_region_edits FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'create_region_edits'::regclass AND polname = 'create_region_edits_exact_owner') THEN
    -- The second arm is the platform-wide stamp core's catalog-driven /api/me export and delete
    -- arrive with; this table carries owner_sub, so that path discovers it. No operator bypass:
    -- oshal.is_operator is never consulted, and system work stamps both platform settings empty,
    -- which the <> '' guard rejects.
    CREATE POLICY create_region_edits_exact_owner ON create_region_edits FOR ALL
      USING (
           (owner_issuer = current_setting('create.owner_issuer', true)
            AND owner_sub = current_setting('create.owner_sub', true))
        OR (current_setting('oshal.current_sub', true) <> ''
            AND owner_issuer = current_setting('oshal.current_issuer', true)
            AND owner_sub    = current_setting('oshal.current_sub', true)))
      WITH CHECK (
           (owner_issuer = current_setting('create.owner_issuer', true)
            AND owner_sub = current_setting('create.owner_sub', true))
        OR (current_setting('oshal.current_sub', true) <> ''
            AND owner_issuer = current_setting('oshal.current_issuer', true)
            AND owner_sub    = current_setting('oshal.current_sub', true)));
  END IF;
END $$;
