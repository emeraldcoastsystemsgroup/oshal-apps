/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Video 1.13.0 against the oshal design standard (docs/ux/design-standard.md §3.1, §4.4, §4.10, §5.1; CapCut and InShot, REFP CONVENTIONS §5.3). At 412x743 with real touch and at 1440x900: the page declares its contract and its work; the empty timeline holds the one primary, Add a clip, which opens the real picker; with a clip on the timeline Export is the one primary and Save is never the primary; one tool row marked data-ds-toolrow, More last, with the planned Stickers and Filters greyed, aria-disabled, linked to their backlog ids and inert when tapped; a tapped clip turns the row into its tools with the planned Speed, Effects, Chroma key, Remove background and Stabilize; a tool opens an opaque modal sheet that the browser's Back closes inside the editor, and the Export sheet (1080p, 4K and 60 fps planned) opens again with its controls after it closes; Delete project asks in the page (no native dialog); the manifest's dark category look is graphite. Real compiled routes, a disposable PostgreSQL and the kernel's shared editor from OSHAL_PLATFORM_ROOT. Red on store main cb09e961 (Video 1.12.4), green on 1.13.0.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startPostgres, resetPostgres } from './video-editor-postgres.fixture.mjs';
import { mediaBytes, clipProbe } from './video-editor.fixture.mjs';
import { chromium, openEditor } from './video-editor-browser.fixture.mjs';

