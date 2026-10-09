-- CHANGE LOG
-- SEQ | AUTHOR | DESCRIPTION
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Export jobs for the manual video editor (CREATE-EDIT-05c): one row per requested render of one saved revision, with the snapshot hash of the document it captured, the process epoch that owns it (a restart exposes unfinished prior-epoch rows as interrupted instead of replaying them), explicit cancellation state and, only on success, the verified output's size, hash, frame count and duration. Private per verified issuer and subject, ENABLEd and FORCEd with the same two-arm exact-owner policy as 068 and no operator arm. No role or grant changes.

CREATE TABLE IF NOT EXISTS video_edit_exports (
  export_id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  owner_issuer TEXT NOT NULL CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 100000),
  variant TEXT NOT NULL CHECK (variant IN ('export', 'preview')),
  profile TEXT NOT NULL CHECK (profile = 'hd720p30'),
  snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  process_epoch UUID NOT NULL,
  total_frames INTEGER NOT NULL CHECK (total_frames BETWEEN 1 AND 1800),
  error TEXT NULL CHECK (error ~ '^[a-z0-9_]{1,80}$'),
  output_bytes BIGINT NULL CHECK (output_bytes BETWEEN 1 AND 268435456),
  output_sha256 TEXT NULL CHECK (output_sha256 ~ '^[0-9a-f]{64}$'),
  output_frames INTEGER NULL CHECK (output_frames BETWEEN 1 AND 1800),
  output_duration_ms INTEGER NULL CHECK (output_duration_ms BETWEEN 1 AND 61000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  -- Only a verified success names an output; a failure or interruption always names why.
  CHECK ((status = 'succeeded') = (output_sha256 IS NOT NULL AND output_bytes IS NOT NULL AND output_frames IS NOT NULL)),
  CHECK (status NOT IN ('failed', 'interrupted') OR error IS NOT NULL),
  UNIQUE (export_id, owner_issuer, owner_sub),
  FOREIGN KEY (project_id, owner_issuer, owner_sub) REFERENCES video_edit_projects (project_id, owner_issuer, owner_sub) ON DELETE CASCADE,
  FOREIGN KEY (project_id, revision, owner_issuer, owner_sub) REFERENCES video_edit_revisions (project_id, revision, owner_issuer, owner_sub) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS video_edit_exports_owner ON video_edit_exports (owner_issuer, owner_sub, status, created_at DESC);
CREATE INDEX IF NOT EXISTS video_edit_exports_project ON video_edit_exports (owner_issuer, owner_sub, project_id, created_at DESC);

-- ENABLE alone exempts the table OWNER, which is the role the api connects as.
ALTER TABLE video_edit_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_edit_exports FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  predicate CONSTANT TEXT := $pred$
       (owner_issuer = current_setting('video.owner_issuer', true)
        AND owner_sub = current_setting('video.owner_sub', true))
    OR (current_setting('oshal.current_sub', true) <> ''
        AND owner_issuer = current_setting('oshal.current_issuer', true)
        AND owner_sub    = current_setting('oshal.current_sub', true))
  $pred$;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.video_edit_exports'::regclass AND polname = 'video_edit_exports_exact_owner') THEN
    EXECUTE format('ALTER POLICY video_edit_exports_exact_owner ON public.video_edit_exports USING (%s) WITH CHECK (%s)', predicate, predicate);
  ELSE
    EXECUTE format('CREATE POLICY video_edit_exports_exact_owner ON public.video_edit_exports AS PERMISSIVE FOR ALL USING (%s) WITH CHECK (%s)', predicate, predicate);
  END IF;
END $$;
