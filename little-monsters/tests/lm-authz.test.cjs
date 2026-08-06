/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add compiled two-tenant authorization, tutor-grounding isolation, transaction-order, zero-write, and tenant-domain uniqueness assertions across focused route modules.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Exercise the compiled issuer-bound identity contract and refresh the in-memory SQL model for transactional final-statement authorization.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Exercise fail-closed class deletion across locked material rows, exact RAG collections, files, and relational pointers.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Guard the Presentations tab's package-local route so removing the AI Office app dependency cannot leave a dead ribbon link.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Exercise locked individual-material deletion, external-cleanup rollback, and live class-owner revalidation through the compiled route.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Decompose the in-memory class and write SQL dispatchers to preserve the under-50-line governance boundary without changing test semantics.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Stub the shared untrusted-content encoder used by the compiled tutor containment boundary.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Exercise minimized identity projections and transaction-local roster audit writes.
 *
 * Little Monsters authorization closure.
 *
 * Dependency-free node:test suite over the COMPILED routes/*.js files: the exact
 * bytes the package loader mounts. It proves the two-tenant dashboard role matrix,
 * tenant-local roster writes, and the permanent retirement of the unsafe legacy
 * ID-based roster endpoints. Framework seams are stubbed only at require-time;
 * education-access.js, education-routes.js, and education-schema.js are real compiled modules.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const TEST_ISSUER = 'https://issuer.example.test/realms/school';
const MATERIAL_A1 = '40000000-0000-4000-8000-000000000001';
const MATERIAL_A2 = '40000000-0000-4000-8000-000000000002';
const MATERIAL_B1 = '40000000-0000-4000-8000-000000000003';

function fakeRouter() {
  const routes = new Map();
  const router = { routes };
  const register = (method) => (routePath, ...handlers) => {
    routes.set(`${method} ${routePath}`, handlers.at(-1));
    return router;
  };
  router.get = register('get');
  router.post = register('post');
  router.put = register('put');
  router.patch = register('patch');
  router.delete = register('delete');
  router.use = (...args) => {
    const child = args.at(-1);
    if (child?.routes instanceof Map) {
      for (const [key, handler] of child.routes) routes.set(key, handler);
    }
    return router;
  };
  return router;
}

const emptySubrouter = () => fakeRouter();
const materialCleanup = { calls: [], failCollection: null };
const fakeMulter = () => ({ single: () => (_req, _res, next) => next?.() });
fakeMulter.memoryStorage = () => ({});
const STUBS = {
  express: { Router: fakeRouter, static: () => () => {} },
  multer: fakeMulter,
  '@/shared/logger': {
    createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
  },
  '@/shared/services/database': {
    runtimeSchemaBootstrapEnabled: () => false,
    assertSchemaReady: async () => {},
  },
  '@/features/swarm-orchestration/services/prompt-containment': {
    wrapUntrustedPromptContent: (source, content) => JSON.stringify({ source, content: String(content ?? '') }),
  },
  '@/app/routes/tool-routes': {
    registerDynamicToolUI() {},
    deregisterDynamicToolUI() {},
  },
  './education-lecture-routes': { createEducationLectureRoutes: emptySubrouter },
  './education-study-routes': { createEducationStudyRoutes: emptySubrouter },
  './education-teacher-routes': { createEducationTeacherRoutes: emptySubrouter },
  './education-catalog-routes': { createEducationCatalogRoutes: emptySubrouter },
  './education-rewards-routes': { createEducationRewardsRoutes: emptySubrouter },
  './education-material-storage': {
    async deleteMaterialCollection(collection) {
      materialCleanup.calls.push({ kind: 'rag', value: collection });
      if (materialCleanup.failCollection === collection) throw new Error('simulated RAG cleanup failure');
    },
    deleteStoredMaterial(row) {
      materialCleanup.calls.push({ kind: 'file', value: row.material_id });
    },
    extractMaterialText: async () => '',
    extractStoredMaterialText: async () => '',
    ingestMaterialText: async () => false,
    materialCollectionName: materialId => `lm-material-${materialId.replace(/-/g, '')}`,
    resolveStoredMaterialPath: row => row.stored_path,
    saveMaterialFile: () => ({ storedPath: 'contained-upload.bin', mimeType: 'application/octet-stream' }),
  },
};

const originalLoad = Module._load;
Module._load = function loadWithFrameworkStubs(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const access = require(path.join(PKG, 'routes', 'education-access.js'));
const { createEducationCatalogRoutes } = require(path.join(PKG, 'routes', 'education-catalog-routes.js'));
const { createEducationRoutes } = require(path.join(PKG, 'routes', 'education-routes.js'));
// createEducationRoutes performs a sanctioned factory-time require('express')
// for its bundled static mount, so keep the reversible shim active for this
// isolated test process (all unknown modules still delegate to originalLoad).
process.once('exit', () => { Module._load = originalLoad; });

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUDENT_A = '10000000-0000-4000-8000-000000000001';
const STUDENT_A2 = '10000000-0000-4000-8000-000000000002';
const TEACHER_A = '10000000-0000-4000-8000-000000000101';
const TEACHER_A2 = '10000000-0000-4000-8000-000000000102';
const ADMIN_A = '10000000-0000-4000-8000-000000000201';
const STUDENT_B = '20000000-0000-4000-8000-000000000001';
const TEACHER_B = '20000000-0000-4000-8000-000000000101';
const CLASS_B_UUID = '30000000-0000-4000-8000-000000000001';

function baseState() {
  return {
    students: [
      { student_id: STUDENT_A, external_issuer: TEST_ISSUER, external_id: 'oidc-student-a', name: 'Student A', email: 'student-a@a.school', role: 'student', tenant_id: TENANT_A, xp: 120, level: 2, streak_days: 3, last_active_date: '2026-08-05' },
      { student_id: STUDENT_A2, external_issuer: TEST_ISSUER, external_id: 'oidc-student-a2', name: 'Student A2', email: 'student-a2@a.school', role: 'student', tenant_id: TENANT_A, xp: 20, level: 1, streak_days: 0, last_active_date: null },
      { student_id: TEACHER_A, external_issuer: TEST_ISSUER, external_id: 'oidc-teacher-a', name: 'Teacher A', email: 'teacher-a@a.school', role: 'teacher', tenant_id: TENANT_A, xp: 0, level: 1, streak_days: 0, last_active_date: null },
      { student_id: TEACHER_A2, external_issuer: TEST_ISSUER, external_id: 'oidc-teacher-a2', name: 'Teacher A2', email: 'teacher-a2@a.school', role: 'teacher', tenant_id: TENANT_A, xp: 0, level: 1, streak_days: 0, last_active_date: null },
      { student_id: ADMIN_A, external_issuer: TEST_ISSUER, external_id: 'oidc-admin-a', name: 'Admin A', email: 'admin-a@a.school', role: 'admin', tenant_id: TENANT_A, xp: 0, level: 1, streak_days: 0, last_active_date: null },
      { student_id: STUDENT_B, external_issuer: TEST_ISSUER, external_id: 'oidc-student-b', name: 'Student B', email: 'shared@student.school', role: 'student', tenant_id: TENANT_B, xp: 75, level: 1, streak_days: 1, last_active_date: '2026-08-04' },
      { student_id: TEACHER_B, external_issuer: TEST_ISSUER, external_id: 'oidc-teacher-b', name: 'Teacher B', email: 'teacher-b@b.school', role: 'teacher', tenant_id: TENANT_B, xp: 0, level: 1, streak_days: 0, last_active_date: null },
    ],
    classes: [
      { class_id: 'class-a', tenant_id: TENANT_A, teacher_student_id: TEACHER_A, status: 'active', published: true, name: 'Math A', subject: 'math', grade_level: '7', teacher_name: 'Teacher A' },
      { class_id: 'class-a2', tenant_id: TENANT_A, teacher_student_id: TEACHER_A2, status: 'active', published: true, name: 'Science A', subject: 'science', grade_level: '7', teacher_name: 'Teacher A2' },
      { class_id: 'class-b', tenant_id: TENANT_B, teacher_student_id: TEACHER_B, status: 'active', published: true, name: 'Math B', subject: 'math', grade_level: '7', teacher_name: 'Teacher B' },
    ],
    enrollments: [
      { student_id: STUDENT_A, class_id: 'class-a' },
      { student_id: STUDENT_A2, class_id: 'class-a2' },
      { student_id: STUDENT_B, class_id: 'class-b' },
    ],
    materials: [
      { material_id: MATERIAL_A1, class_id: 'class-a', uploaded_by: STUDENT_A,
        stored_path: 'contained-a-1.pdf', mime_type: 'application/pdf', rag_collection: 'lm-material-a-1' },
      { material_id: MATERIAL_A2, class_id: 'class-a', uploaded_by: TEACHER_A,
        stored_path: 'contained-a-2.txt', mime_type: 'text/plain', rag_collection: null },
      { material_id: MATERIAL_B1, class_id: 'class-b', uploaded_by: STUDENT_B,
        stored_path: 'contained-b-1.pdf', mime_type: 'application/pdf', rag_collection: 'lm-material-b-1' },
    ],
    audits: [],
    nextStudent: 1,
  };
}

function result(rows) {
  return { rows, rowCount: rows.length };
}

function handleIdentityQuery(state, sql, params) {
  if (/SELECT tenant_id FROM lm_tenants WHERE lower\(domain\)/i.test(sql)) {
    const tenant = params[0] === 'a.school' ? TENANT_A : params[0] === 'b.school' ? TENANT_B : null;
    return result(tenant ? [{ tenant_id: tenant }] : []);
  }
  if (/SELECT 1 FROM lm_tenants WHERE domain IS NOT NULL LIMIT 1/i.test(sql)) {
    return result([]);
  }
  if (/SELECT student_id, email, name, role, tenant_id, external_id, external_issuer FROM lm_students WHERE external_issuer = \$1 AND external_id = \$2/i.test(sql)) {
    return result(state.students.filter((student) => (
      student.external_issuer === params[0] && student.external_id === params[1]
    )));
  }
  if (/SELECT student_id, email, name, role, tenant_id, external_id, external_issuer FROM lm_students WHERE lower\(email\) = \$1 AND tenant_id = \$2/i.test(sql)) {
    const rows = state.students.filter((student) => (
      student.email?.toLowerCase() === params[0] && student.tenant_id === params[1]
    ));
    return result(rows);
  }
  if (/SELECT 1 FROM lm_students WHERE student_id = \$1 AND tenant_id = \$2/i.test(sql)) {
    const found = state.students.some((student) => student.student_id === params[0] && student.tenant_id === params[1]);
    return result(found ? [{ '?column?': 1 }] : []);
  }
  return undefined;
}

function handleTeacherStudentView(state, sql, params) {
  if (!/SELECT 1 FROM lm_students s JOIN lm_enrollments e/i.test(sql)) return undefined;
  const [targetId, tenantId, teacherId] = params;
  const target = state.students.find((student) => student.student_id === targetId && student.tenant_id === tenantId);
  const allowed = target && state.enrollments.some((enrollment) => {
    if (enrollment.student_id !== targetId) return false;
    const cls = state.classes.find((candidate) => candidate.class_id === enrollment.class_id);
    return cls?.tenant_id === tenantId && cls.teacher_student_id === teacherId && cls.status === 'active';
  });
  return result(allowed ? [{ '?column?': 1 }] : []);
}

/** Model the current class-and-actor locks shared by destructive mutations. */
function handleLockedClassQuery(state, sql, params) {
  const authorizationLock = /SELECT 1 FROM lm_classes c JOIN lm_students a .*FOR UPDATE OF c, a/i.test(sql);
  const statusLock = /SELECT c\.status FROM lm_classes c JOIN lm_students a.*FOR UPDATE OF c, a/i.test(sql);
  if (!authorizationLock && !statusLock) return undefined;
  const actor = state.students.find((student) => student.student_id === params[1]);
  const original = state.classes.find((candidate) => candidate.class_id === params[0]);
  const locked = original ? { ...original, ...(state.lockedClassOverride || {}) } : null;
  const allowed = actor && locked && actor.tenant_id === locked.tenant_id
    && (actor.role === 'admin' || (actor.role === 'teacher' && locked.teacher_student_id === actor.student_id));
  if (!allowed) return result([]);
  return result(authorizationLock ? [{ '?column?': 1 }] : [{ status: locked.status }]);
}

