-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                    | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com   | Shareable read-only 3D viewer links (RP-SCN-05) with forced two-arm row-level security (owner management + active token read) and instant revocation.

CREATE TABLE IF NOT EXISTS scan_print_share_link (
  share_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID        NOT NULL REFERENCES scan_print_job (job_id) ON DELETE CASCADE,
  owner_sub    TEXT        NOT NULL,
  share_token  TEXT        NOT NULL UNIQUE,
  label        TEXT        NOT NULL DEFAULT '',
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_print_share_link_job
  ON scan_print_share_link (owner_sub, job_id, created_at DESC);

ALTER TABLE scan_print_share_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_print_share_link FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scan_print_share_link_owner ON scan_print_share_link;
CREATE POLICY scan_print_share_link_owner ON scan_print_share_link
  AS PERMISSIVE FOR ALL
  USING (
    owner_sub = current_setting('oshal.current_sub', true)
    OR current_setting('oshal.is_operator', true) = 'on'
  )
  WITH CHECK (
    owner_sub = current_setting('oshal.current_sub', true)
    OR current_setting('oshal.is_operator', true) = 'on'
  );

DROP POLICY IF EXISTS scan_print_share_link_token_read ON scan_print_share_link;
CREATE POLICY scan_print_share_link_token_read ON scan_print_share_link
  AS PERMISSIVE FOR SELECT
  USING (
    share_token = current_setting('scan_share.token', true)
  );

DROP POLICY IF EXISTS scan_print_job_shared_read ON scan_print_job;
CREATE POLICY scan_print_job_shared_read ON scan_print_job
  AS PERMISSIVE FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM scan_print_share_link s
      WHERE s.job_id = scan_print_job.job_id
        AND s.revoked_at IS NULL
        AND s.share_token = current_setting('scan_share.token', true)
    )
  );
