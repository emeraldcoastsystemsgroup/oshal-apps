-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Replace native001 and 104's octet_length(image) = byte_size CHECK on oshal_lora_dataset_staging with length(encode(image, 'hex')) = byte_size * 2 so native bytea (\x hex text) and PostgreSQL bytea validate identical decoded byte counts without altering installed migration checksums.
ALTER TABLE oshal_lora_dataset_staging DROP CONSTRAINT IF EXISTS oshal_lora_dataset_staging_check;
ALTER TABLE oshal_lora_dataset_staging ADD CONSTRAINT oshal_lora_dataset_staging_check CHECK (length(encode(image, 'hex')) = byte_size * 2);
