/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 8   | maintainer@emeraldcoastsystemsgroup.com     | A turned breadboard placement (rot) is stored and still agrees with the schematic; a bad turn is refused naming board.placements.<id>.rot.
 * 7   | maintainer@emeraldcoastsystemsgroup.com     | circuit-lab-geometry.js is served; a wire's route of bend points is stored through PUT /circuit and a malformed one is refused naming wire.route.points[i].
 * 6   | maintainer@emeraldcoastsystemsgroup.com     | The sixth starter (arduino-blink) is listed.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | The Test Lab catalog loads through the framework's own loader (scripts/oshal-test-catalog.js loadPackageTestCatalog): 0.5.0 shipped an expected line over its 500-character limit and the box refused the whole manifest.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | The breadboard routes: POST lays a board out (every electrical part placed, the board's nets equal the schematic's), PUT with a jumper removed derives fewer wires and still agrees, an overlapping placement is refused naming it, a schematic wire added afterwards regenerates the jumpers, DELETE drops the board.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The shaft-driver catalog route (filtered by type, a bad type refused) and a wire's route stored and sent along.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Restore a run (the circuit and settings come back as a new run; an unknown run is 404) and the gear-to-CAD-Studio body (a gear answers the exact POST body; a resistor and a bore into the rim are refused).
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The packaged routes over real loopback HTTP with express resolved from the framework checkout (OSHAL_CORE_DIR) and the REAL engine client talking to a fake bridge on loopback that speaks the wire protocol: the surface, assets and capabilities serve; the caller gate 401s; a circuit is created from an example and solved (run 1, artifacts on disk, the engine's report); an empty circuit stays a draft; parts add / update-with-merge / refuse-with-field / remove-with-wires, wires connect / refuse-mixed-kinds / disconnect, each a run; the engine's refusal is a 422 naming the field and the last run stays; owner scoping (a second subject gets 404); artifacts by run; the Home summary; deletion removes rows and files; and with the bridge gone, a run answers 503 naming the install command while the last run still serves. The database is a SQL-dispatching in-memory double — the owner RLS boundary itself is proven by the migration's policy text and the live installer, not here.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Redirect a bare require to the framework checkout only when the package itself asks for it. Requires made inside node_modules resolve normally again: redirecting them to core's root broke in the Test Lab sandbox, where the image's pruned node_modules keeps semver only nested under sharp (Cannot find module 'semver'); a developer checkout hoists it, which is why no local run saw it. A setup that fails part-way no longer hangs the suite to its time limit: teardown is null-safe and closes the fake engine it did start. In the Test Lab sandbox a missing catalog file failed setup after the engine was listening, and the open socket held the run for 120 s.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | The catalog counts this suite asserts are the ones the ENVIRONMENT implies. A row may name another package as the owner of a real part and read it, and an absent owner withholds that row on purpose; pinning `catalog.drivers` at five asserted that the degradation never happens, and it went red against a copy of this package alone - the shape the Test Lab and a single-package install both have. The responses are now held to the contract in both environments, including the `unresolved` block that says which row went and who owns it, because a package that quietly drops a part row is worse than one that says it did.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express. Not part of the store-CI
 * wildcard; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
assert.ok(fs.existsSync(path.join(CORE, 'node_modules', 'express')), `OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) must point at a framework checkout with node_modules (got ${CORE})`);
const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
const PKG = path.resolve(__dirname, '..');
const { declaredDrivers, missingSharedOwners } = require(path.resolve(__dirname, 'shared-part-owners.js'));

// ── Framework doubles: exactly the @/ modules the package imports ─────────────
const STUBS = { '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error(obj, msg) { const err = obj && typeof obj === 'object' && obj.err; console.error('[package]', msg || obj, err instanceof Error ? err.stack : err || ''); } }) } };
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (STUBS[request]) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
  if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request) && String(parent?.filename || '').startsWith(PKG + path.sep)) {
    return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};
const express = coreRequire('express');
const { createCircuitLabRoutes } = require(path.join(PKG, 'routes', 'circuit-lab-routes.js'));
const { createHomeSummaryRoutes } = require(path.join(PKG, 'routes', 'home-summary.js'));
const HASH = 'c'.repeat(64);

