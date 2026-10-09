-- LoRA Studio hosted validation thumbnails.
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Store each scorecard cell's bounded validation
-- thumbnail in owner-scoped controller storage so the studio can render it, cascade it with the
-- character, and give every row an expiry so an expired or deleted run loses access.
-- 2 | maintainer@emeraldcoastsystemsgroup.com | Cascade from the exact model run and refuse late
-- thumbnail writes after deletion. Existing orphan bytes make the migration refuse, never purge.
--
-- Before this table the box reported a bare ComfyUI filename per cell, which is not fetchable from
-- a browser, so no scorecard cell could display anything. The bytes live here beside the score they
-- belong to and under the identical owner/operator FORCE RLS policy, so a second user reaches them
-- neither through the route predicate nor through the database.

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
  UNIQUE (character_id, version, cell_index)
);

CREATE INDEX IF NOT EXISTS idx_lora_cell_images_run
  ON oshal_lora_cell_images (character_id, version);
CREATE INDEX IF NOT EXISTS idx_lora_cell_images_expiry
  ON oshal_lora_cell_images (expires_at);

ALTER TABLE oshal_lora_cell_images DROP CONSTRAINT IF EXISTS lora_cell_images_model_fk;
ALTER TABLE oshal_lora_cell_images ADD CONSTRAINT lora_cell_images_model_fk
  FOREIGN KEY (character_id, version)
  REFERENCES oshal_lora_models(character_id, version) ON DELETE CASCADE;

ALTER TABLE oshal_lora_cell_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_lora_cell_images FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oshal_lora_cell_images_owner_policy ON oshal_lora_cell_images;
CREATE POLICY oshal_lora_cell_images_owner_policy ON oshal_lora_cell_images
  USING (EXISTS (
    SELECT 1 FROM oshal_lora_characters c
     WHERE c.id = oshal_lora_cell_images.character_id
       AND (
         c.owner_sub = current_setting('oshal.current_sub', true)
         OR current_setting('oshal.is_operator', true) = 'on'
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM oshal_lora_characters c
     WHERE c.id = oshal_lora_cell_images.character_id
       AND (
         c.owner_sub = current_setting('oshal.current_sub', true)
         OR current_setting('oshal.is_operator', true) = 'on'
       )
  ));
