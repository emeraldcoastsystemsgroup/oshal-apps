/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A canned Arduino Uno reading for the sketch-editing case.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the loopback fixture for the browser suite: the
 *                     |                             | compiled routes on express (from the framework checkout), an
 *                     |                             | in-memory pool answering the package's SQL, and a fake engine
 *                     |                             | bridge on loopback that answers `simulate` with a canned
 *                     |                             | report and three-point waveforms. No docker, no database.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Serve the real core surface-bridge client for its one path so the page's
 *                     |                             | module import succeeds and the assistant-rail case crosses the real client.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Redirect a bare require to the framework checkout only when the package itself asks for it. Requires made inside node_modules resolve normally again: redirecting them to core's root broke in the Test Lab sandbox, where the image's pruned node_modules keeps semver only nested under sharp (Cannot find module 'semver'); a developer checkout hoists it, which is why no local run saw it.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | A setup that fails part-way no longer hangs the suite to its time limit: teardown is null-safe and closes the fake engine it did start. In the Test Lab sandbox a missing catalog file failed setup after the engine was listening, and the open socket held the run for 120 s.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Answer /favicon.ico with 204. The Test Lab runner image's Chromium requests the origin's favicon and logs the 404 as a console error, which the spec counts as a page error - so every no-errors assertion failed in the sandbox while passing on a host browser that does not ask. The page itself requests no favicon.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH = 'd'.repeat(64);

/** Resolve bare requires (express, playwright) from the framework checkout; stub the `@/` logger. */
export function frameworkRequire() {
  if (!fs.existsSync(path.join(CORE, 'node_modules', 'express'))) throw new Error(`OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) must point at a framework checkout with node_modules (got ${CORE})`);
  const coreRequire = createRequire(path.join(CORE, 'package.json'));
  const STUBS = { '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error(obj, msg) { console.error('[package]', msg || obj, obj && obj.err); } }) } };
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (STUBS[request]) return STUBS[request];
    if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
    if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request) && String(parent?.filename || '').startsWith(PKG + path.sep)) return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
    return originalLoad.call(this, request, parent, isMain);
  };
  return coreRequire;
}

function fakePool() {
  const tables = { circuit_design: [], circuit_run: [] };
  const now = () => new Date().toISOString();
  const cols = (list) => list.split(',').map((c) => c.trim());
  const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const out = (row, names) => Object.fromEntries(names.map((n) => [n, row[n] === undefined ? null : row[n]]));
  const evalWhere = (text, p) => {
    const where = /WHERE\s+([\s\S]+?)(?:\s+ORDER BY|\s+LIMIT|\s+RETURNING|$)/.exec(text)[1];
    return (row) => where.split(/\s+AND\s+/).every((c) => { const m = /^(\w+)\s*(=|<>|<=)\s*\$(\d+)$/.exec(c.trim()); const value = p[Number(m[3]) - 1]; const actual = row[m[1]]; if (m[2] === '=') return actual === value; if (m[2] === '<>') return actual !== value; return actual <= (value instanceof Date ? value.toISOString() : value); });
  };
  return { tables, async query(sql, params = []) {
    const text = (typeof sql === 'string' ? sql : sql.text).trim(); const p = typeof sql === 'string' ? params : sql.values;
    const table = /(?:FROM|INTO|UPDATE)\s+(circuit_\w+)/.exec(text)[1]; const rows = tables[table]; const returning = /RETURNING\s+([\s\S]+)$/.exec(text);
    if (/^INSERT INTO circuit_design/.test(text)) { const row = { design_id: randomUUID(), owner_sub: p[0], title: p[1], parts: j(p[2]), wires: j(p[3]), sim: j(p[4]), run_count: 0, state: 'draft', report: null, failure_reason: null, source: j(p[5]), created_at: now(), updated_at: now() }; rows.push(row); return { rows: [out(row, cols(returning[1]))], rowCount: 1 }; }
    if (/^INSERT INTO circuit_run/.test(text)) { rows.push({ design_id: p[0], run: p[1], owner_sub: p[2], parts: j(p[3]), wires: j(p[4]), sim: j(p[5]), report: j(p[6]), engine_build: p[7], ms: p[8], created_at: now() }); return { rows: [], rowCount: 1 }; }
    const matches = evalWhere(text.replace(/FILTER \(WHERE [^)]*\)/g, ''), p);
    if (/^SELECT/.test(text)) { let hit = rows.filter(matches); if (/ORDER BY run DESC/.test(text)) hit = hit.slice().sort((a, b) => b.run - a.run); if (/ORDER BY updated_at DESC/.test(text)) hit = hit.slice().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)); if (/jsonb_array_length/.test(text)) return { rows: hit.map((r) => ({ run: r.run, engine_build: r.engine_build, ms: r.ms, created_at: r.created_at, partCount: r.parts.length, warningCount: (r.report.warnings || []).length })), rowCount: hit.length }; const names = cols(/^SELECT\s+([\s\S]+?)\s+FROM/.exec(text)[1]); return { rows: hit.map((r) => out(r, names)), rowCount: hit.length }; }
    if (/^DELETE/.test(text)) { const keep = rows.filter((r) => !matches(r)); tables[table] = keep; return { rows: [], rowCount: rows.length - keep.length }; }
    if (/^UPDATE circuit_design SET run_count = run_count \+ 1/.test(text)) { const hit = rows.filter(matches); hit.forEach((r) => Object.assign(r, { run_count: r.run_count + 1, state: 'ran', report: j(p[2]), failure_reason: null, updated_at: now() })); return { rows: hit.map((r) => out(r, cols(returning[1]))), rowCount: hit.length }; }
    if (/^UPDATE circuit_design SET state = 'failed'/.test(text)) { const hit = rows.filter(matches); hit.forEach((r) => Object.assign(r, { state: 'failed', failure_reason: p[2], updated_at: now() })); return { rows: hit.map((r) => out(r, cols(returning[1]))), rowCount: hit.length }; }
    if (/^UPDATE circuit_design SET/.test(text)) { const sets = /SET\s+([\s\S]+?)\s+WHERE/.exec(text)[1].split(',').map((s) => s.trim()); const hit = rows.filter(matches); hit.forEach((r) => { for (const s of sets) { const m = /^(\w+) = \$(\d+)(::jsonb)?$/.exec(s); if (m) r[m[1]] = m[3] ? j(p[Number(m[2]) - 1]) : p[Number(m[2]) - 1]; } r.updated_at = new Date(Date.now() + 1).toISOString(); }); return { rows: hit.map((r) => out(r, cols(returning[1]))), rowCount: hit.length }; }
    throw new Error('fake pool cannot answer: ' + text.slice(0, 80));
  } };
}

