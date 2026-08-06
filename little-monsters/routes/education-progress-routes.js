"use strict";
/**
 * Authenticated, server-scored student progress routes.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Extracted current-user, dashboard, XP, quiz-result, and health routes
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Added bounded activity awards and one-time server-authoritative quiz grading
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Minimize the locked quiz-attempt read to grading inputs and lifecycle state
 * ---------------------------------------------------------------------------
 *
 * @module education-progress-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationProgressRoutes = createEducationProgressRoutes;
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_dashboard_routes_1 = require("./education-dashboard-routes");
const education_access_1 = require("./education-access");
const education_progress_1 = require("./education-progress");
const logger = (0, logger_1.createChildLogger)({ module: 'education-progress-routes' });
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CLIENT_XP_COOLDOWNS = {
    notes_reviewed: 300,
    flashcard_session: 600,
    study_session: 900,
    game_warmup: 300,
    game_played: 300,
};
/** Map deliberate access failures to their public status. */
function sendAccessError(res, err) {
    if (!(err instanceof education_access_1.EducationAccessError))
        return false;
    res.status(err.status).json({ error: err.message });
    return true;
}
/** Resolve the signed-in student and their class count. */
async function getCurrentStudent(ctx, req, res) {
    try {
        const caller = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const classIds = await (0, education_access_1.listAccessibleClassIds)(ctx.pool, caller);
        res.json({
            studentId: caller.studentId,
            name: caller.name,
            email: caller.email,
            role: caller.role,
            classCount: classIds.length,
            isNew: classIds.length === 0,
        });
    }
    catch (err) {
        if (sendAccessError(res, err))
            return;
        logger.error({ err }, 'Failed to resolve current education user');
        res.status(500).json({ error: 'Failed to resolve current user' });
    }
}
/** Keep only small JSON metadata; it is descriptive and never affects the award. */
function safeActivityMetadata(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return {};
    try {
        const json = JSON.stringify(input);
        return json.length <= 2_000 ? JSON.parse(json) : {};
    }
    catch (err) {
        logger.warn({ err }, 'Discarded non-serializable client activity metadata');
        return {};
    }
}
/** Award only public activity types, once per server-controlled cooldown bucket. */
async function awardStudentActivity(ctx, req, res) {
    try {
        const eventType = String(req.body?.eventType || '');
        const cooldownSeconds = CLIENT_XP_COOLDOWNS[eventType];
        if (!cooldownSeconds) {
            res.status(400).json({ error: 'eventType is not available for client-submitted XP' });
            return;
        }
        const caller = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const bucket = Math.floor(Date.now() / (cooldownSeconds * 1_000));
        const dedupeKey = `client:${eventType}:${bucket}`;
        const output = await (0, education_progress_1.awardXP)(ctx, caller.studentId, eventType, safeActivityMetadata(req.body?.metadata), dedupeKey);
        res.json(output);
    }
    catch (err) {
        if (sendAccessError(res, err))
            return;
        logger.error({ err }, 'Failed to award bounded student activity XP');
        res.status(500).json({ error: 'Failed to award XP' });
    }
}
/** Validate submitted answer indexes without accepting any score from the client. */
function parseQuizAnswers(input) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 50) {
        throw new education_access_1.EducationAccessError('answers must be a non-empty array', 400);
    }
    const answers = input.map(value => Number(value));
    if (answers.some(value => !Number.isInteger(value) || value < 0 || value > 3)) {
        throw new education_access_1.EducationAccessError('each answer must be an option index from 0 through 3', 400);
    }
    return answers;
}
/** Compute the grade and post-completion review solely from stored questions. */
function gradeQuestions(attemptId, classId, questions, answers) {
    if (questions.length !== answers.length || questions.length === 0) {
        throw new education_access_1.EducationAccessError('answer count does not match this quiz attempt', 400);
    }
    const review = questions.map((question, index) => ({
        question: question.question,
        selectedIndex: answers[index],
        correctIndex: question.correctIndex,
        correct: answers[index] === question.correctIndex,
        correctAnswer: question.options[question.correctIndex],
        explanation: question.explanation || '',
        topic: question.topic || '',
    }));
    const correctAnswers = review.filter(item => item.correct).length;
    const topics = [...new Set(questions.map(question => String(question.topic || '')).filter(Boolean))];
    const missedQuestions = review.filter(item => !item.correct).map(item => String(item.question));
    return {
        attemptId, classId, correctAnswers, topics, missedQuestions, review,
        totalQuestions: questions.length,
        scorePercent: Math.round((correctAnswers / questions.length) * 100),
    };
}
/** Lock, grade, persist, and consume one quiz attempt in a single transaction. */
async function gradeQuizAttempt(client, caller, attemptId, answers) {
    const result = await client.query(`SELECT a.class_id, a.questions, a.expires_at, a.completed_at
       FROM lm_quiz_attempts a
       JOIN lm_classes c ON c.class_id = a.class_id
      WHERE a.attempt_id = $1 AND a.student_id = $2 AND c.tenant_id = $3
        AND ($4::boolean OR ($5::boolean AND c.teacher_student_id = $2)
          OR EXISTS (SELECT 1 FROM lm_enrollments e
             WHERE e.student_id = $2 AND e.class_id = c.class_id))
      FOR UPDATE OF a`, [attemptId, caller.studentId, caller.tenantId,
        caller.role === 'admin', caller.role === 'teacher']);
    const attempt = result.rows[0];
    if (!attempt)
        throw new education_access_1.EducationAccessError('Quiz attempt not found', 404);
    if (attempt.completed_at)
        throw new education_access_1.EducationAccessError('Quiz attempt was already completed', 409);
    if (new Date(attempt.expires_at).getTime() <= Date.now())
        throw new education_access_1.EducationAccessError('Quiz attempt expired', 410);
    const questions = attempt.questions;
    const grade = gradeQuestions(attemptId, attempt.class_id, questions, answers);
    await client.query(`INSERT INTO lm_quiz_results
       (student_id, class_id, score_percent, total_questions, correct_answers, topics, missed_questions)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`, [caller.studentId, grade.classId, grade.scorePercent, grade.totalQuestions, grade.correctAnswers,
        JSON.stringify(grade.topics), JSON.stringify(grade.missedQuestions)]);
    await client.query('UPDATE lm_quiz_attempts SET completed_at = NOW() WHERE attempt_id = $1', [attemptId]);
    return grade;
}
/** Handle transaction rollback without concealing the original grading failure. */
async function rollbackQuiz(client, cause) {
    try {
        await client.query('ROLLBACK');
    }
    catch (err) {
        logger.error({ err, cause }, 'Quiz grading transaction rollback failed');
    }
}
/** Grade a generated attempt once, then award idempotent server-derived XP. */
async function recordQuizResult(ctx, req, res) {
    const attemptId = String(req.body?.attemptId || '');
    try {
        if (!UUID_PATTERN.test(attemptId))
            throw new education_access_1.EducationAccessError('attemptId must be a UUID', 400);
        const answers = parseQuizAnswers(req.body?.answers);
        const caller = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const client = await ctx.pool.connect();
        let grade;
        try {
            await client.query('BEGIN');
            grade = await gradeQuizAttempt(client, caller, attemptId, answers);
            await client.query('COMMIT');
        }
        catch (err) {
            await rollbackQuiz(client, err);
            throw err;
        }
        finally {
            client.release();
        }
        await (0, education_progress_1.awardXP)(ctx, caller.studentId, 'quiz_completed', { attemptId }, `quiz:${attemptId}:completed`);
        if (grade.scorePercent >= 90) {
            await (0, education_progress_1.awardXP)(ctx, caller.studentId, 'quiz_high_score', { attemptId }, `quiz:${attemptId}:high-score`);
        }
        res.status(201).json({ success: true, ...grade });
    }
    catch (err) {
        if (sendAccessError(res, err))
            return;
        logger.error({ err, attemptId }, 'Failed to grade quiz attempt');
        res.status(500).json({ error: 'Failed to record quiz result' });
    }
}
/** Report database readiness without suppressing probe failures in logs. */
async function getEducationStatus(ctx, res) {
    let database = 'connected';
    try {
        await ctx.pool.query('SELECT 1');
    }
    catch (err) {
        database = 'unavailable';
        logger.error({ err }, 'Education status database probe failed');
    }
    res.json({
        platform: 'little-monsters',
        status: database === 'connected' ? 'healthy' : 'degraded',
        database,
        timestamp: new Date().toISOString(),
    });
}
/** Create authenticated identity, dashboard, bounded XP, quiz, and health routes. */
function createEducationProgressRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/me', (req, res) => getCurrentStudent(ctx, req, res));
    router.use((0, education_dashboard_routes_1.createEducationDashboardRoutes)(ctx, education_progress_1.levelFromXP));
    router.post('/xp', (req, res) => awardStudentActivity(ctx, req, res));
    router.post('/quiz-results', (req, res) => recordQuizResult(ctx, req, res));
    router.get('/status', (_req, res) => getEducationStatus(ctx, res));
    return router;
}
//# sourceMappingURL=education-progress-routes.js.map