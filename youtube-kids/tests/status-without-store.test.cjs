/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | GET /status and GET /brief for a person with no activity store: the native kernel refuses a read's lazy CREATE TABLE ("SQL schema is not provisioned") and PostgreSQL answers 42P01; both mean "nothing uploaded", never a 500. The table is a declared migration.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Stub `@/features/personal-data`, which the routes now import to seal the raw export (PDATA-01); these reads never call it.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | GET /brief with no store answers 200 {brief:null, hasData:false}: it is a pure read now, and the kernel replaces a package GET's 404 with "application asset not found".
 * -----------------------------------------------------------------------------
 *
 * Dependency-free: the compiled routes run against in-process stubs of their framework imports.
 *
 * @module status-without-store.test
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

const STUB_EXPORTS = {
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/shared/services/database': {
    runRuntimeSchemaBootstrap: async ({ pool, statements }) => { for (const s of statements) await pool.query(s); },
    buildOwnerRlsPolicyStatements: () => [],
  },
  '@/shared/artifact-exchange': {},
  '@/features/personal-data': { isEncrypted: () => false, encryptField: async () => { throw new Error('not called by a read'); }, decryptField: async () => { throw new Error('not called by a read'); } },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/inline-bot-execution': {},
};

/** Where the stub Router records GET handlers; the compiled module binds express once at require. */
let recording = {};
const EXPRESS = { Router: () => ({ get: (p, ...h) => { recording[`GET ${p}`] = h[h.length - 1]; }, post() {}, use() {} }), raw: () => () => {} };

/** Run `fn` while framework imports and express resolve to in-process stubs that record GET handlers. */
function withStubs(handlers, fn) {
  recording = handlers;
  const stubs = Object.assign({}, STUB_EXPORTS, { express: EXPRESS });
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return original.call(this, request, parent, isMain);
  };
  try { return fn(); } finally { Module._load = original; }
}

const ROUTES_FILE = path.join(ROOT, 'routes', 'youtube-kids-routes.js');
const routesModule = withStubs({}, () => require(ROUTES_FILE));

/** The compiled router's GET handlers bound to `pool`. */
function routesFor(pool) {
  const handlers = {};
  withStubs(handlers, () => routesModule.createYoutubeKidsRoutes({ pool, appPackageDir: ROOT }));
  return handlers;
}

/** Run one recorded handler as signed-in parent-1 and answer the status and JSON it sent. */
async function call(route, pool) {
  const sent = { status: 200, body: undefined };
  const res = { status(code) { sent.status = code; return res; }, json(body) { sent.body = body; return res; } };
  await routesFor(pool)[route]({ oidc: { user: { sub: 'parent-1' } }, query: {} }, res);
  return sent;
}

/** A pool that refuses every statement the way a store without the table does. */
function absentPool(error) {
  return { query: async () => { throw error; } };
}

const nativeRefusal = Object.assign(new Error('refused: SQL schema is not provisioned'), {});
const postgresAbsent = Object.assign(new Error('relation "oshal_youtube_activity" does not exist'), { code: '42P01' });

test('GET /status answers hasData:false, not 500, when the caller has no activity store', async () => {
  for (const error of [nativeRefusal, postgresAbsent]) {
    const sent = await call('GET /status', absentPool(error));
    assert.equal(sent.status, 200, error.message);
    assert.deepEqual(sent.body, { hasData: false });
  }
});

test('GET /brief answers {brief:null, hasData:false}, not 502, when the caller has no activity store', async () => {
  const sent = await call('GET /brief', absentPool(nativeRefusal));
  assert.equal(sent.status, 200);
  assert.deepEqual([sent.body.brief, sent.body.hasData], [null, false]);
});

test('any other store failure is still reported, never hidden as "no data"', async () => {
  const sent = await call('GET /status', absentPool(new Error('connection reset')));
  assert.equal(sent.status, 500);
  assert.equal(routesModule.isActivityStoreAbsent(new Error('permission denied')), false);
  assert.equal(routesModule.isActivityStoreAbsent(null), false);
});

test('the activity table is a declared migration with exactly the routes\' declaration', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /^migrations:\n {2}- migrations\/001-youtube-activity\.sql$/m);
  assert.equal((manifest.match(/^migrations:/gm) || []).length, 1, 'one migrations key');
  const columns = (sql) => sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS oshal_youtube_activity')).split(')')[0].replace(/\s+/g, ' ').trim();
  const migration = fs.readFileSync(path.join(ROOT, 'migrations', '001-youtube-activity.sql'), 'utf8');
  const routes = fs.readFileSync(path.join(ROOT, 'routes', 'youtube-kids-routes.js'), 'utf8');
  assert.equal(columns(migration), columns(routes), 'the runtime declaration must verify against the provisioned table');
});
