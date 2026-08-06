/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Prove compiled study routes enforce class roles, private ownership, and pre-RAG authorization.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Prove quiz attempts keep answer keys server-side and bind persistence to class access.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Exercise study generation through caller-scoped, tool-disabled education bots with fenced source material.
 *
 * Little Monsters study authorization closure.
 *
 * Dependency-free node:test coverage over the compiled routes mounted in
 * production. Framework and external-model seams are replaced at require-time;
 * route policy and SQL-bound ownership behavior remain real.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUDENT_A = '10000000-0000-4000-8000-000000000001';
const STUDENT_B = '20000000-0000-4000-8000-000000000001';
const TEACHER_A = '10000000-0000-4000-8000-000000000101';
const TEACHER_B = '20000000-0000-4000-8000-000000000101';
const CLASS_A = '30000000-0000-4000-8000-000000000001';
const CLASS_B = '30000000-0000-4000-8000-000000000002';
const CLASS_SET_A = '40000000-0000-4000-8000-000000000001';
const PRIVATE_SET_A = '40000000-0000-4000-8000-000000000002';
const PRIVATE_SET_B = '40000000-0000-4000-8000-000000000003';
const LEGACY_SET = '40000000-0000-4000-8000-000000000004';
const CLASS_CARD_A = '50000000-0000-4000-8000-000000000001';
const PRIVATE_CARD_A = '50000000-0000-4000-8000-000000000002';
const PRIVATE_CARD_B = '50000000-0000-4000-8000-000000000003';
const LEGACY_CARD = '50000000-0000-4000-8000-000000000004';
const TEST_ISSUER = 'https://issuer.example/';

function fakeRouter() {
  const routes = new Map();
  const router = { routes };
  const register = (method) => (routePath, ...handlers) => {
    routes.set(`${method} ${routePath}`, handlers.at(-1));
    return router;
  };
  for (const method of ['get', 'post', 'patch', 'delete']) router[method] = register(method);
  router.use = (...args) => {
    const child = args.at(-1);
    if (child?.routes instanceof Map) {
      for (const [key, handler] of child.routes) routes.set(key, handler);
    }
    return router;
  };
  return router;
}

const externalCalls = { rag: 0, model: 0 };
class FakeRagService {
  async search() {
    externalCalls.rag += 1;
    return [{ text: 'Authorized class material about fractions and ratios.' }];
  }
}

