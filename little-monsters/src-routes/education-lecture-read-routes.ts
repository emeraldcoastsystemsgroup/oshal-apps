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

import fs from 'fs';
import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { assertClassAccess, listAccessibleClassIds } from './education-access';
import {
  renderAndSaveLectureDeck,
  type LectureSlide,
} from './education-pptx';
import {
  isUuid,
  loadAuthorizedLecture,
  publicLecture,
  resolveLectureActor,
  resolvePersistedLectureFile,
  sendLectureRouteError,
  LectureRouteError,
  type AuthorizedLecture,
} from './education-lecture-security';

const logger = createChildLogger({ module: 'education-lecture-read-routes' });
const MAX_TEXT_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_SLIDES_ARTIFACT_BYTES = 2 * 1024 * 1024;

interface LectureDeck {
  title: string;
  slides: LectureSlide[];
}

/** Read a bounded UTF-8 artifact only after containment was proven. */
function readArtifact(classId: string, storedPath: string, maxBytes: number): string {
  const safePath = resolvePersistedLectureFile(classId, storedPath);
  const size = fs.statSync(safePath).size;
  if (size > maxBytes) throw new LectureRouteError('Lecture artifact is unavailable', 404);
  return fs.readFileSync(safePath, 'utf8');
}

/** Normalize persisted slides so unexpected keys never reach the response/export. */
function parseLectureDeck(lecture: AuthorizedLecture): LectureDeck {
  if (!lecture.slides_path) throw new LectureRouteError('No slides were generated for this lecture', 404);
  const raw = readArtifact(lecture.class_id, lecture.slides_path, MAX_SLIDES_ARTIFACT_BYTES);
  let value: any;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    logger.error({ err: error, lectureId: lecture.lecture_id }, 'Persisted lecture slides are invalid');
    throw new LectureRouteError('Lecture slides are unavailable', 404);
  }
  const slides = Array.isArray(value.slides)
    ? value.slides.filter((slide: any) => slide && typeof slide.title === 'string')
      .map((slide: any) => ({
        title: String(slide.title).slice(0, 120),
        bullets: Array.isArray(slide.bullets)
          ? slide.bullets.map((bullet: any) => String(bullet).slice(0, 200)).slice(0, 6) : [],
        emoji: typeof slide.emoji === 'string' ? slide.emoji.slice(0, 8) : '',
      })).slice(0, 16)
    : [];
  if (!slides.length) throw new LectureRouteError('Lecture slides are unavailable', 404);
  return { title: String(value.title || lecture.class_name || 'Lecture').slice(0, 200), slides };
}

/** Handle GET /lectures with a path-free fixed database projection. */
async function listLectures(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  logger.info({ route: 'lectures-list' }, 'Lecture list entered');
  try {
    const classId = String(req.query.classId || '');
    if (!isUuid(classId)) throw new LectureRouteError('classId query parameter must be a UUID', 400);
    const actor = await resolveLectureActor(req, ctx.pool);
    await assertClassAccess(ctx.pool, actor, classId);
    const result = await ctx.pool.query(
      `SELECT lecture_id, class_id, lecture_date, status, duration_seconds,
              flashcard_set_id, created_at,
              (transcript_path IS NOT NULL) AS has_transcript,
              (notes_path IS NOT NULL) AS has_notes,
              (slides_path IS NOT NULL) AS has_slides,
              (audio_path IS NOT NULL) AS has_audio
         FROM lm_lectures
        WHERE class_id = $1
        ORDER BY lecture_date DESC, created_at DESC`,
      [classId],
    );
    logger.info({ classId, count: result.rows.length, ms: Date.now() - startedAt }, 'Lectures listed');
    res.json({ lectures: result.rows });
  } catch (error) {
    logger.error({ err: error, ms: Date.now() - startedAt }, 'Failed to list lectures');
    if (!sendLectureRouteError(res, error)) res.status(500).json({ error: 'Failed to list lectures' });
  }
}

/** Parse a bounded recent-list limit. */
function recentLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value || '8'), 10);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : 8, 25);
}

/** Handle the dashboard's recent lecture strip across accessible classes. */
async function listRecentLectures(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  logger.info({ route: 'lectures-recent' }, 'Recent lecture list entered');
  try {
    const actor = await resolveLectureActor(req, ctx.pool);
    const accessible = await listAccessibleClassIds(ctx.pool, actor);
    if (!accessible.length) {
      logger.info({ count: 0, ms: Date.now() - startedAt }, 'Recent lectures listed');
      res.json({ lectures: [] });
      return;
    }
    const result = await ctx.pool.query(
      `SELECT l.lecture_id, l.class_id, l.created_at, l.lecture_date, l.flashcard_set_id,
              (l.slides_path IS NOT NULL) AS has_slides,
              (l.notes_path IS NOT NULL) AS has_notes,
              (l.audio_path IS NOT NULL) AS has_audio,
              (l.transcript_path IS NOT NULL) AS has_transcript,
              c.name AS class_name, c.subject
         FROM lm_lectures l
         JOIN lm_classes c ON c.class_id = l.class_id
        WHERE l.status = 'complete' AND l.class_id = ANY($2)
        ORDER BY l.created_at DESC
        LIMIT $1`,
      [recentLimit(req.query.limit), accessible],
    );
    logger.info({ count: result.rows.length, ms: Date.now() - startedAt }, 'Recent lectures listed');
    res.json({ lectures: result.rows });
  } catch (error) {
    logger.error({ err: error, ms: Date.now() - startedAt }, 'Failed to list recent lectures');
    if (!sendLectureRouteError(res, error)) res.status(500).json({ error: 'Failed to list recent lectures' });
  }
}

