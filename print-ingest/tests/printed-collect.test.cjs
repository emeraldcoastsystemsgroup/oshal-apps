/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.4.0 (T11): POST /printed/collect over the package's REAL compiled router (routes/print-ingest-routes.js; express and the framework aliases stubbed, a stub pool, the kernel's print_jobs.list / print_jobs.take as a stand-in queue). The documents printed to the owner's computers are filed as the caller's own intake rows awaiting approval, with the device, sending address, pages, size and time in a 'printer' sidecar, and taken from the kernel only after their rows exist; the same text filed before is a duplicate and still taken; a failed insert takes nothing (the jobs wait for the next try); nothing is approved, updated or written to a corpus; a full queue is taken in rounds; signed out is 401 and an older kernel without intents is 503. authorization.yaml binds the route to app.open and intake.write.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const SUB = 'synthetic-print-owner';

/** An express Router double that keeps every registration in order, walked as Express walks it. */
function recordingRouter() {
  const router = { stack: [] };
  ['get', 'post', 'put', 'patch', 'delete'].forEach((method) => { router[method] = (p, ...fns) => { router.stack.push({ method, path: p, fns }); return router; }; });
  router.use = (...args) => { const p = typeof args[0] === 'string' ? args.shift() : '/'; router.stack.push({ method: 'use', path: p, fns: args }); return router; };
  router.param = () => router;
  return router;
}

const STUBS = {
  express: { Router: recordingRouter },
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/shared/middleware/authz': { getTrustedServiceUserSub: () => null, isOperator: () => false },
  '@/features/rag': {
    RagService: class {
      async destinations() { return []; }
      async authorizeResource() { return { allowed: false }; }
      ingest() { throw new Error('nothing is written to a corpus by taking printed documents'); }
    },
  },
};

/** The package's compiled routes with STUBS for express and the framework aliases; every other import is real. */
function routes() {
  const original = Module._load;
  Module._load = function load(request) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    assert.ok(request.startsWith('.') || path.isAbsolute(request) || Module.isBuiltin(request), 'unexpected import: ' + request);
    return original.apply(this, arguments);
  };
  try { return require(path.join(ROOT, 'routes/print-ingest-routes.js')); } finally { Module._load = original; }
}

/** The native kernel's authorization port as route registration needs it. */
function authorization() {
  const actor = { principalId: 'p-1', sub: SUB, issuer: 'fixture', tenantIds: ['t-1'], isActive: true };
  return { storageModel: 'kernel-scoped-documents', currentActor: () => actor, registerResource() {} };
}

/** A stub pool: SELECTs of print_intake answer `existing`, the INSERT returns its row, everything is recorded. */
function stubPool({ existing = () => [], failInsert = false } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    query(text, values = []) {
      calls.push({ text, values });
      if (/^\s*INSERT INTO print_intake\b/.test(text)) {
        if (failInsert) return Promise.reject(new Error('the database refused the insert'));
        n += 1;
        return Promise.resolve({ rows: [{ intake_id: `row-${n}`, owner_sub: values[0], content_sha256: values[1], title: values[2], text_chars: values[3], sidecar: JSON.parse(values[5]), recommendation: JSON.parse(values[6]), state: 'awaiting_approval' }] });
      }
      if (/FROM print_intake_rule\b/.test(text)) return Promise.resolve({ rows: [] });
      if (/FROM print_intake\b/.test(text)) return Promise.resolve({ rows: existing(values) });
      return Promise.reject(new Error('unexpected query: ' + text));
    },
  };
}

/** The kernel's printed-job queue for the caller, as print_jobs.list and print_jobs.take answer. */
function kernelQueue(jobs, events) {
  const waiting = [...jobs];
  return async (name, input) => {
    events.push({ name, input });
    if (name === 'print_jobs.list') return { jobs: waiting.slice(0, input.limit), waiting: waiting.length, most: 50, keptDays: 7 };
    if (name === 'print_jobs.take') {
      for (const id of input.ids) { const at = waiting.findIndex((j) => j.id === id); if (at >= 0) waiting.splice(at, 1); }
      return { taken: input.ids, missing: [], waiting: waiting.length };
    }
    throw new Error('unexpected intent ' + name);
  };
}

function job(n, text = `Printed page number ${n}: the quarterly budget note.`) {
  return { id: `job-${n}`, source: 'printer', device: 'Office PC', sender: '192.168.1.20', document: `Quarterly report ${n}.pdf`, pages: 3, bytes: 123456, printedAt: Date.UTC(2026, 10, 12, 4, 0, 0), chars: text.length, truncated: false, text };
}

function response() {
  return { statusCode: 200, body: undefined, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; }, send(b) { this.body = b; }, type() { return this; } };
}

