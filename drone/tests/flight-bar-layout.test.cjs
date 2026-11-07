/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (drone--drone-ops, D): scrolling the rail to name a
 *   mission moved Land, Return home and Abort ALL off screen. In Chromium the shipped drone-ops.html keeps the three in a
 *   52px flight bar on screen at 412x915 (touch) at every scroll position and in both rail views, and at the bottom of
 *   the canvas at 1440x900, where the canvas keeps at least 60% of the width and the rail scrolls on its own. Plan
 *   waypoints, Direct goto, 3D and CAM are one exclusive control; small buttons are 44px; with no drone one empty state
 *   sits on the canvas and no /fleet/<drone>/ poll is sent; Brief opens and closes the diagnostic brief sheet. Layout
 *   only: every non-GET request is aborted and counted, and the test presses no flight button. Seams: /api/drone answers
 *   a fixture fleet (the native no-drone marker, or one simulator drone); shared assets are empty stand-ins.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const HOME = { lat: 30.4, lon: -86.6, alt: 0 };
const TELEMETRY = { status: 'disarmed', position: { ...HOME }, home: HOME, groundSpeedMps: 0, distanceFromHomeM: 0, headingDeg: 0,
  batteryPct: 88, odometerM: 0, flightTimeS: 0, rotorRpm: 0, failsafe: null, mission: null, camera: null };

/** A fixture /api/drone: no drone (the native marker) or one simulator drone with its fence and home. */
async function serve(withDrone) {
  const app = express();
  const seen = { droneReads: [] };
  app.get('/api/drone/app', (_req, res) => res.sendFile(path.join(PKG, 'tools', 'drone-ops.html')));
  app.get('/api/drone/fleet', (_req, res) => res.json(withDrone
    ? { fleet: [{ droneId: 'alpha', kind: 'sim', online: true, remote: false, telemetry: TELEMETRY }], fence: { maxRadiusM: 500, maxAltM: 120 } }
    : { configured: false, reason: 'no_drone_node', detail: 'No drone or flight simulator is registered with this native runtime.', fleet: [] }));
  app.get(/^\/api\/drone\/fleet\/[^/]+\/.*/, (req, res) => { seen.droneReads.push(req.path); res.json({ events: [], captures: [] }); });
  app.use('/api/drone', (_req, res) => res.json({ items: [], missions: [], patterns: [], drones: [], fleet: [], messages: [] }));
  app.get('/cockpit/js/app-workflows.js', (_req, res) => res.type('js').send('export async function mountConnectedActions() {}'));
  app.get(/^\/shared\/.*\.js$/, (_req, res) => res.type('js').send(''));
  app.get(/^\/shared\/.*\.css$/, (_req, res) => res.type('css').send(''));
  app.use((_req, res) => res.status(404).type('text').send(''));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, seen, base: `http://127.0.0.1:${server.address().port}` };
}

