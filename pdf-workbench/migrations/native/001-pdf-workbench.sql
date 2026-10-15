-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Immutable original/derivative bytes and fenced original-owner revisions.
-- 2 | maintainer@emeraldcoastsystemsgroup.com | Bound persisted retry result encoding and retain original creation time.
CREATE TABLE IF NOT EXISTS pdf_blobs (
 id UUID PRIMARY KEY, owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 5 AND 4194304), sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 UNIQUE(id,owner_issuer,owner_sub)
);
CREATE TABLE IF NOT EXISTS pdf_chunks (
 blob_id UUID NOT NULL, owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL,
 offset_bytes INTEGER NOT NULL CHECK(offset_bytes>=0 AND offset_bytes%65536=0),
 data_base64 TEXT NOT NULL CHECK(length(data_base64) BETWEEN 4 AND 87384),
 sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(blob_id,offset_bytes),
 FOREIGN KEY(blob_id,owner_issuer,owner_sub) REFERENCES pdf_blobs(id,owner_issuer,owner_sub) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pdf_sources (
 id UUID PRIMARY KEY, owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL,
 blob_id UUID NOT NULL UNIQUE, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 inspection JSONB NOT NULL CHECK(jsonb_typeof(inspection)='object' AND octet_length(inspection::text)<=131072),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,owner_issuer,owner_sub),
 FOREIGN KEY(blob_id,owner_issuer,owner_sub) REFERENCES pdf_blobs(id,owner_issuer,owner_sub)
);
CREATE TABLE IF NOT EXISTS pdf_documents (
 id UUID PRIMARY KEY, owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160), current_revision INTEGER NOT NULL CHECK(current_revision BETWEEN 1 AND 100),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,owner_issuer,owner_sub)
);
CREATE TABLE IF NOT EXISTS pdf_revisions (
 document_id UUID NOT NULL, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),
 owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL, blob_id UUID NOT NULL UNIQUE,
 model JSONB NOT NULL CHECK(jsonb_typeof(model)='object' AND octet_length(model::text)<=524288),
 inspection JSONB NOT NULL CHECK(jsonb_typeof(inspection)='object' AND octet_length(inspection::text)<=131072),
 engine_hash TEXT NOT NULL CHECK(engine_hash ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(document_id,revision), UNIQUE(document_id,revision,owner_issuer,owner_sub),
 FOREIGN KEY(document_id,owner_issuer,owner_sub) REFERENCES pdf_documents(id,owner_issuer,owner_sub) ON DELETE CASCADE,
 FOREIGN KEY(blob_id,owner_issuer,owner_sub) REFERENCES pdf_blobs(id,owner_issuer,owner_sub)
);
CREATE TABLE IF NOT EXISTS pdf_revision_sources (
 document_id UUID NOT NULL, revision INTEGER NOT NULL, source_id UUID NOT NULL, owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL,
 PRIMARY KEY(document_id,revision,source_id),
 FOREIGN KEY(document_id,revision,owner_issuer,owner_sub) REFERENCES pdf_revisions(document_id,revision,owner_issuer,owner_sub) ON DELETE CASCADE,
 FOREIGN KEY(source_id,owner_issuer,owner_sub) REFERENCES pdf_sources(id,owner_issuer,owner_sub)
);
CREATE TABLE IF NOT EXISTS pdf_requests (
 owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL, request_key UUID NOT NULL,
 fingerprint TEXT NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), result JSONB NOT NULL CHECK(octet_length(result::text)<=262144),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_issuer,owner_sub,request_key)
);
CREATE TABLE IF NOT EXISTS pdf_jobs (
 id UUID PRIMARY KEY, owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL, document_id UUID NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','rendering','ready','failed','cancelled')),
 kind TEXT NOT NULL CHECK(kind IN ('revision','ocr')), base_revision INTEGER NOT NULL,
 payload JSONB NOT NULL CHECK(octet_length(payload::text)<=524288), result JSONB CHECK(result IS NULL OR octet_length(result::text)<=2097152), error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
 UNIQUE(id,owner_issuer,owner_sub),
 FOREIGN KEY(document_id,owner_issuer,owner_sub) REFERENCES pdf_documents(id,owner_issuer,owner_sub) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pdf_documents_owner ON pdf_documents(owner_issuer,owner_sub,updated_at);
CREATE INDEX IF NOT EXISTS pdf_jobs_owner ON pdf_jobs(owner_issuer,owner_sub,expires_at);
CREATE OR REPLACE FUNCTION pdf_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PDF source, derivative and content parts are immutable'; END $$;
CREATE TRIGGER pdf_blob_immutable BEFORE UPDATE ON pdf_blobs FOR EACH ROW EXECUTE FUNCTION pdf_immutable();
CREATE TRIGGER pdf_chunk_immutable BEFORE UPDATE ON pdf_chunks FOR EACH ROW EXECUTE FUNCTION pdf_immutable();
CREATE TRIGGER pdf_source_immutable BEFORE UPDATE ON pdf_sources FOR EACH ROW EXECUTE FUNCTION pdf_immutable();
CREATE TRIGGER pdf_revision_immutable BEFORE UPDATE ON pdf_revisions FOR EACH ROW EXECUTE FUNCTION pdf_immutable();
CREATE TRIGGER pdf_revision_source_immutable BEFORE UPDATE ON pdf_revision_sources FOR EACH ROW EXECUTE FUNCTION pdf_immutable();
