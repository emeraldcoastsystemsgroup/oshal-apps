"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LectureRouteError = void 0;
exports.isUuid = isUuid;
exports.resolveLectureDate = resolveLectureDate;
exports.sniffAudioFormat = sniffAudioFormat;
exports.educationWorkspaceRoot = educationWorkspaceRoot;
exports.writeRandomLectureArtifact = writeRandomLectureArtifact;
exports.resolvePersistedLectureFile = resolvePersistedLectureFile;
exports.resolveLectureActor = resolveLectureActor;
exports.authorizeLectureClassWrite = authorizeLectureClassWrite;
exports.loadAuthorizedLecture = loadAuthorizedLecture;
exports.publicLecture = publicLecture;
exports.sendLectureRouteError = sendLectureRouteError;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const education_access_1 = require("./education-access");
const logger = (0, logger_1.createChildLogger)({ module: 'education-lecture-security' });
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SAFE_FILE_TOKEN = /^[a-z0-9-]+$/;
const MOCK_OIDC_ISSUER = 'urn:oshal:mock-oidc';
const ARTIFACT_EXTENSIONS = new Set(['flac', 'json', 'm4a', 'md', 'mp3', 'ogg', 'txt', 'wav', 'webm']);
/** @description A request or persisted-state failure with a safe HTTP response. */
class LectureRouteError extends Error {
    status;
    details;
    constructor(message, status, details) {
        super(message);
        this.status = status;
        this.details = details;
        this.name = 'LectureRouteError';
    }
}
exports.LectureRouteError = LectureRouteError;
/**
 * @description Return whether a value is a canonical UUID-shaped identifier.
 * @param value - untrusted identifier
 * @returns true only for the 8-4-4-4-12 hexadecimal form PostgreSQL expects
 */
function isUuid(value) {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}
/**
 * @description Validate an optional lecture date without JavaScript date rollover.
 * @param value - YYYY-MM-DD string, or empty to use today
 * @param now - clock seam used by deterministic tests
 * @returns a real calendar date in YYYY-MM-DD form
 */
function resolveLectureDate(value, now = new Date()) {
    if (value === undefined || value === null || value === '') {
        return now.toISOString().slice(0, 10);
    }
    if (typeof value !== 'string')
        throw new LectureRouteError('lectureDate must be YYYY-MM-DD', 400);
    const match = DATE_PATTERN.exec(value);
    if (!match)
        throw new LectureRouteError('lectureDate must be YYYY-MM-DD', 400);
    const [year, month, day] = match.slice(1).map(Number);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1
        || candidate.getUTCDate() !== day) {
        throw new LectureRouteError('lectureDate must be a real calendar date', 400);
    }
    return value;
}
/** Identify an ISO base-media file from its fixed `ftyp` box. */
function hasIsoMediaSignature(buffer) {
    return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}
/** Identify an MPEG Layer III frame when no ID3 tag is present. */
function hasMp3FrameSignature(buffer) {
    return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}
/**
 * @description Derive the only persisted extension and provider MIME type from
 * file bytes. Client MIME and original filename are deliberately ignored.
 * @param buffer - uploaded audio bytes
 * @returns the allowlisted content format
 */
function sniffAudioFormat(buffer) {
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
    if (hasIsoMediaSignature(buffer))
        return { extension: 'm4a', mimeType: 'audio/mp4' };
    throw new LectureRouteError('Unsupported or unrecognized audio content', 415);
}
/**
 * @description Resolve the configured education workspace root.
 * @param cwd - process working directory seam
 * @returns absolute workspace-shared/education path
 */
