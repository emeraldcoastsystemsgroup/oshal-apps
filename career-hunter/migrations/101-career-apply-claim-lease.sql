-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ                 | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Add an epoch-millisecond start time to each application claim so recovery can distinguish a live lease from a legacy or expired raw claim.

-- NULL is intentional for rows claimed before this migration. The bounded controller reaper treats
-- those legacy claims as recoverable unless their exact posting id is present in its live-run set.
ALTER TABLE career_user_applications
  ADD COLUMN IF NOT EXISTS apply_claimed_at BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'career_user_apply_claimed_at_nonnegative'
  ) THEN
    ALTER TABLE career_user_applications
      ADD CONSTRAINT career_user_apply_claimed_at_nonnegative
      CHECK (apply_claimed_at IS NULL OR apply_claimed_at >= 0);
  END IF;
END $$;

-- Recovery scans only outstanding claims. Keep the timestamp beside the owner and active flag so
-- a future Postgres-native claimant can perform the same bounded lease sweep without a table scan.
CREATE INDEX IF NOT EXISTS idx_career_user_apps_claim_lease
  ON career_user_applications(user_sub, apply_active, apply_claimed_at)
  WHERE apply_active = 0 AND applied_at IS NULL;

COMMENT ON COLUMN career_user_applications.apply_claimed_at IS
  'Epoch milliseconds when apply_active changed to 0; NULL means unclaimed or a legacy claim.';
