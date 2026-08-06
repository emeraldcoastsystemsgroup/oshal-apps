-- LoRA Studio (?app=lora) — train & iteratively improve a reusable character LoRA.
-- Controller holds the authoritative metadata (character, each trained version, each version's
-- validation score); the GPU box holds the heavy artifacts (.safetensors, datasets, samples).
-- Tables are ALSO created at runtime by bot-lora-routes.ensureLoraSchema; this migration is the
-- source of truth for prod (schema-bootstrap validate-only does no DDL).
-- 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com | Make character ownership mandatory,
-- permit the same subject independently per owner, and enforce owner/operator FORCE RLS on all
-- character, model, and score rows. Legacy null-owner data remains operator-only.

-- One row per character (the locked identity + its training config + which version is active).
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
  UNIQUE (owner_sub, subject)
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

-- Upgrade pre-owner installations without guessing a human owner. The starter template is cloned
-- into each caller's own scope by the route on first use.
ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS owner_sub TEXT;
UPDATE oshal_lora_characters
   SET owner_sub = 'system:legacy:lora'
 WHERE owner_sub IS NULL OR btrim(owner_sub) = '';
ALTER TABLE oshal_lora_characters ALTER COLUMN owner_sub SET NOT NULL;
ALTER TABLE oshal_lora_characters DROP CONSTRAINT IF EXISTS oshal_lora_characters_subject_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lora_characters_owner_subject
  ON oshal_lora_characters (owner_sub, subject);

-- Seed the existing cyclops so the studio opens on a real character (its dataset is overnight/curated.zip).
INSERT INTO oshal_lora_characters
  (subject, display_name, trigger_word, hero_image, base_model, ident_prompt, owner_sub)
VALUES (
  'oshbrainrot',
  'Cyclops (oshbrainrot)',
  'oshbrainrot',
  'hero_brainrot_00002_.png',
  'v1-5-pruned-emaonly-fp16.safetensors',
  'a one-eyed leathery orange-red screaming cyclops creature, big single eye, wide toothy mouth, stubby clawed legs, long thin arms, glossy 3d render, italian brainrot meme style',
  'system:seed:lora'
)
ON CONFLICT (owner_sub, subject) DO NOTHING;

ALTER TABLE oshal_lora_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_lora_characters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oshal_lora_characters_owner_policy ON oshal_lora_characters;
CREATE POLICY oshal_lora_characters_owner_policy ON oshal_lora_characters
  USING (
    owner_sub = current_setting('oshal.current_sub', true)
    OR current_setting('oshal.is_operator', true) = 'on'
  )
  WITH CHECK (
    owner_sub = current_setting('oshal.current_sub', true)
    OR current_setting('oshal.is_operator', true) = 'on'
  );

ALTER TABLE oshal_lora_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_lora_models FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oshal_lora_models_owner_policy ON oshal_lora_models;
CREATE POLICY oshal_lora_models_owner_policy ON oshal_lora_models
  USING (EXISTS (
    SELECT 1 FROM oshal_lora_characters c
     WHERE c.id = oshal_lora_models.character_id
       AND (
         c.owner_sub = current_setting('oshal.current_sub', true)
         OR current_setting('oshal.is_operator', true) = 'on'
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM oshal_lora_characters c
     WHERE c.id = oshal_lora_models.character_id
       AND (
         c.owner_sub = current_setting('oshal.current_sub', true)
         OR current_setting('oshal.is_operator', true) = 'on'
       )
  ));

ALTER TABLE oshal_lora_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_lora_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oshal_lora_scores_owner_policy ON oshal_lora_scores;
CREATE POLICY oshal_lora_scores_owner_policy ON oshal_lora_scores
  USING (EXISTS (
    SELECT 1 FROM oshal_lora_characters c
     WHERE c.id = oshal_lora_scores.character_id
       AND (
         c.owner_sub = current_setting('oshal.current_sub', true)
         OR current_setting('oshal.is_operator', true) = 'on'
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM oshal_lora_characters c
     WHERE c.id = oshal_lora_scores.character_id
       AND (
         c.owner_sub = current_setting('oshal.current_sub', true)
         OR current_setting('oshal.is_operator', true) = 'on'
       )
  ));
