-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | The issuer half of the owner identity a worker
-- callback runs as. LoRA 1.7.0 admits worker callbacks through the kernel's signed-package-callbacks
-- rail, whose verifier must return the owner's exact (subject, issuer) pair for the kernel to refresh
-- and authorize. A grant now records its owner's issuer, and a character records the issuer of the
-- owner who enabled autonomous mode, which is the identity the nightly schedule mints for.
-- -----------------------------------------------------------------------------
--
-- Both columns stay nullable: rows written before 1.7.0 have no issuer to backfill, and guessing one
-- would bind a callback to an identity nobody verified. The verifier refuses a grant without an
-- issuer, and the schedule treats an autonomous character without one as not ready until its owner
-- re-enables autonomous mode. Both tables are already under forced owner RLS (migrations 100, 105).

ALTER TABLE oshal_lora_callback_grants ADD COLUMN IF NOT EXISTS owner_issuer TEXT
  CHECK (owner_issuer IS NULL OR length(owner_issuer) BETWEEN 1 AND 2048);

ALTER TABLE oshal_lora_characters ADD COLUMN IF NOT EXISTS autonomous_issuer TEXT
  CHECK (autonomous_issuer IS NULL OR length(autonomous_issuer) BETWEEN 1 AND 2048);
