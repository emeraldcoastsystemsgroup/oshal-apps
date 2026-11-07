/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The first screen and the action gating of the actual Scene Studio page, driven in Chromium over the compiled routes with the package's shared fixture (owner-keyed in-memory pool and the fake wire-protocol engine bridge, tests/scene.fixture.cjs). Before a project is open, and again once it is closed, nothing that needs one is enabled and nothing is posted to /projects/null; New offers the three types and creates an untitled project that renders its first preview at once; with projects the first screen is their list, newest first, with one New at the bottom right; an open project has Render preview as its one primary, the scene tree is 240px with one line per node, keyframes sit in Properties, the Script & build tab holds the source editor and the engine tools, and on a phone Revision history and Help are in More with nothing fixed over the work. UX audit 2026-11-06 (scene-studio--scene-studio, FIX-BROKEN + FIX-LAYOUT + SPLIT).
 * 2   | maintainer@emeraldcoastsystemsgroup.com | + New carries data-ef-floating, so the shell orb rests above it on a phone.
 * 3   | maintainer@emeraldcoastsystemsgroup.com | 0.4.2 (Roger F13): a concierge turn begun with no project open, through the shared document handoff the concierge uses, opens the one project the turn made; two made are listed and none is opened.
 *
 * Runs with the store toolchain (express, multer, Playwright's Chromium: STORE_CI_TOOLCHAIN or scripts/toolchain) and the
 * kernel platform tree for the shared editor (OSHAL_PLATFORM_ROOT). No model, no real engine, no database server.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const REPO = path.resolve(PKG, '..');
const PLATFORM = process.env.OSHAL_PLATFORM_ROOT;
assert.ok(PLATFORM && fs.existsSync(path.join(PLATFORM, 'src/shared/ui/js/editor-foundation.js')), 'Set OSHAL_PLATFORM_ROOT to the kernel platform tree that ships the shared editor');
const toolchain = createRequire(path.join(process.env.STORE_CI_TOOLCHAIN || path.join(REPO, 'scripts/toolchain'), 'package.json'));
const express = toolchain('express');
const { chromium } = toolchain('playwright');
const require = createRequire(import.meta.url);
const STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (body) => Boolean(body && body.confirm === true),
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true.` }),
  },
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (STUBS[request]) return STUBS[request];
  if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request) && String(parent?.filename || '').startsWith(PKG + path.sep)) {
    return originalLoad.call(this, toolchain.resolve(request), parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { createSceneStudioRoutes } = require(path.join(PKG, 'routes', 'scene-studio-routes.js'));
Module._load = originalLoad;
const { HASH, fakePool, fakeEngine } = require('./scene.fixture.cjs');

const SHOTS = process.env.SCENE_REVIEW_SCREENSHOT_DIR;
let engine, browser, dataRoot;
const servers = [];

before(async () => {
  engine = await fakeEngine({ fn: () => ({ text: 'ok', isError: false, changed: false, delta: { added: [], modified: [], deleted: [] } }) });
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-first-screen-'));
  browser = await chromium.launch({ headless: true });
}, { timeout: 120000 });

after(async () => {
  await browser?.close();
  for (const server of servers) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  engine?.close();
  if (dataRoot) fs.rmSync(dataRoot, { recursive: true, force: true });
}, { timeout: 60000 });

/** One studio over a fresh in-memory pool; `requests` records every package call the page makes. */
async function studio() {
  const requests = [];
  const app = express();
  app.use((req, _res, next) => { req.oidc = { user: { sub: 'first-screen-owner' }, isAuthenticated: () => true }; next(); });
  app.use('/api/scene-studio', (req, _res, next) => { requests.push({ method: req.method, path: req.path, body: null }); next(); });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/scene-studio', (req, _res, next) => { requests.at(-1).body = req.body; next(); });
  app.use('/shared/ui', express.static(path.join(PLATFORM, 'src/shared/ui')));
  app.use('/cockpit/css/themes', express.static(path.join(PLATFORM, 'src/pages/cockpit/css/themes')));
  app.use('/api/scene-studio', createSceneStudioRoutes({ pool: fakePool(), appPackageDir: PKG }, { dataRoot, env: { SCENE_STUDIO_ENGINE_ADDR: `127.0.0.1:${engine.port}` }, engineBuild: HASH }));
  const server = app.listen(0, '127.0.0.1'); servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, suffix, body) => {
    const res = await fetch(origin + '/api/scene-studio' + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return res.json();
  };
  return { origin, requests, call };
}

/** A page in the light-blue theme at one size; the polls are parked so only the test's actions change the page. */
async function open(origin, { width = 1440, height = 900, phone = false, query = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    try { localStorage.setItem('cockpit-theme', 'light-blue'); } catch { /* storage is optional */ }
    const original = window.setInterval; window.setInterval = (fn, delay, ...rest) => original(fn, delay >= 4000 ? 3600000 : delay, ...rest);
  });
  if (SHOTS) {
    const art = reviewArt();
    await page.route('**/preview.png*', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: art.png }));
    await page.route('**/preview.stl*', (route) => route.fulfill({ status: 200, contentType: 'model/stl', body: art.stl }));
  }
  await page.goto(`${origin}/api/scene-studio/app${query}`);
  await page.locator('.ef-shell').waitFor();
  await page.waitForFunction(() => document.getElementById('engine-pill').textContent === 'engine: live');
  return { page, context, errors };
}

/** Review art for screenshots only: the fake engine's preview bytes are a PNG header and a placeholder STL, which no browser can draw. */
function reviewArt() {
  const w = 480, h = 270, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, ground = y > h * 0.62; raw[o] = ground ? 92 : 150 + y / 3; raw[o + 1] = ground ? 122 : 190 + y / 4; raw[o + 2] = ground ? 92 : 235; }
  const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4), sum = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3]];
  const stl = 'solid cube\n' + faces.map((f) => 'facet normal 0 0 0\nouter loop\n' + f.map((i) => 'vertex ' + v[i].join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid cube\n';
  return { png, stl };
}

const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name) }); } };
const disabled = (page, selector) => page.locator(selector).evaluate((el) => el.disabled);
const nullPosts = (requests) => requests.filter((r) => /\/projects\/(null|undefined)(\/|$)/.test(r.path));

test('before a project is open every project action is disabled and Render preview never posts to /projects/null', { timeout: 120000 }, async () => {
  const { origin, requests } = await studio();
  const { page, context, errors } = await open(origin);
  try {
    for (const id of ['render-preview', 'run-project', 'run-blender', 'run-godot-tool', 'import-model', 'scene-undo', 'scene-save']) {
      assert.equal(await disabled(page, '#' + id), true, `#${id} must be disabled while no project is open`);
    }
    assert.equal(await page.locator('.scene-frame-tools button', { hasText: 'Set keyframe' }).evaluate((el) => el.disabled), true, 'Set keyframe must be disabled while no project is open');
    // Even a forced press (a stale enabled state) refuses before any request.
    await page.evaluate(() => { const b = document.getElementById('render-preview'); b.disabled = false; b.click(); });
    await page.waitForTimeout(300);
    assert.deepEqual(nullPosts(requests), [], 'no request may name a missing project');
    assert.doesNotMatch(await page.locator('#status').textContent(), /Expected a UUID/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('New offers the three types, creates an untitled project at once and renders its first preview', { timeout: 120000 }, async () => {
  const { origin, requests } = await studio();
  const { page, context, errors } = await open(origin);
  try {
    const types = page.locator('#home [data-scene-type]');
    assert.deepEqual(await types.locator('.scene-type-label').allTextContents(), ['3D scene', 'Godot game', 'Blender model']);
    await shot(page, 'first-screen-empty--light-blue--desktop.png');
    await page.locator('#home [data-scene-type="scene3d"]').click();
    await page.locator('#project-rev', { hasText: 'revision 1' }).waitFor();
    const created = requests.find((r) => r.method === 'POST' && r.path === '/projects');
    assert.deepEqual({ kind: created.body.kind, template: created.body.template, title: created.body.title }, { kind: 'godot', template: '3d', title: 'Untitled scene' });
    await page.waitForFunction(() => /revision 1 · /.test(document.getElementById('preview-info').textContent));
    const previews = requests.filter((r) => r.method === 'POST' && /^\/projects\/[0-9a-f-]{36}\/preview$/.test(r.path));
    assert.equal(previews.length, 1, 'the first preview is rendered once, at once');
    assert.doesNotMatch(await page.locator('#preview-info').textContent(), /No preview yet/);
    // The gating follows the open project: the actions it needs are enabled now.
    for (const id of ['render-preview', 'run-project', 'scene-save']) assert.equal(await disabled(page, '#' + id), false, `#${id} is enabled once a project is open`);
    // Closing the project gates them again and shows the projects.
    await page.getByRole('button', { name: '‹ All projects' }).click();
    await page.locator('#home-list .scene-card-title', { hasText: 'Untitled scene' }).waitFor();
    for (const id of ['render-preview', 'run-project', 'scene-save', 'scene-undo']) assert.equal(await disabled(page, '#' + id), true, `#${id} is disabled again once the project is closed`);
    assert.deepEqual(nullPosts(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('with projects the first screen is their list newest first with one New at the bottom right', { timeout: 120000 }, async () => {
  const { origin, call } = await studio();
  await call('POST', '/projects', { kind: 'blender', template: 'default', title: 'Older model' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const island = await call('POST', '/projects', { kind: 'godot', template: '3d', title: 'Island Outpost with a long descriptive name' });
  await call('POST', '/projects/' + island.project.projectId + '/preview', {});
  const { page, context, errors } = await open(origin);
  try {
    const thumb = await page.locator('#home-list .scene-card-thumb').boundingBox(), card = await page.locator('#home-list .scene-card').first().boundingBox();
    assert.ok(thumb.width <= card.width && thumb.x >= card.x, 'a rendered project shows its thumbnail inside its card');
    const titles = await page.locator('#home-list .scene-card-title').allTextContents();
    assert.deepEqual(titles, ['Island Outpost with a long descriptive name', 'Older model']);
    const news = page.locator('button:visible', { hasText: /^\s*\+?\s*New( project)?\s*$/ });
    assert.equal(await news.count(), 1, 'exactly one New on the list screen');
    const box = await news.boundingBox(), work = await page.locator('.ef-viewport').boundingBox();
    assert.ok(box.x + box.width > work.x + work.width * 0.75 && box.y + box.height > work.y + work.height * 0.75, 'New sits at the bottom right of the work');
    await shot(page, 'first-screen-list--light-blue--desktop.png');
    await news.click();
    await page.locator('#new-sheet [data-scene-type="model"]').waitFor();
    await page.locator('#new-sheet').getByRole('button', { name: 'Cancel' }).click();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  const phone = await open(origin, { width: 412, height: 915, phone: true });
  try {
    const fab = await phone.page.locator('#home-new').boundingBox(), bar = await phone.page.locator('.ef-panes').boundingBox();
    assert.equal(await phone.page.locator('#home-new').getAttribute('data-ef-floating'), '', '+ New is marked as the floating control the orb rests above');
    assert.ok(fab.x + fab.width > 412 * 0.75 && fab.y + fab.height <= bar.y, 'on a phone New sits at the bottom right, above the bottom bar');
    await shot(phone.page, 'first-screen-list--light-blue--mobile.png');
    await phone.page.locator('#home-new').click();
    await phone.page.locator('#new-sheet [data-scene-type="game"]').waitFor();
    await shot(phone.page, 'new-sheet--light-blue--mobile.png');
    assert.deepEqual(phone.errors, []);
  } finally { await phone.context.close(); }
});

test('an open project: one primary, a 240px scene tree, keyframes in Properties, and a Script & build tab', { timeout: 120000 }, async () => {
  const { origin, call } = await studio();
  const made = await call('POST', '/projects', { kind: 'blender', template: 'default', title: 'Island Outpost' });
  const { page, context, errors } = await open(origin, { query: '?project=' + made.project.projectId });
  try {
    await page.locator('#project-rev', { hasText: 'revision 1' }).waitFor();
    const primaries = await page.locator('button.primary:visible, button.ef-primary:visible').evaluateAll((els) => els.map((e) => e.id || e.textContent.trim()));
    assert.deepEqual(primaries, ['render-preview'], 'Render preview is the one primary');
    const nav = await page.locator('.ef-navigation').boundingBox();
    assert.ok(nav.width >= 239 && nav.width <= 241, 'the scene tree is 240px, not ' + nav.width);
    assert.equal(await page.locator('.ef-inspector').getByRole('button', { name: 'Set keyframe', exact: true }).count(), 1, 'keyframes sit in Properties');
    const view = await page.locator('.ef-viewport').boundingBox(), stage = await page.locator('.scene-stage').boundingBox();
    assert.ok(stage.height > view.height * 0.6, 'the preview fills the centre');
    await shot(page, 'scene--light-blue--desktop.png');
    await page.getByRole('tab', { name: 'Script & build' }).click();
    await page.locator('#file-text').waitFor();
    await shot(page, 'script-build--light-blue--desktop.png');
    assert.equal(await page.locator('.scene-stage').isVisible(), false);
    assert.ok((await page.locator('#file-text').boundingBox()).width > 500, 'the source editor gets the centre');
    await page.getByRole('tab', { name: 'Scene' }).click();
    await page.locator('.scene-stage').waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('on a phone the work is not covered: Revision history and Help are in More and keyframes are in Properties', { timeout: 120000 }, async () => {
  const { origin, call } = await studio();
  const made = await call('POST', '/projects', { kind: 'blender', template: 'default', title: 'Island Outpost' });
  const { page, context, errors } = await open(origin, { width: 412, height: 915, phone: true, query: '?project=' + made.project.projectId });
  try {
    await page.locator('#project-rev', { hasText: 'revision 1' }).waitFor();
    assert.equal(await page.locator('#scene-history').isVisible(), false, 'Revision history is not on the work');
    assert.equal(await page.getByRole('button', { name: 'Set keyframe', exact: true }).isVisible(), false, 'keyframes are not on the work');
    const render = await page.locator('#render-preview').boundingBox(), bar = await page.locator('.ef-panes').boundingBox();
    assert.ok(render.y + render.height <= bar.y, 'Render preview is above the bottom bar');
    await shot(page, 'scene--light-blue--mobile.png');
    await page.getByRole('button', { name: '⋯ More' }).click();
    await page.locator('.ef-sheet #scene-history').waitFor();
    await page.locator('.ef-sheet #scene-help').waitFor();
    await shot(page, 'more-sheet--light-blue--mobile.png');
    await page.locator('.ef-sheet .ef-sheet-close').click();
    await page.getByRole('button', { name: 'Properties', exact: true }).click();
    await page.locator('.ef-inspector').getByRole('button', { name: 'Set keyframe', exact: true }).waitFor();
    await shot(page, 'properties-keyframes--light-blue--mobile.png');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

/** The shared document handoff the concierge runs around a turn: prepare before it, refresh after it. */
const handoff = (page, step) => page.evaluate(async (step) => {
  const { beginDocumentHandoff, refreshOpenDocument } = await import('/shared/ui/js/document-handoff.js');
  if (step === 'prepare') return (await beginDocumentHandoff({ app: 'scene-studio' })).context;
  await refreshOpenDocument({ app: 'scene-studio' });
  return null;
}, step);

test('a concierge turn begun with no project open opens the one project it made; two made are only listed', { timeout: 120000 }, async () => {
  const { origin, call } = await studio();
  const { page, context, errors } = await open(origin, { width: 412, height: 915, phone: true });
  try {
    await page.locator('#home [data-scene-type="scene3d"]').waitFor();
    assert.equal((await handoff(page, 'prepare')).recordId, undefined, 'nothing is handed over while no project is open');
    const made = await call('POST', '/projects', { kind: 'godot', template: '3d', title: 'Palm island' });
    await handoff(page, 'refresh');
    await page.locator('#project-rev', { hasText: 'revision 1' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('project'), made.project.projectId, 'the project the turn made is open');
    await page.goto(origin + '/api/scene-studio/app');
    await page.locator('#home-list .scene-card-title', { hasText: 'Palm island' }).waitFor();
    assert.equal((await handoff(page, 'prepare')).recordId, undefined);
    await call('POST', '/projects', { kind: 'blender', template: 'default', title: 'Boat' });
    await call('POST', '/projects', { kind: 'blender', template: 'default', title: 'Palm tree' });
    await handoff(page, 'refresh');
    await page.locator('#home-list .scene-card-title', { hasText: 'Palm tree' }).waitFor();
    assert.equal(await page.locator('#home-list .scene-card').count(), 3);
    assert.equal(new URL(page.url()).searchParams.get('project'), null, 'with two made, none is opened for the person');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
