-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Store owned image bytes once; immutable revisions retain asset references.
CREATE TABLE IF NOT EXISTS pdf_image_assets (
 id UUID PRIMARY KEY, owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL,
 blob_id UUID NOT NULL UNIQUE, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 inspection JSONB NOT NULL CHECK(jsonb_typeof(inspection)='object' AND octet_length(inspection::text)<=8192),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(id,owner_issuer,owner_sub),
 FOREIGN KEY(blob_id,owner_issuer,owner_sub) REFERENCES pdf_blobs(id,owner_issuer,owner_sub)
);
CREATE TABLE IF NOT EXISTS pdf_revision_images (
 document_id UUID NOT NULL, revision INTEGER NOT NULL, asset_id UUID NOT NULL,
 owner_issuer TEXT NOT NULL, owner_sub TEXT NOT NULL,
 PRIMARY KEY(document_id,revision,asset_id),
 FOREIGN KEY(document_id,revision,owner_issuer,owner_sub) REFERENCES pdf_revisions(document_id,revision,owner_issuer,owner_sub) ON DELETE CASCADE,
 FOREIGN KEY(asset_id,owner_issuer,owner_sub) REFERENCES pdf_image_assets(id,owner_issuer,owner_sub)
);
CREATE INDEX IF NOT EXISTS pdf_images_owner ON pdf_image_assets(owner_issuer,owner_sub,created_at);
CREATE TRIGGER pdf_image_asset_immutable BEFORE UPDATE ON pdf_image_assets FOR EACH ROW EXECUTE FUNCTION pdf_immutable();
CREATE TRIGGER pdf_revision_image_immutable BEFORE UPDATE ON pdf_revision_images FOR EACH ROW EXECUTE FUNCTION pdf_immutable();
