-- 107-career-automation-owner-issuer.sql -- the issuer half of the owner identity the nightly chain
-- mints callback grants for (career-hunter 1.25.1).
--
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                    | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Record the verified principal issuer of the owner who saved an automation opt-in. The engine's model rail runs on the kernel's signed-package-callbacks rail, which refreshes and authorizes an exact (subject, issuer) principal before a completion runs; a cron tick has no request to read the issuer from, so the opt-in records it. Nullable: rows saved before 1.25.1 carry NULL and the cron skips their model passes until the owner saves the settings again. Same FORCE-RLS policy as 091 (the column lives on that table). Idempotent.

ALTER TABLE career_automation_settings
  ADD COLUMN IF NOT EXISTS owner_issuer TEXT
  CHECK (owner_issuer IS NULL OR length(owner_issuer) BETWEEN 1 AND 2048);