function handleClassQuery(state, sql, params) {
  const locked = handleLockedClassQuery(state, sql, params);
  if (locked !== undefined) return locked;
  if (/^SELECT 1 FROM lm_enrollments e JOIN lm_classes c ON c\.class_id = e\.class_id/i.test(sql)) {
    const found = state.enrollments.some((enrollment) => {
      const cls = state.classes.find((candidate) => candidate.class_id === enrollment.class_id);
      return enrollment.student_id === params[0] && enrollment.class_id === params[1]
        && cls?.tenant_id === params[2];
    });
    return result(found ? [{ '?column?': 1 }] : []);
  }
  if (/SELECT 1 FROM lm_classes WHERE class_id = \$1 AND teacher_student_id = \$2 AND tenant_id = \$3/i.test(sql)) {
    const found = state.classes.some((cls) => (
      cls.class_id === params[0] && cls.teacher_student_id === params[1] && cls.tenant_id === params[2]
    ));
    return result(found ? [{ '?column?': 1 }] : []);
  }
  if (/SELECT 1 FROM lm_classes WHERE class_id = \$1 AND tenant_id = \$2/i.test(sql)) {
    const found = state.classes.some((cls) => cls.class_id === params[0] && cls.tenant_id === params[1]);
    return result(found ? [{ '?column?': 1 }] : []);
  }
  if (/SELECT material_id, class_id, uploaded_by, stored_path, mime_type, rag_collection FROM lm_materials/i.test(sql)) {
    return result(state.materials.filter((material) => material.class_id === params[0]));
  }
  if (/SELECT c\.published, c\.status, c\.teacher_student_id FROM lm_classes c JOIN lm_students a/i.test(sql)) {
    const actor = state.students.find((student) => student.student_id === params[0]);
    const cls = state.classes.find((candidate) => (
      candidate.class_id === params[1] && candidate.tenant_id === actor?.tenant_id
    ));
    return result(cls ? [{ published: cls.published, status: cls.status, teacher_student_id: cls.teacher_student_id }] : []);
  }
  if (/SELECT status FROM lm_classes WHERE class_id = \$1 AND tenant_id = \$2/i.test(sql)) {
    const cls = state.classes.find((candidate) => candidate.class_id === params[0] && candidate.tenant_id === params[1]);
    return result(cls ? [{ status: cls.status }] : []);
  }
  return undefined;
}

