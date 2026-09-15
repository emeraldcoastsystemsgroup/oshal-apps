/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify real selected-layer context, permission and lifecycle retraction through the production surface contract.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { contextFixture, ownedBrowser, contextManifest, servedContextModule } from './create-editor-context-fixture.mjs';
import { createProject, applyOperation } from '../../tools/editor/model.mjs';

let owned;
after(async () => {
  const cleanup = await owned?.close();
  if (cleanup && process.env.CREATE_CONTEXT_CLEANUP_DIR) await writeFile(resolve(process.env.CREATE_CONTEXT_CLEANUP_DIR,
    `create-context-browser-cleanup-${cleanup.pid}-${Date.now()}.json`), JSON.stringify(cleanup, null, 2) + '\n', { flag: 'wx' });
});

async function open(t, options = {}) {
  owned ??= await ownedBrowser();
  return contextFixture(owned.browser, options, close => t.after(close));
}
async function latest(value, predicate) {
  await value.page.waitForFunction(predicate, undefined, { timeout: 2500 });
  return value.page.evaluate(() => window.contextMessages.at(-1));
}
async function change(value, selector, text) { await value.surface.locator(selector).fill(text); await value.surface.locator(selector).press('Tab'); }
function clean(value) { assert.deepEqual(value.errors, []); assert.deepEqual(value.external, []); }
function twoLayers() {
  let project = createProject({ name: 'Owned design' });
  project = applyOperation(project, { type: 'add', layer: { id: 'first', type: 'text', name: 'Headline', text: 'Visible selection', x: 20, y: 20, w: 300, h: 100 } });
  return applyOperation(project, { type: 'add', layer: { id: 'second', type: 'text', name: 'Other layer', text: 'UNSELECTED_SENTINEL', x: 20, y: 200, w: 300, h: 100 } });
}

test('shipped manifest permits only context refresh and the compiled factory serves the exact adapter', async () => {
  assert.deepEqual(contextManifest().surface.ops, ['context', 'custom']);
  const response = await servedContextModule(); assert.equal(response.status, 200);
  assert.match(response.type, /javascript/); assert.deepEqual(response.bytes, response.expected);
});

test('actual Create text selection reaches the unchanged core contract as read-only context', async t => {
  const value = await open(t);
  await value.surface.locator('#addText').click(); await change(value, '#layerText', 'A readable selected headline');
  const context = await latest(value, () => window.contextMessages.at(-1)?.fields?.text === 'A readable selected headline');
  assert.equal(context.app, 'create'); assert.equal(context.surface, 'create-editor');
  assert.equal(context.fields.readOnly, true); assert.deepEqual(context.can, []);
  assert.equal(context.fields.layerType, 'text'); assert.equal(value.fixture.state.successfulWrites, 0);
  assert.deepEqual(await value.page.evaluate(() => window.contextResults.filter(result => !result.delivered)), []); clean(value);
});

