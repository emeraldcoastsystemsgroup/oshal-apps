-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Bind only newly created calibration jobs to their verified original person; never self-claim ambiguous legacy rows.
CREATE TABLE IF NOT EXISTS scan_print_job_editor (job_id UUID PRIMARY KEY REFERENCES scan_print_job(job_id) ON DELETE CASCADE, owner_key TEXT NOT NULL);
ALTER TABLE scan_print_job_editor ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_print_job_editor FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scan_print_job_editor_read ON scan_print_job_editor;
CREATE POLICY scan_print_job_editor_read ON scan_print_job_editor FOR SELECT USING (EXISTS (SELECT 1 FROM scan_print_job j WHERE j.job_id=scan_print_job_editor.job_id AND j.owner_sub=current_setting('oshal.current_sub',true)));
DROP POLICY IF EXISTS scan_print_job_editor_write ON scan_print_job_editor;
CREATE POLICY scan_print_job_editor_write ON scan_print_job_editor FOR ALL USING (owner_key=current_setting('scan_editor.owner_key',true)) WITH CHECK (owner_key=current_setting('scan_editor.owner_key',true) AND EXISTS (SELECT 1 FROM scan_print_job j WHERE j.job_id=scan_print_job_editor.job_id AND j.owner_sub=current_setting('oshal.current_sub',true)));
