/**
 * Little Monsters class-roster routes.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Extract tenant-bound roster management from the primary education router so transactional authorization stays reviewable and below the function-size guard.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Rebind roster reads and removals to the actor's current tenant, role, and class ownership in the final SQL statement.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Persist immutable actor/student/class audit facts inside every successful roster transaction.
 */

import { Router, type Request, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import {
  type AuthedStudent,
  assertTeacherOfClass,
  EducationAccessError,
  resolveAuthedStudent,
} from './education-access';

const logger = createChildLogger({ module: 'education-roster-routes' });

interface RosterStudent {
  student_id: string;
  name: string;
}

interface ProvisionedRosterStudent {
  student: RosterStudent;
  created: boolean;
}

type RosterAuditAction =
  | 'roster.student_provisioned'
  | 'roster.enrollment_created';

/** Map an EducationAccessError to its intentional client response. */
function sendAccessError(res: Response, err: unknown): boolean {
  if (!(err instanceof EducationAccessError)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

/** Re-check class state and ownership while holding the row lock used by the write. */
async function assertLockedRosterAccess(
  client: PoolClient,
  actor: AuthedStudent,
  classId: string,
): Promise<void> {
  const lockedClass = (await client.query(
    `SELECT c.status
       FROM lm_classes c
       JOIN lm_students a ON a.student_id = $2 AND a.tenant_id = c.tenant_id
      WHERE c.class_id = $1
        AND (a.role = 'admin' OR (a.role = 'teacher' AND c.teacher_student_id = a.student_id))
      FOR UPDATE OF c, a`,
    [classId, actor.studentId],
  )).rows[0];
  if (!lockedClass) throw new EducationAccessError('You do not teach this class', 403);
  if (lockedClass.status !== 'active') {
    throw new EducationAccessError('Students can only be added to an active class', 409);
  }
}

/** Find or provision one tenant-local placeholder after serializing its email key. */
async function findOrProvisionStudent(
  client: PoolClient,
  actor: AuthedStudent,
  email: string,
): Promise<ProvisionedRosterStudent> {
  // A transaction cannot lock a row that does not exist. The advisory lock keeps
  // concurrent roster requests from creating duplicate placeholders for this key.
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`${actor.tenantId}:${email}`],
  );
  const existing = (await client.query(
    'SELECT student_id, name FROM lm_students WHERE lower(email) = $1 AND tenant_id = $2',
    [email, actor.tenantId],
  )).rows[0];
  if (existing) return { student: existing, created: false };
  const student = (await client.query(
    `INSERT INTO lm_students (name, email, role, tenant_id)
     VALUES ($1, $2, 'student', $3)
     RETURNING student_id, name`,
    [email.split('@')[0], email, actor.tenantId],
  )).rows[0];
  return { student, created: true };
}

/** Append one database-timestamped audit fact inside the caller's open transaction. */
async function recordRosterAudit(
  client: PoolClient,
  actorStudentId: string,
  targetStudentId: string,
  classId: string,
  action: RosterAuditAction,
): Promise<void> {
  await client.query(
    `INSERT INTO lm_authorization_audit
       (actor_student_id, student_id, class_id, action)
     VALUES ($1, $2, $3, $4)`,
    [actorStudentId, targetStudentId, classId, action],
  );
}

/** Commit one roster enrollment only after its tenant and ownership checks are locked. */
async function provisionEnrollment(
  pool: Pool,
  actor: AuthedStudent,
  classId: string,
  email: string,
): Promise<RosterStudent> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertLockedRosterAccess(client, actor, classId);
    const provisioned = await findOrProvisionStudent(client, actor, email);
    if (provisioned.created) {
      await recordRosterAudit(
        client,
        actor.studentId,
        provisioned.student.student_id,
        classId,
        'roster.student_provisioned',
      );
    }
    const enrollment = await client.query(
      `INSERT INTO lm_enrollments (student_id, class_id, tenant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (student_id, class_id) DO NOTHING
       RETURNING student_id`,
      [provisioned.student.student_id, classId, actor.tenantId],
    );
    if (enrollment.rows.length > 0) {
      await recordRosterAudit(
        client,
        actor.studentId,
        provisioned.student.student_id,
        classId,
        'roster.enrollment_created',
      );
    }
    await client.query('COMMIT');
    return provisioned.student;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({ err: rollbackError, classId }, 'Roster transaction rollback failed');
    }
    throw err;
  } finally {
    client.release();
  }
}

