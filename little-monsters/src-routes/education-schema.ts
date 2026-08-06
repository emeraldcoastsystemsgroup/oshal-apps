/**
 * Education schema validation and compatibility bootstrap.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Extracted schema validation and idempotent upgrades, including tenant-domain uniqueness
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Require the issuer-bound student principal column and composite uniqueness invariant from migration 032
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Make every bootstrap failure observable and stop unsafe follow-on upgrades after an unexpected base-schema error
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Validate and bootstrap migrations 033-036 security columns, indexes, and tenant-binding triggers
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | Validate and bootstrap the migration-037 append-only authorization audit boundary
 * ---------------------------------------------------------------------------
 *
 * @module education-schema
 */

import * as fs from 'fs';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import { assertSchemaReady, runtimeSchemaBootstrapEnabled } from '@/shared/services/database';

const logger = createChildLogger({ module: 'education-schema' });

const SCHEMA_REQUIREMENTS = [
  { table: 'lm_classes', columns: ['class_id', 'name', 'subject', 'status', 'published', 'tenant_id', 'teacher_student_id'] },
  { table: 'lm_students', columns: ['student_id', 'name', 'email', 'xp', 'level', 'external_id', 'external_issuer', 'role', 'tenant_id'] },
  { table: 'lm_enrollments', columns: ['student_id', 'class_id', 'tenant_id', 'enrolled_at'] },
  { table: 'lm_flashcard_sets', columns: ['set_id', 'class_id', 'owner_student_id', 'title', 'card_count', 'created_at'] },
  { table: 'lm_flashcards', columns: ['card_id', 'set_id', 'front', 'back', 'card_type', 'difficulty', 'created_at'] },
  { table: 'lm_flashcard_progress', columns: ['student_id', 'card_id', 'repetitions', 'next_review'] },
  { table: 'lm_assignments', columns: ['assignment_id', 'class_id', 'title', 'assignment_type', 'status', 'created_at'] },
  { table: 'lm_xp_events', columns: ['event_id', 'student_id', 'event_type', 'xp_amount', 'dedupe_key', 'metadata', 'created_at'] },
  { table: 'lm_quiz_results', columns: ['result_id', 'student_id', 'class_id', 'score_percent', 'total_questions', 'completed_at'] },
  { table: 'lm_quiz_attempts', columns: ['attempt_id', 'student_id', 'class_id', 'tenant_id', 'questions', 'expires_at', 'completed_at'] },
  { table: 'lm_lectures', columns: ['lecture_id', 'class_id', 'lecture_date', 'audio_path', 'transcript_path', 'slides_path', 'status', 'created_at'] },
  { table: 'lm_calendar_events', columns: ['event_id', 'class_id', 'title', 'event_date', 'google_event_id', 'google_synced_at'] },
  { table: 'lm_materials', columns: ['material_id', 'class_id', 'uploaded_by', 'stored_path', 'shared', 'share_status', 'rag_collection', 'created_at'] },
  { table: 'lm_tenants', columns: ['tenant_id', 'slug', 'name', 'domain', 'created_at'] },
  { table: 'lm_authorization_audit', columns: ['audit_id', 'actor_student_id', 'student_id', 'class_id', 'action', 'occurred_at'] },
];

