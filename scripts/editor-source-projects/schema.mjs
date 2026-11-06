/** The same constrained DDL is emitted for PostgreSQL and the native SQL executor. */
export function sourceSchema(prefix,{native=false}={}){
 if(!/^[a-z][a-z0-9_]{1,30}$/.test(prefix))throw new Error('invalid prefix');
 const p=prefix;
 let sql=`-- Generated editor-source schema; authoritative generator scripts/editor-source-projects/schema.mjs.\n
CREATE TABLE IF NOT EXISTS ${p}_projects (
 id UUID PRIMARY KEY, owner_key TEXT NOT NULL, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 current_revision INTEGER NOT NULL CHECK(current_revision BETWEEN 1 AND 100),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,owner_key)
);
CREATE TABLE IF NOT EXISTS ${p}_revisions (
 project_id UUID NOT NULL, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100), owner_key TEXT NOT NULL,
 model JSONB NOT NULL CHECK(octet_length(model::text)<=262144), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(project_id,revision), UNIQUE(project_id,revision,owner_key),
 FOREIGN KEY(project_id,owner_key) REFERENCES ${p}_projects(id,owner_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ${p}_assets (
 id UUID PRIMARY KEY, owner_key TEXT NOT NULL, mime TEXT NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp')),
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 4194304), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 metadata JSONB NOT NULL CHECK(octet_length(metadata::text)<=8192),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,owner_key)
);
CREATE TABLE IF NOT EXISTS ${p}_chunks (
 asset_id UUID NOT NULL, owner_key TEXT NOT NULL, byte_offset INTEGER NOT NULL CHECK(byte_offset>=0 AND byte_offset<4194304 AND byte_offset%65536=0),
 data_base64 TEXT NOT NULL CHECK(length(data_base64) BETWEEN 4 AND 87384), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 PRIMARY KEY(asset_id,byte_offset), FOREIGN KEY(asset_id,owner_key) REFERENCES ${p}_assets(id,owner_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ${p}_references (
 project_id UUID NOT NULL, revision INTEGER NOT NULL, asset_id UUID NOT NULL, owner_key TEXT NOT NULL,
 PRIMARY KEY(project_id,revision,asset_id),
 FOREIGN KEY(project_id,revision,owner_key) REFERENCES ${p}_revisions(project_id,revision,owner_key) ON DELETE CASCADE,
 FOREIGN KEY(asset_id,owner_key) REFERENCES ${p}_assets(id,owner_key)
);
CREATE TABLE IF NOT EXISTS ${p}_requests (
 owner_key TEXT NOT NULL, request_key UUID NOT NULL, fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64), resource_id UUID NOT NULL,
 result JSONB NOT NULL CHECK(octet_length(result::text)<=16384), tombstone BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(owner_key,request_key)
);
CREATE INDEX IF NOT EXISTS ${p}_projects_owner_idx ON ${p}_projects(owner_key);
CREATE INDEX IF NOT EXISTS ${p}_revisions_owner_idx ON ${p}_revisions(owner_key);
CREATE INDEX IF NOT EXISTS ${p}_assets_owner_idx ON ${p}_assets(owner_key);
CREATE INDEX IF NOT EXISTS ${p}_chunks_owner_idx ON ${p}_chunks(owner_key);
CREATE INDEX IF NOT EXISTS ${p}_references_owner_idx ON ${p}_references(owner_key);
CREATE INDEX IF NOT EXISTS ${p}_requests_resource_idx ON ${p}_requests(owner_key,resource_id);
CREATE OR REPLACE FUNCTION ${p}_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'source rows are immutable'; END $$;
`;
 for(const table of ['revisions','assets','chunks','references'])sql+=`DROP TRIGGER IF EXISTS ${p}_${table}_immutable ON ${p}_${table};\nCREATE TRIGGER ${p}_${table}_immutable BEFORE UPDATE ON ${p}_${table} FOR EACH ROW EXECUTE FUNCTION ${p}_immutable();\n`;
 if(!native)for(const table of ['projects','revisions','assets','chunks','references','requests'])sql+=`ALTER TABLE ${p}_${table} ENABLE ROW LEVEL SECURITY;\nALTER TABLE ${p}_${table} FORCE ROW LEVEL SECURITY;\nDROP POLICY IF EXISTS ${p}_owner ON ${p}_${table};\nCREATE POLICY ${p}_owner ON ${p}_${table} USING(owner_key=current_setting('${p}.owner_key',true)) WITH CHECK(owner_key=current_setting('${p}.owner_key',true));\n`;
 return sql;
}
