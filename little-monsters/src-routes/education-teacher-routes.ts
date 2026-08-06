/**
 * Tenant-bound teacher analytics routes.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | roger.murphy@agenticfederal.us              | Added teacher class summaries and per-student progress analytics
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Added final tenant predicates so malformed enrollments cannot expose another school's student
 * ---------------------------------------------------------------------------
 *
 * @module education-teacher-routes
 */

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import {
  assertTeacher,
  assertTeacherOfClass,
  EducationAccessError,
  resolveAuthedStudent,
  type AuthedStudent,
} from './education-access';

const logger = createChildLogger({ module: 'education-teacher-routes' });

/** Map deliberate access failures to their public HTTP status. */
function sendAccessError(res: Response, err: unknown): boolean {
  if (!(err instanceof EducationAccessError)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

/** List active classes owned by this teacher inside their current tenant. */
async function listTeacherClasses(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const teacher = await resolveAuthedStudent(req, ctx.pool);
    assertTeacher(teacher);
    const result = await ctx.pool.query(
      `SELECT c.class_id, c.name, c.subject, c.grade_level,
        (SELECT COUNT(*) FROM lm_enrollments e WHERE e.class_id = c.class_id) AS student_count,
        (SELECT COUNT(*) FROM lm_lectures l WHERE l.class_id = c.class_id) AS lecture_count,
        (SELECT COUNT(*) FROM lm_flashcard_sets f WHERE f.class_id = c.class_id) AS flashcard_set_count,
        (SELECT ROUND(AVG(q.score_percent)) FROM lm_quiz_results q WHERE q.class_id = c.class_id) AS class_quiz_average
       FROM lm_classes c
       WHERE c.teacher_student_id = $1 AND c.tenant_id = $2 AND c.status = 'active'
       ORDER BY c.name`,
      [teacher.studentId, teacher.tenantId],
    );
    res.json({ classes: result.rows });
  } catch (err) {
    if (err instanceof EducationAccessError && req.query.surface === '1') {
      res.json({ allowed: false, classes: [], error: err.message });
      return;
    }
    if (sendAccessError(res, err)) return;
    logger.error({ err }, 'Failed to list teacher classes');
    res.status(500).json({ error: 'Failed to list teacher classes' });
  }
}

/** Load the class and roster with a redundant student-tenant predicate. */
async function loadClassAnalytics(ctx: AppContext, classId: string, teacher: AuthedStudent): Promise<any> {
  const [classResult, rosterResult] = await Promise.all([
    ctx.pool.query(
      `SELECT class_id, name, subject, grade_level FROM lm_classes
        WHERE class_id = $1 AND tenant_id = $2
          AND ($3::boolean OR teacher_student_id = $4)`,
      [classId, teacher.tenantId, teacher.role === 'admin', teacher.studentId],
    ),
    ctx.pool.query(
      `SELECT s.student_id, s.name, s.email, s.xp, s.level, s.streak_days, s.last_active_date,
        COALESCE(qa.avg_score, 0) AS quiz_average, COALESCE(qa.quiz_count, 0) AS quiz_count,
        COALESCE(fp.reviewed, 0) AS cards_reviewed
       FROM lm_enrollments e JOIN lm_students s ON s.student_id = e.student_id
       JOIN lm_classes c ON c.class_id = e.class_id
       LEFT JOIN (SELECT student_id, ROUND(AVG(score_percent)) AS avg_score, COUNT(*) AS quiz_count
         FROM lm_quiz_results WHERE class_id = $1 GROUP BY student_id) qa ON qa.student_id = s.student_id
       LEFT JOIN (SELECT p.student_id, COUNT(*) AS reviewed FROM lm_flashcard_progress p
         JOIN lm_flashcards f ON f.card_id = p.card_id JOIN lm_flashcard_sets fs ON fs.set_id = f.set_id
         WHERE fs.class_id = $1 AND p.last_reviewed IS NOT NULL GROUP BY p.student_id) fp ON fp.student_id = s.student_id
       WHERE e.class_id = $1 AND s.tenant_id = $2 AND c.tenant_id = $2
         AND ($3::boolean OR c.teacher_student_id = $4) ORDER BY s.name`,
      [classId, teacher.tenantId, teacher.role === 'admin', teacher.studentId],
    ),
  ]);
  return { classRow: classResult.rows[0], students: rosterResult.rows };
}

/** Compute class aggregates without trusting precomputed client values. */
function summarizeStudents(students: any[]): Record<string, number | null> {
  const withQuiz = students.filter(student => Number(student.quiz_count) > 0);
  const classQuizAverage = withQuiz.length
    ? Math.round(withQuiz.reduce((sum, student) => sum + Number(student.quiz_average), 0) / withQuiz.length)
    : null;
  return {
    studentCount: students.length,
    classQuizAverage,
    studentsWithActivity: students.filter(student => Number(student.quiz_count) > 0 || Number(student.cards_reviewed) > 0).length,
    totalCardsReviewed: students.reduce((sum, student) => sum + Number(student.cards_reviewed), 0),
  };
}

/** Return one owned class's analytics after tenant and ownership checks. */
async function getClassAnalytics(ctx: AppContext, req: Request, res: Response): Promise<void> {
  try {
    const classId = String(req.params.classId);
    const teacher = await resolveAuthedStudent(req, ctx.pool);
    await assertTeacherOfClass(ctx.pool, teacher, classId);
    const analytics = await loadClassAnalytics(ctx, classId, teacher);
    if (!analytics.classRow) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }
    res.json({
      class: analytics.classRow,
      summary: summarizeStudents(analytics.students),
      students: analytics.students,
    });
  } catch (err) {
    if (sendAccessError(res, err)) return;
    logger.error({ err, classId: req.params.classId }, 'Failed to load class analytics');
    res.status(500).json({ error: 'Failed to load class analytics' });
  }
}

/** Register the teacher-only analytics surface. */
export function createEducationTeacherRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/teacher/classes', (req, res) => listTeacherClasses(ctx, req, res));
  router.get('/teacher/classes/:classId/analytics', (req, res) => getClassAnalytics(ctx, req, res));
  return router;
}
