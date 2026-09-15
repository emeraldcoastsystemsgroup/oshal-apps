/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The packaged routes over real loopback HTTP with express and multer resolved from the framework checkout (OSHAL_CORE_DIR) and the REAL engine client talking to a fake bridge on loopback that speaks the wire protocol: the surface, assets and capabilities serve; the caller gate 401s; a part is created and built (revision 1, artifacts on disk, report from the engine); features add / refuse-with-reason / validate-with-field / merge-update / disable / move / remove / restore, each a new revision; owner scoping (a second subject gets 404); artifacts download by key and revision; a mesh base upload reaches the engine as base64 and is stored only as a file reference; the Home summary; deletion removes rows and files; and with the bridge gone, a rebuild answers 503 naming the install command while the last good revision still serves. The database is a SQL-dispatching in-memory double — the owner RLS boundary itself is proven by the migration's policy text and the live installer, not here.
 *
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | BACKLOG B5: POST /models/:id/cancel — idle answers cancelled:false; another subject gets 404; mid-rebuild it closes the engine connection, the triggering request answers 409 cancelled, the part is recorded failed at its last good revision whose artifacts still serve, and the next rebuild reconnects. settings.featureBudgetMs is refused by field, defaults to 60000, is sent with every rebuild, and a worker budget_exceeded status is stored per feature.
 *
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 *
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Redirect a bare require to the framework checkout only when the package itself asks for it. Requires made inside node_modules resolve normally again: redirecting them to core's root broke in the Test Lab sandbox, where the image's pruned node_modules keeps semver only nested under sharp (Cannot find module 'semver'); a developer checkout hoists it, which is why no local run saw it.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express/multer. Not part of the store-CI
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

// ── Framework doubles: exactly the @/ modules the package imports ─────────────
// Errors the package logs are the diagnostics of this suite; everything else stays quiet.
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
const { createCadStudioRoutes } = require(path.join(PKG, 'routes', 'cad-studio-routes.js'));
const { createHomeSummaryRoutes } = require(path.join(PKG, 'routes', 'home-summary.js'));
const HASH = 'c'.repeat(64);