const MATERIALS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS lm_materials (
  material_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL,
  uploaded_by UUID,
  original_name TEXT,
  stored_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT DEFAULT 0,
  kind VARCHAR(20) NOT NULL DEFAULT 'document',
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

const TENANTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS lm_tenants (
  tenant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(64) UNIQUE NOT NULL,
  name TEXT NOT NULL,
  domain VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

const ENROLLMENT_TENANT_GUARD_SQL = `CREATE OR REPLACE FUNCTION lm_enrollment_bind_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE student_tenant UUID; class_tenant UUID;
BEGIN
  SELECT tenant_id INTO student_tenant FROM lm_students WHERE student_id = NEW.student_id;
  SELECT tenant_id INTO class_tenant FROM lm_classes WHERE class_id = NEW.class_id;
  IF student_tenant IS NULL OR class_tenant IS NULL OR student_tenant <> class_tenant THEN
    RAISE EXCEPTION 'student and class must belong to the same tenant';
  END IF;
  NEW.tenant_id := class_tenant;
  RETURN NEW;
END $$`;

const ENROLLMENT_CONSTRAINTS_SQL = `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lm_enrollments_student_tenant_fk') THEN
    ALTER TABLE lm_enrollments ADD CONSTRAINT lm_enrollments_student_tenant_fk
      FOREIGN KEY (student_id, tenant_id) REFERENCES lm_students (student_id, tenant_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lm_enrollments_class_tenant_fk') THEN
    ALTER TABLE lm_enrollments ADD CONSTRAINT lm_enrollments_class_tenant_fk
      FOREIGN KEY (class_id, tenant_id) REFERENCES lm_classes (class_id, tenant_id) ON DELETE CASCADE;
  END IF;
END $$`;

const QUIZ_ATTEMPTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS lm_quiz_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  class_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  questions JSONB NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + interval '30 minutes'),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lm_quiz_attempt_student_tenant_fk FOREIGN KEY (student_id, tenant_id)
    REFERENCES lm_students (student_id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT lm_quiz_attempt_class_tenant_fk FOREIGN KEY (class_id, tenant_id)
    REFERENCES lm_classes (class_id, tenant_id) ON DELETE CASCADE
)`;

const QUIZ_ATTEMPT_TENANT_GUARD_SQL = `CREATE OR REPLACE FUNCTION lm_quiz_attempt_bind_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE student_tenant UUID; class_tenant UUID;
BEGIN
  SELECT tenant_id INTO student_tenant FROM lm_students WHERE student_id = NEW.student_id;
  SELECT tenant_id INTO class_tenant FROM lm_classes WHERE class_id = NEW.class_id;
  IF student_tenant IS NULL OR class_tenant IS NULL OR student_tenant <> class_tenant THEN
    RAISE EXCEPTION 'quiz student and class must belong to the same tenant';
  END IF;
  NEW.tenant_id := class_tenant;
  RETURN NEW;
END $$`;

const AUTHORIZATION_AUDIT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS lm_authorization_audit (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_student_id UUID NOT NULL,
  student_id UUID NOT NULL,
  class_id UUID NOT NULL,
  action VARCHAR(64) NOT NULL CHECK (action IN (
    'roster.student_provisioned', 'roster.enrollment_created', 'roster.enrollment_removed'
  )),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
)`;

const AUTHORIZATION_AUDIT_STAMP_SQL = `CREATE OR REPLACE FUNCTION lm_authorization_audit_stamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END $$`;

const AUTHORIZATION_AUDIT_IMMUTABLE_SQL = `CREATE OR REPLACE FUNCTION lm_authorization_audit_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lm_authorization_audit is append-only';
END $$`;

async function applyUpgrade(pool: any, name: string, statements: string[]): Promise<void> {
  try {
    for (const statement of statements) await pool.query(statement);
  } catch (err) {
    logger.error({ err, upgrade: name }, `Education schema upgrade failed (${name})`);
    throw err;
  }
}

async function assertIdentityBindingReady(pool: any): Promise<void> {
  const result = await pool.query(
    `SELECT i.indisunique,
            pg_get_indexdef(i.indexrelid) AS index_definition,
            pg_get_expr(i.indpred, i.indrelid) AS index_predicate,
            to_regclass('idx_lm_students_external_id') IS NOT NULL AS legacy_index_present
       FROM pg_index i
       JOIN pg_class idx ON idx.oid = i.indexrelid
       JOIN pg_class tbl ON tbl.oid = i.indrelid
       JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      WHERE idx.relname = 'idx_lm_students_external_principal'
        AND tbl.relname = 'lm_students'
        AND ns.nspname = ANY(current_schemas(false))
      LIMIT 2`,
  );
  const state = result.rows[0] || {};
  const definition = String(state.index_definition || '').replace(/"/g, '');
  const predicate = String(state.index_predicate || '').replace(/"/g, '');
  const correctKeys = /\(external_issuer,\s*external_id\)/i.test(definition);
  const correctPredicate = /external_issuer IS NOT NULL/i.test(predicate)
    && /external_id IS NOT NULL/i.test(predicate);
  if (result.rows.length !== 1 || !state.indisunique || !correctKeys
      || !correctPredicate || state.legacy_index_present) {
    throw new Error(
      'education routes schema is not ready: migration 032 must install the issuer-bound ' +
      'student principal index and remove the legacy global external-id index.',
    );
  }
}

/** Confirm security-critical partial indexes and tenant triggers, not just columns. */
async function assertSecurityInvariantsReady(pool: any): Promise<void> {
  const result = await pool.query(
    `SELECT
       to_regclass('idx_lm_flashcard_sets_private_owner_created') IS NOT NULL AS study_owner_index,
       to_regclass('idx_lm_materials_rag_collection') IS NOT NULL AS material_rag_index,
       to_regclass('idx_lm_xp_events_dedupe') IS NOT NULL AS xp_dedupe_index,
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lm_flashcard_sets_scope_exclusive')
         AS study_scope_constraint,
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lm_enrollments_student_tenant_fk')
         AS enrollment_student_fk,
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lm_enrollments_class_tenant_fk')
         AS enrollment_class_fk,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'lm_enrollment_bind_tenant_trigger' AND NOT tgisinternal)
         AS enrollment_tenant_trigger,
        EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'lm_quiz_attempt_bind_tenant_trigger' AND NOT tgisinternal)
          AS quiz_tenant_trigger,
        EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'lm_authorization_audit_stamp_trigger' AND NOT tgisinternal)
          AS audit_stamp_trigger,
        EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'lm_authorization_audit_immutable_trigger' AND NOT tgisinternal)
          AS audit_immutable_trigger`,
  );
  const state = result.rows[0] || {};
  if (!state.study_owner_index || !state.material_rag_index || !state.xp_dedupe_index
       || !state.study_scope_constraint || !state.enrollment_student_fk || !state.enrollment_class_fk
       || !state.enrollment_tenant_trigger || !state.quiz_tenant_trigger
       || !state.audit_stamp_trigger || !state.audit_immutable_trigger) {
    throw new Error('education routes schema is not ready: migrations 033-037 security invariants are missing');
  }
}

async function validateSchema(pool: any): Promise<void> {
  await assertSchemaReady(pool, 'education routes', SCHEMA_REQUIREMENTS);
  await assertIdentityBindingReady(pool);
  await assertSecurityInvariantsReady(pool);
  logger.info('Education schema and security invariants are present');
}

async function bootstrapBaseSchema(pool: any): Promise<boolean> {
  const migrationPath = path.resolve(process.cwd(), 'scripts/migrations/019-education-platform.sql');
  if (!fs.existsSync(migrationPath)) {
    logger.error({ migrationPath }, 'Education migration file not found; schema bootstrap skipped');
    return false;
  }
  try {
    await pool.query(fs.readFileSync(migrationPath, 'utf-8'));
    logger.info('Education base schema bootstrapped successfully');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('already exists')) {
      logger.warn({ err }, 'Education base schema already exists; continuing idempotent upgrades');
      return true;
    }
    logger.error({ err }, 'Education base schema bootstrap failed');
    return false;
  }
  return true;
}

async function upgradeLectureAndCalendar(pool: any): Promise<void> {
  await applyUpgrade(pool, 'slides_path 024', [
    'ALTER TABLE lm_lectures ADD COLUMN IF NOT EXISTS slides_path VARCHAR(500)',
  ]);
  await applyUpgrade(pool, 'calendar google sync 025', [
    'ALTER TABLE lm_calendar_events ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(255)',
    'ALTER TABLE lm_calendar_events ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ',
  ]);
}

async function upgradeIdentityAndPublishing(pool: any): Promise<void> {
  await applyUpgrade(pool, 'identity 026 and issuer binding 032', [
    'ALTER TABLE lm_students ADD COLUMN IF NOT EXISTS external_id VARCHAR(255)',
    'ALTER TABLE lm_students ADD COLUMN IF NOT EXISTS external_issuer TEXT',
    "ALTER TABLE lm_students ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'student'",
    'ALTER TABLE lm_classes ADD COLUMN IF NOT EXISTS teacher_student_id UUID',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_students_external_principal
       ON lm_students (external_issuer, external_id)
       WHERE external_issuer IS NOT NULL AND external_id IS NOT NULL`,
    'DROP INDEX IF EXISTS idx_lm_students_external_id',
  ]);
  await applyUpgrade(pool, 'publishing 027', [
    'ALTER TABLE lm_classes ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false',
    'CREATE INDEX IF NOT EXISTS idx_lm_classes_published ON lm_classes (published) WHERE published = true',
  ]);
}

async function upgradeMaterials(pool: any): Promise<void> {
  await applyUpgrade(pool, 'materials 028', [
    MATERIALS_TABLE_SQL,
    'CREATE INDEX IF NOT EXISTS idx_lm_materials_class ON lm_materials (class_id, created_at DESC)',
  ]);
  await applyUpgrade(pool, 'material sharing 029', [
    'ALTER TABLE lm_materials ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT false',
    "ALTER TABLE lm_materials ADD COLUMN IF NOT EXISTS share_status VARCHAR(20) NOT NULL DEFAULT 'private'",
    'CREATE INDEX IF NOT EXISTS idx_lm_materials_shared ON lm_materials (class_id, share_status)',
  ]);
}

async function upgradeTenancy(pool: any): Promise<void> {
  await applyUpgrade(pool, 'multi-tenant 030 and uniqueness 031', [
    TENANTS_TABLE_SQL,
    `INSERT INTO lm_tenants (tenant_id, slug, name)
     VALUES ('00000000-0000-4000-8000-00000000d001', 'default', 'Default School')
     ON CONFLICT (tenant_id) DO NOTHING`,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_tenants_domain_unique ON lm_tenants (lower(domain)) WHERE domain IS NOT NULL',
    'DROP INDEX IF EXISTS idx_lm_tenants_domain',
    "ALTER TABLE lm_students ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000d001'",
    "ALTER TABLE lm_classes ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000d001'",
  ]);
}

async function upgradeOwnedStudyAndMaterials(pool: any): Promise<void> {
  await applyUpgrade(pool, 'private study ownership 033', [
    'ALTER TABLE lm_flashcard_sets ADD COLUMN IF NOT EXISTS owner_student_id UUID',
    `DO $$ BEGIN IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'lm_flashcard_sets_owner_student_fk'
         AND conrelid = 'lm_flashcard_sets'::regclass
     ) THEN ALTER TABLE lm_flashcard_sets ADD CONSTRAINT lm_flashcard_sets_owner_student_fk
       FOREIGN KEY (owner_student_id) REFERENCES lm_students(student_id) ON DELETE CASCADE NOT VALID;
     END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'lm_flashcard_sets_scope_exclusive'
         AND conrelid = 'lm_flashcard_sets'::regclass
     ) THEN ALTER TABLE lm_flashcard_sets ADD CONSTRAINT lm_flashcard_sets_scope_exclusive
       CHECK (class_id IS NULL OR owner_student_id IS NULL) NOT VALID;
     END IF; END $$`,
    `CREATE INDEX IF NOT EXISTS idx_lm_flashcard_sets_private_owner_created
       ON lm_flashcard_sets (owner_student_id, created_at DESC)
       WHERE class_id IS NULL AND owner_student_id IS NOT NULL`,
  ]);
  await applyUpgrade(pool, 'material RAG lifecycle 034', [
    'ALTER TABLE lm_materials ADD COLUMN IF NOT EXISTS rag_collection VARCHAR(63)',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_materials_rag_collection
       ON lm_materials (rag_collection) WHERE rag_collection IS NOT NULL`,
  ]);
}

