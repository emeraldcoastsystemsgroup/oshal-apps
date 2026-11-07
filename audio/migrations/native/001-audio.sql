-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                  | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com | Native SQLite schema for Audio Studio per-person database.
-- 2   | maintainer@emeraldcoastsystemsgroup.com | Scope audio_blobs primary key to (owner_issuer, owner_sub, sha256) and track mixdown format, sample rate, and duration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS audio_blobs (
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 104857600),
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 1 CHECK (ref_count >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
  duration_sec REAL NOT NULL DEFAULT 8.0 CHECK (duration_sec BETWEEN 0.05 AND 3600.0),
  sample_rate INTEGER NOT NULL DEFAULT 48000,
  master_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS idx_audio_projects_owner_updated ON audio_projects (owner_issuer, owner_sub, updated_at DESC, project_id);

CREATE TABLE IF NOT EXISTS audio_revisions (
  project_id TEXT NOT NULL,
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local',
  owner_sub TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 100000),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  document TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
  duration_sec REAL NOT NULL DEFAULT 8.0,
  sample_rate INTEGER NOT NULL DEFAULT 48000,
  sample_count INTEGER NOT NULL DEFAULT 0,
  peaks_json TEXT NOT NULL DEFAULT '{}',
  channel_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
  duration_sec REAL NOT NULL DEFAULT 0.0,
  sample_rate INTEGER NOT NULL DEFAULT 48000,
  target_lufs REAL NOT NULL DEFAULT -14.0,
  measured_lufs REAL NOT NULL,
  true_peak REAL NOT NULL,
  compliance TEXT NOT NULL DEFAULT 'ITU-R BS.1770 PASS',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audio_audit_owner_time ON audio_audit_log (owner_issuer, owner_sub, created_at DESC);
