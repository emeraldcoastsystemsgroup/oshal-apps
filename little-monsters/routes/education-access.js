"use strict";
/**
 * Education Access Control — Little Monsters
 *
 * Resolves the AUTHENTICATED user (Microsoft Entra / Keycloak / mock OIDC) to an
 * lm_students row and enforces the shared-vs-private data model:
 *
 *   • SHARED  (visible to every enrolled student of a class): class info,
 *     textbooks/lectures, flashcard sets, slides, quizzes, assignments, calendar.
 *   • PRIVATE (per student): XP/level/streak, flashcard SM-2 progress, quiz results.
 *
 * The identity comes from the session (req.oidc.user) — NEVER from a client-supplied
 * studentId — which is what makes the platform safe for a real classroom: an
 * authenticated student can only read their own private data, and can only reach a
 * class's shared materials if they are enrolled (teachers see classes they teach).
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1 | roger.murphy@agenticfederal.us   | Initial: SSO identity -> student resolution/provisioning + enrollment-based access control (assertClassAccess, listAccessibleClassIds)
 * 2 | roger.murphy@agenticfederal.us   | Added assertTeacher + assertTeacherOfClass for the teacher analytics surface
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Tenant-bound class/teacher/admin decisions, fail-closed tenant mapping, and the private-dashboard viewer role matrix
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Bind accounts to the verified OIDC issuer and subject, serialize placeholder adoption, and fail closed on identity or tenant ambiguity
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Replace 32-bit RAG collection fragments with deterministic 96-bit SHA-256 identity digests
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Minimize every identity query and mutation result to the exact fields required by authorization
 * ---------------------------------------------------------------------------
 *
 * @module education-access
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EducationAccessError = exports.DEFAULT_TENANT_ID = void 0;
exports.resolveAuthedStudent = resolveAuthedStudent;
exports.hasClassAccess = hasClassAccess;
exports.assertClassAccess = assertClassAccess;
exports.privateMaterialsCollection = privateMaterialsCollection;
exports.sharedMaterialsCollection = sharedMaterialsCollection;
exports.assertTeacher = assertTeacher;
exports.assertTeacherOfClass = assertTeacherOfClass;
exports.assertCanViewStudent = assertCanViewStudent;
exports.listAccessibleClassIds = listAccessibleClassIds;
const node_crypto_1 = require("node:crypto");
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'education-access' });
/** @description The built-in default school used only while no mapped school domains exist. */
exports.DEFAULT_TENANT_ID = '00000000-0000-4000-8000-00000000d001';
const MOCK_OIDC_ISSUER = 'urn:oshal:mock-oidc';
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
/** @description Raised when access to a class is denied (not enrolled / not a teacher). */
class EducationAccessError extends Error {
    status;
    constructor(message, status = 403) {
        super(message);
        this.status = status;
        this.name = 'EducationAccessError';
    }
}
exports.EducationAccessError = EducationAccessError;
function emailDomain(email) {
    if (!email)
        return null;
    const separator = email.lastIndexOf('@');
    return separator > 0 && separator < email.length - 1 ? email.slice(separator + 1) : null;
}
/** Resolve a mapped school or use the default only before any domain mapping exists. */
async function resolveTenantForEmail(db, email) {
    const domain = emailDomain(email);
    try {
        if (domain) {
            const exact = await db.query('SELECT tenant_id FROM lm_tenants WHERE lower(domain) = $1 LIMIT 2', [domain]);
            if (exact.rows.length > 1) {
                throw new EducationAccessError('School tenant configuration is ambiguous', 503);
            }
            if (exact.rows[0])
                return exact.rows[0].tenant_id;
        }
        const mapped = await db.query('SELECT 1 FROM lm_tenants WHERE domain IS NOT NULL LIMIT 1');
        if (mapped.rows.length > 0) {
            throw new EducationAccessError('School tenant is not configured for this identity', 403);
        }
        return exports.DEFAULT_TENANT_ID;
    }
    catch (err) {
        logger.error({ err, hasEmailDomain: Boolean(domain) }, 'School tenant lookup failed');
        if (err instanceof EducationAccessError)
            throw err;
        if (err?.code === '42P01')
            return exports.DEFAULT_TENANT_ID;
        throw new EducationAccessError('Unable to resolve school tenant', 503);
    }
}
/** Comma-separated allowlist of teacher/admin emails (e.g. from an env var). */
function teacherEmails() {
    return new Set((process.env.LM_TEACHER_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean));
}
/** Preserve an existing elevated role or promote an allowlisted student to teacher. */
async function resolveRole(db, row, isTeacherByAllowlist) {
    let role = row.role || 'student';
    if (isTeacherByAllowlist && role === 'student') {
        role = 'teacher';
        await db.query('UPDATE lm_students SET role = $1 WHERE student_id = $2', [role, row.student_id]);
        row.role = role;
    }
    return role;
}
function normalizedClaim(value, maxLength) {
    if (typeof value !== 'string')
        return null;
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}
function mockOidcEnabled() {
    const value = (process.env.MOCK_OIDC || '').trim().toLowerCase();
    return value === 'true' || value === '1' || value === 'yes';
}
/**
 * @description Pull the IdP identity off the request. Works for Microsoft Entra,
 * Keycloak, and the mock-OIDC dev user — all expose `req.oidc.user` with the
 * standard OIDC claims. A principal is the exact `(iss, sub)` pair; an issuer
 * fallback exists only for the explicitly enabled local MOCK_OIDC middleware.
 * @param req - Express request carrying the express-openid-connect session
 * @returns the normalized issuer-bound principal, or null when unauthenticated
 */
