-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                    | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Give offline interview rows a stable per-user source key so repeated SQLite synchronization cannot duplicate sensitive transcripts.

-- Existing rows cannot be assigned a source identity from their generated PostgreSQL id: an
-- earlier loader did not preserve the SQLite id, and equating the two would invent evidence.
-- They remain NULL and therefore visible to the convergence report as unmapped rows which must
-- be reconciled before cutover. Every new/replayed source row carries its exact SQLite id.
ALTER TABLE career_user_interview_assessments
  ADD COLUMN IF NOT EXISTS source_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'career_user_interview_source_id_positive'
  ) THEN
    ALTER TABLE career_user_interview_assessments
      ADD CONSTRAINT career_user_interview_source_id_positive
      CHECK (source_id IS NULL OR source_id > 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_career_user_interview_source
  ON career_user_interview_assessments(user_sub, source_id)
  WHERE source_id IS NOT NULL;

COMMENT ON COLUMN career_user_interview_assessments.source_id IS
  'Exact interview_assessments.id from the SQLite source; NULL marks a pre-103 unmapped load.';