test('selection changes replace context without disclosing other text or the document', async t => {
  const value = await open(t, { seed: twoLayers() });
  await value.surface.getByRole('button', { name: 'Select Headline', exact: true }).click();
  const first = await latest(value, () => window.contextMessages.at(-1)?.fields?.layerId === 'first');
  assert.equal(first.recordId, value.record.id); assert.equal(first.fields.revision, 1);
  assert.equal(JSON.stringify(first).includes('UNSELECTED_SENTINEL'), false);
  assert.equal('layers' in first.fields, false); assert.equal('images' in first.fields, false);
  await value.surface.getByRole('button', { name: 'Select Other layer', exact: true }).click();
  const next = await latest(value, () => window.contextMessages.at(-1)?.fields?.layerId === 'second');
  assert.ok(next.fields.contextEpoch > first.fields.contextEpoch); assert.equal(next.fields.text, 'UNSELECTED_SENTINEL');
  await value.surface.getByRole('button', { name: 'Hide Other layer', exact: true }).click();
  const hidden = await latest(value, () => window.contextMessages.at(-1)?.fields?.available && !window.contextMessages.at(-1).fields.layerId);
  assert.equal('text' in hidden.fields, false); assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('project dialog retracts all project and layer details, then closing republishes the same draft', async t => {
  const value = await open(t, { seed: twoLayers() });
  await value.surface.getByRole('button', { name: 'Select Headline', exact: true }).click();
  await change(value, '#layerText', 'Draft remains here');
  await value.surface.locator('#openProjects').click();
  const closed = await latest(value, () => window.contextMessages.at(-1)?.digest?.includes('dialog open'));
  assert.equal(closed.fields.available, false); assert.equal(closed.recordId, undefined); assert.equal(closed.title, undefined);
  assert.equal('text' in closed.fields, false);
  await value.surface.locator('#closeProjects').click();
  const restored = await latest(value, () => window.contextMessages.at(-1)?.fields?.text === 'Draft remains here');
  assert.equal(restored.fields.draft, true); assert.equal(await value.surface.locator('#layerText').inputValue(), 'Draft remains here');
  assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('save and local undo update the current revision and draft without extra writes', async t => {
  const value = await open(t); await value.surface.locator('#addText').click();
  await change(value, '#layerText', 'Saved headline'); await value.surface.locator('#saveProject').click();
  const saved = await latest(value, () => window.contextMessages.at(-1)?.fields?.revision === 1);
  assert.equal(saved.fields.draft, false); assert.ok(saved.recordId);
  await change(value, '#layerText', 'Unsaved headline');
  await latest(value, () => window.contextMessages.at(-1)?.fields?.text === 'Unsaved headline');
  await value.surface.locator('#undo').click();
  const undone = await latest(value, () => window.contextMessages.at(-1)?.fields?.text === 'Saved headline');
  assert.equal(undone.fields.draft, false); assert.equal(undone.recordId, saved.recordId);
  assert.equal(value.fixture.state.successfulWrites, 1); clean(value);
});

test('read-only saved selection is described without advertising or accepting editing operations', async t => {
  const value = await open(t, { seed: twoLayers(), permissions: { create: false, change: false } });
  await value.surface.getByRole('button', { name: 'Select Headline', exact: true }).click();
  const context = await latest(value, () => window.contextMessages.at(-1)?.fields?.layerId === 'first');
  assert.equal(context.fields.readOnly, true); assert.deepEqual(context.can, []); assert.deepEqual(context.customOps, []);
  await value.page.evaluate(() => document.getElementById('editorFrame').contentWindow.postMessage({
    channel: 'oshal-surface-bridge', v: 1, app: 'create', op: 'set_field', field: 'layerText', value: 'FORBIDDEN' }, location.origin));
  await value.page.evaluate(() => window.requestContext());
  const refreshed = await latest(value, () => window.contextMessages.at(-1)?.fields?.contextEpoch > 2);
  assert.equal(refreshed.fields.text, 'Visible selection');
  assert.equal(await value.surface.locator('#layerText').isDisabled(), true); assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});

test('missing read and create permissions never disclose a requested saved project', async t => {
  const value = await open(t, { seed: twoLayers(), permissions: { read: false, create: false, change: false } });
  await value.page.evaluate(() => window.requestContext());
  const context = await latest(value, () => window.contextMessages.at(-1)?.fields?.available === false);
  assert.equal(context.recordId, undefined); assert.equal(context.title, undefined);
  assert.equal(JSON.stringify(context).includes('Visible selection'), false);
  assert.equal(value.fixture.state.requests.some(row => row.path === '/api/create/projects/' + value.record.id), false); clean(value);
});

test('long selected text is bounded and shared normalization strips markup', async t => {
  const value = await open(t); await value.surface.locator('#addText').click();
  await change(value, '#layerText', '<b>Headline</b>' + 'x'.repeat(2500));
  const context = await latest(value, () => window.contextMessages.at(-1)?.fields?.text?.startsWith('Headline'));
  assert.ok(context.fields.text.length <= 1000); assert.equal(context.fields.text.includes('<b>'), false);
  assert.ok(JSON.stringify(context).length < 2200); assert.equal(value.fixture.state.uploads, 0); clean(value);
});

test('context remains subject to the actual per-app manifest allowlist', async t => {
  const value = await open(t); await value.surface.locator('#addText').click();
  await latest(value, () => window.contextMessages.at(-1)?.fields?.layerType === 'text');
  const count = await value.page.evaluate(() => { window.contextOps = []; const count = window.contextMessages.length; window.requestContext(); return count; });
  await value.page.waitForFunction(() => window.contextResults.at(-1)?.reason === 'op_not_allowed:context');
  assert.equal(await value.page.evaluate(() => window.contextMessages.length), count);
  await value.page.evaluate(() => { window.contextOps = ['context', 'custom']; window.requestContext(); });
  await value.page.waitForFunction(count => window.contextMessages.length > count, count); clean(value);
});

test('dispose removes the real state subscription and message observer; explicit remount resumes once', async t => {
  const value = await open(t); await value.surface.locator('#addText').click();
  await latest(value, () => window.contextMessages.at(-1)?.fields?.layerType === 'text');
  await value.surface.locator('body').evaluate(async () => {
    const { bindEditorContext } = await import('/api/create/editor/editor-context.mjs');
    const first = await bindEditorContext(); if (first !== await bindEditorContext()) throw Error('duplicate observer'); first(); first();
  });
  await latest(value, () => window.contextMessages.at(-1)?.digest?.includes('closed'));
  const count = await value.page.evaluate(() => window.contextMessages.length);
  await change(value, '#layerText', 'After detach'); await value.page.evaluate(() => window.requestContext());
  await value.surface.locator('body').evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert.equal(await value.page.evaluate(() => window.contextMessages.length), count);
  await value.surface.locator('body').evaluate(async () => {
    const { bindEditorContext } = await import('/api/create/editor/editor-context.mjs');
    const [first, second] = await Promise.all([bindEditorContext(), bindEditorContext()]);
    if (first !== second) throw Error('concurrent duplicate observer');
  });
  await latest(value, () => window.contextMessages.at(-1)?.fields?.text === 'After detach');
  assert.equal(await value.page.evaluate(() => window.contextMessages.length), count + 1); clean(value);
});

test('pagehide retracts the departed selection and a fresh editor frame never inherits it', async t => {
  const value = await open(t); await value.surface.locator('#addText').click(); await change(value, '#layerText', 'Departed draft');
  await latest(value, () => window.contextMessages.at(-1)?.fields?.text === 'Departed draft');
  await value.surface.locator('body').evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  const departed = await latest(value, () => window.contextMessages.at(-1)?.digest?.includes('closed'));
  assert.equal(departed.fields.available, false); assert.equal('text' in departed.fields, false);
  await value.page.evaluate(() => { document.getElementById('editorFrame').src = '/api/create/editor?fresh=1'; });
  const current = await latest(value, () => window.contextMessages.at(-1)?.fields?.available && window.contextMessages.at(-1)?.fields?.layerCount === 0);
  assert.equal('text' in current.fields, false); assert.equal(current.recordId, undefined); clean(value);
});

test('persisted page restoration republishes current context once without replacing the draft', async t => {
  const value = await open(t); await value.surface.locator('#addText').click(); await change(value, '#layerText', 'Back-forward draft');
  await latest(value, () => window.contextMessages.at(-1)?.fields?.text === 'Back-forward draft');
  await value.surface.locator('body').evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await latest(value, () => window.contextMessages.at(-1)?.digest?.includes('closed'));
  const count = await value.page.evaluate(() => window.contextMessages.length);
  await value.surface.locator('body').evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await latest(value, () => window.contextMessages.at(-1)?.fields?.text === 'Back-forward draft');
  assert.equal(await value.page.evaluate(() => window.contextMessages.length), count + 1);
  assert.equal(await value.surface.locator('#layerText').inputValue(), 'Back-forward draft');
  assert.equal(value.fixture.state.successfulWrites, 0); clean(value);
});
