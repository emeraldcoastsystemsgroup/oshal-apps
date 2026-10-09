/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Shared two-school fixture for the enterprise-authorization pilot: a disposable PostgreSQL 16 (core DisposablePostgres, machine-wide fixture slots) with every package migration applied AS a NOSUPERUSER NOBYPASSRLS runtime role, synthetic schools/classes/learners, and the compiled manifest entrypoint mounted behind core's real policy service and HTTP guard, in the order the manifest route mounter uses.
 */
/**
 * Isolated fixture, not live acceptance. Real: package migrations (all manifest migrations except 020,
 * which only writes the kernel `agents` table this fixture does not host - asserted), PostgreSQL 16,
 * a runtime role that owns the tables it reads (the installed condition), the compiled
 * `routes/education-routes.js`, core's policy service and HTTP guard, and the package's own teaching
 * adapter reading the real roster. Doubled: the OIDC session (a loopback header picks one synthetic
 * issuer/subject and is attached as req.oidc, the shape every trusted rail provides) and the policy
 * store (in memory; its PostgreSQL boundary is proven in core authorization-postgres-integration).
 * Docker is required: a missing engine fails, it never skips.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
const { PKG, CORE, coreRequire, manifest } = require('./fixture.cjs');
const { ApplicationAuthorizationService } = coreRequire('./src/features/application-authorization/service.ts');
const { MemoryAuthorizationStore } = coreRequire('./src/features/application-authorization/store.ts');
const { ApplicationAuthorizationRuntime } = coreRequire('./src/app/composition/application-authorization-runtime.ts');
const { DisposablePostgres } = coreRequire('./tests/helpers/disposable-postgres.ts');
const express = coreRequire('express');

// The compiled entrypoint requires express/pg by bare name, which the installed kernel resolves from its
// own node_modules; point this process at the same framework checkout.
process.env.NODE_PATH = [path.join(CORE, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();

const RUNTIME = 'lm_pilot_runtime';
const ISSUER = 'https://school.example.test';
const ID = Object.freeze({
  tenantA: '10000000-0000-4000-8000-00000000000a', tenantB: '20000000-0000-4000-8000-00000000000b',
  teacherA1: '14000000-0000-4000-8000-000000000001', teacherA2: '15000000-0000-4000-8000-000000000002',
  adminA: '16000000-0000-4000-8000-000000000003', teacherB: '24000000-0000-4000-8000-000000000004',
  studentA: '11000000-0000-4000-8000-000000000001', peerA: '12000000-0000-4000-8000-000000000002',
  studentB: '21000000-0000-4000-8000-000000000003',
  classA1: '17000000-0000-4000-8000-000000000001', classA2: '18000000-0000-4000-8000-000000000002',
  classB1: '27000000-0000-4000-8000-000000000001',
});
/** sub -> [student id, catalog role]; every actor is issuer-bound and has a matching roster row. */
const PEOPLE = Object.freeze({
  'teacher-a1': [ID.teacherA1, 'teacher'], 'teacher-a2': [ID.teacherA2, 'teacher'], 'admin-a': [ID.adminA, 'admin'],
  'teacher-b': [ID.teacherB, 'teacher'], 'student-a': [ID.studentA, 'student'], 'peer-a': [ID.peerA, 'student'],
  'student-b': [ID.studentB, 'student'],
});
const operator = { sub: 'operator', issuer: ISSUER, isActive: true, isSwarmAdmin: true };
const actorOf = sub => ({ sub, issuer: ISSUER, isActive: true, isSwarmAdmin: false });
/** Attributes each statement to the request whose async context issued it, so late background work is not miscounted. */
const requestScope = new AsyncLocalStorage();

