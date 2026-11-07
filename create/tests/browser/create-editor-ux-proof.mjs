/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (create--create-editor, grade D): drive the real editor and the shared editor foundation at 412x915 touch and 1440x900 through the app row (document menu, Undo, Redo, Saved caption, one primary), automatic saving, the Insert sheet and rail, the pen's and Select's bar-only options, the one Format inspector with the canvas when nothing is selected, the 16 px offset for a new layer, the concierge's copy and Export as the finishing primary. Synthetic fixture data only; no model call.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The New sheet's sized blank starts: ?size=1080x1080 and ?size=1920x1080 open a blank canvas of exactly that size, and an out-of-range size is refused with a message instead of a canvas.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, startEditorFixture, inMenu } from './create-editor-fixture.mjs';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

async function open(t, device = DESKTOP, options = {}, query = '') {
  const fixture = await startEditorFixture(options), context = await browser.newContext(device);
  t.after(async () => { await context.close(); await fixture.close(); });
  await context.addInitScript(() => { localStorage.setItem('cockpit-theme', 'light-blue'); localStorage.setItem('cockpit-application-colors', 'false'); });
  const page = await context.newPage(), errors = []; page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${fixture.origin}/api/create/editor${query}`); await page.locator('.ef-shell').waitFor();
  await page.locator('#saveStatus').filter({ hasNotText: /Checking|Loading/ }).waitFor();
  return { page, fixture, errors };
}
const box = locator => locator.evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right }; });
const layers = page => page.evaluate(async () => (await import('/api/create/editor/editor-state.mjs')).state.project.layers.map(({ x, y, type }) => ({ x, y, type })));
async function shot(page, name) {
  if (!process.env.CREATE_EDITOR_UX_SCREENSHOT_DIR) return;
  await mkdir(process.env.CREATE_EDITOR_UX_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(process.env.CREATE_EDITOR_UX_SCREENSHOT_DIR, name + '.png') });
}

test('a second new layer lands 16 px from the first instead of stacking at (180, 160)', async t => {
  const { page, errors } = await open(t);
  await page.locator('#addRectangle').click(); await page.locator('#addText').click(); await page.locator('#addEllipse').click();
  assert.deepEqual(await layers(page), [{ x: 180, y: 160, type: 'rect' }, { x: 196, y: 176, type: 'text' }, { x: 212, y: 192, type: 'ellipse' }]);
  assert.deepEqual(errors, []);
});

test("the New sheet's sized blank starts open a canvas of exactly that size", async t => {
  for (const [w, h] of [[1080, 1080], [1920, 1080]]) {
    const { page, errors } = await open(t, DESKTOP, {}, `?size=${w}x${h}`);
    await page.locator('#artboard').and(page.locator(`[width="${w}"]`)).waitFor();
    assert.equal(await page.locator('#artboard').getAttribute('height'), String(h));
    assert.equal(await page.locator('#canvasDimensions').textContent(), `${w} × ${h}`);
    assert.deepEqual(await layers(page), [], 'a blank start has no layers');
    assert.deepEqual(errors, []);
  }
  const { page } = await open(t, DESKTOP, {}, '?size=99999x5');
  await page.getByText('Choose a canvas size between 16 and 8192 pixels on each side.').first().waitFor();
  assert.equal(await page.locator('#artboard').getAttribute('width'), '1200', 'a refused size keeps the default blank canvas');
});

test('the duplicate Selected layer form is gone and Format with nothing selected is the canvas, never "No object selected"', async t => {
  const { page, errors } = await open(t);
  for (const id of ['layerX', 'layerY', 'layerWidth', 'layerText', 'fontSize', 'layerOpacity', 'noSelection', 'canvasSettings']) assert.equal(await page.locator('#' + id).count(), 0, id);
  assert.equal(await page.getByText('Selected layer', { exact: true }).count(), 0);
  const inspector = page.locator('.ef-inspector');
  assert.doesNotMatch(await inspector.innerText(), /No object selected|Select an object to edit/);
  assert.equal(await page.locator('[data-editor-property="width"]').inputValue(), '1200'); assert.equal(await page.locator('[data-editor-property="height"]').inputValue(), '800');
  await page.locator('[data-editor-property="transparent"]').uncheck(); await page.locator('[data-editor-property="width"]').fill('640'); await page.locator('[data-editor-property="width"]').press('Tab');
  assert.equal(await page.locator('#artboard').getAttribute('width'), '640'); assert.equal(await page.locator('#canvasDimensions').textContent(), '640 × 800');
  await page.locator('#undo').click(); assert.equal(await page.locator('#artboard').getAttribute('width'), '1200');
  await page.locator('#addText').click();
  assert.equal(await page.locator('[data-editor-property="text"]').inputValue(), 'Your title');
  assert.ok((await page.locator('[data-editor-property="fontFamily"] option').allTextContents()).includes('Serif'), 'the Font field keeps the font list');
  assert.deepEqual(errors, []);
});

test('the phone app row is one row of document menu, Undo, Redo, a Saved caption and one primary Add', async t => {
  const { page, fixture, errors } = await open(t, PHONE);
  const row = await box(page.locator('.editor-header'));
  assert.ok(row.h <= 48, `app row is ${row.h}px`); assert.equal(row.y, 0);
  for (const selector of ['#documentMenu > summary', '#undo', '#redo', '#addPrimary']) {
    const item = await box(page.locator(selector)); assert.ok(item.h >= 44 && item.y >= row.y && item.bottom <= row.y + row.h + 1, selector);
  }
  assert.equal(await page.locator('#documentTitle').textContent(), 'Untitled image');
  assert.equal(await page.locator('#saveProject').isVisible(), false, 'Save is never the primary');
  assert.equal(await page.locator('#exportMenu').isVisible(), false);
  const primaries = await page.locator('button.primary:visible, summary.primary:visible').count(); assert.equal(primaries, 1);
  const body = await page.locator('body').innerText(); assert.doesNotMatch(body, /Unsaved changes|Autosave saved projects/);
  await page.locator('#addPrimary').tap(); const sheet = page.locator('.ef-sheet'); await sheet.waitFor();
  assert.equal(await page.locator('.ef-sheet-heading').textContent(), 'Add');
  assert.deepEqual((await sheet.locator('.tool-label').allTextContents()), ['Image', 'Text', 'Rectangle', 'Ellipse', 'Draw', 'Vector pen', 'Adjustment layer', 'OSHAL files', 'Templates']);
  await shot(page, 'phone-insert-sheet');
  await sheet.locator('#addText').tap(); await sheet.waitFor({ state: 'hidden' });
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor({ timeout: 6000 });
  assert.equal(fixture.state.projects.size, 1, 'automatic saving saved the new image through the create route');
  assert.equal((await page.locator('#saveStatus > span').first().textContent()), 'Saved');
  await shot(page, 'phone-saved');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
});

test('the document menu holds New, Open, My projects, Save a copy, Export and Delete last, and Export opens its own sheet', async t => {
  const { page, fixture, errors } = await open(t, PHONE);
  await page.locator('#addPrimary').tap(); await page.locator('#addRectangle').tap();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor({ timeout: 6000 });
  await page.locator('#documentMenu > summary').tap(); const sheet = page.locator('.ef-sheet'); await sheet.waitFor();
  const items = await sheet.locator('.ef-sheet-content > .menu-list > :not([hidden], input)').evaluateAll(nodes => nodes.map(node => (node.matches('details') ? node.querySelector(':scope > summary') : node).textContent.trim()));
  for (const name of ['New', 'Open…', 'My projects', 'Save a copy', 'Export…', 'Save automatically']) assert.ok(items.some(item => item.startsWith(name)), name);
  assert.equal(items.at(-1), 'Delete image…');
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'projectName', 'opening the menu does not raise the phone keyboard');
  await shot(page, 'phone-document-menu');
  await sheet.locator('#exportFromMenu').tap();
  await page.locator('.ef-sheet-heading').filter({ hasText: 'Export' }).waitFor();
  assert.ok(await page.locator('.ef-sheet #exportPng').isVisible());
  await page.locator('.ef-sheet-close').tap();
  page.once('dialog', dialog => dialog.accept()); await (await inMenu(page, '#deleteProject')).tap();
  await page.locator('#saveStatus').filter({ hasText: 'Not saved yet' }).waitFor();
  assert.equal(fixture.state.projects.size, 0); assert.equal(await page.locator('#layerCount').textContent(), '0'); assert.deepEqual(errors, []);
});

test('Save returns beside the caption only while automatic saving is off', async t => {
  const { page, fixture, errors } = await open(t);
  await page.locator('#addRectangle').click(); await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor({ timeout: 6000 });
  await (await inMenu(page, '#autosave')).uncheck(); await page.locator('#documentMenu > summary').click();
  await page.locator('#addText').click();
  await page.locator('#saveProject').waitFor(); assert.match(await page.locator('#saveStatus').textContent(), /^Not saved/);
  await page.waitForTimeout(1700); assert.equal(fixture.state.projects.values().next().value.revision, 1, 'nothing saves by itself while it is off');
  await page.locator('#saveProject').click(); await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor();
  assert.equal(await page.locator('#saveProject').isVisible(), false); assert.deepEqual(errors, []);
});

test("the pen's Closed path, Finish and Cancel and Select's options appear in the canvas bar only while their tool is on", async t => {
  const { page, errors } = await open(t);
  for (const id of ['vectorClosed', 'finishVector', 'cancelVector', 'regionShape', 'selectWholeImage', 'clearRegion']) assert.equal(await page.locator('#' + id).isVisible(), false, id);
  const before = await box(page.locator('#artboard'));
  await page.locator('#vectorPen').click();
  for (const id of ['vectorClosed', 'finishVector', 'cancelVector']) assert.equal(await page.locator(`.canvas-toolbar #${id}`).isVisible(), true, id);
  assert.deepEqual(await box(page.locator('#artboard')), before, 'the canvas does not move when the options appear');
  await page.locator('#cancelVector').click(); assert.equal(await page.locator('#finishVector').isVisible(), false);
  await page.locator('#regionMode').click(); assert.equal(await page.locator('#regionMode').textContent(), 'Select');
  for (const id of ['regionShape', 'selectWholeImage', 'clearRegion']) assert.equal(await page.locator(`.canvas-toolbar #${id}`).isVisible(), true, id);
  await page.locator('#regionMode').click(); assert.equal(await page.locator('#regionShape').isVisible(), false); assert.deepEqual(errors, []);
});

