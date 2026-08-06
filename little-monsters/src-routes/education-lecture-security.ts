/**
 * Little Monsters lecture security boundary.
 *
 * Lecture routes handle large untrusted buffers, persisted filesystem pointers,
 * model calls, and class-wide artifacts. This module keeps validation,
 * read-only identity resolution, class authorization, and workspace containment
 * in one place so every route crosses the same boundary before side effects.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add fail-closed lecture authorization, strict input validation, content-derived audio formats, safe projections, and symlink-aware class-workspace containment.
 * -----------------------------------------------------------------------------
 *
 * @module education-lecture-security
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import {
  assertClassAccess,
  EducationAccessError,
  type AuthedStudent,
} from './education-access';

const logger = createChildLogger({ module: 'education-lecture-security' });
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SAFE_FILE_TOKEN = /^[a-z0-9-]+$/;
const MOCK_OIDC_ISSUER = 'urn:oshal:mock-oidc';
const ARTIFACT_EXTENSIONS = new Set(['flac', 'json', 'm4a', 'md', 'mp3', 'ogg', 'txt', 'wav', 'webm']);

/** @description A content-derived, allowlisted audio container. */
export interface SniffedAudioFormat {
  extension: 'flac' | 'm4a' | 'mp3' | 'ogg' | 'wav' | 'webm';
  mimeType: string;
}

/** @description Safe fields plus server-only artifact pointers for one lecture. */
export interface AuthorizedLecture {
  lecture_id: string;
  class_id: string;
  lecture_date: string | null;
  status: string;
  duration_seconds: number | null;
  flashcard_set_id: string | null;
  created_at: string | Date | null;
  class_name: string;
  subject: string | null;
  transcript_path: string | null;
  notes_path: string | null;
  slides_path: string | null;
  audio_path: string | null;
}

/** @description Class metadata returned only after teacher/admin authorization. */
export interface WritableLectureClass {
  classId: string;
  name: string;
  subject: string;
}

/** @description Inputs for an exclusive random artifact write. */
export interface LectureArtifactWrite {
  classId: string;
  prefix: string;
  extension: string;
  data: string | Buffer;
  subdirectory?: 'lectures';
  instanceId?: string;
  encoding?: BufferEncoding;
  educationRoot?: string;
  idFactory?: () => string;
}

/** @description A request or persisted-state failure with a safe HTTP response. */
export class LectureRouteError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'LectureRouteError';
  }
}

/**
 * @description Return whether a value is a canonical UUID-shaped identifier.
 * @param value - untrusted identifier
 * @returns true only for the 8-4-4-4-12 hexadecimal form PostgreSQL expects
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * @description Validate an optional lecture date without JavaScript date rollover.
 * @param value - YYYY-MM-DD string, or empty to use today
 * @param now - clock seam used by deterministic tests
 * @returns a real calendar date in YYYY-MM-DD form
 */
export function resolveLectureDate(value: unknown, now = new Date()): string {
  if (value === undefined || value === null || value === '') {
    return now.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') throw new LectureRouteError('lectureDate must be YYYY-MM-DD', 400);
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new LectureRouteError('lectureDate must be YYYY-MM-DD', 400);
  const [year, month, day] = match.slice(1).map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day) {
    throw new LectureRouteError('lectureDate must be a real calendar date', 400);
  }
  return value;
}

/** Identify an ISO base-media file from its fixed `ftyp` box. */
function hasIsoMediaSignature(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}

/** Identify an MPEG Layer III frame when no ID3 tag is present. */
function hasMp3FrameSignature(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

/**
 * @description Derive the only persisted extension and provider MIME type from
 * file bytes. Client MIME and original filename are deliberately ignored.
 * @param buffer - uploaded audio bytes
 * @returns the allowlisted content format
 */
export function sniffAudioFormat(buffer: Buffer): SniffedAudioFormat {
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WAVE') {
    return { extension: 'wav', mimeType: 'audio/wav' };
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') {
    return { extension: 'ogg', mimeType: 'audio/ogg' };
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'fLaC') {
    return { extension: 'flac', mimeType: 'audio/flac' };
  }
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3' || hasMp3FrameSignature(buffer)) {
    return { extension: 'mp3', mimeType: 'audio/mpeg' };
  }
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0x1a45dfa3) {
    return { extension: 'webm', mimeType: 'audio/webm' };
  }
  if (hasIsoMediaSignature(buffer)) return { extension: 'm4a', mimeType: 'audio/mp4' };
  throw new LectureRouteError('Unsupported or unrecognized audio content', 415);
}