/** Every manifest migration in install order, minus the one that only seeds the kernel agents table. */
function packageMigrations() {
  const all = manifest.migrations.map(file => ({ file, sql: fs.readFileSync(path.join(PKG, file), 'utf8') }));
  const kernelOnly = all.filter(item => item.file.endsWith('020-seed-education-bots.sql'));
  assert.equal(kernelOnly.length, 1);
  assert.match(kernelOnly[0].sql, /INSERT INTO agents/);
  assert.doesNotMatch(kernelOnly[0].sql, /\blm_/, '020 must stay outside the package record tables');
  return all.filter(item => item !== kernelOnly[0]);
}

/** Apply the migrations AS the runtime role on one dedicated client so that role owns what it reads. */
async function migrate(db) {
  await db.pool.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${RUNTIME}`);
  const client = await db.pool.connect();
  try {
    await client.query(`SET ROLE ${RUNTIME}`);
    for (const { file, sql } of packageMigrations()) {
      try { await client.query(sql); } catch (error) { throw new Error(`${file}: ${error.message}`); }
    }
    const foreign = await client.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner <> $1`, [RUNTIME]);
    assert.equal(foreign.rows[0].n, 0, 'every package table is owned by the runtime role');
  } finally {
    await client.query('RESET ROLE').finally(() => client.release());
  }
  const role = await db.pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [RUNTIME]);
  assert.deepEqual(role.rows[0], { rolsuper: false, rolbypassrls: false });
}

/** Two schools, three classes, overlapping enrollments and per-class study data for aggregate checks. */
async function seed(pool) {
  await pool.query(`INSERT INTO lm_tenants (tenant_id, slug, name, domain) VALUES
    ($1, 'pilot-a', 'Pilot School A', 'a.school'), ($2, 'pilot-b', 'Pilot School B', 'b.school')`, [ID.tenantA, ID.tenantB]);
  for (const [sub, [id, role]] of Object.entries(PEOPLE)) {
    const tenant = sub.endsWith('-b') ? ID.tenantB : ID.tenantA;
    await pool.query(`INSERT INTO lm_students (student_id, name, email, external_issuer, external_id, role, tenant_id, xp, level)
      VALUES ($1, $2, $3, $4, $2, $5, $6, 10, 1)`, [id, sub, `${sub}@${tenant === ID.tenantA ? 'a' : 'b'}.school`, ISSUER, role, tenant]);
  }
  await pool.query(`INSERT INTO lm_classes (class_id, name, subject, chroma_collection_prefix, status, published, teacher_student_id, tenant_id)
    VALUES ($1, 'Math A1', 'math', 'pilot-a1', 'active', true, $2, $3), ($4, 'Science A2', 'science', 'pilot-a2', 'active', true, $5, $3),
      ($6, 'Math B1', 'math', 'pilot-b1', 'active', true, $7, $8)`,
  [ID.classA1, ID.teacherA1, ID.tenantA, ID.classA2, ID.teacherA2, ID.classB1, ID.teacherB, ID.tenantB]);
  await pool.query(`INSERT INTO lm_enrollments (student_id, class_id, tenant_id) VALUES ($1, $3, $5), ($1, $4, $5), ($2, $3, $5), ($6, $7, $8)`,
    [ID.studentA, ID.peerA, ID.classA1, ID.classA2, ID.tenantA, ID.studentB, ID.classB1, ID.tenantB]);
  await pool.query(`INSERT INTO lm_quiz_results (result_id, student_id, class_id, score_percent, total_questions, correct_answers) VALUES
    (gen_random_uuid(), $1, $3, 80, 10, 8), (gen_random_uuid(), $1, $4, 20, 10, 2), (gen_random_uuid(), $2, $3, 60, 10, 6),
    (gen_random_uuid(), $5, $6, 90, 10, 9)`, [ID.studentA, ID.peerA, ID.classA1, ID.classA2, ID.studentB, ID.classB1]);
}