const PHONE = { viewport: { width: 412, height: 743 }, device: { isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 } };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
let database, cleanup, browser;
before(async () => { database = await startPostgres(callback => { cleanup = callback; }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await cleanup?.(); });
beforeEach(async () => { await resetPostgres(database.admin); });

/** The enabled primaries on screen (DS-24): the buttons the editor paints with the accent (.primary, the shared .ef-primary). */
const primaries = page => page.evaluate(() => [...document.querySelectorAll('button.primary, button.ef-primary')]
  .filter(button => { const box = button.getBoundingClientRect(); return box.width && box.bottom > 0 && box.top < innerHeight && !button.disabled && getComputedStyle(button).visibility !== 'hidden'; })
  .map(button => button.textContent.trim()));
const press = (page, locator, touch) => touch ? locator.tap() : locator.click();
/** A person's press where the control is, as the design audit makes it: a planned control is aria-disabled, so Playwright's own tap would wait for it to be enabled. */
const pressAt = async (page, locator, touch) => { const box = await locator.boundingBox(); const x = box.x + box.width / 2, y = box.y + box.height / 2; if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };

for (const [size, options] of [['phone 412x743', PHONE], ['desktop 1440x900', DESKTOP]]) {
  const touch = size.startsWith('phone');
  test(`${size}: the empty timeline offers Add a clip as the one primary, then Export is the one primary`, async t => {
    const { page, errors } = await openEditor(t, browser, database, { ...options, theme: 'light-blue' });
    assert.equal(await page.locator('html').getAttribute('data-ds-category'), 'editor');
    assert.equal(await page.locator('html').getAttribute('data-ds-first-action'), 'file:video');
    assert.equal(await page.locator('[data-ds-work]').count(), 1, 'one work surface');
    await page.locator('.video-start .primary:not([disabled])').waitFor();
    assert.deepEqual(await primaries(page), ['Add a clip'], 'the first action is the one primary');
    assert.equal(await page.locator('#saveProject').isVisible(), false, 'nothing to save yet');
    const chooser = page.waitForEvent('filechooser');
    await press(page, page.locator('.video-start .primary'), touch);
    await (await chooser).setFiles({ name: 'Beach.mp4', mimeType: 'video/mp4', buffer: mediaBytes('video', clipProbe({ seconds: 3 })) });
    await page.locator('#status').filter({ hasText: 'Beach.mp4 added.' }).waitFor();
    assert.deepEqual(await primaries(page), ['Export'], 'with a clip the finishing action is the one primary');
    assert.equal(await page.locator('#saveProject').isVisible(), true, 'Save shows while there is something to save');
    assert.notEqual(await page.locator('#saveProject').evaluate(node => node.classList.contains('primary')), true, 'Save is never the primary');
    for (let round = 0; round < 2; round += 1) { // the Export sheet opens again with its controls, however it closed
      await press(page, page.locator('button.video-export'), touch);
      const sheet = page.locator('dialog.ds-layer[open]'); await sheet.locator('#exportMp4').waitFor();
      assert.equal(await sheet.locator('[data-ds-backlog="RP-VID-09"]').count(), 3, '1080p, 4K and 60 fps are planned rows');
      assert.equal(await sheet.locator('#cancelExport').isVisible(), false, 'Cancel shows only while a job runs');
      await page.goBack(); await sheet.waitFor({ state: 'detached' });
      assert.equal(await page.locator('#exportMp4').count(), 1, 'the export control went back to the page');
    }
    assert.deepEqual(errors, []);
  });

  test(`${size}: one tool row with More last, planned controls greyed and inert, clip tools on a tapped clip`, async t => {
    const { page, errors, requests } = await openEditor(t, browser, database, { ...options, theme: 'light-blue' });
    const row = page.locator('[data-ds-toolrow]');
    assert.equal(await row.count(), 1);
    const labels = await row.locator('button').evaluateAll(buttons => buttons.map(button => button.querySelector('.video-word,.ds-not-yet-name')?.textContent ?? button.textContent));
    assert.equal(labels.at(-1), 'More', 'More is the last item of the row');
    for (const label of ['Add', 'Text', 'Audio']) assert.ok(labels.includes(label), `${label} is in the row`);
    const stickers = row.locator('[data-ds-backlog="RP-VID-03"]'), filters = row.locator('[data-ds-backlog="RP-VID-04"]');
    for (const planned of [stickers, filters]) {
      assert.equal(await planned.getAttribute('aria-disabled'), 'true');
      assert.match(await planned.getAttribute('aria-label'), /not available yet$/i);
      assert.equal(await planned.evaluate(node => getComputedStyle(node).opacity), '1');
    }
    const before = requests.length, html = await page.locator('body').innerHTML();
    await stickers.scrollIntoViewIfNeeded(); await pressAt(page, stickers, touch); await page.waitForTimeout(400);
    assert.equal(requests.length, before, 'a planned control sends nothing');
    assert.equal(await page.locator('dialog[open]').count(), 0, 'a planned control opens nothing');
    assert.equal(await page.locator('body').innerHTML(), html, 'a planned control changes nothing');
    await page.locator('#addClip').setInputFiles({ name: 'Beach.mp4', mimeType: 'video/mp4', buffer: mediaBytes('video', clipProbe({ seconds: 3 })) });
    await page.locator('#status').filter({ hasText: 'Beach.mp4 added.' }).waitFor();
    await press(page, page.locator('#track .segment').first(), touch);
    for (const backlog of ['RP-VID-01', 'RP-VID-04', 'RP-VID-05', 'RP-VID-06', 'RP-VID-08']) assert.equal(await row.locator(`[data-ds-backlog="${backlog}"]`).count(), 1, `${backlog} is a planned clip tool`);
    assert.equal(await row.getByRole('button', { name: /Split/ }).count(), 1, 'Split is a clip tool');
    await press(page, row.getByRole('button', { name: /Done/ }), touch);
    assert.equal(await row.locator('[data-ds-backlog="RP-VID-03"]').count(), 1, 'Done returns to the main tools');
    assert.deepEqual(errors, []);
  });

  test(`${size}: a tool opens an opaque modal sheet that Back closes inside the editor`, async t => {
    const { page, errors } = await openEditor(t, browser, database, { ...options, theme: 'light-blue' });
    const url = page.url();
    await press(page, page.locator('[data-ds-toolrow]').getByRole('button', { name: /^.?\s*Text$/ }), touch);
    const sheet = page.locator('dialog.ds-layer[open]');
    await sheet.waitFor();
    assert.equal(await sheet.evaluate(node => node.matches(':modal')), true, 'the sheet is modal, in the top layer');
    assert.equal(await sheet.evaluate(node => { const [, , , a] = getComputedStyle(node).backgroundColor.match(/[\d.]+/g).map(Number).concat(1); return a; }), 1, 'opaque');
    assert.equal(await sheet.locator('#titleForm').isVisible(), true, 'the titles form is in the sheet');
    assert.equal(await sheet.locator('[data-ds-backlog="RP-VID-02"]').count(), 1, 'Auto captions is planned in the Text sheet');
    await page.goBack();
    await sheet.waitFor({ state: 'detached' });
    assert.equal(page.url(), url, 'Back closed the sheet and stayed in the editor');
    assert.equal(await page.locator('#titleForm').isVisible(), false, 'the form went back where it was');
    assert.deepEqual(errors, []);
  });
}

test('Delete project asks in the page, never in a native dialog', async t => {
  const { page, errors } = await openEditor(t, browser, database, { ...DESKTOP, theme: 'light-blue' });
  const dialogs = []; page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
  await page.locator('#addClip').setInputFiles({ name: 'Beach.mp4', mimeType: 'video/mp4', buffer: mediaBytes('video', clipProbe({ seconds: 3 })) });
  await page.locator('#status').filter({ hasText: 'Beach.mp4 added.' }).waitFor();
  await page.locator('#saveProject').click(); await page.locator('#status').filter({ hasText: 'Saved · revision 1' }).waitFor();
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete project' }).click();
  const confirm = page.locator('dialog.ds-confirm[open]'); await confirm.waitFor();
  await confirm.getByRole('button', { name: 'Delete project' }).click();
  await page.locator('#status').filter({ hasText: 'Deleted' }).waitFor();
  assert.deepEqual(dialogs, [], 'no native confirm');
  assert.deepEqual(errors, []);
});

test('the manifest declares graphite, the dark category look D2 allows the video editors', async () => {
  const manifest = await readFile(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
  assert.match(manifest, /^theme: graphite$/m);
  assert.match(manifest, /^version: 1\.13\.1$/m);
});

test('Add media withholds Generate a clip when no Vids worker is online and offers it when one is online', async t => {
  const offline = await openEditor(t, browser, database, { ...DESKTOP, theme: 'light-blue' });
  await offline.page.locator('[data-ds-toolrow]').getByRole('button', { name: /Add/ }).click();
  const sheet1 = offline.page.locator('dialog.ds-layer[open]');
  await sheet1.waitFor();
  assert.equal(await sheet1.locator('[data-vids-generate]').count(), 0, 'withheld when offline');

  const online = await openEditor(t, browser, database, { ...DESKTOP, theme: 'light-blue' });
  await online.page.route('**/api/vids/jobs*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ workers: [{ name: 'vids-node', status: 'online' }], jobs: [] }),
  }));
  await online.page.route('**/api/vids/source-projects*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ projects: [{ id: 'b1', title: 'Launch brief', revision: 1 }] }),
  }));
  await online.page.locator('[data-ds-toolrow]').getByRole('button', { name: /Add/ }).click();
  const sheet2 = online.page.locator('dialog.ds-layer[open]');
  await sheet2.waitFor();
  assert.equal(await sheet2.locator('[data-vids-generate]').count(), 1, 'offered when Vids worker is online');
  await sheet2.locator('[data-vids-generate]').click();
  await online.page.locator('dialog.ds-layer[open][aria-label="Generate a clip"]').waitFor();
  assert.deepEqual(online.errors, []);
});
