-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Immutable original-identity publishing assets, models and retained outputs with composite ownership constraints.
CREATE TABLE IF NOT EXISTS publishing_documents (
 id UUID PRIMARY KEY, owner_key TEXT NOT NULL, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 current_revision INTEGER NOT NULL CHECK(current_revision BETWEEN 1 AND 100), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,owner_key)
);
CREATE TABLE IF NOT EXISTS publishing_revisions (
 document_id UUID NOT NULL, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100), owner_key TEXT NOT NULL,
 model JSONB NOT NULL CHECK(jsonb_typeof(model)='object' AND octet_length(model::text)<=786432), sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(document_id,revision), UNIQUE(document_id,revision,owner_key),
 FOREIGN KEY(document_id,owner_key) REFERENCES publishing_documents(id,owner_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS publishing_blobs (
 id UUID PRIMARY KEY, owner_key TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 4194304), sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), UNIQUE(id,owner_key)
);
CREATE TABLE IF NOT EXISTS publishing_chunks (
 blob_id UUID NOT NULL, owner_key TEXT NOT NULL, offset_bytes INTEGER NOT NULL CHECK(offset_bytes>=0 AND offset_bytes%65536=0),
 data_base64 TEXT NOT NULL CHECK(length(data_base64) BETWEEN 4 AND 87384), sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(blob_id,offset_bytes), FOREIGN KEY(blob_id,owner_key) REFERENCES publishing_blobs(id,owner_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS publishing_assets (
 id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, blob_id UUID NOT NULL UNIQUE, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 mime TEXT NOT NULL CHECK(mime IN('image/png','image/jpeg')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,owner_key),
 FOREIGN KEY(blob_id,owner_key) REFERENCES publishing_blobs(id,owner_key)
);
CREATE TABLE IF NOT EXISTS publishing_references (
 document_id UUID NOT NULL, revision INTEGER NOT NULL, asset_id TEXT NOT NULL, owner_key TEXT NOT NULL,
 PRIMARY KEY(document_id,revision,asset_id),
 FOREIGN KEY(document_id,revision,owner_key) REFERENCES publishing_revisions(document_id,revision,owner_key) ON DELETE CASCADE,
 FOREIGN KEY(asset_id,owner_key) REFERENCES publishing_assets(id,owner_key)
);
CREATE TABLE IF NOT EXISTS publishing_requests (
 owner_key TEXT NOT NULL, request_key UUID NOT NULL, fingerprint TEXT NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), resource_id TEXT NOT NULL,
 result JSONB NOT NULL CHECK(octet_length(result::text)<=262144), tombstone BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(owner_key,request_key)
);
CREATE TABLE IF NOT EXISTS publishing_jobs (
 id UUID PRIMARY KEY, owner_key TEXT NOT NULL, document_id UUID NOT NULL, revision INTEGER NOT NULL,
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'), state TEXT NOT NULL CHECK(state IN('queued','rendering','ready','failed','cancelled')),
 result JSONB CHECK(result IS NULL OR octet_length(result::text)<=262144), error TEXT, details JSONB CHECK(details IS NULL OR octet_length(details::text)<=65536),
 run_until TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,owner_key),
 FOREIGN KEY(document_id,revision,owner_key) REFERENCES publishing_revisions(document_id,revision,owner_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS publishing_outputs (
 job_id UUID NOT NULL, owner_key TEXT NOT NULL, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 64), blob_id UUID NOT NULL UNIQUE, mime TEXT NOT NULL,
 PRIMARY KEY(job_id,name), FOREIGN KEY(job_id,owner_key) REFERENCES publishing_jobs(id,owner_key) ON DELETE CASCADE,
 FOREIGN KEY(blob_id,owner_key) REFERENCES publishing_blobs(id,owner_key)
);
CREATE INDEX IF NOT EXISTS publishing_documents_owner ON publishing_documents(owner_key,updated_at);
CREATE INDEX IF NOT EXISTS publishing_jobs_owner ON publishing_jobs(owner_key,expires_at);
CREATE OR REPLACE FUNCTION publishing_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'publishing source, revision and chunks are immutable'; END $$;
CREATE TRIGGER publishing_revisions_immutable BEFORE UPDATE ON publishing_revisions FOR EACH ROW EXECUTE FUNCTION publishing_immutable();
CREATE TRIGGER publishing_blobs_immutable BEFORE UPDATE ON publishing_blobs FOR EACH ROW EXECUTE FUNCTION publishing_immutable();
CREATE TRIGGER publishing_chunks_immutable BEFORE UPDATE ON publishing_chunks FOR EACH ROW EXECUTE FUNCTION publishing_immutable();
CREATE TRIGGER publishing_assets_immutable BEFORE UPDATE ON publishing_assets FOR EACH ROW EXECUTE FUNCTION publishing_immutable();
CREATE TRIGGER publishing_references_immutable BEFORE UPDATE ON publishing_references FOR EACH ROW EXECUTE FUNCTION publishing_immutable();
CREATE TRIGGER publishing_outputs_immutable BEFORE UPDATE ON publishing_outputs FOR EACH ROW EXECUTE FUNCTION publishing_immutable();
ALTER TABLE publishing_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY publishing_documents_own ON publishing_documents USING(owner_key=current_setting('publishing_studio.owner_key',true)) WITH CHECK(owner_key=current_setting('publishing_studio.owner_key',true));
ALTER TABLE publishing_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY publishing_revisions_own ON publishing_revisions USING(owner_key=current_setting('publishing_studio.owner_key',true)) WITH CHECK(owner_key=current_setting('publishing_studio.owner_key',true));
ALTER TABLE publishing_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_blobs FORCE ROW LEVEL SECURITY;
CREATE POLICY publishing_blobs_own ON publishing_blobs USING(owner_key=current_setting('publishing_studio.owner_key',true)) WITH CHECK(owner_key=current_setting('publishing_studio.owner_key',true));
ALTER TABLE publishing_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY publishing_chunks_own ON publishing_chunks USING(owner_key=current_setting('publishing_studio.owner_key',true)) WITH CHECK(owner_key=current_setting('publishing_studio.owner_key',true));
ALTER TABLE publishing_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY publishing_assets_own ON publishing_assets USING(owner_key=current_setting('publishing_studio.owner_key',true)) WITH CHECK(owner_key=current_setting('publishing_studio.owner_key',true));
ALTER TABLE publishing_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_references FORCE ROW LEVEL SECURITY;
CREATE POLICY publishing_references_own ON publishing_references USING(owner_key=current_setting('publishing_studio.owner_key',true)) WITH CHECK(owner_key=current_setting('publishing_studio.owner_key',true));
ALTER TABLE publishing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY publishing_requests_own ON publishing_requests USING(owner_key=current_setting('publishing_studio.owner_key',true)) WITH CHECK(owner_key=current_setting('publishing_studio.owner_key',true));
ALTER TABLE publishing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY publishing_jobs_own ON publishing_jobs USING(owner_key=current_setting('publishing_studio.owner_key',true)) WITH CHECK(owner_key=current_setting('publishing_studio.owner_key',true));
ALTER TABLE publishing_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_outputs FORCE ROW LEVEL SECURITY;
CREATE POLICY publishing_outputs_own ON publishing_outputs USING(owner_key=current_setting('publishing_studio.owner_key',true)) WITH CHECK(owner_key=current_setting('publishing_studio.owner_key',true));
