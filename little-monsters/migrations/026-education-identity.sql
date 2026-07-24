-- -----------------------------------------------------------------------------
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- DATE/TIME           | AUTHOR                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-13 09:40:00 | roger.murphy@agenticfederal.us   | Education identity: map an authenticated SSO user (Microsoft Entra / Keycloak) to an lm_students row via stable external_id (OIDC sub) + email, and a role for teacher-vs-student access. Foundation for enrollment-based shared-vs-private access control.
-- -----------------------------------------------------------------------------

-- Stable identity from the IdP (the OIDC `sub`). Email can change; sub does not.
ALTER TABLE lm_students ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
-- Role gates teacher-only surfaces (a teacher sees all classes they teach; a
-- student sees only classes they're enrolled in). 'student' | 'teacher' | 'admin'.
ALTER TABLE lm_students ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'student';

CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_students_external_id
  ON lm_students (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lm_students_email_lower
  ON lm_students (lower(email)) WHERE email IS NOT NULL;

-- A teacher owns the classes they teach (replaces the free-text teacher_name for
-- access decisions). Nullable so existing rows keep working.
ALTER TABLE lm_classes ADD COLUMN IF NOT EXISTS teacher_student_id UUID;
CREATE INDEX IF NOT EXISTS idx_lm_classes_teacher ON lm_classes (teacher_student_id) WHERE teacher_student_id IS NOT NULL;
