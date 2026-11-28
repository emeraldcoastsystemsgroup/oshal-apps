/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reproduce saved-stem removal and empty-session display through the real Audio page, routes, SQLite and CAS.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright, toneWav, studioFixture } = require('./fixtures/studio-server.cjs');

/** @description Open actual Audio controls with explicit fixture authentication and exact resource cleanup. @returns {Promise<object>} Page and API. */
async function open(t, prepare) {
  const f = await studioFixture();
  const browser = await playwright().chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, extraHTTPHeaders: { authorization: 'Bearer ' + f.token } });
  await f.authenticate(context);
  const page = await context.newPage();
  t.after(async () => {
    if (process.env.OSHAL_AUDIO_REVIEW_PROOF_DIR) {
      await fs.mkdir(process.env.OSHAL_AUDIO_REVIEW_PROOF_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.OSHAL_AUDIO_REVIEW_PROOF_DIR, t.name.startsWith('removing') ? 'audio-removal.png' : 'audio-empty.png') });
      await fs.writeFile(path.join(process.env.OSHAL_AUDIO_REVIEW_PROOF_DIR, 'audio-' + t.name.replace(/[^a-z0-9]+/ig, '-').slice(0, 60) + '-requests.json'), JSON.stringify(f.requests, null, 2));
    }
    await context.close(); await browser.close(); await f.close();
  });
  if (prepare) await prepare(f);
  await page.goto(f.base + '/api/audio/ui');
  await page.locator('#btn-play').waitFor();
  return { ...f, page, browser };
}

/** @description Save through the actual control and require its real committed revision response. @returns {Promise<object>} Saved project. */
async function save(page) {
  const [response] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/operations')),
    page.locator('#btn-save-project').click()]);
  assert.equal(response.status(), 201, await response.text());
  const { project } = await response.json();
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Saved revision'));
  return project;
}

/** @description Import a real fresh WAV as the only local track and save through the human flow. @returns {Promise<object>} Saved project. */
async function importedSession(page, title) {
  while (await page.locator('.btn-remove-trk').count()) await page.locator('.btn-remove-trk').first().click();
  await page.locator('#input-project-title').fill(title);
  await page.locator('#audio-file-input').setInputFiles({ name: 'Review tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Imported'));
  const project = await save(page); assert.equal(project.stems.length, 1);
  return project;
}

test('removing a persisted audio stem stays removed after Save Revision and reopening', { timeout: 60000 }, async t => {
  const { page, call } = await open(t);
  await importedSession(page, 'Media Review Audio removal fixture');
  await page.locator('.btn-remove-trk').click();
  assert.equal(await page.locator('#track-list .track-card').count(), 0);
  const saved = await save(page);
  assert.equal(saved.stems.length, 0, 'removed stem must be absent from the committed project');
  await page.reload(); await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Loaded'));
  assert.equal(await page.locator('#track-list .track-card').count(), 0);
  assert.equal((await call('GET', '/api/audio/editor/projects/' + saved.id)).body.project.stems.length, 0);
});

test('opening an empty saved audio session shows zero tracks rather than the unsaved arrangement', { timeout: 60000 }, async t => {
  const { page } = await open(t, async f => {
    const created = await f.call('POST', '/api/audio/editor/agent-projects', { title: 'Media Review Audio empty fixture' });
    assert.equal(created.status, 201); assert.equal(created.body.project.stems.length, 0);
  });
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Loaded'));
  assert.equal(await page.locator('#project-title').textContent(), 'Media Review Audio empty fixture');
  assert.equal(await page.locator('#track-list .track-card').count(), 0, 'an empty owned session must not display another arrangement');
});

test('New Session clears the previous tracks while first Save retains the imported draft', { timeout: 60000 }, async t => {
  const { page, call } = await open(t);
  const original = await importedSession(page, 'Media Review Audio first fixture');
  await page.locator('#input-project-title').fill('Media Review Audio new fixture');
  const [response] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/agent-projects')),
    page.locator('#btn-create-project').click()]);
  assert.equal(response.status(), 201);
  const next = (await response.json()).project; assert.notEqual(next.id, original.id);
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Created session'));
  assert.equal(await page.locator('#track-list .track-card').count(), 0, 'a new owned session must clear prior persisted tracks');
  const saved = await save(page); assert.equal(saved.id, next.id); assert.equal(saved.stems.length, 0);
  assert.equal((await call('GET', '/api/audio/editor/projects/' + original.id)).body.project.stems.length, 1);
});

