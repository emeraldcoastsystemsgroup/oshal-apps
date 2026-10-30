/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The person and the concierge edit the same part in turn: the actual CAD page and the shared document-handoff module over the compiled routes, a disposable PostgreSQL database built from the package migration, and the real engine client talking to a loopback bridge that speaks the wire protocol (the OCCT kernel is the engine-kernel case). An unsaved feature form and an unsaved density are saved by the handoff, the concierge's route edit is drawn by refresh, and a density the person is still typing survives that refresh. The database connection is the fixture superuser, so owner RLS is not the boundary proven here.
 */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
const PLATFORM = process.env.OSHAL_PLATFORM_ROOT;
const DSN = process.env.OSHAL_TEST_POSTGRES;
assert.ok(CORE && fs.existsSync(path.join(CORE, 'node_modules', 'express')), 'Set OSHAL_CORE_ROOT to a framework checkout with node_modules');
assert.ok(PLATFORM && fs.existsSync(path.join(PLATFORM, 'src/shared/ui/js/document-handoff.js')), 'Set OSHAL_PLATFORM_ROOT to the kernel platform tree that ships the shared document handoff');
assert.ok(DSN, 'Set OSHAL_TEST_POSTGRES to the disposable PostgreSQL fixture');
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreRequire = createRequire(path.join(CORE, 'package.json'));
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request) && String(parent?.filename || '').startsWith(PKG + path.sep)) {
    return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};
coreRequire('tsx/cjs');
const express = coreRequire('express');
const { Client, Pool } = coreRequire('pg');
const { launchIsolatedBrowser } = coreRequire(path.join(CORE, 'tests/fixtures/isolated-browser.ts'));
const { createCadStudioRoutes } = createRequire(import.meta.url)(path.join(PKG, 'routes', 'cad-studio-routes.js'));
const HASH = 'e'.repeat(64);