/** A fake bridge: hello, then a canned report per `simulate` built from the circuit it was sent. */
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
        const req = JSON.parse(line); seen.push(req);
        const circuit = req.args.circuit;
        const wired = new Set(circuit.wires.flatMap((w) => [w.from.part, w.to.part]));
        const readings = circuit.parts.map((p) => ({ id: p.id, type: p.type, ...({ resistor: { ampsFinal: 0.0031, voltsFinal: 3.1, wattsAvg: 0.0097, overRated: false }, led: { milliampsFinal: 3.1, lit: true, brightness: 0.155, overMax: false }, battery: { voltsFinal: 9, ampsAvg: 0.0031, ampsPeak: 0.004, wattsAvg: 0.028, runtimeHours: 160 }, switch: { closed: true, ampsFinal: 0.0031 }, motor: { rpmFinal: 2999, stalled: false, shaft: 'shaft:' + p.id }, arduino: { compiled: true, flashBytes: 924, simulatedSeconds: 2.5, cycles: 40000000, pinsDriven: ['D13'], edges: 5, modes: { D13: 'output' }, serial: '', ampsAvg: 0.006, ampsPeak: 0.012, ampsFinal: 0 } }[p.type] || {}) }));
        const warnings = circuit.parts.filter((p) => !wired.has(p.id) && p.type !== 'ground').map((p) => ({ code: 'unconnected_pin', part: p.id, message: `${p.id} is not connected` }));
        const signals = { 'v(n1)': [0, 4.5, 5] };
        circuit.parts.filter((p) => p.type === 'led').forEach((p) => { signals['i(' + p.id + ')'] = [0, 0.002, 0.0031]; });
        // every wired electrical pin sits on one net (n1) so the canvas can label wires; ground pins are node 0
        const netOfPin = {};
        circuit.wires.forEach((w) => [w.from, w.to].forEach((end) => { const part = circuit.parts.find((p) => p.id === end.part); netOfPin[end.part + '.' + end.pin] = part && part.type === 'ground' ? '0' : 'n1'; }));
        const result = { netlist: '* fake deck\n.end\n', nets: [{ name: 'n1', pins: [] }], netOfPin, sim: req.args.sim, waveforms: { time: [0, 0.005, 0.01], signals }, readings, mechanism: { shafts: [], meshes: [], motors: {} }, warnings, engineLog: '', ms: 3 };
        socket.write(JSON.stringify({ id: req.id, ok: true, result }) + '\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, seen, close: () => { for (const s of sockets) s.destroy(); server.close(); } })));
}

/**
 * @description Start the fixture: returns the base URL of the mounted package, the fake engine and pool, and a stop().
 */
export async function startFixture() {
  const coreRequire = frameworkRequire();
  const express = coreRequire('express');
  const { createCircuitLabRoutes } = coreRequire(path.join(PKG, 'routes', 'circuit-lab-routes.js'));
  const engine = await fakeEngine();
  const pool = fakePool();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-lab-surface-'));
  try {
  const app = express();
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.use((req, _res, next) => { req.oidc = { user: { sub: 'alice' }, isAuthenticated: () => true }; next(); });
  app.use(express.json({ limit: '10mb' }));
  // The one shared asset the page imports as an ES module is the REAL core client (a 204 would log a
  // console MIME error, which the spec counts); every other shared asset stays a 204.
  app.get('/shared/ui/js/surface-bridge-client.js', (_req, res) => res.type('text/javascript').sendFile(path.join(CORE, 'src', 'shared', 'ui', 'js', 'surface-bridge-client.js')));
  app.use('/shared/ui', (_req, res) => res.status(204).end());
  app.use('/api/circuit-lab', createCircuitLabRoutes({ pool, appPackageDir: PKG }, { dataRoot, env: { CIRCUIT_LAB_ENGINE_ADDR: `127.0.0.1:${engine.port}`, OSHAL_API_CONTAINER: 'oshal-local-api' }, engineBuild: HASH, runTimeoutMs: 5000 }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    coreRequire, engine, pool, baseUrl: `http://127.0.0.1:${server.address().port}`,
    stop() { server.close(); engine.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); },
  };
  } catch (err) {
    // A half-built fixture must not leave the fake engine listening: that socket keeps the run alive
    // until the time limit instead of failing now with the real cause.
    engine.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
    throw err;
  }
}
