-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Retain an optional private native Video Studio presenter clip per owner. No external media URL or account-data upload.
ALTER TABLE trading_report_preferences ADD COLUMN IF NOT EXISTS presenter_video_url TEXT;
