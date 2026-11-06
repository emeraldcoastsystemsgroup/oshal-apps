-- Generated editor-source schema; authoritative generator scripts/editor-source-projects/schema.mjs.

CREATE TABLE IF NOT EXISTS vids_source_projects (
 id UUID PRIMARY KEY, owner_key TEXT NOT NULL, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 current_revision INTEGER NOT NULL CHECK(current_revision BETWEEN 1 AND 100),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,owner_key)
);
CREATE TABLE IF NOT EXISTS vids_source_revisions (
 project_id UUID NOT NULL, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100), owner_key TEXT NOT NULL,
 model JSONB NOT NULL CHECK(octet_length(model::text)<=262144), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(project_id,revision), UNIQUE(project_id,revision,owner_key),
 FOREIGN KEY(project_id,owner_key) REFERENCES vids_source_projects(id,owner_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS vids_source_assets (
 id UUID PRIMARY KEY, owner_key TEXT NOT NULL, mime TEXT NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp')),
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 4194304), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 metadata JSONB NOT NULL CHECK(octet_length(metadata::text)<=8192),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,owner_key)
);
CREATE TABLE IF NOT EXISTS vids_source_chunks (
 asset_id UUID NOT NULL, owner_key TEXT NOT NULL, byte_offset INTEGER NOT NULL CHECK(byte_offset>=0 AND byte_offset<4194304 AND byte_offset%65536=0),
 data_base64 TEXT NOT NULL CHECK(length(data_base64) BETWEEN 4 AND 87384), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 PRIMARY KEY(asset_id,byte_offset), FOREIGN KEY(asset_id,owner_key) REFERENCES vids_source_assets(id,owner_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS vids_source_references (
 project_id UUID NOT NULL, revision INTEGER NOT NULL, asset_id UUID NOT NULL, owner_key TEXT NOT NULL,
 PRIMARY KEY(project_id,revision,asset_id),
 FOREIGN KEY(project_id,revision,owner_key) REFERENCES vids_source_revisions(project_id,revision,owner_key) ON DELETE CASCADE,
 FOREIGN KEY(asset_id,owner_key) REFERENCES vids_source_assets(id,owner_key)
);
CREATE TABLE IF NOT EXISTS vids_source_requests (
 owner_key TEXT NOT NULL, request_key UUID NOT NULL, fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64), resource_id UUID NOT NULL,
 result JSONB NOT NULL CHECK(octet_length(result::text)<=16384), tombstone BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(owner_key,request_key)
);
CREATE INDEX IF NOT EXISTS vids_source_projects_owner_idx ON vids_source_projects(owner_key);
CREATE INDEX IF NOT EXISTS vids_source_revisions_owner_idx ON vids_source_revisions(owner_key);
CREATE INDEX IF NOT EXISTS vids_source_assets_owner_idx ON vids_source_assets(owner_key);
CREATE INDEX IF NOT EXISTS vids_source_chunks_owner_idx ON vids_source_chunks(owner_key);
CREATE INDEX IF NOT EXISTS vids_source_references_owner_idx ON vids_source_references(owner_key);
CREATE INDEX IF NOT EXISTS vids_source_requests_resource_idx ON vids_source_requests(owner_key,resource_id);
CREATE OR REPLACE FUNCTION vids_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'source rows are immutable'; END $$;
DROP TRIGGER IF EXISTS vids_source_revisions_immutable ON vids_source_revisions;
CREATE TRIGGER vids_source_revisions_immutable BEFORE UPDATE ON vids_source_revisions FOR EACH ROW EXECUTE FUNCTION vids_source_immutable();
DROP TRIGGER IF EXISTS vids_source_assets_immutable ON vids_source_assets;
CREATE TRIGGER vids_source_assets_immutable BEFORE UPDATE ON vids_source_assets FOR EACH ROW EXECUTE FUNCTION vids_source_immutable();
DROP TRIGGER IF EXISTS vids_source_chunks_immutable ON vids_source_chunks;
CREATE TRIGGER vids_source_chunks_immutable BEFORE UPDATE ON vids_source_chunks FOR EACH ROW EXECUTE FUNCTION vids_source_immutable();
DROP TRIGGER IF EXISTS vids_source_references_immutable ON vids_source_references;
CREATE TRIGGER vids_source_references_immutable BEFORE UPDATE ON vids_source_references FOR EACH ROW EXECUTE FUNCTION vids_source_immutable();
