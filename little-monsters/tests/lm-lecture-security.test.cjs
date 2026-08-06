/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add compiled lecture route guards for issuer-bound authorization, strict inputs, safe artifacts, zero-side-effect denials, and the protected route matrix.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Exercise lecture generation through the caller-scoped, tool-disabled bot boundary with fenced transcript input.
 * -----------------------------------------------------------------------------
 *
 * Dependency-free node:test coverage over the compiled lecture modules mounted
 * by the package loader. Framework services are replaced only at require-time;
 * the security boundary and route implementations remain the compiled bytes.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const PACKAGE_ROOT = process.env.LM_COMPILED_ROOT
  ? path.resolve(process.env.LM_COMPILED_ROOT) : path.resolve(__dirname, '..');
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEACHER_A = '10000000-0000-4000-8000-000000000101';
const TEACHER_A2 = '10000000-0000-4000-8000-000000000102';
const STUDENT_A = '10000000-0000-4000-8000-000000000001';
const ADMIN_A = '10000000-0000-4000-8000-000000000201';
const TEACHER_B = '20000000-0000-4000-8000-000000000101';
const CLASS_A = '30000000-0000-4000-8000-000000000001';
const CLASS_A2 = '30000000-0000-4000-8000-000000000002';
const CLASS_B = '40000000-0000-4000-8000-000000000001';
const LECTURE_A = '50000000-0000-4000-8000-000000000001';
const FIXED_ARTIFACT = '60000000-0000-4000-8000-000000000001';
const TEST_ISSUER = 'https://identity.example.test/';

const effects = { stt: 0, ticket: 0, rag: 0, model: 0, pptx: 0 };

function fakeRouter() {
  const routes = new Map();
  const router = { routes };
  const register = (method) => (routePath, ...handlers) => {
    routes.set(`${method} ${routePath}`, handlers.at(-1));
    return router;
  };
  router.get = register('get');
  router.post = register('post');
  router.use = (...args) => {
    const child = args.at(-1);
    if (child?.routes instanceof Map) {
      for (const [key, handler] of child.routes) routes.set(key, handler);
    }
    return router;
  };
  return router;
}

function fakeMulter() {
  return { single: () => (_req, _res, next) => next?.() };
}
fakeMulter.memoryStorage = () => ({});

