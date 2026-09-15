/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise original editable templates through the real gallery, renderer, permission-aware editor and synthetic project API.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep gallery keyboard and paste browsing isolated from the existing draft and refuse mixed artifact queries even with a saved project.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createProject, applyOperation } from '../../tools/editor/model.mjs';
import { chromium, startEditorFixture, syntheticImage } from './create-editor-fixture.mjs';

const PRESETS = [
  ['square-announcement', 1080, 1080], ['story-promo', 1080, 1920], ['presentation-title', 1920, 1080],
  ['video-thumbnail', 1280, 720], ['event-flyer', 1080, 1350], ['quote-card', 1080, 1080],
  ['product-card', 1080, 1080], ['profile-banner', 1500, 500],
];
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function open(t, options = {}) {
  const fixture = await startEditorFixture(options);
  const context = await browser.newContext({ viewport: { width: options.width ?? 1440, height: options.height ?? 1000 }, acceptDownloads: true });
  t.after(async () => { await context.close(); await fixture.close(); });
  const errors = [], external = [], downloads = [];
  await context.addInitScript(theme => { localStorage.setItem('cockpit-theme', theme); localStorage.setItem('cockpit-application-colors', 'false'); }, options.theme ?? 'workspace');
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== fixture.origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const record = options.seed ? fixture.seed(options.seed) : null;
  const query = new URLSearchParams(options.query); if (record) query.set('project', record.id);
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message)); page.on('download', file => downloads.push(file));
  if (options.beforeGoto) await options.beforeGoto({ context, page, fixture });
  await page.goto(`${fixture.origin}/fixture?${query}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const surface = page.frameLocator('#editorFrame'); await surface.locator('#saveStatus').waitFor();
  if (options.waitReady !== false) await surface.locator('#saveStatus').filter({ hasNotText: /Checking|Loading/ }).waitFor();
  return { page, context, surface, fixture, record, errors, external, downloads };
}

async function snapshot(value) {
  return value.surface.locator('html').evaluate(async () => {
    const { state } = await import('/api/create/editor/editor-state.mjs');
    return { project: structuredClone(state.project), id: state.id, revision: state.revision, saved: state.saved, selected: state.selected };
  });
}

async function gallery(value) {
  await value.surface.locator('#openTemplates').click();
  await value.surface.locator('#templateDialog').waitFor();
  await value.surface.locator('#templateGrid button[data-template-id]').nth(PRESETS.length - 1).waitFor();
}

async function choose(value, id) {
  await value.surface.locator(`#templateGrid button[data-template-id="${id}"]`).click();
  await value.surface.locator('#templateDialog').waitFor({ state: 'hidden' });
}

function clean(value) {
  assert.deepEqual(value.errors, []); assert.deepEqual(value.external, []);
  assert.equal(value.fixture.state.uploads, 0, 'Original template use must not upload assets');
}

async function saved(value) { await value.surface.locator('#saveStatus').filter({ hasText: /Saved.*revision 1/ }).waitFor(); }
async function change(value, selector, text) { await value.surface.locator(selector).fill(String(text)); await value.surface.locator(selector).press('Tab'); }
async function twoFrames(value) { await value.surface.locator('html').evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); }

