/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.2 (Roger, his phone, 2026-11-16: "I can't scroll on this screen on my phone"; the Jarvis button sat on a row's Details). The real page in Chromium at 412x915 with touch, inside a stand-in Today frame (a 46 px bar, the application frame under it, the shell's floating Jarvis button at its phone place) over the stand-in routes: a finger swipe and a wheel turn move the list, every row's buttons can be scrolled to a place the floating button does not cover (the last row's too), the page draws no small floating dot, and a device's screen still opens as the fixed full-frame session that does not scroll. Red on 1.20.1, where the swipe and the wheel left the list at 0 and the last row's buttons sat under the button.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PKG = path.resolve(__dirname, '..');
const { chromium } = require(path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules', 'playwright'));

// The shell's floating Jarvis button on a phone with an application open (platform jarvis-orb.js, the
// html[data-phone-app-bar] rule): 48 px, 12 px from the right edge, 12 px + the 57 px bar inset above the bottom.
const ORB = { size: 48, right: 12, bottom: 12 + 57 };
const HEADER = 46;
const VIEWPORT = { width: 412, height: 915 };

let server;
let browser;
let base;

function freePort() {
  return new Promise((done, fail) => {
    const probe = net.createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)); });
  });
}

function answers(url) {
  return new Promise((done) => {
    const req = http.get(url, (res) => { res.resume(); done(res.statusCode === 200); });
    req.on('error', () => done(false));
    req.setTimeout(1000, () => { req.destroy(); done(false); });
  });
}

