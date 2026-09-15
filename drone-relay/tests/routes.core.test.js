/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The packaged routes over real loopback HTTP with express resolved from the framework checkout (OSHAL_CORE_DIR): the surface, its script and capabilities serve; the transport table and one budget answer and refuse naming the field; the caller gate 401s; a chain previews without a row; a chain is created, listed, read with its roster, owner-scoped (a second subject gets 404 and an empty list), re-sized by PATCH with its run cleared, refused on a bad id; a scenario runs and is stored as the last run, an infeasible chain answers 409, an unknown drone 400; the design write-up serves as Markdown from the stored plan; a command envelope traces base → r1 … → tip and verifies at the tip, a heartbeat traces inward; the Home summary gates the session and counts; deletion removes the row. The database is a SQL-dispatching in-memory double — the owner RLS boundary itself is proven by the migration's policy text and the live installer, not here.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The manifest's Test Lab catalog loads through the framework's own loader (scripts/oshal-test-catalog.js — the 500-character expected-line limit and the 300000 ms timeout cap the box enforces; circuit-lab 0.5.0 was refused on install for one), and every tool targets this package's own mount.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Capabilities list the postures, the control-channel choices and the heartbeat size; a preview with a perch and a LoRa control channel carries the antenna height and the control block.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express. Not part of the store-CI
 * wildcard; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | 0.3.0: the catalog the framework's own loader accepts is nine cases — `engine-ground-control` joins it, inside the 500-character expected line and the 300000 ms timeout the box enforces.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | 0.4.0: eleven cases — `engine-proxy` and `relay-loopback` (B11) join the catalog under the same loader and limits.
 * 6   | maintainer@emeraldcoastsystemsgroup.com     | 0.4.0: a tree (B5) through the routes — capabilities list the branch limits, a refusal names the branch point, a tree previews and saves with its tree block and roster, a trunk loss runs and is stored with every tip's metrics, the trace walks the trunk and branch 2 to tip2 and verifies there, the write-up describes the fork and both tips; twelve catalog cases with `engine-tree`.
 * 7   | maintainer@emeraldcoastsystemsgroup.com     | 0.4.0: the formation as a Drone Ops fleet-mission draft (B6) — 200 with the draft and `executes: false`, nothing stored; 400 naming the missing latitude and a repeated fleet id; 409 on an infeasible plan; fourteen catalog cases with `engine-fleet-draft` and `fleetmission-core`.
 * 8   | maintainer@emeraldcoastsystemsgroup.com     | 0.4.0: a lattice (B9) through the routes — capabilities list the area limits, a crossing polygon is refused naming the area, a lattice previews and saves with its grid, a relay loss runs with the tip never out of reach, the trace walks the lattice route to the tip, the write-up describes the grid; fifteen catalog cases with `engine-lattice`.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Redirect a bare require to the framework checkout only when the package itself asks for it. Requires made inside node_modules resolve normally again: redirecting them to core's root broke in the Test Lab sandbox, where the image's pruned node_modules keeps semver only nested under sharp (Cannot find module 'semver'); a developer checkout hoists it, which is why no local run saw it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
assert.ok(fs.existsSync(path.join(CORE, 'node_modules', 'express')), `OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) must point at a framework checkout with node_modules (got ${CORE})`);
const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
const PKG = path.resolve(__dirname, '..');

const STUBS = { '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error(obj, msg) { console.error('[package]', msg || obj, obj && obj.err); } }) } };
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (STUBS[request]) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
  if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request) && String(parent?.filename || '').startsWith(PKG + path.sep)) return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
  return originalLoad.call(this, request, parent, isMain);
};
const express = coreRequire('express');
const { createDroneRelayRoutes } = require(path.join(PKG, 'routes', 'drone-relay-routes.js'));
const { createHomeSummaryRoutes } = require(path.join(PKG, 'routes', 'home-summary.js'));