// ── An in-memory database that answers exactly the package's SQL ─────────────
function fakePool() {
  const tables = { cad_model: [], cad_revision: [] };
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
      const table = /(?:FROM|INTO|UPDATE)\s+(cad_\w+)/.exec(text)[1];
      const rows = tables[table];
      const returning = /RETURNING\s+([\s\S]+)$/.exec(text);
      if (/^INSERT INTO cad_model/.test(text)) {
        const row = { model_id: randomUUID(), owner_sub: p[0], title: p[1], base: j(p[2]), features: j(p[3]), revision: 0, state: 'draft', report: null, feature_status: null, failure_reason: null, source: j(p[4]), settings: j(p[5]), created_at: now(), updated_at: now() };
        rows.push(row);
        return { rows: [out(row, cols(returning[1]))], rowCount: 1 };
      }
      if (/^INSERT INTO cad_revision/.test(text)) {
        rows.push({ model_id: p[0], revision: p[1], owner_sub: p[2], features: j(p[3]), report: j(p[4]), feature_status: j(p[5]), engine_build: p[6], ms: p[7], created_at: now() });
        return { rows: [], rowCount: 1 };
      }
      // The Home query's `count(*) FILTER (WHERE …)` clauses are not the row filter.
      const matches = evalWhere(text.replace(/FILTER \(WHERE [^)]*\)/g, ''), p);
      if (/^SELECT count\(\*\)/.test(text)) {
        const hit = rows.filter(matches);
        return { rows: [{ total: String(hit.length), built: String(hit.filter((r) => r.state === 'built').length), failed: String(hit.filter((r) => r.state === 'failed').length), revisions: String(hit.reduce((a, r) => a + r.revision, 0)) }], rowCount: 1 };
      }
      if (/^SELECT/.test(text)) {
        let hit = rows.filter(matches);
        if (/ORDER BY revision DESC/.test(text)) hit = hit.slice().sort((a, b) => b.revision - a.revision);
        if (/ORDER BY updated_at DESC/.test(text)) hit = hit.slice().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
        if (/jsonb_array_length/.test(text)) return { rows: hit.map((r) => ({ revision: r.revision, engine_build: r.engine_build, ms: r.ms, created_at: r.created_at, featureCount: r.features.length, volumeMm3: r.report.volumeMm3 ?? null })), rowCount: hit.length };
        const names = cols(/^SELECT\s+([\s\S]+?)\s+FROM/.exec(text)[1]);
        return { rows: hit.map((r) => out(r, names)), rowCount: hit.length };
      }
      if (/^DELETE/.test(text)) {
        const keep = rows.filter((r) => !matches(r));
        const removed = rows.length - keep.length;
        tables[table] = keep;
        tables.cad_revision = tables.cad_revision.filter((r) => tables.cad_model.some((m) => m.model_id === r.model_id));
        return { rows: [], rowCount: removed };
      }
      if (/^UPDATE cad_model SET revision = revision \+ 1/.test(text)) {
        const hit = rows.filter(matches);
        hit.forEach((r) => Object.assign(r, { revision: r.revision + 1, state: 'built', report: j(p[2]), feature_status: j(p[3]), failure_reason: null, updated_at: now() }));
        return { rows: hit.map((r) => out(r, cols(returning[1]))), rowCount: hit.length };
      }
      if (/^UPDATE cad_model SET state = 'failed'/.test(text)) {
        const hit = rows.filter(matches);
        hit.forEach((r) => Object.assign(r, { state: 'failed', failure_reason: p[2], updated_at: now() }));
        return { rows: hit.map((r) => out(r, cols(returning[1]))), rowCount: hit.length };
      }
      if (/^UPDATE cad_model SET/.test(text)) {
        const sets = /SET\s+([\s\S]+?)\s+WHERE/.exec(text)[1].split(',').map((s) => s.trim());
        const hit = rows.filter(matches);
        hit.forEach((r) => {
          for (const s of sets) {
            const m = /^(\w+) = \$(\d+)(::jsonb)?$/.exec(s);
            if (m) r[m[1]] = m[3] ? j(p[Number(m[2]) - 1]) : p[Number(m[2]) - 1];
          }
          r.updated_at = new Date(Date.now() + 1).toISOString();
        });
        return { rows: hit.map((r) => out(r, cols(returning[1]))), rowCount: hit.length };
      }
      throw new Error(`fake pool cannot answer: ${text.slice(0, 80)}`);
    },
  };
}

