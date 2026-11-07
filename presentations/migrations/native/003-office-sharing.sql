-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-07): native SQLite-backed document sharing and immutable access audit tables.

CREATE TABLE IF NOT EXISTS office_editor_shares (
 owner_key TEXT NOT NULL,
 id TEXT NOT NULL,
 document_id TEXT NOT NULL,
 tenant_id TEXT NOT NULL,
 owner_issuer TEXT NOT NULL,
 owner_sub TEXT NOT NULL,
 grantee_issuer TEXT NOT NULL,
 grantee_sub TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN('view','comment','edit')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(owner_key,id),
 UNIQUE(owner_key,document_id,grantee_issuer,grantee_sub),
 FOREIGN KEY(owner_key,document_id) REFERENCES office_editor_documents(owner_key,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS office_editor_share_audit (
 id TEXT NOT NULL PRIMARY KEY,
 owner_key TEXT NOT NULL,
 document_id TEXT NOT NULL,
 tenant_id TEXT NOT NULL,
 actor_issuer TEXT NOT NULL,
 actor_sub TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('share_grant','share_revoke','view','comment','edit','export','denied')),
 role TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS office_editor_shares_grantee_idx ON office_editor_shares(tenant_id,grantee_issuer,grantee_sub);
CREATE INDEX IF NOT EXISTS office_editor_shares_doc_idx ON office_editor_shares(owner_key,document_id);
CREATE INDEX IF NOT EXISTS office_editor_share_audit_doc_idx ON office_editor_share_audit(owner_key,document_id,created_at);

CREATE TRIGGER office_editor_share_audit_immutable BEFORE UPDATE ON office_editor_share_audit FOR EACH ROW EXECUTE FUNCTION office_editor_immutable();
