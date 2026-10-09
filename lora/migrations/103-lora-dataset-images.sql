-- LoRA Studio dataset receipts (ADR-139 image destination).
-- The GPU worker owns the heavy bytes; the controller stores only owner-scoped receipt metadata.
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
ALTER TABLE oshal_lora_dataset_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_lora_dataset_images FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oshal_lora_dataset_images_owner_policy ON oshal_lora_dataset_images;
CREATE POLICY oshal_lora_dataset_images_owner_policy ON oshal_lora_dataset_images
  USING (EXISTS (
    SELECT 1 FROM oshal_lora_characters c
    WHERE c.id = oshal_lora_dataset_images.character_id
      AND (c.owner_sub = current_setting('oshal.current_sub', true)
           OR current_setting('oshal.is_operator', true) = 'on')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM oshal_lora_characters c
    WHERE c.id = oshal_lora_dataset_images.character_id
      AND (c.owner_sub = current_setting('oshal.current_sub', true)
           OR current_setting('oshal.is_operator', true) = 'on')
  ));
