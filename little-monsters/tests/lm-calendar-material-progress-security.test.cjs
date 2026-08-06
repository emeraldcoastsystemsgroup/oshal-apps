/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Add source-level adversarial guards for calendar, notification, material, XP, and quiz security boundaries
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Refresh material lifecycle guards for locked tenant authority and exact fail-closed artifact cleanup
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Track the minimized locked quiz-attempt projection used by server-authoritative grading
 * -----------------------------------------------------------------------------
 *
 * This dependency-free node:test suite transpiles the current TypeScript sources
 * in memory. That matters while the package build is intentionally paused: these
 * guards exercise the source under review without writing shared compiled routes.
 * Static assertions pin the SQL predicates that an in-memory database double
 * cannot faithfully enforce, while behavioral cases prove denial-before-write,
 * response minimization, no-clobber storage, and server-authoritative grading.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(PKG, 'src-routes');
const CALLER_ID = '10000000-0000-4000-8000-000000000001';
const FOREIGN_ID = '20000000-0000-4000-8000-000000000001';
const CLASS_ID = '30000000-0000-4000-8000-000000000001';
const MATERIAL_ID = '40000000-0000-4000-8000-000000000001';
const ATTEMPT_ID = '50000000-0000-4000-8000-000000000001';

class TestAccessError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const seam = {
  caller: {}, visibleTargets: new Set(), accessibleClassIds: [], awards: [],
  randomUuid: '90000000-0000-4000-8000-000000000001',
};

function resetSeam() {
  seam.caller = {
    studentId: CALLER_ID, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Student A', email: 'private@student.a', role: 'student',
  };
  seam.visibleTargets = new Set([CALLER_ID]);
  seam.accessibleClassIds = [CLASS_ID];
  seam.awards = [];
  seam.randomUuid = '90000000-0000-4000-8000-000000000001';
}

function fakeRouter() {
  const routes = new Map();
  const router = { routes };
  const register = method => (routePath, ...handlers) => {
    routes.set(`${method} ${routePath}`, handlers.at(-1));
    return router;
  };
  for (const method of ['get', 'post', 'patch', 'delete']) router[method] = register(method);
  router.use = child => {
    if (child?.routes instanceof Map) {
      for (const [key, handler] of child.routes) routes.set(key, handler);
    }
    return router;
  };
  return router;
}

const ACCESS_STUB = {
  EducationAccessError: TestAccessError,
  resolveAuthedStudent: async () => seam.caller,
  listAccessibleClassIds: async () => seam.accessibleClassIds,
  assertClassAccess: async () => {},
  assertTeacherOfClass: async () => {},
  assertTeacher: () => {},
  assertCanViewStudent: async (_pool, _caller, targetId) => {
    if (!seam.visibleTargets.has(targetId)) throw new TestAccessError('Student not found', 404);
  },
};

const PROGRESS_STUB = {
  levelFromXP: () => 1,
  awardXP: async (_ctx, studentId, eventType, metadata, dedupeKey) => {
    seam.awards.push({ studentId, eventType, metadata, dedupeKey });
    return { xpAwarded: 10 };
  },
};

const STUBS = {
  express: { Router: fakeRouter },
  '@/shared/logger': {
    createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
  },
  '@/app/routes/tool-routes': {
    registerDynamicToolUI() {}, deregisterDynamicToolUI() {},
  },
  './education-access': ACCESS_STUB,
  './education-dashboard-routes': { createEducationDashboardRoutes: fakeRouter },
  './education-progress': PROGRESS_STUB,
  crypto: { randomUUID: () => seam.randomUuid },
};

function findTypeScript() {
  const roots = [process.env.OSHAL_ROOT, path.resolve(__dirname, '..', '..', '..', 'oshal')]
    .filter(Boolean);
  const packageDir = roots.map(root => path.join(root, 'node_modules', 'typescript'))
    .find(candidate => fs.existsSync(path.join(candidate, 'package.json')));
  assert.ok(packageDir, 'the sibling oshal checkout must provide the TypeScript compiler');
  return require(packageDir);
}

