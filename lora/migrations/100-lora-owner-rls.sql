-- LoRA Studio owner/RLS upgrade for installations that already recorded migration 058.
-- 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com | Make character ownership mandatory,
-- permit an identical subject independently per owner, and enforce owner/operator FORCE RLS on
-- character, model, and score rows. Legacy rows remain visible only to an exact operator.

ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS owner_sub TEXT;
UPDATE oshal_lora_characters
   SET owner_sub = 'system:legacy:lora'
 WHERE owner_sub IS NULL OR btrim(owner_sub) = '';
ALTER TABLE oshal_lora_characters ALTER COLUMN owner_sub SET NOT NULL;
ALTER TABLE oshal_lora_characters DROP CONSTRAINT IF EXISTS oshal_lora_characters_subject_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lora_characters_owner_subject
  ON oshal_lora_characters (owner_sub, subject);

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
