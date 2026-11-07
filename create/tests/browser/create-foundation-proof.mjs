/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive shared properties through the actual Create canvas, immutable saves and phone drawers on isolated synthetic project HTTP.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: Save automatically is turned off through the document menu, New is pressed in it, the navigation pane is named Layers and the phone's app row (document menu, Undo, Redo, Add) is checked for touch size.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProject, applyOperation } from '../../tools/editor/model.mjs';
import { chromium, startEditorFixture, inMenu, manualSaving } from './create-editor-fixture.mjs';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function drawing() {
  let value = createProject({ name: 'Foundation review', width: 1200, height: 800 });
  value = applyOperation(value, { type: 'add', layer: { id: 'first', type: 'rect', name: 'First rectangle', x: 100, y: 100, w: 300, h: 200, fill: '#345678' } });
  return applyOperation(value, { type: 'add', layer: { id: 'second', type: 'text', name: 'Second text', x: 650, y: 100, w: 300, h: 100, text: 'Keep this text' } });
}
async function open(t, options = {}) {
  const fixture = await startEditorFixture(options), record = fixture.seed(drawing());
  const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: options.height ?? 800 } });
  t.after(async () => { await context.close(); await fixture.close(); });
  await context.addInitScript(() => { localStorage.setItem('cockpit-theme', 'workspace'); localStorage.setItem('cockpit-application-colors', 'false'); });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${fixture.origin}/api/create/editor?project=${record.id}`);
  await page.locator('.ef-shell').waitFor(); await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();
  await manualSaving(page);
  return { page, fixture, record, errors };
}
const property = (page, key) => page.locator(`[data-editor-property="${key}"]`);
async function change(page, key, value) { await property(page, key).fill(String(value)); await property(page, key).press('Tab'); }
async function screenshot(page, name) {
  if (!process.env.CREATE_FOUNDATION_SCREENSHOT_DIR) return;
  await mkdir(process.env.CREATE_FOUNDATION_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(process.env.CREATE_FOUNDATION_SCREENSHOT_DIR, name + '.png'), fullPage: true });
}

test('canvas selection and shared properties retain real undo, saved revisions and unrelated editable text', async t => {
  const { page, fixture, record, errors } = await open(t);
  const bounds = await page.locator('#artboard').boundingBox();
  await page.mouse.click(bounds.x + bounds.width * .2, bounds.y + bounds.height * .2);
  await property(page, 'name').filter({ hasText: '' }).waitFor();
  assert.equal(await property(page, 'name').inputValue(), 'First rectangle');
  await change(page, 'w', 420); await change(page, 'fill', '#dd2200');
  await page.locator('#undo').click(); assert.equal(await property(page, 'fill').inputValue(), '#345678');
  await page.locator('#redo').click(); await page.locator('#saveProject').click();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor();
  const saved = fixture.state.projects.get(record.id);
  assert.equal(saved.document.layers[0].w, 420); assert.equal(saved.document.layers[0].fill, '#dd2200');
  assert.equal(saved.document.layers[1].text, 'Keep this text');
  await page.reload(); await page.getByRole('button', { name: 'Select First rectangle', exact: true }).click();
  assert.equal(await property(page, 'w').inputValue(), '420'); assert.equal(await property(page, 'fill').inputValue(), '#dd2200');
  await screenshot(page, 'create-foundation-desktop'); assert.deepEqual(errors, []);
});

test('pending properties cannot silently move to another selected object', async t => {
  const { page, fixture, record, errors } = await open(t);
  await page.getByRole('button', { name: 'Select First rectangle', exact: true }).click();
  await property(page, 'w').fill('777');
  await page.evaluate(async () => { const { state, notify } = await import('/api/create/editor/editor-state.mjs'); state.selected = 'second'; notify(); });
  await page.locator('.ef-field-status').filter({ hasText: /document or selection changed/ }).waitFor();
  assert.equal(fixture.state.projects.get(record.id).document.layers[0].w, 300);
  await page.locator('.ef-discard').click(); assert.equal(await property(page, 'text').inputValue(), 'Keep this text');
  assert.equal(await page.locator('#saveProject').isDisabled(), true);
  assert.equal(await page.locator('#saveStatus').textContent(), 'Saved · revision 1');
  assert.deepEqual(errors, []);
});

test('shared properties obey the original application read-only permission', async t => {
  const { page, errors } = await open(t, { permissions: { view: true, read: true, create: false, change: false, export: true } });
  await page.getByRole('button', { name: 'Select First rectangle', exact: true }).click();
  assert.equal(await property(page, 'w').isDisabled(), true);
  assert.equal(await page.locator('#saveProject').isDisabled(), true); assert.deepEqual(errors, []);
});

test('Save commits a focused shared field and refuses invalid fields without publishing another revision', async t => {
  const { page, fixture, record, errors } = await open(t);
  await page.getByRole('button', { name: 'Select First rectangle', exact: true }).click();
  await property(page, 'w').fill('440'); await page.locator('#saveProject').click();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor();
  assert.equal(fixture.state.projects.get(record.id).document.layers[0].w, 440);
  await property(page, 'w').fill('-10'); await page.locator('#saveProject').click();
  await property(page, 'w').filter({ hasText: '' }).evaluate(node => node.blur());
  await page.locator('.ef-field-status').filter({ hasText: /greater than|Correct|out of range/i }).waitFor();
  assert.equal(fixture.state.projects.get(record.id).revision, 2); assert.equal(await property(page, 'w').inputValue(), '-10');
  assert.deepEqual(errors, []);
});

test('the existing AI handoff saves focused shared text and returns an editable update to the same layer', async t => {
  const { page, fixture, record, errors } = await open(t);
  await page.getByRole('button', { name: 'Select Second text', exact: true }).click();
  await property(page, 'text').fill('Manual text for the assistant');
  const context = await page.evaluate(async () => { const { beginDocumentHandoff } = await import('/shared/ui/js/document-handoff.js'); window.foundationHandoff = await beginDocumentHandoff(); return window.foundationHandoff.context; });
  const saved = fixture.state.projects.get(record.id);
  assert.equal(context.recordId, record.id); assert.equal(context.fields.revision, 2);
  assert.equal(saved.document.layers[1].text, 'Manual text for the assistant');
  saved.document = applyOperation(saved.document, { type: 'update', id: 'second', patch: { text: 'Assistant adjustment' } }); saved.revision = 3;
  await page.evaluate(() => window.foundationHandoff.refresh());
  assert.equal(await property(page, 'text').inputValue(), 'Assistant adjustment');
  await property(page, 'text').fill('Manual follow-up'); await page.locator('#saveProject').click();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 4' }).waitFor();
  assert.equal(fixture.state.projects.get(record.id).document.layers[1].text, 'Manual follow-up'); assert.deepEqual(errors, []);
});

test('cancelled replacement and failed import preserve pending fields; confirmed New clears them', async t => {
  const { page, fixture, errors } = await open(t);
  await page.getByRole('button', { name: 'Select First rectangle', exact: true }).click();
  await change(page, 'w', -10);
  page.once('dialog', dialog => dialog.dismiss()); await (await inMenu(page, '#newProject')).click();
  assert.equal(await property(page, 'w').inputValue(), '-10');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#projectFile').setInputFiles({ name: 'Broken.create.json', mimeType: 'application/json', buffer: Buffer.from('bad project bytes') });
  await page.locator('#editorError').filter({ hasText: /JSON|Unexpected|project/i }).waitFor();
  assert.equal(await property(page, 'w').inputValue(), '-10');
  assert.equal(await page.evaluate(async () => (await import('/api/create/editor/editor-state.mjs')).state.foundation.hasPending()), true);
  page.once('dialog', dialog => dialog.accept()); await (await inMenu(page, '#newProject')).click();
  assert.equal(await page.evaluate(async () => (await import('/api/create/editor/editor-state.mjs')).state.foundation.hasPending()), false);
  assert.deepEqual(await page.locator('[data-editor-property]').evaluateAll(nodes => nodes.map(node => node.dataset.editorProperty)), ['width', 'height', 'background', 'transparent']);
  await page.locator('#addRectangle').click(); await page.locator('#saveProject').click();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();
  assert.equal(fixture.state.projects.size, 2); assert.deepEqual(errors, []);
});

test('phone drawers keep the document visible and permit property changes without page overflow', async t => {
  const { page, errors } = await open(t, { width: 412, height: 915 });
  for (const selector of ['#documentMenu > summary', '#undo', '#redo', '#addPrimary']) {
    assert.ok((await page.locator(selector).boundingBox()).height >= 44, selector + ' is a usable touch target');
  }
  await page.locator('.ef-tools').getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('button', { name: 'Select First rectangle', exact: true }).click();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await page.locator('.ef-tools').getByRole('button', { name: 'Properties', exact: true }).click();
  await change(page, 'w', 360); assert.equal(await property(page, 'w').inputValue(), '360');
  await screenshot(page, 'create-foundation-phone-properties');
  await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
  assert.ok(await page.locator('#artboard').isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await screenshot(page, 'create-foundation-phone-document'); assert.deepEqual(errors, []);
});

test('compact layer actions expose arrangement deliberately and retain duplicate/delete history', async t => {
  const { page, errors } = await open(t);
  await page.getByRole('button', { name: 'Select First rectangle', exact: true }).click();
  assert.equal(await page.locator('#groupBelow').isVisible(), false);
  await page.locator('#layerArrange summary').press('Enter'); assert.equal(await page.locator('#raiseLayer').isVisible(), true);
  await page.locator('#raiseLayer').focus(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#groupBelow').isVisible(), false);
  assert.equal(await page.locator('#layerArrange summary').evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', { name: 'Duplicate selected layer', exact: true }).click();
  assert.equal(await page.locator('#layerCount').textContent(), '3');
  await page.getByRole('button', { name: 'Delete selected layer', exact: true }).click();
  assert.equal(await page.locator('#layerCount').textContent(), '2');
  await page.locator('#undo').click(); assert.equal(await page.locator('#layerCount').textContent(), '3');
  assert.deepEqual(errors, []);
});

test('shape, outline and shadow properties save actual editable appearance and retain touch actions',async t=>{
 const{page,fixture,record,errors}=await open(t);
 await page.getByRole('button',{name:'Select First rectangle',exact:true}).click();await property(page,'shape').selectOption('diamond');await change(page,'stroke','#203050');await change(page,'strokeWidth',8);await change(page,'dash','12, 6');await property(page,'shadowEnabled').check();await property(page,'shadowX').fill('24');await page.locator('#saveProject').click();await page.locator('#saveStatus').filter({hasText:'Saved · revision 2'}).waitFor();
 const saved=fixture.state.projects.get(record.id).document;assert.equal(saved.version,4);assert.equal(saved.layers[0].shape,'diamond');assert.deepEqual(saved.layers[0].dash,[12,6]);assert.equal(saved.layers[0].shadow.offsetX,24);assert.equal(saved.layers[1].text,'Keep this text');await screenshot(page,'image-desktop');
 await page.setViewportSize({width:412,height:915});await page.locator('.ef-tools').getByRole('button',{name:'Layers',exact:true}).click();for(const id of ['duplicateLayer','deleteLayer'])assert.ok((await page.locator('#'+id).boundingBox()).height>=44);assert.ok((await page.locator('#layerArrange summary').boundingBox()).height>=44);await page.getByRole('button',{name:'Close navigation',exact:true}).click();await page.locator('.ef-tools').getByRole('button',{name:'Properties',exact:true}).click();await screenshot(page,'image-phone-properties');await page.getByRole('button',{name:'Close inspector',exact:true}).click();await screenshot(page,'image-phone-document');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
});
