/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Real Chromium through the real editor screen, the real compiled routes and a disposable PostgreSQL: import two clips and music with the native picker, trim, split and reorder on the keyboard, title, clip and music volume, undo and redo, save, reopen and export; the unsaved draft survives a theme change, a failed save, a reload and a conflict; every portal palette and a phone-width layout keep the controls usable; missing permissions disable exactly what they must and send nothing.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPostgres, resetPostgres } from './video-editor-postgres.fixture.mjs';
import { mediaBytes, clipProbe, bedProbe } from './video-editor.fixture.mjs';
import { chromium, openEditor, PALETTES } from './video-editor-browser.fixture.mjs';

let database, cleanup, browser;
before(async () => { database = await startPostgres(callback => { cleanup = callback; }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await cleanup?.(); });
beforeEach(async () => { await resetPostgres(database.admin); });

const file = (name, kind, probe) => ({ name, mimeType: kind === 'video' ? 'video/mp4' : 'audio/wav', buffer: mediaBytes(kind, probe) });
const segments = page => page.locator('#track .segment').allTextContents();
async function setRange(page, selector, value, event = 'change') {
  await page.locator(selector).evaluate((node, next) => { node.value = String(next.value); node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event(next.event, { bubbles: true })); }, { value, event });
}
async function status(page, text) { await page.locator('#status').filter({ hasText: text }).waitFor(); }
/** Press a key with nothing focused, the way a person uses the timeline shortcuts. */
async function key(page, combo) { await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press(combo); }
async function addMedia(page) {
  await page.locator('#addClip').setInputFiles(file('Beach.mp4', 'video', clipProbe({ seconds: 3 })));
  await status(page, 'Beach.mp4 added.');
  await page.locator('#addClip').setInputFiles(file('Street.mp4', 'video', clipProbe({ seconds: 2, audio: false, width: 180, height: 320 })));
  await status(page, 'Street.mp4 added.');
  await page.locator('#addBed').setInputFiles(file('Tune.wav', 'audio', bedProbe({ seconds: 10 })));
  await status(page, 'Tune.wav added.');
}