// ── An in-memory database that answers exactly the package's SQL ─────────────
function fakePool() {
  const tables = { circuit_design: [], circuit_run: [] };
  const now = () => new Date().toISOString();
  const cols = (list) => list.split(',').map((c) => c.trim());
  const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const out = (row, names) => Object.fromEntries(names.map((n) => [n, row[n] === undefined ? null : row[n]]));
  const evalWhere = (text, p) => {
    const where = /WHERE\s+([\s\S]+?)(?:\s+ORDER BY|\s+LIMIT|\s+RETURNING|$)/.exec(text)[1];
    const conds = where.split(/\s+AND\s+/).map((c) => c.trim());
    return (row) => conds.every((c) => {
      const m = /^(\w+)\s*(=|<>|<=)\s*\$(\d+)$/.exec(c);
      if (!m) throw new Error(`fake pool cannot evaluate: ${c}`);
      const value = p[Number(m[3]) - 1];
      const actual = row[m[1]];
      if (m[2] === '=') return actual === value;
      if (m[2] === '<>') return actual !== value;
      return actual <= (value instanceof Date ? value.toISOString() : value);
    });
  };
  return {
    tables,
    async query(sql, params = []) {
      const text = (typeof sql === 'string' ? sql : sql.text).trim();
      const p = typeof sql === 'string' ? params : sql.values;
      const table = /(?:FROM|INTO|UPDATE)\s+(circuit_\w+)/.exec(text)[1];
      const rows = tables[table];
      const returning = /RETURNING\s+([\s\S]+)$/.exec(text);
      if (/^INSERT INTO circuit_design/.test(text)) {
        const row = { design_id: randomUUID(), owner_sub: p[0], title: p[1], parts: j(p[2]), wires: j(p[3]), sim: j(p[4]), run_count: 0, state: 'draft', report: null, failure_reason: null, source: j(p[5]), created_at: now(), updated_at: now() };
        rows.push(row);
        return { rows: [out(row, cols(returning[1]))], rowCount: 1 };
      }
      if (/^INSERT INTO circuit_run/.test(text)) {
        rows.push({ design_id: p[0], run: p[1], owner_sub: p[2], parts: j(p[3]), wires: j(p[4]), sim: j(p[5]), report: j(p[6]), engine_build: p[7], ms: p[8], created_at: now() });
        return { rows: [], rowCount: 1 };
      }
      const matches = evalWhere(text.replace(/FILTER \(WHERE [^)]*\)/g, ''), p);
      if (/^SELECT count\(\*\)/.test(text)) {
        const hit = rows.filter(matches);
        return { rows: [{ total: String(hit.length), ran: String(hit.filter((r) => r.state === 'ran').length), failed: String(hit.filter((r) => r.state === 'failed').length), runs: String(hit.reduce((a, r) => a + r.run_count, 0)) }], rowCount: 1 };
      }
      if (/^SELECT/.test(text)) {
        let hit = rows.filter(matches);
        if (/ORDER BY run DESC/.test(text)) hit = hit.slice().sort((a, b) => b.run - a.run);
        if (/ORDER BY updated_at DESC/.test(text)) hit = hit.slice().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
        if (/jsonb_array_length/.test(text)) return { rows: hit.map((r) => ({ run: r.run, engine_build: r.engine_build, ms: r.ms, created_at: r.created_at, partCount: r.parts.length, warningCount: (r.report.warnings || []).length })), rowCount: hit.length };
        const names = cols(/^SELECT\s+([\s\S]+?)\s+FROM/.exec(text)[1]);
        return { rows: hit.map((r) => out(r, names)), rowCount: hit.length };
      }
      if (/^DELETE/.test(text)) {
        const keep = rows.filter((r) => !matches(r));
        const removed = rows.length - keep.length;
        tables[table] = keep;
        tables.circuit_run = tables.circuit_run.filter((r) => tables.circuit_design.some((d) => d.design_id === r.design_id));
        return { rows: [], rowCount: removed };
      }
      if (/^UPDATE circuit_design SET run_count = run_count \+ 1/.test(text)) {
        const hit = rows.filter(matches);
        hit.forEach((r) => Object.assign(r, { run_count: r.run_count + 1, state: 'ran', report: j(p[2]), failure_reason: null, updated_at: now() }));
        return { rows: hit.map((r) => out(r, cols(returning[1]))), rowCount: hit.length };
      }
      if (/^UPDATE circuit_design SET state = 'failed'/.test(text)) {
        const hit = rows.filter(matches);
        hit.forEach((r) => Object.assign(r, { state: 'failed', failure_reason: p[2], updated_at: now() }));
        return { rows: hit.map((r) => out(r, cols(returning[1]))), rowCount: hit.length };
      }
      if (/^UPDATE circuit_design SET/.test(text)) {
        const sets = /SET\s+([\s\S]+?)\s+WHERE/.exec(text)[1].split(',').map((s) => s.trim());
        const hit = rows.filter(matches);
        hit.forEach((r) => {
          for (const s of sets) { const m = /^(\w+) = \$(\d+)(::jsonb)?$/.exec(s); if (m) r[m[1]] = m[3] ? j(p[Number(m[2]) - 1]) : p[Number(m[2]) - 1]; }
          r.updated_at = new Date(Date.now() + 1).toISOString();
        });
        return { rows: hit.map((r) => out(r, cols(returning[1]))), rowCount: hit.length };
      }
      throw new Error(`fake pool cannot answer: ${text.slice(0, 80)}`);
    },
  };
}