function readIdentity(req) {
    const oidc = req.oidc;
    if (!oidc || typeof oidc.isAuthenticated !== 'function' || !oidc.isAuthenticated())
        return null;
    const u = oidc.user || {};
    const sub = normalizedClaim(u.sub, 255);
    const issuer = normalizedClaim(u.iss, 2048) || (mockOidcEnabled() ? MOCK_OIDC_ISSUER : null);
    if (!sub || !issuer) {
        throw new EducationAccessError('Authenticated OIDC identity is missing issuer or subject', 401);
    }
    const rawEmail = normalizedClaim(u.email || u.preferred_username || u.upn, 320);
    return {
        sub,
        issuer,
        email: rawEmail ? rawEmail.toLowerCase() : null,
        name: normalizedClaim(u.name || u.given_name || u.preferred_username, 255) || 'Student',
    };
}
async function findBoundPrincipal(db, identity) {
    const result = await db.query(`SELECT student_id, email, name, role, tenant_id, external_id, external_issuer
       FROM lm_students
      WHERE external_issuer = $1 AND external_id = $2
      LIMIT 2`, [identity.issuer, identity.sub]);
    if (result.rows.length > 1) {
        logger.error({ matchCount: result.rows.length }, 'Ambiguous issuer-bound student principal');
        throw new EducationAccessError('Student identity configuration is ambiguous', 503);
    }
    return result.rows[0] || null;
}
async function lockIdentityKeys(client, identity, tenantId) {
    // JSON tuples avoid delimiter ambiguity, then lexical ordering gives every
    // linker the same lock order and prevents cross-principal/email deadlocks.
    const keys = [JSON.stringify(['lm-principal', identity.issuer, identity.sub])];
    if (identity.email)
        keys.push(JSON.stringify(['lm-email', tenantId, identity.email]));
    keys.sort();
    for (const key of keys) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    }
}
async function findEmailCandidate(client, email, tenantId) {
    if (!email)
        return null;
    const result = await client.query(`SELECT student_id, email, name, role, tenant_id, external_id, external_issuer
       FROM lm_students
      WHERE lower(email) = $1 AND tenant_id = $2
      LIMIT 2`, [email, tenantId]);
    if (result.rows.length > 1) {
        throw new EducationAccessError('Student email identity requires operator review', 409);
    }
    return result.rows[0] || null;
}
async function bindEmailCandidate(client, row, identity) {
    const placeholder = row.external_id === null && row.external_issuer === null;
    const legacy = row.external_id === identity.sub && row.external_issuer === null;
    if (!placeholder && !legacy) {
        throw new EducationAccessError('Student identity requires operator relink', 409);
    }
    // Legacy adoption is deliberately one-time and email+tenant scoped. Matching a
    // historical subject globally would recreate the cross-issuer collision fixed here.
    const result = placeholder
        ? await client.query(`UPDATE lm_students SET external_issuer = $1, external_id = $2
        WHERE student_id = $3 AND external_issuer IS NULL AND external_id IS NULL
        RETURNING student_id, email, name, role, tenant_id, external_id, external_issuer`, [identity.issuer, identity.sub, row.student_id])
        : await client.query(`UPDATE lm_students SET external_issuer = $1
        WHERE student_id = $2 AND external_id = $3 AND external_issuer IS NULL
        RETURNING student_id, email, name, role, tenant_id, external_id, external_issuer`, [identity.issuer, row.student_id, identity.sub]);
    if (result.rows.length !== 1) {
        throw new EducationAccessError('Student identity changed during sign-in', 409);
    }
    return result.rows[0];
}
async function linkOrProvisionStudent(client, identity, tenantId, role) {
    const candidate = await findEmailCandidate(client, identity.email, tenantId);
    if (candidate)
        return bindEmailCandidate(client, candidate, identity);
    const result = await client.query(`INSERT INTO lm_students (name, email, external_issuer, external_id, role, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING student_id, email, name, role, tenant_id, external_id, external_issuer`, [identity.name, identity.email, identity.issuer, identity.sub, role, tenantId]);
    return result.rows[0];
}
async function rollbackIdentityTransaction(client, cause) {
    try {
        await client.query('ROLLBACK');
    }
    catch (err) {
        logger.error({ err, cause }, 'Student identity transaction rollback failed');
    }
}
async function resolveUnboundPrincipal(pool, identity, isTeacherByAllowlist) {
    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query('BEGIN');
        transactionOpen = true;
        const tenantId = await resolveTenantForEmail(client, identity.email);
        await lockIdentityKeys(client, identity, tenantId);
        let row = await findBoundPrincipal(client, identity);
        const initialRole = isTeacherByAllowlist ? 'teacher' : 'student';
        if (!row)
            row = await linkOrProvisionStudent(client, identity, tenantId, initialRole);
        await resolveRole(client, row, isTeacherByAllowlist);
        await client.query('COMMIT');
        transactionOpen = false;
        return row;
    }
    catch (err) {
        logger.error({ err }, 'Student identity link or provisioning failed');
        if (transactionOpen)
            await rollbackIdentityTransaction(client, err);
        throw err;
    }
    finally {
        client.release();
    }
}
/**
 * @description Resolve the authenticated user to an lm_students row, provisioning
 * one on first sign-in. Matches on the verified OIDC `(iss, sub)` pair first.
 * Email can adopt only an unbound same-tenant placeholder (or the documented
 * one-time legacy row); conflicting principals require an operator relink. The
 * role comes from LM_TEACHER_EMAILS or the existing row.
 * @param req - Express request with an authenticated OIDC session
 * @param pool - database pool
 * @returns the resolved AuthedStudent
 * @throws EducationAccessError(401) when the request is unauthenticated
 */
