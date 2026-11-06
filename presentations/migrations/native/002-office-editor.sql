-- Original-owned editable Office documents and immutable source revisions.
CREATE TABLE IF NOT EXISTS office_editor_originals (
 owner_key TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes>0 AND bytes<=10485760), findings JSONB NOT NULL,
 PRIMARY KEY(owner_key,id)
);
CREATE TABLE IF NOT EXISTS office_editor_original_parts (
 owner_key TEXT NOT NULL, original_id TEXT NOT NULL, offset_bytes INTEGER NOT NULL,
 data_base64 TEXT NOT NULL, sha256 TEXT NOT NULL,
 PRIMARY KEY(owner_key,original_id,offset_bytes),
 FOREIGN KEY(owner_key,original_id) REFERENCES office_editor_originals(owner_key,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS office_editor_documents (
 owner_key TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN('pptx','docx','xlsx')),
 current_revision INTEGER NOT NULL CHECK(current_revision BETWEEN 1 AND 100),
 original_id TEXT, original_name TEXT, original_sha256 TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(owner_key,id), FOREIGN KEY(owner_key,original_id) REFERENCES office_editor_originals(owner_key,id)
);
CREATE TABLE IF NOT EXISTS office_editor_revisions (
 owner_key TEXT NOT NULL, document_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),
 model JSONB NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>0 AND bytes<=4194304),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(owner_key,document_id,revision),
 FOREIGN KEY(owner_key,document_id) REFERENCES office_editor_documents(owner_key,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS office_editor_requests (
 owner_key TEXT NOT NULL,request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,document_id TEXT NOT NULL,revision INTEGER NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,tombstone BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(owner_key,request_key)
);
CREATE TABLE IF NOT EXISTS office_editor_exports (
 owner_key TEXT NOT NULL,sha256 TEXT NOT NULL,model_sha256 TEXT NOT NULL,document_id TEXT NOT NULL,
 revision INTEGER NOT NULL,expires_at TIMESTAMPTZ NOT NULL,PRIMARY KEY(owner_key,sha256),
 FOREIGN KEY(owner_key,document_id,revision) REFERENCES office_editor_revisions(owner_key,document_id,revision) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS office_editor_documents_owner_date ON office_editor_documents(owner_key,updated_at);
CREATE INDEX IF NOT EXISTS office_editor_requests_owner_expiry ON office_editor_requests(owner_key,expires_at);
CREATE OR REPLACE FUNCTION office_editor_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Office original files and document revisions are immutable'; END $$;
CREATE TRIGGER office_editor_revision_immutable BEFORE UPDATE ON office_editor_revisions FOR EACH ROW EXECUTE FUNCTION office_editor_immutable();
CREATE TRIGGER office_editor_original_immutable BEFORE UPDATE ON office_editor_originals FOR EACH ROW EXECUTE FUNCTION office_editor_immutable();
CREATE TRIGGER office_editor_original_part_immutable BEFORE UPDATE ON office_editor_original_parts FOR EACH ROW EXECUTE FUNCTION office_editor_immutable();

CREATE TRIGGER office_editor_export_immutable BEFORE UPDATE ON office_editor_exports FOR EACH ROW EXECUTE FUNCTION office_editor_immutable();