/** Record every statement package handlers send, tagged with its request, so a refusal can be shown to happen before SQL. */
function recording(pool) {
  const statements = [];
  const recorder = new Proxy(pool, { get(target, key) {
    if (key === 'query') return (text, values) => {
      statements.push({ request: requestScope.getStore(), text: typeof text === 'string' ? text : text.text });
      return target.query(text, values);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { recorder, statements };
}

/** Mount the compiled entrypoint the way the manifest route mounter does: session, guard, package router. */
async function mount(pool) {
  const store = new MemoryAuthorizationStore();
  const policy = new ApplicationAuthorizationService(store, { resolveActor: async (sub, issuer) => (issuer === ISSUER ? actorOf(sub) : null) });
  const runtime = new ApplicationAuthorizationRuntime(policy, async req => actorOf(String(req.get('x-fixture-user') || 'nobody')), {});
  const record = { name: manifest.name, displayName: manifest.displayName, manifest, manifestPath: path.join(PKG, 'oshal-app.yaml') };
  await runtime.start(record);
  const { createEducationRoutes } = require(path.join(PKG, 'routes', 'education-routes.js'));
  const router = createEducationRoutes({ pool, authorization: runtime.forPackage(manifest.name), appPackageDir: PKG });
  runtime.complete(record);
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use((req, _res, next) => {
    const sub = req.get('x-fixture-user');
    if (sub) req.oidc = { isAuthenticated: () => true, user: { iss: ISSUER, sub } };
    requestScope.run(String(req.get('x-fixture-request') || ''), next);
  });
  app.use('/shared/ui', express.static(path.join(CORE, 'src', 'shared', 'ui')));
  app.use('/api/education', (req, res, next) => runtime.guard(manifest.name, req, res, next), router);
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { policy, store, server, origin, base: `${origin}/api/education` };
}

/** Real preview/apply of one assignment change by the synthetic operator. */
async function change(env, action, sub, extra = {}) {
  const preview = await env.policy.previewChange(operator, { app: manifest.name, action, targetSub: sub, targetIssuer: ISSUER,
    reason: 'Synthetic record-rights pilot', expectedRevision: (await env.store.read()).revision, ...extra });
  return env.policy.applyChange(operator, { previewId: preview.previewId, idempotencyKey: randomUUID() });
}

/**
 * @description Start the school: disposable database, migrations as the runtime role, seed, mounted routes,
 * and the roles every synthetic person holds (student-b is deliberately left unassigned). A partial start
 * removes its container before rethrowing.
 * @returns The running school: `call(sub, route, method?, body?)`, `change(action, sub, extra?)`, `close()`,
 * plus `db`, `origin` and `base` for suites that inspect rows or drive a browser.
 */
async function startSchool() {
  const env = { db: new DisposablePostgres({ purpose: 'lm-record-rights', roles: [{ name: RUNTIME, max: 6 }], memory: '384m' }) };
  try {
    await env.db.start();
    await migrate(env.db);
    await seed(env.db.pool);
    const { recorder, statements } = recording(env.db.rolePool(RUNTIME));
    env.statements = statements;
    Object.assign(env, await mount(recorder));
    for (const [sub, [, role]] of Object.entries(PEOPLE)) if (sub !== 'student-b') await change(env, 'grant', sub, { role });
  } catch (error) {
    await closeSchool(env);
    throw error;
  }
  env.change = (action, sub, extra) => change(env, action, sub, extra);
  env.call = (sub, route, method, body) => call(env, sub, route, method, body);
  env.close = () => closeSchool(env);
  return env;
}

/** Close the loopback server and remove the container; safe after a partial start. */
async function closeSchool(env) {
  if (env.server) { env.server.closeAllConnections(); await new Promise(resolve => env.server.close(resolve)); env.server = undefined; }
  if (env.db) await env.db.stop();
}

/** Call one mounted route as a synthetic principal; returns status, parsed body and the SQL it caused. */
async function call(env, sub, route, method = 'GET', body) {
  const request = randomUUID();
  const response = await fetch(`${env.base}${route}`, { method, redirect: 'manual',
    headers: { 'x-fixture-user': sub, 'x-fixture-request': request, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed, sql: env.statements.filter(row => row.request === request).map(row => row.text) };
}

module.exports = { ID, ISSUER, PEOPLE, startSchool };
