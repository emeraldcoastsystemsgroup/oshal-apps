-- CHANGE LOG
-- SEQ | AUTHOR | DESCRIPTION
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Persist private issuer-qualified projects, append-only revisions and immutable raster asset metadata; no role or grant changes.

CREATE TABLE IF NOT EXISTS create_projects (
  project_id UUID PRIMARY KEY,
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS create_projects_owner_updated ON create_projects (owner_issuer, owner_sub, updated_at DESC, project_id);

CREATE TABLE IF NOT EXISTS create_project_revisions (
  project_id UUID NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 524288),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, revision),
  UNIQUE (project_id, revision, owner_issuer, owner_sub),
  FOREIGN KEY (project_id, owner_issuer, owner_sub) REFERENCES create_projects (project_id, owner_issuer, owner_sub) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS create_project_assets (
  asset_id UUID PRIMARY KEY,
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (width::bigint * height <= 33554432),
  UNIQUE (asset_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS create_project_assets_owner ON create_project_assets (owner_issuer, owner_sub);

CREATE TABLE IF NOT EXISTS create_project_revision_assets (
  project_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  asset_id UUID NOT NULL,
  PRIMARY KEY (project_id, revision, asset_id),
  FOREIGN KEY (project_id, revision, owner_issuer, owner_sub) REFERENCES create_project_revisions (project_id, revision, owner_issuer, owner_sub) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, owner_issuer, owner_sub) REFERENCES create_project_assets (asset_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS create_project_revision_assets_asset ON create_project_revision_assets (owner_issuer, owner_sub, asset_id);

-- Identity is installed transaction-locally by the package from the verified framework
-- actor. Empty/unset context denies every row. Operator status does not bypass ownership.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['create_projects', 'create_project_revisions', 'create_project_assets', 'create_project_revision_assets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = table_name::regclass AND polname = table_name || '_exact_owner') THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL
        USING (owner_issuer = current_setting(''create.owner_issuer'', true) AND owner_sub = current_setting(''create.owner_sub'', true))
        WITH CHECK (owner_issuer = current_setting(''create.owner_issuer'', true) AND owner_sub = current_setting(''create.owner_sub'', true))',
        table_name || '_exact_owner', table_name);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION create_reject_revision_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Create project revisions and assets are immutable';
END $$;
DROP TRIGGER IF EXISTS create_project_revision_immutable ON create_project_revisions;
CREATE TRIGGER create_project_revision_immutable BEFORE UPDATE ON create_project_revisions
FOR EACH ROW EXECUTE FUNCTION create_reject_revision_update();
DROP TRIGGER IF EXISTS create_project_asset_immutable ON create_project_assets;
CREATE TRIGGER create_project_asset_immutable BEFORE UPDATE ON create_project_assets
FOR EACH ROW EXECUTE FUNCTION create_reject_revision_update();
