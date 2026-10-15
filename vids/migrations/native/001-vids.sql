-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Native final shape of 059, 100 and 101, which the native kernel skips: the job table (user_sub NOT NULL and the (job_id, user_sub) exact-owner key declared on it from the start), its indexes, and the artifact table. The legacy blank-owner backfill and SET NOT NULL, the agents-table bot seed (the native kernel registers vids-operator from this manifest's bots: block), the RLS policies and the pg_roles-guarded GRANT stay PostgreSQL-only. On PostgreSQL every statement here is a no-op after 059-101.

-- 059-vids-platform.sql
CREATE TABLE IF NOT EXISTS vids_jobs (
  job_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID,
  user_sub      VARCHAR(255) NOT NULL,
  client_id     VARCHAR(255),                       -- remote worker that ran it
  status        VARCHAR(20) NOT NULL DEFAULT 'queued', -- queued|running|done|failed
  idea          TEXT NOT NULL,                      -- the operator's raw idea
  final_prompt  TEXT,                               -- bot-optimized Veo prompt
  orientation   VARCHAR(20),
  insert_mode   VARCHAR(20),
  ingredient    TEXT,                               -- optional input asset path/uri
  outcome       JSONB NOT NULL DEFAULT '{}'::jsonb, -- steps, healed selectors, error
  rating        SMALLINT,                           -- operator score (drives learning)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 101's exact-owner key, declared on the table so the artifact foreign key below can name it.
  UNIQUE (job_id, user_sub)
);

CREATE INDEX IF NOT EXISTS idx_vids_jobs_user ON vids_jobs (user_sub);

CREATE INDEX IF NOT EXISTS idx_vids_jobs_status ON vids_jobs (status);

CREATE INDEX IF NOT EXISTS idx_vids_jobs_created ON vids_jobs (created_at DESC);

-- 101-vids-artifact-publication.sql
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