const STUBS = {
  express: { Router: fakeRouter },
  multer: fakeMulter,
  '@/shared/logger': {
    createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
  },
  '@/entities/ticket/internal-ticket': { CreateInternalTicketSchema: { parse: (value) => value } },
  './education-voice-routes': {
    runSynchronousTranscription: async () => {
      effects.stt += 1;
      return { status: 'transcribed', providerId: 'test' };
    },
    buildLectureTicketDescription: () => 'test ticket',
  },
  './education-pptx': {
    renderAndSaveLectureDeck: async () => {
      effects.pptx += 1;
      return { provider: 'test', savedTo: 'relative', slides: 1, fileName: 'lecture.pptx' };
    },
  },
  '@/features/rag': {
    RagService: class RagService {
      constructor() { effects.rag += 1; }
      async ingest() { return { collection: 'test', chunkCount: 1 }; }
    },
  },
  '@/features/swarm-orchestration/services/prompt-containment': {
    wrapUntrustedPromptContent: (source, content) => JSON.stringify({ source, content: String(content ?? '') }),
  },
  '@/features/agent-management': {
    BotNodeClient: class BotNodeClient {},
    createRegistryEndpointResolver: () => async () => null,
  },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async () => {
      effects.model += 1;
      return { response: JSON.stringify({ notes: '', flashcards: [], assignments: [], slides: [] }) };
    },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const security = require(path.join(PACKAGE_ROOT, 'routes', 'education-lecture-security.js'));
const uploadRoutes = require(path.join(PACKAGE_ROOT, 'routes', 'education-lecture-upload-routes.js'));
const transcriptRoutes = require(path.join(PACKAGE_ROOT, 'routes', 'education-lecture-transcript-routes.js'));
const readRoutes = require(path.join(PACKAGE_ROOT, 'routes', 'education-lecture-read-routes.js'));
const composedRoutes = require(path.join(PACKAGE_ROOT, 'routes', 'education-lecture-routes.js'));
process.once('exit', () => { Module._load = originalLoad; });

const actors = new Map([
  ['oidc-teacher-a', { student_id: TEACHER_A, role: 'teacher', tenant_id: TENANT_A, name: 'Teacher A' }],
  ['oidc-teacher-a2', { student_id: TEACHER_A2, role: 'teacher', tenant_id: TENANT_A, name: 'Teacher A2' }],
  ['oidc-student-a', { student_id: STUDENT_A, role: 'student', tenant_id: TENANT_A, name: 'Student A' }],
  ['oidc-admin-a', { student_id: ADMIN_A, role: 'admin', tenant_id: TENANT_A, name: 'Admin A' }],
  ['oidc-teacher-b', { student_id: TEACHER_B, role: 'teacher', tenant_id: TENANT_B, name: 'Teacher B' }],
]);

const classes = [
  { class_id: CLASS_A, teacher_student_id: TEACHER_A, tenant_id: TENANT_A, name: 'Math', subject: 'math' },
  { class_id: CLASS_A2, teacher_student_id: TEACHER_A2, tenant_id: TENANT_A, name: 'Science', subject: 'science' },
  { class_id: CLASS_B, teacher_student_id: TEACHER_B, tenant_id: TENANT_B, name: 'History', subject: 'history' },
];

function result(rows) {
  return { rows, rowCount: rows.length };
}

function identityQuery(sql, params) {
  if (!/WHERE external_issuer = \$1 AND external_id = \$2/i.test(sql)) return undefined;
  if (params[0] !== TEST_ISSUER) return result([]);
  const actor = actors.get(params[1]);
  return result(actor ? [actor] : []);
}

function writableClassQuery(sql, params) {
  if (!/SELECT class_id, name, subject\s+FROM lm_classes/i.test(sql)) return undefined;
  const [classId, tenantId, role, actorId] = params;
  const found = classes.find((item) => item.class_id === classId && item.tenant_id === tenantId
    && (role === 'admin' || item.teacher_student_id === actorId));
  return result(found ? [found] : []);
}

function lectureQuery(sql, params, outsidePath) {
  if (!/FROM lm_lectures l\s+JOIN lm_classes c/i.test(sql)) return undefined;
  if (params[0] !== LECTURE_A || params[1] !== TENANT_A) return result([]);
  return result([{
    lecture_id: LECTURE_A, class_id: CLASS_A, lecture_date: '2026-08-05',
    status: 'complete', duration_seconds: 30, flashcard_set_id: null,
    created_at: '2026-08-05T00:00:00.000Z', class_name: 'Math', subject: 'math',
    transcript_path: outsidePath, notes_path: null, slides_path: outsidePath,
    audio_path: outsidePath,
  }]);
}

function classAccessQuery(sql, params) {
  if (/teacher_student_id = \$2 AND tenant_id = \$3/i.test(sql)) {
    const found = classes.some((item) => item.class_id === params[0]
      && item.teacher_student_id === params[1] && item.tenant_id === params[2]);
    return result(found ? [{ allowed: 1 }] : []);
  }
  if (/FROM lm_enrollments e\s+JOIN lm_classes c/i.test(sql)) return result([]);
  if (/class_id = \$1 AND tenant_id = \$2/i.test(sql)) {
    const found = classes.some((item) => item.class_id === params[0] && item.tenant_id === params[1]);
    return result(found ? [{ allowed: 1 }] : []);
  }
  return undefined;
}

function makePool(outsidePath = path.resolve('outside-lecture-artifact')) {
  const pool = { calls: [] };
  pool.query = async (rawSql, params = []) => {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim();
    pool.calls.push({ sql, params });
    for (const handler of [identityQuery, writableClassQuery]) {
      const handled = handler(sql, params);
      if (handled !== undefined) return handled;
    }
    const lecture = lectureQuery(sql, params, outsidePath);
    if (lecture !== undefined) return lecture;
    const access = classAccessQuery(sql, params);
    if (access !== undefined) return access;
    if (/^(INSERT|UPDATE|DELETE)/i.test(sql)) return result([]);
    throw new Error(`unexpected lecture test SQL: ${sql}`);
  };
  pool.connect = async () => ({ query: pool.query, release() {} });
  return pool;
}

function requestFor(subject, overrides = {}) {
  return {
    oidc: { isAuthenticated: () => true, user: { iss: TEST_ISSUER, sub: subject } },
    body: {}, params: {}, query: {},
    ...overrides,
  };
}

function makeResponse() {
  return {
    statusCode: 200, body: undefined, sentFile: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    sendFile(file) { this.sentFile = file; return this; },
  };
}

function appContext(pool) {
  return {
    pool,
    ticketService: {
      async createTicket() { effects.ticket += 1; return { ticketId: 'test-ticket' }; },
    },
  };
}

async function callRoute(router, method, routePath, req) {
  const handler = router.routes.get(`${method} ${routePath}`);
  assert.ok(handler, `compiled router must register ${method} ${routePath}`);
  const res = makeResponse();
  await handler(req, res);
  return res;
}

function writeQueries(pool) {
  return pool.calls.filter((call) => /^(INSERT|UPDATE|DELETE)\b/i.test(call.sql));
}

function resetEffects() {
  for (const key of Object.keys(effects)) effects[key] = 0;
}

test('strict date, UUID, and content sniffing reject traversal and extension spoofing', () => {
  assert.equal(security.isUuid(CLASS_A), true);
  assert.equal(security.isUuid('../school'), false);
  assert.equal(security.resolveLectureDate('2024-02-29'), '2024-02-29');
  assert.throws(() => security.resolveLectureDate('2025-02-29'), /real calendar date/);
  assert.throws(() => security.resolveLectureDate('2026-8-5'), /YYYY-MM-DD/);
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
  assert.deepEqual(security.sniffAudioFormat(wav), { extension: 'wav', mimeType: 'audio/wav' });
  assert.equal(security.sniffAudioFormat(Buffer.from('OggS-test')).extension, 'ogg');
  assert.equal(security.sniffAudioFormat(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])).extension, 'webm');
  assert.throws(() => security.sniffAudioFormat(Buffer.from('not audio')), /Unsupported/);
});

