/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Video editor on a phone with real touch (Roger, trial.oswarm.ai, 2026-11-06, F4: "doesn't have an upload vid to edit and has a theme that I've never seen before"): an empty project shows Add a clip on the first screen without opening a pane, a tap on it opens the real picker and the clip lands in the timeline; the app bar is one row with More; and the manifest forces no theme. Real compiled routes, disposable PostgreSQL and the kernel's shared editor from OSHAL_PLATFORM_ROOT. The hidden #addClip input is never filled directly.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The trial check (2026-11-06): 181 px of bars before content, 73 px of it an empty band above the app bar (the emptied main.workspace kept its own display:grid). Content now starts within 74 px of the frame (120 px with the 46 px Today row) and the shell starts at the top.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startPostgres, resetPostgres } from './video-editor-postgres.fixture.mjs';
import { mediaBytes, clipProbe } from './video-editor.fixture.mjs';
import { chromium, openEditor } from './video-editor-browser.fixture.mjs';

const PHONE = { isMobile: true, hasTouch: true, deviceScaleFactor: 2.5 };
let database, cleanup, browser;
before(async () => { database = await startPostgres(callback => { cleanup = callback; }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await cleanup?.(); });
beforeEach(async () => { await resetPostgres(database.admin); });

test('an empty project offers Add a clip on the first screen and one tap adds the clip to the timeline', async t => {
  const { page, errors } = await openEditor(t, browser, database, { viewport: { width: 390, height: 844 }, device: PHONE, theme: 'light-blue' });
  await page.locator('#addClip:not([disabled])').waitFor({ state: 'attached' });
  const primary = page.locator('.ef-viewport .ef-primary');
  await primary.waitFor();
  const bars = await page.evaluate(() => ({ shell: Math.round(document.querySelector('.ef-shell').getBoundingClientRect().top), viewport: Math.round(document.querySelector('.ef-viewport').getBoundingClientRect().top) }));
  assert.equal(bars.shell, 0, 'no empty band above the app bar');
  assert.ok(bars.viewport <= 74, `content starts ${bars.viewport}px into the frame`);
  assert.equal(await primary.textContent(), 'Add a clip');
  assert.equal(await primary.evaluate(node => { const box = node.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return box.bottom <= innerHeight && (hit === node || node.contains(hit)); }), true, 'on the first screen, under the finger');
  assert.equal(await page.locator('body').getAttribute('data-editor-panel'), '', 'no pane opened');
  const chooser = page.waitForEvent('filechooser');
  await primary.tap();
  await (await chooser).setFiles({ name: 'Beach.mp4', mimeType: 'video/mp4', buffer: mediaBytes('video', clipProbe({ seconds: 3 })) });
  await page.locator('#status').filter({ hasText: 'Beach.mp4 added.' }).waitFor();
  assert.ok(await page.locator('#track .segment').count() >= 1, 'the clip is in the timeline');
  assert.equal(await primary.isVisible(), false, 'the start card leaves once there is media');
  const bar = await page.locator('.ef-header-slot').boundingBox();
  assert.ok(bar.height <= 72, `the app bar is one row (${bar.height}px)`);
  assert.equal(await page.locator('#undo').isVisible(), false, 'Undo waits in More on a phone');
  await page.getByRole('button', { name: '⋯ More', exact: true }).tap();
  assert.equal(await page.locator('.ef-sheet #undo').isVisible(), true);
  assert.deepEqual(await page.locator('.ef-panes button').allTextContents(), ['Media', 'Properties', 'Concierge']);
  assert.deepEqual(errors, []);
});

test('the Video manifest forces no theme, so a person with none saved wears the portal default', async () => {
  const manifest = await readFile(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
  assert.doesNotMatch(manifest, /^theme:/m, 'Video follows the person\'s portal theme (screen standard §1)');
});
