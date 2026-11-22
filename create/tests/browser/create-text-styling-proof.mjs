/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.4: CREATE-TOOL-CREATE-04 real Chromium browser proof — double-click in-place canvas text typing (Escape cancel, Backspace text editing, blur/shortcut single-step commit, locked refusal), on-screen Format text styling (italic, underline, lineHeight, letterSpacing, outline, shadow), autosave/reload, PNG pixel & SVG export checks, concierge apply-edits round-trip, and desktop 1440x900 + phone 412x915 responsiveness.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, startEditorFixture } from './create-editor-fixture.mjs';
import { applyAgentOperations, editingContract } from '../../tools/editor/agent-tools.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || resolve(packageRoot, '../../oshal'));
const sharp = createRequire(resolve(coreRoot, 'package.json'))('sharp');

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function withConciergeRoutes(app, state) {
  app.get('/api/create/editing-contract', (_req, res) => res.json(editingContract()));
  app.post('/api/create/projects/:id/operations', (req, res) => {
    const record = state.projects.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'project_not_found' });
    if (record.revision !== req.body.baseRevision) return res.status(409).json({ error: 'project_revision_conflict' });
    try {
      const document = applyAgentOperations(record.document, req.body.operations);
      const next = { ...record, title: document.name, revision: record.revision + 1, updatedAt: new Date().toISOString(), document };
      state.projects.set(record.id, next);
      state.revisions.get(record.id).push(structuredClone(next));
      state.successfulWrites++;
      res.status(201).json({ project: structuredClone(next) });
    } catch (failure) {
      res.status(400).json({ error: 'invalid_project_operations', detail: failure.message });
    }
  });
}

function seedTextProject(fixture) {
  return fixture.seed({
    version: 1, name: 'Text styling proof', width: 400, height: 240, background: 'transparent', images: {},
    layers: [{
      id: 'headline', type: 'text', name: 'Headline', text: 'Hello\nWorld',
      x: 40, y: 30, w: 320, h: 170, fontFamily: 'sans-serif', fontSize: 36, fontWeight: 700, fill: '#111827', align: 'left',
    }],
  });
}

async function exportFile(page, buttonId) {
  await page.locator('#exportMenu > summary').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(buttonId).click()]);
  return readFile(await download.path());
}

async function analyzePng(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let redOutline = 0, blueShadow = 0, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * 4, r = data[o], g = data[o + 1], b = data[o + 2], a = data[o + 3];
      if (a > 20) { if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
      if (a > 80 && r > 180 && g < 100 && b < 100) redOutline++;
      if (a > 60 && b > 150 && r < 100 && g < 120) blueShadow++;
    }
  }
  return { width: info.width, height: info.height, data, redOutline, blueShadow, maxX, maxY };
}

async function dblClickTextCenter(page) {
  const box = await page.locator('#artboard').boundingBox();
  // Layer is at (40..360, 30..200) inside 400x240 canvas -> center (200, 115).
  await page.mouse.dblclick(box.x + box.width * (200 / 400), box.y + box.height * (115 / 240));
}

async function setNumberProp(page, key, value) {
  const input = page.locator(`[data-editor-property="${key}"]`);
  await input.fill(String(value));
  await input.press('Enter');
}

async function setColorProp(page, key, hex) {
  const input = page.locator(`[data-editor-property="${key}"]`);
  await input.fill(hex);
  await input.dispatchEvent('change');
}