/** A stand-in Today page: its bar, the application frame filling the rest, and the floating Jarvis button. */
function todayHost() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;overflow:hidden}header{height:${HEADER}px;background:#e8f2fd}
#appFrame{position:fixed;top:${HEADER}px;left:0;right:0;bottom:0;width:100%;height:calc(100% - ${HEADER}px);border:0}
#jarvisOrbFab{position:fixed;right:${ORB.right}px;bottom:${ORB.bottom}px;width:${ORB.size}px;height:${ORB.size}px;border-radius:50%;border:1px solid #cbd5e1;background:#fff;z-index:2147483000}</style>
</head><body><header>Phone &amp; Device Control</header>
<iframe id="appFrame" title="Phone &amp; Device Control" src="/api/phone-control/ui"></iframe>
<button id="jarvisOrbFab" type="button" aria-label="Ask Jarvis">✦</button></body></html>`;
}

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(__dirname, 'support', 'standin-server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; i < 80 && !(await answers(`${base}/api/phone-control/ui`)); i += 1) await new Promise((done) => setTimeout(done, 125));
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function openPhone() {
  const context = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
  await context.route(`${base}/today/`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: todayHost() }));
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(String(error.message)));
  await page.goto(`${base}/today/`);
  let frame = null;
  for (let i = 0; i < 80 && !frame; i += 1) {
    frame = page.frames().find((f) => f !== page.mainFrame() && f.url().endsWith('/api/phone-control/ui'));
    if (!frame) await page.waitForTimeout(100);
  }
  assert.ok(frame, 'the application frame loaded');
  await frame.waitForFunction(() => document.querySelectorAll('#computerRail .pc-rail-item').length > 3
    && !/Reading your/.test(document.getElementById('pageLede')?.textContent || ''), null, { timeout: 20000 });
  return { context, page, frame };
}

const scrollTop = (frame) => frame.evaluate(() => document.scrollingElement.scrollTop);

/** A finger on the list, dragged up: real touch events through the browser, not a script scroll. */
async function swipeUp(context, page, fromY, toY) {
  const cdp = await context.newCDPSession(page);
  const x = Math.round(VIEWPORT.width / 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY }] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(fromY + ((toY - fromY) * step) / 10) }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(1500); // the fling settles before anything else scrolls
  await cdp.detach();
}

/** The floating button's box and every visible button of the device rows, both in the page's coordinates. */
async function overlaps(page, frame) {
  const orb = await page.locator('#jarvisOrbFab').boundingBox();
  const frameBox = await page.locator('#appFrame').boundingBox();
  const buttons = await frame.evaluate(() => [...document.querySelectorAll('#devicesView .pc-device-row button')]
    .filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')
    .map((b) => { const r = b.getBoundingClientRect(); return { name: b.getAttribute('aria-label') || b.textContent.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })
    .filter((r) => r.bottom > 0 && r.top < innerHeight));
  return buttons.map((b) => ({ ...b, top: b.top + frameBox.y, bottom: b.bottom + frameBox.y, left: b.left + frameBox.x, right: b.right + frameBox.x }))
    .filter((b) => b.left < orb.x + orb.width && b.right > orb.x && b.top < orb.y + orb.height && b.bottom > orb.y)
    .map((b) => b.name);
}

test('412x915 with touch: a finger swipe and a wheel turn move the device list inside the Today frame', { timeout: 60000 }, async () => {
  const { context, page, frame } = await openPhone();
  try {
    const room = await frame.evaluate(() => document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight);
    assert.ok(room > 300, `the list is taller than the frame, so there is something to scroll (${room}px)`);
    assert.equal(await scrollTop(frame), 0);
    await swipeUp(context, page, 760, 260);
    const afterSwipe = await scrollTop(frame);
    assert.ok(afterSwipe >= 150, `a finger swipe up moves the list (scrollTop ${afterSwipe})`);

    await frame.evaluate(() => document.scrollingElement.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.mouse.move(Math.round(VIEWPORT.width / 2), 600);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(400);
    const afterWheel = await scrollTop(frame);
    assert.ok(afterWheel >= 150, `a wheel turn moves the list (scrollTop ${afterWheel})`);

    const sideways = await frame.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
    assert.ok(sideways <= 0, `the page still never scrolls sideways (${sideways}px)`);
    assert.deepEqual(page.errors, []);
  } finally {
    await context.close();
  }
});

test('412x915: every row\'s buttons can rest clear of the floating Jarvis button, the last row\'s included', { timeout: 60000 }, async () => {
  const { context, page, frame } = await openPhone();
  try {
    await frame.evaluate(() => document.scrollingElement.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.waitForTimeout(200);
    assert.deepEqual(await overlaps(page, frame), [], 'at the end of the list the floating button covers no row button');

    const count = await frame.evaluate(() => document.querySelectorAll('#devicesView .pc-device-row .pc-row-details').length);
    assert.ok(count >= 6, `the stand-in lists its devices (${count} Details buttons)`);
    for (let i = 0; i < count; i += 1) {
      await frame.evaluate((n) => document.querySelectorAll('#devicesView .pc-device-row .pc-row-details')[n].scrollIntoView({ block: 'center' }), i);
      const covered = await overlaps(page, frame);
      const name = await frame.evaluate((n) => document.querySelectorAll('#devicesView .pc-device-row .pc-row-details')[n].getAttribute('aria-label'), i);
      assert.ok(!covered.includes(name), `${name} can be brought to a place the floating button does not cover (${JSON.stringify(covered)})`);
    }
  } finally {
    await context.close();
  }
});

test('412x915: the page draws no small floating dot, and a device screen is still the fixed full-frame session', { timeout: 60000 }, async () => {
  const { context, page, frame } = await openPhone();
  try {
    const dots = await frame.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if (!/fixed|absolute|sticky/.test(cs.position) || !el.getClientRects().length || cs.visibility === 'hidden') return false;
      const round = parseFloat(cs.borderTopLeftRadius) >= Math.min(r.width, r.height) * 0.4;
      const painted = !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
      return r.width > 0 && r.width <= 24 && r.height <= 24 && round && painted;
    }).map((el) => el.id || el.className));
    assert.deepEqual(dots, [], 'no positioned dot is painted over the page');

    await frame.getByRole('button', { name: 'Details of spark-f255' }).waitFor();
    await frame.locator('[data-entry="computer:spark-f255"] > .pc-row-line > .pc-rail-item').tap();
    await frame.locator('#sessionView:not([hidden])').waitFor({ timeout: 15000 });
    const session = await frame.evaluate(() => {
      const view = document.getElementById('sessionView'), r = view.getBoundingClientRect(), se = document.scrollingElement;
      return { position: getComputedStyle(view).position, top: r.top, left: r.left, width: r.width, height: r.height, room: se.scrollHeight - se.clientHeight, inner: [innerWidth, innerHeight] };
    });
    assert.equal(session.position, 'fixed', 'the session covers the frame as before');
    assert.deepEqual([session.top, session.left, session.width, session.height], [0, 0, ...session.inner]);
    assert.ok(session.room <= 0, `the session view does not scroll (${session.room}px)`);
  } finally {
    await context.close();
  }
});