async function resolveAuthedStudent(req, pool) {
    const id = readIdentity(req);
    if (!id)
        throw new EducationAccessError('Not authenticated', 401);
    const isTeacherByAllowlist = id.email ? teacherEmails().has(id.email) : false;
    let row = await findBoundPrincipal(pool, id);
    if (!row) {
        row = await resolveUnboundPrincipal(pool, id, isTeacherByAllowlist);
        logger.info({ studentId: row.student_id, tenantId: row.tenant_id }, 'Linked or provisioned student from issuer-bound OIDC identity');
    }
    const role = await resolveRole(pool, row, isTeacherByAllowlist);
    return { studentId: row.student_id, email: row.email, name: row.name, role, tenantId: row.tenant_id || exports.DEFAULT_TENANT_ID };
}
/**
 * @description Is this student allowed to reach the given class? Teachers/admins
 * may reach any class they teach (or all, for admins); students must be enrolled.
 * @param pool - database pool
 * @param student - the resolved authenticated student
 * @param classId - the class being accessed
 * @returns true when access is permitted
 */
async function hasClassAccess(pool, student, classId) {
    if (!classId)
        return false;
    if (student.role === 'admin') {
        const a = await pool.query('SELECT 1 FROM lm_classes WHERE class_id = $1 AND tenant_id = $2', [classId, student.tenantId]);
        return a.rows.length > 0;
    }
    if (student.role === 'teacher') {
        const t = await pool.query('SELECT 1 FROM lm_classes WHERE class_id = $1 AND teacher_student_id = $2 AND tenant_id = $3', [classId, student.studentId, student.tenantId]);
        if (t.rows.length > 0)
            return true;
        // fall through — a teacher might also be enrolled (e.g. co-teacher)
    }
    const e = await pool.query(`SELECT 1
       FROM lm_enrollments e
       JOIN lm_classes c ON c.class_id = e.class_id
      WHERE e.student_id = $1 AND e.class_id = $2 AND c.tenant_id = $3`, [student.studentId, classId, student.tenantId]);
    return e.rows.length > 0;
}
/**
 * @description Assert class access or throw EducationAccessError(403). Use at the
 * top of any route that serves a class's shared materials.
 * @param pool - database pool
 * @param student - the resolved authenticated student
 * @param classId - the class being accessed
 */
