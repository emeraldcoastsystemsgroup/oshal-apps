-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | RP-MOT-01: native video and audio clip metadata and immutable revision references; PostgreSQL applies forced-RLS policies in 002-motion-media-assets.sql.
CREATE TABLE IF NOT EXISTS motion_media_assets (
  asset_id UUID PRIMARY KEY,
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  media_kind TEXT NOT NULL CHECK (media_kind IN ('video','audio')),
  media_type TEXT NOT NULL CHECK (media_type IN (
    'video/mp4','video/quicktime','video/webm',
    'audio/wav','audio/mpeg','audio/mp4','audio/ogg','audio/flac','audio/aiff'
  )),
  width INTEGER NOT NULL CHECK (width BETWEEN 0 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 0 AND 8192),
  duration_ticks BIGINT NOT NULL CHECK (duration_ticks > 0),
  fps_num INTEGER NOT NULL CHECK (fps_num >= 0),
  fps_den INTEGER NOT NULL CHECK (fps_den > 0),
  has_video BOOLEAN NOT NULL,
  has_audio BOOLEAN NOT NULL,
  audio_sample_rate INTEGER NOT NULL CHECK (audio_sample_rate >= 0),
  audio_channels INTEGER NOT NULL CHECK (audio_channels BETWEEN 0 AND 16),
  codec TEXT NOT NULL CHECK (length(codec) BETWEEN 1 AND 128),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 67108864),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  blob_handle UUID UNIQUE,
  content_base64 TEXT CHECK (length(content_base64) BETWEEN 4 AND 89478488),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((content_base64 IS NULL) <> (blob_handle IS NULL)),
  CHECK ((media_kind = 'audio' AND width = 0 AND height = 0) OR (media_kind = 'video' AND width BETWEEN 1 AND 8192 AND height BETWEEN 1 AND 8192 AND fps_num > 0)),
  CHECK (width::bigint * height <= 33554432),
  UNIQUE (asset_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS motion_media_assets_owner ON motion_media_assets (owner_issuer, owner_sub);
CREATE TABLE IF NOT EXISTS motion_revision_media_assets (
  project_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  asset_id UUID NOT NULL,
  PRIMARY KEY (project_id, revision, asset_id),
  FOREIGN KEY (project_id, revision, owner_issuer, owner_sub) REFERENCES motion_revisions (project_id, revision, owner_issuer, owner_sub) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, owner_issuer, owner_sub) REFERENCES motion_media_assets (asset_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS motion_revision_media_assets_asset ON motion_revision_media_assets (owner_issuer, owner_sub, asset_id);
DROP TRIGGER IF EXISTS motion_media_asset_immutable ON motion_media_assets;
CREATE TRIGGER motion_media_asset_immutable BEFORE UPDATE ON motion_media_assets FOR EACH ROW EXECUTE FUNCTION motion_immutable();