// ── An in-memory database that answers exactly the package's SQL ─────────────
function fakePool() {
  const rows = [];
  const now = () => new Date().toISOString();
  const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const full = (r) => ({ plan_id: r.plan_id, owner_sub: r.owner_sub, title: r.title, spec: r.spec, plan: r.plan, last_sim: r.last_sim, created_at: r.created_at, updated_at: r.updated_at });
  const listRow = (r) => ({ plan_id: r.plan_id, owner_sub: r.owner_sub, title: r.title, spec: r.spec, plan: r.plan, last_metrics: r.last_sim ? r.last_sim.metrics : null, created_at: r.created_at, updated_at: r.updated_at });
  return { rows, async query(sql, params = []) {
    const text = (typeof sql === 'string' ? sql : sql.text).trim(); const p = typeof sql === 'string' ? params : sql.values;
    if (/^INSERT INTO drone_relay_plan/.test(text)) { const r = { plan_id: randomUUID(), owner_sub: p[0], title: p[1], spec: j(p[2]), plan: j(p[3]), last_sim: null, created_at: now(), updated_at: now() }; rows.push(r); return { rows: [full(r)], rowCount: 1 }; }
    const mine = rows.filter((r) => r.owner_sub === p[0]);
    if (/^SELECT count\(\*\)/.test(text)) return { rows: [{ total: String(mine.length), feasible: String(mine.filter((r) => r.plan.feasible).length), simulated: String(mine.filter((r) => r.last_sim).length), holding: String(mine.filter((r) => r.last_sim && ['held', 'restored'].includes(r.last_sim.metrics.verdict)).length) }], rowCount: 1 };
    if (/^SELECT title, spec, plan, \(last_sim->'metrics'\) AS last_metrics/.test(text)) return { rows: mine.slice(0, 3).map((r) => ({ title: r.title, spec: r.spec, plan: r.plan, last_metrics: r.last_sim ? r.last_sim.metrics : null, updated_at: r.updated_at })), rowCount: Math.min(3, mine.length) };
    if (/AS last_metrics/.test(text) && /ORDER BY updated_at DESC, plan_id/.test(text)) return { rows: mine.slice().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).map(listRow), rowCount: mine.length };
    if (/^SELECT/.test(text)) { const hit = mine.filter((r) => r.plan_id === p[1]); return { rows: hit.map(full), rowCount: hit.length }; }
    if (/^UPDATE drone_relay_plan SET title = \$3/.test(text)) { const hit = mine.filter((r) => r.plan_id === p[1]); hit.forEach((r) => Object.assign(r, { title: p[2], spec: j(p[3]), plan: j(p[4]), last_sim: null, updated_at: new Date(Date.now() + 1).toISOString() })); return { rows: hit.map(full), rowCount: hit.length }; }
    if (/^UPDATE drone_relay_plan SET last_sim = \$3/.test(text)) { const hit = mine.filter((r) => r.plan_id === p[1]); hit.forEach((r) => Object.assign(r, { last_sim: j(p[2]), updated_at: new Date(Date.now() + 1).toISOString() })); return { rows: hit.map(full), rowCount: hit.length }; }
    if (/^DELETE/.test(text)) { const before = rows.length; for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].owner_sub === p[0] && rows[i].plan_id === p[1]) rows.splice(i, 1); return { rows: [], rowCount: before - rows.length }; }
    throw new Error('fake pool cannot answer: ' + text.slice(0, 100));
  } };
}

let server, base, pool;
const control = { sub: 'alice' };
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function call(route, init = {}) {
  const res = await fetch(base + route, init); const text = await res.text();
  let body = text; if ((res.headers.get('content-type') || '').includes('application/json')) body = text ? JSON.parse(text) : null;
  return { status: res.status, body, text, headers: res.headers };
}