async function verifyInlineTyping(page) {
  await dblClickTextCenter(page);
  const inline = page.locator('#inlineTextEditor');
  await inline.waitFor({ state: 'visible' });
  assert.equal(await inline.inputValue(), 'Hello\nWorld');

  // Backspace edits characters rather than deleting the layer; Escape cancels without dirtying history.
  await page.keyboard.press('Backspace');
  await page.keyboard.type('X');
  assert.equal(await inline.inputValue(), 'Hello\nWorlX');
  await page.keyboard.press('Escape');
  await inline.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-layer-id="headline"]').count(), 1);
  assert.equal(await page.locator('#undo').isDisabled(), true);

  // Double-click, type new text, click outside (blur) -> commits ONE undoable edit step.
  await dblClickTextCenter(page);
  await inline.waitFor({ state: 'visible' });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('s!');
  const box = await page.locator('#artboard').boundingBox();
  await page.mouse.click(box.x + 8, box.y + 8);
  await inline.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#undo').isDisabled(), false);
  await page.getByRole('button', { name: 'Select Headline', exact: true }).click();
  assert.equal(await page.locator('[data-editor-property="text"]').inputValue(), 'Hello\nWorls!');

  // Undo & redo confirm it was a single undoable step.
  await page.locator('#undo').click();
  assert.equal(await page.locator('[data-editor-property="text"]').inputValue(), 'Hello\nWorld');
  await page.locator('#redo').click();
  assert.equal(await page.locator('[data-editor-property="text"]').inputValue(), 'Hello\nWorls!');

  // Double-click + Ctrl+Enter commits; unchanged double-click + blur is a no-op.
  await dblClickTextCenter(page);
  await inline.waitFor({ state: 'visible' });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+Enter');
  await inline.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-editor-property="text"]').inputValue(), 'Hello\nWorls');
}

async function applyAllStylesOnScreen(page) {
  await page.locator('[data-editor-property="italic"]').check();
  await page.locator('[data-editor-property="underline"]').check();
  await setNumberProp(page, 'lineHeight', '2');
  await setNumberProp(page, 'letterSpacing', '8');
  await setColorProp(page, 'stroke', '#ef4444');
  await setNumberProp(page, 'strokeWidth', '4');
  await page.locator('[data-editor-property="shadowEnabled"]').check();
  await setColorProp(page, 'shadowColor', '#2563eb');
  await setNumberProp(page, 'shadowOpacity', '85');
  await setNumberProp(page, 'shadowBlur', '0');
  await setNumberProp(page, 'shadowX', '14');
  await setNumberProp(page, 'shadowY', '10');
}

