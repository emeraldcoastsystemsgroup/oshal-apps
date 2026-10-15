-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Immutable exact-owner source lineage for verified Motion render caches; graphs stay editable at their native Motion revision.
CREATE TABLE IF NOT EXISTS video_edit_motion_sources (
  asset_id UUID PRIMARY KEY,
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  request_key UUID NOT NULL,
  source JSONB NOT NULL CHECK (jsonb_typeof(source)='object' AND octet_length(source::text)<=4096),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_issuer,owner_sub,request_key),
  FOREIGN KEY(asset_id,owner_issuer,owner_sub) REFERENCES video_edit_assets(asset_id,owner_issuer,owner_sub) ON DELETE CASCADE
);
ALTER TABLE video_edit_motion_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_edit_motion_sources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS video_edit_motion_sources_exact_owner ON video_edit_motion_sources;
CREATE POLICY video_edit_motion_sources_exact_owner ON video_edit_motion_sources FOR ALL
USING ((owner_issuer=current_setting('video.owner_issuer',true) AND owner_sub=current_setting('video.owner_sub',true))
 OR (current_setting('oshal.current_sub',true)<>'' AND owner_issuer=current_setting('oshal.current_issuer',true) AND owner_sub=current_setting('oshal.current_sub',true)))
WITH CHECK ((owner_issuer=current_setting('video.owner_issuer',true) AND owner_sub=current_setting('video.owner_sub',true))
 OR (current_setting('oshal.current_sub',true)<>'' AND owner_issuer=current_setting('oshal.current_issuer',true) AND owner_sub=current_setting('oshal.current_sub',true)));
DROP TRIGGER IF EXISTS video_edit_motion_source_immutable ON video_edit_motion_sources;
CREATE TRIGGER video_edit_motion_source_immutable BEFORE UPDATE ON video_edit_motion_sources
FOR EACH ROW EXECUTE FUNCTION video_edit_reject_update();