/** A loopback bridge speaking the engine wire protocol: every rebuild answers a box report with a one-facet STL. */
function fakeEngine() {
  const sockets = new Set();
  const stl = Buffer.alloc(134); stl.writeUInt32LE(1, 80);
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.setEncoding('utf8');
    socket.write(JSON.stringify({ bridge: { protocol: 1, buildHash: HASH } }) + '\n');
    let tail = '';
    socket.on('data', (chunk) => {
      const parts = (tail + chunk).split('\n'); tail = parts.pop();
      for (const line of parts.filter((l) => l.trim())) {
        const req = JSON.parse(line), b = req.args.base, size = [b.sizeX, b.sizeY, b.sizeZ];
        const report = { extentsMm: { size }, volumeMm3: size[0] * size[1] * size[2], surfaceAreaMm2: 100, massG: 1, densityGcm3: req.args.densityGcm3, centerOfMassMm: [0, 0, 0], faces: 6, edges: 12, vertices: 8, valid: true };
        const features = req.args.features.map((f, index) => ({ id: f.id, index, ok: true, ms: 1 }));
        const exports = { step: 'ISO-10303-21;\nEND-ISO-10303-21;\n', stl: stl.toString('base64'), svg: Object.fromEntries((req.args.views || []).map((v) => [v, '<svg xmlns="http://www.w3.org/2000/svg"/>'])) };
        socket.write(JSON.stringify({ id: req.id, ok: true, result: { report, features, exports, ms: 1 } }) + '\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => { sockets.forEach((s) => s.destroy()); server.close(); } })));
}

let owned, admin, pool, database, engine, server, origin, dataRoot, context, page;
before(async () => {
  admin = new Client({ connectionString: DSN }); await admin.connect();
  database = 'cad_handoff_' + randomUUID().replace(/-/g, '').slice(0, 16);
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(DSN); url.pathname = '/' + database;
  pool = new Pool({ connectionString: url.toString(), max: 4 });
  await pool.query(fs.readFileSync(path.join(PKG, 'migrations', '001-cad-studio.sql'), 'utf8'));
  engine = await fakeEngine();
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-handoff-'));
  const app = express();
  app.use((req, _res, next) => { req.oidc = { user: { sub: 'handoff-owner' }, isAuthenticated: () => true }; next(); });
  app.use(express.json({ limit: '10mb' }));
  app.use('/shared/ui', express.static(path.join(PLATFORM, 'src/shared/ui')));
  app.use('/api/cad-studio', createCadStudioRoutes({ pool, appPackageDir: PKG }, { dataRoot, env: { CAD_STUDIO_ENGINE_ADDR: `127.0.0.1:${engine.port}` }, engineBuild: HASH, rebuildTimeoutMs: 10000 }));
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  owned = await launchIsolatedBrowser({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}, { timeout: 120000 });
after(async () => {
  await owned?.close();
  server?.closeAllConnections(); await new Promise((resolve) => server ? server.close(resolve) : resolve());
  engine?.close(); await pool?.end();
  if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); await admin.end(); }
  if (dataRoot) fs.rmSync(dataRoot, { recursive: true, force: true });
}, { timeout: 60000 });

async function call(method, suffix, body) {
  const res = await fetch(origin + '/api/cad-studio' + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json(); assert.ok(res.ok, `${method} ${suffix}: ${res.status} ${JSON.stringify(json)}`); return json;
}
const read = async (id) => (await call('GET', '/models/' + id)).model;
async function begin() {
  return page.evaluate(async () => { const api = await import('/shared/ui/js/document-handoff.js'); window.documentHandoff = await api.beginDocumentHandoff(); return window.documentHandoff.context; });
}
const refresh = () => page.evaluate(() => window.documentHandoff.refresh());

let id;
beforeEach(async () => {
  id = (await call('POST', '/models', { title: 'Handoff bracket ' + randomUUID().slice(0, 6), base: { kind: 'box', sizeX: 60, sizeY: 40, sizeZ: 30 } })).model.model_id;
  context = await owned.browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  page = await context.newPage();
  // The 3 s poll is parked so that only refresh() can draw the concierge's change.
  await page.addInitScript(() => { const original = window.setInterval; window.setInterval = (fn, delay, ...rest) => original(fn, delay === 3000 ? 3600000 : delay, ...rest); });
  await page.goto(`${origin}/api/cad-studio/app?model=${id}`);
  await page.waitForFunction(() => /revision 1/.test(document.querySelector('#model-state').textContent) && window.__oshalDocumentSession);
});
afterEach(async () => { await context?.close(); });

test('an unsaved feature and density are saved before reading, and the concierge edit is drawn on refresh', { timeout: 120000 }, async () => {
  await page.locator('#feature-type').selectOption('hole');
  await page.locator('[data-param="diameter"]').fill('6');
  const first = await begin();
  assert.equal(first.recordId, id); assert.equal(first.app, 'cad-studio'); assert.equal(first.fields.revision, 2);
  const saved = await read(id);
  assert.equal(saved.revision, 2); assert.equal(saved.features.length, 1); assert.equal(saved.features[0].params.diameter, 6);
  assert.equal(await page.locator('[data-param="diameter"]').inputValue(), '', 'the saved feature left the form');

  await call('PATCH', `/models/${id}/features/${saved.features[0].id}`, { params: { diameter: 8 } });
  await refresh();
  assert.match(await page.locator('#feature-list').innerText(), /diameter 8/);
  assert.match(await page.locator('#model-state').innerText(), /revision 3/);

  await page.locator('#density').fill('2.5');
  const second = await begin();
  assert.equal(second.recordId, id); assert.equal(second.fields.revision, 4);
  const after = await read(id);
  assert.equal(after.settings.densityGcm3, 2.5); assert.equal(after.features[0].params.diameter, 8);
});

test('a density the person is still typing survives refresh, and a refused save keeps the feature draft', { timeout: 120000 }, async () => {
  await page.locator('#density').fill('3.3');
  await call('POST', `/models/${id}/features`, { type: 'hole', params: { diameter: 5 } });
  await page.evaluate(async () => { const api = await import('/shared/ui/js/document-handoff.js'); await api.refreshOpenDocument({ app: 'cad-studio' }); });
  assert.match(await page.locator('#feature-list').innerText(), /diameter 5/);
  assert.equal(await page.locator('#density').inputValue(), '3.3');
  assert.match(await page.locator('#toast').innerText(), /unsaved density is kept/);
  assert.equal((await read(id)).settings.densityGcm3, undefined, 'nothing saved the draft behind the person');

  await page.locator('#density').fill(String((await read(id)).settings.densityGcm3 ?? 1.24));
  await page.locator('#feature-type').selectOption('hole');
  await page.locator('[data-param="diameter"]').fill('-4');
  await assert.rejects(begin(), /could not be saved/);
  assert.equal(await page.locator('[data-param="diameter"]').inputValue(), '-4');
  assert.equal((await read(id)).revision, 2, 'the refused feature did not reach the part');
});