function handleMaterialQuery(state, sql, params) {
  if (/SELECT class_id FROM lm_materials WHERE material_id = \$1/i.test(sql)) {
    const row = state.materials.find((material) => material.material_id === params[0]);
    return result(row ? [{ class_id: row.class_id }] : []);
  }
  if (/SELECT c\.teacher_student_id, a\.role AS actor_role FROM lm_classes c/i.test(sql)) {
    const actor = state.students.find((student) => student.student_id === params[1]);
    const original = state.classes.find((candidate) => candidate.class_id === params[0]);
    const cls = original ? { ...original, ...(state.lockedClassOverride || {}) } : null;
    const allowed = actor && cls && actor.tenant_id === cls.tenant_id && actor.tenant_id === params[2];
    return result(allowed ? [{ teacher_student_id: cls.teacher_student_id, actor_role: actor.role }] : []);
  }
  if (/SELECT m\.material_id, m\.class_id, m\.uploaded_by,[\s\S]*FROM lm_materials m JOIN lm_students uploader/i.test(sql)) {
    const material = state.materials.find((row) => row.material_id === params[0] && row.class_id === params[1]);
    const owner = state.students.find((student) => student.student_id === material?.uploaded_by);
    return result(material && owner?.tenant_id === params[2] ? [material] : []);
  }
  return undefined;
}