test('desktop: Insert is a 48 px rail beside Layers, the concierge starts closed and says image, Export is the finishing primary once there is content', async t => {
  const { page, errors } = await open(t);
  const rail = await box(page.locator('#insertMenu')); assert.ok(rail.w <= 49, `rail is ${rail.w}px`);
  for (const id of ['uploadImage', 'addText', 'addRectangle', 'addEllipse', 'drawMode', 'vectorPen', 'addAdjustment', 'chooseArtifact', 'openTemplates']) {
    const tool = await box(page.locator('#' + id)); assert.ok(tool.w >= 44 && tool.h >= 44 && tool.right <= rail.right + 1, id);
  }
  assert.equal(await page.locator('#addPrimary').isVisible(), false);
  assert.equal(await page.locator('.ef-concierge').isVisible(), false, 'no fourth column');
  assert.match(await page.locator('.ef-assistant-help').textContent(), /this image/); assert.doesNotMatch(await page.locator('.ef-assistant-help').textContent(), /document/);
  const exportLook = () => page.locator('#exportMenu > summary').evaluate(node => getComputedStyle(node).backgroundColor);
  const accent = await page.locator('#exportMenu > summary').evaluate(node => { const probe = document.createElement('span'); probe.style.color = 'var(--accent-primary)'; node.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; });
  assert.notEqual(await exportLook(), accent, 'Export is not the primary on an empty canvas');
  await page.locator('#addRectangle').click(); assert.equal(await exportLook(), accent, 'Export is the finishing primary once the canvas has content');
  await shot(page, 'desktop-content'); assert.deepEqual(errors, []);
});
