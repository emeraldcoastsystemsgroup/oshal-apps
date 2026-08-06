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

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { CreateInternalTicketSchema } from '@/entities/ticket/internal-ticket';
import { createChildLogger } from '@/shared/logger';
import {
  buildLectureTicketDescription,
  runSynchronousTranscription,
  type SynchronousTranscriptionResult,
} from './education-voice-routes';
import {
  authorizeLectureClassWrite,
  isUuid,
  loadAuthorizedLecture,
  resolveLectureActor,
  resolveLectureDate,
  sendLectureRouteError,
  sniffAudioFormat,
  writeRandomLectureArtifact,
  LectureRouteError,
  type SniffedAudioFormat,
  type WritableLectureClass,
} from './education-lecture-security';

const logger = createChildLogger({ module: 'education-lecture-upload-routes' });

interface UploadedAudio {
  buffer: Buffer;
  size: number;
}

interface ProcessLectureInput {
  classId: string;
  date: string;
  file: UploadedAudio;
  format: SniffedAudioFormat;
}

/** Construct a memory-only multer middleware with a route-specific cap. */
function singleAudioUpload(limit: number): any {
  const multer = require('multer');
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limit },
  }).single('audio');
}

/** Parse and validate every client-controlled processing field without side effects. */
function processLectureInput(req: Request): ProcessLectureInput {
  const classId = String(req.body?.classId || '');
  if (!isUuid(classId)) throw new LectureRouteError('classId must be a UUID', 400);
  const file = (req as Request & { file?: UploadedAudio }).file;
  if (!file?.buffer) throw new LectureRouteError('audio file is required', 400);
  return {
    classId,
    date: resolveLectureDate(req.body?.lectureDate),
    file,
    format: sniffAudioFormat(file.buffer),
  };
}

/** Persist the source audio after authorization using exclusive-create semantics. */
function saveLectureAudio(input: ProcessLectureInput, lectureId: string): string {
  return writeRandomLectureArtifact({
    classId: input.classId,
    instanceId: lectureId,
    subdirectory: 'lectures',
    prefix: `lecture-${input.date}`,
    extension: input.format.extension,
    data: input.file.buffer,
  });
}

