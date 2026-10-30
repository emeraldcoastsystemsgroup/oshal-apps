/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove Video's automatic concierge handoff through actual controls, project operations and PostgreSQL/RLS, retaining editable timeline data and concurrent browser drafts.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startPostgres, resetPostgres } from './video-editor-postgres.fixture.mjs';
import { mediaBytes, clipProbe } from './video-editor.fixture.mjs';
import { chromium, openEditor } from './video-editor-browser.fixture.mjs';
let database, cleanup, browser;
before(async () => { database = await startPostgres(fn => { cleanup = fn; }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await cleanup?.(); });
beforeEach(async () => { await resetPostgres(database.admin); });

async function begin(page) {
  return page.evaluate(async () => {
    const api = await import('/shared/ui/js/document-handoff.js');
    window.documentHandoff = await api.beginDocumentHandoff();
    return window.documentHandoff.context;
  });
}
async function addClip(page) {
  await page.locator('#addClip').setInputFiles({ name: 'Fixture clip.mp4', mimeType: 'video/mp4', buffer: mediaBytes('video', clipProbe({ seconds: 3 })) });
  await page.locator('#status').filter({ hasText: 'Fixture clip.mp4 added.' }).waitFor();
}

test('Video automatically saves the manual timeline for the concierge and refreshes the same editable project on both handoffs', async t => {
  const { page, api, errors, external } = await openEditor(t, browser, database);
  await addClip(page); await page.locator('#projectName').fill('My current cut');
  const first = await begin(page), id = first.recordId;
  assert.ok(id); assert.equal(first.fields.revision, 1);
  const saved = (await api.call(`/editor/projects/${id}`)).body.project;
  assert.equal(saved.document.name, 'My current cut'); assert.equal(saved.document.segments.length, 1);
  let result = await api.call(`/editor/projects/${id}/operations`, 'POST', { baseRevision: first.fields.revision,
    operations: [{ type: 'rename', name: 'Concierge cut' }] });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  await page.evaluate(() => window.documentHandoff.refresh());
  assert.equal(await page.locator('#projectName').inputValue(), 'Concierge cut');
  assert.equal(await page.locator('#track .segment').count(), 1, 'the timeline remains editable');
  await page.locator('#track .segment').first().click();
  await page.locator('#trimIn').fill('15');
  const second = await begin(page);
  assert.equal(second.recordId, id); assert.equal(second.fields.revision, 3);
  assert.equal((await api.call(`/editor/projects/${id}`)).body.project.document.segments[0].in, 15);
  result = await api.call(`/editor/projects/${id}/operations`, 'POST', { baseRevision: second.fields.revision,
    operations: [{ type: 'rename', name: 'Continued from your trim' }] });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  await page.evaluate(() => window.documentHandoff.refresh());
  assert.equal(await page.locator('#projectName').inputValue(), 'Continued from your trim');
  assert.equal(await page.locator('#trimIn').inputValue(), '15');
  await page.locator('#undo').click();
  assert.equal(await page.locator('#projectName').inputValue(), 'Concierge cut');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});

test('a failed automatic video save blocks the concierge and keeps the local draft', async t => {
  const { page, api } = await openEditor(t, browser, database);
  await addClip(page); const first = await begin(page);
  await page.locator('#projectName').fill('My unsaved cut');
  api.state.denied.add('editor.change');
  await assert.rejects(begin(page));
  assert.equal((await api.call(`/editor/projects/${first.recordId}`)).body.project.revision, 1);
  assert.equal(await page.locator('#projectName').inputValue(), 'My unsaved cut');
});

test('a video refresh preserves a concurrent focused-field draft', async t => {
  const { page, api } = await openEditor(t, browser, database);
  await addClip(page); const first = await begin(page);
  await page.locator('#projectName').fill('My concurrent cut');
  const result = await api.call(`/editor/projects/${first.recordId}/operations`, 'POST', { baseRevision: first.fields.revision,
    operations: [{ type: 'rename', name: 'Saved concierge cut' }] });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  await assert.rejects(page.evaluate(() => window.documentHandoff.refresh()), /video draft is still here/);
  assert.equal(await page.locator('#projectName').inputValue(), 'My concurrent cut');
});

test('a late automatic save never adopts its previous project into a newly opened video', async t => {
  const { page, api } = await openEditor(t, browser, database);
  await addClip(page); const first = await begin(page);
  const original = (await api.call(`/editor/projects/${first.recordId}`)).body.project;
  const second = await api.call('/editor/projects', 'POST', { title: 'Other project', document: { ...original.document, name: 'Other project' } });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  await page.reload(); await page.locator('html[data-editor-ready="true"]').waitFor();
  let arrived, release;
  const seen = new Promise(resolve => { arrived = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  await page.route(`**/editor/projects/${first.recordId}/revisions`, async route => {
    const response = await route.fetch(); arrived(); await gate; await route.fulfill({ response });
  });
  await page.locator('#projectName').fill('Saved before switching');
  const handoff = begin(page).then(value => ({ value }), failure => ({ error: failure.message }));
  await seen;
  await page.locator('#projectList').selectOption(second.body.project.id);
  await page.waitForFunction(() => document.querySelector('#projectName').value === 'Other project');
  release(); const result = await handoff; assert.match(result.error, /open project changed/);
  assert.equal(await page.locator('#projectName').inputValue(), 'Other project');
  assert.equal((await begin(page)).recordId, second.body.project.id);
});