test('teacher/admin write authorization is tenant-bound and read-only', async () => {
  const pool = makePool();
  const actor = (studentId, role, tenantId) => ({
    studentId, role, tenantId, email: null, name: role,
  });
  const owner = await security.authorizeLectureClassWrite(
    pool, actor(TEACHER_A, 'teacher', TENANT_A), CLASS_A,
  );
  const admin = await security.authorizeLectureClassWrite(
    pool, actor(ADMIN_A, 'admin', TENANT_A), CLASS_A,
  );
  assert.equal(owner.classId, CLASS_A);
  assert.equal(admin.classId, CLASS_A);
  for (const denied of [
    actor(STUDENT_A, 'student', TENANT_A),
    actor(TEACHER_A2, 'teacher', TENANT_A),
    actor(TEACHER_B, 'teacher', TENANT_B),
  ]) {
    await assert.rejects(
      security.authorizeLectureClassWrite(pool, denied, CLASS_A),
      (error) => error.status === 403,
    );
  }
  assert.equal(writeQueries(pool).length, 0);
});

test('lecture identity lookup binds the subject to its verified OIDC issuer', async () => {
  const pool = makePool();
  const req = requestFor('oidc-teacher-a', {
    oidc: {
      isAuthenticated: () => true,
      user: { iss: 'https://different-issuer.example.test/', sub: 'oidc-teacher-a' },
    },
  });
  await assert.rejects(
    security.resolveLectureActor(req, pool),
    (error) => error.status === 403,
  );
  const lookup = pool.calls.find((call) => /external_issuer = \$1/i.test(call.sql));
  assert.deepEqual(lookup.params, ['https://different-issuer.example.test/', 'oidc-teacher-a']);
  assert.equal(writeQueries(pool).length, 0);
});

