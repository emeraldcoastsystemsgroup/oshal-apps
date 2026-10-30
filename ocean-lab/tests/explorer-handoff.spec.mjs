/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The person and the concierge edit the same Explorer in turn: the shipped tile and the
 *                     |                             | shared document-handoff module in a real headless browser over the COMPILED routes, on the
 *                     |                             | package's store double (tests/vehicle-pool-double.ts, as the explorer-surface case). An
 *                     |                             | unsaved stop angle is saved through PATCH /design by the handoff, the concierge's PATCH is
 *                     |                             | drawn by refresh, a field the person is still editing survives refresh, and a refused
 *                     |                             | vector keeps the field. The store's SQL and RLS are the vehicle-rls case, not proven here.
 *                     |                             | FRAMEWORK-COUPLED: OSHAL_CORE_ROOT (express, tsx, the isolated browser) and
 *                     |                             | OSHAL_PLATFORM_ROOT (the shared document handoff). Run:
 *                     |                             |   node --test tests/explorer-handoff.spec.mjs
 */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
const PLATFORM = process.env.OSHAL_PLATFORM_ROOT;
assert.ok(CORE && fs.existsSync(path.join(CORE, 'node_modules', 'express')), 'OSHAL_CORE_ROOT or OSHAL_CORE_DIR must name a framework checkout with node_modules');
assert.ok(PLATFORM && fs.existsSync(path.join(PLATFORM, 'src/shared/ui/js/document-handoff.js')), 'OSHAL_PLATFORM_ROOT must name the kernel platform tree that ships the shared document handoff');
const coreRequire = createRequire(path.join(CORE, 'package.json'));
const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, request, parent, isMain);
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, parent, ...rest) {
  try { return originalResolve.call(this, request, parent, ...rest); } catch (error) {
    if (!/^[a-z@]/.test(request) || !parent?.filename?.startsWith(PKG)) throw error;
    return coreRequire.resolve(request);
  }
};
coreRequire('tsx/cjs');
const express = coreRequire('express');
const { launchIsolatedBrowser } = coreRequire(path.join(CORE, 'tests', 'fixtures', 'isolated-browser.ts'));
const { createOceanLabRoutes } = require(path.join(PKG, 'routes', 'ocean-lab-routes.js'));
const { VehiclePoolDouble } = require(path.join(HERE, 'vehicle-pool-double.ts'));

let owned; let server; let origin; let context; let page;
before(async () => {
  const app = express();
  app.use('/shared/ui', express.static(path.join(PLATFORM, 'src', 'shared', 'ui')));
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.oidc = { isAuthenticated: () => true, user: { sub: 'handoff-owner' } }; next(); });
  app.use('/api/ocean-lab', createOceanLabRoutes({ appPackageDir: PKG, pool: new VehiclePoolDouble() }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  owned = await launchIsolatedBrowser();
}, { timeout: 120000 });
after(async () => {
  await owned?.close();
  server?.closeAllConnections(); await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
}, { timeout: 60000 });

async function call(method, suffix, body) {
  const res = await fetch(`${origin}/api/ocean-lab/vehicles${suffix}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); assert.ok(res.ok, `${method} ${suffix}: ${res.status} ${text}`); return text ? JSON.parse(text) : null;
}
const vehicleId = async () => (await call('GET', '')).vehicles.find((v) => v.vehicle.kind === 'wave-explorer').vehicle.vehicleId;
const read = async () => (await call('GET', '/' + await vehicleId())).vehicle;
/** The concierge's edit: the same PATCH /design the tile uses, with a new tether length. */
async function conciergeTether(lengthM) {
  const v = await read(); v.designVector.tether.lengthM = lengthM;
  await call('PATCH', `/${v.vehicleId}/design`, { designVector: v.designVector });
}
async function begin() {
  return page.evaluate(async () => { const api = await import('/shared/ui/js/document-handoff.js'); window.documentHandoff = await api.beginDocumentHandoff(); return window.documentHandoff.context; });
}
const settled = (pattern) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('status').textContent), pattern.source, { timeout: 20000 });

beforeEach(async () => {
  context = await owned.browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()));
  page = await context.newPage();
  await page.goto(`${origin}/api/ocean-lab/explorer`);
  await page.waitForFunction(() => window.__oshalDocumentSession && /Record loaded|No explorer/.test(document.getElementById('status').textContent), null, { timeout: 20000 });
  if (await page.locator('#no-vehicle').isVisible()) {
    await page.click('#create-explorer'); await settled(/created at concept/);
  }
});
afterEach(async () => { await context?.close(); });

test('an unsaved stop angle is saved before reading, and the concierge edit is drawn on refresh', { timeout: 120000 }, async () => {
  await page.fill('#stop-angle', '25');
  const first = await begin();
  const saved = await read();
  assert.equal(first.recordId, saved.vehicleId); assert.equal(first.app, 'ocean-lab');
  assert.equal(first.fields.revision, saved.updatedAt); assert.equal(saved.designVector.wings.stopAngleDeg, 25);

  await conciergeTether(6);
  await page.evaluate(() => window.documentHandoff.refresh());
  assert.equal(await page.inputValue('#tether-length'), '6');
  assert.match(await page.locator('#vector-table').innerText(), /tether\.lengthM\s+6 m/);

  await page.fill('#stop-angle', '30');
  const second = await begin();
  const after = await read();
  assert.equal(second.recordId, after.vehicleId); assert.equal(second.fields.revision, after.updatedAt);
  assert.notEqual(second.fields.revision, first.fields.revision);
  assert.equal(after.designVector.wings.stopAngleDeg, 30); assert.equal(after.designVector.tether.lengthM, 6);
});

test('a field the person is still editing survives refresh, and a refused vector keeps the field', { timeout: 120000 }, async () => {
  const stored = (await read()).designVector.wings.stopAngleDeg;
  await page.fill('#stop-angle', String(stored === 33 ? 34 : 33));
  const typed = await page.inputValue('#stop-angle');
  await conciergeTether(7);
  await page.evaluate(async () => { const api = await import('/shared/ui/js/document-handoff.js'); await api.refreshOpenDocument({ app: 'ocean-lab' }); });
  assert.equal(await page.inputValue('#tether-length'), '7');
  assert.equal(await page.inputValue('#stop-angle'), typed);
  assert.match(await page.locator('#status').innerText(), /unsaved stop-angle is kept/);
  assert.equal((await read()).designVector.wings.stopAngleDeg, stored, 'nothing saved the draft behind the person');

  await page.fill('#stop-angle', '60');
  await assert.rejects(begin(), /could not be saved/);
  assert.equal(await page.inputValue('#stop-angle'), '60');
  assert.equal((await read()).designVector.wings.stopAngleDeg, stored, 'the refused vector did not reach the record');
});