function handleDashboardQuery(state, sql, params) {
  if (/SELECT target\.student_id, target\.name, target\.email, target\.xp/i.test(sql)) {
    const target = state.students.find((student) => student.student_id === params[0]);
    const viewer = state.students.find((student) => student.student_id === params[1]);
    const teacherMayView = target && viewer && state.enrollments.some((enrollment) => {
      const cls = state.classes.find((candidate) => candidate.class_id === enrollment.class_id);
      return enrollment.student_id === target.student_id && cls?.tenant_id === target.tenant_id
        && cls.teacher_student_id === viewer.student_id && cls.status === 'active';
    });
    const allowed = target && viewer && target.tenant_id === viewer.tenant_id
      && (target.student_id === viewer.student_id || viewer.role === 'admin'
        || (viewer.role === 'teacher' && teacherMayView));
    return result(allowed ? [target] : []);
  }
  if (/SELECT c\.class_id, c\.name, c\.subject/i.test(sql)) {
    const [targetId, tenantId, teacherId] = params;
    const rows = state.enrollments
      .filter((enrollment) => enrollment.student_id === targetId)
      .map((enrollment) => state.classes.find((cls) => cls.class_id === enrollment.class_id))
      .filter((cls) => cls && cls.tenant_id === tenantId && cls.status === 'active'
        && (!teacherId || cls.teacher_student_id === teacherId))
      .map((cls) => ({ ...cls, lecture_count: '0', flashcard_count: '0' }));
    return result(rows);
  }
  if (/FROM lm_assignments a/i.test(sql)) return result([]);
  if (/FROM lm_quiz_results q/i.test(sql)) return result([{ avg_score: 80, quiz_count: '1' }]);
  if (/FROM lm_flashcard_progress fp/i.test(sql)) return result([{ reviewed: '2' }]);
  return undefined;
}

function provisionedStudent(state, params, fromIdentity) {
  const student = {
    student_id: `provisioned-${state.nextStudent++}`,
    name: params[0], email: params[1],
    external_issuer: fromIdentity ? params[2] : null,
    external_id: fromIdentity ? params[3] : null,
    role: fromIdentity ? params[4] : 'student',
    tenant_id: fromIdentity ? params[5] : params[2],
    xp: 0, level: 1, streak_days: 0, last_active_date: null,
  };
  state.students.push(student);
  return student;
}

/** Model destructive statements separately from identity and roster writes. */
function handleDeleteQuery(state, sql, params) {
  if (/DELETE FROM lm_materials WHERE class_id = \$1/i.test(sql)) {
    const retained = state.materials.filter((material) => material.class_id !== params[0]);
    const deleted = state.materials.length - retained.length;
    state.materials = retained;
    return { rows: [], rowCount: deleted };
  }
  if (/DELETE FROM lm_(flashcards|flashcard_sets|assignments|enrollments)/i.test(sql)) return result([]);
  if (/DELETE FROM lm_classes c USING lm_students a/i.test(sql)) {
    const actor = state.students.find((student) => student.student_id === params[1]);
    const index = state.classes.findIndex((candidate) => candidate.class_id === params[0]);
    const cls = index >= 0 ? state.classes[index] : null;
    const allowed = actor && cls && actor.tenant_id === cls.tenant_id
      && (actor.role === 'admin' || (actor.role === 'teacher' && cls.teacher_student_id === actor.student_id));
    if (allowed) state.classes.splice(index, 1);
    return { rows: [], rowCount: allowed ? 1 : 0 };
  }
  if (/DELETE FROM lm_materials m USING lm_classes c, lm_students a, lm_students uploader/i.test(sql)) {
    const actor = state.students.find((student) => student.student_id === params[1]);
    const index = state.materials.findIndex((material) => material.material_id === params[0]);
    const material = index >= 0 ? state.materials[index] : null;
    const cls = state.classes.find((candidate) => candidate.class_id === material?.class_id);
    const uploader = state.students.find((student) => student.student_id === material?.uploaded_by);
    const allowed = actor && cls && uploader && actor.tenant_id === params[2]
      && actor.tenant_id === cls.tenant_id && uploader.tenant_id === cls.tenant_id
      && (material.uploaded_by === actor.student_id || actor.role === 'admin'
        || (actor.role === 'teacher' && cls.teacher_student_id === actor.student_id));
    if (allowed) state.materials.splice(index, 1);
    return { rows: [], rowCount: allowed ? 1 : 0 };
  }
  return undefined;
}

