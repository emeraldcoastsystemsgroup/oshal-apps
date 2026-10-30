/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The person and the concierge edit the same project file in turn: the actual Scene Studio page and the shared document-handoff module over the compiled routes, with the package's shared fixture (the owner-keyed in-memory pool and the fake engine bridge that speaks the wire protocol, tests/scene.fixture.cjs). An unsaved file edit is saved by the handoff, the concierge's PUT /files is drawn by refresh, text the person is still editing survives refresh, and a refused save keeps the editor. The project store's SQL and RLS are the store-postgres case, not proven here.
 *
 * FRAMEWORK-COUPLED: needs a core checkout (OSHAL_CORE_ROOT) for express, multer, tsx and the isolated browser,
 * and the kernel platform tree (OSHAL_PLATFORM_ROOT) for the shared document handoff.
 */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
const PLATFORM = process.env.OSHAL_PLATFORM_ROOT;
assert.ok(CORE && fs.existsSync(path.join(CORE, 'node_modules', 'express')), 'Set OSHAL_CORE_ROOT to a framework checkout with node_modules');
assert.ok(PLATFORM && fs.existsSync(path.join(PLATFORM, 'src/shared/ui/js/document-handoff.js')), 'Set OSHAL_PLATFORM_ROOT to the kernel platform tree that ships the shared document handoff');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const coreRequire = createRequire(path.join(CORE, 'package.json'));
const require = createRequire(import.meta.url);
const STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (body) => Boolean(body && typeof body === 'object' && body.confirm === true),
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true. No write was attempted.` }),
  },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (STUBS[request]) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
  if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request) && String(parent?.filename || '').startsWith(PKG + path.sep)) {
    return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};
coreRequire('tsx/cjs');
const express = coreRequire('express');
const { launchIsolatedBrowser } = coreRequire(path.join(CORE, 'tests/fixtures/isolated-browser.ts'));
const { createSceneStudioRoutes } = require(path.join(PKG, 'routes', 'scene-studio-routes.js'));
const { HASH, fakePool, fakeEngine } = require('./scene.fixture.cjs');

let owned, engine, server, origin, dataRoot, context, page;
before(async () => {
  engine = await fakeEngine({ fn: () => ({ text: 'ok', isError: false, changed: false, delta: { added: [], modified: [], deleted: [] } }) });
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-handoff-'));
  const app = express();
  app.use((req, _res, next) => { req.oidc = { user: { sub: 'handoff-owner' }, isAuthenticated: () => true }; next(); });
  app.use(express.json({ limit: '1mb' }));
  app.use('/shared/ui', express.static(path.join(PLATFORM, 'src/shared/ui')));
  app.use('/api/scene-studio', createSceneStudioRoutes({ pool: fakePool(), appPackageDir: PKG }, { dataRoot, env: { SCENE_STUDIO_ENGINE_ADDR: `127.0.0.1:${engine.port}` }, engineBuild: HASH }));
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  owned = await launchIsolatedBrowser();
}, { timeout: 120000 });
after(async () => {
  await owned?.close();
  server?.closeAllConnections(); await new Promise((resolve) => server ? server.close(resolve) : resolve());
  engine?.close();
  if (dataRoot) fs.rmSync(dataRoot, { recursive: true, force: true });
}, { timeout: 60000 });

async function call(method, suffix, body) {
  const res = await fetch(origin + '/api/scene-studio' + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json(); assert.ok(res.ok, `${method} ${suffix}: ${res.status} ${JSON.stringify(json)}`); return json;
}
const fileText = async (id, p) => (await call('POST', `/projects/${id}/files/read`, { path: p })).text;
const revision = async (id) => (await call('GET', '/projects/' + id)).project.revision;
async function begin() {
  return page.evaluate(async () => { const api = await import('/shared/ui/js/document-handoff.js'); window.documentHandoff = await api.beginDocumentHandoff(); return window.documentHandoff.context; });
}

let id;
beforeEach(async () => {
  id = (await call('POST', '/projects', { kind: 'godot', title: 'Handoff game ' + randomUUID().slice(0, 6), template: '3d' })).project.projectId;
  context = await owned.browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  page = await context.newPage();
  // The project and list polls are parked so that only refresh() can draw the concierge's change.
  await page.addInitScript(() => { const original = window.setInterval; window.setInterval = (fn, delay, ...rest) => original(fn, delay >= 4000 ? 3600000 : delay, ...rest); });
  await page.goto(`${origin}/api/scene-studio/app?project=${id}`);
  await page.waitForFunction(() => window.__oshalDocumentSession && /revision \d/.test(document.querySelector('#project-rev').textContent));
  await page.locator('#file-list .path', { hasText: 'main.tscn' }).click();
  await page.waitForFunction(() => document.querySelector('#file-text').value.includes('gd_scene'));
});
afterEach(async () => { await context?.close(); });

test('an unsaved file edit is saved before reading, and the concierge edit is drawn on refresh', { timeout: 120000 }, async () => {
  const start = await revision(id);
  await page.locator('#file-text').fill('[gd_scene format=3]\n[node name="Manual" type="Node3D"]\n');
  const first = await begin();
  assert.equal(first.recordId, id); assert.equal(first.app, 'scene-studio'); assert.equal(first.fields.revision, start + 1); assert.equal(first.fields.openFile, 'main.tscn');
  assert.match(await fileText(id, 'main.tscn'), /name="Manual"/);

  await call('PUT', `/projects/${id}/files`, { path: 'main.tscn', text: '[gd_scene format=3]\n[node name="Concierge" type="Node3D"]\n' });
  await page.evaluate(() => window.documentHandoff.refresh());
  assert.match(await page.locator('#file-text').inputValue(), /name="Concierge"/);
  assert.equal(await page.locator('#project-rev').innerText(), 'revision ' + (start + 2));

  await page.locator('#file-text').fill('[gd_scene format=3]\n[node name="Next" type="Node3D"]\n');
  const second = await begin();
  assert.equal(second.recordId, id); assert.equal(second.fields.revision, start + 3);
  assert.match(await fileText(id, 'main.tscn'), /name="Next"/);
});

test('text the person is still editing survives refresh, and a refused save keeps the editor', { timeout: 120000 }, async () => {
  const start = await revision(id);
  await page.locator('#file-text').fill('my unsaved scene');
  await call('PUT', `/projects/${id}/files`, { path: 'main.tscn', text: 'concierge scene' });
  await page.evaluate(async () => { const api = await import('/shared/ui/js/document-handoff.js'); await api.refreshOpenDocument({ app: 'scene-studio' }); });
  assert.equal(await page.locator('#file-text').inputValue(), 'my unsaved scene');
  assert.equal(await page.locator('#project-rev').innerText(), 'revision ' + (start + 1));
  assert.match(await page.locator('#status').innerText(), /unsaved edit to main\.tscn is kept/);
  assert.equal(await fileText(id, 'main.tscn'), 'concierge scene', 'nothing saved the draft behind the person');

  await page.locator('#file-path').fill('../outside.gd');
  await assert.rejects(begin(), /could not be saved/);
  assert.equal(await page.locator('#file-text').inputValue(), 'my unsaved scene');
  assert.equal(await revision(id), start + 1, 'the refused path wrote nothing');
});
