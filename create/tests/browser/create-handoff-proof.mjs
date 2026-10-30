/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove automatic save/read/edit/refresh through real editor controls, project operations and PostgreSQL/RLS, including repeated handoffs, editable gray adjustment layers, failed saves and concurrent drafts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Distinguish writable saved-project context from read-only screen reporting and preserve reader restrictions.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { handoffDatabase, handoffFixture, chromium } from './create-handoff-fixture.mjs';
import { input } from '../project-api.fixture.mjs';
let db, cleanup, browser;
before(async () => { db = await handoffDatabase(fn => { cleanup = fn; }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await cleanup?.(); });

async function open(t) {
  const api = await handoffFixture(t, db.pool);
  const created = await api.call('/projects', 'POST', input('Handoff design', {}, [
    { id: 'photo', type: 'rect', name: 'Red artwork', x: 0, y: 0, w: 100, h: 100, fill: '#ff0000' },
    { id: 'title', type: 'text', name: 'Heading', text: 'Original', x: 10, y: 110, w: 200, h: 40 },
  ]));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [], pending = new Set(), failed = [];
  page.on('request', request => pending.add(request.url()));
  page.on('requestfinished', request => pending.delete(request.url()));
  page.on('requestfailed', request => { pending.delete(request.url()); failed.push([request.url(), request.failure()?.errorText]); });
  page.on('pageerror', failure => errors.push(failure.message));
  await page.goto(`${api.origin}/fixture?project=${created.body.project.id}`);
  const frame = page.frameLocator('#editorFrame');
  try { await frame.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor(); }
  catch (failure) { throw new Error(JSON.stringify({ errors, pending: [...pending], failed, status: await frame.locator('#saveStatus').textContent(), issue: await frame.locator('#editorError').textContent() }), { cause: failure }); }
  await frame.locator('#autosave').uncheck();
  await page.waitForFunction(() => document.getElementById('editorFrame').contentWindow.__oshalDocumentSession);
  return { api, context, page, frame, id: created.body.project.id, errors };
}

async function begin(page) {
  return page.evaluate(async () => {
    const api = await import('/shared/ui/js/document-handoff.js');
    window.documentHandoff = await api.beginDocumentHandoff();
    return window.documentHandoff.context;
  });
}

test('manual edits are saved for the concierge, its real layers refresh, and the next handoff reads the manual adjustment', async t => {
  const { api, page, frame, id, errors } = await open(t);
  await frame.locator('#projectName').fill('Latest manual title');
  const first = await begin(page);
  assert.equal(first.recordId, id); assert.equal(first.fields.revision, 2); assert.equal(first.fields.draft, false);
  assert.equal(first.fields.readOnly, false);
  assert.equal(await frame.locator('body').evaluate(async () => (await import('/api/create/editor/editor-context.mjs')).editorSnapshot().fields.readOnly), true);
  const saved = await api.call(`/projects/${id}`);
  assert.equal(saved.body.project.document.name, 'Latest manual title');
  const edited = await api.call(`/projects/${id}/operations`, 'POST', { baseRevision: first.fields.revision, operations: [
    { type: 'add', layer: { id: 'gray', type: 'adjustment', name: 'Gray filter', scope: 'stack', saturation: 0 } },
    { type: 'add', layer: { id: 'badge', type: 'text', name: 'Badge', text: 'Concierge edit', x: 10, y: 160, w: 250, h: 40 } },
  ] });
  assert.equal(edited.status, 201, JSON.stringify(edited.body));
  await page.evaluate(() => window.documentHandoff.refresh());
  await frame.locator('[data-layer-id="gray"] .layer-select').click();
  assert.equal(await frame.locator('#saveStatus').innerText(), 'Saved · revision 3');
  const state = await frame.locator('body').evaluate(async () => (await import('/api/create/editor/editor-state.mjs')).state.project);
  assert.equal(state.layers.find(layer => layer.id === 'gray').type, 'adjustment');
  assert.equal(state.layers.find(layer => layer.id === 'gray').saturation, 0);
  assert.equal(state.layers.find(layer => layer.id === 'badge').type, 'text');
  await frame.locator('[data-property="saturation"]').filter({ visible: true }).fill('50');
  const second = await begin(page);
  assert.equal(second.fields.revision, 4); assert.equal(second.fields.layerId, 'gray');
  assert.equal((await api.call(`/projects/${id}`)).body.project.document.layers.find(layer => layer.id === 'gray').saturation, 50);
  const next = await api.call(`/projects/${id}/operations`, 'POST', { baseRevision: second.fields.revision,
    operations: [{ type: 'update', id: 'badge', patch: { text: 'Continued from your edit' } }] });
  assert.equal(next.status, 201, JSON.stringify(next.body));
  await page.evaluate(() => window.documentHandoff.refresh());
  assert.equal(await frame.locator('#saveStatus').innerText(), 'Saved · revision 5');
  await frame.locator('[data-layer-id="badge"] .layer-select').click();
  assert.equal(await frame.locator('[data-property="text"]').inputValue(), 'Continued from your edit');
  await frame.locator('#undo').click();
  assert.equal(await frame.locator('[data-property="text"]').inputValue(), 'Concierge edit');
  assert.deepEqual(errors, []);
});

test('a refused automatic save stops the handoff and leaves the exact browser draft intact', async t => {
  const { api, page, frame, id } = await open(t);
  await frame.locator('#projectName').fill('Unsaved private draft');
  api.state.denied.add('project.change');
  await assert.rejects(begin(page));
  assert.equal((await api.call(`/projects/${id}`)).body.project.revision, 1);
  assert.equal(await frame.locator('#projectName').inputValue(), 'Unsaved private draft');
  assert.match(await frame.locator('#editorError').innerText(), /permit|allow|denied/i);
});

test('a reader can hand over a saved document for questions without receiving edit context', async t => {
  const { api, page, frame, id } = await open(t);
  api.state.denied.add('project.change');
  await page.reload();
  await frame.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();
  const handed = await begin(page);
  assert.equal(handed.recordId, id);
  assert.equal(handed.fields.readOnly, true);
  assert.equal(handed.fields.revision, 1);
  assert.equal((await api.call(`/projects/${id}`)).body.project.revision, 1);
});

test('refresh preserves a concurrent browser draft and reports the conflict instead of replacing it', async t => {
  const { api, page, frame, id } = await open(t);
  const handed = await begin(page);
  await frame.locator('#projectName').fill('My concurrent edit');
  const result = await api.call(`/projects/${id}/operations`, 'POST', { baseRevision: handed.fields.revision,
    operations: [{ type: 'update', id: 'title', patch: { text: 'Assistant revision' } }] });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  await assert.rejects(page.evaluate(() => window.documentHandoff.refresh()), /draft is still here/);
  assert.equal(await frame.locator('#projectName').inputValue(), 'My concurrent edit');
  assert.match(await frame.locator('#editorError').innerText(), /concierge saved an update/i);
  assert.equal((await api.call(`/projects/${id}`)).body.project.document.name, 'Handoff design');
});