function handleWriteQuery(state, sql, params) {
  const deleted = handleDeleteQuery(state, sql, params);
  if (deleted !== undefined) return deleted;
  if (/SELECT student_id, name FROM lm_students WHERE lower\(email\) = \$1 AND tenant_id = \$2/i.test(sql)) {
    const rows = state.students.filter((student) => (
      student.email?.toLowerCase() === params[0] && student.tenant_id === params[1]
    ));
    return result(rows);
  }
  if (/INSERT INTO lm_students \(name, email, external_issuer, external_id, role, tenant_id\)/i.test(sql)) {
    return result([provisionedStudent(state, params, true)]);
  }
  if (/INSERT INTO lm_students \(name, email, role, tenant_id\)/i.test(sql)) {
    const student = provisionedStudent(state, params, false);
    return result([{ student_id: student.student_id, name: student.name }]);
  }
  if (/INSERT INTO lm_authorization_audit \(actor_student_id, student_id, class_id, action\)/i.test(sql)) {
    state.audits.push({
      actor_student_id: params[0], student_id: params[1], class_id: params[2], action: params[3],
    });
    return { rows: [], rowCount: 1 };
  }
  if (/^WITH eligible AS MATERIALIZED/i.test(sql)) {
    const actor = state.students.find((student) => student.student_id === params[0]);
    const cls = state.classes.find((candidate) => candidate.class_id === params[1]);
    const eligible = actor && cls && actor.tenant_id === cls.tenant_id && cls.status === 'active'
      && (cls.published || cls.teacher_student_id === actor.student_id);
    if (eligible) {
      const exists = state.enrollments.some((row) => row.student_id === actor.student_id && row.class_id === cls.class_id);
      if (!exists) state.enrollments.push({ student_id: actor.student_id, class_id: cls.class_id });
    }
    return result([{ eligible: Boolean(eligible), enrolled: Boolean(eligible) }]);
  }
  if (/INSERT INTO lm_enrollments/i.test(sql)) {
    const exists = state.enrollments.some((row) => row.student_id === params[0] && row.class_id === params[1]);
    if (!exists) state.enrollments.push({ student_id: params[0], class_id: params[1] });
    return result(exists ? [] : [{ student_id: params[0] }]);
  }
  return undefined;
}

function executeQuery(state, sql, params) {
  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return result([]);
  if (/SELECT pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/i.test(sql)) return result([]);
  const handlers = [handleIdentityQuery, handleTeacherStudentView, handleClassQuery,
    handleMaterialQuery, handleDashboardQuery, handleWriteQuery];
  for (const handler of handlers) {
    const handled = handler(state, sql, params);
    if (handled !== undefined) return handled;
  }
  throw new Error(`unexpected SQL in LM authz test: ${sql}`);
}

function makePool(state = baseState()) {
  const pool = { calls: [] };
  pool.query = async (rawSql, params = []) => {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim();
    pool.calls.push({ sql, params });
    return executeQuery(state, sql, params);
  };
  pool.connect = async () => ({ query: pool.query, release() {} });
  return pool;
}

function reqFor(externalId, overrides = {}) {
  return {
    oidc: {
      isAuthenticated: () => true,
      user: { iss: TEST_ISSUER, sub: externalId },
    },
    body: {}, params: {}, query: {},
    ...overrides,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    sendFile() { return this; },
    redirect(location) { this.statusCode = 302; this.body = location; return this; },
  };
}

async function call(pool, method, routePath, request) {
  const router = createEducationRoutes({ pool, appPackageDir: PKG });
  const handler = router.routes.get(`${method} ${routePath}`);
  assert.ok(handler, `compiled router must register ${method} ${routePath}`);
  const res = makeRes();
  await handler(request, res);
  return res;
}

async function callCatalog(pool, method, routePath, request) {
  const router = createEducationCatalogRoutes({ pool, appPackageDir: PKG });
  const handler = router.routes.get(`${method} ${routePath}`);
  assert.ok(handler, `compiled catalog router must register ${method} ${routePath}`);
  const res = makeRes();
  await handler(request, res);
  return res;
}

function writes(pool) {
  return pool.calls.filter((call) => /^(INSERT|UPDATE|DELETE)\b/i.test(call.sql));
}

test('compiled dashboard enforces the complete two-tenant role matrix', async () => {
  const cases = [
    ['student self', 'oidc-student-a', STUDENT_A, 200],
    ['student peer', 'oidc-student-a', STUDENT_A2, 404],
    ['teacher enrolled learner', 'oidc-teacher-a', STUDENT_A, 200],
    ['teacher unrelated learner', 'oidc-teacher-a', STUDENT_A2, 404],
    ['teacher foreign learner', 'oidc-teacher-a', STUDENT_B, 404],
    ['tenant admin local learner', 'oidc-admin-a', STUDENT_A2, 200],
    ['tenant admin foreign learner', 'oidc-admin-a', STUDENT_B, 404],
    ['malformed target has the same non-oracular response', 'oidc-admin-a', 'not-a-uuid', 404],
  ];
  for (const [label, caller, target, expected] of cases) {
    const pool = makePool();
    const res = await call(pool, 'get', '/student/:studentId/dashboard', reqFor(caller, { params: { studentId: target } }));
    assert.equal(res.statusCode, expected, `${label}: ${JSON.stringify({ body: res.body, calls: pool.calls })}`);
    if (expected === 404) assert.equal(res.body.error, 'Student not found', `${label} must not reveal existence`);
  }
});

