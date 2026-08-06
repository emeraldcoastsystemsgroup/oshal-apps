-- =============================================================================
-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | Enforce that every enrollment joins a student and class from the same school tenant
-- =============================================================================

ALTER TABLE lm_enrollments ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Refuse activation when historical data already crosses a school boundary. An
-- operator must repair that data explicitly; silently choosing either tenant
-- would conceal the privacy incident this invariant is designed to prevent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM lm_enrollments e
    JOIN lm_students s ON s.student_id = e.student_id
    JOIN lm_classes c ON c.class_id = e.class_id
    WHERE s.tenant_id <> c.tenant_id
  ) THEN
    RAISE EXCEPTION 'lm_enrollments contains cross-tenant rows';
  END IF;
END $$;

UPDATE lm_enrollments e
SET tenant_id = c.tenant_id
FROM lm_classes c
WHERE c.class_id = e.class_id AND e.tenant_id IS NULL;

ALTER TABLE lm_enrollments ALTER COLUMN tenant_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_students_id_tenant
  ON lm_students (student_id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_classes_id_tenant
  ON lm_classes (class_id, tenant_id);

CREATE OR REPLACE FUNCTION lm_enrollment_bind_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  student_tenant UUID;
  class_tenant UUID;
BEGIN
  SELECT tenant_id INTO student_tenant FROM lm_students WHERE student_id = NEW.student_id;
  SELECT tenant_id INTO class_tenant FROM lm_classes WHERE class_id = NEW.class_id;
  IF student_tenant IS NULL OR class_tenant IS NULL OR student_tenant <> class_tenant THEN
    RAISE EXCEPTION 'student and class must belong to the same tenant';
  END IF;
  NEW.tenant_id := class_tenant;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lm_enrollment_bind_tenant_trigger ON lm_enrollments;
CREATE TRIGGER lm_enrollment_bind_tenant_trigger
  BEFORE INSERT OR UPDATE OF student_id, class_id, tenant_id ON lm_enrollments
  FOR EACH ROW EXECUTE FUNCTION lm_enrollment_bind_tenant();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lm_enrollments_student_tenant_fk') THEN
    ALTER TABLE lm_enrollments ADD CONSTRAINT lm_enrollments_student_tenant_fk
      FOREIGN KEY (student_id, tenant_id) REFERENCES lm_students (student_id, tenant_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lm_enrollments_class_tenant_fk') THEN
    ALTER TABLE lm_enrollments ADD CONSTRAINT lm_enrollments_class_tenant_fk
      FOREIGN KEY (class_id, tenant_id) REFERENCES lm_classes (class_id, tenant_id) ON DELETE CASCADE;
  END IF;
END $$;
