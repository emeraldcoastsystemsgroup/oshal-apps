-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Add private fit evidence identity without changing public view shape, row ownership or existing scores.
-- Persist private scoring evidence identity alongside the fit. Existing rows remain legacy
-- (NULL) and are refreshed only within the ordinary selected/batch scoring budgets.
-- The owner/RLS rules of career_user_job_scores and the public postings view are unchanged.
ALTER TABLE career_user_job_scores
  ADD COLUMN IF NOT EXISTS ai_input_fingerprint TEXT;
