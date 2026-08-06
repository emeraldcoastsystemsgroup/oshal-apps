-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Bind every Career claim to the authoritative Apply V2 run and one-time claim token without erasing the run correlation after settlement.

-- The controller creates apply_runs first, then passes both values to Career's claim CAS. The token
-- is cleared when the exact run settles or releases; apply_run_id remains as durable correlation.
ALTER TABLE career_user_applications
  ADD COLUMN IF NOT EXISTS apply_run_id UUID;
ALTER TABLE career_user_applications
  ADD COLUMN IF NOT EXISTS apply_claim_token UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'career_user_apply_claim_token_requires_run'
  ) THEN
    ALTER TABLE career_user_applications
      ADD CONSTRAINT career_user_apply_claim_token_requires_run
      CHECK (apply_claim_token IS NULL OR apply_run_id IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_career_user_apps_apply_run
  ON career_user_applications(apply_run_id)
  WHERE apply_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_career_user_apps_claim_token
  ON career_user_applications(apply_claim_token)
  WHERE apply_claim_token IS NOT NULL;

COMMENT ON COLUMN career_user_applications.apply_run_id IS
  'Authoritative core apply_runs.run_id; retained after settlement for exact correlation.';
COMMENT ON COLUMN career_user_applications.apply_claim_token IS
  'One-time release/settlement CAS token; cleared only by the matching Apply run.';