test('import, trim, split, reorder, title, volume, undo, save, reopen and export on the real screen', async t => {
  const { page, api, errors, external, requests } = await openEditor(t, browser, database);
  await status(page, 'Ready. Add a clip to start.');
  await page.locator('#projectName').fill('Holiday cut'); await page.locator('#projectName').press('Tab');
  await addMedia(page);
  assert.deepEqual(await segments(page), ['Beach.mp4 · 0:03.00', 'Street.mp4 · 0:02.00']);
  assert.equal(await page.locator('#bedSource').inputValue(), 'm1', 'the first music file becomes the bed');
  await page.locator('#track .segment').first().click();
  await page.locator('#trimIn').fill('15'); await page.locator('#trimIn').press('Tab');
  await page.locator('#trimOut').fill('75'); await page.locator('#trimOut').press('Tab');
  assert.deepEqual(await segments(page), ['Beach.mp4 · 0:02.00', 'Street.mp4 · 0:02.00']);
  await setRange(page, '#playhead', 30, 'input');
  await key(page, 's');
  assert.deepEqual(await segments(page), ['Beach.mp4 · 0:01.00', 'Beach.mp4 · 0:01.00', 'Street.mp4 · 0:02.00'], 'S splits at the playhead');
  await page.locator('#track .segment').last().click();
  await key(page, '['); await key(page, '[');
  assert.deepEqual(await segments(page), ['Street.mp4 · 0:02.00', 'Beach.mp4 · 0:01.00', 'Beach.mp4 · 0:01.00'], '[ moves the selection earlier');
  await setRange(page, '#playhead', 0, 'input');
  await page.locator('#titleText').fill('Hello'); await page.locator('#titleSeconds').fill('1'); await page.locator('#titlePosition').selectOption('top');
  await page.locator('#addTitle').click();
  assert.match(await page.locator('#titles').innerText(), /“Hello”[\s\S]*0:00\.00–0:01\.00 · top · medium/);
  await setRange(page, '#segmentVolume', 150);
  await setRange(page, '#bedVolume', 30);
  await key(page, 'Control+z');
  assert.equal(await page.locator('#bedVolume').inputValue(), '40', 'Ctrl+Z undoes the music volume');
  await key(page, 'Control+Shift+z');
  assert.equal(await page.locator('#bedVolume').inputValue(), '30', 'Ctrl+Shift+Z redoes it');
  await key(page, 'Control+s');
  await status(page, 'Saved · revision 1');
  const id = new URL(page.url()).searchParams.get('project');
  const saved = (await api.call(`/editor/projects/${id}`)).body.project.document;
  assert.deepEqual(saved.segments.map(s => [s.source, s.in, s.out, s.volume]), [['v2', 0, 60, 150], ['v1', 15, 45, 100], ['v1', 45, 75, 100]]);
  assert.deepEqual([saved.name, saved.titles.map(title => [title.text, title.start, title.end, title.position]), saved.audioBed], ['Holiday cut', [['Hello', 0, 30, 'top']], { source: 'm1', volume: 30 }]);
  await page.reload(); await page.locator('html[data-editor-ready="true"]').waitFor();
  await status(page, 'Saved · revision 1');
  assert.deepEqual(await segments(page), ['Street.mp4 · 0:02.00', 'Beach.mp4 · 0:01.00', 'Beach.mp4 · 0:01.00'], 'reopened exactly');
  assert.equal(await page.locator('#projectName').inputValue(), 'Holiday cut');
  await page.locator('#exportMp4').click();
  await page.locator('#exportStatus').filter({ hasText: 'Export ready.' }).waitFor();
  const href = await page.locator('#downloadExport').getAttribute('href');
  const download = await page.request.get(api.origin + href);
  assert.equal(download.status(), 200); assert.equal(download.headers()['content-type'], 'video/mp4');
  await page.locator('#renderPreview').click();
  await page.locator('#exportStatus').filter({ hasText: 'Preview ready.' }).waitFor();
  assert.match((await page.locator('#watchExport').getAttribute('href')) ?? '', /\/download\?inline=1$/);
  assert.equal(api.state.decisions.includes('editor.export'), true);
  assert.ok(requests.filter(line => line.startsWith('POST /api/video/editor/projects/') && line.endsWith('/exports')).length === 2);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});

test('the unsaved draft survives a theme change, a failed save, a reload and a conflict', async t => {
  const { page, api, errors } = await openEditor(t, browser, database);
  await page.locator('#addClip').setInputFiles(file('Beach.mp4', 'video', clipProbe({ seconds: 3 })));
  await status(page, 'Beach.mp4 added.');
  await key(page, 'Control+s'); await status(page, 'Saved · revision 1');
  await page.locator('#projectName').fill('Draft name'); await page.locator('#projectName').press('Tab');
  await page.evaluate(() => { localStorage.setItem('cockpit-theme', 'daylight'); window.dispatchEvent(new StorageEvent('storage', { key: 'cockpit-theme', newValue: 'daylight' })); });
  await page.locator('html[data-theme="daylight"]').waitFor();
  assert.equal(await page.locator('#projectName').inputValue(), 'Draft name', 'a theme change keeps the draft');
  assert.equal(await page.locator('#dirtyFlag').isVisible(), true);
  let failNext = true;
  await page.route('**/api/video/editor/projects/*/revisions', route => {
    if (failNext && route.request().method() === 'POST') { failNext = false; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"video_edit_service_unavailable"}' }); }
    return route.continue();
  });
  await key(page, 'Control+s');
  await status(page, 'Not saved. Your edits are still here.');
  assert.equal(await page.locator('#projectName').inputValue(), 'Draft name', 'a failed save keeps the draft');
  await page.reload(); await page.locator('html[data-editor-ready="true"]').waitFor();
  await status(page, 'Restored your unsaved edits.');
  assert.equal(await page.locator('#projectName').inputValue(), 'Draft name', 'a reload restores the draft from this browser');
  const id = new URL(page.url()).searchParams.get('project');
  const current = (await api.call(`/editor/projects/${id}`)).body.project;
  await api.call(`/editor/projects/${id}/revisions`, 'POST', { baseRevision: 1, title: 'Other tab', document: { ...current.document, name: 'Other tab' } });
  await key(page, 'Control+s');
  await page.locator('#error').filter({ hasText: 'saved somewhere else' }).waitFor();
  assert.equal(await page.locator('#reloadSaved').isVisible(), true);
  assert.equal(await page.locator('#projectName').inputValue(), 'Draft name', 'a conflict keeps the draft');
  await page.locator('#saveAsNew').click(); await status(page, 'Saved · revision 1');
  assert.notEqual(new URL(page.url()).searchParams.get('project'), id, 'saved as a new project');
  assert.equal((await api.call(`/editor/projects/${id}`)).body.project.title, 'Other tab', 'the other tab kept its save');
  assert.deepEqual(errors, []);
});

