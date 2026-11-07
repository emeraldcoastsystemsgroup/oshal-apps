/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (camera--camera-ops, grade D): the shipped
 *   tools/camera-ops.html in headless Chromium with a fake camera (--use-fake-device-for-media-stream), through
 *   capture-screen.fixture.cjs. With no camera node (GET /fleet lists none) the page is the Camera screen only: a live
 *   preview, one round shutter of at least 64px at the bottom centre, Photo · Video · Timelapse beside it, and a captures
 *   strip; Fleet, Control, Telemetry, Event log, Connect, Disconnect and the inline Concierge are absent; every control is
 *   at least 44px; a photo, a video and a timelapse each save to this computer (a download) and land in the strip; Clear
 *   the captures list confirms in the page. A refused camera, pressed or already blocked, shows role="alert" saying how to
 *   allow it. With a camera node the Cameras screen brings the fleet panels back, and Delete all media sits in its More
 *   with an in-page confirm before the confirm:true control is sent. The diagnostic brief is withheld under the kernel's
 *   real mountConnectedActions (which offers nothing today) and opens as a token-painted sheet when an action is offered.
 *   No window.alert/confirm/prompt ever opens. Needs the store toolchain (express, playwright, chromium); the kernel
 *   checkout (OSHAL_KERNEL_ROOT) supplies app-workflows.js. CAMERA_OPS_PAGE points it at another copy of the page.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The brief sheet and the delete confirm are checked in light-blue after the glass
 *   layer re-marks the page: neither is marked as glass and the sheet's background is opaque (red without data-no-glass).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve, ONE_CAMERA, TOOLCHAIN, COCKPIT_JS } = require('./capture-screen.fixture.cjs');
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const FLEET_HEADINGS = /^(Fleet|Control|Telemetry|Event log|Concierge)\b/i;

/**
 * @description Open the page in a fresh context and count any native dialog (alert, confirm, prompt) it opens.
 * @param {object} browser Playwright browser.
 * @param {string} base Fixture base URL.
 * @param {object} opts Context options plus `init`, a script run before the page.
 * @returns {Promise<{ page: object, dialogs: string[], ctx: object }>} The page, the native dialogs seen, the context.
 */
async function open(browser, base, opts) {
  const { init, ...ctxOpts } = opts;
  const ctx = await browser.newContext({ acceptDownloads: true, ...ctxOpts });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(), dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.type()); d.dismiss().catch(() => {}); });
  await page.goto(`${base}/camera`);
  return { page, dialogs, ctx };
}

