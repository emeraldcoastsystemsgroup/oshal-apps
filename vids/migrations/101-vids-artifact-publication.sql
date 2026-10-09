-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Keep finished exports private by default; a revocable publication token grants only a single read, never job or mutation authority.
CREATE UNIQUE INDEX IF NOT EXISTS vids_jobs_exact_owner ON vids_jobs(job_id, user_sub);
CREATE TABLE IF NOT EXISTS vids_artifacts (
  job_id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL UNIQUE,
  owner_sub TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length BIGINT NOT NULL CHECK (byte_length > 0 AND byte_length <= 134217728),
  public_token TEXT UNIQUE CHECK (public_token ~ '^[a-f0-9]{64}$'),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((public_token IS NULL) = (published_at IS NULL)),
  FOREIGN KEY (job_id, owner_sub) REFERENCES vids_jobs(job_id, user_sub) ON DELETE CASCADE
);
ALTER TABLE vids_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vids_artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vids_artifacts_owner ON vids_artifacts;
CREATE POLICY vids_artifacts_owner ON vids_artifacts
  USING (owner_sub = current_setting('oshal.current_sub', true))
  WITH CHECK (owner_sub = current_setting('oshal.current_sub', true));
DROP POLICY IF EXISTS vids_artifacts_public_read ON vids_artifacts;
CREATE POLICY vids_artifacts_public_read ON vids_artifacts FOR SELECT
  USING (public_token = current_setting('oshal.vids_public_token', true) AND published_at IS NOT NULL);
-- Public requests set the token transaction-locally on an explicitly anonymous, non-operator
-- connection. They select only the immutable file identity, digest and length. No job access,
-- public listing, owner impersonation or SECURITY DEFINER/operator bypass is needed.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oshal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON vids_artifacts TO oshal_app;
  END IF;
END $$;