test('compiled teacher dashboard scopes every returned aggregate to owned classes', async () => {
  const pool = makePool();
  const res = await call(pool, 'get', '/student/:studentId/dashboard', reqFor('oidc-teacher-a', { params: { studentId: STUDENT_A } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.classes.map((cls) => cls.class_id), ['class-a']);

  const studentRead = pool.calls.find((call) => /SELECT target\.student_id, target\.name, target\.email, target\.xp/i.test(call.sql));
  assert.ok(studentRead);
  assert.doesNotMatch(studentRead.sql, /SELECT \*/i, 'private dashboard must use a minimized student field list');
  assert.match(studentRead.sql, /JOIN lm_students viewer/);
  assert.deepEqual(studentRead.params, [STUDENT_A, TEACHER_A]);
  for (const fragment of ['SELECT c.class_id', 'FROM lm_assignments a', 'FROM lm_quiz_results q', 'FROM lm_flashcard_progress fp']) {
    const query = pool.calls.find((call) => call.sql.includes(fragment));
    assert.ok(query, `missing dashboard query ${fragment}`);
    assert.match(query.sql, /c\.tenant_id = \$2/);
    assert.match(query.sql, /c\.teacher_student_id = \$3/);
    assert.deepEqual(query.params, [STUDENT_A, TENANT_A, TEACHER_A]);
  }
});

test('compiled class-scoped roster endpoint enforces student/teacher/admin tenant rules', async () => {
  const cases = [
    ['student cannot write a roster', 'oidc-student-a', 'class-a', 403],
    ['unrelated teacher cannot write a roster', 'oidc-teacher-a', 'class-a2', 403],
    ['teacher may write their own roster', 'oidc-teacher-a', 'class-a', 201],
    ['tenant admin may write a local roster', 'oidc-admin-a', 'class-a', 201],
    ['tenant admin cannot write a foreign roster', 'oidc-admin-a', 'class-b', 403],
  ];
  for (const [label, caller, classId, expected] of cases) {
    const pool = makePool();
    const res = await call(pool, 'post', '/classes/:classId/students', reqFor(caller, {
      params: { classId },
      body: { email: 'shared@student.school' },
    }));
    assert.equal(res.statusCode, expected, label);
    if (expected !== 201) assert.equal(writes(pool).length, 0, `${label} must mutate nothing`);
    if (expected === 201) {
      const inserted = pool.calls.find((call) => /INSERT INTO lm_students/i.test(call.sql));
      assert.ok(inserted, `${label} should provision a tenant-local placeholder`);
      assert.deepEqual(inserted.params, ['shared', 'shared@student.school', TENANT_A]);
      const enrolled = pool.calls.find((call) => /INSERT INTO lm_enrollments/i.test(call.sql));
      assert.equal(enrolled.params[1], classId);
      assert.equal(enrolled.params[2], TENANT_A);
      const audits = pool.calls.filter((call) => /INSERT INTO lm_authorization_audit/i.test(call.sql));
      assert.equal(audits.length, 2);
      assert.match(audits[0].params[1], /^provisioned-/);
      assert.equal(audits[1].params[1], audits[0].params[1]);
      assert.deepEqual(audits.map((call) => call.params.slice(0, 1)), [
        [caller === 'oidc-admin-a' ? ADMIN_A : TEACHER_A],
        [caller === 'oidc-admin-a' ? ADMIN_A : TEACHER_A],
      ]);
      assert.deepEqual(audits.map((call) => call.params.slice(2)), [
        [classId, 'roster.student_provisioned'],
        [classId, 'roster.enrollment_created'],
      ]);
      const beginAt = pool.calls.findIndex((call) => call.sql === 'BEGIN');
      const classLockAt = pool.calls.findIndex((call) => /SELECT c\.status.*FOR UPDATE OF c, a/i.test(call.sql));
      const lockAt = pool.calls.findIndex((call) => /pg_advisory_xact_lock/i.test(call.sql));
      const lookupAt = pool.calls.findIndex((call) => /SELECT student_id, name FROM lm_students/i.test(call.sql));
      const insertAt = pool.calls.findIndex((call) => /INSERT INTO lm_students/i.test(call.sql));
      assert.ok(beginAt >= 0 && classLockAt > beginAt && lockAt > classLockAt && lookupAt > lockAt && insertAt > lookupAt,
        'transactional class revalidation and tenant+email serialization must precede provisioning');
      assert.deepEqual(pool.calls[classLockAt].params, [classId, caller === 'oidc-admin-a' ? ADMIN_A : TEACHER_A]);
      assert.deepEqual(pool.calls[lockAt].params, [`${TENANT_A}:shared@student.school`]);
      assert.equal(pool.calls.some((call) => call.sql === 'COMMIT'), true);
    }
  }
});

test('compiled class deletion cleans only locked class material artifacts before committing', async () => {
  materialCleanup.calls = [];
  materialCleanup.failCollection = null;
  const state = baseState();
  const pool = makePool(state);
  const res = await call(pool, 'delete', '/classes/:classId', reqFor('oidc-teacher-a', {
    params: { classId: 'class-a' },
  }));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(materialCleanup.calls, [
    { kind: 'rag', value: 'lm-material-a-1' },
    { kind: 'file', value: MATERIAL_A1 },
    { kind: 'file', value: MATERIAL_A2 },
  ]);
  assert.deepEqual(state.materials.map((row) => row.material_id), [MATERIAL_B1]);
  assert.equal(state.classes.some((row) => row.class_id === 'class-a'), false);
  assert.equal(pool.calls.some((call) => call.sql === 'COMMIT'), true);
});

test('compiled class deletion rolls relational work back when external cleanup fails', async () => {
  materialCleanup.calls = [];
  materialCleanup.failCollection = 'lm-material-a-1';
  const state = baseState();
  const pool = makePool(state);
  const res = await call(pool, 'delete', '/classes/:classId', reqFor('oidc-teacher-a', {
    params: { classId: 'class-a' },
  }));

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'Class deletion could not be completed safely' });
  assert.deepEqual(materialCleanup.calls, [{ kind: 'rag', value: 'lm-material-a-1' }]);
  assert.equal(writes(pool).length, 0, 'no relational delete may run after artifact cleanup fails');
  assert.equal(pool.calls.some((call) => call.sql === 'ROLLBACK'), true);
  assert.equal(pool.calls.some((call) => call.sql === 'COMMIT'), false);
  materialCleanup.failCollection = null;
});