/** @returns {Promise<string[]>} Every visible control smaller than 44×44, as "<id or text> WxH". */
function smallControls(page) {
  return page.evaluate(() => [...document.querySelectorAll('button, select, input, textarea, a[href], [role="tab"], [role="menuitem"]')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
    .map((e) => { const r = e.getBoundingClientRect(); return { n: e.id || e.textContent.trim().slice(0, 24), w: r.width, h: r.height }; })
    .filter((c) => c.w < 44 || c.h < 44).map((c) => `${c.n} ${Math.round(c.w)}x${Math.round(c.h)}`));
}

/** @returns {Promise<string[]>} The visible section headings of the page. */
function visibleHeadings(page) {
  return page.evaluate(() => [...document.querySelectorAll('h1, h2')].filter((h) => h.getClientRects().length).map((h) => h.textContent.trim()));
}

/**
 * @description Press the shutter (twice, `holdMs` apart, for a video or a timelapse) and wait for the file it saves.
 * @param {object} page Playwright page.
 * @param {number} holdMs 0 for one press.
 * @returns {Promise<string>} The suggested file name of the download; the saved file must not be empty.
 */
async function shoot(page, holdMs) {
  const saved = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#btnShutter');
  if (holdMs) { await page.waitForTimeout(holdMs); await page.click('#btnShutter'); }
  const file = await saved;
  assert.ok(fs.statSync(await file.path()).size > 1000, 'the saved file has content: ' + file.suggestedFilename());
  return file.suggestedFilename();
}

async function launch(t, opts, args) {
  const fx = await serve(opts);
  const browser = await chromium.launch({ args: args || ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  t.after(async () => { await browser.close(); await new Promise((r) => fx.server.close(r)); });
  return { fx, browser };
}

test('no camera node: only This device, with a live preview, a 64px shutter at the bottom centre and no fleet panel', async (t) => {
  assert.ok(fs.existsSync(path.join(COCKPIT_JS, 'app-workflows.js')), 'the kernel checkout must be present (set OSHAL_KERNEL_ROOT)');
  const { fx, browser } = await launch(t, {});
  for (const shape of [PHONE, DESKTOP]) {
    const { page, dialogs, ctx } = await open(browser, fx.base, { ...shape, permissions: ['camera'] });
    await page.waitForSelector('#stage.live video', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(300);
    const heads = await visibleHeadings(page);
    assert.ok(!heads.some((h) => FLEET_HEADINGS.test(h)), 'no fleet panel or concierge with no node: ' + heads.join(' | '));
    for (const id of ['#screenTabs', '#screenCameras', '#btnConnect', '#btnDisconnect', '#fleetList', '#btnDeleteAll']) assert.equal(await page.isVisible(id), false, id + ' is withheld');
    assert.equal(await page.locator('#chatInput, #chatSend').count(), 0, 'the inline Concierge card is gone');
    const sh = await page.locator('#btnShutter').boundingBox(), stage = await page.locator('#stage').boundingBox();
    assert.ok(sh.width >= 64 && sh.height >= 64, `shutter ${sh.width}x${sh.height}`);
    assert.ok(Math.abs(sh.x + sh.width / 2 - (stage.x + stage.width / 2)) <= 2, 'the shutter is centred under the preview');
    assert.ok(sh.y >= stage.y + stage.height, 'the shutter is below the preview');
    assert.ok(stage.width >= shape.viewport.width * 0.7, 'the preview takes the width');
    for (const mode of ['Photo', 'Video', 'Timelapse']) assert.ok(await page.getByRole('button', { name: mode, exact: true }).isVisible(), mode);
    assert.deepEqual(await smallControls(page), [], 'every control is at least 44px');
    assert.equal(await page.isVisible('#menuBrief'), false, 'no brief while the connected actions offer nothing');
    assert.deepEqual(dialogs, []);
    await ctx.close();
  }
});

test('this device: a photo, a video and a timelapse save to this computer and land in the strip; clearing it confirms in the page', async (t) => {
  const { fx, browser } = await launch(t, {});
  const { page, dialogs } = await open(browser, fx.base, { ...PHONE, permissions: ['camera'] });
  await page.waitForSelector('#stage.live video', { state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('localVideo').videoWidth > 0);
  assert.match(await shoot(page, 0), /^photo-\d{8}-\d{6}\.png$/);
  await page.getByRole('button', { name: 'Video', exact: true }).click();
  assert.match(await shoot(page, 900), /^clip-\d{8}-\d{6}\.(webm|mp4)$/);
  await page.getByRole('button', { name: 'Timelapse', exact: true }).click();
  assert.match(await shoot(page, 2300), /^timelapse-\d{8}-\d{6}\.(webm|mp4)$/);
  const strip = await page.locator('#localStrip .strip-item .strip-cap').allTextContents();
  assert.deepEqual(strip.map((s) => s.split(' ')[0]), ['Timelapse', 'Video', 'Photo']);
  await page.click('#btnMore');
  await page.click('#menuClear');
  assert.equal(await page.locator('#deleteConfirm').evaluate((d) => d.open), true, 'the confirm is in the page');
  await page.click('#btnDeleteConfirm');
  assert.equal(await page.locator('#localStrip .strip-item').count(), 0);
  assert.deepEqual(dialogs, [], 'no window.confirm');
});

test('a refused camera shows role="alert" saying how to allow it, pressed or already blocked', async (t) => {
  const { fx, browser } = await launch(t, {}, []);
  const refuse = () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); };
  const pressed = await open(browser, fx.base, { ...PHONE, init: refuse });
  await pressed.page.click('#btnLocalConnect');
  const alert = pressed.page.getByRole('alert');
  await alert.waitFor({ state: 'visible' });
  assert.match(await alert.textContent(), /blocked[\s\S]*set Camera to Allow[\s\S]*Turn on camera again/);
  const blocked = () => { navigator.permissions.query = () => Promise.resolve({ state: 'denied', onchange: null }); };
  const already = await open(browser, fx.base, { ...DESKTOP, init: blocked });
  await already.page.getByRole('alert').waitFor({ state: 'visible' });
  assert.match(await already.page.getByRole('alert').textContent(), /set Camera to Allow/);
});

test('with a camera node: the Cameras screen shows the fleet panels, and Delete all media in its More confirms in the page', async (t) => {
  const { fx, browser } = await launch(t, { fleet: ONE_CAMERA });
  const { page, dialogs } = await open(browser, fx.base, { ...DESKTOP, permissions: ['camera'], init: () => localStorage.setItem('cockpit-theme', 'light-blue') });
  await page.getByRole('tab', { name: 'Cameras' }).click();
  await page.waitForSelector('#fleetList .cam-row');
  const heads = await visibleHeadings(page);
  for (const h of ['Fleet', 'Telemetry', 'Event log']) assert.ok(heads.includes(h), h + ' shown: ' + heads.join(' | '));
  assert.ok(heads.some((h) => /^Control/.test(h)), 'Control shown');
  assert.ok(await page.isVisible('#btnConnect') && await page.isVisible('#btnDisconnect'), 'Connect and Disconnect come back');
  assert.deepEqual(await smallControls(page), [], 'every control is at least 44px');
  await page.click('#btnMore');
  assert.ok(await page.isVisible('#btnDeleteAll') && !(await page.isDisabled('#btnDeleteAll')), 'Delete all media is in More');
  await page.click('#btnDeleteAll');
  await page.waitForFunction(() => document.getElementById('deleteConfirm').open);
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#deleteConfirm').getAttribute('data-oshal-glass'), null, 'the confirm stays opaque');
  await page.click('#btnDeleteConfirm');
  await page.waitForFunction(() => !document.getElementById('deleteConfirm').open);
  await page.waitForTimeout(200);
  assert.deepEqual(fx.controls.filter((c) => c.op === 'deleteAll'), [{ cameraId: 'sim-1', op: 'deleteAll' }, { cameraId: 'sim-1', op: 'deleteAll', confirm: true }]);
  assert.deepEqual(dialogs, [], 'no window.confirm');
  await page.getByRole('tab', { name: 'Camera', exact: true }).click();
  assert.equal(await page.isVisible('#fleetList'), false, 'the Camera screen is this device only');
});

test('the diagnostic brief opens from More as a sheet painted with theme tokens when an action is offered', async (t) => {
  const { fx, browser } = await launch(t, { offer: true });
  // light-blue: the theme whose translucent --bg-card made the old floating brief near-invisible.
  const { page } = await open(browser, fx.base, { ...PHONE, permissions: ['camera'], init: () => localStorage.setItem('cockpit-theme', 'light-blue') });
  await page.waitForSelector('#btnMore', { state: 'visible' });
  await page.click('#btnMore');
  await page.getByRole('menuitem', { name: 'Prepare a diagnostic brief' }).click();
  const sheet = page.locator('#evidenceReview');
  assert.equal(await sheet.evaluate((d) => d.open), true);
  await page.waitForTimeout(600); // the glass layer re-marks the page 250 ms after it changes
  const paint = await sheet.evaluate((d) => ({ inline: d.getAttribute('style'), glass: d.hasAttribute('data-oshal-glass'), color: getComputedStyle(d).backgroundColor }));
  assert.equal(paint.inline, null, 'no inline colours');
  assert.equal(paint.glass, false, 'the glass layer leaves the sheet opaque');
  assert.doesNotMatch(paint.color, /rgba\(.*, 0(\.\d+)?\)$|transparent/, 'opaque, painted from the theme tokens: ' + paint.color);
  assert.ok(await page.getByRole('button', { name: 'Open in Office' }).isVisible(), 'the offered action is in the sheet');
  await page.getByRole('button', { name: 'Done' }).click();
  assert.equal(await sheet.evaluate((d) => d.open), false);
});