const STUBS = {
  express: { Router: fakeRouter },
  '@/shared/logger': {
    createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
  },
  '@/features/rag': { RagService: FakeRagService },
  '@/features/swarm-orchestration/services/prompt-containment': {
    wrapUntrustedPromptContent: (source, content) => JSON.stringify({ source, content: String(content ?? '') }),
  },
  '@/features/agent-management': {
    BotNodeClient: class BotNodeClient {},
    createRegistryEndpointResolver: () => async () => null,
  },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async (_ctx, _client, _agentId, request) => {
      externalCalls.model += 1;
      const cards = '[{"front":"What is a ratio?","back":"A comparison.","difficulty":1}]';
      const quiz = '[{"question":"Which is a ratio?","options":["1:2","3","4","5"],"correctIndex":0,"explanation":"It compares values.","topic":"ratios"}]';
      return { response: String(request.text).includes('study flashcards') ? cards : quiz };
    },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const { createEducationStudyRoutes } = require(
  path.join(PKG, 'routes', 'education-study-routes.js'),
);
process.once('exit', () => { Module._load = originalLoad; });

function baseState() {
  return {
    students: [
      { student_id: STUDENT_A, external_issuer: TEST_ISSUER, external_id: 'student-a', email: 'student@a.school', name: 'Student A', role: 'student', tenant_id: TENANT_A },
      { student_id: STUDENT_B, external_issuer: TEST_ISSUER, external_id: 'student-b', email: 'student@b.school', name: 'Student B', role: 'student', tenant_id: TENANT_B },
      { student_id: TEACHER_A, external_issuer: TEST_ISSUER, external_id: 'teacher-a', email: 'teacher@a.school', name: 'Teacher A', role: 'teacher', tenant_id: TENANT_A },
      { student_id: TEACHER_B, external_issuer: TEST_ISSUER, external_id: 'teacher-b', email: 'teacher@b.school', name: 'Teacher B', role: 'teacher', tenant_id: TENANT_B },
    ],
    classes: [
      { class_id: CLASS_A, tenant_id: TENANT_A, teacher_student_id: TEACHER_A, name: 'Math A', subject: 'math' },
      { class_id: CLASS_B, tenant_id: TENANT_B, teacher_student_id: TEACHER_B, name: 'Math B', subject: 'math' },
    ],
    enrollments: [
      { student_id: STUDENT_A, class_id: CLASS_A },
      { student_id: STUDENT_B, class_id: CLASS_B },
    ],
    sets: [
      { set_id: CLASS_SET_A, class_id: CLASS_A, owner_student_id: null, title: 'Shared A', card_count: 1 },
      { set_id: PRIVATE_SET_A, class_id: null, owner_student_id: STUDENT_A, title: 'Private A', card_count: 1 },
      { set_id: PRIVATE_SET_B, class_id: null, owner_student_id: STUDENT_B, title: 'Private B', card_count: 1 },
      { set_id: LEGACY_SET, class_id: null, owner_student_id: null, title: 'Legacy ownerless', card_count: 1 },
    ],
    cards: [
      { card_id: CLASS_CARD_A, set_id: CLASS_SET_A, front: 'Shared question', back: 'Shared answer', difficulty: 2 },
      { card_id: PRIVATE_CARD_A, set_id: PRIVATE_SET_A, front: 'Private A question', back: 'Private A answer', difficulty: 2 },
      { card_id: PRIVATE_CARD_B, set_id: PRIVATE_SET_B, front: 'Private B question', back: 'Private B answer', difficulty: 2 },
      { card_id: LEGACY_CARD, set_id: LEGACY_SET, front: 'Legacy question', back: 'Legacy answer', difficulty: 2 },
    ],
    progress: [],
    attempts: [],
  };
}

function result(rows) {
  return { rows, rowCount: rows.length };
}

function actorById(state, studentId) {
  return state.students.find((student) => student.student_id === studentId);
}

function canUseSet(state, actor, set, mode) {
  if (!actor || !set) return false;
  if (!set.class_id) return Boolean(set.owner_student_id && set.owner_student_id === actor.student_id);
  const cls = state.classes.find((item) => item.class_id === set.class_id);
  if (!cls || cls.tenant_id !== actor.tenant_id) return false;
  if (actor.role === 'admin') return true;
  if (actor.role === 'teacher' && cls.teacher_student_id === actor.student_id) return true;
  return mode === 'read' && state.enrollments.some(
    (row) => row.student_id === actor.student_id && row.class_id === set.class_id,
  );
}

function actorFromTail(state, params) {
  const studentId = params.at(-4);
  return actorById(state, studentId);
}

function handleAccessQuery(state, sql, params) {
  if (/WHERE external_issuer = \$1 AND external_id = \$2/i.test(sql)) {
    return result(state.students.filter((student) => (
      student.external_issuer === params[0] && student.external_id === params[1]
    )));
  }
  if (/SELECT 1 FROM lm_classes WHERE class_id = \$1 AND teacher_student_id = \$2/i.test(sql)) {
    const found = state.classes.some((cls) => cls.class_id === params[0]
      && cls.teacher_student_id === params[1] && cls.tenant_id === params[2]);
    return result(found ? [{ allowed: 1 }] : []);
  }
  if (/SELECT 1 FROM lm_classes WHERE class_id = \$1 AND tenant_id = \$2/i.test(sql)) {
    const found = state.classes.some((cls) => cls.class_id === params[0] && cls.tenant_id === params[1]);
    return result(found ? [{ allowed: 1 }] : []);
  }
  if (/FROM lm_enrollments e JOIN lm_classes c ON c\.class_id = e\.class_id/i.test(sql)) {
    const cls = state.classes.find((item) => item.class_id === params[1]);
    const found = cls?.tenant_id === params[2] && state.enrollments.some(
      (row) => row.student_id === params[0] && row.class_id === params[1],
    );
    return result(found ? [{ allowed: 1 }] : []);
  }
  if (/SELECT class_id, name, subject FROM lm_classes/i.test(sql)) {
    return result(state.classes.filter((cls) => cls.class_id === params[0] && cls.tenant_id === params[1]));
  }
  return undefined;
}

function handleScopedRead(state, sql, params) {
  const mode = /FROM lm_enrollments se/i.test(sql) ? 'read' : 'write';
  const actor = actorFromTail(state, params);
  if (/SELECT fs\.set_id FROM lm_flashcard_sets fs/i.test(sql)) {
    const set = state.sets.find((item) => item.set_id === params[0]);
    return result(canUseSet(state, actor, set, mode) ? [{ set_id: set.set_id }] : []);
  }
  if (/SELECT fc\.card_id FROM lm_flashcards fc/i.test(sql)) {
    const card = state.cards.find((item) => item.card_id === params[0]);
    const set = state.sets.find((item) => item.set_id === card?.set_id);
    return result(canUseSet(state, actor, set, mode) ? [{ card_id: card.card_id }] : []);
  }
  if (/SELECT fs\.set_id AS authorized_set_id/i.test(sql)) {
    const set = state.sets.find((item) => item.set_id === params[0]);
    if (!canUseSet(state, actor, set, 'read')) return result([]);
    const cards = state.cards.filter((card) => card.set_id === set.set_id);
    return result(cards.length ? cards.map((card) => ({ authorized_set_id: set.set_id, ...card }))
      : [{ authorized_set_id: set.set_id, card_id: null }]);
  }
  return undefined;
}

function handleCardWrite(state, sql, params) {
  if (/UPDATE lm_flashcards fc SET front = \$1, back = \$2/i.test(sql)) {
    const card = state.cards.find((item) => item.card_id === params[2]);
    const set = state.sets.find((item) => item.set_id === card?.set_id);
    const actor = actorFromTail(state, params);
    if (!canUseSet(state, actor, set, 'write')) return result([]);
    Object.assign(card, { front: params[0], back: params[1] });
    return result([{ card_id: card.card_id }]);
  }
  if (/INSERT INTO lm_flashcards \(set_id, front, back/i.test(sql)) {
    const card = {
      card_id: `50000000-0000-4000-8000-${String(state.cards.length + 10).padStart(12, '0')}`,
      set_id: params[0], front: params[1], back: params[2], difficulty: params[4],
    };
    state.cards.push(card);
    return result([{ card_id: card.card_id, set_id: card.set_id }]);
  }
  return undefined;
}

function handleSetWrite(state, sql, params) {
  if (!/INSERT INTO lm_flashcard_sets/i.test(sql)) return undefined;
  const isClassSet = /SELECT \$1, c\.class_id, NULL/i.test(sql);
  const set = {
    set_id: params[0],
    class_id: isClassSet ? params[6] : null,
    owner_student_id: isClassSet ? null : params[6],
    title: params[1],
    card_count: params[5],
  };
  if (isClassSet) {
    const actor = actorById(state, params[7]);
    const cls = state.classes.find((item) => item.class_id === set.class_id);
    if (!canUseSet(state, actor, { ...set, class_id: cls?.class_id }, 'write')) return result([]);
  }
  state.sets.push(set);
  return result([{ set_id: set.set_id }]);
}

function handleReview(state, sql, params) {
  if (/SELECT repetitions, ease_factor, interval_days FROM lm_flashcard_progress/i.test(sql)) {
    return result(state.progress.filter((row) => row.student_id === params[0] && row.card_id === params[1]));
  }
  if (/INSERT INTO lm_flashcard_progress/i.test(sql)) {
    const actor = actorById(state, params[0]);
    const card = state.cards.find((item) => item.card_id === params[5]);
    const set = state.sets.find((item) => item.set_id === card?.set_id);
    if (!canUseSet(state, actor, set, 'read')) return result([]);
    const row = { student_id: params[0], card_id: params[5], repetitions: params[1],
      ease_factor: params[2], interval_days: params[3], next_review: params[4] };
    const index = state.progress.findIndex(
      (item) => item.student_id === row.student_id && item.card_id === row.card_id,
    );
    if (index >= 0) state.progress[index] = row; else state.progress.push(row);
    return result([{ card_id: row.card_id }]);
  }
  return undefined;
}

function handleQuizAttempt(state, sql, params) {
  if (!/INSERT INTO lm_quiz_attempts/i.test(sql)) return undefined;
  const actor = actorById(state, params[1]);
  const cls = state.classes.find((item) => item.class_id === params[3]);
  const allowed = cls && canUseSet(
    state,
    actor,
    { class_id: cls.class_id, owner_student_id: null },
    'read',
  );
  if (!allowed || cls.tenant_id !== params[4]) return result([]);
  const attempt = {
    attempt_id: params[0], student_id: params[1], class_id: params[3],
    questions: JSON.parse(params[2]), expires_at: 'database-clock',
  };
  state.attempts.push(attempt);
  return result([{ attempt_id: attempt.attempt_id }]);
}

function executeQuery(state, sql, params) {
  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return result([]);
  if (/SELECT pg_advisory_xact_lock/i.test(sql)) return result([]);
  for (const handler of [handleAccessQuery, handleScopedRead, handleSetWrite,
    handleCardWrite, handleReview, handleQuizAttempt]) {
    const handled = handler(state, sql, params);
    if (handled !== undefined) return handled;
  }
  throw new Error(`unexpected SQL in study authorization test: ${sql}`);
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

function requestFor(externalId, overrides = {}) {
  return {
    oidc: { isAuthenticated: () => true, user: { iss: TEST_ISSUER, sub: externalId } },
    body: {}, params: {}, query: {},
    ...overrides,
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(pool, method, routePath, request) {
  const router = createEducationStudyRoutes({ pool, appPackageDir: PKG });
  const handler = router.routes.get(`${method} ${routePath}`);
  assert.ok(handler, `compiled study router must register ${method} ${routePath}`);
  const response = makeResponse();
  await handler(request, response);
  return response;
}

function writes(pool) {
  return pool.calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE|WITH\s)/i.test(sql));
}

test('foreign class denial happens before RAG, model, or write work', async () => {
  externalCalls.rag = 0;
  externalCalls.model = 0;
  const pool = makePool();
  const response = await call(pool, 'post', '/quiz/generate', requestFor('student-a', {
    body: { classId: CLASS_B, count: 5 },
  }));
  assert.equal(response.statusCode, 403);
  assert.equal(externalCalls.rag, 0);
  assert.equal(externalCalls.model, 0);
  assert.equal(writes(pool).length, 0);
});

test('an enrolled student cannot generate a persistent shared flashcard set', async () => {
  externalCalls.rag = 0;
  externalCalls.model = 0;
  const state = baseState();
  const pool = makePool(state);
  const response = await call(pool, 'post', '/flashcards/generate', requestFor('student-a', {
    body: { classId: CLASS_A, count: 6 },
  }));
  assert.equal(response.statusCode, 403);
  assert.equal(externalCalls.rag, 0);
  assert.equal(externalCalls.model, 0);
  assert.equal(writes(pool).length, 0);
  assert.equal(state.sets.length, 4);
});

test('enrolled quiz generation stores answers once and returns only public fields', async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-only-key';
  externalCalls.rag = 0;
  externalCalls.model = 0;
  const state = baseState();
  const pool = makePool(state);
  try {
    const response = await call(pool, 'post', '/quiz/generate', requestFor('student-a', {
      body: { classId: CLASS_A, count: 5 },
    }));
    assert.equal(response.statusCode, 200);
    assert.match(response.body.attemptId, /^[0-9a-f-]{36}$/i);
    assert.equal(response.body.questions.length, 1);
    assert.deepEqual(Object.keys(response.body.questions[0]).sort(), ['options', 'question', 'topic']);
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0].student_id, STUDENT_A);
    assert.equal(state.attempts[0].questions[0].correctIndex, 0);
    assert.equal(state.attempts[0].questions[0].explanation, 'It compares values.');
    const attemptInsert = pool.calls.find(({ sql }) => /INSERT INTO lm_quiz_attempts/i.test(sql));
    assert.match(attemptInsert.sql, /NOW\(\) \+ INTERVAL '30 minutes'/i);
    assert.equal(externalCalls.rag, 2);
    assert.equal(externalCalls.model, 1);
  } finally {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});

test('an enrolled student can read but cannot poison a shared class set', async () => {
  const state = baseState();
  const pool = makePool(state);
  const read = await call(pool, 'get', '/flashcards/sets/:setId/cards', requestFor('student-a', {
    params: { setId: CLASS_SET_A },
  }));
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.cards[0].card_id, CLASS_CARD_A);

  const edit = await call(pool, 'patch', '/flashcards/cards/:cardId', requestFor('student-a', {
    params: { cardId: CLASS_CARD_A }, body: { front: 'Poisoned', back: 'Poisoned' },
  }));
  assert.equal(edit.statusCode, 404);
  assert.equal(state.cards.find((card) => card.card_id === CLASS_CARD_A).front, 'Shared question');
  assert.equal(writes(pool).length, 0);

  const create = await call(pool, 'post', '/flashcards/sets', requestFor('student-a', {
    body: { classId: CLASS_A, title: 'Poison set', cards: [{ front: 'x', back: 'y' }] },
  }));
  assert.equal(create.statusCode, 403);
  assert.equal(state.sets.some((set) => set.title === 'Poison set'), false);
  assert.equal(writes(pool).length, 0);
});

