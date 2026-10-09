/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pilot proof for enterprise authorization: directory-group grants, group denies, unmapping and stale/overage evidence through the real core policy and HTTP guard, and the tutor/study bots through the real controller execution guard (BotNodeClient and the inline orchestrator) with two actors, an explicit deny and revocation between queue and execution.
 */
/**
 * Isolated fixture evidence, not live acceptance. What is real: the package catalog, core's policy
 * service (preview/apply, group evidence rules, explicit deny), core's HTTP guard over loopback, and
 * core's execution guard as BotNodeClient.execute and TaskOrchestrator.processMessage call it. What
 * is doubled, and why: the policy store is in memory (its PostgreSQL boundary is proven in core
 * tests/unit/authorization-postgres-integration.spec.ts); the execution policy port is wired to the
 * runtime exactly as application-authorization-wiring.ts does minus its durable ownership read (also
 * proven there); and the bot endpoint resolver is a recorder, so an admitted run is observed reaching
 * endpoint resolution while no model, provider, bot node or network is touched.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { manifest, coreRequire, fixture, httpFixture, DIRECTORY, directoryEvidence } = require('./fixture.cjs');
const { configureApplicationExecutionPolicy } = coreRequire('./src/shared/application-authorization-execution/index.ts');
const { runWithApplicationAuthorizationActor } = coreRequire('./src/shared/application-authorization-context/index.ts');
const { BotNodeClient } = coreRequire('./src/features/agent-management/services/bot-node-client.ts');
const { TaskOrchestrator } = coreRequire('./src/features/chat-orchestration/services/task-orchestrator.ts');

const STUDENTS = 'group-students-a';
const NO_TUTOR = 'group-tutor-paused';
const STAFF = 'group-staff-a';
const TUTOR = 'ed000000-0000-0000-0000-000000000002';
const QUIZ = 'ed000000-0000-0000-0000-000000000003';
const http = (method, pathname) => ({ kind: 'http', method, path: pathname });

/**
 * Wire core's execution port to this fixture's runtime the way the composition root does, and give
 * BotNodeClient an endpoint recorder. An admitted dispatch reaches endpoint resolution and then stops
 * with "No endpoint found"; a refused one never reaches it.
 */
function delegation(f) {
  configureApplicationExecutionPolicy({ owner: (kind, id) => f.runtime.owner(kind, id),
    protectedApp: app => f.runtime.protectedApp(app), authorize: (actor, operation) => f.runtime.authorize(actor, operation) });
  const resolved = [];
  const client = new BotNodeClient(agentId => { resolved.push(agentId); return null; }, 1000, { env: {} });
  const run = (who, agentId, userSub = f.people[who].sub) => runWithApplicationAuthorizationActor(f.people[who],
    () => client.execute(agentId, { agentId, taskId: `lm-${who}`, workspaceFolderId: `lm-${who}`, text: 'Explain photosynthesis',
      direct: false, userSub }));
  return { resolved, run };
}
test.afterEach(() => configureApplicationExecutionPolicy(undefined));

/** An admitted dispatch fails only at the recorded endpoint lookup, never with an authorization code. */
async function assertAdmitted(pending, resolved, agentId) {
  const before = resolved.length;
  await assert.rejects(pending, error => /No endpoint found/.test(error.message) && error.status === undefined);
  assert.deepEqual(resolved.slice(before), [agentId]);
}

/** A refused dispatch is a 403 with the policy's reason, before any endpoint work. */
async function assertRefused(pending, resolved, code) {
  const before = resolved.length;
  await assert.rejects(pending, error => error.status === 403 && (code === undefined || error.code === code));
  assert.equal(resolved.length, before);
}

