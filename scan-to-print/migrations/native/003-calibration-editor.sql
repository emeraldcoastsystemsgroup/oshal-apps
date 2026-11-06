-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Append original-person calibration provenance in native physical scopes without altering any installed migration.
CREATE TABLE IF NOT EXISTS scan_print_job_editor (job_id UUID PRIMARY KEY REFERENCES scan_print_job(job_id) ON DELETE CASCADE, owner_key TEXT NOT NULL);
