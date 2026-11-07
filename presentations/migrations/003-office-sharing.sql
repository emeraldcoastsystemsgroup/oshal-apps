-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.0 (RP-OFF-07): document sharing (`view`, `comment`, `edit`) and immutable access audit trail with two-arm ENABLE + FORCE row-level security.

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
CREATE INDEX IF NOT EXISTS office_editor_share_audit_doc_idx ON office_editor_share_audit(owner_key,document_id,created_at DESC);

DROP TRIGGER IF EXISTS office_editor_immutable ON office_editor_share_audit;
CREATE TRIGGER office_editor_immutable BEFORE UPDATE ON office_editor_share_audit FOR EACH ROW EXECUTE FUNCTION office_editor_immutable();

ALTER TABLE office_editor_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_editor_shares FORCE ROW LEVEL SECURITY;

ALTER TABLE office_editor_share_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_editor_share_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS office_editor_shares_owner ON office_editor_shares;
CREATE POLICY office_editor_shares_owner ON office_editor_shares
 FOR ALL
 USING (
  owner_key = current_setting('office_editor.owner_key', true)
  OR (
   owner_issuer = current_setting('oshal.current_issuer', true)
   AND owner_sub = current_setting('oshal.current_sub', true)
  )
  OR current_setting('oshal.is_operator', true) = 'true'
 )
 WITH CHECK (
  owner_key = current_setting('office_editor.owner_key', true)
  OR (
   owner_issuer = current_setting('oshal.current_issuer', true)
   AND owner_sub = current_setting('oshal.current_sub', true)
  )
  OR current_setting('oshal.is_operator', true) = 'true'
 );

DROP POLICY IF EXISTS office_editor_shares_grantee_select ON office_editor_shares;
CREATE POLICY office_editor_shares_grantee_select ON office_editor_shares
 FOR SELECT
 USING (
  tenant_id = current_setting('office_editor.tenant_id', true)
  AND grantee_issuer = current_setting('office_editor.actor_issuer', true)
  AND grantee_sub = current_setting('office_editor.actor_sub', true)
 );

DROP POLICY IF EXISTS office_editor_audit_select ON office_editor_share_audit;
CREATE POLICY office_editor_audit_select ON office_editor_share_audit
 FOR SELECT
 USING (
  owner_key = current_setting('office_editor.owner_key', true)
  OR current_setting('oshal.is_operator', true) = 'true'
  OR (
   tenant_id = current_setting('office_editor.tenant_id', true)
   AND actor_issuer = current_setting('office_editor.actor_issuer', true)
   AND actor_sub = current_setting('office_editor.actor_sub', true)
  )
 );

DROP POLICY IF EXISTS office_editor_audit_insert ON office_editor_share_audit;
CREATE POLICY office_editor_audit_insert ON office_editor_share_audit
 FOR INSERT
 WITH CHECK (
  (
   tenant_id = current_setting('office_editor.tenant_id', true)
   AND actor_issuer = current_setting('office_editor.actor_issuer', true)
   AND actor_sub = current_setting('office_editor.actor_sub', true)
  )
  OR current_setting('oshal.is_operator', true) = 'true'
 );

DROP POLICY IF EXISTS office_editor_shared_doc_select ON office_editor_documents;
CREATE POLICY office_editor_shared_doc_select ON office_editor_documents
 FOR SELECT
 USING (
  EXISTS (
   SELECT 1 FROM office_editor_shares s
   WHERE s.owner_key = office_editor_documents.owner_key
     AND s.document_id = office_editor_documents.id
     AND s.tenant_id = current_setting('office_editor.tenant_id', true)
     AND s.grantee_issuer = current_setting('office_editor.actor_issuer', true)
     AND s.grantee_sub = current_setting('office_editor.actor_sub', true)
  )
 );

DROP POLICY IF EXISTS office_editor_shared_doc_update ON office_editor_documents;
CREATE POLICY office_editor_shared_doc_update ON office_editor_documents
 FOR UPDATE
 USING (
  EXISTS (
   SELECT 1 FROM office_editor_shares s
   WHERE s.owner_key = office_editor_documents.owner_key
     AND s.document_id = office_editor_documents.id
     AND s.tenant_id = current_setting('office_editor.tenant_id', true)
     AND s.grantee_issuer = current_setting('office_editor.actor_issuer', true)
     AND s.grantee_sub = current_setting('office_editor.actor_sub', true)
     AND s.role IN ('comment', 'edit')
  )
 )
 WITH CHECK (
  EXISTS (
   SELECT 1 FROM office_editor_shares s
   WHERE s.owner_key = office_editor_documents.owner_key
     AND s.document_id = office_editor_documents.id
     AND s.tenant_id = current_setting('office_editor.tenant_id', true)
     AND s.grantee_issuer = current_setting('office_editor.actor_issuer', true)
     AND s.grantee_sub = current_setting('office_editor.actor_sub', true)
     AND s.role IN ('comment', 'edit')
  )
 );

DROP POLICY IF EXISTS office_editor_shared_rev_select ON office_editor_revisions;
CREATE POLICY office_editor_shared_rev_select ON office_editor_revisions
 FOR SELECT
 USING (
  EXISTS (
   SELECT 1 FROM office_editor_shares s
   WHERE s.owner_key = office_editor_revisions.owner_key
     AND s.document_id = office_editor_revisions.document_id
     AND s.tenant_id = current_setting('office_editor.tenant_id', true)
     AND s.grantee_issuer = current_setting('office_editor.actor_issuer', true)
     AND s.grantee_sub = current_setting('office_editor.actor_sub', true)
  )
 );

DROP POLICY IF EXISTS office_editor_shared_rev_insert ON office_editor_revisions;
CREATE POLICY office_editor_shared_rev_insert ON office_editor_revisions
 FOR INSERT
 WITH CHECK (
  EXISTS (
   SELECT 1 FROM office_editor_shares s
   WHERE s.owner_key = office_editor_revisions.owner_key
     AND s.document_id = office_editor_revisions.document_id
     AND s.tenant_id = current_setting('office_editor.tenant_id', true)
     AND s.grantee_issuer = current_setting('office_editor.actor_issuer', true)
     AND s.grantee_sub = current_setting('office_editor.actor_sub', true)
     AND s.role IN ('comment', 'edit')
  )
 );