test('a verified directory group grants the non-sensitive student role, and a direct teacher grant differs from it', async () => {
  const f = await fixture();
  await f.groupChange('student', STUDENTS);
  await f.change('teacher', 'teacher');
  f.people.student.directory = directoryEvidence([STUDENTS]);
  f.people.teacher.directory = directoryEvidence([STAFF]);
  for (const operation of [http('GET', '/me'), http('POST', '/quiz-results'), http('POST', '/tutor-chat'), http('POST', '/materials')]) {
    assert.equal((await f.authorize('student', operation)).allowed, true, operation.path);
  }
  for (const operation of [http('GET', '/teacher'), http('POST', '/flashcards/generate'), http('POST', '/classes/class-a/students')]) {
    assert.equal((await f.authorize('student', operation)).allowed, false, operation.path);
  }
  for (const operation of [http('GET', '/teacher'), http('POST', '/flashcards/generate'), http('POST', '/tutor-chat')]) {
    assert.equal((await f.authorize('teacher', operation)).allowed, true, operation.path);
  }
  const effective = await f.policy.effective(f.people.student, { app: manifest.name });
  assert.deepEqual(effective.roles, ['student']);
  assert.deepEqual(effective.managementRoles, []);
  const assignments = (await f.store.read()).assignments;
  assert.equal(assignments.filter(row => row.group).length, 1);
  assert.equal(assignments.some(row => row.targetSub === 'student'), false, 'the student holds no direct assignment');
});

test('a group-mapped deny wins over a direct grant and clearing it restores exactly that permission', async () => {
  const f = await fixture();
  await f.change('student', 'student');
  await f.groupChange(undefined, NO_TUTOR, 'deny', { permission: 'tutor.execute' });
  f.people.student.directory = directoryEvidence([NO_TUTOR]);
  assert.equal((await f.authorize('student', http('POST', '/tutor-chat'))).reason, 'authorization_explicit_deny');
  assert.equal((await f.authorize('student', http('GET', '/me'))).allowed, true);
  f.people.student.directory = directoryEvidence([]);
  assert.equal((await f.authorize('student', http('POST', '/tutor-chat'))).allowed, true, 'deny follows membership');
  f.people.student.directory = directoryEvidence([NO_TUTOR]);
  await f.groupChange(undefined, NO_TUTOR, 'clear-deny', { permission: 'tutor.execute' });
  assert.equal((await f.authorize('student', http('POST', '/tutor-chat'))).allowed, true);
  await f.groupChange(undefined, NO_TUTOR, 'deny');
  assert.equal((await f.authorize('student', http('GET', '/me'))).reason, 'authorization_explicit_deny');
});

test('stale, overage, foreign-tenant, future and missing directory evidence refuse instead of guessing', async () => {
  const f = await fixture();
  await f.groupChange('student', STUDENTS);
  const me = http('GET', '/me');
  const cases = {
    stale: directoryEvidence([STUDENTS], { observedAt: new Date(Date.now() - 301_000).toISOString() }),
    overage: directoryEvidence([STUDENTS], { complete: false }),
    foreignTenant: directoryEvidence([STUDENTS], { tenantId: 'directory-school-b' }),
    future: directoryEvidence([STUDENTS], { observedAt: new Date(Date.now() + 60_000).toISOString() }),
    missing: undefined,
  };
  for (const [label, directory] of Object.entries(cases)) {
    f.people.student.directory = directory;
    assert.equal((await f.authorize('student', me)).reason, 'authorization_directory_unavailable', label);
  }
  await f.change('teacher', 'teacher');
  assert.equal((await f.authorize('teacher', http('GET', '/teacher'))).reason, 'authorization_directory_unavailable',
    'a direct grant is not honored while group evidence that could carry a deny is unknown');
  f.people.teacher.directory = directoryEvidence([STAFF]);
  assert.equal((await f.authorize('teacher', http('GET', '/teacher'))).allowed, true);
});

test('unmapping a group revokes it, and sensitive teacher/admin group mappings need an approval verifier', async () => {
  const f = await fixture();
  await f.groupChange('student', STUDENTS);
  f.people.student.directory = directoryEvidence([STUDENTS]);
  assert.equal((await f.authorize('student', http('GET', '/me'))).allowed, true);
  await f.groupChange('student', STUDENTS, 'group-unmap');
  assert.equal((await f.authorize('student', http('GET', '/me'))).allowed, false);
  assert.equal((await f.store.read()).assignments.length, 0);
  for (const role of ['teacher', 'admin']) {
    const preview = await f.policy.previewChange(f.people.operator, { app: manifest.name, action: 'group-map', role,
      group: { issuer: DIRECTORY.issuer, tenantId: DIRECTORY.tenantId, id: STAFF },
      reason: 'Synthetic sensitive group mapping', expectedRevision: (await f.store.read()).revision });
    assert.equal(preview.requiresApproval, true, role);
    await assert.rejects(f.policy.applyChange(f.people.operator, { previewId: preview.previewId, idempotencyKey: preview.previewId }),
      error => error.code === 'authorization_approval_required', role);
  }
  assert.equal((await f.store.read()).assignments.length, 0);
});