test('saving an explicit removal preserves a concurrent newly added stem', { timeout: 60000 }, async t => {
  const { page, call } = await open(t);
  const original = await importedSession(page, 'Media Review Audio concurrent fixture');
  await page.locator('.btn-remove-trk').click();
  const added = await call('POST', '/api/audio/editor/projects/' + original.id + '/stems', {
    name: 'Concurrent tone', trackName: 'other', audioBase64: toneWav().toString('base64'), mimeType: 'audio/wav',
  });
  assert.equal(added.status, 201);
  const saved = await save(page);
  assert.deepEqual(saved.stems.map(stem => stem.id), [added.body.stem.id]);
  assert.equal(saved.stems[0].name, 'Concurrent tone');
  assert.equal(await page.locator('#track-list .track-card').count(), 1);
});

test('a refused save keeps the pending removal for a later authorized retry', { timeout: 60000 }, async t => {
  const { page, call, token, viewerToken } = await open(t);
  const original = await importedSession(page, 'Media Review Audio refusal fixture');
  await page.locator('.btn-remove-trk').click();
  await page.context().setExtraHTTPHeaders({ authorization: 'Bearer ' + viewerToken });
  const [refused] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/operations')),
    page.locator('#btn-save-project').click()]);
  assert.equal(refused.status(), 403);
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Failed to save revision.');
  assert.equal((await call('GET', '/api/audio/editor/projects/' + original.id)).body.project.stems.length, 1);
  await page.context().setExtraHTTPHeaders({ authorization: 'Bearer ' + token });
  assert.equal((await save(page)).stems.length, 0);
});

test('an oversized revision is refused without silently dropping the last track change', { timeout: 60000 }, async t => {
  let project;
  const { page, call } = await open(t, async f => {
    const created = await f.call('POST', '/api/audio/editor/agent-projects', { title: 'Media Review Audio batch fixture' });
    project = created.body.project;
    for (let n = 0; n < 30; n++) assert.equal((await f.call('POST', '/api/audio/editor/projects/' + project.id + '/stems', {
      name: 'Tone ' + n, trackName: 'other', audioBase64: toneWav().toString('base64'), mimeType: 'audio/wav',
    })).status, 201);
  });
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Loaded'));
  const before = (await call('GET', '/api/audio/editor/projects/' + project.id)).body.project;
  await page.locator('.trk-gain').last().fill('2'); await page.locator('.trk-gain').last().press('Tab');
  const [refused] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/operations')),
    page.locator('#btn-save-project').click()]);
  assert.equal(refused.request().postDataJSON().operations.length, 33);
  assert.equal(refused.status(), 413);
  assert.equal((await refused.json()).error, 'too_many_operations');
  const after = (await call('GET', '/api/audio/editor/projects/' + project.id)).body.project;
  assert.equal(after.revision, before.revision); assert.equal(after.stems.at(-1).gainDb, before.stems.at(-1).gainDb);
  assert.equal(await page.locator('.trk-gain').last().inputValue(), '2.0');
});

test('desktop and touch-phone editing produce independently decoded WAV and MP3 artifacts', { timeout: 90000 }, async t => {
  const f = await open(t);
  const { exerciseStudio, exercisePhone } = await import('./installed-workflow-acceptance.mjs');
  const desktop = await exerciseStudio({ page: f.page, call: f.call, title: 'Media Review Audio artifact fixture', output: f.directory });
  const context = await f.browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true,
    extraHTTPHeaders: { authorization: 'Bearer ' + f.token }, acceptDownloads: true });
  try {
    await f.authenticate(context);
    const phone = await context.newPage(); await phone.goto(f.base + '/api/audio/ui');
    const mobile = await exercisePhone({ page: phone, call: f.call, project: desktop.project, output: f.directory });
    if (process.env.OSHAL_AUDIO_REVIEW_PROOF_DIR) {
      await fs.mkdir(process.env.OSHAL_AUDIO_REVIEW_PROOF_DIR, { recursive: true });
      for (const file of ['desktop.wav', 'desktop.mp3', 'phone.mp3']) await fs.copyFile(path.join(f.directory, file), path.join(process.env.OSHAL_AUDIO_REVIEW_PROOF_DIR, 'audio-source-' + file));
      await fs.writeFile(path.join(process.env.OSHAL_AUDIO_REVIEW_PROOF_DIR, 'audio-source-artifacts.json'), JSON.stringify({ desktop, mobile, boundary: 'Actual source page, router, SQLite and DSP; explicit local authentication fixture. Not installed acceptance.' }, null, 2));
    }
  } finally { await context.close(); }
});
