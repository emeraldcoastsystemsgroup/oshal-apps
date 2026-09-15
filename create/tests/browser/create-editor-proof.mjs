/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the actual layered editor UI, durable revision contract, downloads, refusal states and responsive themes with synthetic data only.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Hold actual portable-file reads to verify draft protection and control recovery after malformed imports.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Verify friendly nonJSON and20-second timeout errors, unchanged drafts and successful explicit retry over real HTTP.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Prove actual Daylight and Midnight disclosures remain opaque over a changing raster underlay.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProject, applyOperation } from '../../tools/editor/model.mjs';
import { chromium, startEditorFixture, syntheticImage } from './create-editor-fixture.mjs';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function open(t, options = {}) {
  const fixture = await startEditorFixture(options), context = await browser.newContext({ viewport: { width: options.width ?? 1440, height: options.height ?? 1000 }, acceptDownloads: true });
  const errors = [], external = [], downloads = [];
  t.after(async () => { await context.close(); await fixture.close(); });
  await context.addInitScript(theme => { localStorage.setItem('cockpit-theme', theme); localStorage.setItem('cockpit-application-colors', 'false'); }, options.theme ?? 'workspace');
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== fixture.origin) { external.push(route.request().url()); return route.abort(); } return route.continue();
  });
  const record = options.seed ? fixture.seed(options.seed) : null, page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message)); page.on('download', download => downloads.push(download));
  await page.goto(`${fixture.origin}/fixture${record ? '?project=' + record.id : ''}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const surface = page.frameLocator('#editorFrame');
  await surface.locator('#saveStatus').waitFor();
  if (options.waitReady !== false) await surface.locator('#saveStatus').filter({ hasNotText: /Checking|Loading/ }).waitFor();
  return { page, surface, fixture, errors, external, downloads, record };
}

async function change(surface, selector, value) { await surface.locator(selector).fill(String(value)); await surface.locator(selector).press('Tab'); }
async function noAutosave(value) { await value.surface.locator('#autosave').uncheck(); }
async function saved(value, revision = 1) { await value.surface.locator('#saveStatus').filter({ hasText: `Saved · revision ${revision}` }).waitFor(); }
function clean(value) { assert.deepEqual(value.errors, []); assert.deepEqual(value.external, []); }

async function screenshot(value, name) {
  if (!process.env.CREATE_EDITOR_SCREENSHOT_DIR) return;
  await mkdir(process.env.CREATE_EDITOR_SCREENSHOT_DIR, { recursive: true });
  await value.page.screenshot({ path: resolve(process.env.CREATE_EDITOR_SCREENSHOT_DIR, name + '.png'), fullPage: true });
}

async function download(value, button) {
  await value.surface.locator('#exportMenu summary').click(); const pending = value.page.waitForEvent('download');
  await value.surface.locator(button).click(); const received = await pending, stream = await received.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk); return { name: received.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

async function composition(value) {
  const { surface } = value; await noAutosave(value); await change(surface, '#projectName', 'Synthetic cover');
  await surface.locator('#canvasWidth').fill('320'); await surface.locator('#canvasHeight').fill('240'); await surface.locator('#applyCanvas').click();
  await surface.locator('#addRectangle').click(); await change(surface, '#layerName', 'Backdrop');
  await surface.locator('#addText').click(); await change(surface, '#layerText', 'Synthetic headline');
  await surface.locator('#imageFile').setInputFiles({ name: 'synthetic-red-blue.png', mimeType: 'image/png', buffer: await syntheticImage() });
  await surface.locator('#imageProperties').waitFor(); await surface.locator('#cropX').fill('50'); await surface.locator('#cropW').fill('50'); await surface.locator('#applyCrop').click();
  await surface.locator('#artboard').evaluate(canvas => new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000; const check = () => { const color = canvas.getContext('2d').getImageData(5, 5, 1, 1).data;
      if (color[2] === 255 && color[3] === 255) resolve(); else if (Date.now() > deadline) reject(new Error('Cropped image was not painted')); else requestAnimationFrame(check); }; check();
  }));
}

test('real editor creates shape, text and cropped image layers, saves/reopens them and downloads PNG plus portable JSON', async t => {
  const value = await open(t); await composition(value); await value.surface.locator('#saveProject').click(); await saved(value);
  assert.equal(value.fixture.state.projects.size, 1); assert.equal(value.fixture.state.uploads, 1);
  const record = [...value.fixture.state.projects.values()][0], document = record.document;
  assert.equal(record.title, 'Synthetic cover'); assert.equal(document.width, 320); assert.equal(document.height, 240);
  assert.deepEqual(document.layers.map(layer => layer.type), ['rect', 'text', 'image']); assert.equal(document.layers[1].text, 'Synthetic headline');
  assert.deepEqual(document.layers[2].crop, { x: .5, y: 0, w: .5, h: 1 }); assert.ok(Object.values(document.images)[0].src.startsWith('/api/create/project-assets/'));
  await value.surface.locator('#newProject').click(); assert.equal(await value.surface.locator('#layerCount').innerText(), '0');
  await value.surface.locator('#openProjects').click(); await value.surface.locator(`[data-project-id="${record.id}"]`).getByRole('button', { name: 'Open', exact: true }).click(); await saved(value);
  assert.equal(await value.surface.locator('#projectName').inputValue(), 'Synthetic cover'); assert.equal(await value.surface.locator('#layerCount').innerText(), '3');
  const png = await download(value, '#exportPng'); assert.equal(png.name, 'Synthetic cover.png'); assert.deepEqual([...png.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const portable = await download(value, '#exportJson'), decoded = JSON.parse(portable.bytes.toString());
  assert.equal(portable.name, 'Synthetic cover.create.json'); assert.deepEqual(decoded.layers, document.layers); assert.ok(Object.values(decoded.images)[0].src.startsWith('data:image/png;base64,'));
  assert.equal(value.fixture.state.successfulWrites, 1); await screenshot(value, 'desktop-composition-workspace');
  await value.surface.locator('#newProject').click(); await value.surface.locator('#projectFile').setInputFiles({ name: portable.name, mimeType: 'application/json', buffer: portable.bytes });
  await value.surface.locator('#layerCount').filter({ hasText: '3' }).waitFor(); await value.surface.locator('#saveProject').click(); await saved(value);
  const imported = [...value.fixture.state.projects.values()].at(-1).document;
  assert.deepEqual(imported.layers, document.layers); assert.notEqual(Object.values(imported.images)[0].src, Object.values(document.images)[0].src);
  assert.equal(value.fixture.state.uploads, 2); clean(value);
});

test('real pointer movement and undo/redo commit one completed gesture and retain keyboard edits', async t => {
  const value = await open(t); await noAutosave(value); const { surface, page } = value;
  await surface.locator('#addRectangle').click(); const beforeX = Number(await surface.locator('#layerX').inputValue());
  const box = await surface.locator('#artboard').boundingBox(), x = box.x + box.width * .4, y = box.y + box.height * .325;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 30, y + 20, { steps: 5 }); await page.mouse.up();
  assert.ok(Number(await surface.locator('#layerX').inputValue()) > beforeX);
  await surface.locator('#undo').click(); assert.equal(Number(await surface.locator('#layerX').inputValue()), beforeX);
  await surface.locator('#redo').click(); const moved = Number(await surface.locator('#layerX').inputValue()); assert.ok(moved > beforeX);
  await surface.locator('#artboard').focus(); await surface.locator('#artboard').press('Shift+ArrowRight');
  assert.equal(Number(await surface.locator('#layerX').inputValue()), moved + 10); clean(value);
});

test('a stale save preserves the draft, pauses overwrite attempts and saves an explicit copy', async t => {
  const value = await open(t); await noAutosave(value); await value.surface.locator('#addRectangle').click();
  await value.surface.locator('#saveProject').click(); await saved(value); const original = [...value.fixture.state.projects.values()][0];
  await change(value.surface, '#projectName', 'My preserved conflict draft'); value.fixture.state.staleOnce = true;
  await value.surface.locator('#saveProject').click(); await value.surface.locator('#editorError').filter({ hasText: /newer revision/ }).waitFor();
  assert.equal(await value.surface.locator('#projectName').inputValue(), 'My preserved conflict draft'); assert.equal(await value.surface.locator('#saveProject').isDisabled(), true);
  assert.equal(value.fixture.state.projects.get(original.id).title, original.title); assert.equal(value.fixture.state.successfulWrites, 1);
  await value.surface.locator('#saveCopy').click(); await saved(value); assert.equal(value.fixture.state.projects.size, 2);
  assert.ok([...value.fixture.state.projects.values()].some(row => row.title === 'My preserved conflict draft')); clean(value);
});

test('a revision quota 409 preserves edits and reports the limit without claiming another tab saved them', async t => {
  const value = await open(t); await noAutosave(value); await value.surface.locator('#addRectangle').click();
  await value.surface.locator('#saveProject').click(); await saved(value); const original = [...value.fixture.state.projects.values()][0];
  await change(value.surface, '#projectName', 'Synthetic quota draft'); value.fixture.state.revisionFailure = 409; value.fixture.state.revisionError = 'project_revision_limit_reached';
  await value.surface.locator('#saveProject').click(); await value.surface.locator('#editorError').waitFor();
  const message = await value.surface.locator('#editorError').innerText(); assert.match(message, /limit/i); assert.doesNotMatch(message, /newer revision|elsewhere/i);
  assert.equal(await value.surface.locator('#projectName').inputValue(), 'Synthetic quota draft'); assert.equal(await value.surface.locator('#saveProject').isDisabled(), false);
  assert.deepEqual(value.fixture.state.projects.get(original.id), original); await value.surface.locator('#saveCopy').click(); await saved(value);
  assert.equal(value.fixture.state.projects.size, 2); assert.equal(value.fixture.state.successfulWrites, 2); clean(value);
});

for (const status of [403, 503]) test(`unavailable ${status} permission discovery leaves editing disabled without writes`, async t => {
  const value = await open(t, { permissionsFailure: status });
  await value.surface.locator('#editorError').waitFor();
  for (const selector of ['#projectName', '#addRectangle', '#uploadImage', '#saveProject', '#exportPng']) assert.equal(await value.surface.locator(selector).isDisabled(), true);
  await value.surface.locator('#addRectangle').evaluate(node => node.click()); assert.equal(value.fixture.state.successfulWrites, 0); assert.equal(value.fixture.state.uploads, 0);
  assert.equal(value.fixture.state.requests.some(row => row.method !== 'GET'), false); clean(value);
});

test('read-only users can reopen and export their saved canvas while every editing action remains unavailable', async t => {
  const seed = applyOperation(createProject({ name: 'Synthetic read-only project' }), { type: 'add', layer: { id: 'rect', type: 'rect' } });
  const value = await open(t, { seed, permissions: { create: false, change: false, delete: false } });
  await saved(value); assert.equal(await value.surface.locator('#layerCount').innerText(), '1');
  for (const selector of ['#projectName', '#addRectangle', '#uploadImage', '#saveProject', '#undo']) assert.equal(await value.surface.locator(selector).isDisabled(), true);
  const png = await download(value, '#exportPng'); assert.deepEqual([...png.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('fresh export denial produces no download and leaves the saved canvas intact', async t => {
  const value = await open(t); await value.surface.locator('#addRectangle').click(); await value.surface.locator('#saveProject').click(); await saved(value);
  const record = clone([...value.fixture.state.projects.values()][0]); value.fixture.state.permissions.export = false;
  await value.surface.locator('#exportMenu summary').click(); await value.surface.locator('#exportPng').click();
  await value.surface.locator('#editorError').filter({ hasText: /permission_denied/ }).waitFor();
  assert.equal(value.downloads.length, 0); assert.deepEqual(value.fixture.state.projects.get(record.id), record); clean(value);
});

test('live global and optional Create palettes preserve the actual editor document, draft and canvas pixels', async t => {
  const value = await open(t); await composition(value);
  const before = await value.surface.locator('#artboard').evaluate(canvas => { window.originalCanvas = canvas; return [...canvas.getContext('2d').getImageData(5, 5, 1, 1).data]; });
  await value.page.locator('#midnight').click(); await value.surface.locator('html[data-theme="midnight"]').waitFor();
  assert.equal(await value.surface.locator('#projectName').inputValue(), 'Synthetic cover'); assert.equal(await value.surface.locator('#layerCount').innerText(), '3');
  assert.equal(await value.surface.locator('#artboard').evaluate(canvas => canvas === window.originalCanvas), true);
  assert.deepEqual(await value.surface.locator('#artboard').evaluate(canvas => [...canvas.getContext('2d').getImageData(5, 5, 1, 1).data]), before);
  await screenshot(value, 'desktop-composition-midnight'); await value.page.locator('#applicationColors').check(); await value.surface.locator('html[data-theme="create"]').waitFor();
  assert.equal(await value.surface.locator('#projectName').inputValue(), 'Synthetic cover'); await value.page.locator('#applicationColors').uncheck();
  await value.page.locator('#workspace').click(); await value.surface.locator('html[data-theme="workspace"]').waitFor(); clean(value);
});

for (const width of [390, 768]) test(`actual ${width}px editor controls and canvas stay within the viewport`, async t => {
  const value = await open(t, { width, height: 900 }); const { surface } = value;
  await surface.locator('#addText').click(); await change(surface, '#layerText', 'Synthetic narrow title');
  const geometry = await surface.locator('html').evaluate(root => ({ width: innerWidth, scroll: root.scrollWidth })); assert.ok(geometry.scroll <= geometry.width + 1);
  for (const selector of ['#projectName', '#saveProject', '#layerText', '#artboard']) {
    const box = await surface.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth }; });
    assert.ok(box.left >= -1 && box.right <= box.width + 1, selector);
  }
  if (width <= 720) await surface.locator('#canvasOptions summary').click();
  assert.equal(await surface.locator('#canvasWidth').isVisible(), true, 'Canvas dimensions must remain available on narrow screens');
  await surface.locator('#canvasWidth').fill('640'); await surface.locator('#applyCanvas').click();
  assert.equal(await surface.locator('#artboard').getAttribute('width'), '640');
  await screenshot(value, `editor-${width}-workspace`); clean(value);
});

function clone(value) { return structuredClone(value); }

test('an initial held project read keeps paste disabled until its saved document has opened', async t => {
  const seed = applyOperation(createProject({ name: 'Synthetic loading project' }), { type: 'add', layer: { id: 'rect', type: 'rect' } });
  let heldRead; const held = new Promise(resolve => { heldRead = resolve; });
  const value = await open(t, { seed, holdReads: true, onHeldRead: heldRead, waitReady: false }); await held;
  await value.surface.locator('#artboard').evaluate((canvas, bytes) => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'synthetic-paste.png', { type: 'image/png' }));
    canvas.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
  }, [...await syntheticImage()]);
  await value.surface.locator('#artboard').evaluate(() => new Promise(resolve => setTimeout(resolve, 200)));
  assert.equal(value.fixture.state.requests.filter(row => row.method === 'POST').length, 0, 'Pending project load must reject a pasted raster before upload');
  value.fixture.state.holdReads = false; value.fixture.state.pendingReads.splice(0).forEach(release => release()); await saved(value);
  assert.equal(await value.surface.locator('#projectName').inputValue(), seed.name); assert.equal(await value.surface.locator('#layerCount').innerText(), '1'); clean(value);
});

test('a pending image decode preserves existing painted layers without a missing-asset error', async t => {
  const value = await open(t); await noAutosave(value); await value.surface.locator('#addRectangle').click();
  const before = await value.surface.locator('#artboard').evaluate(canvas => [...canvas.getContext('2d').getImageData(200, 180, 1, 1).data]);
  value.fixture.state.holdAssets = true; const held = new Promise(resolve => { value.fixture.state.onHeldAsset = resolve; });
  await value.surface.locator('#imageFile').setInputFiles({ name: 'synthetic-held.png', mimeType: 'image/png', buffer: await syntheticImage() }); await held;
  assert.equal(await value.surface.locator('#layerCount').innerText(), '2'); assert.equal(await value.surface.locator('#editorError').isVisible(), false);
  assert.deepEqual(await value.surface.locator('#artboard').evaluate(canvas => [...canvas.getContext('2d').getImageData(200, 180, 1, 1).data]), before);
  value.fixture.state.holdAssets = false; value.fixture.state.pendingAssets.splice(0).forEach(release => release());
  await value.surface.locator('#artboard').evaluate(canvas => new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000; const check = () => { if (canvas.getContext('2d').getImageData(5, 5, 1, 1).data[0] === 255) resolve();
      else if (Date.now() > deadline) reject(new Error('Released image did not paint')); else requestAnimationFrame(check); }; check();
  })); clean(value);
});

test('failed autosave stops retrying until an explicit Save and preserves the draft', async t => {
  const value = await open(t); await value.page.clock.install(); await value.surface.locator('#addText').click();
  await value.surface.locator('#saveProject').click(); await saved(value); value.fixture.state.revisionFailure = 503;
  await change(value.surface, '#layerText', 'Keep this unsaved title');
  const failed = value.page.waitForResponse(response => response.url().endsWith('/revisions') && response.status() === 503);
  await value.page.clock.runFor(1600); await failed; await value.surface.locator('#editorError').filter({ hasText: /save_unavailable/ }).waitFor();
  const writes = () => value.fixture.state.requests.filter(row => row.method === 'POST' && row.path.endsWith('/revisions')).length;
  assert.equal(writes(), 1); await value.page.clock.runFor(10000); assert.equal(writes(), 1);
  assert.equal(await value.surface.locator('#layerText').inputValue(), 'Keep this unsaved title');
  value.fixture.state.revisionFailure = null; await value.surface.locator('#saveProject').click(); await saved(value, 2);
  assert.equal(writes(), 2); assert.equal([...value.fixture.state.projects.values()][0].document.layers[0].text, 'Keep this unsaved title'); clean(value);
});

test('restoring a held older revision blocks competing edits and saves the restored layers as the next revision', async t => {
  const value = await open(t); await noAutosave(value); await value.surface.locator('#addText').click();
  await change(value.surface, '#layerText', 'Original title'); await value.surface.locator('#saveProject').click(); await saved(value);
  await change(value.surface, '#layerText', 'Updated title'); await value.surface.locator('#saveProject').click(); await saved(value, 2);
  const record = [...value.fixture.state.projects.values()][0]; await value.surface.locator('#openProjects').click();
  const row = value.surface.locator(`[data-project-id="${record.id}"]`); await row.getByRole('button', { name: 'Revisions', exact: true }).click();
  await row.locator('select').selectOption('1'); value.fixture.state.holdReads = true;
  const held = new Promise(resolve => { value.fixture.state.onHeldRead = resolve; }); await row.getByRole('button', { name: 'Restore', exact: true }).click(); await held;
  for (const selector of ['#projectName', '#addText', '#saveProject', '#importProject']) assert.equal(await value.surface.locator(selector).isDisabled(), true);
  value.fixture.state.holdReads = false; value.fixture.state.pendingReads.splice(0).forEach(release => release());
  await value.surface.locator('#projectDialog').waitFor({ state: 'hidden' }); await value.surface.locator('#saveProject').click(); await saved(value, 3);
  const current = value.fixture.state.projects.get(record.id); assert.equal(current.document.layers[0].text, 'Original title');
  assert.equal(value.fixture.state.revisions.get(record.id)[1].document.layers[0].text, 'Updated title'); clean(value);
});

async function holdPortableRead(surface) {
  await surface.locator('html').evaluate(() => {
    const original = File.prototype.text; window.importReadStarted = false;
    File.prototype.text = function () {
      if (this.name !== 'synthetic-deferred.create.json') return original.call(this);
      window.importReadStarted = true;
      return new Promise((resolve, reject) => { window.releaseImportRead = () => { File.prototype.text = original; return original.call(this).then(resolve, reject); }; });
    };
  });
}

for (const valid of [true, false]) test(`a deferred ${valid ? 'valid' : 'malformed'} portable import blocks competing edits and restores controls safely`, { timeout: 20000 }, async t => {
  const seed = applyOperation(createProject({ name: 'Synthetic saved original' }), { type: 'add', layer: { id: 'original', type: 'rect' } });
  const value = await open(t, { seed }); await saved(value); await noAutosave(value); await holdPortableRead(value.surface);
  const imported = applyOperation(createProject({ name: 'Synthetic imported design' }), { type: 'add', layer: { id: 'imported', type: 'text', text: 'Editable imported title' } });
  await value.surface.locator('#projectFile').setInputFiles({ name: 'synthetic-deferred.create.json', mimeType: 'application/json', buffer: Buffer.from(valid ? JSON.stringify(imported) : '{invalid-json') });
  assert.equal(await value.surface.locator('html').evaluate(() => window.importReadStarted), true);
  for (const selector of ['#projectName', '#addText', '#newProject', '#openProjects', '#saveProject', '#importProject']) {
    assert.equal(await value.surface.locator(selector).isDisabled(), true, `${selector} must remain disabled until the file read finishes`);
  }
  await value.surface.locator('#addText').evaluate(node => node.click()); await value.surface.locator('#newProject').evaluate(node => node.click());
  assert.equal(await value.surface.locator('#layerCount').innerText(), '1'); assert.equal(await value.surface.locator('#projectName').inputValue(), seed.name);
  await value.surface.locator('html').evaluate(() => window.releaseImportRead());
  if (valid) await value.surface.locator('#saveStatus').filter({ hasText: 'Unsaved changes' }).waitFor();
  else await value.surface.locator('#editorError').waitFor();
  assert.equal(await value.surface.locator('#projectName').inputValue(), valid ? imported.name : seed.name);
  assert.equal(await value.surface.locator('#newProject').isDisabled(), false); assert.equal(await value.surface.locator('#addText').isDisabled(), false);
  assert.deepEqual(value.fixture.state.projects.get(value.record.id).document, seed);
  assert.equal(value.fixture.state.successfulWrites, 0); assert.equal(value.fixture.state.uploads, 0); clean(value);
});

for (const status of [502, 200]) test(`My projects reports a readable error for an HTML ${status} response and retries without losing the canvas`, { timeout: 20000 }, async t => {
  const value = await open(t); await noAutosave(value); await value.surface.locator('#addText').click();
  await change(value.surface, '#projectName', 'Synthetic preserved gateway draft');
  value.fixture.state.listReply = { status, body: '<!DOCTYPE html><html><body>Synthetic gateway page</body></html>' };
  await value.surface.locator('#openProjects').click();
  await value.surface.locator('#projectList').filter({ hasNotText: 'Loading your projects' }).waitFor();
  const message = await value.surface.locator('#projectList').innerText();
  assert.match(message, status === 502 ? /server.*502.*try again/i : /unreadable response.*try again/i);
  assert.doesNotMatch(message, /Unexpected token|DOCTYPE|JSON\.parse|<html/i);
  assert.equal(await value.surface.locator('#projectName').inputValue(), 'Synthetic preserved gateway draft'); assert.equal(await value.surface.locator('#layerCount').innerText(), '1');
  value.fixture.state.listReply = null; await value.surface.locator('#closeProjects').click(); await value.surface.locator('#openProjects').click();
  await value.surface.locator('#projectList').filter({ hasText: 'No image projects yet' }).waitFor();
  assert.equal(value.fixture.state.successfulWrites, 0); assert.equal(value.fixture.state.uploads, 0); clean(value);
});

test('a held export times out at20seconds with readable guidance and explicit retry downloads the saved canvas', { timeout: 20000 }, async t => {
  const seed = applyOperation(createProject({ name: 'Synthetic timeout canvas' }), { type: 'add', layer: { id: 'rect', type: 'rect' } });
  const value = await open(t, { seed }); await saved(value);
  await value.page.clock.install({ time: new Date('2026-09-12T12:00:00Z') }); await value.page.clock.pauseAt(new Date('2026-09-12T12:01:00Z'));
  value.fixture.state.holdExports = true; const held = new Promise(resolve => { value.fixture.state.onHeldExport = resolve; });
  await value.surface.locator('#exportMenu summary').click(); await value.surface.locator('#exportPng').click(); await held;
  await value.page.clock.runFor(19999); assert.equal(await value.surface.locator('#editorError').isVisible(), false); assert.equal(value.downloads.length, 0);
  await value.page.clock.runFor(1); await value.surface.locator('#editorError').waitFor();
  const message = await value.surface.locator('#editorError').innerText(); assert.match(message, /took too long.*try again/i); assert.doesNotMatch(message, /signal|AbortError|aborted/i);
  assert.equal(await value.surface.locator('#projectName').inputValue(), seed.name); assert.deepEqual(value.fixture.state.projects.get(value.record.id).document, seed);
  value.fixture.state.holdExports = false; const downloaded = value.page.waitForEvent('download'); await value.surface.locator('#exportPng').click();
  const file = await downloaded; assert.equal(file.suggestedFilename(), seed.name + '.png'); const stream = await file.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk); assert.deepEqual([...Buffer.concat(chunks).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(value.fixture.state.successfulWrites, 0); assert.equal(value.fixture.state.uploads, 0); clean(value);
});

async function paintUnderlay(surface, color) {
  await surface.locator('html').evaluate((_root, fill) => {
    let canvas = document.getElementById('synthetic-opacity-underlay');
    if (!canvas) {
      canvas = document.createElement('canvas'); canvas.id = 'synthetic-opacity-underlay'; canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9;pointer-events:none'; document.body.append(canvas);
    }
    canvas.width = innerWidth; canvas.height = innerHeight; const ctx = canvas.getContext('2d'); ctx.fillStyle = fill; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, color);
}

async function opaqueScene(value, locator) {
  const frame = await value.page.locator('#editorFrame').boundingBox();
  const captures = [];
  for (const color of ['#ff0000', '#00ffff']) {
    await paintUnderlay(value.surface, color);
    const box = await locator.boundingBox();
    const surface = await value.page.screenshot({ animations: 'disabled', caret: 'hide', clip: {
      x: Math.ceil(box.x + 20), y: Math.ceil(box.y + 20), width: Math.floor(box.width - 40), height: Math.floor(box.height - 40) } });
    const outside = await value.page.screenshot({ clip: { x: frame.x + 2, y: frame.y + 2, width: 3, height: 3 } }); captures.push({ surface, outside });
  }
  assert.equal(captures[0].outside.equals(captures[1].outside), false, 'Positive control: changing the real raster underlay must change exposed pixels');
  assert.equal(captures[0].surface.equals(captures[1].surface), true, 'The disclosure interior must be independent of the raster behind it; rounded outer corners remain transparent');
  const alpha = await locator.evaluate(node => { const values = getComputedStyle(node).backgroundColor.match(/[\d.]+/g).map(Number); return values.length === 4 ? values[3] : 1; });
  assert.equal(alpha, 1, 'The disclosure must use an opaque palette surface');
}

for (const theme of ['daylight', 'midnight']) for (const kind of ['dialog', 'menu']) test(`${theme} ${kind} is opaque above changing canvas content`, { timeout: 20000 }, async t => {
  const value = await open(t, { theme });
  await value.surface.locator(`html[data-theme="${theme}"]`).waitFor(); assert.equal(await value.page.locator('html').getAttribute('data-theme'), theme);
  await value.surface.locator('#addText').click(); await change(value.surface, '#layerText', 'Synthetic content behind disclosures'); await noAutosave(value);
  if (kind === 'dialog') {
    await value.surface.locator('#openProjects').click(); await value.surface.locator('#projectList').filter({ hasText: 'No image projects yet' }).waitFor();
  } else await value.surface.locator('#exportMenu summary').click();
  await opaqueScene(value, value.surface.locator(kind === 'dialog' ? '#projectDialog' : '#exportMenu .popover'));
  assert.equal(await value.surface.locator('#layerText').inputValue(), 'Synthetic content behind disclosures');
  assert.equal(value.fixture.state.successfulWrites, 0); assert.equal(value.fixture.state.uploads, 0); clean(value);
});