/** Build lecture detail after access and artifact containment checks. */
function lectureDetail(lecture: AuthorizedLecture): Record<string, unknown> {
  const detail = publicLecture(lecture);
  if (lecture.transcript_path) {
    detail.transcript = readArtifact(lecture.class_id, lecture.transcript_path, MAX_TEXT_ARTIFACT_BYTES);
  }
  if (lecture.notes_path) {
    detail.notes = readArtifact(lecture.class_id, lecture.notes_path, MAX_TEXT_ARTIFACT_BYTES);
  }
  return detail;
}

/** Handle one class-authorized lecture detail response. */
async function getLecture(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  logger.info({ route: 'lecture-detail' }, 'Lecture detail entered');
  try {
    const lecture = await loadAuthorizedLecture(ctx, req, String(req.params.lectureId), 'read');
    res.json(lectureDetail(lecture));
    logger.info({ lectureId: lecture.lecture_id, ms: Date.now() - startedAt }, 'Lecture detail returned');
  } catch (error) {
    logger.error({ err: error, ms: Date.now() - startedAt }, 'Failed to get lecture');
    if (!sendLectureRouteError(res, error)) res.status(500).json({ error: 'Failed to get lecture' });
  }
}

/** Handle one class-authorized slide deck response. */
async function getLectureSlides(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  logger.info({ route: 'lecture-slides' }, 'Lecture slides entered');
  try {
    const lecture = await loadAuthorizedLecture(ctx, req, String(req.params.lectureId), 'read');
    const deck = parseLectureDeck(lecture);
    res.json({
      lectureId: lecture.lecture_id, classId: lecture.class_id,
      className: lecture.class_name, lectureDate: lecture.lecture_date,
      title: deck.title, slides: deck.slides,
    });
    logger.info({ lectureId: lecture.lecture_id, ms: Date.now() - startedAt }, 'Lecture slides returned');
  } catch (error) {
    logger.error({ err: error, ms: Date.now() - startedAt }, 'Failed to load lecture slides');
    if (!sendLectureRouteError(res, error)) res.status(500).json({ error: 'Failed to load lecture slides' });
  }
}

/** Handle one class-authorized PowerPoint render and save. */
async function exportLecturePowerPoint(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  logger.info({ route: 'lecture-pptx' }, 'Lecture PowerPoint export entered');
  try {
    const subject = (req as any).oidc?.user?.sub || (req as any).oidc?.user?.oid;
    if (!subject) throw new LectureRouteError('not_authenticated', 401);
    const lecture = await loadAuthorizedLecture(ctx, req, String(req.params.lectureId), 'read');
    const deck = parseLectureDeck(lecture);
    const saved = await renderAndSaveLectureDeck(ctx, String(subject), deck.title, deck.slides);
    res.json({ ok: true, ...saved });
    logger.info({ lectureId: lecture.lecture_id, ms: Date.now() - startedAt }, 'Lecture PowerPoint exported');
  } catch (error) {
    logger.error({ err: error, ms: Date.now() - startedAt }, 'Lecture PowerPoint export failed');
    if (!sendLectureRouteError(res, error)) res.status(502).json({ error: 'Lecture export failed' });
  }
}

/** Handle one class-authorized recording stream. */
async function streamLectureAudio(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  logger.info({ route: 'lecture-audio' }, 'Lecture audio stream entered');
  try {
    const lecture = await loadAuthorizedLecture(ctx, req, String(req.params.lectureId), 'read');
    if (!lecture.audio_path) throw new LectureRouteError('No recording saved for this lecture', 404);
    const safePath = resolvePersistedLectureFile(lecture.class_id, lecture.audio_path);
    logger.info({ lectureId: lecture.lecture_id, ms: Date.now() - startedAt }, 'Lecture recording streamed');
    res.sendFile(safePath);
  } catch (error) {
    logger.error({ err: error, ms: Date.now() - startedAt }, 'Failed to stream lecture recording');
    if (!sendLectureRouteError(res, error)) res.status(500).json({ error: 'Failed to stream lecture recording' });
  }
}

/**
 * @description Create class-authorized lecture list, detail, artifact, and export endpoints.
 * @param ctx - app context with database and storage services
 * @returns router containing the lecture read/export surface
 */
export function createEducationLectureReadRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/lectures', (req, res) => listLectures(ctx, req, res));
  // Register the literal route first so Express never captures "recent" as an id.
  router.get('/lectures/recent', (req, res) => listRecentLectures(ctx, req, res));
  router.get('/lectures/:lectureId', (req, res) => getLecture(ctx, req, res));
  router.get('/lectures/:lectureId/slides', (req, res) => getLectureSlides(ctx, req, res));
  router.post('/lectures/:lectureId/pptx', (req, res) => exportLecturePowerPoint(ctx, req, res));
  router.get('/lectures/:lectureId/audio', (req, res) => streamLectureAudio(ctx, req, res));
  return router;
}
