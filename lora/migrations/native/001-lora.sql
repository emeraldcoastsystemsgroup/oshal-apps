-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Native final shape of 058 and 100-106, which the native kernel skips: every LoRA table and index, with 102's identity columns, 106's issuer columns and 101's model foreign key folded into their CREATE TABLE. The legacy blank-owner backfill, the system:seed:lora sample character and its 102 identity backfill (a shared seed owner is not a person, so no native scope can hold it), the comments and every RLS policy stay PostgreSQL-only; the native per-person scope and its owner-field check keep each person's characters their own. On PostgreSQL every statement here is a no-op after 058-106.

-- 058-lora-studio.sql
CREATE TABLE IF NOT EXISTS oshal_lora_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,                   -- slug / trigger word, e.g. 'oshbrainrot'
  display_name TEXT NOT NULL,
  trigger_word TEXT NOT NULL,
  hero_image TEXT,                         -- locked-hero filename on the box (identity anchor)
  base_model TEXT NOT NULL DEFAULT 'v1-5-pruned-emaonly-fp16.safetensors',
  ident_prompt TEXT,                       -- canonical look description (for gen + judge)
  autonomous BOOLEAN NOT NULL DEFAULT FALSE,
  max_hours NUMERIC(5,2) NOT NULL DEFAULT 9,
  plateau_epsilon NUMERIC(6,4) NOT NULL DEFAULT 0.0050,
  active_version INTEGER,                  -- the kept-best version (null until first train)
  owner_sub TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  negative_prompt TEXT,
  identity_structure TEXT,
  identity_violation TEXT,
  autonomous_issuer TEXT CHECK (autonomous_issuer IS NULL OR length(autonomous_issuer) BETWEEN 1 AND 2048),
  UNIQUE (owner_sub, subject)
);

CREATE TABLE IF NOT EXISTS oshal_lora_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|training|trained|scored|failed
  lora_path TEXT,                          -- path on the box (and copied into ComfyUI models/loras)
  base_model TEXT,
  dataset_count INTEGER,
  network_dim INTEGER,
  epochs INTEGER,
  steps INTEGER,
  final_loss NUMERIC(10,5),
  duration_sec INTEGER,
  parent_version INTEGER,                  -- the version this was improved from (null for v1)
  ticket_id TEXT,                          -- the queue-manager ticket that authorized training
  metrics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (character_id, version)
);

CREATE INDEX IF NOT EXISTS idx_lora_models_char ON oshal_lora_models(character_id, version DESC);

CREATE TABLE IF NOT EXISTS oshal_lora_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  overall NUMERIC(6,4),                    -- mean per-cell score, 0..1
  identity_mean NUMERIC(6,4),
  quality_mean NUMERIC(6,4),
  min_cell NUMERIC(6,4),
  cells JSONB,                             -- [{cell, identity, quality, score, image}]
  weak_cells JSONB,                        -- [{axis, value, mean}] the targeted-improve loop reads
  gallery_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (character_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lora_characters_owner_subject
  ON oshal_lora_characters (owner_sub, subject);

-- 101-lora-cell-images.sql
CREATE TABLE IF NOT EXISTS oshal_lora_cell_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  cell_index INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  image BYTEA NOT NULL,
  source_filename TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (character_id, version, cell_index),
  CONSTRAINT lora_cell_images_model_fk FOREIGN KEY (character_id, version)
    REFERENCES oshal_lora_models(character_id, version) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lora_cell_images_run
  ON oshal_lora_cell_images (character_id, version);

CREATE INDEX IF NOT EXISTS idx_lora_cell_images_expiry
  ON oshal_lora_cell_images (expires_at);

-- 103-lora-dataset-images.sql
CREATE TABLE IF NOT EXISTS oshal_lora_dataset_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  source_name TEXT,
  caption TEXT NOT NULL,
  byte_size INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ,
  UNIQUE (character_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_lora_dataset_images_character
  ON oshal_lora_dataset_images(character_id, created_at DESC);

-- 104-lora-dataset-staging.sql
CREATE TABLE IF NOT EXISTS oshal_lora_dataset_staging (
  image_id UUID PRIMARY KEY REFERENCES oshal_lora_dataset_images(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  sha256 TEXT NOT NULL,
  image BYTEA NOT NULL CHECK (octet_length(image) = byte_size),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lora_dataset_staging_expiry
  ON oshal_lora_dataset_staging (expires_at);

-- 105-lora-callback-grants.sql
CREATE TABLE IF NOT EXISTS oshal_lora_callback_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,
  owner_sub TEXT NOT NULL,
  ticket_id TEXT,
  dispatch_kind TEXT NOT NULL CHECK (dispatch_kind IN ('train', 'validate', 'improve', 'overnight', 'dataset-import')),
  callback_kinds TEXT[] NOT NULL CHECK (cardinality(callback_kinds) > 0),
  signing_key TEXT NOT NULL CHECK (signing_key ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owner_issuer TEXT CHECK (owner_issuer IS NULL OR length(owner_issuer) BETWEEN 1 AND 2048),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_lora_callback_grants_character
  ON oshal_lora_callback_grants (character_id, expires_at);

CREATE TABLE IF NOT EXISTS oshal_lora_callback_nonces (
  grant_id UUID NOT NULL REFERENCES oshal_lora_callback_grants(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{16,64}$'),
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (grant_id, nonce)
);