test('compiled material deletion revalidates locked authority before exact artifact cleanup', async () => {
  materialCleanup.calls = [];
  materialCleanup.failCollection = null;
  const state = baseState();
  const pool = makePool(state);
  const res = await call(pool, 'delete', '/materials/:materialId', reqFor('oidc-student-a', {
    params: { materialId: MATERIAL_A1 },
  }));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(materialCleanup.calls, [
    { kind: 'rag', value: 'lm-material-a-1' },
    { kind: 'file', value: MATERIAL_A1 },
  ]);
  assert.equal(state.materials.some((row) => row.material_id === MATERIAL_A1), false);
  assert.equal(pool.calls.some((call) => call.sql === 'COMMIT'), true);
});

test('compiled material deletion retains its SQL pointer when RAG cleanup fails', async () => {
  materialCleanup.calls = [];
  materialCleanup.failCollection = 'lm-material-a-1';
  const state = baseState();
  const pool = makePool(state);
  const res = await call(pool, 'delete', '/materials/:materialId', reqFor('oidc-student-a', {
    params: { materialId: MATERIAL_A1 },
  }));

  assert.equal(res.statusCode, 503);
  assert.deepEqual(materialCleanup.calls, [{ kind: 'rag', value: 'lm-material-a-1' }]);
  assert.equal(writes(pool).length, 0);
  assert.equal(state.materials.some((row) => row.material_id === MATERIAL_A1), true);
  assert.equal(pool.calls.some((call) => call.sql === 'ROLLBACK'), true);
  materialCleanup.failCollection = null;
});

test('compiled material deletion stops before cleanup when teacher ownership changed under lock', async () => {
  materialCleanup.calls = [];
  materialCleanup.failCollection = null;
  const state = baseState();
  state.lockedClassOverride = { teacher_student_id: TEACHER_A2 };
  const pool = makePool(state);
  const res = await call(pool, 'delete', '/materials/:materialId', reqFor('oidc-teacher-a', {
    params: { materialId: MATERIAL_A1 },
  }));

  assert.equal(res.statusCode, 403);
  assert.deepEqual(materialCleanup.calls, []);
  assert.equal(writes(pool).length, 0);
  assert.equal(pool.calls.some((call) => call.sql === 'ROLLBACK'), true);
});

test('roster transaction revalidates archive and ownership changes under the class lock', async () => {
  for (const [label, lockedClassOverride, expected] of [
    ['archived before lock', { status: 'archived' }, 409],
    ['ownership changed before lock', { teacher_student_id: TEACHER_A2 }, 403],
  ]) {
    const state = baseState();
    state.lockedClassOverride = lockedClassOverride;
    const pool = makePool(state);
    const res = await call(pool, 'post', '/classes/:classId/students', reqFor('oidc-teacher-a', {
      params: { classId: 'class-a' },
      body: { email: 'race@student.school' },
    }));
    assert.equal(res.statusCode, expected, label);
    assert.equal(writes(pool).length, 0, `${label} must not provision or enroll`);
    assert.equal(pool.calls.some((call) => call.sql === 'ROLLBACK'), true);
    assert.equal(pool.calls.some((call) => /pg_advisory_xact_lock/i.test(call.sql)), false,
      'failed locked revalidation must stop before email provisioning');
  }
});

test('compiled class-bank self-enrollment cannot create a cross-tenant enrollment', async () => {
  const deniedPool = makePool();
  const denied = await callCatalog(
    deniedPool,
    'post',
    '/classes/:classId/enroll',
    reqFor('oidc-student-a', { params: { classId: 'class-b' } }),
  );
  assert.equal(denied.statusCode, 404);
  assert.equal(writes(deniedPool).length, 0);

  const localPool = makePool();
  const local = await callCatalog(
    localPool,
    'post',
    '/classes/:classId/enroll',
    reqFor('oidc-student-a2', { params: { classId: 'class-a' } }),
  );
  assert.equal(local.statusCode, 201);
  const lookup = localPool.calls.find((call) => /SELECT c\.published, c\.status, c\.teacher_student_id/i.test(call.sql));
  assert.deepEqual(lookup.params, [STUDENT_A2, 'class-a']);
  assert.equal(localPool.calls.some((call) => /INSERT INTO lm_enrollments/i.test(call.sql)), true);
});

test('legacy /students and /enroll writes are gone for every role and touch no data', async () => {
  for (const caller of ['oidc-student-a', 'oidc-teacher-a', 'oidc-admin-a']) {
    for (const [routePath, body] of [
      ['/students', { name: 'Victim', email: 'victim@b.school' }],
      ['/enroll', { studentId: STUDENT_B, classId: 'class-a' }],
    ]) {
      const pool = makePool();
      const res = await call(pool, 'post', routePath, reqFor(caller, { body }));
      assert.equal(res.statusCode, 410);
      assert.equal(res.body.error, 'legacy_roster_endpoint_removed');
      assert.equal(writes(pool).length, 0);
    }
  }
});