/** POST /printed/collect through the real router. */
async function collect({ pool, intent, signedIn = true }) {
  const { createPrintIngestRoutes } = routes();
  const ctx = { pool, intent, appPackageDir: ROOT, package: 'print-ingest', authorization: authorization() };
  const router = createPrintIngestRoutes(ctx);
  const layer = router.stack.find((l) => l.method === 'post' && l.path === '/printed/collect');
  assert.ok(layer, 'the router has POST /printed/collect');
  const res = response();
  const req = { oidc: signedIn ? { user: { sub: SUB } } : undefined, params: {}, query: {}, headers: {}, body: {} };
  for (const fn of layer.fns) await fn(req, res, () => {});
  return res;
}

const inserts = (pool) => pool.calls.filter((c) => /^\s*INSERT INTO print_intake\b/.test(c.text));

test('the documents printed to the owner\'s computers are filed as their own rows awaiting approval, then taken', async () => {
  const events = [];
  const pool = stubPool();
  const res = await collect({ pool, intent: kernelQueue([job(1), job(2)], events) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { filed: 2, duplicates: 0, unfiled: 0, waiting: 0 });
  const rows = inserts(pool);
  assert.equal(rows.length, 2);
  for (const [i, row] of rows.entries()) {
    assert.equal(row.values[0], SUB, 'the caller\'s own row');
    assert.equal(row.values[4], job(i + 1).text, 'the text the kernel read');
    assert.doesNotMatch(row.text, /\bstate\b/, 'the row is left at its default state, awaiting approval');
    const sidecar = JSON.parse(row.values[5]);
    assert.equal(sidecar.source, 'printer');
    assert.equal(sidecar.printerName, 'Office PC', 'the computer it was printed to');
    assert.equal(sidecar.clientIp, '192.168.1.20', 'the sending address');
    assert.equal(sidecar.documentName, `Quarterly report ${i + 1}.pdf`);
    assert.equal((sidecar.textPages), 3);
    assert.equal(sidecar.bytes, 123456);
    assert.equal(sidecar.receivedAt, '2026-11-12T04:00:00.000Z');
  }
  assert.deepEqual(events.map((e) => e.name), ['print_jobs.list', 'print_jobs.take']);
  assert.deepEqual(events[1].input, { ids: ['job-1', 'job-2'] });
  assert.ok(pool.calls.every((c) => !/^\s*UPDATE\b/i.test(c.text)), 'nothing is approved or decided');
});

test('the same text filed before is a duplicate, and is still taken from the kernel', async () => {
  const events = [];
  const filedBefore = job(1);
  const pool = stubPool({ existing: (values) => (values[1] ? [{ intake_id: 'old', owner_sub: SUB, state: 'awaiting_approval' }] : []) });
  const res = await collect({ pool, intent: kernelQueue([filedBefore], events) });
  assert.deepEqual(res.body, { filed: 0, duplicates: 1, unfiled: 0, waiting: 0 });
  assert.equal(inserts(pool).length, 0);
  assert.deepEqual(events[1].input, { ids: ['job-1'] });
});

test('a failed insert takes nothing: the printed documents wait in the kernel for the next try', async () => {
  const events = [];
  const res = await collect({ pool: stubPool({ failInsert: true }), intent: kernelQueue([job(1), job(2)], events) });
  assert.equal(res.statusCode, 502);
  assert.match(res.body.detail, /wait in the swarm/);
  assert.deepEqual(events.map((e) => e.name), ['print_jobs.list'], 'print_jobs.take is never called');
});

test('a full queue is taken in rounds of five', async () => {
  const events = [];
  const pool = stubPool();
  const res = await collect({ pool, intent: kernelQueue([1, 2, 3, 4, 5, 6, 7].map((n) => job(n)), events) });
  assert.deepEqual(res.body, { filed: 7, duplicates: 0, unfiled: 0, waiting: 0 });
  assert.deepEqual(events.map((e) => e.name), ['print_jobs.list', 'print_jobs.take', 'print_jobs.list', 'print_jobs.take']);
  assert.equal(events[0].input.limit, 5);
});

test('signed out is refused and an older kernel without intents says so; neither touches the queue', async () => {
  const events = [];
  const out = await collect({ pool: stubPool(), intent: kernelQueue([job(1)], events), signedIn: false });
  assert.equal(out.statusCode, 401);
  const older = await collect({ pool: stubPool(), intent: undefined });
  assert.equal(older.statusCode, 503);
  assert.equal(older.body.error, 'printer_unavailable');
  assert.equal(events.length, 0);
});

test('the route is bound to opening the inbox and filing into it', () => {
  const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));
  const catalog = yaml.load(fs.readFileSync(path.join(ROOT, 'authorization.yaml'), 'utf8'));
  const binding = catalog.bindings.http.find((b) => b.path === '/api/print-ingest/printed/collect');
  assert.ok(binding, 'a binding exists');
  assert.equal(binding.method, 'POST');
  assert.deepEqual(binding.allOf, ['app.open', 'intake.write']);
});
