-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve bounded immutable PSD originals, findings and sealed import lineage with exact-owner row policies for PostgreSQL.
CREATE TABLE IF NOT EXISTS create_psd_sources (
  project_id UUID PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  request_key UUID NOT NULL,
  request_digest TEXT NOT NULL CHECK (length(request_digest)=64),
  sha256 TEXT NOT NULL CHECK (length(sha256)=64),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 4194304),
  import_mode TEXT NOT NULL CHECK (import_mode IN ('editable','flattened')),
  report JSONB NOT NULL CHECK (jsonb_typeof(report)='array' AND octet_length(report::text)<=32768),
  UNIQUE (project_id,owner_issuer,owner_sub),
  UNIQUE (owner_issuer,owner_sub,request_key),
  FOREIGN KEY (project_id,owner_issuer,owner_sub) REFERENCES create_projects(project_id,owner_issuer,owner_sub) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS create_psd_source_parts (
  project_id UUID NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  part_index INTEGER NOT NULL CHECK (part_index BETWEEN 0 AND 63),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 65536),
  sha256 TEXT NOT NULL CHECK (length(sha256)=64),
  content_base64 TEXT NOT NULL CHECK (length(content_base64)<=87384),
  PRIMARY KEY (project_id,part_index),
  FOREIGN KEY (project_id,owner_issuer,owner_sub) REFERENCES create_psd_sources(project_id,owner_issuer,owner_sub) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS create_psd_sources_owner ON create_psd_sources(owner_issuer,owner_sub);
DROP TRIGGER IF EXISTS create_psd_source_immutable ON create_psd_sources;
CREATE TRIGGER create_psd_source_immutable BEFORE UPDATE ON create_psd_sources FOR EACH ROW EXECUTE FUNCTION create_reject_revision_update();
DROP TRIGGER IF EXISTS create_psd_part_immutable ON create_psd_source_parts;
CREATE TRIGGER create_psd_part_immutable BEFORE UPDATE ON create_psd_source_parts FOR EACH ROW EXECUTE FUNCTION create_reject_revision_update();

DO $$
DECLARE
  table_name TEXT;
  predicate CONSTANT TEXT := $pred$
    (owner_issuer=current_setting('create.owner_issuer',true) AND owner_sub=current_setting('create.owner_sub',true))
    OR (current_setting('oshal.current_sub',true)<>'' AND owner_issuer=current_setting('oshal.current_issuer',true) AND owner_sub=current_setting('oshal.current_sub',true))
  $pred$;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['create_psd_sources','create_psd_source_parts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=table_name::regclass AND polname=table_name||'_exact_owner') THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (%s) WITH CHECK (%s)',table_name||'_exact_owner',table_name,predicate,predicate);
    END IF;
  END LOOP;
END $$;