function educationWorkspaceRoot(cwd = process.cwd()) {
    return path_1.default.resolve(cwd, 'workspace-shared', 'education');
}
/** Return true when candidate is a strict descendant of parent. */
function isDescendant(parent, candidate) {
    const relative = path_1.default.relative(parent, candidate);
    return relative.length > 0 && !relative.startsWith(`..${path_1.default.sep}`)
        && relative !== '..' && !path_1.default.isAbsolute(relative);
}
/** Return true when two resolved paths identify the same lexical location. */
function isSamePath(left, right) {
    return path_1.default.relative(left, right) === '';
}
/** Validate a class identifier before it is ever interpolated into a path. */
function requireClassId(classId) {
    if (!isUuid(classId))
        throw new LectureRouteError('classId must be a UUID', 400);
}
/** Resolve and optionally create a real class root, rejecting symlink escape. */
function realClassRoot(classId, educationRoot, create) {
    requireClassId(classId);
    const configuredRoot = path_1.default.resolve(educationRoot);
    const configuredClass = path_1.default.resolve(configuredRoot, classId);
    if (!isDescendant(configuredRoot, configuredClass)) {
        throw new LectureRouteError('Invalid class workspace', 400);
    }
    if (create) {
        fs_1.default.mkdirSync(configuredRoot, { recursive: true });
        fs_1.default.mkdirSync(configuredClass, { recursive: true });
    }
    if (!fs_1.default.existsSync(configuredRoot) || !fs_1.default.existsSync(configuredClass)) {
        throw new LectureRouteError('Lecture artifact is unavailable', 404);
    }
    const realRoot = fs_1.default.realpathSync(configuredRoot);
    const realClass = fs_1.default.realpathSync(configuredClass);
    const expectedRealClass = path_1.default.resolve(realRoot, classId);
    if (!isDescendant(realRoot, realClass) || !isSamePath(expectedRealClass, realClass)) {
        throw new LectureRouteError('Lecture artifact is unavailable', 404);
    }
    return realClass;
}
/** Resolve a sanctioned subdirectory under the already-verified class root. */
function artifactDirectory(write) {
    const root = realClassRoot(write.classId, write.educationRoot || educationWorkspaceRoot(), true);
    if (!write.subdirectory)
        return root;
    if (write.instanceId && !isUuid(write.instanceId)) {
        throw new LectureRouteError('Invalid lecture identifier', 400);
    }
    const directory = path_1.default.resolve(root, write.subdirectory, ...(write.instanceId ? [write.instanceId] : []));
    if (!isDescendant(root, directory))
        throw new LectureRouteError('Invalid artifact directory', 400);
    fs_1.default.mkdirSync(directory, { recursive: true });
    const realDirectory = fs_1.default.realpathSync(directory);
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
function writeRandomLectureArtifact(write) {
    if (!SAFE_FILE_TOKEN.test(write.prefix) || !SAFE_FILE_TOKEN.test(write.extension)
        || !ARTIFACT_EXTENSIONS.has(write.extension)) {
        throw new LectureRouteError('Invalid artifact filename', 400);
    }
    const directory = artifactDirectory(write);
    const id = (write.idFactory || crypto_1.randomUUID)();
    if (!isUuid(id))
        throw new LectureRouteError('Invalid artifact identifier', 500);
    const destination = path_1.default.resolve(directory, `${write.prefix}-${id}.${write.extension}`);
    if (!isDescendant(directory, destination))
        throw new LectureRouteError('Invalid artifact path', 400);
    const options = write.encoding
        ? { flag: 'wx', encoding: write.encoding }
        : { flag: 'wx' };
    fs_1.default.writeFileSync(destination, write.data, options);
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
function resolvePersistedLectureFile(classId, storedPath, educationRoot = educationWorkspaceRoot()) {
    const configuredClass = path_1.default.resolve(educationRoot, classId);
    const candidate = path_1.default.resolve(String(storedPath || ''));
    if (!isDescendant(configuredClass, candidate)) {
        throw new LectureRouteError('Lecture artifact is unavailable', 404);
    }
    const realClass = realClassRoot(classId, educationRoot, false);
    if (!fs_1.default.existsSync(candidate) || !fs_1.default.statSync(candidate).isFile()) {
        throw new LectureRouteError('Lecture artifact is unavailable', 404);
    }
    const realCandidate = fs_1.default.realpathSync(candidate);
    if (!isDescendant(realClass, realCandidate)) {
        throw new LectureRouteError('Lecture artifact is unavailable', 404);
    }
    return realCandidate;
}
/** Normalize a bounded OIDC string claim. */
function identityClaim(value, maxLength) {
    if (typeof value !== 'string')
        return null;
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}
/** Return whether the explicit local mock identity provider is enabled. */
function mockOidcEnabled() {
    const configured = String(process.env.MOCK_OIDC || '').trim().toLowerCase();
    return configured === 'true' || configured === '1' || configured === 'yes';
}
/** Read the verified issuer/subject pair without provisioning or role promotion. */
function authenticatedPrincipal(req) {
    const oidc = req.oidc;
    if (!oidc || typeof oidc.isAuthenticated !== 'function' || !oidc.isAuthenticated()) {
        throw new education_access_1.EducationAccessError('Not authenticated', 401);
    }
    const subject = identityClaim(oidc.user?.sub, 255);
    const issuer = identityClaim(oidc.user?.iss, 2048)
        || (mockOidcEnabled() ? MOCK_OIDC_ISSUER : null);
    if (!subject || !issuer) {
        throw new education_access_1.EducationAccessError('Authenticated OIDC identity is missing issuer or subject', 401);
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
async function resolveLectureActor(req, pool) {
    const principal = authenticatedPrincipal(req);
    const result = await pool.query(`SELECT student_id, email, name, role, tenant_id
       FROM lm_students
      WHERE external_issuer = $1 AND external_id = $2
      LIMIT 2`, [principal.issuer, principal.subject]);
    if (result.rows.length > 1) {
        logger.error({ matchCount: result.rows.length }, 'Ambiguous lecture principal mapping');
        throw new education_access_1.EducationAccessError('Student identity configuration is ambiguous', 503);
    }
    if (result.rows.length === 0)
        throw new education_access_1.EducationAccessError('Education profile required', 403);
    const row = result.rows[0];
    if (!isUuid(row.student_id) || !isUuid(row.tenant_id)) {
        logger.error({ hasStudentId: Boolean(row.student_id), hasTenantId: Boolean(row.tenant_id) }, 'Lecture principal has invalid tenant or student identity');
        throw new education_access_1.EducationAccessError('Student identity configuration is invalid', 503);
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
async function authorizeLectureClassWrite(pool, actor, classId) {
    requireClassId(classId);
    if (actor.role !== 'teacher' && actor.role !== 'admin') {
        throw new education_access_1.EducationAccessError('Teacher access required', 403);
    }
    const result = await pool.query(`SELECT class_id, name, subject
       FROM lm_classes
      WHERE class_id = $1
        AND tenant_id = $2
        AND ($3 = 'admin' OR teacher_student_id = $4)`, [classId, actor.tenantId, actor.role, actor.studentId]);
    if (result.rows.length !== 1) {
        logger.warn({ actorId: actor.studentId, role: actor.role }, 'Lecture class write denied');
        throw new education_access_1.EducationAccessError('You do not teach this class', 403);
    }
    return {
        classId: result.rows[0].class_id,
        name: result.rows[0].name,
        subject: result.rows[0].subject || '',
    };
}
/** Query one lecture using a fixed projection; paths never flow directly to JSON. */
async function findLecture(ctx, lectureId, tenantId) {
    if (!isUuid(lectureId))
        throw new LectureRouteError('Lecture not found', 404);
    const result = await ctx.pool.query(`SELECT l.lecture_id, l.class_id, l.lecture_date, l.status,
            l.duration_seconds, l.flashcard_set_id, l.created_at,
            l.transcript_path, l.notes_path, l.slides_path, l.audio_path,
            c.name AS class_name, c.subject
       FROM lm_lectures l
       JOIN lm_classes c ON c.class_id = l.class_id
      WHERE l.lecture_id = $1 AND c.tenant_id = $2`, [lectureId, tenantId]);
    if (result.rows.length !== 1)
        throw new LectureRouteError('Lecture not found', 404);
    return result.rows[0];
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
async function loadAuthorizedLecture(ctx, req, lectureId, mode) {
    const actor = await resolveLectureActor(req, ctx.pool);
    const lecture = await findLecture(ctx, lectureId, actor.tenantId);
    if (mode === 'write') {
        await authorizeLectureClassWrite(ctx.pool, actor, lecture.class_id);
    }
    else {
        await (0, education_access_1.assertClassAccess)(ctx.pool, actor, lecture.class_id);
    }
    return lecture;
}
/**
 * @description Remove all server filesystem pointers from a lecture response.
 * @param lecture - authorized internal lecture row
 * @returns stable client-visible metadata and artifact availability flags
 */
function publicLecture(lecture) {
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
function sendLectureRouteError(res, error) {
    if (error instanceof LectureRouteError) {
        res.status(error.status).json({ error: error.message, ...(error.details || {}) });
        return true;
    }
    if (error instanceof education_access_1.EducationAccessError) {
        res.status(error.status).json({ error: error.message });
        return true;
    }
    return false;
}
//# sourceMappingURL=education-lecture-security.js.map