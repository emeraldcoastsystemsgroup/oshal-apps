/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.5: real Chromium browser proof at 1440x900 and 412x915 covering CREATE-TOOL-CREATE-02 (Left/Center/Right text alignment buttons persisting across reload & PNG/SVG export, synced with concierge align patches & revision restore) and CREATE-TOOL-CREATE-10 / CREATE-TOOL-BRAND-03 (Apply my brand button applying kit colors/fonts/logo once and reverting in one Undo step, matching server apply-brand).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, syntheticImage, startBrandFixture, seedLogo } from './create-brand-fixture.mjs';
import { defaultBrandKit, applyBrandToProject } from '../../tools/editor/brand-kit.mjs';
import { applyAgentOperations } from '../../tools/editor/agent-tools.mjs';
import { validateProject } from '../../tools/editor/model-validation.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || resolve(packageRoot, '../../oshal'));
const sharp = createRequire(resolve(coreRoot, 'package.json'))('sharp');

const KIT = {
  ...defaultBrandKit(), name: 'Harbor',
  colors: { primary: '#123abc', secondary: '#2a9d8f', accent: '#0a84ff', dark: '#111827', light: '#fafaf7' },
  fonts: { heading: 'Georgia', body: 'Garamond' },
};

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function mountParityRoutes(app, state, brand) {
  app.post('/api/create/projects/:id/operations', (req, res) => {
    const record = state.projects.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'project_not_found' });
    if (record.revision !== req.body.baseRevision) return res.status(409).json({ error: 'project_revision_conflict' });
    const document = applyAgentOperations(record.document, req.body.operations);
    const next = { ...record, title: document.name, revision: record.revision + 1, updatedAt: new Date().toISOString(), document };
    state.projects.set(record.id, next); state.revisions.get(record.id).push(structuredClone(next));
    res.status(201).json({ project: structuredClone(next) });
  });
  app.post('/api/create/projects/:id/revisions/restore', (req, res) => {
    const record = state.projects.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'project_not_found' });
    const list = state.revisions.get(record.id);
    const target = req.body?.revision ? list.find(r => r.revision === req.body.revision) : list.at(-2);
    if (!target) return res.status(409).json({ error: 'project_no_previous_revision' });
    const next = { ...record, title: target.title, revision: record.revision + 1, updatedAt: new Date().toISOString(), document: structuredClone(target.document) };
    state.projects.set(record.id, next); list.push(structuredClone(next));
    res.status(201).json({ project: structuredClone(next), restoredFromRevision: target.revision });
  });
  app.post('/api/create/projects/:id/apply-brand', (req, res) => {
    const record = state.projects.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'project_not_found' });
    if (!brand.kit) return res.status(404).json({ error: 'brand_kit_not_found' });
    const { project, changes } = applyBrandToProject(record.document, brand.kit);
    const document = validateProject(project, { assetMode: 'reference' });
    const next = { ...record, title: document.name, revision: record.revision + 1, updatedAt: new Date().toISOString(), document };
    state.projects.set(record.id, next); state.revisions.get(record.id).push(structuredClone(next));
    res.status(201).json({ project: structuredClone(next), changes, brandKitRevision: brand.revision });
  });
}

async function startParityFixture(options = {}) {
  const fixture = await startBrandFixture(options);
  if (options.logo) fixture.brand.kit = { ...fixture.brand.kit, logo: seedLogo(fixture, await syntheticImage(), 40, 20) };
  return fixture;
}

async function exportFile(page, buttonId) {
  await page.locator('#exportMenu > summary').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(buttonId).click()]);
  return readFile(await download.path());
}

async function inkCenterX(pngBytes) {
  const { data, info } = await sharp(pngBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sumX = 0, count = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const a = data[(y * info.width + x) * 4 + 3];
      if (a > 40) { sumX += x; count++; }
    }
  }
  return count ? sumX / count : -1;
}

async function editorDoc(page) {
  return page.evaluate(async () => structuredClone((await import('/api/create/editor/editor-state.mjs')).state.project));
}