async function download(value, button) {
  await value.surface.locator('#exportMenu summary').click(); const pending = value.page.waitForEvent('download');
  await value.surface.locator(button).click(); const received = await pending, stream = await received.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { name: received.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

async function screenshot(value, name) {
  if (!process.env.CREATE_TEMPLATES_SCREENSHOT_DIR) return;
  await mkdir(process.env.CREATE_TEMPLATES_SCREENSHOT_DIR, { recursive: true });
  await value.page.screenshot({ path: resolve(process.env.CREATE_TEMPLATES_SCREENSHOT_DIR, name + '.png'), fullPage: true });
}

async function contactSheet(value) {
  if (!process.env.CREATE_TEMPLATES_SCREENSHOT_DIR) return;
  const page = await value.context.newPage(); await page.goto(value.fixture.origin + '/api/create/editor');
  await page.locator('#saveStatus').filter({ hasNotText: /Checking|Loading/ }).waitFor();
  await page.evaluate(async () => {
    const { TEMPLATES, createTemplate } = await import('/api/create/editor/templates.mjs');
    const { renderProject } = await import('/api/create/editor/renderer.mjs');
    const sheet = document.createElement('main'); sheet.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:24px;background:#f3f4f6;color:#111827';
    for (const item of TEMPLATES) {
      const card = document.createElement('section'), caption = document.createElement('p'), canvas = document.createElement('canvas');
      const preview = document.createElement('div'); preview.style.cssText = 'height:420px;display:flex;align-items:center;justify-content:center;background:#e4e7ec;padding:10px';
      renderProject(canvas.getContext('2d'), createTemplate(item.id)); canvas.style.cssText = 'width:100%;height:100%;object-fit:contain';
      caption.textContent = `${item.name} / ${item.width} x ${item.height}`; caption.style.cssText = 'font:14px system-ui;padding-top:10px';
      preview.append(canvas); card.append(preview, caption); sheet.append(card);
    }
    for (const child of document.body.children) child.style.display = 'none'; document.body.append(sheet);
  });
  await page.screenshot({ path: resolve(process.env.CREATE_TEMPLATES_SCREENSHOT_DIR, 'templates-eight-contact-sheet.png'), fullPage: true }); await page.close();
}

async function previewPixels(value, id) {
  return value.surface.locator(`#templateGrid button[data-template-id="${id}"] canvas`).evaluate(async (preview, templateId) => {
    const { createTemplate } = await import('/api/create/editor/templates.mjs');
    const { renderProject } = await import('/api/create/editor/renderer.mjs');
    const project = createTemplate(templateId), full = document.createElement('canvas'); renderProject(full.getContext('2d'), project);
    const expected = document.createElement('canvas'); expected.width = preview.width; expected.height = preview.height;
    expected.getContext('2d').drawImage(full, 0, 0, expected.width, expected.height);
    const actual = preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data;
    const wanted = expected.getContext('2d').getImageData(0, 0, expected.width, expected.height).data;
    let difference = 0; const colors = new Set();
    for (let i = 0; i < actual.length; i++) difference += Math.abs(actual[i] - wanted[i]);
    for (let i = 0; i < actual.length; i += 4) colors.add(`${actual[i]},${actual[i + 1]},${actual[i + 2]},${actual[i + 3]}`);
    return { averageDifference: difference / actual.length, colors: colors.size, width: preview.width, height: preview.height };
  }, id);
}

async function textInk(value) {
  return value.surface.locator('html').evaluate(async () => {
    const { state } = await import('/api/create/editor/editor-state.mjs'); const { renderProject } = await import('/api/create/editor/renderer.mjs');
    const make = layers => { const canvas = document.createElement('canvas'); renderProject(canvas.getContext('2d'), { ...state.project, layers }); return canvas; };
    const empty = make([]).getContext('2d').getImageData(0, 0, state.project.width, state.project.height).data;
    return state.project.layers.filter(layer => layer.type === 'text').map(layer => {
      const actual = make([layer]).getContext('2d').getImageData(0, 0, state.project.width, state.project.height).data;
      const expanded = make([{ ...layer, h: Math.max(layer.h, state.project.height - layer.y) }]).getContext('2d').getImageData(0, 0, state.project.width, state.project.height).data;
      let clipped = 0; for (let i = 0; i < actual.length; i++) if (actual[i] !== expanded[i]) clipped++;
      let painted = 0; for (let i = 0; i < actual.length; i += 4) if (actual[i] !== empty[i] || actual[i + 1] !== empty[i + 1] || actual[i + 2] !== empty[i + 2]) painted++;
      return { text: layer.text, painted, clipped, bounds: layer.x >= 0 && layer.y >= 0 && layer.x + layer.w <= state.project.width && layer.y + layer.h <= state.project.height };
    });
  });
}

async function exportedPixels(value, bytes) {
  return value.surface.locator('#artboard').evaluate(async (artboard, png) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0); image.close();
    const wanted = artboard.getContext('2d').getImageData(0, 0, artboard.width, artboard.height).data;
    const actual = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return { width: canvas.width, height: canvas.height, equal: actual.length === wanted.length && actual.every((byte, i) => byte === wanted[i]) };
  }, [...bytes]);
}

