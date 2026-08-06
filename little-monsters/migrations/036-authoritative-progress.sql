-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Add idempotent XP ledger keys and one-time server-scored quiz attempts
-- =============================================================================

ALTER TABLE lm_xp_events ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_xp_events_dedupe
  ON lm_xp_events (student_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS lm_quiz_attempts (
  attempt_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID NOT NULL,
  class_id     UUID NOT NULL,
  tenant_id    UUID NOT NULL,
  questions    JSONB NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + interval '30 minutes'),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lm_quiz_attempt_student_tenant_fk
    FOREIGN KEY (student_id, tenant_id) REFERENCES lm_students (student_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT lm_quiz_attempt_class_tenant_fk
    FOREIGN KEY (class_id, tenant_id) REFERENCES lm_classes (class_id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lm_quiz_attempts_student_open
  ON lm_quiz_attempts (student_id, expires_at)
  WHERE completed_at IS NULL;

CREATE OR REPLACE FUNCTION lm_quiz_attempt_bind_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  student_tenant UUID;
  class_tenant UUID;
BEGIN
  SELECT tenant_id INTO student_tenant FROM lm_students WHERE student_id = NEW.student_id;
  SELECT tenant_id INTO class_tenant FROM lm_classes WHERE class_id = NEW.class_id;
  IF student_tenant IS NULL OR class_tenant IS NULL OR student_tenant <> class_tenant THEN
    RAISE EXCEPTION 'quiz student and class must belong to the same tenant';
  END IF;
  NEW.tenant_id := class_tenant;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lm_quiz_attempt_bind_tenant_trigger ON lm_quiz_attempts;
CREATE TRIGGER lm_quiz_attempt_bind_tenant_trigger
  BEFORE INSERT OR UPDATE OF student_id, class_id, tenant_id ON lm_quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION lm_quiz_attempt_bind_tenant();