test('every portal palette and a phone-width layout keep the editor readable and usable', async t => {
  const wide = await openEditor(t, browser, database);
  const contrast = selector => wide.page.locator(selector).evaluate(node => {
    const parse = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = rgb => { const [r, g, b] = rgb.map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    let background = 'rgba(0, 0, 0, 0)', from = node;
    while (from && /rgba\(0, 0, 0, 0\)|transparent/.test(background)) { background = getComputedStyle(from).backgroundColor; from = from.parentElement; }
    const a = luminance(parse(getComputedStyle(node).color)), b = luminance(parse(background));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  for (const palette of PALETTES) {
    await wide.page.evaluate(theme => { localStorage.setItem('cockpit-theme', theme); window.dispatchEvent(new StorageEvent('storage', { key: 'cockpit-theme', newValue: theme })); }, palette);
    await wide.page.locator(`html[data-theme="${palette}"]`).waitFor();
    assert.ok(await contrast('h1') >= 4.5, `${palette}: heading contrast`);
    assert.ok(await contrast('#status') >= 3, `${palette}: status contrast`);
    assert.ok(await contrast('#newProject') >= 3, `${palette}: button contrast`);
  }
  const narrow = await openEditor(t, browser, database, { viewport: { width: 390, height: 844 } });
  const overflow = await narrow.page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  assert.ok(overflow <= 1, `no horizontal scrolling at phone width (${overflow}px)`);
  await narrow.page.locator('#addClip').setInputFiles(file('Beach.mp4', 'video', clipProbe({ seconds: 3 })));
  await narrow.page.locator('#status').filter({ hasText: 'Beach.mp4 added.' }).waitFor();
  for (const selector of ['#saveProject', '#play', '#track .segment', '#playhead', '#addTitle', '#exportMp4']) {
    const box = await narrow.page.locator(selector).first().boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 391, `${selector} fits the phone width`);
  }
  await narrow.page.locator('#track .segment').first().click();
  assert.equal(await narrow.page.locator('#segmentControls').isVisible(), true);
});

test('missing permissions disable exactly what they must and send nothing', async t => {
  const noExport = await openEditor(t, browser, database, { denied: ['editor.export'] });
  await noExport.page.locator('#addClip').setInputFiles(file('Beach.mp4', 'video', clipProbe({ seconds: 3 })));
  await status(noExport.page, 'Beach.mp4 added.');
  await key(noExport.page, 'Control+s'); await status(noExport.page, 'Saved · revision 1');
  assert.equal(await noExport.page.locator('#exportMp4').isDisabled(), true);
  assert.equal(await noExport.page.locator('#renderPreview').isDisabled(), true);
  assert.equal(await noExport.page.locator('#exportHint').innerText(), 'Your access does not include exporting.');
  assert.equal(noExport.requests.some(line => line.endsWith('/exports')), false);
  const readOnly = await openEditor(t, browser, database, { denied: ['editor.create', 'editor.change'] });
  await status(readOnly.page, 'Your access does not include creating projects.');
  for (const selector of ['#addClip', '#addBed', '#saveProject', '#saveAsNew', '#newProject']) assert.equal(await readOnly.page.locator(selector).isDisabled(), true, selector);
  assert.equal(readOnly.requests.some(line => line.startsWith('POST')), false, 'nothing was written');
});
