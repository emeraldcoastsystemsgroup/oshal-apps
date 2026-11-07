-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                    | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com   | Shareable read-only 3D viewer links table for native per-person physical scopes (RP-SCN-05).

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
