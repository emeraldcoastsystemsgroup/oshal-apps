/**
 * Calendar own events - another person's event is invisible and undeletable, on a disposable PostgreSQL.
 *
 * WHAT THIS PROVES. Migration 003 created calendar_own_events with no row security, so on PostgreSQL the
 * `WHERE user_sub` in each route statement was the only wall. Migration 004 forces exact-owner row security.
 * Real: PostgreSQL 16, migrations 003 and 004 applied BY the package's runtime role (a NOSUPERUSER NOBYPASSRLS
 * login that owns the table, the production shape, where FORCE is what makes the owner obey its policy), the
 * framework's identity (GUC) pool wrapper and request identity from the framework checkout, the pg driver, real
 * express and the COMPILED routes/own-events.js over loopback HTTP. Named seams: the package logger, and the
 * caller middleware that stands in for OIDC (it sets req.oidc and runs the request under that caller's
 * identity, as the api's identity middleware does).
 *
 * SELF-VALIDATED: with migration 003 alone the same runtime role reads and deletes another person's row
 * through a statement with no owner filter, so the fixture shows the gap before it shows 004 closing it.
 *
 * Needs Docker with postgres:16-alpine already present (never pulled) and a framework checkout with
 * node_modules (OSHAL_CORE_ROOT / OSHAL_CORE_DIR, default the sibling ../../oshal/src). Without either it FAILS.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: forced owner policy in the catalog; B's list never shows A's event and B's DELETE answers 404 leaving it; raw statements under B's identity see and delete nothing and cannot write in A's name; an operator identity sees nothing; with 003 alone the gap is real.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Migration 005 (time_zone) applied after 004 by the runtime role: through the routes a local start with timeZone is stored as that zone's instant with its zone and answered in its own words, the identical add answers 409 with one row left, and B may still add the same title and day.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const PKG = path.resolve(__dirname, '..');
const CORE = path.resolve(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR || path.join(PKG, '..', '..', 'oshal', 'src'));
const IMAGE = 'postgres:16-alpine';
const LABEL = 'oshal.calendar-own-events-fixture';
const ROLE = 'calendar_runtime';
const ROLE_PASSWORD = 'isolated-fixture-only';
const A = 'calendar-owner-a';
const B = 'calendar-owner-b';
const MIGRATIONS = ['003-calendar-own-events.sql', '004-calendar-own-events-rls.sql', '005-calendar-own-events-zone.sql'];

/** @description Run one docker CLI command. @param {string[]} args @returns {string} trimmed stdout */
function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** @description Load the framework's identity layer, pg and express; fails loudly without a checkout. */
function loadFramework() {
  if (!fs.existsSync(path.join(CORE, 'src', 'shared', 'services', 'database', 'guc-pool.ts'))) {
    throw new Error(`OSHAL_CORE_ROOT must name a framework checkout with src/ and node_modules (got ${CORE})`);
  }
  const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
  process.env.TSX_TSCONFIG_PATH = path.join(CORE, 'tsconfig.json');
  process.env.LOG_LEVEL = 'silent';
  coreRequire('tsx/cjs');
  const db = path.join(CORE, 'src', 'shared', 'services', 'database');
  return {
    Pool: coreRequire('pg').Pool, express: coreRequire('express'),
    guc: coreRequire(path.join(db, 'guc-pool.ts')), identity: coreRequire(path.join(db, 'request-identity.ts')),
  };
}

/** @description Load the compiled own-events routes with express from the checkout and a quiet logger. */
function loadRoutes(express) {
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'express') return express;
    if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, warn() {}, info() {} }) };
    if (request === './event-time') return require(path.join(PKG, 'routes', 'event-time.js'));
    return original.call(this, request, ...rest);
  };
  try { return require(path.join(PKG, 'routes', 'own-events.js')); } finally { Module._load = original; }
}

