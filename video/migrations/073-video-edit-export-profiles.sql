-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Allow 720p, 1080p and 4K export profiles at 30 or 60 fps (up to 3600 frames and 512 MiB) on video_edit_revisions and video_edit_exports.
ALTER TABLE video_edit_revisions DROP CONSTRAINT IF EXISTS video_edit_revisions_profile_check;
ALTER TABLE video_edit_revisions ADD CONSTRAINT video_edit_revisions_profile_check
  CHECK (profile IN ('hd720p30', 'hd720p60', 'hd1080p30', 'hd1080p60', 'uhd4k30', 'uhd4k60'));
ALTER TABLE video_edit_exports DROP CONSTRAINT IF EXISTS video_edit_exports_profile_check;
ALTER TABLE video_edit_exports ADD CONSTRAINT video_edit_exports_profile_check
  CHECK (profile IN ('hd720p30', 'hd720p60', 'hd1080p30', 'hd1080p60', 'uhd4k30', 'uhd4k60'));
ALTER TABLE video_edit_exports DROP CONSTRAINT IF EXISTS video_edit_exports_total_frames_check;
ALTER TABLE video_edit_exports ADD CONSTRAINT video_edit_exports_total_frames_check
  CHECK (total_frames BETWEEN 1 AND 3600);
ALTER TABLE video_edit_exports DROP CONSTRAINT IF EXISTS video_edit_exports_output_frames_check;
ALTER TABLE video_edit_exports ADD CONSTRAINT video_edit_exports_output_frames_check
  CHECK (output_frames IS NULL OR output_frames BETWEEN 1 AND 3600);
ALTER TABLE video_edit_exports DROP CONSTRAINT IF EXISTS video_edit_exports_output_bytes_check;
ALTER TABLE video_edit_exports ADD CONSTRAINT video_edit_exports_output_bytes_check
  CHECK (output_bytes IS NULL OR output_bytes BETWEEN 1 AND 536870912);