function loadSourceModules() {
  const ts = findTypeScript();
  const originalLoad = Module._load;
  const originalTsLoader = Module._extensions['.ts'];
  Module._extensions['.ts'] = (loadedModule, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    }).outputText;
    loadedModule._compile(output, filename);
  };
  Module._load = function loadWithSecurityStubs(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return {
      notifications: require(path.join(SOURCE_DIR, 'education-notification-routes.ts')),
      google: require(path.join(SOURCE_DIR, 'education-google-calendar-routes.ts')),
      classInfo: require(path.join(SOURCE_DIR, 'education-class-routes.ts')),
      materialStorage: require(path.join(SOURCE_DIR, 'education-material-storage.ts')),
      progress: require(path.join(SOURCE_DIR, 'education-progress-routes.ts')),
    };
  } finally {
    Module._load = originalLoad;
    if (originalTsLoader) Module._extensions['.ts'] = originalTsLoader;
    else delete Module._extensions['.ts'];
  }
}

resetSeam();
const modules = loadSourceModules();

function sourceFile(name) {
  return fs.readFileSync(path.join(SOURCE_DIR, name), 'utf8');
}

function functionBlock(source, name) {
  const startMatch = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`).exec(source);
  assert.ok(startMatch, `expected function ${name}`);
  const nextDoc = source.indexOf('\n/**', startMatch.index + startMatch[0].length);
  return source.slice(startMatch.index, nextDoc < 0 ? source.length : nextDoc);
}

function constBlock(source, name) {
  const start = source.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `expected const ${name}`);
  const end = source.indexOf('\n};', start);
  assert.notEqual(end, -1, `expected object terminator for ${name}`);
  return source.slice(start, end + 3);
}

function assertOrdered(source, fragments, reason) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor + 1);
    assert.ok(next > cursor, `${reason}: expected ${fragment} after offset ${cursor}`);
    cursor = next;
  }
}

function makeResponse() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

function request(overrides = {}) {
  return { body: {}, params: {}, query: {}, path: '/test', ...overrides };
}

async function invoke(factory, ctx, method, routePath, req) {
  const router = factory(ctx);
  const handler = router.routes.get(`${method} ${routePath}`);
  assert.ok(handler, `source router must register ${method} ${routePath}`);
  const res = makeResponse();
  await handler(req, res);
  return res;
}

function makeReminderPool() {
  const calls = [];
  const client = {
    query: async (rawSql, params = []) => {
      const sql = String(rawSql).replace(/\s+/g, ' ').trim();
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return { calls, connect: async () => client, query: client.query };
}

function makeClassInfoPool() {
  const calls = [];
  return {
    calls,
    query: async (rawSql, params = []) => {
      const sql = String(rawSql).replace(/\s+/g, ' ').trim();
      calls.push({ sql, params });
      if (/FROM lm_classes/i.test(sql)) return { rows: [{ class_id: CLASS_ID }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
}

function exerciseMaterialStorage() {
  const originalCwd = process.cwd();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-material-security-'));
  try {
    process.chdir(temporaryRoot);
    const pdf = Buffer.from('%PDF-1.7\ncontent');
    const saved = modules.materialStorage.saveMaterialFile(
      CLASS_ID, CALLER_ID, { buffer: pdf, mimetype: 'image/png' },
    );
    assert.equal(saved.mimeType, 'application/pdf');
    assert.match(saved.storedPath, /90000000-0000-4000-8000-000000000001\.pdf$/);
    assert.throws(
      () => modules.materialStorage.saveMaterialFile(
        CLASS_ID, CALLER_ID, { buffer: pdf, mimetype: 'image/png' },
      ),
      error => error?.code === 'EEXIST',
    );
    const row = {
      material_id: MATERIAL_ID, class_id: CLASS_ID, uploaded_by: CALLER_ID,
      stored_path: saved.storedPath,
    };
    assert.equal(modules.materialStorage.resolveStoredMaterialPath(row), fs.realpathSync(saved.storedPath));
    assert.throws(() => modules.materialStorage.resolveStoredMaterialPath({
      ...row, stored_path: path.join(temporaryRoot, 'foreign.txt'),
    }), /escaped its owner directory/);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function makeQuizPool() {
  const state = {
    completed: false, calls: [], resultParams: null,
    questions: [
      { question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 1, topic: 'one' },
      { question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 0, topic: 'two' },
    ],
  };
  const client = {
    query: async (rawSql, params = []) => {
      const sql = String(rawSql).replace(/\s+/g, ' ').trim();
      state.calls.push({ sql, params });
      if (/SELECT a\.class_id, a\.questions, a\.expires_at, a\.completed_at FROM lm_quiz_attempts/i.test(sql)) return { rows: [{
        attempt_id: ATTEMPT_ID, student_id: CALLER_ID, class_id: CLASS_ID,
        questions: state.questions, expires_at: '2099-01-01',
        completed_at: state.completed ? '2098-01-01' : null,
      }], rowCount: 1 };
      if (/INSERT INTO lm_quiz_results/i.test(sql)) state.resultParams = params;
      if (/UPDATE lm_quiz_attempts SET completed_at/i.test(sql)) state.completed = true;
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    query: async (rawSql, params = []) => {
      state.calls.push({ sql: String(rawSql).replace(/\s+/g, ' ').trim(), params });
      return { rows: [{ class_id: CLASS_ID }], rowCount: 1 };
    },
    connect: async () => client,
  };
  return { pool, state };
}

test('cross-tenant notification targets are denied before any insert', async () => {
  resetSeam();
  const pool = { calls: [], query: async (sql, params) => {
    const statement = String(sql).replace(/\s+/g, ' ').trim();
    pool.calls.push({ sql: statement, params });
    const scoped = /SELECT s\.student_id[\s\S]*s\.student_id = \$5/i.test(statement)
      && /s\.tenant_id = \$7[\s\S]*c\.teacher_student_id = \$5/i.test(statement);
    return { rows: scoped ? [] : [{ notification_id: 'unexpected' }], rowCount: scoped ? 0 : 1 };
  } };
  const res = await invoke(
    modules.notifications.createEducationNotificationRoutes,
    { pool }, 'post', '/notify',
    request({ body: { studentId: FOREIGN_ID, title: 'x', body: 'y', channel: 'in-app' } }),
  );
  assert.equal(res.statusCode, 404);
  assert.equal(pool.calls.length, 1);
  assert.deepEqual(
    pool.calls[0].params,
    [FOREIGN_ID, 'x', 'y', 'in-app', CALLER_ID, false, seam.caller.tenantId, false],
  );

  const route = functionBlock(sourceFile('education-notification-routes.ts'), 'sendNotification');
  assertOrdered(route, ['resolveAuthedStudent', 'requirePattern', 'INSERT INTO lm_notifications'],
    'notification identity resolution and validation must precede the final guarded write');
  assert.match(route, /s\.student_id = \$5[\s\S]*s\.tenant_id = \$7/);
  assert.match(route, /c\.teacher_student_id = \$5[\s\S]*c\.tenant_id = \$7[\s\S]*c\.status = 'active'/);
  assert.match(route, /if \(!result\.rows\[0\]\).*Student not found/);
});

test('reminder delivery locks only caller-visible personal and shared events', async () => {
  resetSeam();
  const pool = makeReminderPool();
  const res = await invoke(
    modules.notifications.createEducationNotificationRoutes,
    { pool }, 'post', '/check-reminders', request(),
  );
  assert.deepEqual(res.body, { processed: 0, notificationsSent: 0 });
  const lock = pool.calls.find(call => /FROM lm_calendar_events/i.test(call.sql));
  assert.ok(lock);
  assert.match(lock.sql, /e\.student_id = \$1 OR \( e\.student_id IS NULL AND c\.tenant_id = \$2/i);
  assert.match(lock.sql, /c\.teacher_student_id = \$1[\s\S]*ae\.student_id = \$1 AND ae\.class_id = c\.class_id/i);
  assert.match(lock.sql, /FOR UPDATE OF e SKIP LOCKED/i);
  assert.deepEqual(lock.params, [CALLER_ID, seam.caller.tenantId, false, false]);

  const source = sourceFile('education-notification-routes.ts');
  const processBatch = functionBlock(source, 'processReminders');
  assertOrdered(processBatch, ['resolveAuthedStudent', 'deliverReminderBatch'],
    'reminder scope must derive from the authenticated caller');
});

test('retired Google bridge returns 410 without controller profile leakage', async () => {
  resetSeam();
  seam.caller.email = 'operator-secret@example.test';
  const res = await invoke(
    modules.google.createRetiredGoogleCalendarRoutes,
    { pool: {} }, 'get', '/calendar/google/status', request({ path: '/calendar/google/status' }),
  );
  assert.equal(res.statusCode, 410);
  assert.equal(res.body.code, 'TENANT_CALENDAR_CREDENTIALS_REQUIRED');
  assert.equal(res.body.connected, false);
  assert.doesNotMatch(JSON.stringify(res.body), /operator-secret|studentId|tenantId/i);

  const source = sourceFile('education-google-calendar-routes.ts');
  const bridge = functionBlock(source, 'retiredCalendarBridge');
  assertOrdered(bridge, ['resolveAuthedStudent', 'res.status(410)'], 'authentication must precede retirement response');
  assert.doesNotMatch(source, /GoogleCalendarService|getProfile|access_token|refresh_token|client_secret/i);
});

test('class info excludes another student\'s personal calendar events', async () => {
  resetSeam();
  const pool = makeClassInfoPool();
  const res = await invoke(
    modules.classInfo.createEducationClassRoutes,
    { pool }, 'get', '/classes/:classId/info', request({ params: { classId: CLASS_ID } }),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'upcomingEvents'), false);
  assert.equal(pool.calls.some(call => /lm_calendar_events/i.test(call.sql)), false);
  const classRead = pool.calls.find(call => /FROM lm_classes/i.test(call.sql));
  assert.match(classRead.sql, /class_id = \$1 AND tenant_id = \$2/i);
  assert.match(classRead.sql, /\bmetadata\b/i, 'the minimized projection must retain rendered class settings');
  assert.deepEqual(classRead.params, [CLASS_ID, seam.caller.tenantId]);
  const handler = functionBlock(sourceFile('education-class-routes.ts'), 'getClassInfo');
  assert.doesNotMatch(handler, /lm_calendar_events|upcomingEvents/i);
});

test('material storage is contained, no-clobber, content-classified, and per-material', () => {
  resetSeam();
  exerciseMaterialStorage();
  const unknown = modules.materialStorage.classifyMaterial(
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'application/pdf',
  );
  assert.deepEqual(unknown, { mimeType: 'application/octet-stream', extension: '.bin' });
  assert.equal(
    modules.materialStorage.materialCollectionName(MATERIAL_ID),
    'lm-material-40000000000040008000000000000001',
  );

  const storage = sourceFile('education-material-storage.ts');
  assert.match(functionBlock(storage, 'saveMaterialFile'), /randomUUID\(\)[\s\S]*flag: 'wx'/);
  const containment = functionBlock(storage, 'resolveStoredMaterialPath');
  assert.match(containment, /lexicalRelative\.startsWith\('\.\.'\)[\s\S]*path\.isAbsolute\(lexicalRelative\)/);
  assert.match(containment, /realpathSync\(expectedRoot\)[\s\S]*realpathSync\(candidate\)/);
  assert.match(containment, /realRelative\.startsWith\('\.\.'\)[\s\S]*path\.isAbsolute\(realRelative\)/);
  const materials = sourceFile('education-materials-routes.ts');
  assert.match(functionBlock(materials, 'ensureMaterialGrounding'), /materialCollectionName\(row\.material_id\)/);
  assert.match(functionBlock(materials, 'deleteLockedMaterial'), /deleteMaterialCollection\(transaction\.row\.rag_collection\)/);
  assert.match(functionBlock(materials, 'deleteLockedMaterial'), /deleteStoredMaterial\(transaction\.row\)/);
  assert.match(functionBlock(materials, 'deleteAuthorizedMaterialRow'), /USING lm_classes c, lm_students a, lm_students uploader/);
});

test('client XP route accepts only the allowlist and uses a server dedupe bucket', async () => {
  resetSeam();
  const factory = modules.progress.createEducationProgressRoutes;
  const denied = await invoke(factory, { pool: {} }, 'post', '/xp', request({
    body: { eventType: 'quiz_high_score', studentId: FOREIGN_ID, xpAmount: 1_000_000 },
  }));
  assert.equal(denied.statusCode, 400);
  assert.equal(seam.awards.length, 0);

  const originalNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    const input = request({ body: { eventType: 'notes_reviewed', studentId: FOREIGN_ID } });
    await invoke(factory, { pool: {} }, 'post', '/xp', input);
    await invoke(factory, { pool: {} }, 'post', '/xp', input);
  } finally {
    Date.now = originalNow;
  }
  assert.equal(seam.awards.length, 2);
  assert.deepEqual(seam.awards.map(award => award.studentId), [CALLER_ID, CALLER_ID]);
  assert.equal(seam.awards[0].dedupeKey, seam.awards[1].dedupeKey);
  assert.match(seam.awards[0].dedupeKey, /^client:notes_reviewed:\d+$/);

  const routes = sourceFile('education-progress-routes.ts');
  const keys = [...constBlock(routes, 'CLIENT_XP_COOLDOWNS').matchAll(/^\s{2}([a-z_]+):/gm)]
    .map(match => match[1]).sort();
  assert.deepEqual(keys, ['flashcard_session', 'game_played', 'game_warmup', 'notes_reviewed', 'study_session']);
  assert.match(sourceFile('education-progress.ts'), /ON CONFLICT \(student_id, dedupe_key\)[\s\S]*DO NOTHING/i);
  assert.match(sourceFile('../migrations/036-authoritative-progress.sql'), /UNIQUE INDEX[\s\S]*\(student_id, dedupe_key\)/i);
});

test('quiz grading ignores client scores and consumes the stored attempt once', async () => {
  resetSeam();
  const { pool, state } = makeQuizPool();
  const body = {
    attemptId: ATTEMPT_ID, answers: [1, 2], scorePercent: 100,
    correctAnswers: 99, totalQuestions: 99, studentId: FOREIGN_ID,
  };
  const first = await invoke(
    modules.progress.createEducationProgressRoutes,
    { pool }, 'post', '/quiz-results', request({ body }),
  );
  assert.equal(first.statusCode, 201);
  assert.deepEqual(
    { score: first.body.scorePercent, correct: first.body.correctAnswers, total: first.body.totalQuestions },
    { score: 50, correct: 1, total: 2 },
  );
  assert.deepEqual(state.resultParams.slice(0, 5), [CALLER_ID, CLASS_ID, 50, 2, 1]);
  assert.equal(state.completed, true);
  assert.match(state.calls.find(call => /SELECT a\.class_id, a\.questions/i.test(call.sql)).sql, /FOR UPDATE/i);

  const second = await invoke(
    modules.progress.createEducationProgressRoutes,
    { pool }, 'post', '/quiz-results', request({ body }),
  );
  assert.equal(second.statusCode, 409);
  const route = functionBlock(sourceFile('education-progress-routes.ts'), 'recordQuizResult');
  assert.doesNotMatch(route, /req\.body\?\.(?:score|scorePercent|correctAnswers|totalQuestions|studentId)/);
  const grade = functionBlock(sourceFile('education-progress-routes.ts'), 'gradeQuizAttempt');
  assertOrdered(grade, ['FOR UPDATE', 'attempt.questions', 'gradeQuestions', 'INSERT INTO lm_quiz_results',
    'UPDATE lm_quiz_attempts SET completed_at'], 'stored attempt must be graded and consumed atomically');
});
