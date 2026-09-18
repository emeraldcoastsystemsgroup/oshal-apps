/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove named role decisions through actual catalog, core policy, adapters and HTTP guard without changing a real school record.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PKG, manifest, coreRequire, loadApplicationAuthorization, fixture, httpFixture, access,
  registerEducationAuthorization } = require('./fixture.cjs');
const { resolveOperationPermissions } = coreRequire('./src/features/application-authorization/policy.ts');
const catalog = loadApplicationAuthorization(PKG, manifest);
const registration = { app: manifest.name, catalog };
const http = (method, pathname) => ({ kind: 'http', method, path: pathname });

test('imports student, teacher and admin roles without platform management or tenant-wide grants', () => {
  assert.deepEqual(Object.keys(catalog.roles), ['student', 'teacher', 'admin']);
  assert.equal(catalog.roles.student.tier, 'editor');
  assert.equal(catalog.roles.admin.tier, 'admin');
  for (const role of Object.values(catalog.roles)) {
    assert.ok(role.grants.every(grant => grant.scope === 'own'));
    assert.ok(role.grants.every(grant => !grant.permission.startsWith('@')));
  }
  assert.ok(catalog.roles.student.grants.every(grant => catalog.permissions[grant.permission].resource === 'learner'));
});

test('every shipped HTTP route, static surface and game has one binding including HEAD', () => {
  const declared = [];
  for (const file of fs.readdirSync(path.join(PKG, 'src-routes')).filter(file => file.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(PKG, 'src-routes', file), 'utf8');
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) declared.push([match[1].toUpperCase(), match[2]]);
  }
  for (const game of fs.readdirSync(path.join(PKG, 'tools/games'))) declared.push(['GET', `/games/${game}/index.html`]);
  for (const [method, pathname] of declared) {
    assert.ok(resolveOperationPermissions(registration, http(method, pathname)), `${method} ${pathname}`);
    if (method === 'GET') assert.ok(resolveOperationPermissions(registration, http('HEAD', pathname)), `HEAD ${pathname}`);
  }
  for (const pathname of ['/unexpected', '/games/new-game/index.html', '/games/snake/secret.json', '/education.css/extra']) {
    assert.equal(resolveOperationPermissions(registration, http('GET', pathname)), null, pathname);
  }
  assert.equal(catalog.bindings.http.some(binding => binding.path === '/:any'), false);
});

test('all declared bots and tutor handoff bind named permissions; undeclared tools and jobs fail closed', () => {
  assert.deepEqual(catalog.bindings.bots.map(binding => binding.id), manifest.bots.map(bot => bot.agentId));
  assert.deepEqual(resolveOperationPermissions(registration, { kind: 'artifactActions', operation: 'tutor' }), ['app.open', 'tutor.execute']);
  assert.equal(resolveOperationPermissions(registration, { kind: 'tools', operation: 'enroll-anyone' }), null);
  assert.equal(resolveOperationPermissions(registration, { kind: 'jobs', operation: 'school-sweep' }), null);
});

test('student can study, upload and use the tutor without acquiring teaching or management rights', async () => {
  const f = await fixture();
  await f.change('student', 'student');
  for (const operation of [http('GET', '/dashboard'), http('GET', '/me'), http('POST', '/quiz-results'),
    http('POST', '/flashcards/sets'), http('POST', '/materials'), http('POST', '/tutor-chat')]) {
    assert.equal((await f.authorize('student', operation)).allowed, true);
  }
  for (const operation of [http('GET', '/teacher'), http('POST', '/classes/class-a/students'),
    http('POST', '/materials/material-a/approve'), http('POST', '/assignments'), http('POST', '/flashcards/generate')]) {
    assert.equal((await f.authorize('student', operation)).allowed, false);
  }
  const effective = await f.policy.effective(f.people.student, { app: manifest.name });
  assert.deepEqual(effective.roles, ['student']);
  assert.deepEqual(effective.managementRoles, []);
  assert.deepEqual(f.pool.reads, []);
});

test('first-sign-in principal reaches ordinary routes without any structural adoption or enrollment write', async () => {
  const f = await fixture();
  await f.change('student', 'unbound');
  assert.equal((await f.authorize('unbound', http('GET', '/me'))).allowed, true);
  assert.equal((await f.authorize('unbound', http('POST', '/classes/class-a/students'))).allowed, false);
  assert.deepEqual(f.pool.reads, []);
  assert.equal(f.rows.length, 3);
});

test('teacher and admin need both the structural grant and a current matching roster role', async () => {
  const f = await fixture();
  assert.equal((await f.authorize('teacher', http('GET', '/teacher'))).allowed, false);
  for (const who of ['student', 'teacher', 'admin', 'otherIssuer', 'unbound']) await f.change('teacher', who);
  for (const who of ['teacher', 'admin']) assert.equal((await f.authorize(who, http('GET', '/teacher'))).allowed, true);
  for (const who of ['student', 'otherIssuer', 'unbound']) assert.equal((await f.authorize(who, http('GET', '/teacher'))).allowed, false);
  assert.ok(f.pool.reads.some(values => values[0] === f.people.otherIssuer.issuer));
  f.rows.find(row => row.role === 'teacher').role = 'student';
  assert.equal((await f.authorize('teacher', http('GET', '/teacher'))).allowed, false);
  assert.equal(f.rows.find(row => row.external_id === 'student').role, 'student');
});