/** Open the page in a context whose every non-GET request is aborted and counted: the layout test sends no command. */
async function open(browser, base, viewport, mobile) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const sent = [];
  await page.route('**/*', (route) => {
    if (route.request().method() !== 'GET') { sent.push(route.request().method() + ' ' + route.request().url()); return route.abort(); }
    return route.continue();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/api/drone/app`);
  await page.waitForFunction(() => document.getElementById('statusPill').textContent !== '…');
  return { page, sent, errors };
}

/** The three safety buttons, each inside the viewport, at least 52px tall and not covered at its centre. */
async function barOnScreen(page, height) {
  for (const name of ['Land', 'Return home', 'Abort ALL']) {
    const button = page.locator('#flightBar').getByRole('button', { name, exact: true });
    const box = await button.boundingBox();
    assert.ok(box, name + ' has a box');
    assert.ok(box.y >= 0 && box.y + box.height <= height + 0.5, name + ' is inside the viewport (y ' + box.y + ')');
    assert.ok(box.height >= 52, name + ' is 52px tall (' + box.height + ')');
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent?.trim(), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    assert.equal(hit, name, name + ' is not covered');
  }
}

test('at 412x915 the flight bar stays on screen at every scroll position and in both rail views', async (t) => {
  const { server, seen, base } = await serve(true);
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const { page, sent, errors } = await open(browser, base, { width: 412, height: 915 }, true);
  await barOnScreen(page, 915);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await barOnScreen(page, 915);
  await page.getByRole('tab', { name: 'Plan', exact: true }).tap();
  assert.equal(await page.locator('#sidePlan').isVisible(), true);
  assert.equal(await page.locator('#sideFly').isVisible(), false);
  await page.locator('#missionName').scrollIntoViewIfNeeded();
  await barOnScreen(page, 915);
  const name = await page.locator('#missionName').boundingBox();
  const bar = await page.locator('#flightBar').boundingBox();
  assert.ok(name.y + name.height <= bar.y, 'the mission name field is above the bar, not under it');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await barOnScreen(page, 915);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no sideways scrolling');
  for (const id of ['mode3d', 'modeCam', 'modePlan', 'modeGoto']) assert.ok((await page.locator('#' + id).boundingBox()).height >= 44, id + ' is 44px');
  assert.ok(seen.droneReads.length >= 0);
  assert.deepEqual(sent, [], 'no command was sent');
  assert.deepEqual(errors, []);
});

test('the map view is one exclusive choice, and with no drone one empty state sits on the canvas and no drone poll is sent', async (t) => {
  const { server, seen, base } = await serve(false);
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const { page, sent, errors } = await open(browser, base, { width: 412, height: 915 }, true);
  const pressed = () => page.locator('.mode-toggle [aria-pressed="true"]').evaluateAll((items) => items.map((b) => b.id));
  assert.deepEqual(await pressed(), ['modePlan']);
  await page.locator('#modeCam').tap();
  assert.deepEqual(await pressed(), ['modeCam'], 'CAM replaces Plan waypoints');
  await page.locator('#mode3d').tap();
  assert.deepEqual(await pressed(), ['mode3d']);
  await page.locator('#modePlan').tap();
  assert.deepEqual(await pressed(), ['modePlan']);
  assert.equal(await page.locator('#modeGoto').isDisabled(), true);
  await page.locator('#canvasEmpty:not([hidden])').waitFor();
  assert.match(await page.locator('#canvasEmpty').textContent(), /No drone connected/);
  assert.equal(await page.locator('#noDroneBanner').isVisible(), false, 'the banner does not repeat it');
  assert.equal(await page.locator('#mapHint').isVisible(), false, 'the map hint does not repeat it');
  assert.doesNotMatch(await page.locator('#fleetJoinHint').textContent(), /none can be added here/);
  for (const name of ['Land', 'Return home', 'Abort ALL']) assert.equal(await page.locator('#flightBar').getByRole('button', { name, exact: true }).isDisabled(), true, name + ' stays off with no drone');
  await page.getByRole('tab', { name: 'Plan', exact: true }).tap();
  for (const id of ['#missionName', '#wpAlt']) assert.equal(await page.locator(id).isDisabled(), true, id + ' cannot lead to a save');
  assert.equal(await page.getByRole('button', { name: 'Clear all', exact: true }).isDisabled(), true);
  await page.waitForTimeout(2500);
  assert.deepEqual(seen.droneReads, [], 'no /fleet/<drone>/ events or captures poll while the fleet is empty');
  await page.getByRole('button', { name: 'Brief', exact: true }).tap();
  assert.equal(await page.locator('#evidenceReview').evaluate((d) => d.open), true);
  await page.locator('#briefDone').tap();
  assert.equal(await page.locator('#evidenceReview').isVisible(), false);
  assert.deepEqual(sent, [], 'no command was sent');
  assert.deepEqual(errors, []);
});

test('at 1440x900 the bar sits at the bottom of the canvas, the canvas keeps at least 60% of the width and the rail scrolls alone', async (t) => {
  const { server, base } = await serve(true);
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const { page, sent, errors } = await open(browser, base, { width: 1440, height: 900 }, false);
  const canvas = await page.locator('.map-wrap').boundingBox();
  assert.ok(canvas.width >= 0.6 * 1440, 'canvas ' + canvas.width + 'px of 1440');
  await barOnScreen(page, 900);
  const bar = await page.locator('#flightBar').boundingBox();
  assert.ok(bar.x >= canvas.x && bar.x + bar.width <= canvas.x + canvas.width + 0.5, 'the bar is inside the canvas');
  assert.ok(canvas.y + canvas.height - (bar.y + bar.height) <= 24, 'the bar is at the bottom of the canvas');
  const rail = await page.locator('.side').evaluate((el) => ({ scrolls: el.scrollHeight > el.clientHeight, overflow: getComputedStyle(el).overflowY }));
  assert.equal(rail.overflow, 'auto');
  await page.locator('.side').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await barOnScreen(page, 900);
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true, 'the page itself does not scroll');
  await page.getByRole('button', { name: 'Brief', exact: true }).click();
  const brief = await page.locator('#evidenceReview').boundingBox();
  const side = await page.locator('.side').boundingBox();
  assert.ok(brief.x + brief.width <= side.x, 'the brief sheet sits over the canvas, never over the rail\'s chat, Send or Event log');
  assert.deepEqual(sent, [], 'no command was sent');
  assert.deepEqual(errors, []);
});
