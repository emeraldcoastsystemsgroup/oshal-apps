-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Native final shape of the migrations the native kernel skips (020, 031, 032, 033, 035, 036, 037): the tenant domain unique index, private flashcard ownership, enrollment tenant binding, server-graded quiz attempts and the roster audit. The PL/pgSQL triggers and DO guards stay PostgreSQL-only; inside one person's native scope the only school is the seeded default, so the tenant columns default to it. On PostgreSQL every statement here is a no-op after 019-038.

-- 031: one school per mapped email domain.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_tenants_domain_unique
  ON lm_tenants (lower(domain))
  WHERE domain IS NOT NULL;

-- 032: a learner is bound to the verified (issuer, subject) pair.
ALTER TABLE lm_students
  ADD COLUMN IF NOT EXISTS external_issuer TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_students_external_principal
  ON lm_students (external_issuer, external_id)
  WHERE external_issuer IS NOT NULL AND external_id IS NOT NULL;

-- 033: private flashcard sets carry their owner.
ALTER TABLE lm_flashcard_sets
  ADD COLUMN IF NOT EXISTS owner_student_id UUID;
CREATE INDEX IF NOT EXISTS idx_lm_flashcard_sets_private_owner_created
  ON lm_flashcard_sets (owner_student_id, created_at DESC)
  WHERE class_id IS NULL AND owner_student_id IS NOT NULL;

-- 035: every enrollment names its school.
ALTER TABLE lm_enrollments
  ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000d001';
CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_students_id_tenant
  ON lm_students (student_id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_classes_id_tenant
  ON lm_classes (class_id, tenant_id);

-- 036: idempotent XP and one-time server-graded quiz attempts.
ALTER TABLE lm_xp_events ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(160);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_xp_events_dedupe
  ON lm_xp_events (student_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS lm_quiz_attempts (
  attempt_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID NOT NULL,
  class_id     UUID NOT NULL,
  tenant_id    UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000d001',
  questions    JSONB NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + interval '30 minutes'),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lm_quiz_attempts_student_open
  ON lm_quiz_attempts (student_id, expires_at)
  WHERE completed_at IS NULL;

-- 037: the roster authorization audit (append-only by route code natively).
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
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lm_authorization_audit_actor_time
  ON lm_authorization_audit (actor_student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lm_authorization_audit_student_time
  ON lm_authorization_audit (student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lm_authorization_audit_class_time
  ON lm_authorization_audit (class_id, occurred_at DESC);