test('template gallery searches and combines category filters, supports keyboard dismissal and restores focus', async t => {
  const value = await open(t); await gallery(value);
  assert.equal(await value.surface.locator('#templateDialog').getAttribute('aria-labelledby'), 'templatesTitle');
  assert.equal(await value.surface.locator('#templateGrid button[data-template-id]').count(), 8);
  await value.surface.locator('#templateSearch').fill('quote');
  assert.deepEqual(await value.surface.locator('#templateGrid button[data-template-id]').evaluateAll(nodes => nodes.map(node => node.dataset.templateId)), ['quote-card']);
  await value.surface.locator('#templateSearch').fill('no such original template');
  assert.equal(await value.surface.locator('#templateGrid button[data-template-id]').count(), 0);
  assert.equal(await value.surface.locator('#templateEmpty').isVisible(), true);
  assert.match(await value.surface.locator('#templateEmpty').innerText(), /no|try/i);
  await value.surface.locator('#templateSearch').fill('');
  const category = await value.surface.locator('#templateCategory option').nth(1).getAttribute('value');
  await value.surface.locator('#templateCategory').selectOption(category);
  const selected = await value.surface.locator('#templateGrid button[data-template-id]').count(); assert.ok(selected > 0 && selected < 8);
  await value.surface.locator('#templateSearch').fill('no such original template'); assert.equal(await value.surface.locator('#templateGrid button[data-template-id]').count(), 0);
  await value.surface.locator('#templateSearch').press('Escape');
  assert.equal(await value.surface.locator('#templateSearch').inputValue(), '', 'Native search Escape first clears its query');
  await value.surface.locator('#templateSearch').press('Escape'); await value.surface.locator('#templateDialog').waitFor({ state: 'hidden' });
  assert.equal(await value.surface.locator('#openTemplates').evaluate(node => node === document.activeElement), true);
  await value.surface.locator('#openTemplates').click(); await value.surface.locator('#templateCategory').selectOption('');
  await value.surface.locator('#templateSearch').fill(''); await screenshot(value, 'templates-gallery-workspace-desktop'); await contactSheet(value);
  assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

for (const [id, width, height] of PRESETS) test(`${id} has a truthful painted preview, editable text and matching full-resolution PNG`, { timeout: 30000 }, async t => {
  const value = await open(t); await gallery(value);
  const preview = await previewPixels(value, id); assert.ok(preview.width > 0 && preview.height > 0);
  assert.ok(preview.colors > 20, `${id} preview must contain actual composition pixels`);
  assert.ok(preview.averageDifference < 1, `${id} preview must match the editable composition: ${preview.averageDifference}`);
  await choose(value, id); const selected = await snapshot(value);
  assert.equal(selected.id, null); assert.equal(selected.revision, 0); assert.equal(selected.saved, '');
  assert.equal(selected.project.width, width); assert.equal(selected.project.height, height); assert.ok(selected.project.layers.length >= 3);
  assert.deepEqual(selected.project.images, {}); assert.equal(value.fixture.state.successfulWrites, 0);
  const text = await textInk(value); assert.ok(text.length >= 2);
  for (const layer of text) {
    assert.ok(layer.text.trim()); assert.ok(layer.painted > 20, `${id} text must paint visible ink`); assert.equal(layer.bounds, true);
    assert.equal(layer.clipped, 0, `${id} must not clip wrapped text: ${layer.text}`);
  }
  const png = await download(value, '#exportPng'); assert.deepEqual([...png.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(await exportedPixels(value, png.bytes), { width, height, equal: true });
  assert.equal(value.fixture.state.projects.size, 1); assert.equal(value.fixture.state.successfulWrites, 1); clean(value);
});

test('selecting by keyboard starts a new copy, preserves the saved original and supports edit/save/reopen/portable export', async t => {
  const original = applyOperation(createProject({ name: 'Synthetic saved original' }), { type: 'add', layer: { id: 'original', type: 'text', text: 'Keep this original' } });
  const value = await open(t, { seed: original }); await value.surface.locator('#autosave').uncheck(); await gallery(value);
  const card = value.surface.locator('[data-template-id="event-flyer"]'); await card.focus(); await card.press('Enter');
  await value.surface.locator('#templateDialog').waitFor({ state: 'hidden' }); assert.equal((await snapshot(value)).id, null);
  assert.deepEqual(value.fixture.state.projects.get(value.record.id).document, original); assert.equal(value.fixture.state.successfulWrites, 0);
  const firstText = (await snapshot(value)).project.layers.find(layer => layer.type === 'text');
  await value.surface.locator(`[data-layer-id="${firstText.id}"] .layer-select`).click(); await change(value, '#layerText', 'Synthetic edited event');
  await change(value, '#projectName', 'Synthetic template copy'); await value.surface.locator('#saveProject').click(); await saved(value);
  const copy = [...value.fixture.state.projects.values()].find(row => row.id !== value.record.id); assert.ok(copy);
  assert.equal(copy.document.layers.find(layer => layer.id === firstText.id).text, 'Synthetic edited event');
  await value.surface.locator('#newProject').click(); await value.surface.locator('#openProjects').click();
  await value.surface.locator(`[data-project-id="${copy.id}"]`).getByRole('button', { name: 'Open', exact: true }).click(); await saved(value);
  assert.deepEqual((await snapshot(value)).project, copy.document);
  const portable = await download(value, '#exportJson'); assert.deepEqual(JSON.parse(portable.bytes.toString()).layers, copy.document.layers);
  assert.deepEqual(value.fixture.state.projects.get(value.record.id).document, original); assert.equal(value.fixture.state.revisions.get(value.record.id).length, 1);
  assert.equal(value.fixture.state.successfulWrites, 1); clean(value);
});

test('cancelling dirty replacement preserves the complete draft and saved document; closing the gallery is harmless', async t => {
  const original = applyOperation(createProject({ name: 'Synthetic retained project' }), { type: 'add', layer: { id: 'kept', type: 'rect' } });
  const value = await open(t, { seed: original }); await value.surface.locator('#autosave').uncheck();
  await change(value, '#projectName', 'Synthetic dirty title'); await value.surface.locator('#addText').click(); const before = await snapshot(value);
  await gallery(value); value.page.once('dialog', dialog => dialog.dismiss());
  await value.surface.locator('[data-template-id="square-announcement"]').click(); await twoFrames(value);
  assert.deepEqual(await snapshot(value), before); assert.deepEqual(value.fixture.state.projects.get(value.record.id).document, original);
  await value.surface.locator('#closeTemplates').click(); assert.deepEqual(await snapshot(value), before);
  assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('gallery keyboard browsing cannot move, remove, undo or save the underlying selected draft', async t => {
  const original = applyOperation(createProject({ name: 'Synthetic protected keyboard project' }), { type: 'add', layer: { id: 'protected', type: 'rect', x: 30, y: 50 } });
  const value = await open(t, { seed: original }); await value.surface.locator('#autosave').uncheck();
  await value.surface.locator('[data-layer-id="protected"] .layer-select').click(); await change(value, '#projectName', 'Synthetic unsaved keyboard draft');
  const before = await snapshot(value); await gallery(value); const card = value.surface.locator('[data-template-id="quote-card"]'); await card.focus();
  for (const key of ['ArrowRight', 'Shift+ArrowDown', 'Delete', 'Backspace', 'Control+z', 'Control+y', 'Control+s']) {
    await card.press(key); await twoFrames(value); assert.deepEqual(await snapshot(value), before, `${key} must not affect the canvas while browsing`);
  }
  assert.equal(value.fixture.state.requests.some(row => row.method === 'POST'), false);
  assert.equal(value.fixture.state.successfulWrites, 0); assert.deepEqual(value.fixture.state.projects.get(value.record.id).document, original);
  await value.surface.locator('#closeTemplates').click(); await value.surface.locator('#artboard').focus(); await value.surface.locator('#artboard').press('ArrowRight');
  assert.equal((await snapshot(value)).project.layers[0].x, before.project.layers[0].x + 1, 'Canvas keyboard editing resumes after the dialog closes'); clean(value);
});

async function pasteImage(locator, bytes) {
  return locator.evaluate((node, png) => {
    const clipboard = new DataTransfer(); clipboard.items.add(new File([new Uint8Array(png)], 'synthetic-template-paste.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  }, [...bytes]);
}

test('raster paste while browsing neither uploads nor changes the draft, but normal editor paste still works', async t => {
  const original = applyOperation(createProject({ name: 'Synthetic protected clipboard project' }), { type: 'add', layer: { id: 'clipboard-kept', type: 'rect' } });
  const value = await open(t, { seed: original }); await value.surface.locator('#autosave').uncheck(); await change(value, '#projectName', 'Synthetic unsaved clipboard draft');
  const before = await snapshot(value), png = await syntheticImage(); await gallery(value);
  const card = value.surface.locator('[data-template-id="quote-card"]'); await card.focus();
  assert.equal(await pasteImage(card, png), false, 'The editor must not consume clipboard images behind a modal'); await twoFrames(value);
  assert.deepEqual(await snapshot(value), before); assert.equal(value.fixture.state.uploads, 0);
  assert.equal(value.fixture.state.requests.some(row => row.method === 'POST'), false); assert.equal(value.fixture.state.successfulWrites, 0);
  await value.surface.locator('#templateSearch').fill('quote'); assert.equal(await value.surface.locator('#templateGrid button').count(), 1);
  await value.surface.locator('#closeTemplates').click(); await value.surface.locator('#artboard').focus();
  assert.equal(await pasteImage(value.surface.locator('#artboard'), png), true); await value.surface.locator('#layerCount').filter({ hasText: /^2$/ }).waitFor();
  assert.equal(value.fixture.state.uploads, 1); assert.equal((await snapshot(value)).project.layers.at(-1).type, 'image');
  assert.deepEqual(value.fixture.state.projects.get(value.record.id).document, original); assert.equal(value.fixture.state.successfulWrites, 0);
  assert.deepEqual(value.errors, []); assert.deepEqual(value.external, []);
});

for (const permissions of [{ create: false }, { create: false, change: true }]) test(`template application is denied without create permission (${JSON.stringify(permissions)})`, async t => {
  const seed = permissions.change ? applyOperation(createProject({ name: 'Synthetic editable existing project' }), { type: 'add', layer: { id: 'held', type: 'rect' } }) : null;
  const value = await open(t, { permissions, seed, query: { template: 'quote-card' } }); const before = await snapshot(value);
  await gallery(value); assert.equal(await value.surface.locator('#templatePermission').isVisible(), true);
  for (const card of await value.surface.locator('#templateGrid button').all()) assert.equal(await card.isDisabled(), true);
  await value.surface.locator('[data-template-id="quote-card"]').evaluate(node => node.onclick(new Event('click'))); await twoFrames(value);
  assert.deepEqual(await snapshot(value), before);
  assert.equal(before.project.name, seed?.name ?? 'Untitled image'); assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('held project loading blocks gallery selection and project query takes precedence over template query', async t => {
  const seed = applyOperation(createProject({ name: 'Synthetic priority project' }), { type: 'add', layer: { id: 'kept', type: 'rect' } });
  let readSeen; const seen = new Promise(done => { readSeen = done; });
  const value = await open(t, { seed, holdReads: true, onHeldRead: readSeen, waitReady: false, query: { template: 'story-promo' } }); await seen;
  await value.surface.locator('#saveStatus').filter({ hasText: /Loading/ }).waitFor();
  assert.equal(await value.surface.locator('#openTemplates').isDisabled(), true);
  await value.surface.locator('#openTemplates').evaluate(node => node.click()); assert.equal(await value.surface.locator('#templateDialog').isVisible(), false);
  assert.equal(value.fixture.state.pendingReads.length, 1); value.fixture.state.pendingReads.shift()(); await saved(value);
  assert.deepEqual((await snapshot(value)).project, seed); assert.equal((await snapshot(value)).id, value.record.id);
  assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('unknown template query reports an error without silently seeding or writing a project', async t => {
  const value = await open(t, { query: { template: 'unknown-template' } }); await value.surface.locator('#editorError').waitFor();
  assert.match(await value.surface.locator('#editorError').innerText(), /template|available|unknown/i);
  assert.equal((await snapshot(value)).project.layers.length, 0); assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

async function inViewport(locator) {
  return locator.evaluate(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1; });
}

for (const theme of ['workspace', 'midnight']) test(`${theme} template dialog stays usable on a narrow viewport and follows portal palette changes`, async t => {
  const value = await open(t, { theme, width: 390, height: 844 }); await gallery(value);
  await value.surface.locator(`html[data-theme="${theme}"]`).waitFor();
  assert.equal(await inViewport(value.surface.locator('#templateDialog')), true);
  for (const id of ['templateSearch', 'templateCategory', 'closeTemplates']) assert.equal(await inViewport(value.surface.locator('#' + id)), true, id);
  await screenshot(value, 'templates-' + theme + '-narrow');
  await value.surface.locator('[data-template-id="profile-banner"]').scrollIntoViewIfNeeded();
  assert.equal(await inViewport(value.surface.locator('[data-template-id="profile-banner"]')), true);
  const overflow = await value.surface.locator('html').evaluate(node => node.scrollWidth > innerWidth + 1); assert.equal(overflow, false);
  await screenshot(value, 'templates-' + theme + '-narrow-last-card'); await value.surface.locator('#closeTemplates').click();
  const next = theme === 'workspace' ? 'midnight' : 'workspace'; await value.page.locator('#' + next).click(); await gallery(value);
  await value.surface.locator(`html[data-theme="${next}"]`).waitFor();
  const opaque = await value.surface.locator('#templateDialog').evaluate(node => { const color = getComputedStyle(node).backgroundColor; return !color.startsWith('rgba') || color.endsWith(', 1)'); });
  assert.equal(opaque, true); assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('the actual New template card opens the editor gallery and selecting a design creates only an unsaved composition', async t => {
  const html = await readFile(fileURLToPath(new URL('../../tools/create-new.html', import.meta.url)), 'utf8');
  const value = await open(t, { beforeGoto: async ({ context }) => {
    await context.route('**/api/create/new', route => route.fulfill({ contentType: 'text/html', body: html }));
    await context.route('**/api/authorization/me*', route => route.fulfill({ json: { status: 'enforced', tier: 'manager', denied: false } }));
    await context.route('**/api/presentations/sections/starters', route => route.fulfill({ json: { kinds: [], starters: [] } }));
  } });
  await value.page.goto(value.fixture.origin + '/api/create/new');
  const admitted = value.page.waitForResponse(response => new URL(response.url()).pathname === '/api/authorization/me' && new URL(response.url()).searchParams.get('app') === 'create');
  await value.page.reload(); await (await admitted).finished(); await value.page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await value.page.getByRole('button', { name: /^Image templates/ }).click();
  await value.page.waitForURL(url => url.pathname === '/api/create/editor' && url.searchParams.get('templates') === '1');
  assert.equal(new URL(value.page.url()).search, '?templates=1');
  await value.page.locator('#templateDialog').waitFor(); assert.equal(value.fixture.state.successfulWrites, 0);
  await value.page.locator('[data-template-id="square-announcement"]').click();
  await value.page.locator('#layerCount').filter({ hasNotText: /^0$/ }).waitFor();
  assert.equal(await value.page.locator('#canvasWidth').inputValue(), '1080'); assert.equal(await value.page.locator('#canvasHeight').inputValue(), '1080');
  assert.equal(value.fixture.state.successfulWrites, 0); assert.equal(value.fixture.state.projects.size, 0); clean(value);
});

test('an exact template deep link seeds its design only after access resolves and preserves its known dimensions', async t => {
  let release, observed; const hold = new Promise(done => { release = done; }), seen = new Promise(done => { observed = done; });
  t.after(() => release());
  const value = await open(t, { query: { template: 'profile-banner' }, waitReady: false, beforeGoto: async ({ context }) => {
    await context.route('**/api/create/permissions', route => { observed(); return hold.then(() => route.continue()); });
  } }); await seen;
  assert.equal((await snapshot(value)).project.layers.length, 0); assert.equal(await value.surface.locator('#openTemplates').isDisabled(), true);
  release(); await value.surface.locator('#canvasWidth').filter({ visible: true }).waitFor();
  await value.surface.locator('#saveStatus').filter({ hasNotText: /Checking|Loading/ }).waitFor();
  const current = await snapshot(value); assert.equal(current.project.width, 1500); assert.equal(current.project.height, 500);
  assert.equal(current.id, null); assert.equal(current.revision, 0); assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('conflicting template and artifact queries refuse before any artifact content request', async t => {
  const value = await open(t, { query: { template: 'quote-card', artifact: 'synthetic-should-not-fetch' } });
  await value.surface.locator('#editorError').waitFor(); assert.match(await value.surface.locator('#editorError').innerText(), /separately/i);
  assert.equal((await snapshot(value)).project.layers.length, 0);
  assert.equal(value.fixture.state.requests.some(row => row.path.startsWith('/api/artifacts/handles/')), false);
  assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('a saved project does not bypass refusal of mixed template and artifact query context', async t => {
  const original = applyOperation(createProject({ name: 'Synthetic query priority project' }), { type: 'add', layer: { id: 'protected-query', type: 'text', text: 'Keep the saved source' } });
  const value = await open(t, { seed: original, query: { template: 'quote-card', artifact: 'synthetic-should-not-fetch' } });
  await value.surface.locator('#editorError').waitFor(); assert.match(await value.surface.locator('#editorError').innerText(), /separately/i);
  assert.deepEqual((await snapshot(value)).project, original); assert.equal((await snapshot(value)).id, value.record.id);
  assert.equal(value.fixture.state.requests.some(row => row.path.startsWith('/api/artifacts/handles/')), false);
  assert.equal(value.fixture.state.successfulWrites, 0); assert.deepEqual(value.fixture.state.projects.get(value.record.id).document, original); clean(value);
});

test('Midnight desktop gallery displays the actual original designs on the current opaque portal surface', async t => {
  const value = await open(t, { theme: 'midnight' }); await gallery(value);
  await value.surface.locator('html[data-theme="midnight"]').waitFor(); assert.equal(await inViewport(value.surface.locator('#templateDialog')), true);
  await screenshot(value, 'templates-gallery-midnight-desktop'); assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});
