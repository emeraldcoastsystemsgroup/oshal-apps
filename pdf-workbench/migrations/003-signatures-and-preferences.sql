-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Store reusable caller signatures and non-mutating view preferences under forced two-arm owner row security.
CREATE TABLE IF NOT EXISTS pdf_signatures (
 id UUID PRIMARY KEY, owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL,
 blob_id UUID NOT NULL UNIQUE, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('drawn','image')),
 transparent_bg BOOLEAN NOT NULL DEFAULT true,
 inspection JSONB NOT NULL CHECK(jsonb_typeof(inspection)='object' AND octet_length(inspection::text)<=8192),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,owner_issuer,owner_sub),
 FOREIGN KEY(blob_id,owner_issuer,owner_sub) REFERENCES pdf_blobs(id,owner_issuer,owner_sub)
);
CREATE TABLE IF NOT EXISTS pdf_view_preferences (
 owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL,
 page_layout TEXT NOT NULL DEFAULT 'continuous' CHECK(page_layout IN ('continuous','single','two-page')),
 night_mode BOOLEAN NOT NULL DEFAULT false,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_issuer,owner_sub)
);
CREATE INDEX IF NOT EXISTS pdf_signatures_owner ON pdf_signatures(owner_issuer,owner_sub,created_at DESC);
CREATE TRIGGER pdf_signature_immutable BEFORE UPDATE ON pdf_signatures FOR EACH ROW EXECUTE FUNCTION pdf_immutable();

ALTER TABLE pdf_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_signatures FORCE ROW LEVEL SECURITY;
CREATE POLICY pdf_signatures_own ON pdf_signatures USING(owner_issuer=current_setting('pdf.owner_issuer',true) AND owner_sub=current_setting('pdf.owner_sub',true) AND (owner_issuer||':'||owner_sub)=NULLIF(current_setting('app.current_user_id',true),'')) WITH CHECK(owner_issuer=current_setting('pdf.owner_issuer',true) AND owner_sub=current_setting('pdf.owner_sub',true) AND (owner_issuer||':'||owner_sub)=NULLIF(current_setting('app.current_user_id',true),''));

ALTER TABLE pdf_view_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_view_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY pdf_view_preferences_own ON pdf_view_preferences USING(owner_issuer=current_setting('pdf.owner_issuer',true) AND owner_sub=current_setting('pdf.owner_sub',true) AND (owner_issuer||':'||owner_sub)=NULLIF(current_setting('app.current_user_id',true),'')) WITH CHECK(owner_issuer=current_setting('pdf.owner_issuer',true) AND owner_sub=current_setting('pdf.owner_sub',true) AND (owner_issuer||':'||owner_sub)=NULLIF(current_setting('app.current_user_id',true),''));
