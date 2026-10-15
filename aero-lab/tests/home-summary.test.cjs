/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Aero Lab's Home summary over the shipped routes/home-summary.js with the
 *   real floater-record stage logic and vehicle-store queries (only express and the logger are stubbed): it answers
 *   401 without a caller and queries nothing; it reads only the caller's own rows; a vehicle's stage and what blocks the
 *   next one come from the recorded evaluations (no evaluation at the current vector is concept, never a failure);
 *   no vehicles says so; a failed read is 503, never zeros; and the manifest declares the summary and mounts the route.
 *   The concierge beside Aero Lab named a structural failure no evaluation recorded: this is what it now reads.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const routes = path.join(__dirname, '..', 'routes');

/** Load the shipped module with express and the framework logger stubbed; everything else is real. */
function loadSummary() {
  let handler = null;
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'express') return { Router: () => ({ get: (_p, fn) => { handler = fn; } }) };
    if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) };
    return original.call(this, request, parent, isMain);
  };
  try {
    for (const key of Object.keys(require.cache)) if (key.startsWith(routes)) delete require.cache[key];
    const summary = require(path.join(routes, 'home-summary.js'));
    const record = require(path.join(routes, 'floater-record.js'));
    return { summary, record, route: (pool) => { summary.createAeroHomeSummaryRoutes({ pool }); return handler; } };
  } finally {
    Module._load = original;
  }
}

/** Call a route handler as `sub` and return the response it wrote. */
async function call(handler, sub) {
  const res = { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ oidc: sub ? { user: { sub } } : undefined, query: { owner_sub: 'mallory' } }, res);
  return res;
}

const { summary, record, route } = loadSummary();
const vector = { span_m: 3.2, area_m2: 1.1 };

test('without a caller it answers 401 and reads nothing', async () => {
  const res = await call(route({ query() { throw new Error('no query permitted'); } }), null);
  assert.equal(res.code, 401);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('it reads only the caller\'s rows and reports each vehicle\'s recorded stage, never an invented failure', async () => {
  const seen = [];
  const pool = { async query(sql, args) {
    seen.push({ sql, args });
    if (/FROM aero_lab_vehicle WHERE/.test(sql)) return { rows: [{ vehicle_id: 'v1', name: 'Floater', kind: 'solar-dynastat', design_vector: vector, provenance: {}, created_at: 'x', updated_at: 'x' }] };
    return { rows: [] };
  } };
  const res = await call(route(pool), 'alice');
  assert.equal(res.code, 200);
  assert.ok(seen.length === 2 && seen.every((q) => q.args[0] === 'alice' && /^SELECT /.test(q.sql)), 'owner-scoped reads only');
  assert.deepEqual(res.body.metrics.map((m) => [m.label, m.value]), [['Saved vehicles', '1'], ['Sized at current design', '0'], ['Recorded evaluations', '0']]);
  assert.deepEqual(res.body.tiles, res.body.metrics);
  assert.equal(res.body.items[0].text, 'Floater: concept');
  assert.match(res.body.items[0].detail, /^0 evaluation\(s\) recorded\. Next stage blocked by: no evaluation at the current design vector/);
  assert.doesNotMatch(JSON.stringify(res.body), /structural|fail/i);
});

test('a sized vehicle with a red mass budget is flagged with the recorded reason', () => {
  const stage = record.stageOf(record.FLOATER_KIND, vector, []);
  assert.equal(stage.stage, 'concept');
  const body = summary.buildAeroHomeSummary([{ name: 'R7', evaluations: 2, stage: { stage: 'sized', blockedBy: ['the mass budget is RED: 0.2 kg over'], because: 'evaluation 2 computed every figure.' } }], false, new Date('2026-10-11T12:00:00Z'));
  assert.equal(body.items[0].tone, 'warn');
  assert.equal(body.metrics[1].value, '1');
  assert.match(body.items[0].detail, /the mass budget is RED: 0\.2 kg over/);
  assert.equal(body.asOf, '2026-10-11T12:00:00.000Z');
  assert.ok(body.items.every((item) => item.text.length <= 120 && (!item.detail || item.detail.length <= 400)));
});

test('no vehicles says so, and a failed read is unavailable, never zero', async () => {
  const empty = await call(route({ async query() { return { rows: [] }; } }), 'alice');
  assert.equal(empty.body.metrics[0].value, '0');
  assert.equal(empty.body.items[0].text, 'No saved vehicles yet. Open Aero Lab to begin.');
  assert.ok(empty.body.items.every((item) => !item.text.endsWith('…')), 'every note fits the 120-character cap whole');
  const failed = await call(route({ async query() { throw new Error('PRIVATE'); } }), 'alice');
  assert.equal(failed.code, 503);
  assert.deepEqual(failed.body, { error: 'summary_unavailable' });
});

test('the manifest mounts the route and declares it as the Home summary', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /- module: routes\/home-summary\.js\n\s+factory: createAeroHomeSummaryRoutes\n\s+mountPath: \/api\/aero-lab\/home-summary\n\s+requiresAuth: true\n\s+requiresContext: true/);
  assert.match(manifest, /\nsummary:\n  path: \/api\/aero-lab\/home-summary\n  tilesPointer: \/tiles\n  metricsPointer: \/metrics\n  itemsPointer: \/items\n/);
});