async function assertClassAccess(pool, student, classId) {
    if (!classId)
        throw new EducationAccessError('classId is required', 400);
    if (!(await hasClassAccess(pool, student, classId))) {
        logger.warn({ studentId: student.studentId, classId, role: student.role }, 'Class access denied');
        throw new EducationAccessError('You do not have access to this class', 403);
    }
}
/**
 * @description RAG collection holding a student's PRIVATE materials for one class.
 * Materials are isolated per student by default (sharing is a future teacher-gated
 * flow), so an uploaded textbook/handout/photo only grounds that student's own
 * tutor — never classmates'. Truncated digests keep the name within Chroma's 63-char
 * limit. Each identity contributes 96 bits of SHA-256 rather than a
 * collision-prone UUID prefix. Collision-prone legacy names are not read.
 * @param classId - the class the material belongs to
 * @param studentId - the owning student
 * @returns a Chroma-safe collection name
 */
function privateMaterialsCollection(classId, studentId) {
    return `lm-prv-${collectionIdentityDigest(classId)}-${collectionIdentityDigest(studentId)}`;
}
/**
 * @description RAG collection for a class's SHARED materials — documents a teacher
 * has shared (or approved) with the whole class. Grounds every enrolled student's
 * tutor, unlike privateMaterialsCollection. Its 96-bit digest prevents class
 * UUIDs with the same leading bytes from sharing a namespace. It remains
 * distinct from the separate `lm-class-{id}-textbook` legacy source.
 * @param classId - the class
 * @returns a Chroma-safe collection name
 */
function sharedMaterialsCollection(classId) {
    return `lm-shr-${collectionIdentityDigest(classId)}`;
}
function collectionIdentityDigest(value) {
    return (0, node_crypto_1.createHash)('sha256')
        .update(String(value).trim().toLowerCase(), 'utf8')
        .digest('hex')
        .slice(0, 24);
}
/**
 * @description Assert the caller is a teacher or admin, else throw 403. Gates the
 * teacher analytics surface (a student must never see classmates' progress).
 * @param student - the resolved authenticated student
 */
