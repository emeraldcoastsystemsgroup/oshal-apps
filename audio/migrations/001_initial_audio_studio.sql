-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com | Initial PostgreSQL schema for Audio Studio projects, stems, CAS blobs, mixdowns, revisions, and audit log with Forced Row-Level Security.
-- 2   | maintainer@emeraldcoastsystemsgroup.com | Scope audio_blobs primary key to (owner_issuer, owner_sub, sha256) so cross-tenant identical audio uploads deduplicate per owner without RLS collisions.
-- =============================================================================

CREATE TABLE IF NOT EXISTS audio_blobs (
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 104857600),
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 1 CHECK (ref_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_issuer, owner_sub, sha256)
);
CREATE INDEX IF NOT EXISTS idx_audio_blobs_owner_sha ON audio_blobs (owner_issuer, owner_sub, sha256);

CREATE TABLE IF NOT EXISTS audio_projects (
  project_id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  user_sub TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 100000),
  duration_sec DOUBLE PRECISION NOT NULL DEFAULT 8.0 CHECK (duration_sec BETWEEN 0.05 AND 3600.0),
  sample_rate INTEGER NOT NULL DEFAULT 48000 CHECK (sample_rate IN (22050, 24000, 44100, 48000)),
  master_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS idx_audio_projects_owner_updated ON audio_projects (owner_issuer, owner_sub, updated_at DESC, project_id);

CREATE TABLE IF NOT EXISTS audio_revisions (
  project_id TEXT NOT NULL,
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 100000),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  document TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, revision),
  UNIQUE (project_id, revision, owner_issuer, owner_sub),
  FOREIGN KEY (project_id, owner_issuer, owner_sub) REFERENCES audio_projects (project_id, owner_issuer, owner_sub) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audio_stems (
  stem_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  user_sub TEXT NOT NULL,
  blob_sha256 TEXT NOT NULL,
  filename TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'custom',
  duration_sec DOUBLE PRECISION NOT NULL DEFAULT 8.0 CHECK (duration_sec > 0),
  sample_rate INTEGER NOT NULL DEFAULT 48000,
  sample_count BIGINT NOT NULL DEFAULT 0,
  peaks_json TEXT NOT NULL DEFAULT '{}',
  channel_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (project_id, owner_issuer, owner_sub) REFERENCES audio_projects (project_id, owner_issuer, owner_sub) ON DELETE CASCADE,
  FOREIGN KEY (owner_issuer, owner_sub, blob_sha256) REFERENCES audio_blobs (owner_issuer, owner_sub, sha256)
);
CREATE INDEX IF NOT EXISTS idx_audio_stems_proj_owner ON audio_stems (project_id, owner_issuer, owner_sub);

CREATE TABLE IF NOT EXISTS audio_mixdowns (
  mixdown_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  user_sub TEXT NOT NULL,
  blob_sha256 TEXT NOT NULL,
  filename TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'wav',
  duration_sec DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  sample_rate INTEGER NOT NULL DEFAULT 48000,
  target_lufs DOUBLE PRECISION NOT NULL DEFAULT -14.0,
  measured_lufs DOUBLE PRECISION NOT NULL,
  true_peak DOUBLE PRECISION NOT NULL,
  compliance TEXT NOT NULL DEFAULT 'ITU-R BS.1770 PASS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (project_id, owner_issuer, owner_sub) REFERENCES audio_projects (project_id, owner_issuer, owner_sub) ON DELETE CASCADE,
  FOREIGN KEY (owner_issuer, owner_sub, blob_sha256) REFERENCES audio_blobs (owner_issuer, owner_sub, sha256)
);
CREATE INDEX IF NOT EXISTS idx_audio_mixdowns_proj_owner ON audio_mixdowns (project_id, owner_issuer, owner_sub);

CREATE TABLE IF NOT EXISTS audio_audit_log (
  event_id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  user_sub TEXT NOT NULL,
  project_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audio_audit_owner_time ON audio_audit_log (owner_issuer, owner_sub, created_at DESC);

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'audio_blobs',
    'audio_projects',
    'audio_revisions',
    'audio_stems',
    'audio_mixdowns',
    'audio_audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_owner_isolation', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING ('
      || 'owner_issuer = COALESCE(NULLIF(current_setting(''audio.owner_issuer'', true), ''''), '''') '
      || 'AND owner_sub = COALESCE(NULLIF(current_setting(''audio.owner_sub'', true), ''''), '''')'
      || ') WITH CHECK ('
      || 'owner_issuer = COALESCE(NULLIF(current_setting(''audio.owner_issuer'', true), ''''), '''') '
      || 'AND owner_sub = COALESCE(NULLIF(current_setting(''audio.owner_sub'', true), ''''), '''')'
      || ')',
      tbl || '_owner_isolation',
      tbl
    );
  END LOOP;
END $$;