/** Insert the processing row before transcription updates its transcript pointer. */
async function insertProcessingLecture(
  ctx: AppContext,
  lectureId: string,
  input: ProcessLectureInput,
  audioPath: string,
): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO lm_lectures (lecture_id, class_id, lecture_date, audio_path, status)
     VALUES ($1, $2, $3, $4, 'processing')`,
    [lectureId, input.classId, input.date, audioPath],
  );
}

/** Run the synchronous provider only after class authorization and row creation. */
async function transcribeLecture(
  ctx: AppContext,
  input: ProcessLectureInput,
  lectureId: string,
  classInfo: WritableLectureClass,
  audioPath: string,
): Promise<SynchronousTranscriptionResult> {
  return runSynchronousTranscription({
    audioBuffer: input.file.buffer,
    mimeType: input.format.mimeType,
    workspaceDir: path.dirname(audioPath),
    date: input.date,
    classId: input.classId,
    lectureId,
    subject: classInfo.subject,
    pool: ctx.pool,
  });
}

/** Create the accountable lecture-scribe ticket with internal artifact references. */
async function createLectureTicket(
  ctx: AppContext,
  input: ProcessLectureInput,
  lectureId: string,
  classInfo: WritableLectureClass,
  audioPath: string,
  transcription: SynchronousTranscriptionResult,
): Promise<{ ticketId: string }> {
  const description = buildLectureTicketDescription({
    className: classInfo.name, subject: classInfo.subject, date: input.date,
    audioPath, lectureId, classId: input.classId, transcription,
  });
  const ticketInput = CreateInternalTicketSchema.parse({
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
function processLectureResponse(
  input: ProcessLectureInput,
  lectureId: string,
  ticketId: string,
  transcription: SynchronousTranscriptionResult,
): Record<string, unknown> {
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
async function processLecture(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  let sourcePath: string | null = null;
  let rowInserted = false;
  logger.info({ route: 'process-lecture' }, 'Lecture upload entered');
  try {
    const input = processLectureInput(req);
    const actor = await resolveLectureActor(req, ctx.pool);
    const classInfo = await authorizeLectureClassWrite(ctx.pool, actor, input.classId);
    const lectureId = randomUUID();
    sourcePath = saveLectureAudio(input, lectureId);
    await insertProcessingLecture(ctx, lectureId, input, sourcePath);
    rowInserted = true;
    const transcription = await transcribeLecture(ctx, input, lectureId, classInfo, sourcePath);
    const ticket = await createLectureTicket(ctx, input, lectureId, classInfo, sourcePath, transcription);
    logger.info({ lectureId, classId: input.classId, ms: Date.now() - startedAt }, 'Lecture upload completed');
    res.status(201).json(processLectureResponse(input, lectureId, ticket.ticketId, transcription));
  } catch (error) {
    if (sourcePath && !rowInserted) removeFailedRecording(sourcePath);
    logger.error({ err: error, ms: Date.now() - startedAt }, 'Lecture upload failed');
    if (!sendLectureRouteError(res, error)) res.status(500).json({ error: 'Lecture processing failed' });
  }
}

/** Validate duration without allowing negative or implausibly large metadata. */
function recordingDuration(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 0 || duration > 12 * 60 * 60) {
    throw new LectureRouteError('durationSeconds must be a non-negative integer', 400);
  }
  return duration;
}

/** Remove a just-written orphan if the row update fails. */
function removeFailedRecording(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    logger.error({ err: error }, 'Failed to remove unreferenced lecture recording');
  }
}

/** Attach one contained, content-derived recording after privileged authorization. */
async function saveLectureRecording(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  let newAudioPath: string | null = null;
  let rowUpdated = false;
  logger.info({ route: 'lecture-audio-upload' }, 'Lecture recording upload entered');
  try {
    const lecture = await loadAuthorizedLecture(ctx, req, String(req.params.lectureId), 'write');
    const file = (req as Request & { file?: UploadedAudio }).file;
    if (!file?.buffer) throw new LectureRouteError('audio file is required', 400);
    const format = sniffAudioFormat(file.buffer);
    const duration = recordingDuration(req.body?.durationSeconds);
    newAudioPath = writeRandomLectureArtifact({
      classId: lecture.class_id, instanceId: lecture.lecture_id,
      subdirectory: 'lectures', prefix: 'recording', extension: format.extension,
      data: file.buffer,
    });
    const updated = await ctx.pool.query(
      `UPDATE lm_lectures
          SET audio_path = $1, duration_seconds = COALESCE($2, duration_seconds)
        WHERE lecture_id = $3 AND class_id = $4`,
      [newAudioPath, duration, lecture.lecture_id, lecture.class_id],
    );
    if (updated.rowCount !== 1) throw new LectureRouteError('Lecture not found', 404);
    rowUpdated = true;
    logger.info({ lectureId: lecture.lecture_id, bytes: file.size, ms: Date.now() - startedAt }, 'Lecture recording saved');
    res.status(201).json({ success: true, lectureId: lecture.lecture_id, bytes: file.size });
  } catch (error) {
    if (newAudioPath && !rowUpdated) removeFailedRecording(newAudioPath);
    logger.error({ err: error, ms: Date.now() - startedAt }, 'Lecture recording upload failed');
    if (!sendLectureRouteError(res, error)) res.status(500).json({ error: 'Failed to save lecture recording' });
  }
}

/**
 * @description Create privileged lecture upload endpoints.
 * @param ctx - app context with pool and ticket service
 * @returns router containing process-lecture and recording attachment routes
 */
export function createEducationLectureUploadRoutes(ctx: AppContext): Router {
  const router = Router();
  const sourceUpload = singleAudioUpload(25 * 1024 * 1024);
  const recordingUpload = singleAudioUpload(80 * 1024 * 1024);
  router.post('/process-lecture', sourceUpload, (req, res) => processLecture(ctx, req, res));
  router.post('/lectures/:lectureId/audio', recordingUpload, (req, res) => saveLectureRecording(ctx, req, res));
  return router;
}