/**
 * @description Resolve the configured education workspace root.
 * @param cwd - process working directory seam
 * @returns absolute workspace-shared/education path
 */
export function educationWorkspaceRoot(cwd = process.cwd()): string {
  return path.resolve(cwd, 'workspace-shared', 'education');
}

/** Return true when candidate is a strict descendant of parent. */
function isDescendant(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative);
}

/** Return true when two resolved paths identify the same lexical location. */
function isSamePath(left: string, right: string): boolean {
  return path.relative(left, right) === '';
}

/** Validate a class identifier before it is ever interpolated into a path. */
function requireClassId(classId: unknown): asserts classId is string {
  if (!isUuid(classId)) throw new LectureRouteError('classId must be a UUID', 400);
}

/** Resolve and optionally create a real class root, rejecting symlink escape. */
function realClassRoot(classId: string, educationRoot: string, create: boolean): string {
  requireClassId(classId);
  const configuredRoot = path.resolve(educationRoot);
  const configuredClass = path.resolve(configuredRoot, classId);
  if (!isDescendant(configuredRoot, configuredClass)) {
    throw new LectureRouteError('Invalid class workspace', 400);
  }
  if (create) {
    fs.mkdirSync(configuredRoot, { recursive: true });
    fs.mkdirSync(configuredClass, { recursive: true });
  }
  if (!fs.existsSync(configuredRoot) || !fs.existsSync(configuredClass)) {
    throw new LectureRouteError('Lecture artifact is unavailable', 404);
  }
  const realRoot = fs.realpathSync(configuredRoot);
  const realClass = fs.realpathSync(configuredClass);
  const expectedRealClass = path.resolve(realRoot, classId);
  if (!isDescendant(realRoot, realClass) || !isSamePath(expectedRealClass, realClass)) {
    throw new LectureRouteError('Lecture artifact is unavailable', 404);
  }
  return realClass;
}

/** Resolve a sanctioned subdirectory under the already-verified class root. */
function artifactDirectory(write: LectureArtifactWrite): string {
  const root = realClassRoot(
    write.classId,
    write.educationRoot || educationWorkspaceRoot(),
    true,
  );
  if (!write.subdirectory) return root;
  if (write.instanceId && !isUuid(write.instanceId)) {
    throw new LectureRouteError('Invalid lecture identifier', 400);
  }
  const directory = path.resolve(
    root,
    write.subdirectory,
    ...(write.instanceId ? [write.instanceId] : []),
  );
  if (!isDescendant(root, directory)) throw new LectureRouteError('Invalid artifact directory', 400);
  fs.mkdirSync(directory, { recursive: true });
  const realDirectory = fs.realpathSync(directory);
  if (!isDescendant(root, realDirectory) || !isSamePath(directory, realDirectory)) {
    throw new LectureRouteError('Invalid artifact directory', 400);
  }
  return realDirectory;
}

/**
 * @description Persist one artifact with a random server-selected name and
 * exclusive-create semantics, so uploads never overwrite another lecture.
 * @param write - class, fixed suffix, bytes, and optional test seams
 * @returns absolute contained path stored in the lecture row
 */
export function writeRandomLectureArtifact(write: LectureArtifactWrite): string {
  if (!SAFE_FILE_TOKEN.test(write.prefix) || !SAFE_FILE_TOKEN.test(write.extension)
    || !ARTIFACT_EXTENSIONS.has(write.extension)) {
    throw new LectureRouteError('Invalid artifact filename', 400);
  }
  const directory = artifactDirectory(write);
  const id = (write.idFactory || randomUUID)();
  if (!isUuid(id)) throw new LectureRouteError('Invalid artifact identifier', 500);
  const destination = path.resolve(directory, `${write.prefix}-${id}.${write.extension}`);
  if (!isDescendant(directory, destination)) throw new LectureRouteError('Invalid artifact path', 400);
  const options = write.encoding
    ? { flag: 'wx' as const, encoding: write.encoding }
    : { flag: 'wx' as const };
  fs.writeFileSync(destination, write.data, options);
  return destination;
}

