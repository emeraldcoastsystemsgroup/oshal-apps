-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Native scoped-document tables and constraints for OSHAL Phone & Device Control (phone-control); PostgreSQL retains the separate forced-RLS migration.

CREATE TABLE IF NOT EXISTS phone_control_blobs (
  sha256 TEXT PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL DEFAULT 'system' CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 104857600),
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 1 CHECK (ref_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_control_blobs_owner_sha ON phone_control_blobs (owner_issuer, owner_sub, sha256);

CREATE TABLE IF NOT EXISTS phone_control_devices (
  device_id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  user_sub TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  platform TEXT NOT NULL DEFAULT 'ios' CHECK (platform IN ('ios', 'android', 'linux', 'windows', 'macos')),
  connection_mode TEXT NOT NULL DEFAULT 'ble-airplay' CHECK (connection_mode IN ('ble-airplay', 'adb-wireless', 'adb-usb', 'android-companion', 'orbit-computer')),
  connected INTEGER NOT NULL DEFAULT 1,
  control_enabled INTEGER NOT NULL DEFAULT 1,
  mirroring_active INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 100000),
  screen_width INTEGER NOT NULL DEFAULT 1179,
  screen_height INTEGER NOT NULL DEFAULT 2556,
  config_json TEXT NOT NULL DEFAULT '{}',
  screen_state_json TEXT NOT NULL DEFAULT '{}',
  latest_frame_sha256 TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, owner_issuer, owner_sub)
);
CREATE INDEX IF NOT EXISTS idx_phone_control_devices_owner_updated ON phone_control_devices (owner_issuer, owner_sub, updated_at DESC, device_id);

CREATE TABLE IF NOT EXISTS phone_control_revisions (
  device_id TEXT NOT NULL,
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local',
  owner_sub TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 100000),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  document JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, revision),
  UNIQUE (device_id, revision, owner_issuer, owner_sub),
  FOREIGN KEY (device_id, owner_issuer, owner_sub) REFERENCES phone_control_devices (device_id, owner_issuer, owner_sub) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS phone_control_frames (
  frame_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES phone_control_devices(device_id) ON DELETE CASCADE,
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  user_sub TEXT NOT NULL,
  blob_sha256 TEXT NOT NULL REFERENCES phone_control_blobs(sha256),
  width INTEGER NOT NULL DEFAULT 1179,
  height INTEGER NOT NULL DEFAULT 2556,
  active_app TEXT NOT NULL DEFAULT 'Home Screen',
  ocr_elements_json TEXT NOT NULL DEFAULT '[]',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_control_frames_dev_owner ON phone_control_frames (device_id, owner_issuer, owner_sub, captured_at DESC);

CREATE TABLE IF NOT EXISTS phone_control_commands (
  command_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES phone_control_devices(device_id) ON DELETE CASCADE,
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  user_sub TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  arguments_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'completed',
  output_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_control_commands_dev_owner ON phone_control_commands (device_id, owner_issuer, owner_sub, created_at DESC);

CREATE TABLE IF NOT EXISTS phone_control_audit_log (
  event_id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL DEFAULT 'https://oshal.local' CHECK (length(owner_issuer) BETWEEN 1 AND 2048),
  owner_sub TEXT NOT NULL CHECK (length(owner_sub) BETWEEN 1 AND 2048),
  user_sub TEXT NOT NULL,
  device_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_control_audit_owner_time ON phone_control_audit_log (owner_issuer, owner_sub, created_at DESC);