test('real HTTP guard: group student, direct teacher, group deny and unmapping differ over the same routes', async () => {
  const f = await httpFixture();
  try {
    await f.groupChange('student', STUDENTS);
    await f.change('teacher', 'teacher');
    f.people.student.directory = directoryEvidence([STUDENTS]);
    f.people.teacher.directory = directoryEvidence([STAFF]);
    assert.equal((await f.call('/me', 'student')).status, 200);
    assert.equal((await f.call('/tutor-chat', 'student', 'POST')).status, 200);
    assert.equal((await f.call('/flashcards/generate', 'student', 'POST')).status, 403);
    assert.equal((await f.call('/teacher', 'student')).status, 403);
    assert.equal((await f.call('/flashcards/generate', 'teacher', 'POST')).status, 200);
    assert.equal((await f.call('/teacher', 'teacher')).status, 200);
    f.people.student.directory = directoryEvidence([STUDENTS], { complete: false });
    assert.equal((await f.call('/me', 'student')).status, 403);
    f.people.student.directory = directoryEvidence([STUDENTS, NO_TUTOR]);
    await f.groupChange(undefined, NO_TUTOR, 'deny', { permission: 'tutor.execute' });
    assert.equal((await f.call('/tutor-chat', 'student', 'POST')).status, 403);
    assert.equal((await f.call('/me', 'student')).status, 200);
    await f.groupChange('student', STUDENTS, 'group-unmap');
    assert.equal((await f.call('/me', 'student')).status, 403);
    assert.equal((await f.call('/teacher', 'teacher')).status, 200);
  } finally { await f.close(); }
});

test('delegated AI: the controller execution guard admits the tutor and study bots per actor and refuses others before any endpoint', async () => {
  const f = await fixture();
  const { resolved, run } = delegation(f);
  await f.groupChange('student', STUDENTS);
  f.people.student.directory = directoryEvidence([STUDENTS]);
  f.people.unbound.directory = directoryEvidence([]);
  await assertAdmitted(run('student', TUTOR), resolved, TUTOR);
  await assertAdmitted(run('student', QUIZ), resolved, QUIZ);
  await assertRefused(run('unbound', TUTOR), resolved);
  await assertRefused(run('student', TUTOR, 'teacher'), resolved, 'authorization_execution_identity_required');
  await f.change(undefined, 'student', 'deny', { permission: 'tutor.execute' });
  await assertRefused(run('student', TUTOR), resolved, 'authorization_explicit_deny');
  await assertAdmitted(run('student', QUIZ), resolved, QUIZ);
  const orchestrator = new TaskOrchestrator({});
  await assert.rejects(runWithApplicationAuthorizationActor(f.people.student, () => orchestrator.processMessage('lm-inline', 'hi',
    { agentId: TUTOR, userSub: 'student', agenticMode: false, source: 'dashboard', autoApprove: false })),
  error => error.status === 403 && error.code === 'authorization_explicit_deny');
  assert.deepEqual(resolved, [TUTOR, QUIZ, QUIZ]);
});

test('delegated AI: revoking between queue and execution refuses the queued tutor run, direct or group-derived', async () => {
  const f = await fixture();
  const { resolved, run } = delegation(f);
  await f.change('student', 'student');
  await f.groupChange('student', STUDENTS);
  f.people.student.directory = directoryEvidence([]);
  f.people.admin.directory = directoryEvidence([STUDENTS]);
  const queued = operation => f.runtime.authorize(f.people[operation], { app: manifest.name, kind: 'bots', operation: TUTOR });
  assert.equal((await queued('student')).allowed, true);
  assert.equal((await queued('admin')).allowed, true);
  await f.change('student', 'student', 'revoke');
  await f.groupChange('student', STUDENTS, 'group-unmap');
  await assertRefused(run('student', TUTOR), resolved);
  await assertRefused(run('admin', TUTOR), resolved);
  assert.deepEqual(resolved, []);
});