test('artifact writer is random, exclusive, and contained; persisted escapes fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-lecture-security-'));
  try {
    const write = {
      classId: CLASS_A, instanceId: LECTURE_A, subdirectory: 'lectures',
      prefix: 'recording', extension: 'wav', data: Buffer.from('RIFF0000WAVE'),
      educationRoot: root, idFactory: () => FIXED_ARTIFACT,
    };
    const saved = security.writeRandomLectureArtifact(write);
    assert.equal(security.resolvePersistedLectureFile(CLASS_A, saved, root), fs.realpathSync(saved));
    assert.throws(() => security.writeRandomLectureArtifact(write), /EEXIST/);
    const outside = path.join(root, 'outside.wav');
    fs.writeFileSync(outside, 'outside');
    assert.throws(() => security.resolvePersistedLectureFile(CLASS_A, outside, root), /unavailable/);
    assert.throws(() => security.writeRandomLectureArtifact({ ...write, classId: '../escape' }), /UUID/);
    assert.throws(() => security.writeRandomLectureArtifact({ ...write, extension: 'exe' }), /filename/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a class workspace link cannot redirect artifacts into another class directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-lecture-link-'));
  try {
    const target = path.join(root, CLASS_B);
    const redirected = path.join(root, CLASS_A);
    fs.mkdirSync(target, { recursive: true });
    fs.symlinkSync(target, redirected, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => security.writeRandomLectureArtifact({
      classId: CLASS_A, instanceId: LECTURE_A, subdirectory: 'lectures',
      prefix: 'recording', extension: 'wav', data: Buffer.from('RIFF0000WAVE'),
      educationRoot: root,
    }), /unavailable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('peer teacher denial precedes lecture upload filesystem, STT, ticket, and DB writes', async () => {
  resetEffects();
  const pool = makePool();
  const router = uploadRoutes.createEducationLectureUploadRoutes(appContext(pool));
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-lecture-denial-'));
  const priorCwd = process.cwd();
  process.chdir(sandbox);
  try {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
    const req = requestFor('oidc-teacher-a2', {
      body: { classId: CLASS_A, lectureDate: '2026-08-05' },
      file: { buffer: wav, size: wav.length, mimetype: 'audio/wav', originalname: '../../evil.exe' },
    });
    const res = await callRoute(router, 'post', '/process-lecture', req);
    assert.equal(res.statusCode, 403);
    assert.equal(fs.existsSync(path.join(sandbox, 'workspace-shared')), false);
    assert.deepEqual(effects, { stt: 0, ticket: 0, rag: 0, model: 0, pptx: 0 });
    assert.equal(writeQueries(pool).length, 0);
  } finally {
    process.chdir(priorCwd);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('authorized upload ignores the original extension and returns no internal path', async () => {
  resetEffects();
  const pool = makePool();
  const router = uploadRoutes.createEducationLectureUploadRoutes(appContext(pool));
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-lecture-upload-'));
  const priorCwd = process.cwd();
  process.chdir(sandbox);
  try {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
    const req = requestFor('oidc-teacher-a', {
      body: { classId: CLASS_A, lectureDate: '2026-08-05' },
      file: { buffer: wav, size: wav.length, mimetype: 'application/octet-stream', originalname: '../../evil.exe' },
    });
    const res = await callRoute(router, 'post', '/process-lecture', req);
    assert.equal(res.statusCode, 201);
    const files = fs.readdirSync(path.join(sandbox, 'workspace-shared', 'education', CLASS_A, 'lectures'), { recursive: true });
    assert.equal(files.some((name) => String(name).endsWith('.exe')), false);
    assert.equal(files.some((name) => /^lecture-2026-08-05-[0-9a-f-]+\.wav$/i.test(path.basename(String(name)))), true);
    assert.equal(JSON.stringify(res.body).includes('workspace-shared'), false);
    assert.equal(effects.stt, 1);
    assert.equal(effects.ticket, 1);
  } finally {
    process.chdir(priorCwd);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('cross-tenant transcript denial precedes credentials, RAG, model, files, storage, and writes', async () => {
  resetEffects();
  const priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const pool = makePool();
  const router = transcriptRoutes.createEducationLectureTranscriptRoutes(appContext(pool));
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-transcript-denial-'));
  const priorCwd = process.cwd();
  const req = requestFor('oidc-teacher-b', {
    body: { classId: CLASS_A, transcript: 'A sufficiently long private classroom transcript.' },
  });
  process.chdir(sandbox);
  try {
    const res = await callRoute(router, 'post', '/process-transcript', req);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(effects, { stt: 0, ticket: 0, rag: 0, model: 0, pptx: 0 });
    assert.equal(writeQueries(pool).length, 0);
    assert.equal(fs.existsSync(path.join(sandbox, 'workspace-shared')), false);
  } finally {
    process.chdir(priorCwd);
    fs.rmSync(sandbox, { recursive: true, force: true });
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
  }
});

test('peer teacher cannot attach lecture audio and denial has zero durable side effects', async () => {
  resetEffects();
  const pool = makePool();
  const router = uploadRoutes.createEducationLectureUploadRoutes(appContext(pool));
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-audio-denial-'));
  const priorCwd = process.cwd();
  process.chdir(sandbox);
  try {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
    const req = requestFor('oidc-teacher-a2', {
      params: { lectureId: LECTURE_A }, body: { durationSeconds: 30 },
      file: { buffer: wav, size: wav.length, mimetype: 'audio/wav' },
    });
    const res = await callRoute(router, 'post', '/lectures/:lectureId/audio', req);
    assert.equal(res.statusCode, 403);
    assert.equal(fs.existsSync(path.join(sandbox, 'workspace-shared')), false);
    assert.equal(writeQueries(pool).length, 0);
    assert.deepEqual(effects, { stt: 0, ticket: 0, rag: 0, model: 0, pptx: 0 });
  } finally {
    process.chdir(priorCwd);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('lecture read/export/audio matrix denies a peer and never touches artifacts or storage', async () => {
  resetEffects();
  const pool = makePool();
  const router = readRoutes.createEducationLectureReadRoutes(appContext(pool));
  const cases = [
    ['get', '/lectures/:lectureId'],
    ['get', '/lectures/:lectureId/slides'],
    ['post', '/lectures/:lectureId/pptx'],
    ['get', '/lectures/:lectureId/audio'],
  ];
  for (const [method, routePath] of cases) {
    const req = requestFor('oidc-teacher-a2', { params: { lectureId: LECTURE_A } });
    const res = await callRoute(router, method, routePath, req);
    assert.equal(res.statusCode, 403, `${method} ${routePath}`);
    assert.equal(res.sentFile, null);
  }
  assert.equal(effects.pptx, 0);
  assert.equal(writeQueries(pool).length, 0);
});

test('central lecture lookup is tenant-bound before class artifact authorization', async () => {
  const pool = makePool();
  const router = readRoutes.createEducationLectureReadRoutes(appContext(pool));
  const req = requestFor('oidc-teacher-b', { params: { lectureId: LECTURE_A } });
  const res = await callRoute(router, 'get', '/lectures/:lectureId', req);
  assert.equal(res.statusCode, 404);
  const lookup = pool.calls.find((call) => /FROM lm_lectures l/i.test(call.sql));
  assert.deepEqual(lookup.params, [LECTURE_A, TENANT_B]);
  assert.equal(writeQueries(pool).length, 0);
});

test('authorized reads still reject persisted paths outside the expected class workspace', async () => {
  resetEffects();
  const outside = path.resolve(os.tmpdir(), 'lm-outside-lecture-audio.webm');
  const pool = makePool(outside);
  const router = readRoutes.createEducationLectureReadRoutes(appContext(pool));
  const req = requestFor('oidc-teacher-a', { params: { lectureId: LECTURE_A } });
  const res = await callRoute(router, 'get', '/lectures/:lectureId/audio', req);
  assert.equal(res.statusCode, 404);
  assert.equal(res.sentFile, null);
  assert.equal(res.body.error, 'Lecture artifact is unavailable');
});

test('compiled composition exposes the complete protected lecture route matrix', () => {
  const pool = makePool();
  const router = composedRoutes.createEducationLectureRoutes(appContext(pool));
  const expected = [
    'post /process-lecture', 'post /process-transcript', 'get /lectures',
    'get /lectures/recent', 'get /lectures/:lectureId',
    'get /lectures/:lectureId/slides', 'post /lectures/:lectureId/pptx',
    'post /lectures/:lectureId/audio', 'get /lectures/:lectureId/audio',
  ];
  assert.deepEqual([...router.routes.keys()].sort(), expected.sort());
});

test('safe lecture projection contains availability flags but no internal paths', () => {
  const projected = security.publicLecture({
    lecture_id: LECTURE_A, class_id: CLASS_A, lecture_date: '2026-08-05',
    status: 'complete', duration_seconds: 30, flashcard_set_id: null,
    created_at: '2026-08-05', class_name: 'Math', subject: 'math',
    transcript_path: '/internal/transcript', notes_path: '/internal/notes',
    slides_path: '/internal/slides', audio_path: '/internal/audio',
  });
  assert.equal(projected.has_audio, true);
  assert.equal(Object.keys(projected).some((key) => key.endsWith('_path')), false);
  assert.equal(JSON.stringify(projected).includes('/internal/'), false);
});
