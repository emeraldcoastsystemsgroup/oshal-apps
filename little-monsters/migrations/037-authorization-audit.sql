-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Add database-timestamped, append-only actor/student/class audit facts for class-roster mutations.
-- =============================================================================

-- Deliberately omit cascading foreign keys: an authorization audit must survive
-- later student or class deletion. UUIDs retain the exact immutable identities.
CREATE TABLE IF NOT EXISTS lm_authorization_audit (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_student_id UUID NOT NULL,
  student_id UUID NOT NULL,
  class_id UUID NOT NULL,
  action VARCHAR(64) NOT NULL CHECK (action IN (
    'roster.student_provisioned',
    'roster.enrollment_created',
    'roster.enrollment_removed'
  )),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_lm_authorization_audit_actor_time
  ON lm_authorization_audit (actor_student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lm_authorization_audit_student_time
  ON lm_authorization_audit (student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lm_authorization_audit_class_time
  ON lm_authorization_audit (class_id, occurred_at DESC);

-- Use database time even if a caller tries to provide its own timestamp. This
-- keeps the audit clock server-authoritative without trusting an HTTP payload.
CREATE OR REPLACE FUNCTION lm_authorization_audit_stamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lm_authorization_audit_stamp_trigger ON lm_authorization_audit;
CREATE TRIGGER lm_authorization_audit_stamp_trigger
  BEFORE INSERT ON lm_authorization_audit
  FOR EACH ROW EXECUTE FUNCTION lm_authorization_audit_stamp();

-- Row and bulk mutation both fail. A statement-level trigger includes TRUNCATE,
-- which ordinary row triggers cannot observe.
CREATE OR REPLACE FUNCTION lm_authorization_audit_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lm_authorization_audit is append-only';
END $$;

DROP TRIGGER IF EXISTS lm_authorization_audit_immutable_trigger ON lm_authorization_audit;
CREATE TRIGGER lm_authorization_audit_immutable_trigger
  BEFORE UPDATE OR DELETE OR TRUNCATE ON lm_authorization_audit
  FOR EACH STATEMENT EXECUTE FUNCTION lm_authorization_audit_reject_mutation();

COMMENT ON TABLE lm_authorization_audit IS
  'Append-only Little Monsters authorization audit; actor, student, class, action, and database timestamp.';