test('private and historical null-class sets fail closed outside persisted ownership', async () => {
  const state = baseState();
  const ownerPool = makePool(state);
  const owner = await call(ownerPool, 'get', '/flashcards/sets/:setId/cards', requestFor('student-a', {
    params: { setId: PRIVATE_SET_A },
  }));
  assert.equal(owner.statusCode, 200);
  const ownerEdit = await call(ownerPool, 'patch', '/flashcards/cards/:cardId', requestFor('student-a', {
    params: { cardId: PRIVATE_CARD_A }, body: { front: 'Owner edit', back: 'Owner answer' },
  }));
  assert.equal(ownerEdit.statusCode, 200);
  assert.equal(state.cards.find((card) => card.card_id === PRIVATE_CARD_A).front, 'Owner edit');

  for (const setId of [PRIVATE_SET_B, LEGACY_SET]) {
    const pool = makePool(state);
    const denied = await call(pool, 'get', '/flashcards/sets/:setId/cards', requestFor('student-a', {
      params: { setId },
    }));
    assert.equal(denied.statusCode, 404);
    assert.equal(denied.body.error, 'Study resource not found');
  }
  const foreignEdit = await call(makePool(state), 'patch', '/flashcards/cards/:cardId', requestFor('student-a', {
    params: { cardId: PRIVATE_CARD_B }, body: { front: 'Foreign edit', back: 'Foreign answer' },
  }));
  assert.equal(foreignEdit.statusCode, 404);
  assert.equal(state.cards.find((card) => card.card_id === PRIVATE_CARD_B).front, 'Private B question');
});

