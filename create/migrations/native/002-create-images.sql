-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Commit owned normalized PNG parts and immutable asset metadata in one native caller transaction.
-- Native only: PostgreSQL deployments retain their existing private filesystem.
CREATE TABLE IF NOT EXISTS create_native_images (
  asset_id UUID PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
  byte_length BIGINT NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  parts JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS create_native_image_parts (
  part_id TEXT PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES create_native_images(asset_id),
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  part_index INTEGER NOT NULL CHECK (part_index BETWEEN 0 AND 127),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 65536),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  content_base64 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS create_native_image_parts_asset ON create_native_image_parts(asset_id);
CREATE TRIGGER create_native_image_immutable BEFORE UPDATE ON create_native_images
FOR EACH ROW EXECUTE FUNCTION create_reject_revision_update();
CREATE TRIGGER create_native_image_part_immutable BEFORE UPDATE ON create_native_image_parts
FOR EACH ROW EXECUTE FUNCTION create_reject_revision_update();