test('desktop 1440x900: Left/Center/Right text alignment moves pixels & SVG, persists reload, and syncs with concierge + restore', async t => {
  const fixture = await startParityFixture({ kit: KIT, logo: true });
  // Attach parity routes directly onto the fixture app via a fresh fixture with extend wrapper:
  const parity = await startBrandFixture({ kit: KIT, extend: undefined });
  await parity.close();
  await fixture.close();
  const { startEditorFixture } = await import('./create-editor-fixture.mjs');
  const brand = { kit: null, revision: 1, read: true, change: true };
  const server = await startEditorFixture({
    extend: (app, state) => {
      app.get('/api/create/brand-kit', (_req, res) => res.json({ kit: brand.kit, revision: brand.revision, updatedAt: new Date().toISOString(), canChange: true, words: null }));
      mountParityRoutes(app, state, brand);
    },
  });
  brand.kit = { ...KIT, logo: seedLogo(server, await syntheticImage(), 40, 20) };
  const record = server.seed({
    version: 1, name: 'Alignment proof', width: 400, height: 180, background: 'transparent', images: {},
    layers: [{ id: 'headline', type: 'text', name: 'Headline', text: 'HI', x: 20, y: 40, w: 360, h: 80, fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, fill: '#111827', align: 'left' }],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  t.after(async () => { await context.close(); await server.close(); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(`${server.origin}/api/create/editor?project=${record.id}`);
  await page.locator('.ef-shell').waitFor();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();
  await page.getByRole('button', { name: 'Select Headline', exact: true }).click();
  await page.locator('#textAlignControls:not([hidden])').waitFor();
  assert.equal(await page.locator('#textAlignLeft').getAttribute('aria-pressed'), 'true');

  const leftX = await inkCenterX(await exportFile(page, '#exportPng'));
  await page.locator('#textAlignCenter').click();
  assert.equal(await page.locator('#textAlignCenter').getAttribute('aria-pressed'), 'true');
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor({ timeout: 8000 });
  const centerX = await inkCenterX(await exportFile(page, '#exportPng'));
  assert.ok(centerX > leftX + 80, `centerX (${centerX}) should shift right of leftX (${leftX})`);
  const centerSvg = (await exportFile(page, '#exportSvg')).toString('utf8');
  assert.match(centerSvg, /text-anchor="middle"/);

  await page.reload();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor();
  await page.getByRole('button', { name: 'Select Headline', exact: true }).click();
  assert.equal(await page.locator('#textAlignCenter').getAttribute('aria-pressed'), 'true');

  // Concierge aligns right (rev 3), then restores previous revision (rev 4 -> back to center).
  const rightRes = await fetch(`${server.origin}/api/create/projects/${record.id}/operations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: record.id, baseRevision: 2, operations: [{ type: 'update', id: 'headline', patch: { align: 'right' } }] }),
  });
  assert.equal(rightRes.status, 201);
  await page.reload();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 3' }).waitFor();
  await page.getByRole('button', { name: 'Select Headline', exact: true }).click();
  assert.equal(await page.locator('#textAlignRight').getAttribute('aria-pressed'), 'true');

  const undoRes = await fetch(`${server.origin}/api/create/projects/${record.id}/revisions/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: record.id }),
  });
  assert.equal(undoRes.status, 201);
  assert.equal((await undoRes.json()).restoredFromRevision, 2);
  await page.reload();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 4' }).waitFor();
  await page.getByRole('button', { name: 'Select Headline', exact: true }).click();
  assert.equal(await page.locator('#textAlignCenter').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

test('desktop 1440x900 & phone 412x915: Apply my brand updates colors/fonts/logo once and single Undo restores pre-brand state', async t => {
  const { startEditorFixture } = await import('./create-editor-fixture.mjs');
  const brand = { kit: null, revision: 1 };
  const server = await startEditorFixture({
    extend: (app, state) => {
      app.get('/api/create/brand-kit', (_req, res) => res.json({ kit: brand.kit, revision: brand.revision, updatedAt: new Date().toISOString(), canChange: true, words: null }));
      mountParityRoutes(app, state, brand);
    },
  });
  brand.kit = { ...KIT, logo: seedLogo(server, await syntheticImage(), 40, 20) };
  const record = server.seed({
    version: 1, name: 'Unbranded poster', width: 800, height: 600, background: '#e2e8f0', images: {},
    layers: [
      { id: 'hero', type: 'rect', name: 'Hero', x: 40, y: 40, w: 300, h: 160, fill: '#ef4444' },
      { id: 'title', type: 'text', name: 'Title', text: 'Summer Sale', x: 40, y: 240, w: 500, h: 80, fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, fill: '#000000', align: 'left' },
      { id: 'sub', type: 'text', name: 'Subtitle', text: 'Limited time', x: 40, y: 340, w: 500, h: 50, fontFamily: 'sans-serif', fontSize: 22, fontWeight: 400, fill: '#334155', align: 'left' },
    ],
  });

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mobile = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  t.after(async () => { await desktop.close(); await mobile.close(); await server.close(); });

  const page = await desktop.newPage(), errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(`${server.origin}/api/create/editor?project=${record.id}`);
  await page.locator('.ef-shell').waitFor();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();
  const beforeDoc = await editorDoc(page);

  await page.locator('#applyBrandBtn').waitFor({ state: 'visible' });
  await page.locator('#applyBrandBtn').click();
  const branded = await editorDoc(page);
  assert.equal(branded.background, KIT.colors.light);
  assert.equal(branded.layers.find(l => l.id === 'hero').fill, KIT.colors.primary);
  assert.equal(branded.layers.find(l => l.id === 'title').fontFamily, KIT.fonts.heading);
  assert.equal(branded.layers.find(l => l.id === 'sub').fontFamily, KIT.fonts.body);
  assert.equal(branded.layers.filter(l => l.name === 'Brand logo').length, 1);

  // Second click does not duplicate the logo.
  await page.locator('#applyBrandBtn').click();
  assert.equal((await editorDoc(page)).layers.filter(l => l.name === 'Brand logo').length, 1);

  // One single Undo restores every layer and removes the added logo.
  await page.locator('#undo').click();
  assert.deepEqual(await editorDoc(page), beforeDoc);

  // Server apply-brand matches the editor result and returns layer changes.
  const apiApply = await fetch(`${server.origin}/api/create/projects/${record.id}/apply-brand`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: record.id }),
  });
  assert.equal(apiApply.status, 201);
  const apiBody = await apiApply.json();
  assert.equal(apiBody.project.document.background, KIT.colors.light);
  assert.equal(apiBody.project.document.layers.find(l => l.id === 'hero').fill, KIT.colors.primary);
  assert.equal(apiBody.project.document.layers.filter(l => l.name === 'Brand logo').length, 1);
  assert.ok(apiBody.changes.length >= 4);

  // Phone 412x915 touch targets and zero horizontal overflow.
  const mpage = await mobile.newPage();
  mpage.on('pageerror', err => errors.push(err.message));
  await mpage.goto(`${server.origin}/api/create/editor?project=${record.id}`);
  await mpage.locator('.ef-shell').waitFor();
  await mpage.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor();
  await mpage.locator('.ef-tools').getByRole('button', { name: 'Layers', exact: true }).click();
  await mpage.getByRole('button', { name: 'Select Title', exact: true }).click();
  await mpage.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await mpage.locator('.ef-tools').getByRole('button', { name: 'Properties', exact: true }).click();
  const centerBox = await mpage.locator('#textAlignCenter').boundingBox();
  assert.ok(centerBox && centerBox.height >= 44, `phone align button height >= 44px (${centerBox?.height})`);
  await mpage.locator('#textAlignCenter').click();
  assert.equal(await mpage.locator('#textAlignCenter').getAttribute('aria-pressed'), 'true');
  assert.equal(await mpage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});
