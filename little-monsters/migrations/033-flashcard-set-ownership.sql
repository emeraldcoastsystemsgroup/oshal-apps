-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Persist private flashcard ownership with additive fail-closed constraints and indexes.

-- Private sets created after this migration carry their authenticated owner.
-- Historical class_id=NULL rows are intentionally not backfilled: there is no
-- trustworthy way to infer an owner, and application queries fail those rows closed.
ALTER TABLE lm_flashcard_sets
  ADD COLUMN IF NOT EXISTS owner_student_id UUID;

-- NOT VALID avoids an activation-time table scan while PostgreSQL still enforces
-- the relationship for every new or updated owner value.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'lm_flashcard_sets_owner_student_fk'
       AND conrelid = 'lm_flashcard_sets'::regclass
  ) THEN
    ALTER TABLE lm_flashcard_sets
      ADD CONSTRAINT lm_flashcard_sets_owner_student_fk
      FOREIGN KEY (owner_student_id) REFERENCES lm_students(student_id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END
$$;

-- A set cannot simultaneously be class-wide and private. Both-null remains
-- permitted only so historical ownerless rows and class_id's existing ON DELETE
-- SET NULL behavior remain non-destructive; route queries expose neither case.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'lm_flashcard_sets_scope_exclusive'
       AND conrelid = 'lm_flashcard_sets'::regclass
  ) THEN
    ALTER TABLE lm_flashcard_sets
      ADD CONSTRAINT lm_flashcard_sets_scope_exclusive
      CHECK (class_id IS NULL OR owner_student_id IS NULL) NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_lm_flashcard_sets_private_owner_created
  ON lm_flashcard_sets (owner_student_id, created_at DESC)
  WHERE class_id IS NULL AND owner_student_id IS NOT NULL;
