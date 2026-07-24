-- LoRA Studio (?app=lora) — train & iteratively improve a reusable character LoRA.
-- Controller holds the authoritative metadata (character, each trained version, each version's
-- validation score); the GPU box holds the heavy artifacts (.safetensors, datasets, samples).
-- Tables are ALSO created at runtime by bot-lora-routes.ensureLoraSchema; this migration is the
-- source of truth for prod (schema-bootstrap validate-only does no DDL).

-- One row per character (the locked identity + its training config + which version is active).
CREATE TABLE IF NOT EXISTS oshal_lora_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL UNIQUE,            -- slug / trigger word, e.g. 'oshbrainrot'
  display_name TEXT NOT NULL,
  trigger_word TEXT NOT NULL,
  hero_image TEXT,                         -- locked-hero filename on the box (identity anchor)
  base_model TEXT NOT NULL DEFAULT 'v1-5-pruned-emaonly-fp16.safetensors',
  ident_prompt TEXT,                       -- canonical look description (for gen + judge)
  autonomous BOOLEAN NOT NULL DEFAULT FALSE,
  max_hours NUMERIC(5,2) NOT NULL DEFAULT 9,
  plateau_epsilon NUMERIC(6,4) NOT NULL DEFAULT 0.0050,
  active_version INTEGER,                  -- the kept-best version (null until first train)
  owner_sub TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per trained (or queued/failed) LoRA version of a character.
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

-- One row per validation pass (scored on the FIXED held-out matrix so versions are comparable).
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

-- Seed the existing cyclops so the studio opens on a real character (its dataset is overnight/curated.zip).
INSERT INTO oshal_lora_characters (subject, display_name, trigger_word, hero_image, base_model, ident_prompt)
VALUES (
  'oshbrainrot',
  'Cyclops (oshbrainrot)',
  'oshbrainrot',
  'hero_brainrot_00002_.png',
  'v1-5-pruned-emaonly-fp16.safetensors',
  'a one-eyed leathery orange-red screaming cyclops creature, big single eye, wide toothy mouth, stubby clawed legs, long thin arms, glossy 3d render, italian brainrot meme style'
)
ON CONFLICT (subject) DO NOTHING;