// ── A fake bridge that speaks the wire protocol and answers rebuilds from the request ──
function tinyStl() {
  const b = Buffer.alloc(84 + 50); b.write('fake', 0); b.writeUInt32LE(1, 80);
  return b;
}
function fakeEngine() {
  const seen = [];
  const sockets = new Set();
  const stats = { connections: 0 };
  const server = net.createServer((socket) => {
    stats.connections += 1;
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.setEncoding('utf8');
    socket.write(JSON.stringify({ bridge: { protocol: 1, buildHash: HASH } }) + '\n');
    let tail = '';
    socket.on('data', (chunk) => {
      const parts = (tail + chunk).split('\n'); tail = parts.pop();
      for (const line of parts) {
        if (!line.trim()) continue;
        const req = JSON.parse(line);
        seen.push(req);
        const base = req.args.base;
        if (base.kind === 'sphere') { socket.write(JSON.stringify({ id: req.id, ok: false, error: { code: 'refused', message: 'base.kind must be one of box, …' } }) + '\n'); continue; }
        // A feature the worker is still grinding on: never answered (only a cancel or the wall clock ends it).
        if (req.args.features.some((f) => f.enabled !== false && f.params && f.params.diameter === 777)) continue;
        const size = base.kind === 'box' ? [base.sizeX, base.sizeY, base.sizeZ] : base.kind === 'contours' ? [base.size.x, base.size.y, base.size.z] : [20, 20, 20];
        let volume = size[0] * size[1] * size[2];
        const features = req.args.features.map((f, index) => {
          if (f.enabled === false) return { id: f.id, index, ok: true, skipped: true };
          if (f.params && f.params.diameter === 999) return { id: f.id, index, ok: false, error: 'kernel refused: StdFail_NotDone' };
          if (f.params && f.params.diameter === 555) return { id: f.id, index, ok: false, ms: req.args.featureBudgetMs + 1, code: 'budget_exceeded', error: `took ${req.args.featureBudgetMs + 1} ms, over the ${req.args.featureBudgetMs} ms per-feature budget; its result was discarded` };
          if (f.type === 'hole') volume -= 100;
          return { id: f.id, index, ok: true, ms: 5 };
        });
        const report = { extentsMm: { min: [-size[0] / 2, -size[1] / 2, 0], max: [size[0] / 2, size[1] / 2, size[2]], size }, volumeMm3: volume, surfaceAreaMm2: 100, massG: volume / 1000 * (req.args.densityGcm3 || 1.24), densityGcm3: req.args.densityGcm3, centerOfMassMm: [0, 0, size[2] / 2], faces: 6, edges: 12, vertices: 8, valid: true };
        const exports = req.cmd === 'rebuild' ? { step: `ISO-10303-21;\nHEADER;\nFILE_NAME('cad-studio model','2000-01-01T00:00:00');\nENDSEC;\nDATA;\n/* volume ${volume} */\nENDSEC;\nEND-ISO-10303-21;\n`, stl: tinyStl().toString('base64'), svg: Object.fromEntries((req.args.views || []).map((v) => [v, `<svg xmlns="http://www.w3.org/2000/svg"><text>${v}</text></svg>`])) } : {};
        socket.write(JSON.stringify({ id: req.id, ok: true, result: { report, features, exports, ms: 7 } }) + '\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, seen, sockets, stats, close: () => { for (const s of sockets) s.destroy(); server.close(); } })));
}
const until = async (check) => { for (let i = 0; i < 400 && !check(); i += 1) await new Promise((r) => setTimeout(r, 5)); assert.ok(check(), 'condition not reached within 2 s'); };

// ── The app under test ───────────────────────────────────────────────────────
let currentSub = 'alice';
let server, baseUrl, engine, pool, dataRoot;
test.before(async () => {
  engine = await fakeEngine();
  pool = fakePool();
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-studio-'));
  const app = express();
  app.use((req, _res, next) => { if (currentSub) req.oidc = { user: { sub: currentSub }, isAuthenticated: () => true }; next(); });
  app.use(express.json({ limit: '100mb' }));
  const ctx = { pool, appPackageDir: PKG };
  app.use('/api/cad-studio/home-summary', createHomeSummaryRoutes(ctx));
  app.use('/api/cad-studio', createCadStudioRoutes(ctx, { dataRoot, env: { CAD_STUDIO_ENGINE_ADDR: `127.0.0.1:${engine.port}`, OSHAL_API_CONTAINER: 'oshal-local-api' }, engineBuild: HASH, rebuildTimeoutMs: 5000 }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/cad-studio`;
});
test.after(() => { server.close(); engine.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

async function call(p, init = {}) {
  const res = await fetch(baseUrl + p, init);
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch (_) { body = null; }
  return { status: res.status, body, text, headers: res.headers };
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let modelId;
test('surface, assets and capabilities serve; the caller gate answers 401', async () => {
  const page = await call('/app'); assert.equal(page.status, 200); assert.ok(page.text.includes('<title>CAD Studio</title>'));
  for (const f of ['cad-studio.js', 'cad-studio-gl.js']) { const js = await call('/assets/' + f); assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/); }
  const caps = await call('/capabilities');
  assert.equal(caps.body.contract.features.hole.required.diameter, 'hole diameter, mm');
  assert.match(caps.body.engine.installHint, /docker exec oshal-local-api sh .*cad-studio\/engine\/install-engine\.sh/);
  assert.equal(caps.body.engine.expectedBuildHash, HASH);
  currentSub = null;
  assert.equal((await call('/models')).status, 401);
  currentSub = 'alice';
});

test('a part is created from a box and built: revision 1, artifacts on disk, the engine\'s report', async () => {
  const bad = await call('/models', json('POST', { title: 'x', base: { kind: 'box', sizeX: -1, sizeY: 1, sizeZ: 1 } }));
  assert.equal(bad.status, 400); assert.equal(bad.body.field, 'base.sizeX');
  const res = await call('/models', json('POST', { title: 'bracket', base: { kind: 'box', sizeX: 60, sizeY: 40, sizeZ: 30 } }));
  assert.equal(res.status, 201);
  modelId = res.body.model.model_id;
  assert.equal(res.body.model.revision, 1); assert.equal(res.body.model.state, 'built'); assert.equal(res.body.build.ok, true);
  assert.equal(res.body.model.report.volumeMm3, 72000);
  assert.match(res.body.model.artifacts.step, /\/artifacts\/step\?revision=1$/);
  const stlOnDisk = fs.readdirSync(dataRoot, { recursive: true }).filter((f) => String(f).endsWith('model.stl'));
  assert.equal(stlOnDisk.length, 1);
  const read = await call('/models/' + modelId);
  assert.deepEqual(read.body.revisions.map((r) => r.revision), [1]);
  assert.equal(read.body.revisions[0].volumeMm3, 72000);
  assert.equal(engine.seen[0].cmd, 'rebuild'); assert.deepEqual(engine.seen[0].args.views, ['front', 'top', 'right', 'iso']);
});

test('features: add, refused-with-reason, invalid-with-field, merge update, disable, move, remove, restore', async () => {
  const add = await call(`/models/${modelId}/features`, json('POST', { type: 'hole', params: { diameter: 6, x: 10 }, label: 'mount' }));
  assert.equal(add.status, 200); assert.equal(add.body.model.revision, 2); assert.equal(add.body.model.report.volumeMm3, 71900);
  const holeId = add.body.feature.id;
  assert.equal(add.body.model.feature_status[0].ok, true);
  const refused = await call(`/models/${modelId}/features`, json('POST', { type: 'hole', params: { diameter: 999 } }));
  assert.equal(refused.status, 200); assert.equal(refused.body.model.revision, 3);
  const refusedStatus = refused.body.model.feature_status.find((s) => s.id === refused.body.feature.id);
  assert.equal(refusedStatus.ok, false); assert.match(refusedStatus.error, /kernel refused/);
  const invalid = await call(`/models/${modelId}/features`, json('POST', { type: 'fillet', params: { radius: 2, edges: 'inner' } }));
  assert.equal(invalid.status, 400); assert.equal(invalid.body.field, 'fillet.params.edges');
  const toolShaped = await call(`/models/${modelId}/features`, json('POST', { modelId, type: 'fillet', params: { radius: 2, edges: 'vertical' } }));
  assert.equal(toolShaped.status, 200); assert.equal(toolShaped.body.feature.type, 'fillet');
  const upd = await call(`/models/${modelId}/features/${holeId}`, json('PATCH', { params: { diameter: 8 } }));
  assert.equal(upd.status, 200); assert.deepEqual(upd.body.feature.params, { diameter: 8, x: 10 }); assert.equal(upd.body.model.revision, 5);
  const off = await call(`/models/${modelId}/features/${holeId}`, json('PATCH', { enabled: false }));
  assert.equal(off.body.model.report.volumeMm3, 72000, 'a disabled hole removes nothing');
  assert.equal(off.body.model.feature_status[0].skipped, true);
  const moved = await call(`/models/${modelId}/features/${holeId}/move`, json('POST', { to: 2 }));
  assert.equal(moved.body.model.features[2].id, holeId);
  assert.equal((await call(`/models/${modelId}/features/nope`, json('PATCH', { enabled: true }))).status, 404);
  const gone = await call(`/models/${modelId}/features/${refused.body.feature.id}`, { method: 'DELETE' });
  assert.equal(gone.status, 200); assert.equal(gone.body.model.features.length, 2);
  const restored = await call(`/models/${modelId}/restore`, json('POST', { revision: 2 }));
  assert.equal(restored.status, 200); assert.deepEqual(restored.body.model.features.map((f) => f.type), ['hole']); assert.equal(restored.body.restoredFrom, 2);
  assert.equal(restored.body.model.features[0].enabled, true);
  assert.equal((await call(`/models/${modelId}/restore`, json('POST', { revision: 99 }))).status, 404);
});

test('owner scoping: a second subject sees nothing; artifacts download by key and revision', async () => {
  currentSub = 'bob';
  assert.equal((await call('/models/' + modelId)).status, 404);
  assert.deepEqual((await call('/models')).body.models, []);
  currentSub = 'alice';
  const step = await call(`/models/${modelId}/artifacts/step`);
  assert.equal(step.status, 200); assert.match(step.headers.get('content-type'), /step/); assert.ok(step.text.startsWith('ISO-10303-21'));
  const old = await call(`/models/${modelId}/artifacts/step?revision=1&download`);
  assert.ok(old.text.includes('volume 72000')); assert.match(old.headers.get('content-disposition'), /bracket-r1\.step/);
  assert.equal((await call(`/models/${modelId}/artifacts/svg-iso`)).status, 200);
  assert.equal((await call(`/models/${modelId}/artifacts/gcode`)).status, 404);
  assert.equal((await call(`/models/${modelId}/artifacts/step?revision=999`)).status, 404);
});

test('a mesh base upload is stored as a file reference and reaches the engine as base64', async () => {
  const stl = tinyStl();
  const form = new FormData(); form.append('stl', new Blob([stl], { type: 'model/stl' }), 'part.stl');
  const res = await call(`/models/${modelId}/base/mesh`, { method: 'POST', body: form });
  assert.equal(res.status, 200); assert.equal(res.body.model.base.kind, 'mesh'); assert.equal(res.body.model.base.bytes, stl.length); assert.equal(res.body.model.base.stl, undefined);
  assert.equal(pool.tables.cad_model[0].base.file, 'base.stl');
  const last = engine.seen[engine.seen.length - 1];
  assert.equal(last.args.base.kind, 'mesh'); assert.equal(Buffer.from(last.args.base.stl, 'base64').length, stl.length);
  const contours = await call('/models', json('POST', { title: 'scan', base: { kind: 'contours', views: { front: [[-30, 0], [30, 0], [30, 30]] }, size: { x: 60, y: 40, z: 30 } }, source: { kind: 'scan', jobId: 'j1' } }));
  assert.equal(contours.status, 201); assert.deepEqual(engine.seen[engine.seen.length - 1].args.base.views.front.length, 3);
  const refusedBase = await call('/models', json('POST', { title: 'nope', base: { kind: 'box', sizeX: 1, sizeY: 1, sizeZ: 1 } }));
  assert.equal(refusedBase.status, 201);
  pool.tables.cad_model.find((m) => m.title === 'nope').base = { kind: 'sphere' };
  const rebuilt = await call(`/models/${refusedBase.body.model.model_id}/rebuild`, { method: 'POST' });
  assert.equal(rebuilt.status, 422); assert.equal(rebuilt.body.build.code, 'refused'); assert.equal(rebuilt.body.model.state, 'failed');
});

test('the per-feature budget is a validated setting that reaches the worker, and its refusal is stored per feature', async () => {
  assert.equal(engine.seen[0].args.featureBudgetMs, 60000, 'the default budget goes with every rebuild');
  const bad = await call(`/models/${modelId}`, json('PATCH', { settings: { featureBudgetMs: 0 } }));
  assert.equal(bad.status, 400); assert.equal(bad.body.field, 'settings.featureBudgetMs');
  const set = await call(`/models/${modelId}`, json('PATCH', { settings: { featureBudgetMs: 5000 } }));
  assert.equal(set.status, 200); assert.equal(engine.seen.at(-1).args.featureBudgetMs, 5000);
  const slow = await call(`/models/${modelId}/features`, json('POST', { type: 'hole', params: { diameter: 555 } }));
  assert.equal(slow.status, 200);
  const status = slow.body.model.feature_status.find((s) => s.id === slow.body.feature.id);
  assert.equal(status.ok, false); assert.equal(status.code, 'budget_exceeded'); assert.match(status.error, /over the 5000 ms per-feature budget/);
  assert.equal((await call(`/models/${modelId}/features/${slow.body.feature.id}`, { method: 'DELETE' })).status, 200);
});

test('cancel stops a running rebuild: the connection closes, the part stays at its last good revision, the next rebuild reconnects', async () => {
  const good = (await call(`/models/${modelId}`)).body.model;
  const idle = await call(`/models/${modelId}/cancel`, { method: 'POST' });
  assert.equal(idle.status, 200); assert.equal(idle.body.cancelled, false); assert.equal(idle.body.stage, null);
  assert.equal(idle.body.lastGoodRevision, good.revision); assert.equal(idle.body.model.state, 'built');
  const seenBefore = engine.seen.length, connectionsBefore = engine.stats.connections;
  const pending = call(`/models/${modelId}/features`, json('POST', { type: 'hole', params: { diameter: 777 } }));
  await until(() => engine.seen.length > seenBefore);
  currentSub = 'bob';
  assert.equal((await call(`/models/${modelId}/cancel`, { method: 'POST' })).status, 404, 'another subject cannot reach, let alone cancel, the rebuild');
  currentSub = 'alice';
  const cancel = await call(`/models/${modelId}/cancel`, { method: 'POST' });
  assert.equal(cancel.status, 200); assert.equal(cancel.body.cancelled, true); assert.equal(cancel.body.stage, 'inflight');
  assert.equal(cancel.body.lastGoodRevision, good.revision);
  assert.equal(cancel.body.model.state, 'failed'); assert.match(cancel.body.model.failure_reason, /^cancelled: rebuild cancelled \(cancelled by the owner\)/);
  const answered = await pending;
  assert.equal(answered.status, 409); assert.equal(answered.body.build.code, 'cancelled');
  assert.equal(answered.body.model.revision, good.revision, 'no revision was recorded for the cancelled rebuild');
  await until(() => engine.sockets.size === 0);
  assert.equal((await call(`/models/${modelId}/artifacts/stl?revision=${good.revision}`)).status, 200, 'the last good revision still serves');
  const removed = await call(`/models/${modelId}/features/${answered.body.feature.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200); assert.equal(removed.body.build.ok, true); assert.equal(removed.body.model.revision, good.revision + 1);
  assert.equal(removed.body.model.state, 'built');
  assert.equal(engine.stats.connections, connectionsBefore + 1, 'the rebuild after the cancel opened a fresh connection');
});

test('the Home summary reads metadata only', async () => {
  const home = await call('/home-summary');
  assert.equal(home.status, 200);
  assert.equal(home.body.metrics.find((m) => m.id === 'models-total').value, '3');
  assert.ok(home.body.items.some((i) => i.text === 'bracket'));
});

test('deleting a part removes its rows and files', async () => {
  const before = fs.readdirSync(dataRoot, { recursive: true }).filter((f) => String(f).endsWith('model.step')).length;
  assert.equal((await call('/models/' + modelId, { method: 'DELETE' })).status, 200);
  assert.equal((await call('/models/' + modelId)).status, 404);
  assert.ok(fs.readdirSync(dataRoot, { recursive: true }).filter((f) => String(f).endsWith('model.step')).length < before);
  assert.equal(pool.tables.cad_revision.some((r) => r.model_id === modelId), false);
});

test('with the bridge gone, a rebuild answers 503 naming the install command and the last revision still serves', async () => {
  const model = (await call('/models')).body.models.find((m) => m.title === 'scan');
  engine.close();
  await new Promise((r) => setTimeout(r, 50));
  const res = await call(`/models/${model.model_id}/rebuild`, { method: 'POST' });
  assert.equal(res.status, 503); assert.equal(res.body.build.code, 'capability_unavailable');
  assert.match(res.body.build.reason, /install-engine\.sh/);
  assert.equal(res.body.model.state, 'failed'); assert.equal(res.body.model.revision, 1);
  assert.equal((await call(`/models/${model.model_id}/artifacts/stl`)).status, 200);
  const caps = await call('/capabilities');
  assert.equal(caps.body.engine.connected, false); assert.match(caps.body.engine.lastError, /not running/);
});
