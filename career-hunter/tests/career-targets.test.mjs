/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the per-user target list: a URL is accepted ONLY on the engine classifier's verdict (rejected URLs are never stored and never reach the engine's add-target), accepted URLs are stored then resolved detached with user provenance, reads and deletes are caller-scoped, and the launcher/registrar/manifest carry the new verbs, routes, and migration.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploymentModeStub } from './helpers/deployment-mode-stub.mjs';

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const originalLoad = Module._load;

// The engine's answers, keyed by verb; the routes must never invent a verdict of their own.
const engineCalls = [];
let classifyAnswer = { ok: true, match: null, reason: 'no supported job-board pattern', supported: ['greenhouse', 'lever'] };
let addTargetAnswer = { ok: true, company_id: 77, name: 'Acme', ats_type: 'greenhouse', token: 'acme', scraped: true, postings: 12, new: 12, seen: 0 };
let engineOk = true;

Module._load = function loadWithTargetStubs(request, ...rest) {
  if (request === '@/shared/deployment-mode') return deploymentModeStub();
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === './career-engine-dispatch') {
    return {
      runCareerCliAwait: async (_pool, userSub, args) => {
        engineCalls.push({ userSub, args });
        const answer = args[0] === 'classify' ? classifyAnswer : addTargetAnswer;
        return { ok: engineOk, out: `progress line\n${JSON.stringify(answer)}\n`, err: engineOk ? '' : 'boom' };
      },
    };
  }
  if (request === './career-user-store') return { callerSub: (req) => req.userSub || null };
  return originalLoad.call(this, request, ...rest);
};
const targets = require('../routes/career-targets.js');
after(() => { Module._load = originalLoad; });

/** Minimal router that records handlers by method + path. */
function fakeRouter() {
  const handlers = {};
  const record = (method) => (path, handler) => { handlers[`${method} ${path}`] = handler; };
  return { handlers, get: record('GET'), post: record('POST'), delete: record('DELETE') };
}

