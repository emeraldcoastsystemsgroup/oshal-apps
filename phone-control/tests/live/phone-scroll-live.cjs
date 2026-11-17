/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.2 live proof (Roger, his phone, 2026-11-16: "I can't scroll on this screen on my phone"), read only, on a loopback kernel: /cockpit/?app=phone-control at 412x915 with touch as the installer's operator persona. The device list is lengthened in this browser only (its rendered rows are copied) so it is taller than the frame; a finger swipe and a wheel turn must move it, and at its end no row button may sit under the shell's floating Jarvis button. Every request that is not a read is stopped before it leaves the browser, so no device command runs. --css serves a phone-control.css file instead of the installed one, to check a release before it is delivered.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE = path.resolve(__dirname, '..', '..', '..');
const { chromium, request } = require(path.join(STORE, 'scripts', 'toolchain', 'node_modules', 'playwright'));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const BASE = args.base || 'http://127.0.0.1:38798';
const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };

if (new URL(BASE).hostname !== '127.0.0.1') throw new Error(`refusing ${BASE}: the bearer goes to loopback only`);
if (!args.env) throw new Error('usage: --env=<oshald.env> [--base=http://127.0.0.1:38798] [--css=<phone-control.css>] [--out=<dir>]');

/** @description The installer's bearer from the kernel's env file; never printed. @returns {string} Token. */
function adminToken() {
  const line = fs.readFileSync(args.env, 'utf8').match(/^OSHAL_ADMIN_TOKEN=(.*)$/m);
  if (!line) throw new Error('no OSHAL_ADMIN_TOKEN in the env file');
  return line[1].trim().replace(/^['"]|['"]$/g, '');
}

/** @description The operator persona's session (POST /api/auth/switch); never printed. @returns {Promise<string>} Token. */
async function personaToken() {
  const api = await request.newContext({ baseURL: BASE });
  try {
    const answer = await api.post('/api/auth/switch', { headers: { authorization: `Bearer ${adminToken()}` }, data: { persona: 'operator' } });
    if (!answer.ok()) throw new Error(`/api/auth/switch answered ${answer.status()}`);
    const body = await answer.json();
    return body.token || body.session || body.sessionToken || body.access_token;
  } finally { await api.dispose(); }
}

/** @description Reads go to the kernel with the bearer; anything else is stopped and listed. @param {object} context Browser context. @param {string} token Bearer. @returns {Promise<string[]>} The stopped requests. */
async function readOnly(context, token) {
  const stopped = [];
  await context.route((url) => new URL(url).origin === BASE, (route) => {
    const req = route.request(), where = new URL(req.url()).pathname;
    if (!['GET', 'HEAD'].includes(req.method())) { stopped.push(`${req.method()} ${where}`); return route.abort(); }
    if (args.css && where === '/api/phone-control/ui/phone-control.css') return route.fulfill({ contentType: 'text/css; charset=utf-8', body: fs.readFileSync(args.css, 'utf8') });
    return route.continue({ headers: { ...req.headers(), authorization: `Bearer ${token}` } });
  });
  await context.route((url) => !/^(data|blob|about):/.test(url) && new URL(url).origin !== BASE, (route) => route.abort());
  return stopped;
}

/** @description A finger dragged up the list with CDP touch events. @param {object} context Context. @param {object} page Page. @returns {Promise<void>} Done. */
async function swipeUp(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 206, y: 760 }] });
  for (let step = 1; step <= 10; step += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 206, y: 760 - step * 50 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(1500); // the fling settles
  await cdp.detach();
}

/** @description The application frame once its device list has rows, lengthened in this browser only. @param {object} page Page. @returns {Promise<object>} Frame. */
async function longList(page) {
  let frame = null;
  for (let i = 0; i < 120 && !frame; i += 1) {
    frame = page.frames().find((f) => f !== page.mainFrame() && f.url().split('?')[0] === `${BASE}/api/phone-control/ui`);
    if (!frame) await page.waitForTimeout(250);
  }
  if (!frame) throw new Error('the Phone & Device Control frame did not load');
  await frame.waitForFunction(() => document.querySelectorAll('#devicesView .pc-device-row').length > 0
    && !/Reading your/.test(document.getElementById('pageLede')?.textContent || ''), null, { timeout: 30000 });
  await frame.evaluate(() => {
    const rail = document.getElementById('computerRail'), rows = [...rail.children];
    while (document.scrollingElement.scrollHeight < 2.5 * innerHeight) for (const row of rows) rail.appendChild(row.cloneNode(true));
  });
  return frame;
}

/** @description Row buttons under the floating Jarvis button, in page coordinates. @param {object} page Page. @param {object} frame Frame. @returns {Promise<string[]>} Their names. */
async function underOrb(page, frame) {
  const orb = await page.locator('#jarvisOrbFab').boundingBox();
  const box = await page.locator('iframe[src*="/api/phone-control/ui"]').boundingBox();
  if (!orb || !box) return [];
  return frame.evaluate(([o, f]) => [...document.querySelectorAll('#devicesView .pc-device-row button')].filter((b) => {
    const r = b.getBoundingClientRect(), top = r.top + f.y, left = r.left + f.x;
    return b.getClientRects().length && left < o.x + o.width && left + r.width > o.x && top < o.y + o.height && top + r.height > o.y;
  }).map((b) => b.getAttribute('aria-label') || b.textContent.trim()), [orb, box]);
}

(async () => {
  const receipt = { base: BASE, css: args.css ? 'given' : 'installed', problems: [] };
  let browser;
  try {
    const token = await personaToken();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(PHONE);
    const stopped = await readOnly(context, token);
    const page = await context.newPage();
    await page.goto(`${BASE}/cockpit/?app=phone-control`, { waitUntil: 'domcontentloaded' });
    const frame = await longList(page);
    const top = () => frame.evaluate(() => document.scrollingElement.scrollTop);
    receipt.room = await frame.evaluate(() => document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight);
    await swipeUp(context, page);
    receipt.swipe = await top();
    await frame.evaluate(() => document.scrollingElement.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.mouse.move(206, 600); await page.mouse.wheel(0, 400); await page.waitForTimeout(500);
    receipt.wheel = await top();
    await frame.evaluate(() => document.scrollingElement.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.waitForTimeout(300);
    receipt.underOrbAtEnd = await underOrb(page, frame);
    if (args.out) { fs.mkdirSync(args.out, { recursive: true }); await page.screenshot({ path: path.join(args.out, 'phone-scroll-end.png') }); }
    receipt.stopped = [...new Set(stopped)];
    if (receipt.swipe < 150) receipt.problems.push(`a finger swipe moved the list ${receipt.swipe}px`);
    if (receipt.wheel < 150) receipt.problems.push(`a wheel turn moved the list ${receipt.wheel}px`);
    if (receipt.underOrbAtEnd.length) receipt.problems.push(`at the end, under the floating Jarvis button: ${receipt.underOrbAtEnd.join(', ')}`);
  } catch (error) {
    receipt.problems.push(String(error?.message || error).split('\n')[0].slice(0, 200));
  } finally {
    await browser?.close();
  }
  console.log(JSON.stringify(receipt, null, 1));
  process.exitCode = receipt.problems.length ? 1 : 0;
})();