/** List a class roster only after owner/admin authorization succeeds. */
async function listClassStudents(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const classId = String(req.params.classId);
    const actor = await resolveAuthedStudent(req, ctx.pool);
    await assertTeacherOfClass(ctx.pool, actor, classId);
    const result = await ctx.pool.query(
      `SELECT s.student_id, s.name, s.email, e.enrolled_at
         FROM lm_enrollments e
         JOIN lm_students s ON s.student_id = e.student_id
         JOIN lm_classes c ON c.class_id = e.class_id AND c.tenant_id = s.tenant_id
         JOIN lm_students a ON a.student_id = $2 AND a.tenant_id = c.tenant_id
        WHERE e.class_id = $1
          AND (a.role = 'admin' OR (a.role = 'teacher' AND c.teacher_student_id = a.student_id))
        ORDER BY s.name`,
      [classId, actor.studentId],
    );
    res.json({ students: result.rows });
  } catch (err: any) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Failed to list class students');
    res.status(500).json({ error: err.message });
  }
}

/** Add a student by email through the locked tenant-local provisioning flow. */
async function addClassStudent(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const classId = String(req.params.classId);
    const actor = await resolveAuthedStudent(req, ctx.pool);
    await assertTeacherOfClass(ctx.pool, actor, classId);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'a valid email is required' });
      return;
    }
    const student = await provisionEnrollment(ctx.pool, actor, classId, email);
    logger.info({ classId, studentId: student.student_id, byOwner: actor.studentId }, 'Student shared into class');
    res.status(201).json({ studentId: student.student_id, name: student.name, email });
  } catch (err: any) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Failed to add student to class');
    res.status(500).json({ error: err.message });
  }
}

/** Remove one tenant-local enrollment while preserving the student's private progress. */
async function removeClassStudent(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const classId = String(req.params.classId);
    const actor = await resolveAuthedStudent(req, ctx.pool);
    await assertTeacherOfClass(ctx.pool, actor, classId);
    if (req.params.studentId === actor.studentId) {
      res.status(400).json({ error: "the owner can't remove themselves" });
      return;
    }
    const result = await ctx.pool.query(
      `WITH authorized AS MATERIALIZED (
         SELECT c.class_id, c.tenant_id
           FROM lm_classes c
           JOIN lm_students a ON a.student_id = $3 AND a.tenant_id = c.tenant_id
          WHERE c.class_id = $1
            AND (a.role = 'admin' OR (a.role = 'teacher' AND c.teacher_student_id = a.student_id))
       ), removed AS (
         DELETE FROM lm_enrollments e USING lm_students s, authorized a
          WHERE e.class_id = a.class_id AND e.student_id = $2
            AND s.student_id = e.student_id AND s.tenant_id = a.tenant_id
         RETURNING e.student_id, e.class_id
       ), audited AS (
         INSERT INTO lm_authorization_audit
           (actor_student_id, student_id, class_id, action)
         SELECT $3, student_id, class_id, 'roster.enrollment_removed' FROM removed
         RETURNING 1
       )
       SELECT EXISTS (SELECT 1 FROM authorized) AS authorized,
              EXISTS (SELECT 1 FROM removed) AS removed,
              EXISTS (SELECT 1 FROM audited) AS audited`,
      [classId, req.params.studentId, actor.studentId],
    );
    if (!result.rows[0]?.authorized) {
      throw new EducationAccessError('You do not teach this class', 403);
    }
    res.json({ success: true });
  } catch (err: any) {
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Failed to remove student from class');
    res.status(500).json({ error: err.message });
  }
}

/** Return the permanent replacement contract for removed ID-based roster writes. */
function retireLegacyRosterWrite(_req: Request, res: Response): void {
  res.status(410).json({
    error: 'legacy_roster_endpoint_removed',
    message: 'Use POST /api/education/classes/:classId/students with a student email.',
  });
}

/**
 * @description Create the owner-gated, tenant-local class roster router.
 * @param ctx - package application context containing the database pool
 * @returns an Express router for roster reads, writes, and retired legacy routes
 */
export function createEducationRosterRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/classes/:classId/students', (req, res) => listClassStudents(ctx, req, res));
  router.post('/classes/:classId/students', (req, res) => addClassStudent(ctx, req, res));
  router.delete('/classes/:classId/students/:studentId', (req, res) => removeClassStudent(ctx, req, res));
  router.post('/students', retireLegacyRosterWrite);
  router.post('/enroll', retireLegacyRosterWrite);
  return router;
}
