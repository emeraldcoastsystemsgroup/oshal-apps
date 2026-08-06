-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Bind student identities to the verified OIDC issuer and subject pair instead of a globally ambiguous subject

-- OIDC `sub` is unique only within its issuer. Existing rows deliberately retain
-- a NULL issuer: application code may adopt one exactly once when the verified
-- principal also matches the row's tenant-local email and historical subject.
ALTER TABLE lm_students
  ADD COLUMN IF NOT EXISTS external_issuer TEXT;

-- Install the replacement before removing the historical global-subject index.
-- Only fully bound principals participate; placeholders and one-time legacy rows
-- stay nullable until a verified sign-in claims them transactionally.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_students_external_principal
  ON lm_students (external_issuer, external_id)
  WHERE external_issuer IS NOT NULL AND external_id IS NOT NULL;

-- This index incorrectly assumed `sub` was globally unique across every IdP.
-- Keeping it would reject two legitimate issuers that use the same subject value.
DROP INDEX IF EXISTS idx_lm_students_external_id;