test('in-place typing, on-screen text styling, save/reload, PNG/SVG export, concierge apply-edits and locked refusal', async t => {
  const fixture = await startEditorFixture({ extend: withConciergeRoutes });
  const record = seedTextProject(fixture);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  t.after(async () => { await context.close(); await fixture.close(); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(`${fixture.origin}/api/create/editor?project=${record.id}`);
  await page.locator('.ef-shell').waitFor();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();

  const initialPng = await analyzePng(await exportFile(page, '#exportPng'));
  await verifyInlineTyping(page);
  await applyAllStylesOnScreen(page);

  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor({ timeout: 8000 });
  const ctxSnap = await page.evaluate(async () => (await import('/api/create/editor/editor-context.mjs')).editorSnapshot().fields);
  assert.equal(ctxSnap.italic, true); assert.equal(ctxSnap.underline, true);
  assert.equal(ctxSnap.lineHeight, 2); assert.equal(ctxSnap.letterSpacing, 8);
  assert.equal(ctxSnap.stroke, '#ef4444'); assert.equal(ctxSnap.strokeWidth, 4);
  assert.equal(ctxSnap.shadow.color, '#2563eb');

  // Reload and verify every control, PNG pixel effect, and SVG attribute persisted.
  await page.reload();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor();
  await page.getByRole('button', { name: 'Select Headline', exact: true }).click();
  assert.equal(await page.locator('[data-editor-property="text"]').inputValue(), 'Hello\nWorls');
  assert.equal(await page.locator('[data-editor-property="italic"]').isChecked(), true);
  assert.equal(await page.locator('[data-editor-property="underline"]').isChecked(), true);
  assert.equal(await page.locator('[data-editor-property="lineHeight"]').inputValue(), '2');
  assert.equal(await page.locator('[data-editor-property="letterSpacing"]').inputValue(), '8');
  assert.equal(await page.locator('[data-editor-property="strokeWidth"]').inputValue(), '4');
  assert.equal(await page.locator('[data-editor-property="shadowEnabled"]').isChecked(), true);

  const styledPng = await analyzePng(await exportFile(page, '#exportPng'));
  assert.ok(styledPng.redOutline > 40, `redOutline=${styledPng.redOutline}`);
  assert.ok(styledPng.blueShadow > 40, `blueShadow=${styledPng.blueShadow}`);
  assert.ok(styledPng.maxY > initialPng.maxY + 15, `maxY ${styledPng.maxY} vs ${initialPng.maxY}`);
  assert.ok(styledPng.maxX > initialPng.maxX + 15, `maxX ${styledPng.maxX} vs ${initialPng.maxX}`);

  const styledSvg = (await exportFile(page, '#exportSvg')).toString('utf8');
  assert.match(styledSvg, /font-style="italic"/);
  assert.match(styledSvg, /text-decoration="underline"/);
  assert.match(styledSvg, /letter-spacing="8px"/);
  assert.match(styledSvg, /stroke="#ef4444" stroke-width="4" stroke-linejoin="round" paint-order="stroke fill"/);
  assert.match(styledSvg, /<feDropShadow dx="14" dy="10" stdDeviation="0" flood-color="#2563eb"/);
  assert.match(styledSvg, /y="72"/);

  // Concierge rejects out-of-range style, then updates & clears styles cleanly via POST /projects/:id/operations.
  const badRes = await fetch(`${fixture.origin}/api/create/projects/${record.id}/operations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: record.id, baseRevision: 2, operations: [{ type: 'update', id: 'headline', patch: { lineHeight: 9 } }] }),
  });
  assert.equal(badRes.status, 400);

  const agentRes = await fetch(`${fixture.origin}/api/create/projects/${record.id}/operations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: record.id, baseRevision: 2, operations: [{ type: 'update', id: 'headline', patch: {
      italic: false, underline: true, lineHeight: 1.5, letterSpacing: 3, stroke: '#16a34a', strokeWidth: 2, shadow: null,
    } }] }),
  });
  assert.equal(agentRes.status, 201);
  await page.reload();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 3' }).waitFor();
  await page.getByRole('button', { name: 'Select Headline', exact: true }).click();
  assert.equal(await page.locator('[data-editor-property="italic"]').isChecked(), false);
  assert.equal(await page.locator('[data-editor-property="underline"]').isChecked(), true);
  assert.equal(await page.locator('[data-editor-property="shadowEnabled"]').isChecked(), false);
  const agentSvg = (await exportFile(page, '#exportSvg')).toString('utf8');
  assert.doesNotMatch(agentSvg, /font-style="italic"/);
  assert.match(agentSvg, /text-decoration="underline"/);
  assert.match(agentSvg, /letter-spacing="3px"/);
  assert.match(agentSvg, /stroke="#16a34a" stroke-width="2"/);
  assert.doesNotMatch(agentSvg, /feDropShadow/);

  // Locking text refuses double-click inline edit and concierge edits.
  await page.getByRole('button', { name: 'Lock Headline', exact: true }).click();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 4' }).waitFor({ timeout: 6000 });
  await dblClickTextCenter(page);
  assert.equal(await page.locator('#inlineTextEditor').isVisible(), false);
  const lockedRes = await fetch(`${fixture.origin}/api/create/projects/${record.id}/operations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: record.id, baseRevision: 4, operations: [{ type: 'update', id: 'headline', patch: { italic: true } }] }),
  });
  assert.equal(lockedRes.status, 400);

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

test('text styling Format controls stay usable with zero horizontal overflow on phone 412x915', async t => {
  const fixture = await startEditorFixture({ extend: withConciergeRoutes });
  const record = seedTextProject(fixture);
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  t.after(async () => { await context.close(); await fixture.close(); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(`${fixture.origin}/api/create/editor?project=${record.id}`);
  await page.locator('.ef-shell').waitFor();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();

  await page.locator('.ef-tools').getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('button', { name: 'Select Headline', exact: true }).click();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await page.locator('.ef-tools').getByRole('button', { name: 'Properties', exact: true }).click();

  await page.locator('[data-editor-property="italic"]').check();
  await page.locator('[data-editor-property="underline"]').check();
  await page.locator('[data-editor-property="shadowEnabled"]').check();
  assert.equal(await page.locator('[data-editor-property="italic"]').isChecked(), true);
  assert.equal(await page.locator('[data-editor-property="underline"]').isChecked(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});