function assertTeacher(student) {
    if (student.role !== 'teacher' && student.role !== 'admin') {
        throw new EducationAccessError('Teacher access required', 403);
    }
}
/**
 * @description Assert the caller is an admin, or the teacher OF the given class.
 * Prevents one teacher from reading another teacher's class analytics.
 * @param pool - database pool
 * @param student - the resolved authenticated student
 * @param classId - the class being accessed
 */
async function assertTeacherOfClass(pool, student, classId) {
    assertTeacher(student);
    const r = student.role === 'admin'
        ? await pool.query('SELECT 1 FROM lm_classes WHERE class_id = $1 AND tenant_id = $2', [classId, student.tenantId])
        : await pool.query('SELECT 1 FROM lm_classes WHERE class_id = $1 AND teacher_student_id = $2 AND tenant_id = $3', [classId, student.studentId, student.tenantId]);
    if (r.rows.length === 0) {
        throw new EducationAccessError('You do not teach this class', 403);
    }
}
/**
 * @description Assert that a caller may read a student's private dashboard.
 * Students may read only themselves; teachers may read a student enrolled in an
 * active class they own; tenant admins may read students in their own tenant.
 * Every denial is a 404 so the endpoint does not reveal whether a foreign or
 * unrelated student identifier exists.
 * @param pool - database pool
 * @param viewer - the resolved authenticated caller
 * @param targetStudentId - student whose private dashboard was requested
 * @returns a promise that resolves only when the viewer may read the target dashboard
 */
async function assertCanViewStudent(pool, viewer, targetStudentId) {
    // PostgreSQL UUID casts throw 22P02 for malformed input. Normalize that case
    // to the same non-oracular 404 as an unknown or unauthorized student.
    if (!UUID_PATTERN.test(targetStudentId)) {
        throw new EducationAccessError('Student not found', 404);
    }
    if (targetStudentId && targetStudentId === viewer.studentId)
        return;
    let allowed = false;
    if (targetStudentId && viewer.role === 'admin') {
        const r = await pool.query('SELECT 1 FROM lm_students WHERE student_id = $1 AND tenant_id = $2', [targetStudentId, viewer.tenantId]);
        allowed = r.rows.length > 0;
    }
    else if (targetStudentId && viewer.role === 'teacher') {
        const r = await pool.query(`SELECT 1
         FROM lm_students s
         JOIN lm_enrollments e ON e.student_id = s.student_id
         JOIN lm_classes c ON c.class_id = e.class_id
        WHERE s.student_id = $1
          AND s.tenant_id = $2
          AND c.tenant_id = $2
          AND c.teacher_student_id = $3
          AND c.status = 'active'
        LIMIT 1`, [targetStudentId, viewer.tenantId, viewer.studentId]);
        allowed = r.rows.length > 0;
    }
    if (!allowed) {
        logger.warn({ viewerStudentId: viewer.studentId, viewerRole: viewer.role }, 'Private student dashboard access denied');
        throw new EducationAccessError('Student not found', 404);
    }
}
/**
 * @description The class IDs this student may see: every class for an admin,
 * taught + enrolled classes for a teacher, enrolled classes for a student.
 * @param pool - database pool
 * @param student - the resolved authenticated student
 * @returns the accessible class IDs
 */
async function listAccessibleClassIds(pool, student) {
    if (student.role === 'admin') {
        const r = await pool.query('SELECT class_id FROM lm_classes WHERE tenant_id = $1', [student.tenantId]);
        return r.rows.map((x) => x.class_id);
    }
    const r = await pool.query(`SELECT e.class_id
       FROM lm_enrollments e
       JOIN lm_classes c ON c.class_id = e.class_id
      WHERE e.student_id = $1 AND c.tenant_id = $2
     UNION
     SELECT class_id FROM lm_classes WHERE teacher_student_id = $1 AND tenant_id = $2`, [student.studentId, student.tenantId]);
    return r.rows.map((x) => x.class_id);
}
//# sourceMappingURL=education-access.js.map