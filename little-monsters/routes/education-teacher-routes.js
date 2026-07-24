"use strict";
/**
 * Education Teacher Routes — Little Monsters
 *
 * Teacher-only analytics over the classes a teacher teaches: a roster with each
 * student's quiz average, cards reviewed, XP, and last-active, plus class-wide
 * aggregates. Gated by assertTeacher / assertTeacherOfClass — a student can never
 * reach these (403), and a teacher can only see classes they own. Reading their
 * own students' progress is the legitimate "school official" use under FERPA.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-06-13 12:40:00 | roger.murphy@agenticfederal.us   | Initial teacher analytics: GET /teacher/classes (overview) + /teacher/classes/:classId/analytics (roster + per-student progress)
 * ---------------------------------------------------------------------------
 *
 * @module education-teacher-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationTeacherRoutes = createEducationTeacherRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const logger = (0, logger_1.createChildLogger)({ module: 'education-teacher-routes' });
/** Map an EducationAccessError to its HTTP status; returns true if handled. */
function sendAccessError(res, err) {
    if (err instanceof education_access_1.EducationAccessError) {
        res.status(err.status).json({ error: err.message });
        return true;
    }
    return false;
}
/**
 * @description Teacher analytics sub-router mounted inside createEducationRoutes.
 * @param ctx - shared app context (db pool)
 * @returns an Express router with the /teacher/* analytics endpoints
 */
function createEducationTeacherRoutes(ctx) {
    const router = (0, express_1.Router)();
    /** GET /api/education/teacher/classes — classes this teacher teaches, with
     *  summary stats (enrolled count, lecture count, class-wide quiz average). */
    router.get('/teacher/classes', async (req, res) => {
        try {
            const teacher = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            (0, education_access_1.assertTeacher)(teacher);
            const result = await ctx.pool.query(`SELECT c.class_id, c.name, c.subject, c.grade_level,
           (SELECT COUNT(*) FROM lm_enrollments e WHERE e.class_id = c.class_id) AS student_count,
           (SELECT COUNT(*) FROM lm_lectures l WHERE l.class_id = c.class_id) AS lecture_count,
           (SELECT COUNT(*) FROM lm_flashcard_sets fs WHERE fs.class_id = c.class_id) AS flashcard_set_count,
           (SELECT ROUND(AVG(q.score_percent)) FROM lm_quiz_results q WHERE q.class_id = c.class_id) AS class_quiz_average
         FROM lm_classes c
         WHERE c.teacher_student_id = $1 AND c.status = 'active'
         ORDER BY c.name`, [teacher.studentId]);
            res.json({ classes: result.rows });
        }
        catch (err) {
            if (err instanceof education_access_1.EducationAccessError && req.query.surface === '1') {
                res.json({ allowed: false, classes: [], error: err.message });
                return;
            }
            if (sendAccessError(res, err))
                return;
            logger.error({ err }, 'Failed to list teacher classes');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /api/education/teacher/classes/:classId/analytics — roster + per-student
     *  progress for one class, plus class aggregates. Teacher-of-class only. */
    router.get('/teacher/classes/:classId/analytics', async (req, res) => {
        try {
            const classId = String(req.params.classId);
            const teacher = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
            await (0, education_access_1.assertTeacherOfClass)(ctx.pool, teacher, classId);
            const classRow = await ctx.pool.query('SELECT class_id, name, subject, grade_level FROM lm_classes WHERE class_id = $1', [classId]);
            if (classRow.rows.length === 0) {
                res.status(404).json({ error: 'Class not found' });
                return;
            }
            // Per-student progress for the enrolled roster.
            const roster = await ctx.pool.query(`SELECT s.student_id, s.name, s.email, s.xp, s.level, s.streak_days, s.last_active_date,
           COALESCE(qa.avg_score, 0) AS quiz_average,
           COALESCE(qa.quiz_count, 0) AS quiz_count,
           COALESCE(fp.reviewed, 0)  AS cards_reviewed
         FROM lm_enrollments e
         JOIN lm_students s ON s.student_id = e.student_id
         LEFT JOIN (
           SELECT student_id, ROUND(AVG(score_percent)) AS avg_score, COUNT(*) AS quiz_count
           FROM lm_quiz_results WHERE class_id = $1 GROUP BY student_id
         ) qa ON qa.student_id = s.student_id
         LEFT JOIN (
           SELECT fpr.student_id, COUNT(*) AS reviewed
           FROM lm_flashcard_progress fpr
           JOIN lm_flashcards fc ON fc.card_id = fpr.card_id
           JOIN lm_flashcard_sets fs ON fs.set_id = fc.set_id
           WHERE fs.class_id = $1 AND fpr.last_reviewed IS NOT NULL
           GROUP BY fpr.student_id
         ) fp ON fp.student_id = s.student_id
         WHERE e.class_id = $1
         ORDER BY s.name`, [classId]);
            const students = roster.rows;
            const withQuiz = students.filter((s) => Number(s.quiz_count) > 0);
            const classQuizAverage = withQuiz.length
                ? Math.round(withQuiz.reduce((sum, s) => sum + Number(s.quiz_average), 0) / withQuiz.length)
                : null;
            res.json({
                class: classRow.rows[0],
                summary: {
                    studentCount: students.length,
                    classQuizAverage,
                    studentsWithActivity: students.filter((s) => Number(s.quiz_count) > 0 || Number(s.cards_reviewed) > 0).length,
                    totalCardsReviewed: students.reduce((sum, s) => sum + Number(s.cards_reviewed), 0),
                },
                students,
            });
        }
        catch (err) {
            if (sendAccessError(res, err))
                return;
            logger.error({ err, classId: req.params.classId }, 'Failed to load class analytics');
            res.status(500).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=education-teacher-routes.js.map