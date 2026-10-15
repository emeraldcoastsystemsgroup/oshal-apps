-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Native final shape of 001-005, which the native kernel skips: the project, revision, asset, revision-asset, brand-kit and region-edit tables with their keys, checks and indexes, and the immutable revision/asset rejection the kernel compiles natively. The exact-owner RLS policy loops, the pg_class/pg_policies read-backs and their ENABLE/FORCE stay PostgreSQL-only; the native per-person scope and its owner-field check keep each person's projects their own. On PostgreSQL every statement here is a no-op after 001-005.

-- 001-create-projects.sql
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

-- Revisions and assets are immutable (001's rejection trigger, which the native kernel compiles to protected metadata).
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

-- 002-create-brand-kits.sql
CREATE TABLE IF NOT EXISTS create_brand_kits (
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 100000),
  kit JSONB NOT NULL CHECK (jsonb_typeof(kit) = 'object' AND octet_length(kit::text) <= 16384),
  logo_asset_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_issuer, owner_sub),
  FOREIGN KEY (logo_asset_id, owner_issuer, owner_sub) REFERENCES create_project_assets (asset_id, owner_issuer, owner_sub)
);

CREATE INDEX IF NOT EXISTS create_brand_kits_logo ON create_brand_kits (owner_issuer, owner_sub, logo_asset_id);

-- 003-force-row-level-security.sql
-- 004-owner-policy-standard-identity-arm.sql
-- 005-create-region-edits.sql
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