async function upgradeEnrollmentTenancy(pool: any): Promise<void> {
  await applyUpgrade(pool, 'enrollment tenant invariant 035', [
    'ALTER TABLE lm_enrollments ADD COLUMN IF NOT EXISTS tenant_id UUID',
    `DO $$ BEGIN IF EXISTS (
       SELECT 1 FROM lm_enrollments e JOIN lm_students s ON s.student_id = e.student_id
       JOIN lm_classes c ON c.class_id = e.class_id WHERE s.tenant_id <> c.tenant_id
     ) THEN RAISE EXCEPTION 'lm_enrollments contains cross-tenant rows'; END IF; END $$`,
    `UPDATE lm_enrollments e SET tenant_id = c.tenant_id FROM lm_classes c
       WHERE c.class_id = e.class_id AND e.tenant_id IS NULL`,
    'ALTER TABLE lm_enrollments ALTER COLUMN tenant_id SET NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_students_id_tenant ON lm_students (student_id, tenant_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_classes_id_tenant ON lm_classes (class_id, tenant_id)',
    ENROLLMENT_TENANT_GUARD_SQL,
    'DROP TRIGGER IF EXISTS lm_enrollment_bind_tenant_trigger ON lm_enrollments',
    `CREATE TRIGGER lm_enrollment_bind_tenant_trigger
       BEFORE INSERT OR UPDATE OF student_id, class_id, tenant_id ON lm_enrollments
       FOR EACH ROW EXECUTE FUNCTION lm_enrollment_bind_tenant()`,
    ENROLLMENT_CONSTRAINTS_SQL,
  ]);
}

