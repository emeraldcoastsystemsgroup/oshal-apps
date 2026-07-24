/**
 * Education Catalog Routes — Little Monsters "Class Bank"
 *
 * The class bank is the school-wide catalog of PUBLISHED classes (teachers
 * provide them; published = true). Any signed-in member can browse the bank and
 * self-enroll into a published class — it then appears on their dashboard and
 * ribbon (the ribbon is enrollment-scoped, so joining is what makes it show).
 *
 * Private classes (a student's own homeroom, published = false) never appear in
 * the bank and can't be self-enrolled into by others — only the owner is in them
 * until they explicitly share by email (see /classes/:id/students in
 * education-routes). This keeps "teacher-published, student self-selects" and
 * "my own private class" as two distinct, non-leaking surfaces.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-06-13 14:10:00 | roger.murphy@agenticfederal.us   | Initial class bank: GET /catalog (published classes + per-caller enrolled flag), POST /classes/:id/enroll (self-enroll into a published class), POST /classes/:id/leave (self-unenroll; owner can't leave)
 * ---------------------------------------------------------------------------
 *
 * @module education-catalog-routes
 */

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { resolveAuthedStudent, EducationAccessError } from './education-access';

const logger = createChildLogger({ module: 'education-catalog-routes' });

/** Map an EducationAccessError to its HTTP status; returns true if handled. */
function sendAccessError(res: Response, err: unknown): boolean {
  if (err instanceof EducationAccessError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

/**
 * @description Class-bank sub-router mounted inside createEducationRoutes.
 * @param ctx - shared app context (db pool)
 * @returns an Express router with the catalog + self-enroll endpoints
 */
export function createEducationCatalogRoutes(ctx: AppContext): Router {
  const router = Router();

  /** GET /api/education/catalog — the school-wide class bank: every PUBLISHED,
   *  active class, each flagged with whether the caller is already enrolled so
   *  the UI can show Join vs. Joined. School-wide on purpose (not enrollment
   *  scoped) — discovery is the point of the bank. */
  router.get('/catalog', async (req: Request, res: Response) => {
    try {
      const me = await resolveAuthedStudent(req, ctx.pool);
      // Scoped to the caller's school (tenant) — the bank only shows classes
      // published within your own school, never another tenant's.
      const result = await ctx.pool.query(
        `SELECT c.class_id, c.name, c.subject, c.grade_level, c.teacher_name,
           (SELECT COUNT(*) FROM lm_enrollments e WHERE e.class_id = c.class_id) AS student_count,
           EXISTS(SELECT 1 FROM lm_enrollments e WHERE e.class_id = c.class_id AND e.student_id = $1) AS enrolled
         FROM lm_classes c
         WHERE c.published = true AND c.status = 'active' AND c.tenant_id = $2
         ORDER BY c.subject, c.name`,
        [me.studentId, me.tenantId],
      );
      res.json({ classes: result.rows });
    } catch (err: any) {
      if (sendAccessError(res, err)) return;
      logger.error({ err }, 'Failed to load class catalog');
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/education/classes/:classId/enroll — the caller self-enrolls into a
   *  published class. A private class can only be joined by its owner (others get
   *  403); a non-active class is rejected. Idempotent (re-enroll is a no-op). */
  router.post('/classes/:classId/enroll', async (req: Request, res: Response) => {
    try {
      const classId = String(req.params.classId);
      const me = await resolveAuthedStudent(req, ctx.pool);
      const row = (await ctx.pool.query(
        'SELECT published, status, teacher_student_id FROM lm_classes WHERE class_id = $1',
        [classId],
      )).rows[0];
      if (!row) {
        res.status(404).json({ error: 'class not found' });
        return;
      }
      const isOwner = row.teacher_student_id === me.studentId;
      if (!row.published && !isOwner) {
        throw new EducationAccessError("this class isn't open for self-enrollment", 403);
      }
      if (row.status !== 'active') {
        res.status(400).json({ error: 'this class is not currently active' });
        return;
      }
      await ctx.pool.query(
        `INSERT INTO lm_enrollments (student_id, class_id) VALUES ($1, $2) ON CONFLICT (student_id, class_id) DO NOTHING`,
        [me.studentId, classId],
      );
      logger.info({ classId, studentId: me.studentId }, 'Student self-enrolled from class bank');
      res.status(201).json({ success: true, classId, enrolled: true });
    } catch (err: any) {
      if (sendAccessError(res, err)) return;
      logger.error({ err, classId: req.params.classId }, 'Failed to self-enroll');
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/education/classes/:classId/leave — the caller removes a class from
   *  their own screen (self-unenroll). The owner can't leave their own class
   *  (archive or delete it instead). The student's private progress is untouched. */
  router.post('/classes/:classId/leave', async (req: Request, res: Response) => {
    try {
      const classId = String(req.params.classId);
      const me = await resolveAuthedStudent(req, ctx.pool);
      const row = (await ctx.pool.query(
        'SELECT teacher_student_id FROM lm_classes WHERE class_id = $1',
        [classId],
      )).rows[0];
      if (!row) {
        res.status(404).json({ error: 'class not found' });
        return;
      }
      if (row.teacher_student_id === me.studentId) {
        res.status(400).json({ error: "you own this class — archive or delete it instead of leaving" });
        return;
      }
      await ctx.pool.query('DELETE FROM lm_enrollments WHERE class_id = $1 AND student_id = $2', [classId, me.studentId]);
      logger.info({ classId, studentId: me.studentId }, 'Student left class');
      res.json({ success: true, classId, enrolled: false });
    } catch (err: any) {
      if (sendAccessError(res, err)) return;
      logger.error({ err, classId: req.params.classId }, 'Failed to leave class');
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
