-- CHANGE LOG
-- SEQ | AUTHOR | DESCRIPTION
-- 1 | maintainer@emeraldcoastsystemsgroup.com | The manual video editor's own persistence (CREATE-EDIT-05b): private issuer-qualified projects, immutable validated timeline revisions, immutable uploaded media metadata and the owner-qualified references that keep a revision's media alive. Every table carries its own owner_issuer/owner_sub pair, is ENABLEd and FORCEd (the api owns these tables and is the role that reads them, so ENABLE alone would exempt it), and has one exact-owner policy with two arms - this package's transaction-local video.owner_* stamp, and the platform oshal.current_* stamp core's catalog-driven /api/me export and delete arrive with - and no operator arm. Existing generation tables (videos, video_series, video_episodes) are not touched. No role or grant changes.

CREATE TABLE IF NOT EXISTS video_edit_projects (
  project_id UUID PRIMARY KEY,
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision BETWEEN 1 AND 100000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS video_edit_projects_owner_updated ON video_edit_projects (owner_issuer, owner_sub, updated_at DESC, project_id);

CREATE TABLE IF NOT EXISTS video_edit_revisions (
  project_id UUID NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 100000),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  profile TEXT NOT NULL CHECK (profile = 'hd720p30'),
  document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 524288),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, revision),
  UNIQUE (project_id, revision, owner_issuer, owner_sub),
  FOREIGN KEY (project_id, owner_issuer, owner_sub) REFERENCES video_edit_projects (project_id, owner_issuer, owner_sub) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_edit_assets (
  asset_id UUID PRIMARY KEY,
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  kind TEXT NOT NULL CHECK (kind IN ('video', 'audio')),
  byte_length BIGINT NOT NULL CHECK (byte_length BETWEEN 1 AND 104857600),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  container TEXT NOT NULL CHECK (container IN ('mp4', 'wav')),
  video_codec TEXT NULL CHECK (video_codec IS NULL OR video_codec = 'h264'),
  audio_codec TEXT NULL CHECK (audio_codec IS NULL OR audio_codec ~ '^(aac|pcm_(s16le|s24le|s32le|f32le))$'),
  width INTEGER NULL CHECK (width BETWEEN 2 AND 1920),
  height INTEGER NULL CHECK (height BETWEEN 2 AND 1920),
  frames INTEGER NOT NULL CHECK (frames BETWEEN 1 AND 1800),
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 1 AND 60000),
  has_audio BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A clip is H.264 in MP4 with its measured size and at most 30 s; a bed is PCM in WAV with sound and at most 60 s.
  CHECK ((kind = 'video' AND container = 'mp4' AND video_codec = 'h264' AND width IS NOT NULL AND height IS NOT NULL
          AND width::bigint * height <= 2073600 AND frames <= 900 AND (has_audio = (audio_codec IS NOT NULL)) AND (audio_codec IS NULL OR audio_codec = 'aac'))
      OR (kind = 'audio' AND container = 'wav' AND video_codec IS NULL AND width IS NULL AND height IS NULL
          AND has_audio AND audio_codec LIKE 'pcm_%' AND byte_length <= 33554432)),
  UNIQUE (asset_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS video_edit_assets_owner ON video_edit_assets (owner_issuer, owner_sub, created_at);

CREATE TABLE IF NOT EXISTS video_edit_revision_assets (
  project_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  asset_id UUID NOT NULL,
  PRIMARY KEY (project_id, revision, asset_id),
  FOREIGN KEY (project_id, revision, owner_issuer, owner_sub) REFERENCES video_edit_revisions (project_id, revision, owner_issuer, owner_sub) ON DELETE CASCADE,
  -- No cascade: an asset a retained revision uses cannot be deleted out from under it.
  FOREIGN KEY (asset_id, owner_issuer, owner_sub) REFERENCES video_edit_assets (asset_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS video_edit_revision_assets_asset ON video_edit_revision_assets (owner_issuer, owner_sub, asset_id);

-- ENABLE alone exempts the table OWNER, which is the role the api connects as; FORCE makes the
-- policy below run for it. Written out per table so the store's forced-RLS gate reads each one.
ALTER TABLE video_edit_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_edit_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE video_edit_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_edit_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE video_edit_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_edit_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE video_edit_revision_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_edit_revision_assets FORCE ROW LEVEL SECURITY;

-- Identity is installed transaction-locally by the package from the verified framework actor, or
-- session-scoped by the platform GUC pool when core reaches these tables for the same person
-- (/api/me export and delete). Empty/unset context denies every row. Operator status does not
-- bypass ownership: oshal.is_operator is never consulted, and system work stamps both platform
-- settings empty, which the <> '' guard rejects.
DO $$
DECLARE
  target TEXT;
  predicate CONSTANT TEXT := $pred$
       (owner_issuer = current_setting('video.owner_issuer', true)
        AND owner_sub = current_setting('video.owner_sub', true))
    OR (current_setting('oshal.current_sub', true) <> ''
        AND owner_issuer = current_setting('oshal.current_issuer', true)
        AND owner_sub    = current_setting('oshal.current_sub', true))
  $pred$;
BEGIN
  FOREACH target IN ARRAY ARRAY['video_edit_projects', 'video_edit_revisions', 'video_edit_assets', 'video_edit_revision_assets'] LOOP
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = ('public.' || target)::regclass AND polname = target || '_exact_owner') THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', target || '_exact_owner', target, predicate, predicate);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL USING (%s) WITH CHECK (%s)', target || '_exact_owner', target, predicate, predicate);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION video_edit_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Video editor revisions and media are immutable';
END $$;
DROP TRIGGER IF EXISTS video_edit_revision_immutable ON video_edit_revisions;
CREATE TRIGGER video_edit_revision_immutable BEFORE UPDATE ON video_edit_revisions
FOR EACH ROW EXECUTE FUNCTION video_edit_reject_update();
DROP TRIGGER IF EXISTS video_edit_asset_immutable ON video_edit_assets;
CREATE TRIGGER video_edit_asset_immutable BEFORE UPDATE ON video_edit_assets
FOR EACH ROW EXECUTE FUNCTION video_edit_reject_update();
