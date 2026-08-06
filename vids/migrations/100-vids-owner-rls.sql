-- Vids Studio owner/RLS upgrade for installations that already recorded migration 059.
-- 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com | Make job ownership mandatory and enforce
-- caller/operator FORCE RLS. Legacy null-owner jobs remain visible only to an exact operator.

UPDATE vids_jobs
   SET user_sub = 'system:legacy:vids'
 WHERE user_sub IS NULL OR btrim(user_sub) = '';
ALTER TABLE vids_jobs ALTER COLUMN user_sub SET NOT NULL;

ALTER TABLE vids_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vids_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vids_jobs_owner_policy ON vids_jobs;
CREATE POLICY vids_jobs_owner_policy ON vids_jobs
  USING (
    user_sub = current_setting('oshal.current_sub', true)
    OR current_setting('oshal.is_operator', true) = 'on'
  )
  WITH CHECK (
    user_sub = current_setting('oshal.current_sub', true)
    OR current_setting('oshal.is_operator', true) = 'on'
  );
