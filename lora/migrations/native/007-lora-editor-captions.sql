-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Exact desired/applied caption revisions, original import ticket fencing and cosmetic metadata CAS preserve real worker source.
CREATE TABLE IF NOT EXISTS oshal_lora_dataset_imports (image_id UUID PRIMARY KEY REFERENCES oshal_lora_dataset_images(id) ON DELETE CASCADE,character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE,owner_key TEXT NOT NULL,import_revision INTEGER NOT NULL,ticket_id TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE TABLE IF NOT EXISTS oshal_lora_dataset_captions (image_id UUID PRIMARY KEY REFERENCES oshal_lora_dataset_images(id) ON DELETE CASCADE, character_id UUID NOT NULL REFERENCES oshal_lora_characters(id) ON DELETE CASCADE, owner_key TEXT NOT NULL, caption TEXT NOT NULL, caption_revision INTEGER NOT NULL, applied_revision INTEGER NOT NULL DEFAULT 0, caption_sha256 TEXT NOT NULL, applied_sha256 TEXT, status TEXT NOT NULL, update_id UUID NOT NULL, ticket_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE TABLE IF NOT EXISTS oshal_lora_character_editor (character_id UUID PRIMARY KEY REFERENCES oshal_lora_characters(id) ON DELETE CASCADE, owner_key TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- Evolve the installed dispatch CHECK without changing native001's recorded checksum.
ALTER TABLE oshal_lora_callback_grants DROP CONSTRAINT IF EXISTS oshal_lora_callback_grants_dispatch_kind_check;
ALTER TABLE oshal_lora_callback_grants ADD CONSTRAINT oshal_lora_callback_grants_dispatch_kind_check CHECK(dispatch_kind IN ('train','validate','improve','overnight','dataset-import','caption-write'));
