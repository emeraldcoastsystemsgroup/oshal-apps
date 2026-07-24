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
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-06-13 09:50:00 | roger.murphy@agenticfederal.us   | Initial: SSO identity -> student resolution/provisioning + enrollment-based access control (assertClassAccess, listAccessibleClassIds)
 * 2026-06-13 12:30:00 | roger.murphy@agenticfederal.us   | Added assertTeacher + assertTeacherOfClass for the teacher analytics surface
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
exports.listAccessibleClassIds = listAccessibleClassIds;
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'education-access' });
/** The built-in "default school" every existing row belongs to until an operator
 *  creates additional tenants. Mirrored in the lm_tenants seed + column defaults. */
exports.DEFAULT_TENANT_ID = '00000000-0000-4000-8000-00000000d001';
/** Resolve a tenant by the email's domain (operator-mapped), else the default. */
async function resolveTenantForEmail(pool, email) {
    if (email && email.includes('@')) {
        try {
            const domain = email.split('@')[1].toLowerCase();
            const r = await pool.query('SELECT tenant_id FROM lm_tenants WHERE lower(domain) = $1 LIMIT 1', [domain]);
            if (r.rows[0])
                return r.rows[0].tenant_id;
        }
        catch { /* lm_tenants may not exist yet — fall back to default */ }
    }
    return exports.DEFAULT_TENANT_ID;
}
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
/** Comma-separated allowlist of teacher/admin emails (e.g. from an env var). */
function teacherEmails() {
    return new Set((process.env.LM_TEACHER_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean));
}
/**
 * @description Pull the IdP identity off the request. Works for Microsoft Entra,
 * Keycloak, and the mock-OIDC dev user — all expose `req.oidc.user` with the
 * standard OIDC claims (sub, email, name). Returns null when unauthenticated.
 * @param req - Express request carrying the express-openid-connect session
 * @returns the raw claims, or null
 */
function readIdentity(req) {
    const oidc = req.oidc;
    if (!oidc || typeof oidc.isAuthenticated !== 'function' || !oidc.isAuthenticated())
        return null;
    const u = oidc.user || {};
    // Entra puts email in `email` or `preferred_username`; name in `name`.
    return {
        sub: u.sub || u.oid,
        email: u.email || u.preferred_username || u.upn,
        name: u.name || u.given_name || u.preferred_username || 'Student',
    };
}
/**
 * @description Resolve the authenticated user to an lm_students row, provisioning
 * one on first sign-in. Matches on the stable OIDC `sub` (external_id) first, then
 * email; creates the row if neither matches. The role is derived from the
 * LM_TEACHER_EMAILS allowlist (or an existing role on the row).
 * @param req - Express request with an authenticated OIDC session
 * @param pool - database pool
 * @returns the resolved AuthedStudent
 * @throws EducationAccessError(401) when the request is unauthenticated
 */
async function resolveAuthedStudent(req, pool) {
    const id = readIdentity(req);
    if (!id)
        throw new EducationAccessError('Not authenticated', 401);
    const email = id.email ? id.email.toLowerCase() : null;
    const isTeacherByAllowlist = email ? teacherEmails().has(email) : false;
    // 1) Match by stable external_id (sub), then by email.
    let row = null;
    if (id.sub) {
        const r = await pool.query('SELECT * FROM lm_students WHERE external_id = $1', [id.sub]);
        row = r.rows[0] || null;
    }
    if (!row && email) {
        const r = await pool.query('SELECT * FROM lm_students WHERE lower(email) = $1', [email]);
        row = r.rows[0] || null;
        // Backfill external_id so the next lookup is by the stable sub.
        if (row && id.sub && !row.external_id) {
            await pool.query('UPDATE lm_students SET external_id = $1 WHERE student_id = $2', [id.sub, row.student_id]);
        }
    }
    // 2) Provision on first sign-in, into the tenant mapped from their email domain.
    if (!row) {
        const role = isTeacherByAllowlist ? 'teacher' : 'student';
        const tenantId = await resolveTenantForEmail(pool, email);
        const r = await pool.query(`INSERT INTO lm_students (name, email, external_id, role, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`, [id.name || 'Student', email, id.sub || null, role, tenantId]);
        row = r.rows[0];
        logger.info({ studentId: row.student_id, role, email, tenantId }, 'Provisioned new student from SSO identity');
    }
    // 3) Promote to teacher if the allowlist now covers them.
    let role = row.role || 'student';
    if (isTeacherByAllowlist && role === 'student') {
        role = 'teacher';
        await pool.query('UPDATE lm_students SET role = $1 WHERE student_id = $2', [role, row.student_id]);
    }
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
    if (student.role === 'admin')
        return true;
    if (student.role === 'teacher') {
        const t = await pool.query('SELECT 1 FROM lm_classes WHERE class_id = $1 AND teacher_student_id = $2', [classId, student.studentId]);
        if (t.rowCount && t.rowCount > 0)
            return true;
        // fall through — a teacher might also be enrolled (e.g. co-teacher)
    }
    const e = await pool.query('SELECT 1 FROM lm_enrollments WHERE student_id = $1 AND class_id = $2', [student.studentId, classId]);
    return !!(e.rowCount && e.rowCount > 0);
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
 * tutor — never classmates'. Truncated ids keep the name within Chroma's 63-char
 * limit; 8+8 hex is collision-safe at this scale.
 * @param classId - the class the material belongs to
 * @param studentId - the owning student
 * @returns a Chroma-safe collection name
 */
function privateMaterialsCollection(classId, studentId) {
    const c = String(classId).replace(/-/g, '').slice(0, 8);
    const s = String(studentId).replace(/-/g, '').slice(0, 8);
    return `lm-cls-${c}-stu-${s}`;
}
/**
 * @description RAG collection for a class's SHARED materials — documents a teacher
 * has shared (or approved) with the whole class. Grounds every enrolled student's
 * tutor, unlike privateMaterialsCollection. Distinct from the legacy
 * `lm-class-{id}-textbook` so shared uploads and teacher textbook ingests can
 * coexist; the tutor queries both.
 * @param classId - the class
 * @returns a Chroma-safe collection name
 */
function sharedMaterialsCollection(classId) {
    return `lm-cls-${String(classId).replace(/-/g, '').slice(0, 8)}-shared`;
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
    if (student.role === 'admin')
        return;
    const r = await pool.query('SELECT 1 FROM lm_classes WHERE class_id = $1 AND teacher_student_id = $2', [classId, student.studentId]);
    if (!(r.rowCount && r.rowCount > 0)) {
        throw new EducationAccessError('You do not teach this class', 403);
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
        const r = await pool.query('SELECT class_id FROM lm_classes');
        return r.rows.map((x) => x.class_id);
    }
    const r = await pool.query(`SELECT class_id FROM lm_enrollments WHERE student_id = $1
     UNION
     SELECT class_id FROM lm_classes WHERE teacher_student_id = $1`, [student.studentId]);
    return r.rows.map((x) => x.class_id);
}
//# sourceMappingURL=education-access.js.map