/** Pool double: answers by statement shape and records every query. */
function fakePool(options = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/SELECT COUNT\(\*\)/.test(sql)) return { rows: [{ n: String(options.count ?? 0) }], rowCount: 1 };
      if (/^\s*INSERT INTO career_user_targets/.test(sql)) {
        return { rows: [{ id: 5, url: params[1], ats_type: params[2], ats_token: params[3], status: 'accepted' }], rowCount: 1 };
      }
      if (/^\s*SELECT id, url/.test(sql)) return { rows: [{ id: 5, url: 'https://boards.greenhouse.io/acme', status: 'resolved' }], rowCount: 1 };
      if (/^\s*DELETE/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

async function call(pool, key, req) {
  const router = fakeRouter();
  targets.registerCareerTargetRoutes(router, { pool });
  const res = fakeRes();
  await router.handlers[key](req, res);
  return res;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('normalizeTargetUrl accepts http(s) careers URLs and refuses everything else', () => {
  assert.equal(targets.normalizeTargetUrl(' boards.greenhouse.io/acme '), 'https://boards.greenhouse.io/acme');
  assert.equal(targets.normalizeTargetUrl('https://jobs.lever.co/acme#top'), 'https://jobs.lever.co/acme');
  for (const bad of ['', 'ftp://x', 'javascript:alert(1)', 'https://user:pw@host/x', 'x'.repeat(600), 42, null]) {
    assert.equal(targets.normalizeTargetUrl(bad), null, `must refuse ${JSON.stringify(bad).slice(0, 30)}`);
  }
});

test('parseEngineJson takes the LAST JSON object line and ignores progress text', () => {
  assert.deepEqual(targets.parseEngineJson('   .. scraping\n{"ok":true,"n":1}\n'), { ok: true, n: 1 });
  assert.deepEqual(targets.parseEngineJson('{"first":1}\nnoise\n{"last":2}'), { last: 2 });
  assert.equal(targets.parseEngineJson('no json here'), null);
  assert.equal(targets.parseEngineJson('[1,2]'), null);
});

test('a URL the classifier does not recognize is rejected with the supported list and never stored', async () => {
  engineCalls.length = 0;
  classifyAnswer = { ok: true, match: null, reason: 'no supported job-board pattern', supported: ['greenhouse', 'lever', 'workday'] };
  const pool = fakePool();
  const res = await call(pool, 'POST /settings/targets', { userSub: 'u1', body: { url: 'https://example.com/about' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { ok: false, rejected: true, reason: 'no supported job-board pattern', supported: ['greenhouse', 'lever', 'workday'] });
  assert.deepEqual(engineCalls.map((c) => c.args[0]), ['classify'], 'only the classifier ran — no add-target for a rejected URL');
  assert.ok(!pool.queries.some((q) => /INSERT/.test(q.sql)), 'a rejected URL is never stored');
});

test('an unusable URL never reaches the engine at all', async () => {
  engineCalls.length = 0;
  const pool = fakePool();
  const res = await call(pool, 'POST /settings/targets', { userSub: 'u1', body: { url: 'javascript:alert(1)' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.reason, 'invalid_url');
  assert.equal(engineCalls.length, 0);
  assert.equal(pool.queries.length, 0);
});

test('a recognized URL is stored as accepted, answered 202, then resolved detached with user provenance', async () => {
  engineCalls.length = 0;
  classifyAnswer = { ok: true, match: { ats_type: 'greenhouse', token: 'acme' }, supported: ['greenhouse'] };
  addTargetAnswer = { ok: true, company_id: 77, name: 'Acme', ats_type: 'greenhouse', token: 'acme', scraped: true, postings: 12, new: 12, seen: 0 };
  const pool = fakePool();
  const res = await call(pool, 'POST /settings/targets', { userSub: 'u1', body: { url: 'boards.greenhouse.io/acme' } });
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.accepted, true);
  assert.equal(res.body.target.ats_type, 'greenhouse');
  const insert = pool.queries.find((q) => /INSERT INTO career_user_targets/.test(q.sql));
  assert.ok(insert, 'the accepted URL is stored');
  assert.deepEqual(insert.params, ['u1', 'https://boards.greenhouse.io/acme', 'greenhouse', 'acme']);
  assert.match(insert.sql, /ON CONFLICT \(user_sub, url\) DO UPDATE/);
  await settle();
  const addTarget = engineCalls.find((c) => c.args[0] === 'add-target');
  assert.ok(addTarget, 'resolution goes through the engine');
  assert.deepEqual(addTarget.args, ['add-target', '--url', 'https://boards.greenhouse.io/acme', '--source', 'user:u1']);
  const update = pool.queries.find((q) => /UPDATE career_user_targets/.test(q.sql));
  assert.ok(update && /status='resolved'/.test(update.sql), 'the row is marked resolved');
  assert.deepEqual(update.params.slice(0, 5), [5, 'u1', 77, 'Acme', 12]);
});

test('an accepted URL whose board cannot be scraped is marked unresolved with the engine reason', async () => {
  engineCalls.length = 0;
  classifyAnswer = { ok: true, match: { ats_type: 'lever', token: 'ghost' }, supported: ['lever'] };
  addTargetAnswer = { ok: true, company_id: 78, name: 'Ghost', ats_type: 'lever', token: 'ghost', scraped: false, error: 'fetch failed: 404' };
  const pool = fakePool();
  const res = await call(pool, 'POST /settings/targets', { userSub: 'u1', body: { url: 'https://jobs.lever.co/ghost' } });
  assert.equal(res.statusCode, 202);
  await settle();
  const update = pool.queries.find((q) => /UPDATE career_user_targets/.test(q.sql));
  assert.ok(update && /status='resolved'/.test(update.sql), 'registered companies stay resolved; the scrape error is recorded');
  assert.equal(update.params[5], 'fetch failed: 404');

  engineCalls.length = 0;
  addTargetAnswer = { ok: false, error: 'no supported job-board pattern' };
  const pool2 = fakePool();
  await call(pool2, 'POST /settings/targets', { userSub: 'u1', body: { url: 'https://jobs.lever.co/ghost2' } });
  await settle();
  const unresolved = pool2.queries.find((q) => /UPDATE career_user_targets/.test(q.sql));
  assert.ok(unresolved && /status='unresolved'/.test(unresolved.sql));
  assert.equal(unresolved.params[2], 'no supported job-board pattern');
});

test('a classifier outage answers 503 and stores nothing; the per-user ceiling answers 409', async () => {
  engineCalls.length = 0;
  engineOk = false;
  const pool = fakePool();
  const res = await call(pool, 'POST /settings/targets', { userSub: 'u1', body: { url: 'https://boards.greenhouse.io/acme' } });
  assert.equal(res.statusCode, 503);
  assert.ok(!pool.queries.some((q) => /INSERT/.test(q.sql)));
  engineOk = true;

  const full = fakePool({ count: 10_000 });
  const capped = await call(full, 'POST /settings/targets', { userSub: 'u1', body: { url: 'https://boards.greenhouse.io/acme' } });
  assert.equal(capped.statusCode, 409);
  assert.equal(capped.body.error, 'too_many_targets');
});

test('reads and deletes are scoped to the caller, and an anonymous caller gets 401', async () => {
  const pool = fakePool();
  const list = await call(pool, 'GET /settings/targets', { userSub: 'u1' });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.adminTable, '/api/career-hunter/companies-admin');
  assert.deepEqual(pool.queries[0].params, ['u1']);

  const del = await call(pool, 'DELETE /settings/targets/:id', { userSub: 'u1', params: { id: '5' } });
  assert.deepEqual(del.body, { ok: true, removed: true });
  const deleteQuery = pool.queries.find((q) => /^DELETE/.test(q.sql));
  assert.match(deleteQuery.sql, /WHERE id=\$1 AND user_sub=\$2/);
  assert.deepEqual(deleteQuery.params, [5, 'u1']);

  const badId = await call(pool, 'DELETE /settings/targets/:id', { userSub: 'u1', params: { id: 'x' } });
  assert.equal(badId.statusCode, 400);
  for (const key of ['GET /settings/targets', 'POST /settings/targets', 'DELETE /settings/targets/:id']) {
    const anon = await call(pool, key, { body: { url: 'https://boards.greenhouse.io/acme' }, params: { id: '1' } });
    assert.equal(anon.statusCode, 401, key);
  }
});

test('the launcher, the registrar, and the manifest carry the feature end to end', () => {
  const launcher = readFileSync(join(packageRoot, 'bin', 'oshal-jobhunter.js'), 'utf8');
  assert.match(launcher, /case 'classify': return \[\['-m', 'jobhunter', 'classify'/);
  assert.match(launcher, /case 'add-target': return \[\['-m', 'jobhunter', 'add-target'/);
  // The compiled registrar calls through the CommonJS namespace: `(0, m.registerCareerTargetRoutes)(router, ctx)`.
  for (const relative of ['src-routes/career-hunter-routes.ts', 'routes/career-hunter-routes.js']) {
    assert.match(readFileSync(join(packageRoot, relative), 'utf8'), /registerCareerTargetRoutes\)?\(router, ctx\)/, relative);
  }
  const manifest = readFileSync(join(packageRoot, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /migrations\/100-career-user-targets\.sql/);
  const migration = readFileSync(join(packageRoot, 'migrations', '100-career-user-targets.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS career_user_targets/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /UNIQUE \(user_sub, url\)/);
  const cli = readFileSync(join(packageRoot, 'engine', 'jobhunter', 'cli.py'), 'utf8');
  assert.match(cli, /sub\.add_parser\("classify"/);
  assert.match(cli, /sub\.add_parser\("add-target"/);
});
