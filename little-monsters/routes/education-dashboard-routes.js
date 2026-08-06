"use strict";
/**
 * Little Monsters private student-dashboard routes.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Extract the tenant-aware dashboard role matrix and teacher-scoped aggregates so each private-data query remains independently reviewable.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Recheck the viewer's current tenant, role, and active teacher relationship in the final student-PII query.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationDashboardRoutes = createEducationDashboardRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const logger = (0, logger_1.createChildLogger)({ module: 'education-dashboard-routes' });
/** Map an EducationAccessError to its intentional client response. */
function sendAccessError(res, err) {
    if (!(err instanceof education_access_1.EducationAccessError))
        return false;
    res.status(err.status).json({ error: err.message });
    return true;
}
/** Build the shared parameter list that prevents teacher aggregate overreach. */
function dashboardScope(viewer, studentId) {
    if (viewer.role === 'teacher') {
        return {
            params: [studentId, viewer.tenantId, viewer.studentId],
            teacherClause: ' AND c.teacher_student_id = $3',
        };
    }
    return { params: [studentId, viewer.tenantId], teacherClause: '' };
}
/** Read only the student fields intentionally exposed by the dashboard contract. */
async function loadDashboardStudent(pool, viewer, studentId) {
    const result = await pool.query(`SELECT target.student_id, target.name, target.email, target.xp,
            target.level, target.streak_days, target.last_active_date
       FROM lm_students target
       JOIN lm_students viewer
         ON viewer.student_id = $2 AND viewer.tenant_id = target.tenant_id
      WHERE target.student_id = $1
        AND (viewer.student_id = target.student_id OR viewer.role = 'admin' OR (
          viewer.role = 'teacher' AND EXISTS (
            SELECT 1
              FROM lm_enrollments e
              JOIN lm_classes c ON c.class_id = e.class_id AND c.tenant_id = e.tenant_id
             WHERE e.student_id = target.student_id
               AND e.tenant_id = target.tenant_id
               AND c.teacher_student_id = viewer.student_id
               AND c.status = 'active'
          )
        ))`, [studentId, viewer.studentId]);
    return result.rows[0] || null;
}
/** Load only active enrolled classes visible through the viewer's aggregate scope. */
async function loadDashboardClasses(pool, scope) {
    const result = await pool.query(`SELECT c.class_id, c.name, c.subject, c.grade_level, c.teacher_name,
       (SELECT COUNT(*) FROM lm_lectures l WHERE l.class_id = c.class_id) as lecture_count,
       (SELECT COALESCE(SUM(card_count), 0) FROM lm_flashcard_sets fs WHERE fs.class_id = c.class_id) as flashcard_count
       FROM lm_classes c JOIN lm_enrollments e ON c.class_id = e.class_id
      WHERE e.student_id = $1 AND c.tenant_id = $2
        AND c.status = 'active'${scope.teacherClause}`, scope.params);
    return result.rows;
}
/** Load upcoming work without exposing assignments from an unrelated teacher's class. */
async function loadUpcomingAssignments(pool, scope) {
    const result = await pool.query(`SELECT a.assignment_id, a.title, a.description, a.assignment_type,
            a.due_date, a.status, c.name as class_name
       FROM lm_assignments a
       JOIN lm_classes c ON a.class_id = c.class_id
       JOIN lm_enrollments e ON c.class_id = e.class_id
      WHERE e.student_id = $1 AND c.tenant_id = $2${scope.teacherClause}
        AND a.status = 'active' AND (a.due_date >= CURRENT_DATE OR a.due_date IS NULL)
      ORDER BY a.due_date ASC NULLS LAST LIMIT 10`, scope.params);
    return result.rows;
}
/** Calculate quiz aggregates inside the viewer's permitted class boundary. */
async function loadQuizStats(pool, viewer, scope) {
    if (viewer.role === 'teacher') {
        return (await pool.query(`SELECT COALESCE(AVG(q.score_percent), 0) as avg_score, COUNT(*) as quiz_count
         FROM lm_quiz_results q JOIN lm_classes c ON c.class_id = q.class_id
        WHERE q.student_id = $1 AND c.tenant_id = $2 AND c.teacher_student_id = $3`, scope.params)).rows[0];
    }
    return (await pool.query(`SELECT COALESCE(AVG(q.score_percent), 0) as avg_score, COUNT(*) as quiz_count
       FROM lm_quiz_results q LEFT JOIN lm_classes c ON c.class_id = q.class_id
      WHERE q.student_id = $1 AND (q.class_id IS NULL OR c.tenant_id = $2)`, scope.params)).rows[0];
}
/** Count reviewed cards inside the viewer's permitted class boundary. */
async function loadFlashcardStats(pool, viewer, scope) {
    const joins = `FROM lm_flashcard_progress fp
    JOIN lm_flashcards fc ON fc.card_id = fp.card_id
    JOIN lm_flashcard_sets fs ON fs.set_id = fc.set_id`;
    if (viewer.role === 'teacher') {
        return (await pool.query(`SELECT COUNT(*) as reviewed ${joins}
       JOIN lm_classes c ON c.class_id = fs.class_id
       WHERE fp.student_id = $1 AND fp.last_reviewed IS NOT NULL
         AND c.tenant_id = $2 AND c.teacher_student_id = $3`, scope.params)).rows[0];
    }
    return (await pool.query(`SELECT COUNT(*) as reviewed ${joins}
     LEFT JOIN lm_classes c ON c.class_id = fs.class_id
     WHERE fp.student_id = $1 AND fp.last_reviewed IS NOT NULL
       AND (fs.class_id IS NULL OR c.tenant_id = $2)`, scope.params)).rows[0];
}
/** Load the complete dashboard response data after the role decision has succeeded. */
async function loadDashboardData(pool, viewer, studentId) {
    const scope = dashboardScope(viewer, studentId);
    const [classes, upcoming, quiz, flashcards] = await Promise.all([
        loadDashboardClasses(pool, scope),
        loadUpcomingAssignments(pool, scope),
        loadQuizStats(pool, viewer, scope),
        loadFlashcardStats(pool, viewer, scope),
    ]);
    return {
        classes,
        upcoming,
        quizAverage: Math.round(quiz.avg_score),
        quizCount: parseInt(quiz.quiz_count),
        flashcardsReviewed: parseInt(flashcards.reviewed),
    };
}
/** Serve one private dashboard after enforcing the complete viewer role matrix. */
async function getStudentDashboard(ctx, levelFromXP, req, res) {
    try {
        const viewer = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const studentId = String(req.params.studentId);
        await (0, education_access_1.assertCanViewStudent)(ctx.pool, viewer, studentId);
        const student = await loadDashboardStudent(ctx.pool, viewer, studentId);
        if (!student) {
            res.status(404).json({ error: 'Student not found' });
            return;
        }
        const data = await loadDashboardData(ctx.pool, viewer, studentId);
        res.json({
            student: { ...student, level: levelFromXP(student.xp) },
            classes: data.classes,
            upcoming: data.upcoming,
            stats: {
                quizAverage: data.quizAverage,
                quizCount: data.quizCount,
                flashcardsReviewed: data.flashcardsReviewed,
            },
        });
    }
    catch (err) {
        if (sendAccessError(res, err))
            return;
        logger.error({ err }, 'Failed to get dashboard');
        res.status(500).json({ error: err.message });
    }
}
/**
 * @description Create the private student-dashboard router with tenant-aware aggregates.
 * @param ctx - package application context containing the database pool
 * @param levelFromXP - canonical package level calculator used by the dashboard response
 * @returns an Express router exposing the private dashboard endpoint
 */
function createEducationDashboardRoutes(ctx, levelFromXP) {
    const router = (0, express_1.Router)();
    router.get('/student/:studentId/dashboard', (req, res) => getStudentDashboard(ctx, levelFromXP, req, res));
    return router;
}
//# sourceMappingURL=education-dashboard-routes.js.map