test.before(async () => {
  pool = fakePool();
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { if (control.sub) req.oidc = { user: { sub: control.sub }, isAuthenticated: () => true }; next(); });
  app.use('/api/drone-relay/home-summary', createHomeSummaryRoutes({ pool }));
  app.use('/api/drone-relay', createDroneRelayRoutes({ pool, appPackageDir: PKG }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/drone-relay`;
});
test.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); Module._load = originalLoad; });

test('surface, script and capabilities serve; transports and a budget answer and refuse naming the field', async () => {
  const page = await call('/app');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('<title>Drone Relay</title>'));
  const js = await call('/assets/drone-relay.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const caps = await call('/capabilities');
  assert.equal(caps.body.transports.length, 7);
  assert.equal(caps.body.defaults.transport, 'esp-now');
  assert.equal(caps.body.limits.spacingFactor.default, 0.6);
  assert.deepEqual(caps.body.postures, ['hover', 'perch']);
  assert.equal(caps.body.controlChannels[0], 'in-band');
  assert.equal(caps.body.limits.perchDrawFraction.default, 0.03);
  assert.equal(caps.body.heartbeatBytes, 64);
  const perched = await call('/plan-preview', json('POST', { posture: 'perch', controlChannel: 'lora-915', heartbeatS: 10 }));
  assert.equal(perched.status, 200);
  assert.equal(perched.body.sized.perchAntennaHeightM, 1.5);
  assert.equal(perched.body.sized.control.ok, true);
  assert.equal(caps.body.envelope.maxRoute, 16);
  const table = await call('/transports?distanceM=200');
  assert.equal(table.status, 200);
  assert.equal(table.body.budgets.length, 7);
  assert.equal(table.body.budgets.find((b) => b.transport === 'esp-now').ok, true);
  const bad = await call('/transports?distanceM=abc');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'distanceM');
  const budget = await call('/link-budget', json('POST', { transport: 'lora-915', distanceM: 5000 }));
  assert.equal(budget.status, 200);
  assert.equal(budget.body.budget.ok, true);
  const unknown = await call('/link-budget', json('POST', { transport: 'pigeon', distanceM: 5 }));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.field, 'transport');
});

test('the caller gate answers 401 on every plan route', async () => {
  control.sub = null;
  assert.equal((await call('/plans')).status, 401);
  assert.equal((await call('/plan-preview', json('POST', {}))).status, 401);
  assert.equal((await call('/plans', json('POST', {}))).status, 401);
  control.sub = 'alice';
});

test('a chain previews without a row and a refusal names the field', async () => {
  const preview = await call('/plan-preview', json('POST', { fleetSize: 6 }));
  assert.equal(preview.status, 200);
  assert.equal(preview.body.sized.relaysNeeded, 4);
  assert.equal(preview.body.sized.hopM, 200);
  assert.equal(pool.rows.length, 0);
  const refused = await call('/plan-preview', json('POST', { spacingFactor: 5 }));
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'invalid_input');
  assert.equal(refused.body.field, 'spacingFactor');
});

let planId;
test('a chain is created, listed, read with its roster, and owner-scoped', async () => {
  const created = await call('/plans', json('POST', { title: 'Data run east', fleetSize: 6, enduranceS: 1800 }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  planId = created.body.plan.plan_id;
  assert.deepEqual(created.body.plan.roster, ['r1', 'r2', 'r3', 'r4', 's1', 's2', 'tip']);
  assert.equal(created.body.plan.designUrl, `/api/drone-relay/plans/${planId}/design.md`);
  assert.equal(created.body.plan.plan.feasible, true);
  const list = await call('/plans');
  assert.equal(list.body.plans.length, 1);
  assert.equal(list.body.plans[0].last_metrics, null);
  assert.equal('last_sim' in list.body.plans[0], false, 'the list never carries frames');
  assert.equal((await call(`/plans/${planId}`)).body.plan.title, 'Data run east');
  control.sub = 'mallory';
  assert.equal((await call(`/plans/${planId}`)).status, 404);
  assert.equal((await call('/plans')).body.plans.length, 0);
  control.sub = 'alice';
  assert.equal((await call('/plans/not-a-uuid')).status, 400);
  assert.equal((await call(`/plans/${randomUUID()}`)).status, 404);
});

test('a scenario runs and is stored as the last run; PATCH re-sizes and clears it', async () => {
  const run = await call(`/plans/${planId}/simulate`, json('POST', { durationS: 300, events: [{ atS: 60, kind: 'fail', drone: 'r2' }] }));
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.run.metrics.verdict, 'restored');
  assert.equal(run.body.run.metrics.tipOutageS, 0);
  assert.equal(run.body.run.metrics.sparesLaunched, 1);
  assert.ok(run.body.run.frames.length > 100);
  const stored = await call(`/plans/${planId}`);
  assert.equal(stored.body.plan.last_sim.metrics.verdict, 'restored');
  assert.equal((await call('/plans')).body.plans[0].last_metrics.verdict, 'restored');
  const badDrone = await call(`/plans/${planId}/simulate`, json('POST', { events: [{ atS: 1, kind: 'fail', drone: 'r9' }] }));
  assert.equal(badDrone.status, 400);
  assert.equal(badDrone.body.field, 'events[0].drone');
  const patched = await call(`/plans/${planId}`, json('PATCH', { transport: 'esp-now-lr', spacingFactor: 0.5 }));
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.plan.spec.transport, 'esp-now-lr');
  assert.equal(patched.body.plan.spec.fleetSize, 6, 'unchanged fields are kept');
  assert.ok(patched.body.plan.plan.hopM > 300, 'the longer-range transport sizes a longer hop');
  assert.equal(patched.body.plan.last_sim, null, 'a spec change clears the run');
  const refused = await call(`/plans/${planId}`, json('PATCH', { gapPolicy: 'panic' }));
  assert.equal(refused.status, 400);
  assert.equal(refused.body.field, 'gapPolicy');
});

test('an infeasible chain refuses to simulate with its reasons', async () => {
  const small = await call('/plans', json('POST', { title: 'too few', fleetSize: 1 }));
  assert.equal(small.body.plan.plan.feasible, false);
  const run = await call(`/plans/${small.body.plan.plan_id}/simulate`, json('POST', {}));
  assert.equal(run.status, 409);
  assert.equal(run.body.error, 'plan_not_feasible');
  assert.match(run.body.reasons[0], /needs 4 relays/);
  assert.equal((await call(`/plans/${small.body.plan.plan_id}`, { method: 'DELETE' })).status, 200);
});

test('the design write-up serves as Markdown from the stored plan', async () => {
  await call(`/plans/${planId}/simulate`, json('POST', { durationS: 120 }));
  const doc = await call(`/plans/${planId}/design.md`);
  assert.equal(doc.status, 200);
  assert.match(doc.headers.get('content-type'), /markdown/);
  assert.ok(doc.text.startsWith('# Data run east — relay chain design'));
  assert.ok(doc.text.includes('ESP-NOW long-range mode'));
  assert.ok(doc.text.includes('**Verdict: held.**'));
  assert.ok(doc.text.includes('## 5. What this document is and is not'));
});

test('a command envelope traces to the tip and verifies there; a heartbeat traces inward', async () => {
  const out = await call(`/plans/${planId}/trace`, json('POST', { dst: 'tip', kind: 'command' }));
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const roster = (await call(`/plans/${planId}`)).body.plan.roster.filter((id) => id.startsWith('r'));
  assert.deepEqual(out.body.envelope.route, ['base', ...roster, 'tip']);
  assert.equal(out.body.trace[0].node, 'base');
  assert.equal(out.body.trace[0].action, 'forward');
  assert.equal(out.body.trace[out.body.trace.length - 1].action, 'deliver');
  assert.equal(out.body.trace[out.body.trace.length - 1].node, 'tip');
  assert.equal(out.body.trace.length, out.body.envelope.route.length);
  assert.equal(out.body.verifiedAtDestination, true);
  assert.equal(out.body.envelope.mac.length, 32);
  const hb = await call(`/plans/${planId}/trace`, json('POST', { dst: 'tip', kind: 'heartbeat' }));
  assert.equal(hb.body.envelope.route[0], 'tip');
  assert.equal(hb.body.envelope.route[hb.body.envelope.route.length - 1], 'base');
  const unknown = await call(`/plans/${planId}/trace`, json('POST', { dst: 'r9' }));
  assert.equal(unknown.status, 400);
});

test('the Home summary gates the session and counts the caller\'s chains', async () => {
  control.sub = null;
  assert.equal((await call('/home-summary')).status, 401);
  control.sub = 'alice';
  const home = await call('/home-summary');
  assert.equal(home.status, 200);
  assert.deepEqual(home.body.metrics.map((m) => m.id), ['plans-total', 'plans-feasible', 'plans-simulated', 'plans-holding']);
  assert.equal(home.body.metrics[0].value, '1');
  assert.equal(home.body.metrics[2].value, '1');
  assert.ok(home.body.items.some((i) => i.text === 'Data run east'));
});

test('deletion removes the row', async () => {
  assert.equal((await call(`/plans/${planId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/plans/${planId}`)).status, 404);
  assert.equal(pool.rows.length, 0);
});

test('a tree previews, saves, runs a trunk loss, traces to its second tip and writes itself up', async () => {
  const caps = await call('/capabilities');
  assert.deepEqual(caps.body.branches, { min: 2, max: 4 });
  const tree = { title: 'Two survey tips', path: [{ x: 0, y: 0 }, { x: 1600, y: 0 }], branches: [[{ x: 1600, y: 1200 }], [{ x: 1600, y: -600 }]], requiredMarginDb: 2, degradedMarginDb: 0, spacingFactor: 0.9, fleetSize: 6, enduranceS: 1800, staleS: 20 };
  const bad = await call('/plan-preview', json('POST', { ...tree, branches: [[{ x: 1600, y: 1200 }]] }));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'branches');
  const preview = await call('/plan-preview', json('POST', tree));
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.sized.tree.trunkHops, 3);
  assert.equal(pool.rows.length, 0, 'a preview writes nothing');
  const created = await call('/plans', json('POST', tree));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.plan.plan_id;
  assert.deepEqual(created.body.plan.roster, ['r1', 'r2', 'r3', 'r4', 's1', 's2', 'tip1', 'tip2']);
  const run = await call(`/plans/${id}/simulate`, json('POST', { durationS: 300, events: [{ atS: 30, kind: 'fail', drone: 'r2' }] }));
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.run.metrics.verdict, 'restored');
  assert.deepEqual(run.body.run.metrics.branches.map((b) => b.reconnectedAtS), [[41], [41]]);
  assert.ok(run.body.run.frames[0].drones.every((d) => Number.isInteger(d.lane)), 'every drone carries its lane');
  const trace = await call(`/plans/${id}/trace`, json('POST', { dst: 'tip2', kind: 'command' }));
  assert.equal(trace.status, 200, JSON.stringify(trace.body));
  assert.deepEqual(trace.body.envelope.route, ['base', 'r1', 'r2', 'r3', 'tip2']);
  assert.equal(trace.body.trace[trace.body.trace.length - 1].action, 'deliver');
  assert.equal(trace.body.verifiedAtDestination, true);
  const byDefault = await call(`/plans/${id}/trace`, json('POST', {}));
  assert.deepEqual(byDefault.body.envelope.route, ['base', 'r1', 'r2', 'r3', 'r4', 'tip1'], 'a tree traces to tip1 by default');
  const doc = await call(`/plans/${id}/design.md`);
  assert.ok(doc.text.includes('Tree: the trunk runs 1600 m to the fork in 3 hops'));
  assert.ok(doc.text.includes('| tip2 (branch 2) | 2200 |'));
  assert.ok(doc.text.includes('Every tip: tip1 out of reach 11.0 s (reconnected at 41.0); tip2 out of reach 11.0 s (reconnected at 41.0).'));
  assert.equal((await call(`/plans/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal(pool.rows.length, 0);
});

test('a lattice previews, saves, runs a loss it routes around, traces to the tip and writes itself up', async () => {
  const caps = await call('/capabilities');
  assert.equal(caps.body.lattice.maxSlots, 256);
  const area = [{ x: 200, y: -200 }, { x: 800, y: -200 }, { x: 800, y: 200 }, { x: 200, y: 200 }];
  const crossing = await call('/plan-preview', json('POST', { area: [area[0], area[2], area[1], area[3]] }));
  assert.equal(crossing.status, 400);
  assert.equal(crossing.body.field, 'area');
  const created = await call('/plans', json('POST', { title: 'North field', area, fleetSize: 20, enduranceS: 1800 }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.plan.plan_id;
  assert.equal(created.body.plan.plan.lattice.slots, 12);
  assert.equal(created.body.plan.roster.length, 21);
  const run = await call(`/plans/${id}/simulate`, json('POST', { durationS: 300, events: [{ atS: 60, kind: 'fail', drone: 'r1' }] }));
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.run.metrics.tipOutageS, 0);
  assert.equal(run.body.run.metrics.verdict, 'restored');
  const trace = await call(`/plans/${id}/trace`, json('POST', { dst: 'tip' }));
  assert.deepEqual(trace.body.envelope.route, ['base', 'r1', 'tip']);
  assert.equal(trace.body.verifiedAtDestination, true);
  const doc = await call(`/plans/${id}/design.md`);
  assert.ok(doc.text.includes('Lattice: the 240000 m² area is tiled on a 206.6 m grid anchored at the base — 12 slots'));
  assert.ok(doc.text.includes('| r1 (cell 1, 0) | 207 |'));
  assert.equal((await call(`/plans/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal(pool.rows.length, 0);
});

test('a saved chain drafts its formation for Drone Ops and executes nothing', async () => {
  const created = await call('/plans', json('POST', { title: 'East run', fleetSize: 6 }));
  const id = created.body.plan.plan_id;
  const before = JSON.stringify(pool.rows);
  const out = await call(`/plans/${id}/fleet-mission`, json('POST', { home: { lat: 30.4, lon: -86.6 }, drones: { r1: 'alpha' } }));
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.executes, false);
  assert.equal(out.body.target, 'drone');
  assert.deepEqual(out.body.draft.assignments.map((a) => a.droneId), ['alpha', 'r2', 'r3', 'r4', 'tip']);
  assert.equal(out.body.formationHoldS, 123);
  assert.equal(JSON.stringify(pool.rows), before, 'a draft is computed, not stored');
  const noLat = await call(`/plans/${id}/fleet-mission`, json('POST', { home: { lon: -86.6 } }));
  assert.equal(noLat.status, 400);
  assert.equal(noLat.body.field, 'home.lat');
  const twice = await call(`/plans/${id}/fleet-mission`, json('POST', { home: { lat: 30.4, lon: -86.6 }, drones: { r1: 'alpha', r2: 'alpha' } }));
  assert.equal(twice.status, 400);
  assert.equal(twice.body.field, 'drones');
  const small = await call('/plans', json('POST', { title: 'too few', fleetSize: 1 }));
  const refused = await call(`/plans/${small.body.plan.plan_id}/fleet-mission`, json('POST', { home: { lat: 30.4, lon: -86.6 } }));
  assert.equal(refused.status, 409);
  control.sub = 'mallory';
  assert.equal((await call(`/plans/${id}/fleet-mission`, json('POST', { home: { lat: 30.4, lon: -86.6 } }))).status, 404, 'another owner cannot draft it');
  control.sub = 'alice';
  for (const planId2 of [id, small.body.plan.plan_id]) assert.equal((await call(`/plans/${planId2}`, { method: 'DELETE' })).status, 200);
  assert.equal(pool.rows.length, 0);
});

test('the manifest and its Test Lab catalog load through the framework\'s own loaders (the limits the box enforces on install)', () => {
  const yaml = coreRequire('js-yaml');
  const catalogLoader = path.join(CORE, 'scripts', 'oshal-test-catalog.js');
  assert.ok(fs.existsSync(catalogLoader), `the framework checkout carries the catalog loader (${catalogLoader})`);
  const { loadPackageTestCatalog } = coreRequire(catalogLoader);
  const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  const loaded = loadPackageTestCatalog(PKG, manifest);
  assert.ok(loaded, 'the manifest declares a Test Lab catalog');
  assert.equal(loaded.catalog.cases.length, 15);
  for (const c of loaded.catalog.cases) {
    assert.ok(typeof loaded.revisions[c.id] === 'string' && loaded.revisions[c.id].length > 0, `${c.id} has a content revision`);
    for (const line of c.expected) assert.ok(line.length <= 500, `${c.id}: ${line.slice(0, 40)}`);
    assert.ok(c.limits.timeoutMs <= 300000, `${c.id}: the manifest refuses a Test Lab timeout above 300000 ms`);
  }
  const tools = manifest.tools.map((t) => t.name);
  assert.equal(new Set(tools).size, tools.length, 'tool names are unique');
  for (const t of manifest.tools) assert.match(t.executor.apiEndpoint, /^(GET|POST|PATCH|DELETE) \/api\/drone-relay\//, `${t.name} targets this package's own mount`);
});
