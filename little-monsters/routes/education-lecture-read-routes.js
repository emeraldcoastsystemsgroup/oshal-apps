"use strict";
/**
 * Little Monsters lecture read and export routes.
 *
 * Every lecture artifact is authorized through its owning class and every
 * persisted pointer is revalidated against the class workspace before read or
 * send. Client responses use fixed projections and never expose server paths.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add class-authorized lecture reads/exports, fixed response projections, and fail-closed persisted artifact containment.
 * -----------------------------------------------------------------------------
 *
 * @module education-lecture-read-routes
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationLectureReadRoutes = createEducationLectureReadRoutes;
const fs_1 = __importDefault(require("fs"));
const express_1 = require("express");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const education_pptx_1 = require("./education-pptx");
const education_lecture_security_1 = require("./education-lecture-security");
const logger = (0, logger_1.createChildLogger)({ module: 'education-lecture-read-routes' });
const MAX_TEXT_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_SLIDES_ARTIFACT_BYTES = 2 * 1024 * 1024;
/** Read a bounded UTF-8 artifact only after containment was proven. */
function readArtifact(classId, storedPath, maxBytes) {
    const safePath = (0, education_lecture_security_1.resolvePersistedLectureFile)(classId, storedPath);
    const size = fs_1.default.statSync(safePath).size;
    if (size > maxBytes)
        throw new education_lecture_security_1.LectureRouteError('Lecture artifact is unavailable', 404);
    return fs_1.default.readFileSync(safePath, 'utf8');
}
/** Normalize persisted slides so unexpected keys never reach the response/export. */
function parseLectureDeck(lecture) {
    if (!lecture.slides_path)
        throw new education_lecture_security_1.LectureRouteError('No slides were generated for this lecture', 404);
    const raw = readArtifact(lecture.class_id, lecture.slides_path, MAX_SLIDES_ARTIFACT_BYTES);
    let value;
    try {
        value = JSON.parse(raw);
    }
    catch (error) {
        logger.error({ err: error, lectureId: lecture.lecture_id }, 'Persisted lecture slides are invalid');
        throw new education_lecture_security_1.LectureRouteError('Lecture slides are unavailable', 404);
    }
    const slides = Array.isArray(value.slides)
        ? value.slides.filter((slide) => slide && typeof slide.title === 'string')
            .map((slide) => ({
            title: String(slide.title).slice(0, 120),
            bullets: Array.isArray(slide.bullets)
                ? slide.bullets.map((bullet) => String(bullet).slice(0, 200)).slice(0, 6) : [],
            emoji: typeof slide.emoji === 'string' ? slide.emoji.slice(0, 8) : '',
        })).slice(0, 16)
        : [];
    if (!slides.length)
        throw new education_lecture_security_1.LectureRouteError('Lecture slides are unavailable', 404);
    return { title: String(value.title || lecture.class_name || 'Lecture').slice(0, 200), slides };
}
/** Handle GET /lectures with a path-free fixed database projection. */
async function listLectures(ctx, req, res) {
    const startedAt = Date.now();
    logger.info({ route: 'lectures-list' }, 'Lecture list entered');
    try {
        const classId = String(req.query.classId || '');
        if (!(0, education_lecture_security_1.isUuid)(classId))
            throw new education_lecture_security_1.LectureRouteError('classId query parameter must be a UUID', 400);
        const actor = await (0, education_lecture_security_1.resolveLectureActor)(req, ctx.pool);
        await (0, education_access_1.assertClassAccess)(ctx.pool, actor, classId);
        const result = await ctx.pool.query(`SELECT lecture_id, class_id, lecture_date, status, duration_seconds,
              flashcard_set_id, created_at,
              (transcript_path IS NOT NULL) AS has_transcript,
              (notes_path IS NOT NULL) AS has_notes,
              (slides_path IS NOT NULL) AS has_slides,
              (audio_path IS NOT NULL) AS has_audio
         FROM lm_lectures
        WHERE class_id = $1
        ORDER BY lecture_date DESC, created_at DESC`, [classId]);
        logger.info({ classId, count: result.rows.length, ms: Date.now() - startedAt }, 'Lectures listed');
        res.json({ lectures: result.rows });
    }
    catch (error) {
        logger.error({ err: error, ms: Date.now() - startedAt }, 'Failed to list lectures');
        if (!(0, education_lecture_security_1.sendLectureRouteError)(res, error))
            res.status(500).json({ error: 'Failed to list lectures' });
    }
}
/** Parse a bounded recent-list limit. */
function recentLimit(value) {
    const parsed = Number.parseInt(String(value || '8'), 10);
    return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : 8, 25);
}
/** Handle the dashboard's recent lecture strip across accessible classes. */
async function listRecentLectures(ctx, req, res) {
    const startedAt = Date.now();
    logger.info({ route: 'lectures-recent' }, 'Recent lecture list entered');
    try {
        const actor = await (0, education_lecture_security_1.resolveLectureActor)(req, ctx.pool);
        const accessible = await (0, education_access_1.listAccessibleClassIds)(ctx.pool, actor);
        if (!accessible.length) {
            logger.info({ count: 0, ms: Date.now() - startedAt }, 'Recent lectures listed');
            res.json({ lectures: [] });
            return;
        }
        const result = await ctx.pool.query(`SELECT l.lecture_id, l.class_id, l.created_at, l.lecture_date, l.flashcard_set_id,
              (l.slides_path IS NOT NULL) AS has_slides,
              (l.notes_path IS NOT NULL) AS has_notes,
              (l.audio_path IS NOT NULL) AS has_audio,
              (l.transcript_path IS NOT NULL) AS has_transcript,
              c.name AS class_name, c.subject
         FROM lm_lectures l
         JOIN lm_classes c ON c.class_id = l.class_id
        WHERE l.status = 'complete' AND l.class_id = ANY($2)
        ORDER BY l.created_at DESC
        LIMIT $1`, [recentLimit(req.query.limit), accessible]);
        logger.info({ count: result.rows.length, ms: Date.now() - startedAt }, 'Recent lectures listed');
        res.json({ lectures: result.rows });
    }
    catch (error) {
        logger.error({ err: error, ms: Date.now() - startedAt }, 'Failed to list recent lectures');
        if (!(0, education_lecture_security_1.sendLectureRouteError)(res, error))
            res.status(500).json({ error: 'Failed to list recent lectures' });
    }
}
/** Build lecture detail after access and artifact containment checks. */
function lectureDetail(lecture) {
    const detail = (0, education_lecture_security_1.publicLecture)(lecture);
    if (lecture.transcript_path) {
        detail.transcript = readArtifact(lecture.class_id, lecture.transcript_path, MAX_TEXT_ARTIFACT_BYTES);
    }
    if (lecture.notes_path) {
        detail.notes = readArtifact(lecture.class_id, lecture.notes_path, MAX_TEXT_ARTIFACT_BYTES);
    }
    return detail;
}
/** Handle one class-authorized lecture detail response. */
async function getLecture(ctx, req, res) {
    const startedAt = Date.now();
    logger.info({ route: 'lecture-detail' }, 'Lecture detail entered');
    try {
        const lecture = await (0, education_lecture_security_1.loadAuthorizedLecture)(ctx, req, String(req.params.lectureId), 'read');
        res.json(lectureDetail(lecture));
        logger.info({ lectureId: lecture.lecture_id, ms: Date.now() - startedAt }, 'Lecture detail returned');
    }
    catch (error) {
        logger.error({ err: error, ms: Date.now() - startedAt }, 'Failed to get lecture');
        if (!(0, education_lecture_security_1.sendLectureRouteError)(res, error))
            res.status(500).json({ error: 'Failed to get lecture' });
    }
}
/** Handle one class-authorized slide deck response. */
async function getLectureSlides(ctx, req, res) {
    const startedAt = Date.now();
    logger.info({ route: 'lecture-slides' }, 'Lecture slides entered');
    try {
        const lecture = await (0, education_lecture_security_1.loadAuthorizedLecture)(ctx, req, String(req.params.lectureId), 'read');
        const deck = parseLectureDeck(lecture);
        res.json({
            lectureId: lecture.lecture_id, classId: lecture.class_id,
            className: lecture.class_name, lectureDate: lecture.lecture_date,
            title: deck.title, slides: deck.slides,
        });
        logger.info({ lectureId: lecture.lecture_id, ms: Date.now() - startedAt }, 'Lecture slides returned');
    }
    catch (error) {
        logger.error({ err: error, ms: Date.now() - startedAt }, 'Failed to load lecture slides');
        if (!(0, education_lecture_security_1.sendLectureRouteError)(res, error))
            res.status(500).json({ error: 'Failed to load lecture slides' });
    }
}
/** Handle one class-authorized PowerPoint render and save. */
async function exportLecturePowerPoint(ctx, req, res) {
    const startedAt = Date.now();
    logger.info({ route: 'lecture-pptx' }, 'Lecture PowerPoint export entered');
    try {
        const subject = req.oidc?.user?.sub || req.oidc?.user?.oid;
        if (!subject)
            throw new education_lecture_security_1.LectureRouteError('not_authenticated', 401);
        const lecture = await (0, education_lecture_security_1.loadAuthorizedLecture)(ctx, req, String(req.params.lectureId), 'read');
        const deck = parseLectureDeck(lecture);
        const saved = await (0, education_pptx_1.renderAndSaveLectureDeck)(ctx, String(subject), deck.title, deck.slides);
        res.json({ ok: true, ...saved });
        logger.info({ lectureId: lecture.lecture_id, ms: Date.now() - startedAt }, 'Lecture PowerPoint exported');
    }
    catch (error) {
        logger.error({ err: error, ms: Date.now() - startedAt }, 'Lecture PowerPoint export failed');
        if (!(0, education_lecture_security_1.sendLectureRouteError)(res, error))
            res.status(502).json({ error: 'Lecture export failed' });
    }
}
/** Handle one class-authorized recording stream. */
async function streamLectureAudio(ctx, req, res) {
    const startedAt = Date.now();
    logger.info({ route: 'lecture-audio' }, 'Lecture audio stream entered');
    try {
        const lecture = await (0, education_lecture_security_1.loadAuthorizedLecture)(ctx, req, String(req.params.lectureId), 'read');
        if (!lecture.audio_path)
            throw new education_lecture_security_1.LectureRouteError('No recording saved for this lecture', 404);
        const safePath = (0, education_lecture_security_1.resolvePersistedLectureFile)(lecture.class_id, lecture.audio_path);
        logger.info({ lectureId: lecture.lecture_id, ms: Date.now() - startedAt }, 'Lecture recording streamed');
        res.sendFile(safePath);
    }
    catch (error) {
        logger.error({ err: error, ms: Date.now() - startedAt }, 'Failed to stream lecture recording');
        if (!(0, education_lecture_security_1.sendLectureRouteError)(res, error))
            res.status(500).json({ error: 'Failed to stream lecture recording' });
    }
}
/**
 * @description Create class-authorized lecture list, detail, artifact, and export endpoints.
 * @param ctx - app context with database and storage services
 * @returns router containing the lecture read/export surface
 */
function createEducationLectureReadRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/lectures', (req, res) => listLectures(ctx, req, res));
    // Register the literal route first so Express never captures "recent" as an id.
    router.get('/lectures/recent', (req, res) => listRecentLectures(ctx, req, res));
    router.get('/lectures/:lectureId', (req, res) => getLecture(ctx, req, res));
    router.get('/lectures/:lectureId/slides', (req, res) => getLectureSlides(ctx, req, res));
    router.post('/lectures/:lectureId/pptx', (req, res) => exportLecturePowerPoint(ctx, req, res));
    router.get('/lectures/:lectureId/audio', (req, res) => streamLectureAudio(ctx, req, res));
    return router;
}
//# sourceMappingURL=education-lecture-read-routes.js.map