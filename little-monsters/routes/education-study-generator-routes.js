"use strict";
/**
 * Education Study Generator Routes — Little Monsters Platform API
 *
 * Authorization is deliberately completed before credential probing, RAG
 * retrieval, or model invocation. Generated quizzes remain ephemeral; generated
 * class flashcards are persisted only after a second teacher/admin check.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Gate class study generation before external work and shared writes.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Persist expiring quiz attempts and withhold server-side answer keys from clients.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Bind study-model execution to the authenticated caller and package-owned education bot.
 * 4   | maintainer@emeraldcoastsystemsgroup.com | Flashcard and quiz generation take an optional topic (up to 200 characters) that titles the set and focuses retrieval.
 * 5   | maintainer@emeraldcoastsystemsgroup.com | Flashcard generation admits the class's owner (a student's own private class, the class teacher) or a tenant admin through authorizeLectureClassWrite instead of assertTeacherOfClass, which refused every student; the route binding moves to study.generate, which students hold.
 * 6   | maintainer@emeraldcoastsystemsgroup.com | The generated set answers studyUrl and the quiz answers quizUrl (relative Little Monsters pages), so Jarvis passes on the exact link: given only a path template, it invented https://littlemonsters.app/... links.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Flashcards from a book chapter: materialId + chapter make the chapter's text (readBookChapter, the material read rule) the cards' source and title the set "<book>: Chapter N: <title>"; the book must belong to the class, and a missing chapter answers 404 with the chapters the book has.
 * ---------------------------------------------------------------------------
 *
 * @module education-study-generator-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationStudyGeneratorRoutes = createEducationStudyGeneratorRoutes;
const crypto_1 = require("crypto");
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const education_lecture_security_1 = require("./education-lecture-security");
const education_study_errors_1 = require("./education-study-errors");
const education_study_model_1 = require("./education-study-model");
const education_study_store_1 = require("./education-study-store");
const education_book_routes_1 = require("./education-book-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'education-study-generator-routes' });
function requiredClassId(req) {
    const classId = String(req.body?.classId || '');
    if (!classId)
        throw new education_study_errors_1.StudyHttpError('classId is required', 400);
    return classId;
}
function callerSub(req) {
    const user = req.oidc?.user;
    const sub = user?.sub || user?.oid;
    if (!sub)
        throw new education_study_errors_1.StudyHttpError('Not authenticated', 401);
    return String(sub);
}
function fail(res, error, operation) {
    if ((0, education_study_errors_1.sendStudyError)(res, error))
        return;
    logger.error({ err: error, operation }, 'Study generation failed');
    res.status(500).json({ error: `${operation} failed` });
}
/** Keep grading data server-side while returning only question-taking fields. */
function publicQuizQuestions(questions) {
    return questions.map(({ question, options, topic }) => ({ question, options, topic }));
}
/** Rebind class access in the attempt INSERT so authorization cannot go stale. */
async function persistQuizAttempt(ctx, actor, classId, questions) {
    const attemptId = (0, crypto_1.randomUUID)();
    const result = await ctx.pool.query(`INSERT INTO lm_quiz_attempts
       (attempt_id, student_id, class_id, questions, expires_at)
     SELECT $1, $2, c.class_id, $3::jsonb, NOW() + INTERVAL '30 minutes'
       FROM lm_classes c
      WHERE c.class_id = $4 AND c.tenant_id = $5
        AND ($6::boolean OR ($7::boolean AND c.teacher_student_id = $2)
          OR EXISTS (SELECT 1 FROM lm_enrollments e
              WHERE e.student_id = $2 AND e.class_id = c.class_id))
     RETURNING attempt_id`, [attemptId, actor.studentId, JSON.stringify(questions), classId,
        actor.tenantId, actor.role === 'admin', actor.role === 'teacher']);
    if (!result.rows[0])
        throw (0, education_study_errors_1.studyResourceNotFound)();
    return result.rows[0].attempt_id;
}
/** A chapter source the request names (materialId + chapter): read under the material rule, in this class. */
async function chapterSource(ctx, actor, req, classId) {
    const materialId = typeof req.body?.materialId === 'string' ? req.body.materialId.trim() : '';
    if (!materialId)
        return null;
    const chapter = await (0, education_book_routes_1.readBookChapter)(ctx, actor, materialId, Number(req.body?.chapter));
    if (chapter.classId !== classId)
        throw new education_study_errors_1.StudyHttpError('That book belongs to a different class', 400);
    if (!chapter.found) {
        const known = chapter.chapters.length ? `Its chapters: ${chapter.chapters.join('; ')}.` : 'Its text has no chapter headings.';
        throw new education_study_errors_1.StudyHttpError(`Chapter ${chapter.number} was not found in ${chapter.title}. ${known}`, 404);
    }
    const heading = chapter.heading || `Chapter ${chapter.number}`;
    return { title: chapter.title, heading, source: `${chapter.title}, ${heading}\n\n${chapter.text}` };
}
async function generateFlashcards(req, res, ctx) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const classId = requiredClassId(req);
        await (0, education_lecture_security_1.authorizeLectureClassWrite)(ctx.pool, actor, classId);
        const studyClass = await (0, education_study_model_1.loadStudyClass)(ctx.pool, actor, classId);
        const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim().slice(0, 200) : '';
        const book = await chapterSource(ctx, actor, req, classId);
        const cards = await (0, education_study_model_1.generateStudyCards)(ctx, callerSub(req), actor.studentId, studyClass, req.body?.count, topic || book?.heading || undefined, book?.source);
        const created = await (0, education_study_store_1.createStudySet)(ctx.pool, actor, {
            classId,
            title: book ? `${book.title}: ${book.heading}`
                : topic ? `Topic: ${topic} (${studyClass.className})` : `Auto: ${studyClass.className} key concepts`,
            topic: topic || book?.heading || studyClass.subject,
            sourceType: 'textbook',
            sourceReference: book ? `${book.title}, ${book.heading}`
                : topic ? `auto-generated for topic: ${topic}` : 'auto-generated from class materials',
            cards,
        });
        logger.info({ classId, ...created }, 'Generated class flashcards from authorized materials');
        res.status(201).json({ ...created, grounded: true, cards,
      studyUrl: `/api/education/flashcards?setId=${encodeURIComponent(created.setId)}&classId=${encodeURIComponent(classId)}` });
    }
    catch (error) {
        fail(res, error, 'Flashcard generation');
    }
}
async function generateQuiz(req, res, ctx) {
    try {
        const actor = await (0, education_access_1.resolveAuthedStudent)(req, ctx.pool);
        const classId = requiredClassId(req);
        await (0, education_access_1.assertClassAccess)(ctx.pool, actor, classId);
        const studyClass = await (0, education_study_model_1.loadStudyClass)(ctx.pool, actor, classId);
        const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim().slice(0, 200) : '';
        const questions = await (0, education_study_model_1.generateStudyQuiz)(ctx, callerSub(req), actor.studentId, studyClass, req.body?.count, topic || undefined);
        const attemptId = await persistQuizAttempt(ctx, actor, classId, questions);
        const publicQuestions = publicQuizQuestions(questions);
        logger.info({ classId, attemptId, questionCount: questions.length }, 'Generated authorized class quiz attempt');
        res.json({
            attemptId,
            classId,
            className: studyClass.className,
            questionCount: questions.length,
            grounded: true,
            questions: publicQuestions,
      quizUrl: `/api/education/quiz?classId=${encodeURIComponent(classId)}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`,
        });
    }
    catch (error) {
        fail(res, error, 'Quiz generation');
    }
}
/** Register RAG-grounded flashcard and ephemeral quiz generation endpoints. */
function createEducationStudyGeneratorRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.post('/flashcards/generate', (req, res) => generateFlashcards(req, res, ctx));
    router.post('/quiz/generate', (req, res) => generateQuiz(req, res, ctx));
    return router;
}
//# sourceMappingURL=education-study-generator-routes.js.map