/**
 * @description Resolve an existing persisted pointer only when both its lexical
 * path and real (symlink-resolved) path remain inside the expected class root.
 * @param classId - class that owns the lecture row
 * @param storedPath - server-persisted artifact pointer
 * @param educationRoot - optional isolated test root
 * @returns canonical real file path safe to read or send
 */
export function resolvePersistedLectureFile(
  classId: string,
  storedPath: string,
  educationRoot = educationWorkspaceRoot(),
): string {
  const configuredClass = path.resolve(educationRoot, classId);
  const candidate = path.resolve(String(storedPath || ''));
  if (!isDescendant(configuredClass, candidate)) {
    throw new LectureRouteError('Lecture artifact is unavailable', 404);
  }
  const realClass = realClassRoot(classId, educationRoot, false);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new LectureRouteError('Lecture artifact is unavailable', 404);
  }
  const realCandidate = fs.realpathSync(candidate);
  if (!isDescendant(realClass, realCandidate)) {
    throw new LectureRouteError('Lecture artifact is unavailable', 404);
  }
  return realCandidate;
}

/** Normalize a bounded OIDC string claim. */
function identityClaim(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

/** Return whether the explicit local mock identity provider is enabled. */
function mockOidcEnabled(): boolean {
  const configured = String(process.env.MOCK_OIDC || '').trim().toLowerCase();
  return configured === 'true' || configured === '1' || configured === 'yes';
}

/** Read the verified issuer/subject pair without provisioning or role promotion. */
function authenticatedPrincipal(req: Request): { issuer: string; subject: string } {
  const oidc = (req as any).oidc;
  if (!oidc || typeof oidc.isAuthenticated !== 'function' || !oidc.isAuthenticated()) {
    throw new EducationAccessError('Not authenticated', 401);
  }
  const subject = identityClaim(oidc.user?.sub, 255);
  const issuer = identityClaim(oidc.user?.iss, 2048)
    || (mockOidcEnabled() ? MOCK_OIDC_ISSUER : null);
  if (!subject || !issuer) {
    throw new EducationAccessError('Authenticated OIDC identity is missing issuer or subject', 401);
  }
  return { issuer, subject };
}

/**
 * @description Resolve an existing education identity using SELECT only. A
 * lecture authorization failure can therefore never provision or promote a row.
 * @param req - authenticated Express request
 * @param pool - database pool
 * @returns existing tenant-bound student/teacher/admin identity
 */
export async function resolveLectureActor(req: Request, pool: Pool): Promise<AuthedStudent> {
  const principal = authenticatedPrincipal(req);
  const result = await pool.query(
    `SELECT student_id, email, name, role, tenant_id
       FROM lm_students
      WHERE external_issuer = $1 AND external_id = $2
      LIMIT 2`,
    [principal.issuer, principal.subject],
  );
  if (result.rows.length > 1) {
    logger.error({ matchCount: result.rows.length }, 'Ambiguous lecture principal mapping');
    throw new EducationAccessError('Student identity configuration is ambiguous', 503);
  }
  if (result.rows.length === 0) throw new EducationAccessError('Education profile required', 403);
  const row = result.rows[0];
  if (!isUuid(row.student_id) || !isUuid(row.tenant_id)) {
    logger.error(
      { hasStudentId: Boolean(row.student_id), hasTenantId: Boolean(row.tenant_id) },
      'Lecture principal has invalid tenant or student identity',
    );
    throw new EducationAccessError('Student identity configuration is invalid', 503);
  }
  const role = row.role === 'teacher' || row.role === 'admin' ? row.role : 'student';
  return {
    studentId: row.student_id,
    email: row.email || null,
    name: row.name || 'Student',
    role,
    tenantId: row.tenant_id,
  };
}

/**
 * @description Authorize an admin in the class tenant or the owning teacher and
 * return class metadata in the same read, eliminating an authorization/use gap.
 * @param pool - database pool
 * @param actor - read-only resolved caller
 * @param classId - target class UUID
 * @returns target class metadata after authorization
 */
export async function authorizeLectureClassWrite(
  pool: Pool,
  actor: AuthedStudent,
  classId: string,
): Promise<WritableLectureClass> {
  requireClassId(classId);
  if (actor.role !== 'teacher' && actor.role !== 'admin') {
    throw new EducationAccessError('Teacher access required', 403);
  }
  const result = await pool.query(
    `SELECT class_id, name, subject
       FROM lm_classes
      WHERE class_id = $1
        AND tenant_id = $2
        AND ($3 = 'admin' OR teacher_student_id = $4)`,
    [classId, actor.tenantId, actor.role, actor.studentId],
  );
  if (result.rows.length !== 1) {
    logger.warn({ actorId: actor.studentId, role: actor.role }, 'Lecture class write denied');
    throw new EducationAccessError('You do not teach this class', 403);
  }
  return {
    classId: result.rows[0].class_id,
    name: result.rows[0].name,
    subject: result.rows[0].subject || '',
  };
}

/** Query one lecture using a fixed projection; paths never flow directly to JSON. */
async function findLecture(
  ctx: AppContext,
  lectureId: string,
  tenantId: string,
): Promise<AuthorizedLecture> {
  if (!isUuid(lectureId)) throw new LectureRouteError('Lecture not found', 404);
  const result = await ctx.pool.query(
    `SELECT l.lecture_id, l.class_id, l.lecture_date, l.status,
            l.duration_seconds, l.flashcard_set_id, l.created_at,
            l.transcript_path, l.notes_path, l.slides_path, l.audio_path,
            c.name AS class_name, c.subject
       FROM lm_lectures l
       JOIN lm_classes c ON c.class_id = l.class_id
      WHERE l.lecture_id = $1 AND c.tenant_id = $2`,
    [lectureId, tenantId],
  );
  if (result.rows.length !== 1) throw new LectureRouteError('Lecture not found', 404);
  return result.rows[0] as AuthorizedLecture;
}

/**
 * @description Resolve the caller before the lecture lookup, then enforce class
 * read or teacher/admin-write access before any artifact or downstream service.
 * @param ctx - app context
 * @param req - authenticated request
 * @param lectureId - lecture UUID
 * @param mode - shared class read or privileged class write
 * @returns the authorized fixed-projection lecture row
 */
export async function loadAuthorizedLecture(
  ctx: AppContext,
  req: Request,
  lectureId: string,
  mode: 'read' | 'write',
): Promise<AuthorizedLecture> {
  const actor = await resolveLectureActor(req, ctx.pool);
  const lecture = await findLecture(ctx, lectureId, actor.tenantId);
  if (mode === 'write') {
    await authorizeLectureClassWrite(ctx.pool, actor, lecture.class_id);
  } else {
    await assertClassAccess(ctx.pool, actor, lecture.class_id);
  }
  return lecture;
}

/**
 * @description Remove all server filesystem pointers from a lecture response.
 * @param lecture - authorized internal lecture row
 * @returns stable client-visible metadata and artifact availability flags
 */
export function publicLecture(lecture: AuthorizedLecture): Record<string, unknown> {
  return {
    lecture_id: lecture.lecture_id,
    class_id: lecture.class_id,
    lecture_date: lecture.lecture_date,
    status: lecture.status,
    duration_seconds: lecture.duration_seconds,
    flashcard_set_id: lecture.flashcard_set_id,
    created_at: lecture.created_at,
    class_name: lecture.class_name,
    subject: lecture.subject,
    has_transcript: Boolean(lecture.transcript_path),
    has_notes: Boolean(lecture.notes_path),
    has_slides: Boolean(lecture.slides_path),
    has_audio: Boolean(lecture.audio_path),
  };
}

/**
 * @description Send only intentional access/request errors to the client.
 * @param res - Express response
 * @param error - caught error
 * @returns true when a safe response was sent
 */
export function sendLectureRouteError(res: Response, error: unknown): boolean {
  if (error instanceof LectureRouteError) {
    res.status(error.status).json({ error: error.message, ...(error.details || {}) });
    return true;
  }
  if (error instanceof EducationAccessError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}
