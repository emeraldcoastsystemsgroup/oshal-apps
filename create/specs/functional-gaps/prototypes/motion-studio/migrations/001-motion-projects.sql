-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Keep native motion documents, immutable owned raster bytes and idempotent revisions under forced exact-owner policies.
-- 2 | maintainer@emeraldcoastsystemsgroup.com | Declare exactly one immutable inline content or durable UUID handle in photo metadata.
-- 3 | maintainer@emeraldcoastsystemsgroup.com | Permit exactly one immutable legacy document or verified durable revision descriptor.
-- 4 | maintainer@emeraldcoastsystemsgroup.com | Fence original-owner publications and keep immutable photo file handles unique for committed reference and cleanup lifecycle.
CREATE TABLE motion_blob_epochs (
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  epoch BIGINT NOT NULL CHECK (epoch > 0),
  PRIMARY KEY (owner_issuer, owner_sub)
);
CREATE TABLE motion_projects (
  project_id UUID PRIMARY KEY,
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, owner_issuer, owner_sub)
);
CREATE INDEX motion_projects_owner ON motion_projects (owner_issuer, owner_sub, updated_at);
CREATE TABLE motion_assets (
  asset_id UUID PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/png','image/jpeg','image/webp')),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 4194304),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  blob_handle UUID UNIQUE,
  content_base64 TEXT CHECK (length(content_base64) BETWEEN 4 AND 5592408),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((content_base64 IS NULL) <> (blob_handle IS NULL)),
  CHECK (width::bigint * height <= 33554432),
  UNIQUE (asset_id, owner_issuer, owner_sub)
);
CREATE INDEX motion_assets_owner ON motion_assets (owner_issuer, owner_sub);
CREATE TABLE motion_revisions (
  project_id UUID NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  document_blob UUID UNIQUE,
  document_bytes INTEGER CHECK (document_bytes BETWEEN 1 AND 2097152),
  document_sha256 TEXT CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  document JSONB CHECK (jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 4194304),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((document IS NOT NULL AND document_blob IS NULL AND document_bytes IS NULL AND document_sha256 IS NULL) OR (document IS NULL AND document_blob IS NOT NULL AND document_bytes IS NOT NULL AND document_sha256 IS NOT NULL)),
  PRIMARY KEY (project_id, revision),
  UNIQUE (project_id, revision, owner_issuer, owner_sub),
  FOREIGN KEY (project_id, owner_issuer, owner_sub) REFERENCES motion_projects (project_id, owner_issuer, owner_sub) ON DELETE CASCADE
);
CREATE TABLE motion_revision_assets (
  project_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  asset_id UUID NOT NULL,
  PRIMARY KEY (project_id, revision, asset_id),
  FOREIGN KEY (project_id, revision, owner_issuer, owner_sub) REFERENCES motion_revisions (project_id, revision, owner_issuer, owner_sub) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, owner_issuer, owner_sub) REFERENCES motion_assets (asset_id, owner_issuer, owner_sub)
);
CREATE INDEX motion_revision_assets_asset ON motion_revision_assets (owner_issuer, owner_sub, asset_id);
CREATE TABLE motion_requests (
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  request_key UUID NOT NULL,
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  project_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (owner_issuer, owner_sub, request_key),
  FOREIGN KEY (project_id, revision, owner_issuer, owner_sub) REFERENCES motion_revisions (project_id, revision, owner_issuer, owner_sub) ON DELETE CASCADE
);
DO $$
DECLARE tab TEXT;
BEGIN
  FOREACH tab IN ARRAY ARRAY['motion_blob_epochs','motion_projects','motion_assets','motion_revisions','motion_revision_assets','motion_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tab);
    EXECUTE format('CREATE POLICY exact_owner ON %I FOR ALL USING (owner_issuer = current_setting(''motion.owner_issuer'',true) AND owner_sub = current_setting(''motion.owner_sub'',true)) WITH CHECK (owner_issuer = current_setting(''motion.owner_issuer'',true) AND owner_sub = current_setting(''motion.owner_sub'',true))', tab);
  END LOOP;
END $$;
CREATE FUNCTION motion_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'motion revisions and assets are immutable';
END $$;
CREATE TRIGGER motion_revision_immutable BEFORE UPDATE ON motion_revisions FOR EACH ROW EXECUTE FUNCTION motion_immutable();
CREATE TRIGGER motion_asset_immutable BEFORE UPDATE ON motion_assets FOR EACH ROW EXECUTE FUNCTION motion_immutable();
