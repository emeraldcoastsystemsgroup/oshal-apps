-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Stage each ADR-139 dataset image the controller
-- redeemed as the signed-in caller, so the GPU worker downloads it from a LoRA-owned exact-owner
-- route instead of the artifact handle. Bounded (10 MiB, PNG/JPEG/WebP only), cascade-deleted with
-- its receipt, expiring on its own clock, and under the same forced owner RLS as the receipt.
-- -----------------------------------------------------------------------------
--
-- The worker used to fetch the handle's content over the fleet service rail. Core refuses that rail
-- for a handle bound to an authenticated principal, and a handle lives 15 minutes, which an offline
-- worker usually outlives. The bytes now wait here until the worker's ready/failed callback deletes
-- them or they expire, whichever comes first.

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

ALTER TABLE oshal_lora_dataset_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE oshal_lora_dataset_staging FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oshal_lora_dataset_staging_owner_policy ON oshal_lora_dataset_staging;
CREATE POLICY oshal_lora_dataset_staging_owner_policy ON oshal_lora_dataset_staging
  USING (EXISTS (
    SELECT 1 FROM oshal_lora_dataset_images d
      JOIN oshal_lora_characters c ON c.id = d.character_id
     WHERE d.id = oshal_lora_dataset_staging.image_id
       AND (c.owner_sub = current_setting('oshal.current_sub', true)
            OR current_setting('oshal.is_operator', true) = 'on')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM oshal_lora_dataset_images d
      JOIN oshal_lora_characters c ON c.id = d.character_id
     WHERE d.id = oshal_lora_dataset_staging.image_id
       AND (c.owner_sub = current_setting('oshal.current_sub', true)
            OR current_setting('oshal.is_operator', true) = 'on')
  ));
