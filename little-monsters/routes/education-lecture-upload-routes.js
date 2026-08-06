"use strict";
/**
 * Little Monsters lecture upload routes.
 *
 * Large upload parsing remains memory-only; every durable operation begins only
 * after a read-only identity lookup and tenant-bound teacher/admin decision.
 * Server-selected, content-derived filenames prevent path traversal, extension
 * spoofing, and accidental replacement of an earlier class recording.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add authorization-first lecture/audio uploads with content sniffing, random exclusive files, and contained class workspaces.
 * -----------------------------------------------------------------------------
 *
 * @module education-lecture-upload-routes
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEducationLectureUploadRoutes = createEducationLectureUploadRoutes;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const express_1 = require("express");
const internal_ticket_1 = require("@/entities/ticket/internal-ticket");
const logger_1 = require("@/shared/logger");
const education_voice_routes_1 = require("./education-voice-routes");
const education_lecture_security_1 = require("./education-lecture-security");
const logger = (0, logger_1.createChildLogger)({ module: 'education-lecture-upload-routes' });
/** Construct a memory-only multer middleware with a route-specific cap. */
function singleAudioUpload(limit) {
    const multer = require('multer');
    return multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: limit },
    }).single('audio');
}
/** Parse and validate every client-controlled processing field without side effects. */
function processLectureInput(req) {
    const classId = String(req.body?.classId || '');
    if (!(0, education_lecture_security_1.isUuid)(classId))
        throw new education_lecture_security_1.LectureRouteError('classId must be a UUID', 400);
    const file = req.file;
    if (!file?.buffer)
        throw new education_lecture_security_1.LectureRouteError('audio file is required', 400);
    return {
        classId,
        date: (0, education_lecture_security_1.resolveLectureDate)(req.body?.lectureDate),
        file,
        format: (0, education_lecture_security_1.sniffAudioFormat)(file.buffer),
    };
}
/** Persist the source audio after authorization using exclusive-create semantics. */
function saveLectureAudio(input, lectureId) {
    return (0, education_lecture_security_1.writeRandomLectureArtifact)({
        classId: input.classId,
        instanceId: lectureId,
        subdirectory: 'lectures',
        prefix: `lecture-${input.date}`,
        extension: input.format.extension,
        data: input.file.buffer,
    });
}
/** Insert the processing row before transcription updates its transcript pointer. */
async function insertProcessingLecture(ctx, lectureId, input, audioPath) {
    await ctx.pool.query(`INSERT INTO lm_lectures (lecture_id, class_id, lecture_date, audio_path, status)
     VALUES ($1, $2, $3, $4, 'processing')`, [lectureId, input.classId, input.date, audioPath]);
}
/** Run the synchronous provider only after class authorization and row creation. */
async function transcribeLecture(ctx, input, lectureId, classInfo, audioPath) {
    return (0, education_voice_routes_1.runSynchronousTranscription)({
        audioBuffer: input.file.buffer,
        mimeType: input.format.mimeType,
        workspaceDir: path_1.default.dirname(audioPath),
        date: input.date,
        classId: input.classId,
        lectureId,
        subject: classInfo.subject,
        pool: ctx.pool,
    });
}
/** Create the accountable lecture-scribe ticket with internal artifact references. */
async function createLectureTicket(ctx, input, lectureId, classInfo, audioPath, transcription) {
    const description = (0, education_voice_routes_1.buildLectureTicketDescription)({
        className: classInfo.name, subject: classInfo.subject, date: input.date,
        audioPath, lectureId, classId: input.classId, transcription,
    });
    const ticketInput = internal_ticket_1.CreateInternalTicketSchema.parse({
        title: `Process lecture: ${classInfo.name} - ${input.date}`,
        description,
        ticketType: 'education',
        labels: ['education', 'lecture-processing', `class:${input.classId}`],
        metadata: {
            educationType: 'lecture-processing', classId: input.classId, lectureId,
            lectureDate: input.date, audioPath, subject: classInfo.subject,
            transcriptPath: transcription.transcriptPath,
            transcriptProviderId: transcription.providerId,
            transcriptStatus: transcription.status,
        },
    });
    return ctx.ticketService.createTicket(ticketInput);
}
/** Build the stable client contract without exposing workspace paths. */
function processLectureResponse(input, lectureId, ticketId, transcription) {
    const message = transcription.status === 'failed'
        ? 'Transcription failed; ticket fallback requested'
        : transcription.status === 'unconfigured'
            ? 'Server transcription unavailable; ticket fallback requested'
            : undefined;
    return {
        success: true, lectureId, ticketId, status: 'processing',
        classId: input.classId, lectureDate: input.date,
        transcript: {
            status: transcription.status, providerId: transcription.providerId,
            available: Boolean(transcription.transcriptPath), message,
        },
    };
}
/** Handle the authorization-first audio-to-ticket workflow. */
async function processLecture(ctx, req, res) {
    const startedAt = Date.now();
    let sourcePath = null;
    let rowInserted = false;
    logger.info({ route: 'process-lecture' }, 'Lecture upload entered');
    try {
        const input = processLectureInput(req);
        const actor = await (0, education_lecture_security_1.resolveLectureActor)(req, ctx.pool);
        const classInfo = await (0, education_lecture_security_1.authorizeLectureClassWrite)(ctx.pool, actor, input.classId);
        const lectureId = (0, crypto_1.randomUUID)();
        sourcePath = saveLectureAudio(input, lectureId);
        await insertProcessingLecture(ctx, lectureId, input, sourcePath);
        rowInserted = true;
        const transcription = await transcribeLecture(ctx, input, lectureId, classInfo, sourcePath);
        const ticket = await createLectureTicket(ctx, input, lectureId, classInfo, sourcePath, transcription);
        logger.info({ lectureId, classId: input.classId, ms: Date.now() - startedAt }, 'Lecture upload completed');
        res.status(201).json(processLectureResponse(input, lectureId, ticket.ticketId, transcription));
    }
    catch (error) {
        if (sourcePath && !rowInserted)
            removeFailedRecording(sourcePath);
        logger.error({ err: error, ms: Date.now() - startedAt }, 'Lecture upload failed');
        if (!(0, education_lecture_security_1.sendLectureRouteError)(res, error))
            res.status(500).json({ error: 'Lecture processing failed' });
    }
}
/** Validate duration without allowing negative or implausibly large metadata. */
function recordingDuration(value) {
    if (value === undefined || value === null || value === '')
        return null;
    const duration = Number(value);
    if (!Number.isInteger(duration) || duration < 0 || duration > 12 * 60 * 60) {
        throw new education_lecture_security_1.LectureRouteError('durationSeconds must be a non-negative integer', 400);
    }
    return duration;
}
/** Remove a just-written orphan if the row update fails. */
function removeFailedRecording(filePath) {
    try {
        fs_1.default.unlinkSync(filePath);
    }
    catch (error) {
        logger.error({ err: error }, 'Failed to remove unreferenced lecture recording');
    }
}
/** Attach one contained, content-derived recording after privileged authorization. */
async function saveLectureRecording(ctx, req, res) {
    const startedAt = Date.now();
    let newAudioPath = null;
    let rowUpdated = false;
    logger.info({ route: 'lecture-audio-upload' }, 'Lecture recording upload entered');
    try {
        const lecture = await (0, education_lecture_security_1.loadAuthorizedLecture)(ctx, req, String(req.params.lectureId), 'write');
        const file = req.file;
        if (!file?.buffer)
            throw new education_lecture_security_1.LectureRouteError('audio file is required', 400);
        const format = (0, education_lecture_security_1.sniffAudioFormat)(file.buffer);
        const duration = recordingDuration(req.body?.durationSeconds);
        newAudioPath = (0, education_lecture_security_1.writeRandomLectureArtifact)({
            classId: lecture.class_id, instanceId: lecture.lecture_id,
            subdirectory: 'lectures', prefix: 'recording', extension: format.extension,
            data: file.buffer,
        });
        const updated = await ctx.pool.query(`UPDATE lm_lectures
          SET audio_path = $1, duration_seconds = COALESCE($2, duration_seconds)
        WHERE lecture_id = $3 AND class_id = $4`, [newAudioPath, duration, lecture.lecture_id, lecture.class_id]);
        if (updated.rowCount !== 1)
            throw new education_lecture_security_1.LectureRouteError('Lecture not found', 404);
        rowUpdated = true;
        logger.info({ lectureId: lecture.lecture_id, bytes: file.size, ms: Date.now() - startedAt }, 'Lecture recording saved');
        res.status(201).json({ success: true, lectureId: lecture.lecture_id, bytes: file.size });
    }
    catch (error) {
        if (newAudioPath && !rowUpdated)
            removeFailedRecording(newAudioPath);
        logger.error({ err: error, ms: Date.now() - startedAt }, 'Lecture recording upload failed');
        if (!(0, education_lecture_security_1.sendLectureRouteError)(res, error))
            res.status(500).json({ error: 'Failed to save lecture recording' });
    }
}
/**
 * @description Create privileged lecture upload endpoints.
 * @param ctx - app context with pool and ticket service
 * @returns router containing process-lecture and recording attachment routes
 */
function createEducationLectureUploadRoutes(ctx) {
    const router = (0, express_1.Router)();
    const sourceUpload = singleAudioUpload(25 * 1024 * 1024);
    const recordingUpload = singleAudioUpload(80 * 1024 * 1024);
    router.post('/process-lecture', sourceUpload, (req, res) => processLecture(ctx, req, res));
    router.post('/lectures/:lectureId/audio', recordingUpload, (req, res) => saveLectureRecording(ctx, req, res));
    return router;
}
//# sourceMappingURL=education-lecture-upload-routes.js.map