test('compiled identity resolution cannot attach an email to another tenant placeholder', async () => {
  const state = baseState();
  state.students.push({
    student_id: 'placeholder-a', external_issuer: null, external_id: null, name: 'Shared A',
    email: 'shared@student.school', role: 'student', tenant_id: TENANT_A,
    xp: 0, level: 1, streak_days: 0, last_active_date: null,
  });
  const pool = makePool(state);
  const request = {
    oidc: {
      isAuthenticated: () => true,
      user: { iss: TEST_ISSUER, sub: 'new-oidc-id', email: 'shared@student.school', name: 'Shared Student' },
    },
  };
  // The domain is intentionally unmapped, so it resolves to the package's default
  // tenant; neither tenant-A nor tenant-B placeholder may be selected by email.
  const resolved = await access.resolveAuthedStudent(request, pool);
  assert.equal(resolved.studentId.startsWith('provisioned-'), true);
  const emailLookup = pool.calls.find((call) => /lower\(email\)/i.test(call.sql));
  assert.deepEqual(emailLookup.params, ['shared@student.school', access.DEFAULT_TENANT_ID]);
});

test('tenant resolution fails closed on ambiguous mappings and database faults', async () => {
  const request = {
    oidc: {
      isAuthenticated: () => true,
      user: { iss: TEST_ISSUER, sub: 'unmapped-oidc-id', email: 'student@ambiguous.school', name: 'Student' },
    },
  };
  const cases = [
    ['duplicate domain', [{ tenant_id: TENANT_A }, { tenant_id: TENANT_B }], null],
    ['database fault', null, Object.assign(new Error('database unavailable'), { code: '08006' })],
  ];
  for (const [label, tenantRows, tenantError] of cases) {
    const calls = [];
    const query = async (rawSql, params = []) => {
      const sql = String(rawSql).replace(/\s+/g, ' ').trim();
      calls.push({ sql, params });
      if (/^(BEGIN|ROLLBACK)$/i.test(sql)) return result([]);
      if (/external_issuer = \$1 AND external_id = \$2/i.test(sql)) return result([]);
      if (/FROM lm_tenants/i.test(sql) && tenantError) throw tenantError;
      if (/FROM lm_tenants/i.test(sql)) return result(tenantRows);
      throw new Error(`unexpected SQL in fail-closed case: ${sql}`);
    };
    const pool = { calls, query, connect: async () => ({ query, release() {} }) };
    await assert.rejects(
      access.resolveAuthedStudent(request, pool),
      (err) => err instanceof access.EducationAccessError && err.status === 503,
      label,
    );
    assert.equal(writes(pool).length, 0, `${label} must not provision a default-tenant identity`);
  }
});

test('compiled tutor denies cross-tenant class grounding before material retrieval', async () => {
  const state = baseState();
  state.classes.push({
    class_id: CLASS_B_UUID,
    tenant_id: TENANT_B,
    teacher_student_id: TEACHER_B,
    status: 'active',
    published: true,
    name: 'Private B',
    subject: 'history',
    teacher_name: 'Teacher B',
  });
  const pool = makePool(state);
  const priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-only-key';
  try {
    const req = reqFor('oidc-student-a', {
      body: { message: 'Show me the private class notes', classId: CLASS_B_UUID },
    });
    const res = await call(pool, 'post', '/tutor-chat', req);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'You do not have access to this class');
    assert.equal(pool.calls.some(({ sql }) => /SELECT name, subject, teacher_name/i.test(sql)), false);
    assert.equal(writes(pool).length, 0);
  } finally {
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
  }
});

test('tenant domain uniqueness is an installed database invariant', () => {
  const manifest = require('node:fs').readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const migration = require('node:fs').readFileSync(
    path.join(PKG, 'migrations', '031-tenant-domain-uniqueness.sql'),
    'utf8',
  );
  const compiledBootstrap = require('node:fs').readFileSync(
    path.join(PKG, 'routes', 'education-schema.js'),
    'utf8',
  );
  assert.match(manifest, /migrations\/031-tenant-domain-uniqueness\.sql/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_tenants_domain_unique/i);
  assert.match(migration, /ON lm_tenants \(lower\(domain\)\)/i);
  assert.match(migration, /HAVING COUNT\(\*\) > 1[\s\S]*RAISE EXCEPTION/i);
  assert.match(compiledBootstrap, /CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_tenants_domain_unique/i);
});

test('package metadata keeps the Presentations tab local without an app dependency', () => {
  const fs = require('node:fs');
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const catalog = JSON.parse(fs.readFileSync(path.join(PKG, '..', 'marketplace.json'), 'utf8'));
  const entry = catalog.apps.find(app => app.name === 'little-monsters');
  assert.match(manifest, /toolName:\s*lm-presentations[^\n]*iframeUrl:\s*\/api\/education\/presentation/);
  assert.doesNotMatch(manifest, /iframeUrl:\s*\/api\/presentations\/sections\/ui/);
  assert.match(manifest, /dependencies:\s*\n\s*apps:\s*\[\]/);
  assert.deepEqual(entry?.dependencies?.apps, []);
});
