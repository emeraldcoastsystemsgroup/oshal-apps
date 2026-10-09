-- LoRA Studio — a character's WHOLE identity lives in its row, not in the box scripts.
-- Migration 102 follows the installed 101 hosted-cell image schema.
--
-- The box scripts in the framework's scripts/comfyui-edge/ carried the first character the studio
-- ever trained as literal constants: its trigger word, its identity sentence, its anatomy-specific
-- structural guard ("a single big eye" against "two eyes"), dataset globs built from its trigger
-- word, and one shared dataset folder per box. A second character could not be trained without
-- editing those scripts, and it would have consumed and overwritten the first one's dataset,
-- curated set and scorecards on the way. The scripts now take every one of those values from the
-- command line, and the controller fills them from this table.
--
-- Two of them had nowhere to live before this migration: the character's own negative prompt, and
-- its own contrastive structural pair. Both are nullable — a character that declares no structural
-- pair is simply not probed structurally, which is correct, because probing it against another
-- character's anatomy multiplied its quality score by 0.55 on every cell.
--
-- BOX LAYOUT: each character now owns LORA_BOX_ROOT/lora-<UUID without dashes> (default
-- %USERPROFILE%\lora-characters\lora-<UUID without dashes>), holding img/, curated/,
-- curated.zip and validate/. The owner-visible characters API returns this storage_key.
-- The seeded cyclops's legacy directories on an existing box (its image pool, ~/overnight and
-- ~/lora-validate) are not moved by this migration; an operator who wants its 1200-image pool
-- carried over copies it into the new img/ directory. Everything else there is regenerated.
--
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Give a character its own negative prompt and its
--     own contrastive structural pair, and backfill the seeded cyclops with the values the box
--     scripts used to hard-code, so its behaviour is unchanged while every other character stops
--     being measured as a cyclops.
-- 2 | maintainer@emeraldcoastsystemsgroup.com | Document immutable worker storage names; this migration does not move existing worker files.
-- 3 | maintainer@emeraldcoastsystemsgroup.com | Backfill only the actual starter identity, not unrelated owner characters sharing its public subject.

ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS negative_prompt TEXT;
ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS identity_structure TEXT;
ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS identity_violation TEXT;

COMMENT ON COLUMN oshal_lora_characters.negative_prompt IS
  'This character''s negative prompt. Anything about its anatomy belongs here, never in a shared default.';
COMMENT ON COLUMN oshal_lora_characters.identity_structure IS
  'Contrastive prompt this character SHOULD match. Null means no structural probe for this character.';
COMMENT ON COLUMN oshal_lora_characters.identity_violation IS
  'Contrastive prompt that means this character''s identity broke. Paired with identity_structure.';

-- The one character that already existed keeps exactly the constants the scripts used to apply to
-- it, so nothing about its training or scoring changes. Every OTHER character starts with none.
UPDATE oshal_lora_characters
   SET negative_prompt = COALESCE(negative_prompt,
         'blurry, low quality, deformed, extra eyes, two eyes, text, watermark, multiple characters, jpeg artifacts, lowres'),
       identity_structure = COALESCE(identity_structure, 'a one-eyed cyclops creature with a single big eye'),
       identity_violation = COALESCE(identity_violation, 'a creature with two eyes')
 WHERE subject = 'oshbrainrot'
   AND trigger_word = 'oshbrainrot'
   AND hero_image = 'hero_brainrot_00002_.png'
   AND ident_prompt = 'a one-eyed leathery orange-red screaming cyclops creature, big single eye, wide toothy mouth, stubby clawed legs, long thin arms, glossy 3d render, italian brainrot meme style';