// ── A fake bridge that speaks the wire protocol and answers solves from the request ──
const SENTINEL_OHMS = 7777; // a resistor of this value makes the fake solver refuse, like ngspice on a bad deck
function fakeEngine() {
  const seen = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.setEncoding('utf8');
    socket.write(JSON.stringify({ bridge: { protocol: 1, buildHash: HASH } }) + '\n');
    let tail = '';
    socket.on('data', (chunk) => {
      const parts = (tail + chunk).split('\n'); tail = parts.pop();
      for (const line of parts) {
        if (!line.trim()) continue;
        const req = JSON.parse(line);
        seen.push(req);
        const circuit = req.args.circuit;
        if (circuit.parts.some((p) => p.props && p.props.ohms === SENTINEL_OHMS)) { socket.write(JSON.stringify({ id: req.id, ok: false, error: { code: 'refused', message: 'ngspice could not solve this circuit: singular matrix', field: 'circuit' } }) + '\n'); continue; }
        const wired = new Set(circuit.wires.flatMap((w) => [w.from.part, w.to.part]));
        const readings = circuit.parts.map((p) => ({ id: p.id, type: p.type, ...({ resistor: { ampsFinal: 0.0031, wattsAvg: 0.0097, overRated: false }, led: { milliampsFinal: 3.1, lit: true, brightness: 0.155, overMax: false }, battery: { ampsAvg: 0.0031, runtimeHours: 160 }, motor: { rpmFinal: 2999, stalled: false, shaft: 'shaft:' + p.id }, gear: { shaft: 'shaft:G', driven: true, ratio: -1 / 3, pitchRadiusMm: 15 } }[p.type] || {}) }));
        const warnings = circuit.parts.filter((p) => !wired.has(p.id) && p.type !== 'ground').map((p) => ({ code: 'unconnected_pin', part: p.id, message: `${p.id} is not connected` }));
        const result = { netlist: '* fake deck\n.end\n', nets: [{ name: 'n1', pins: [] }], netOfPin: {}, sim: req.args.sim, waveforms: { time: [0, 0.005, 0.01], signals: { 'v(n1)': [0, 4.5, 5] } }, readings, mechanism: { shafts: [], meshes: [], motors: {} }, warnings, engineLog: '', ms: 3 };
        socket.write(JSON.stringify({ id: req.id, ok: true, result }) + '\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, seen, close: () => { for (const s of sockets) s.destroy(); server.close(); } })));
}

// ── The app under test ───────────────────────────────────────────────────────
let currentSub = 'alice';
let server, baseUrl, engine, pool, dataRoot;
test.before(async () => {
  engine = await fakeEngine();
  pool = fakePool();
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-lab-'));
  const app = express();
  app.use((req, _res, next) => { if (currentSub) req.oidc = { user: { sub: currentSub }, isAuthenticated: () => true }; next(); });
  app.use(express.json({ limit: '10mb' }));
  const ctx = { pool, appPackageDir: PKG };
  app.use('/api/circuit-lab/home-summary', createHomeSummaryRoutes(ctx));
  app.use('/api/circuit-lab', createCircuitLabRoutes(ctx, { dataRoot, env: { CIRCUIT_LAB_ENGINE_ADDR: `127.0.0.1:${engine.port}`, OSHAL_API_CONTAINER: 'oshal-local-api' }, engineBuild: HASH, runTimeoutMs: 5000 }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/circuit-lab`;
});
test.after(() => { server?.close(); engine?.close(); if (dataRoot) fs.rmSync(dataRoot, { recursive: true, force: true }); });

async function call(p, init = {}) {
  const res = await fetch(baseUrl + p, init);
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch (_) { body = null; }
  return { status: res.status, body, text, headers: res.headers };
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let designId;
test('surface, assets and capabilities serve; the caller gate answers 401', async () => {
  const page = await call('/app'); assert.equal(page.status, 200); assert.ok(page.text.includes('<title>Circuit Lab</title>'));
  for (const f of ['circuit-lab.js', 'circuit-lab-canvas.js', 'circuit-lab-geometry.js', 'circuit-lab-plot.js', 'circuit-lab-board-model.js', 'circuit-lab-board.js']) { const js = await call('/assets/' + f); assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/); }
  const caps = await call('/capabilities');
  assert.equal(caps.body.contract.parts.resistor.props.ohms.unit, 'ohm');
  assert.deepEqual(caps.body.examples.map((e) => e.id), ['led-switch', 'rc-charge', 'motor-gearbox', 'pwm-motor', 'crank-slider', 'arduino-blink']);
  assert.match(caps.body.engine.installHint, /docker exec oshal-local-api sh .*circuit-lab\/engine\/install-engine\.sh/);
  assert.equal(caps.body.engine.expectedBuildHash, HASH);
  // A shared row resolves only where its owner package is installed beside this one, and a store
  // package installs on its own - so what the catalog routes must serve is what the environment
  // implies, not a fixed five. Both halves are asserted: the rows that load, and the `unresolved`
  // block naming the owner of every row that did not, so a withheld row is never silent.
  const catalogFile = path.join(PKG, 'catalog', 'drivers.json');
  const withheld = missingSharedOwners(catalogFile);
  const serves = declaredDrivers(catalogFile).length - withheld.length;
  assert.equal(caps.body.catalog.drivers, serves); assert.equal(caps.body.contract.parts.servo.pins.find((p) => p.name === 'shaft').kind, 'shaft');
  assert.deepEqual(caps.body.catalog.unresolved.map((u) => u.id).sort(), withheld.map((w) => w.id).sort());
  for (const row of caps.body.catalog.unresolved) assert.match(row.reason, new RegExp(row.owner), `${row.id}: the reason names the owner`);
  const catalog = await call('/catalog/drivers');
  assert.equal(catalog.status, 200); assert.equal(catalog.body.drivers.length, serves);
  assert.deepEqual(catalog.body.unresolved.map((u) => u.id).sort(), withheld.map((w) => w.id).sort());
  assert.deepEqual((await call('/catalog/drivers?type=stepper')).body.drivers.map((d) => d.id), ['stepper-nema17-17hs4401']);
  assert.equal((await call('/catalog/drivers?type=gear')).status, 400);
  currentSub = null;
  assert.equal((await call('/designs')).status, 401);
  currentSub = 'alice';
});

test('a circuit is created from an example and solved: run 1, artifacts on disk, the engine\'s report; an empty one stays a draft', async () => {
  const bad = await call('/designs', json('POST', { title: 'x', parts: [{ id: 'R1', type: 'resistor', props: { ohms: -1 } }] }));
  assert.equal(bad.status, 400); assert.equal(bad.body.field, 'parts[0].props.ohms');
  assert.equal((await call('/designs', json('POST', { example: 'nope' }))).body.field, 'example');
  const res = await call('/designs', json('POST', { example: 'led-switch' }));
  assert.equal(res.status, 201);
  designId = res.body.design.design_id;
  assert.equal(res.body.design.title, 'Switched LED'); assert.equal(res.body.design.run_count, 1); assert.equal(res.body.design.state, 'ran'); assert.equal(res.body.build.ok, true);
  assert.equal(res.body.run.run, 1); assert.equal(res.body.run.report.readings.find((r) => r.id === 'D1').lit, true);
  assert.deepEqual(res.body.design.source, { kind: 'example', example: 'led-switch' });
  assert.match(res.body.design.artifacts.waveforms, /\/runs\/1\/artifacts\/waveforms$/);
  const onDisk = fs.readdirSync(dataRoot, { recursive: true }).map(String);
  assert.ok(onDisk.some((f) => f.endsWith('waveforms.json')) && onDisk.some((f) => f.endsWith('netlist.cir')) && onDisk.some((f) => f.endsWith('report.json')));
  assert.equal(engine.seen[0].cmd, 'simulate'); assert.equal(engine.seen[0].args.circuit.parts.length, 5); assert.equal(engine.seen[0].args.sim.stopSeconds, 0.02); assert.equal(engine.seen[0].args.sim.startFromRest, true);
  const read = await call('/designs/' + designId);
  assert.deepEqual(read.body.runs.map((r) => r.run), [1]); assert.equal(read.body.runs[0].partCount, 5); assert.equal(read.body.engine.connected, true);
  const empty = await call('/designs', json('POST', { title: 'blank' }));
  assert.equal(empty.status, 201); assert.equal(empty.body.design.run_count, 0); assert.equal(empty.body.design.state, 'draft'); assert.equal(empty.body.run, null);
  assert.equal((await call(`/designs/${empty.body.design.design_id}/run`, json('POST', {}))).body.field, 'parts');
});

test('parts and wires: add with a minted id, tool-shaped body, merge update, refuse with the field, connect, mixed kinds refused, disconnect, remove with wires — each a run', async () => {
  const add = await call(`/designs/${designId}/parts`, json('POST', { designId, type: 'resistor', props: { ohms: 1000 }, x: 700, y: 100 }));
  assert.equal(add.status, 200); assert.equal(add.body.part.id, 'R2'); assert.equal(add.body.part.props.ratedWatts, 0.25); assert.equal(add.body.design.run_count, 2);
  assert.ok(add.body.run.report.warnings.some((w) => w.part === 'R2'), 'the unwired part is warned about');
  assert.equal((await call(`/designs/${designId}/parts`, json('POST', { type: 'resistor', id: 'r2' }))).body.field, 'part.id');
  const upd = await call(`/designs/${designId}/parts/R2`, json('PATCH', { props: { ohms: 2200 }, label: 'series' }));
  assert.equal(upd.status, 200); assert.deepEqual(upd.body.part.props, { ohms: 2200, ratedWatts: 0.25 }); assert.equal(upd.body.part.label, 'series'); assert.equal(upd.body.design.run_count, 3);
  const invalid = await call(`/designs/${designId}/parts/R2`, json('PATCH', { props: { ohm: 5 } }));
  assert.equal(invalid.status, 400); assert.equal(invalid.body.field, 'part.props.ohm');
  assert.equal((await call(`/designs/${designId}/parts/nope`, json('PATCH', { props: {} }))).status, 404);
  const wire = await call(`/designs/${designId}/wires`, json('POST', { from: { part: 'R2', pin: 'a' }, to: { part: 'B1', pin: '+' } }));
  assert.equal(wire.status, 200); assert.equal(wire.body.wire.id, 'w6'); assert.equal(wire.body.wire.kind, 'electrical'); assert.equal(wire.body.design.run_count, 4);
  const mixed = await call(`/designs/${designId}/wires`, json('POST', { from: { part: 'R2', pin: 'b' }, to: { part: 'S1', pin: 'shaft' } }));
  assert.equal(mixed.status, 400); assert.equal(mixed.body.field, 'wire.to.pin');
  const gear = await call(`/designs/${designId}/parts`, json('POST', { type: 'gear' }));
  const mixedKind = await call(`/designs/${designId}/wires`, json('POST', { from: { part: 'R2', pin: 'b' }, to: { part: gear.body.part.id, pin: 'shaft' } }));
  assert.equal(mixedKind.status, 400); assert.equal(mixedKind.body.field, 'wire');
  const dup = await call(`/designs/${designId}/wires`, json('POST', { from: { part: 'B1', pin: '+' }, to: { part: 'R2', pin: 'a' } }));
  assert.equal(dup.status, 400); assert.match(dup.body.message, /duplicate wire/);
  const off = await call(`/designs/${designId}/wires/w6`, { method: 'DELETE' });
  assert.equal(off.status, 200); assert.equal(off.body.removed, 'w6'); assert.ok(!off.body.design.wires.some((w) => w.id === 'w6'));
  assert.equal((await call(`/designs/${designId}/wires/w6`, { method: 'DELETE' })).status, 404);
  const reconnect = await call(`/designs/${designId}/wires`, json('POST', { from: { part: 'R2', pin: 'a' }, to: { part: 'B1', pin: '+' }, run: false }));
  assert.equal(reconnect.body.run, null, 'run:false saves without solving');
  const routed = await call(`/designs/${designId}/wires`, json('POST', { from: { part: 'R2', pin: 'b' }, to: { part: 'S1', pin: 'b' }, route: { mid: 140 }, run: false }));
  assert.equal(routed.status, 200); assert.deepEqual(routed.body.wire.route, { mid: 140 }); assert.deepEqual(routed.body.design.wires.find((w) => w.id === routed.body.wire.id).route, { mid: 140 });
  assert.equal((await call(`/designs/${designId}/wires`, json('POST', { from: { part: 'R2', pin: 'b' }, to: { part: 'D1', pin: 'a' }, route: { mid: 'left' } }))).body.field, 'wire.route.mid');
  assert.equal((await call(`/designs/${designId}/wires`, json('POST', { from: { part: 'R2', pin: 'b' }, to: { part: 'D1', pin: 'a' }, route: { points: [[120, 240], [200]] } }))).body.field, 'wire.route.points[1]');
  const gone = await call(`/designs/${designId}/parts/R2`, { method: 'DELETE' });
  assert.equal(gone.status, 200); assert.equal(gone.body.removed, 'R2'); assert.equal(gone.body.removedWires, 2); assert.equal(gone.body.design.parts.length, 6);
  const bent = gone.body.design.wires.map((w) => (w.id === 'w1' ? { ...w, route: { points: [[120, 240], [200, 240], [200, 100]] } } : w));
  const replaced = await call(`/designs/${designId}/circuit`, json('PUT', { parts: gone.body.design.parts.filter((p) => p.type !== 'gear'), wires: bent, run: true }));
  assert.equal(replaced.status, 200); assert.equal(replaced.body.design.parts.length, 5); assert.ok(replaced.body.run);
  assert.deepEqual(replaced.body.design.wires.find((w) => w.id === 'w1').route, { points: [[120, 240], [200, 240], [200, 100]] }, 'a route of bend points is stored');
  assert.deepEqual(engine.seen[engine.seen.length - 1].args.circuit.wires.find((w) => w.id === 'w1').route, { points: [[120, 240], [200, 240], [200, 100]] }, 'and rides along to the engine, which ignores it');
  const ran = await call(`/designs/${designId}/run`, json('POST', { stopSeconds: 0.05 }));
  assert.equal(ran.status, 200); assert.equal(ran.body.design.sim.stopSeconds, 0.05); assert.equal(engine.seen[engine.seen.length - 1].args.sim.stopSeconds, 0.05);
  assert.equal((await call(`/designs/${designId}/run`, json('POST', { stopSeconds: 0 }))).body.field, 'sim.stopSeconds');
});

test('restore puts back an earlier run\'s circuit as a new run; the gear hand-off answers CAD Studio\'s body', async () => {
  const before = (await call('/designs/' + designId)).body.design;
  const first = await call(`/designs/${designId}/runs/1`);
  assert.equal(first.body.run.parts.length, 5);
  const restored = await call(`/designs/${designId}/restore`, json('POST', { run: 1 }));
  assert.equal(restored.status, 200); assert.equal(restored.body.restoredFrom, 1);
  assert.equal(restored.body.design.parts.length, 5); assert.equal(restored.body.design.run_count, before.run_count + 1);
  assert.equal(restored.body.design.sim.stopSeconds, 0.02, 'the run\'s settings come back too');
  assert.equal((await call(`/designs/${designId}/restore`, json('POST', { run: 999 }))).status, 404);
  assert.equal((await call(`/designs/${designId}/restore`, json('POST', { run: 0 }))).body.field, 'run');
  const gear = await call(`/designs/${designId}/parts`, json('POST', { type: 'gear', id: 'G9', props: { teeth: 24, moduleMm: 1.5, faceWidthMm: 10, boreMm: 4 }, run: false }));
  assert.equal(gear.status, 200);
  const cad = await call(`/designs/${designId}/parts/G9/gear-profile`);
  assert.equal(cad.status, 200); assert.equal(cad.body.cadStudio.path, '/api/cad-studio/models');
  assert.equal(cad.body.cadStudio.body.base.kind, 'sketch'); assert.equal(cad.body.cadStudio.body.base.height, 10);
  assert.equal(cad.body.cadStudio.body.features[0].params.diameter, 4); assert.equal(cad.body.outline.pitchRadiusMm, 18);
  assert.equal((await call(`/designs/${designId}/parts/G9/gear-profile?faceWidthMm=12&boreMm=0`)).body.cadStudio.body.base.height, 12);
  assert.equal((await call(`/designs/${designId}/parts/G9/gear-profile?boreMm=40`)).status, 422);
  assert.equal((await call(`/designs/${designId}/parts/R1/gear-profile`)).status, 422);
  assert.equal((await call(`/designs/${designId}/parts/nope/gear-profile`)).status, 404);
  await call(`/designs/${designId}/parts/G9`, { method: 'DELETE' });
});

test('the breadboard: laid out from the schematic, edited on the board, kept in step by the schematic', async () => {
  const M = require(path.join(PKG, 'tools', 'circuit-lab-board-model.js'));
  const contract = require(path.join(PKG, 'routes', 'circuit-contract.js')).describeContract();
  const made = await call('/designs', json('POST', { example: 'led-switch', run: false }));
  const id = made.body.design.design_id;
  assert.equal(made.body.design.board, null);
  const laid = await call(`/designs/${id}/board`, json('POST', {}));
  assert.equal(laid.status, 200); assert.equal(laid.body.laidOut, true);
  assert.deepEqual(Object.keys(laid.body.board.placements).sort(), ['B1', 'D1', 'GND', 'R1', 'S1']); assert.equal(laid.body.board.jumpers.length, 5);
  const d0 = laid.body.design;
  assert.ok(M.sameNets(M.wireNets(d0.parts, d0.wires, contract), M.boardNets(d0.board, d0.parts, contract)), 'the board implies the schematic nets');
  assert.equal((await call(`/designs/${id}/board`, json('POST', {}))).body.laidOut, false, 'a second POST keeps the board');
  const fewer = await call(`/designs/${id}/board`, json('PUT', { placements: d0.board.placements, jumpers: d0.board.jumpers.slice(1) }));
  assert.equal(fewer.status, 200); assert.equal(fewer.body.agree, true); assert.equal(fewer.body.design.wires.length, 4, 'the net that jumper carried lost its wire');
  assert.equal(fewer.body.design.run_count, 1, 'a board edit solves');
  assert.ok(M.sameNets(M.wireNets(fewer.body.design.parts, fewer.body.design.wires, contract), M.boardNets(fewer.body.design.board, fewer.body.design.parts, contract)));
  const clash = await call(`/designs/${id}/board`, json('PUT', { placements: { ...d0.board.placements, R1: d0.board.placements.S1 }, jumpers: [] }));
  assert.equal(clash.status, 400); assert.match(clash.body.field, /^board\.placements\./);
  const wired = await call(`/designs/${id}/wires`, json('POST', { from: { part: 'S1', pin: 'a' }, to: { part: 'B1', pin: '+' }, run: false }));
  assert.equal(wired.status, 200); assert.equal(wired.body.design.wires.length, 5);
  assert.equal(wired.body.design.board.jumpers.length, 5, 'the jumpers followed the schematic');
  assert.ok(M.sameNets(M.wireNets(wired.body.design.parts, wired.body.design.wires, contract), M.boardNets(wired.body.design.board, wired.body.design.parts, contract)));
  assert.deepEqual(wired.body.design.board.placements, d0.board.placements, 'placements are kept');
  const turnedAt = { ...wired.body.design.board.placements, R1: { ...wired.body.design.board.placements.R1, rot: 180 } };
  const turned = await call(`/designs/${id}/board`, json('PUT', { placements: turnedAt, jumpers: wired.body.design.board.jumpers, run: false }));
  assert.equal(turned.status, 200); assert.equal(turned.body.agree, true); assert.equal(turned.body.design.board.placements.R1.rot, 180, 'a turned placement is stored');
  assert.ok(M.sameNets(M.wireNets(turned.body.design.parts, turned.body.design.wires, contract), M.boardNets(turned.body.design.board, turned.body.design.parts, contract)), 'and the derived wires still agree with it');
  const badTurn = await call(`/designs/${id}/board`, json('PUT', { placements: { ...turnedAt, R1: { ...turnedAt.R1, rot: 45 } }, jumpers: [] }));
  assert.equal(badTurn.status, 400); assert.equal(badTurn.body.field, 'board.placements.R1.rot');
  const dropped = await call(`/designs/${id}/board`, { method: 'DELETE' });
  assert.equal(dropped.status, 200); assert.equal(dropped.body.design.board, null);
  assert.equal((await call('/designs/' + id, { method: 'DELETE' })).status, 200);
});

test('the engine\'s refusal is a 422 naming the field; the last run stays', async () => {
  const before = (await call('/designs/' + designId)).body.design.run_count;
  const res = await call(`/designs/${designId}/parts/R1`, json('PATCH', { props: { ohms: SENTINEL_OHMS } }));
  assert.equal(res.status, 422); assert.equal(res.body.build.code, 'refused'); assert.equal(res.body.build.field, 'circuit'); assert.match(res.body.build.error, /singular matrix/);
  assert.equal(res.body.design.state, 'failed'); assert.equal(res.body.design.run_count, before); assert.equal(res.body.run, null);
  const fixed = await call(`/designs/${designId}/parts/R1`, json('PATCH', { props: { ohms: 470 } }));
  assert.equal(fixed.status, 200); assert.equal(fixed.body.design.state, 'ran'); assert.equal(fixed.body.design.run_count, before + 1);
});

test('owner scoping: a second subject sees nothing; artifacts and runs by number', async () => {
  currentSub = 'bob';
  assert.equal((await call('/designs/' + designId)).status, 404);
  assert.deepEqual((await call('/designs')).body.designs, []);
  currentSub = 'alice';
  const design = (await call('/designs/' + designId)).body.design;
  const wf = await call(`/designs/${designId}/runs/${design.run_count}/artifacts/waveforms`);
  assert.equal(wf.status, 200); assert.deepEqual(wf.body.time, [0, 0.005, 0.01]);
  const deck = await call(`/designs/${designId}/runs/1/artifacts/netlist?download`);
  assert.equal(deck.status, 200); assert.ok(deck.text.startsWith('* fake deck')); assert.match(deck.headers.get('content-disposition'), /Switched_LED-run1\.cir/);
  assert.equal((await call(`/designs/${designId}/runs/latest/artifacts/report`)).body.readings.length, 5);
  assert.equal((await call(`/designs/${designId}/runs/1/artifacts/gcode`)).status, 404);
  assert.equal((await call(`/designs/${designId}/runs/999/artifacts/report`)).status, 404);
  const latest = await call(`/designs/${designId}/runs/latest`);
  assert.equal(latest.status, 200); assert.equal(latest.body.run.run, design.run_count); assert.equal(latest.body.run.parts.length, 5);
  assert.equal((await call(`/designs/${designId}/runs/999`)).status, 404);
  assert.equal((await call(`/designs/${designId}/runs`)).body.runs.length, design.run_count);
});

test('the Home summary reads metadata only', async () => {
  const home = await call('/home-summary');
  assert.equal(home.status, 200);
  assert.equal(home.body.metrics.find((m) => m.id === 'designs-total').value, '2');
  assert.ok(home.body.items.some((i) => i.text === 'Switched LED'));
});

test('deleting a circuit removes its rows and files', async () => {
  const before = fs.readdirSync(dataRoot, { recursive: true }).filter((f) => String(f).endsWith('report.json')).length;
  assert.equal((await call('/designs/' + designId, { method: 'DELETE' })).status, 200);
  assert.equal((await call('/designs/' + designId)).status, 404);
  assert.ok(fs.readdirSync(dataRoot, { recursive: true }).filter((f) => String(f).endsWith('report.json')).length < before);
  assert.equal(pool.tables.circuit_run.some((r) => r.design_id === designId), false);
});

test('with the bridge gone, a run answers 503 naming the install command and the last run still serves', async () => {
  const made = await call('/designs', json('POST', { example: 'rc-charge' }));
  assert.equal(made.status, 201);
  const id = made.body.design.design_id;
  engine.close();
  await new Promise((r) => setTimeout(r, 50));
  const res = await call(`/designs/${id}/run`, json('POST', {}));
  assert.equal(res.status, 503); assert.equal(res.body.build.code, 'capability_unavailable');
  assert.match(res.body.build.reason, /install-engine\.sh/);
  assert.equal(res.body.design.state, 'failed'); assert.equal(res.body.design.run_count, 1);
  assert.equal((await call(`/designs/${id}/runs/1/artifacts/waveforms`)).status, 200);
  const caps = await call('/capabilities');
  assert.equal(caps.body.engine.connected, false); assert.match(caps.body.engine.lastError, /not running/);
});

test('the Test Lab catalog loads through the framework\'s own loader (the limits the box enforces on install)', () => {
  const yaml = coreRequire('js-yaml');
  const { loadPackageTestCatalog } = coreRequire(path.join(CORE, 'scripts', 'oshal-test-catalog.js'));
  const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  const loaded = loadPackageTestCatalog(PKG, manifest);
  assert.ok(loaded, 'the manifest declares a Test Lab catalog');
  assert.ok(loaded.catalog.cases.length >= 8);
  for (const c of loaded.catalog.cases) {
    assert.ok(typeof loaded.revisions[c.id] === 'string' && loaded.revisions[c.id].length > 0, c.id + ' has a content revision');
    for (const line of c.expected) assert.ok(line.length <= 500, c.id + ': ' + line.slice(0, 40));
  }
});