test('ambiguous roster and missing school refuse teaching; no platform-admin bypass', async () => {
  const f = await fixture();
  await f.change('admin', 'student');
  assert.equal((await f.authorize('student', http('POST', '/assignments'))).allowed, false);
  assert.equal((await f.authorize('operator', http('POST', '/assignments'))).allowed, false);
  await f.change('teacher', 'teacher');
  const row = f.rows.find(row => row.role === 'teacher');
  f.rows.push({ ...row });
  assert.equal((await f.authorize('teacher', http('GET', '/teacher'))).allowed, false);
  f.rows.pop(); row.tenant_id = null;
  assert.equal((await f.authorize('teacher', http('GET', '/teacher'))).allowed, false);
});

test('explicit denies and revocations override student permissions immediately', async () => {
  const f = await fixture();
  await f.change('student', 'student');
  await f.change(undefined, 'student', 'deny', { permission: 'tutor.execute' });
  assert.equal((await f.authorize('student', http('POST', '/tutor-chat'))).allowed, false);
  assert.equal((await f.authorize('student', http('GET', '/me'))).allowed, true);
  await f.change('student', 'student', 'revoke');
  assert.equal((await f.authorize('student', http('GET', '/me'))).allowed, false);
});

test('catalog adoption refuses old assignments until explicitly revoked and never converts fallback admin into student', async () => {
  const f = await fixture({ catalogless: true });
  await f.change('@app-admin', 'student');
  assert.equal((await f.authorize('student', http('GET', '/me'))).allowed, true);
  await assert.rejects(f.runtime.prepare(manifest, f.record.manifestPath),
    error => error.code === 'authorization_catalog_migration_required');
  assert.deepEqual((await f.store.read()).assignments.map(row => row.role), ['@app-admin']);
  await f.change('@app-admin', 'student', 'revoke');
  await f.runtime.prepare(manifest, f.record.manifestPath);
  const record = { ...f.record, manifest };
  await f.runtime.start(record);
  registerEducationAuthorization({ pool: f.pool, authorization: f.runtime.forPackage(manifest.name) });
  f.runtime.complete(record);
  assert.equal((await f.authorize('student', http('GET', '/me'))).allowed, false);
  await f.change('student', 'student');
  assert.equal((await f.authorize('student', http('GET', '/me'))).allowed, true);
  assert.equal((await f.authorize('student', http('POST', '/classes/c/students'))).allowed, false);
});

test('existing roster gate still denies a student and confines a teacher to their own school class', async () => {
  const calls = [];
  const pool = { async query(sql, values) { calls.push([sql, values]); return { rows: values.join('|') === 'class-a|teacher-a|school-a' ? [{}] : [] }; } };
  const teacher = { role: 'teacher', studentId: 'teacher-a', tenantId: 'school-a' };
  await access.assertTeacherOfClass(pool, teacher, 'class-a');
  await assert.rejects(access.assertTeacherOfClass(pool, teacher, 'class-b'), error => error.status === 403);
  await assert.rejects(access.assertTeacherOfClass(pool, { ...teacher, role: 'student' }, 'class-a'), error => error.status === 403);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([sql]) => sql.includes('teacher_student_id = $2 AND tenant_id = $3')));
});

test('actual HTTP guard accepts student assets and own activity and blocks staff, unknown paths and revoked access', async () => {
  const f = await httpFixture();
  try {
    await f.change('student', 'student');
    assert.equal((await f.call('/education.css', 'student')).status, 200);
    assert.equal((await f.call('/games/snake/index.html', 'student', 'HEAD')).status, 200);
    assert.equal((await f.call('/quiz-results', 'student', 'POST')).status, 200);
    assert.equal((await f.call('/teacher', 'student')).status, 403);
    assert.equal((await f.call('/classes/c/students', 'student', 'POST')).status, 403);
    assert.equal((await f.call('/new-admin-route', 'student')).status, 403);
    await f.change('student', 'student', 'revoke');
    assert.equal((await f.call('/education.css', 'student')).status, 403);
  } finally { await f.close(); }
});

test('Test Lab catalog resolves every shipped suite and does not run live browser suites during installation', () => {
  const { loadPackageTestCatalog } = coreRequire('./scripts/oshal-test-catalog.js');
  const loaded = loadPackageTestCatalog(PKG, manifest);
  const registered = new Set(loaded.catalog.cases.flatMap(row => row.runner.files || []));
  const tests = path.join(PKG, 'tests');
  const suites = fs.readdirSync(tests).filter(file => /\.(test\.cjs|spec\.ts)$/.test(file));
  for (const file of suites) assert.ok(registered.has(`tests/${file}`), file);
  assert.ok(registered.has('tests/authorization/catalog.test.cjs'));
  for (const file of fs.readdirSync(path.join(tests, 'unit'))) assert.ok(registered.has(`tests/unit/${file}`), file);
  assert.ok(loaded.catalog.cases.filter(row => row.runner.kind !== 'smoke').every(row => row.installation === 'never'));
});
