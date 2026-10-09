/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real Chromium through the real editor, the real compiled Create routes and a disposable PostgreSQL, with the named fixture provider: two complete generate, manual edit, regenerate, edit cycles; what is sent and what it costs is shown before sending; compare, accept and undo; a delayed candidate refused after a newer manual save and after another tab's save; reject, cancel and provider failure leave the project as it was; no generate permission means nothing is sent.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Hold the actual save request to prove the clicked cost class survives a refreshed paid report, refusal makes zero generation calls, and only another explicit click permits paid work; unsupported consent reports disable sending.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPostgres, resetPostgres } from '../project-postgres.fixture.mjs';
import { noiseImage, whenHeld } from '../region-edit.fixture.mjs';
import { chromium, startRegionEditor } from './create-region-edit-fixture.mjs';

let db, cleanup, browser;
before(async () => { db = await startPostgres(callback => { cleanup = callback; }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await cleanup?.(); });
beforeEach(async () => { await resetPostgres(db.admin); });

async function open(t, options = {}) {
  const api = await startRegionEditor(t, db, options), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [], external = [], requests = [];
  t.after(async () => { await context.close(); });
  await context.addInitScript(() => { localStorage.setItem('cockpit-theme', 'workspace'); localStorage.setItem('cockpit-application-colors', 'false'); });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== api.origin) { external.push(url.href); return route.abort(); }
    requests.push(`${route.request().method()} ${url.pathname}`); return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${api.origin}/api/create/editor`, { waitUntil: 'domcontentloaded' });
  await page.locator('#saveStatus').filter({ hasNotText: /Checking|Loading/ }).waitFor(); await page.locator('#autosave').uncheck();
  return { page, api, errors, external, requests };
}
async function change(page, selector, value) { await page.locator(selector).fill(String(value)); await page.locator(selector).press('Tab'); }
async function saved(page, revision) { await page.locator('#saveStatus').filter({ hasText: `Saved · revision ${revision}` }).waitFor(); }
const pixel = (page, x, y) => page.locator('#artboard').evaluate((canvas, at) => [...canvas.getContext('2d').getImageData(at.x, at.y, 1, 1).data], { x, y });
async function painted(page, x, y, predicate, label) {
  const deadline = Date.now() + 5000;
  for (;;) { const value = await pixel(page, x, y); if (predicate(value)) return value; assert.ok(Date.now() < deadline, `${label}: ${value}`); await page.waitForTimeout(50); }
}
function clean(value) { assert.deepEqual(value.errors, []); assert.deepEqual(value.external, []); }

/** A 160x100 noise photo stretched to 480x300 at the origin, a title over it, saved as revision 1. */
async function design(value) {
  const { page } = value;
  await page.locator('#imageFile').setInputFiles({ name: 'synthetic-noise.png', mimeType: 'image/png', buffer: await noiseImage(160, 100) });
  await page.locator('#imageProperties').waitFor(); await change(page, '#layerWidth', 480); await change(page, '#layerHeight', 300);
  await painted(page, 5, 5, value => value[3] === 255, 'photo painted');
  await page.locator('#addText').click(); await change(page, '#layerText', 'Launch day');
  await page.locator('#saveProject').click(); await saved(page, 1);
}
async function drag(page, points, shift = false) {
  const box = await page.locator('#artboard').boundingBox(), at = point => [box.x + point.x * box.width / 1200, box.y + point.y * box.height / 800];
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(...at(points[0])); await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(...at(point), { steps: 6 });
  await page.mouse.up(); if (shift) await page.keyboard.up('Shift');
}
async function selectRegion(page, points, shift) {
  await page.getByRole('button', { name: 'Select synthetic-noise.png', exact: true }).click();
  if (await page.locator('#regionMode').getAttribute('aria-pressed') !== 'true') await page.locator('#regionMode').click();
  await drag(page, points, shift); await page.locator('#regionEditPanel').waitFor();
}
async function regenerate(page, instruction) {
  await page.locator('#regionInstruction').fill(instruction); await page.locator('#regionSend').click();
}
async function decide(page) {
  await page.locator('#regionEditStatus').filter({ hasText: 'A candidate is ready' }).waitFor(); await page.locator('#regionCompare').click();
  await page.locator('#regionCompareDialog[open]').waitFor();
  await page.waitForFunction(() => ['regionBefore', 'regionAfter'].every(id => document.getElementById(id).complete && document.getElementById(id).naturalWidth === 160));
}
const LASSO = [{ x: 40, y: 40 }, { x: 200, y: 40 }, { x: 200, y: 140 }, { x: 40, y: 140 }, { x: 42, y: 42 }];
const edits = async () => (await db.admin.query('SELECT source_revision,accepted_revision,status FROM create_region_edits ORDER BY created_at')).rows;
const current = async () => (await db.admin.query('SELECT current_revision FROM create_projects')).rows[0].current_revision;

test('two complete generate, manual edit, regenerate, edit cycles keep the title editable and every manual change', { timeout: 120000 }, async t => {
  const value = await open(t), { page } = value; await design(value);
  await selectRegion(page, LASSO);
  assert.match(await page.locator('#regionSummary').innerText(), /Lasso region, \d+ × \d+ source pixels of “synthetic-noise\.png”; saved revision 1\./);
  await page.locator('#regionCost').filter({ hasText: 'create-region-fixture-provider' }).waitFor();
  assert.match(await page.locator('#regionCost').innerText(), /charged per image to your account · up to 20 a day/);
  const outside = await pixel(page, 300, 250);
  await regenerate(page, 'Paint a green meadow here'); await decide(page); await page.locator('#regionAccept').click();
  await page.locator('#regionEditStatus').filter({ hasText: 'Accepted as revision 2' }).waitFor(); await saved(page, 2);
  await painted(page, 120, 90, value => value[0] < 10 && value[1] > 190 && value[2] > 70 && value[2] < 90, 'region shows the candidate');
  assert.deepEqual(await pixel(page, 300, 250), outside, 'outside the region the canvas is unchanged');
  await page.getByRole('button', { name: 'Select Your title', exact: true }).click();
  assert.equal(await page.locator('#layerText').inputValue(), 'Launch day'); await change(page, '#layerX', 520);
  await page.locator('#saveProject').click(); await saved(page, 3);
  await selectRegion(page, [{ x: 250, y: 150 }, { x: 420, y: 270 }], true);
  assert.match(await page.locator('#regionSummary').innerText(), /^Box region, .*saved revision 3\./);
  const boxBefore = await pixel(page, 330, 210);
  await regenerate(page, 'Make this corner a calm lake'); await decide(page); await page.locator('#regionAccept').click();
  await saved(page, 4); await painted(page, 330, 210, value => value[1] > 190 && value[0] < 10, 'second region shows the candidate');
  await page.locator('#undo').click(); await painted(page, 330, 210, value => value.join() === boxBefore.join(), 'undo restores the previous image');
  await page.locator('#redo').click(); await painted(page, 330, 210, value => value[1] > 190, 'redo returns to the accepted candidate');
  await page.getByRole('button', { name: 'Select Your title', exact: true }).click(); await change(page, '#layerText', 'Launch week');
  await page.locator('#saveProject').click(); await saved(page, 5);
  assert.deepEqual(await edits(), [{ source_revision: 1, accepted_revision: 2, status: 'accepted' }, { source_revision: 3, accepted_revision: 4, status: 'accepted' }]);
  const final = (await value.api.call('/projects')).body.projects[0], document = (await value.api.call(`/projects/${final.id}`)).body.project.document;
  const title = document.layers.find(layer => layer.type === 'text');
  assert.deepEqual([title.text, title.x, final.revision], ['Launch week', 520, 5]); assert.equal(value.api.provider.calls.length, 2);
  assert.equal(value.api.provider.costs.length, 2); clean(value);
});

test('a delayed candidate is refused after a newer manual save changed its target, and after another tab saved', { timeout: 120000 }, async t => {
  const value = await open(t, { provider: { mode: 'hold' } }), { page } = value; await design(value);
  await selectRegion(page, LASSO); await regenerate(page, 'Add a small red kite'); await whenHeld(value.api.provider);
  await page.locator('#regionEditStatus').filter({ hasText: 'Regenerating' }).waitFor();
  await page.getByRole('button', { name: 'Lock synthetic-noise.png', exact: true }).click(); await page.locator('#saveProject').click(); await saved(page, 2);
  value.api.provider.release(); await decide(page); await page.locator('#regionAccept').click();
  await page.locator('#editorError').filter({ hasText: 'Unlock the image layer to accept this candidate.' }).waitFor();
  assert.equal(await current(), 2); assert.equal((await edits())[0].status, 'ready');
  await page.locator('#closeRegionCompare').click();
  await page.getByRole('button', { name: 'Unlock synthetic-noise.png', exact: true }).click(); await page.locator('#saveProject').click(); await saved(page, 3);
  const record = (await value.api.call('/projects')).body.projects[0], stored = (await value.api.call(`/projects/${record.id}`)).body.project;
  const elsewhere = structuredClone(stored.document); elsewhere.layers.find(layer => layer.type === 'text').text = 'Saved in another tab';
  assert.equal((await value.api.call(`/projects/${record.id}/revisions`, 'POST', { title: elsewhere.name, document: elsewhere, baseRevision: 3 })).status, 201);
  await page.locator('#regionCompare').click(); await page.locator('#regionAccept').click();
  await page.locator('#editorError').filter({ hasText: /newer revision was saved elsewhere/ }).waitFor();
  assert.equal(await current(), 4); assert.equal((await edits())[0].status, 'ready');
  await page.locator('#regionReject').click(); await page.locator('#regionEditStatus').filter({ hasText: 'Rejected' }).waitFor();
  assert.equal((await edits())[0].status, 'rejected'); assert.equal(await current(), 4);
  const document = (await value.api.call(`/projects/${record.id}`)).body.project.document;
  assert.equal(document.layers.find(layer => layer.type === 'text').text, 'Saved in another tab'); clean(value);
});

test('cancel and a provider failure say so and leave the project exactly as it was', { timeout: 120000 }, async t => {
  const value = await open(t, { provider: { mode: 'hold' } }), { page } = value; await design(value);
  await selectRegion(page, LASSO); await regenerate(page, 'Replace with snow'); await whenHeld(value.api.provider);
  await page.locator('#regionCancel').click(); await page.locator('#regionEditStatus').filter({ hasText: 'Cancelled. Your project is unchanged.' }).waitFor();
  value.api.provider.setMode('fail'); value.api.provider.release();
  await page.locator('#regionSend').click(); await page.locator('#regionEditStatus').filter({ hasText: 'could not regenerate this region' }).waitFor();
  assert.deepEqual((await edits()).map(row => row.status), ['cancelled', 'failed']); assert.equal(await current(), 1);
  assert.equal(await page.locator('#saveStatus').innerText(), 'Saved · revision 1'); clean(value);
});

test('without project.generate the panel explains why and nothing is ever sent', { timeout: 120000 }, async t => {
  const value = await open(t, { denied: ['project.generate'] }), { page } = value; await design(value);
  await selectRegion(page, LASSO);
  assert.match(await page.locator('#regionCost').innerText(), /does not include region regeneration \(project\.generate\)/);
  assert.equal(await page.locator('#regionSend').isDisabled(), true);
  assert.equal(value.requests.some(row => /\/region-edits|\/region-edit-provider/.test(row)), false);
  assert.ok(value.requests.includes('GET /api/create/editor/region-edit-panel.mjs'), 'the panel module itself was served'); assert.deepEqual(value.api.provider.resolvedFor, []); clean(value);
});

test('the clicked free cap survives asynchronous save and a paid refresh requires a new click', { timeout: 120000 }, async t => {
  const value = await open(t, { provider: { costClass: 'free', costUsd: 0 } }), { page } = value; await design(value);
  await selectRegion(page, LASSO); await page.locator('#regionCost').filter({ hasText: 'no charge per image' }).waitFor();
  await change(page, '#layerX', 1);
  let releaseSave, saveStarted;
  const saveGate = new Promise(resolve => { releaseSave = resolve; }), saving = new Promise(resolve => { saveStarted = resolve; });
  t.after(() => releaseSave());
  await page.route('**/api/create/projects/*/revisions', async route => {
    if (route.request().method() === 'POST') { saveStarted(); await saveGate; }
    await route.continue();
  });
  const payloads = [];
  page.on('request', req => { if (req.method() === 'POST' && /\/region-edits$/.test(new URL(req.url()).pathname)) payloads.push(req.postDataJSON()); });
  await regenerate(page, 'Paint a green meadow'); await saving;
  value.api.provider.provider.costClass = 'paid';
  await page.evaluate(async () => { await (await import('/api/create/editor/region-edit-panel.mjs')).loadRegionProvider(); });
  await page.locator('#regionCost').filter({ hasText: 'charged per image' }).waitFor(); releaseSave();
  await page.locator('#regionEditStatus').filter({ hasText: 'Nothing was generated' }).waitFor();
  await page.locator('#regionCost').filter({ hasText: 'charged per image' }).waitFor();
  await page.waitForFunction(() => !document.getElementById('regionSend').disabled);
  assert.deepEqual(payloads.map(body => body.maxCostClass), ['free']);
  assert.deepEqual(value.api.provider.calls, []); assert.deepEqual(value.api.provider.costs, []);
  assert.deepEqual((await edits()).map(row => row.status), ['failed']); assert.equal(await current(), 2, 'the deliberate manual save is retained');
  await page.locator('#regionSend').click(); await decide(page);
  assert.deepEqual(payloads.map(body => body.maxCostClass), ['free', 'paid']);
  assert.equal(value.api.provider.calls.length, 1, 'only the second explicit click generated'); clean(value);
});

test('unsupported cost-consent reports disable region submission instead of using legacy semantics', { timeout: 120000 }, async t => {
  const value = await open(t), { page } = value; await design(value); await selectRegion(page, LASSO);
  let reportPatch = { costConsentVersion: undefined };
  await page.route('**/api/create/region-edit-provider', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), ...reportPatch } });
  });
  for (const [patch, message] of [[{ costConsentVersion: undefined }, 'does not support capped'], [{ costConsentVersion: '1' }, 'does not support capped'],
    [{ costConsentVersion: 2 }, 'does not support capped'], [{ costConsentVersion: 1, costClass: undefined }, 'unknown cost class'],
    [{ costConsentVersion: 1, costClass: 'unknown' }, 'unknown cost class']]) {
    reportPatch = patch;
    await page.evaluate(async () => { await (await import('/api/create/editor/region-edit-panel.mjs')).loadRegionProvider(); });
    assert.match(await page.locator('#regionCost').innerText(), new RegExp(message));
    assert.equal(await page.locator('#regionSend').isDisabled(), true);
  }
  assert.equal(value.requests.some(row => row.startsWith('POST ') && /\/region-edits$/.test(row)), false);
  assert.deepEqual(value.api.provider.calls, []); assert.deepEqual(value.api.provider.costs, []); clean(value);
});