test('the owning teacher can create a class set and its cards', async () => {
  const state = baseState();
  const pool = makePool(state);
  const response = await call(pool, 'post', '/flashcards/sets', requestFor('teacher-a', {
    body: {
      classId: CLASS_A,
      title: 'Teacher set',
      cards: [{ front: 'Teacher question', back: 'Teacher answer' }],
    },
  }));
  assert.equal(response.statusCode, 201);
  const set = state.sets.find((item) => item.set_id === response.body.setId);
  assert.deepEqual(
    { classId: set.class_id, ownerId: set.owner_student_id, count: set.card_count },
    { classId: CLASS_A, ownerId: null, count: 1 },
  );
  assert.equal(state.cards.some((card) => card.set_id === set.set_id), true);
});

test('SM-2 writes only the authenticated caller and only for readable cards', async () => {
  const state = baseState();
  const pool = makePool(state);
  const response = await call(pool, 'post', '/flashcards/review', requestFor('student-a', {
    body: { studentId: STUDENT_B, cardId: PRIVATE_CARD_A, score: 2 },
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(state.progress.length, 1);
  assert.equal(state.progress[0].student_id, STUDENT_A);

  const denied = await call(pool, 'post', '/flashcards/review', requestFor('student-a', {
    body: { cardId: PRIVATE_CARD_B, score: 2 },
  }));
  assert.equal(denied.statusCode, 404);
  assert.equal(state.progress.length, 1);
});

test('private ownership migration is additive and leaves unknown history ownerless', () => {
  const migration = fs.readFileSync(
    path.join(PKG, 'migrations', '033-flashcard-set-ownership.sql'),
    'utf8',
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS owner_student_id UUID/i);
  assert.match(migration, /FOREIGN KEY \(owner_student_id\).*REFERENCES lm_students/is);
  assert.match(migration, /CHECK \(class_id IS NULL OR owner_student_id IS NULL\) NOT VALID/i);
  assert.match(migration, /WHERE class_id IS NULL AND owner_student_id IS NOT NULL/i);
  assert.doesNotMatch(migration, /UPDATE\s+lm_flashcard_sets\s+SET\s+owner_student_id/i);
});