async function upgradeAuthoritativeProgress(pool: any): Promise<void> {
  await applyUpgrade(pool, 'authoritative progress 036', [
    'ALTER TABLE lm_xp_events ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(160)',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_xp_events_dedupe
       ON lm_xp_events (student_id, dedupe_key) WHERE dedupe_key IS NOT NULL`,
    QUIZ_ATTEMPTS_TABLE_SQL,
    `CREATE INDEX IF NOT EXISTS idx_lm_quiz_attempts_student_open
       ON lm_quiz_attempts (student_id, expires_at) WHERE completed_at IS NULL`,
    QUIZ_ATTEMPT_TENANT_GUARD_SQL,
    'DROP TRIGGER IF EXISTS lm_quiz_attempt_bind_tenant_trigger ON lm_quiz_attempts',
    `CREATE TRIGGER lm_quiz_attempt_bind_tenant_trigger
       BEFORE INSERT OR UPDATE OF student_id, class_id, tenant_id ON lm_quiz_attempts
       FOR EACH ROW EXECUTE FUNCTION lm_quiz_attempt_bind_tenant()`,
  ]);
}

async function upgradeAuthorizationAudit(pool: any): Promise<void> {
  await applyUpgrade(pool, 'authorization audit 037', [
    AUTHORIZATION_AUDIT_TABLE_SQL,
    'CREATE INDEX IF NOT EXISTS idx_lm_authorization_audit_actor_time ON lm_authorization_audit (actor_student_id, occurred_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_lm_authorization_audit_student_time ON lm_authorization_audit (student_id, occurred_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_lm_authorization_audit_class_time ON lm_authorization_audit (class_id, occurred_at DESC)',
    AUTHORIZATION_AUDIT_STAMP_SQL,
    'DROP TRIGGER IF EXISTS lm_authorization_audit_stamp_trigger ON lm_authorization_audit',
    `CREATE TRIGGER lm_authorization_audit_stamp_trigger
       BEFORE INSERT ON lm_authorization_audit
       FOR EACH ROW EXECUTE FUNCTION lm_authorization_audit_stamp()`,
    AUTHORIZATION_AUDIT_IMMUTABLE_SQL,
    'DROP TRIGGER IF EXISTS lm_authorization_audit_immutable_trigger ON lm_authorization_audit',
    `CREATE TRIGGER lm_authorization_audit_immutable_trigger
       BEFORE UPDATE OR DELETE OR TRUNCATE ON lm_authorization_audit
       FOR EACH STATEMENT EXECUTE FUNCTION lm_authorization_audit_reject_mutation()`,
  ]);
}

/** Validate the education schema or apply the supported idempotent bootstrap path. */
export async function ensureEducationSchema(pool: any): Promise<void> {
  if (!runtimeSchemaBootstrapEnabled()) {
    await validateSchema(pool);
    return;
  }
  if (!await bootstrapBaseSchema(pool)) return;
  await upgradeLectureAndCalendar(pool);
  await upgradeIdentityAndPublishing(pool);
  await upgradeMaterials(pool);
  await upgradeTenancy(pool);
  await upgradeOwnedStudyAndMaterials(pool);
  await upgradeEnrollmentTenancy(pool);
  await upgradeAuthoritativeProgress(pool);
  await upgradeAuthorizationAudit(pool);
  await validateSchema(pool);
}