/** @description Start one labelled, port-isolated PostgreSQL and the runtime role; teardown is registered first. */
async function startPostgres(Pool, cleanups) {
  const token = randomUUID();
  const name = `oshal-calendar-own-events-${token.slice(0, 8)}`;
  cleanups.push(() => {
    const labels = JSON.parse(docker(['inspect', name]))[0].Config.Labels;
    assert.equal(labels[LABEL], token, 'refusing to remove a container this run did not start');
    docker(['rm', '--force', '--volumes', name]);
  });
  docker(['run', '--detach', '--pull=never', '--name', name, '--label', `${LABEL}=${token}`, '--memory', '512m',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=128m', '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD=fixture', IMAGE]);
  const port = Number(docker(['port', name, '5432/tcp']).split(/\r?\n/)[0].split(':')[1]);
  const common = { host: '127.0.0.1', port, database: 'postgres', connectionTimeoutMillis: 5000 };
  const admin = new Pool({ ...common, user: 'postgres', password: 'fixture', max: 2 });
  cleanups.unshift(() => admin.end());
  for (let i = 0; ; i++) {
    try { await admin.query('SELECT 1'); break; } catch (err) { if (i > 150) throw err; await new Promise((r) => setTimeout(r, 200)); }
  }
  await admin.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  return { admin, roleConfig: { ...common, user: ROLE, password: ROLE_PASSWORD } };
}

/** @description A fresh public schema owned by the runtime role, with the named migrations applied AS that role. */
async function freshSchema(admin, Pool, roleConfig, files) {
  await admin.query(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION ${ROLE}`);
  const migrator = new Pool({ ...roleConfig, max: 1 });
  try {
    for (const file of files) await migrator.query(fs.readFileSync(path.join(PKG, 'migrations', file), 'utf8'));
  } finally { await migrator.end(); }
}

/** @description Serve the compiled routes over loopback, each request under the caller its header names. */
async function serve(framework, pool, cleanups) {
  const app = framework.express();
  app.use(framework.express.json());
  app.use((req, _res, next) => {
    const sub = String(req.headers['x-fixture-sub'] || '');
    req.oidc = { user: { sub }, isAuthenticated: () => Boolean(sub) };
    framework.identity.runWithRequestIdentity({ sub, principalIssuer: null, isOperator: false }, next);
  });
  app.use('/api/calendar/events', loadRoutes(framework.express).createOwnEventsRoutes({ pool }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  cleanups.unshift(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/calendar/events`;
  return async (sub, method, suffix = '', body) => {
    const res = await fetch(base + suffix, { method, headers: { 'content-type': 'application/json', 'x-fixture-sub': sub },
      body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
}

const cleanups = [];
let fw;
let pg;
let pool;
let call;

test.before(async () => {
  fw = loadFramework();
  pg = await startPostgres(fw.Pool, cleanups);
  const raw = new fw.Pool({ ...pg.roleConfig, max: 4 });
  cleanups.unshift(() => raw.end());
  pool = fw.guc.wrapPoolWithGuc(raw);
});

test.after(async () => {
  for (const cleanup of cleanups) await cleanup();
});

/** @description Run fn as one caller, the identity the GUC pool stamps for row security. */
const as = (sub, fn, isOperator = false) => fw.identity.runWithRequestIdentity({ sub, principalIssuer: null, isOperator }, fn);

test('without migration 004 the runtime role reads and deletes another person\'s event (the gap)', async () => {
  await freshSchema(pg.admin, fw.Pool, pg.roleConfig, MIGRATIONS.slice(0, 1));
  await as(A, () => pool.query("INSERT INTO calendar_own_events(user_sub,id,title,starts_at,created_at) VALUES($1,'gap','A only',now(),now())", [A]));
  const seen = await as(B, () => pool.query("SELECT id FROM calendar_own_events WHERE id='gap'"));
  assert.equal(seen.rowCount, 1, 'with 003 alone nothing but the route filter stood between B and A\'s row');
  const gone = await as(B, () => pool.query("DELETE FROM calendar_own_events WHERE id='gap'"));
  assert.equal(gone.rowCount, 1);
});

test('migration 004 forces an exact-owner policy on calendar_own_events', async () => {
  await freshSchema(pg.admin, fw.Pool, pg.roleConfig, MIGRATIONS);
  const { rows } = await pg.admin.query(`SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner,
    (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'calendar_own_events_owner') AS policies
    FROM pg_class c WHERE c.relname = 'calendar_own_events'`);
  assert.deepEqual(rows[0], { relrowsecurity: true, relforcerowsecurity: true, owner: ROLE, policies: 1 });
});

test('through the routes another person\'s event is invisible and undeletable', async () => {
  await freshSchema(pg.admin, fw.Pool, pg.roleConfig, MIGRATIONS);
  call = await serve(fw, pool, cleanups);
  const added = await call(A, 'POST', '', { confirm: true, title: 'A dentist', start: '2099-11-07' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const id = added.body.event.id;
  assert.deepEqual((await call(A, 'GET')).body.events.map((e) => e.id), [id]);
  assert.deepEqual((await call(B, 'GET')).body.events, []);
  assert.equal((await call(B, 'DELETE', `/${id}`)).status, 404);
  const kept = await pg.admin.query('SELECT user_sub FROM calendar_own_events WHERE id = $1', [id]);
  assert.deepEqual(kept.rows, [{ user_sub: A }], 'B\'s delete left A\'s event in place');
  assert.equal((await call(A, 'DELETE', `/${id}`)).status, 200, 'the owner still removes their own event');
});

test('under B\'s identity no statement sees, deletes or writes A\'s rows, and an operator sees none', async () => {
  await freshSchema(pg.admin, fw.Pool, pg.roleConfig, MIGRATIONS);
  await as(A, () => pool.query("INSERT INTO calendar_own_events(user_sub,id,title,starts_at,created_at) VALUES($1,'a1','A only',now(),now())", [A]));
  assert.equal((await as(B, () => pool.query("SELECT id FROM calendar_own_events WHERE id='a1'"))).rowCount, 0);
  assert.equal((await as(B, () => pool.query("DELETE FROM calendar_own_events WHERE id='a1'"))).rowCount, 0);
  assert.equal((await as(B, () => pool.query("UPDATE calendar_own_events SET title='taken' WHERE id='a1'"))).rowCount, 0);
  await assert.rejects(
    as(B, () => pool.query("INSERT INTO calendar_own_events(user_sub,id,title,starts_at,created_at) VALUES($1,'forged','x',now(),now())", [A])),
    (err) => err.code === '42501');
  assert.equal((await as('calendar-operator', () => pool.query('SELECT id FROM calendar_own_events'), true)).rowCount, 0);
  const left = await pg.admin.query('SELECT id, title FROM calendar_own_events');
  assert.deepEqual(left.rows, [{ id: 'a1', title: 'A only' }]);
});

test('migration 005: a zone-entered event keeps its zone and an identical add is refused on PostgreSQL', async () => {
  await freshSchema(pg.admin, fw.Pool, pg.roleConfig, MIGRATIONS);
  call = await serve(fw, pool, cleanups);
  const body = { confirm: true, title: 'A drive', start: '2099-11-06T18:00', timeZone: 'America/Chicago' };
  const added = await call(A, 'POST', '', body);
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.deepEqual([added.body.event.start, added.body.event.local], ['2099-11-07T00:00:00.000Z', 'Fri, Nov 6, 2099, 6:00 PM CST']);
  const stored = await pg.admin.query('SELECT time_zone, starts_at FROM calendar_own_events');
  assert.deepEqual([stored.rows[0].time_zone, stored.rows[0].starts_at.toISOString()], ['America/Chicago', '2099-11-07T00:00:00.000Z']);
  const again = await call(A, 'POST', '', body);
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.equal((await pg.admin.query('SELECT count(*)::int AS n FROM calendar_own_events')).rows[0].n, 1, 'the duplicate wrote nothing');
  assert.equal((await call(B, 'POST', '', body)).status, 201, 'B is not refused by A\'s event');
  assert.equal((await call(A, 'GET')).body.events[0].local, 'Fri, Nov 6, 2099, 6:00 PM CST');
});
