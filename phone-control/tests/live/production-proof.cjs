/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 on a live installation, as its operator (the administrator's own session, closed again at the end): the phone size (390x844, real touch) and the desktop size (1440x900), inside the cockpit and on the page itself. Phase empty: with no computer connected nothing says connected, the 1.0.0 starter devices are gone, every removed route answers exactly as a route that never existed (the kernel's catalog refusal, never 2xx), no removed route is requested, no 1.0.0 fake text is on screen, no console error, no sideways scroll, every control at least 44 px on the phone. Phase computer: on the operator's own connected computer it presses Use this computer, Set up this computer, Replace the earlier test keyboard when the page offers it, Pair with an address where no phone listens, then Devices and the computer's picture; it reads what the computer answered and the history. Phase offline: after that computer's app is closed, it reads Not connected. It never adds a phone, types, presses a key on a phone or opens a pairing window. Usage: node production-proof.cjs <base> <env file with OSHAL_ADMIN_TOKEN> <out dir> empty|computer|offline [computer id]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const STORE = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(path.join(STORE, 'scripts', 'toolchain', 'node_modules', 'playwright'));
const [base, envFile, out, phase, computerId] = process.argv.slice(2);
const REMOVED_REQUEST = /\/api\/phone-control\/(concierge|import-artifact|control-contract|agent-devices|artifacts|blobs\/|assets\/|screen\b|devices\/[^/]+\/(screen|operations|frame)|config\/(pair-|hardware))/;
const REMOVED_ROUTES = [['GET', '/screen'], ['POST', '/concierge'], ['GET', '/control-contract'], ['POST', '/agent-devices'], ['GET', '/artifacts'],
  ['POST', '/import-artifact'], ['GET', '/config/hardware-status'], ['POST', '/config/pair-ble'], ['POST', '/config/pair-mirror'], ['POST', '/config/pair-adb'],
  ['GET', '/devices/x/screen'], ['POST', '/devices/x/frame'], ['POST', '/devices/x/operations'], ['GET', '/blobs/0'], ['GET', '/assets/x.png']];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S936U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const receipt = { phase, base, startedAt: new Date().toISOString(), checks: {}, screenshots: [], consoleErrors: [], removedRequested: [] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function adminToken() {
  const line = fs.readFileSync(envFile, 'utf8').match(/^OSHAL_ADMIN_TOKEN=(.*)$/m);
  if (!line) throw new Error(`no OSHAL_ADMIN_TOKEN in ${envFile}`);
  return line[1].trim().replace(/^['"]|['"]$/g, '');
}

/** The operator's own session, as the sign-in page makes it. */
async function signIn() {
  const answer = await fetch(`${base}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: adminToken() }) });
  if (answer.status !== 201 && answer.status !== 200) throw new Error(`operator sign-in refused: ${answer.status}`);
  const session = (await answer.json()).session;
  const name = (answer.headers.get('set-cookie') || 'oshal_session=').split('=')[0];
  return { session, name };
}

async function api(signed, method, route, body) {
  const answer = await fetch(`${base}${route}`, { method, headers: { authorization: `Bearer ${signed.session}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await answer.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: answer.status, json, text };
}

async function context(browser, signed, shape) {
  const ctx = await browser.newContext(shape);
  const host = new URL(base).hostname;
  await ctx.addCookies([{ name: signed.name, value: signed.session, domain: host, path: '/', httpOnly: true, secure: base.startsWith('https'), sameSite: 'Lax' }]);
  ctx.on('request', (request) => { const line = `${request.method()} ${new URL(request.url()).pathname}`; if (REMOVED_REQUEST.test(line)) receipt.removedRequested.push(line); });
  return ctx;
}

function watch(page, label) {
  page.on('console', (message) => { if (message.type() === 'error') receipt.consoleErrors.push(`${label}: ${message.text()} @ ${message.location()?.url || ''}`); });
  page.on('pageerror', (error) => receipt.consoleErrors.push(`${label}: pageerror ${error}`));
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
}

async function shot(page, name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  receipt.screenshots.push(file);
}

/** The phone-control frame inside the cockpit. */
async function appFrame(page, part) {
  for (let i = 0; i < 80; i += 1) {
    const frame = page.frames().find((f) => f.url().includes(`/api/phone-control/${part}`));
    if (frame && await frame.evaluate(() => document.readyState === 'complete').catch(() => false)) return frame;
    await sleep(250);
  }
  throw new Error(`the cockpit never framed /api/phone-control/${part}`);
}

async function press(frame, selector, touch) {
  const target = frame.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  if (touch) await target.tap(); else await target.click();
}

async function settled(frame) {
  await frame.waitForFunction(() => !/Reading/.test(document.getElementById('pageLede')?.textContent || 'Reading'), null, { timeout: 45000 });
  await frame.waitForFunction(() => !/Reading your computers/.test(document.getElementById('computersBody')?.textContent || ''), null, { timeout: 45000 });
}

/** What the page shows about the devices, and whether anything claims a connection. */
async function readScreen(frame) {
  return frame.evaluate(() => {
    const visible = (el) => el && el.offsetParent !== null;
    const text = document.body.innerText;
    const claims = [...document.querySelectorAll('body *')].filter((el) => visible(el) && el.children.length === 0)
      .map((el) => el.textContent.trim()).filter((t) => /\bconnected\b/i.test(t) && !/\b(not|no|never)\b[^.]*connected|connect through|connected yet/i.test(t));
    const small = [...document.querySelectorAll('button, a.ks-btn, input, select')].filter((el) => visible(el) && el.type !== 'checkbox')
      .map((el) => ({ label: (el.textContent || el.getAttribute('aria-label') || el.id).trim().slice(0, 40), h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }))
      .filter((c) => c.h < 43.5 || c.w < 43.5);
    return { lede: document.getElementById('pageLede')?.textContent.trim(), rail: document.getElementById('devicesView')?.hidden ? null : document.querySelector('.pc-rail')?.innerText.trim(),
      computers: document.getElementById('computersBody')?.innerText.trim(), railEmptyShown: visible(document.getElementById('railEmpty')),
      connectedClaims: claims, controlsUnder44: small, sidewaysPx: document.documentElement.scrollWidth - window.innerWidth,
      fakeText: (text.match(/MIRROR LIVE|\bTBS\b|AirPlay key|Mirror Receiver|Enroll computer|\bOCR\b|Android Pixel \(Wireless ADB\)|OSHAL Orbit PC/gi) || []) };
  });
}

async function emptyAt(browser, signed, shape, size) {
  const ctx = await context(browser, signed, shape);
  const page = await ctx.newPage();
  watch(page, `cockpit-${size}`);
  await page.goto(`${base}/cockpit/?app=phone-control`, { waitUntil: 'domcontentloaded' });
  const frame = await appFrame(page, 'ui');
  await settled(frame);
  await sleep(1500);
  receipt.checks[`cockpit_${size}_devices`] = await readScreen(frame);
  await shot(page, `empty-${size}-cockpit-devices`);
  await press(frame, '#tabConnect', Boolean(shape.hasTouch));
  await sleep(1500);
  receipt.checks[`cockpit_${size}_connect`] = await readScreen(frame);
  await shot(page, `empty-${size}-cockpit-connect`);
  const direct = await ctx.newPage();
  watch(direct, `direct-${size}`);
  await direct.goto(`${base}/api/phone-control/config/ui`, { waitUntil: 'load' });
  await settled(direct.mainFrame());
  await sleep(1000);
  receipt.checks[`direct_${size}_connect`] = await readScreen(direct.mainFrame());
  await shot(direct, `empty-${size}-direct-connect`);
  await ctx.close();
}

async function apiChecks(signed) {
  const devices = await api(signed, 'GET', '/api/phone-control/devices');
  const summary = await api(signed, 'GET', '/api/phone-control/home-summary');
  const removed = [];
  for (const [method, route] of REMOVED_ROUTES) {
    const answer = await api(signed, method, `/api/phone-control${route}`, method === 'POST' ? {} : undefined);
    removed.push(`${answer.status} ${method} ${route}`);
  }
  // The kernel refuses a path the catalog does not bind before the package sees it: a removed route must answer exactly
  // as a route that never existed, and never 2xx.
  const never = await api(signed, 'GET', '/api/phone-control/no-such-route-ever');
  const manifest = await api(signed, 'GET', '/api/phone-control/bridge/manifest.json');
  receipt.checks.api = { devicesStatus: devices.status, devices: devices.json, homeSummary: summary.json, removedRoutes: removed,
    neverExisted: `${never.status} ${never.text.slice(0, 120)}`,
    removedRoutesAnswerAsNeverExisted: never.status >= 400 && removed.every((line) => line.startsWith(`${never.status} `)), bridgeManifest: manifest.json && { version: manifest.json.version, files: manifest.json.files.map((f) => `${f.name} ${f.sha256}`) },
    package: (await api(signed, 'GET', '/packages/phone-control')).status };
}

async function phaseEmpty(browser, signed) {
  const computers = await api(signed, 'GET', '/api/computers');
  receipt.checks.computers = computers.json;
  if (computers.json?.computers?.length) throw new Error('phase empty needs an operator with no computers');
  await apiChecks(signed);
  await emptyAt(browser, signed, PHONE, '390');
  await emptyAt(browser, signed, DESKTOP, '1440');
  const all = Object.entries(receipt.checks).filter(([key]) => /^(cockpit|direct)_/.test(key));
  receipt.pass = receipt.checks.api.removedRoutesAnswerAsNeverExisted && receipt.checks.api.devices?.devices?.length === 0
    && all.every(([, v]) => !v.connectedClaims.length && !v.fakeText.length && v.sidewaysPx <= 1)
    && all.filter(([k]) => k.includes('_390_')).every(([, v]) => !v.controlsUnder44.length)
    && !receipt.consoleErrors.length && !receipt.removedRequested.length;
}

function closedPort() {
  return new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}

async function waitIdle(frame, ms = 420000) {
  await frame.waitForFunction(() => !document.getElementById('setUp').disabled, null, { timeout: ms });
}

const setupTable = (frame) => frame.evaluate(() => [...document.querySelectorAll('#setupBody tr')].map((row) => [...row.cells].map((c) => c.textContent.trim()).slice(0, 2).join(': ')));

/** Use this computer, Set up this computer and, when the page offers it, Replace the earlier test keyboard. */
async function setUp(page, frame) {
  receipt.checks.computer_row = await frame.locator('#computersBody').innerText();
  await press(frame, '#computersBody button:has-text("Use this computer")', true);
  await waitIdle(frame, 120000);
  receipt.checks.before_setup = { status: await frame.locator('#setupStatus').innerText(), table: await setupTable(frame) };
  await shot(page, 'computer-390-chosen');
  await press(frame, '#setUp', true);
  await frame.waitForFunction(() => /Android tools|earlier test keyboard|Bluetooth|not/.test(document.getElementById('setupStatus').textContent)
    && !document.getElementById('setUp').disabled, null, { timeout: 420000 });
  receipt.checks.after_setup = { status: await frame.locator('#setupStatus').innerText(), table: await setupTable(frame),
    replaceOffered: await frame.locator('#replaceRow').isVisible() };
  await shot(page, 'computer-390-set-up');
  if (receipt.checks.after_setup.replaceOffered) {
    await press(frame, '#replaceEarlier', true);
    await frame.waitForFunction(() => /Android tools|did not come up|Bluetooth/.test(document.getElementById('setupStatus').textContent)
      && !document.getElementById('setUp').disabled && !/Replacing/.test(document.getElementById('setupStatus').textContent), null, { timeout: 420000 });
    receipt.checks.after_replace = { status: await frame.locator('#setupStatus').innerText(), table: await setupTable(frame),
      replaceStillOffered: await frame.locator('#replaceRow').isVisible() };
    await shot(page, 'computer-390-replaced');
  }
  receipt.checks.iphones_this_computer_sees = await frame.locator('#bleBody').innerText();
}

async function pairWrong(page, frame) {
  const port = await closedPort();
  await frame.locator('#pairAddress').fill(`127.0.0.1:${port}`);
  await frame.locator('#pairCode').fill('123456');
  await press(frame, '#pairSend', true);
  await frame.waitForFunction(() => /did not answer|refused|not/.test(document.getElementById('androidStatus').textContent)
    && !document.getElementById('pairSend').disabled, null, { timeout: 120000 });
  receipt.checks.pair_wrong_address = await frame.locator('#androidStatus').innerText();
  await shot(page, 'computer-390-pair-refused');
}

async function devicesAt(browser, signed, shape, size) {
  const ctx = await context(browser, signed, shape);
  const page = await ctx.newPage();
  watch(page, `devices-${size}`);
  await page.goto(`${base}/cockpit/?app=phone-control`, { waitUntil: 'domcontentloaded' });
  const frame = await appFrame(page, 'ui');
  await settled(frame);
  const item = frame.locator('#computerRail button').first();
  await item.waitFor({ timeout: 30000 });
  await press(frame, '#computerRail button', Boolean(shape.hasTouch));
  await frame.locator('#screenImage:not([hidden])').waitFor({ timeout: 60000 });
  receipt.checks[`devices_${size}`] = { ...(await readScreen(frame)), workOnIt: await frame.getAttribute('#workOnIt', 'href'),
    picture: await frame.evaluate(() => { const img = document.getElementById('screenImage'); return { width: img.naturalWidth, height: img.naturalHeight }; }) };
  await shot(page, `computer-${size}-devices`);
  await ctx.close();
}

async function connectAt1440(browser, signed) {
  const ctx = await context(browser, signed, DESKTOP);
  const page = await ctx.newPage();
  watch(page, 'connect-1440');
  await page.goto(`${base}/cockpit/?app=phone-control&screen=phone-control-config`, { waitUntil: 'domcontentloaded' });
  const frame = await appFrame(page, 'config/ui');
  await settled(frame);
  await press(frame, '#computersBody button:has-text("Use this computer")', false);
  await waitIdle(frame, 120000);
  receipt.checks.connect_1440 = { ...(await readScreen(frame)), table: await setupTable(frame), status: await frame.locator('#setupStatus').innerText() };
  await shot(page, 'computer-1440-connect');
  await ctx.close();
}

async function phaseComputer(browser, signed) {
  const computers = await api(signed, 'GET', '/api/computers');
  receipt.checks.computers = computers.json;
  const ctx = await context(browser, signed, PHONE);
  const page = await ctx.newPage();
  watch(page, 'connect-390');
  await page.goto(`${base}/cockpit/?app=phone-control&screen=phone-control-config`, { waitUntil: 'domcontentloaded' });
  const frame = await appFrame(page, 'config/ui');
  await settled(frame);
  await setUp(page, frame);
  await pairWrong(page, frame);
  await ctx.close();
  await devicesAt(browser, signed, PHONE, '390');
  await devicesAt(browser, signed, DESKTOP, '1440');
  await connectAt1440(browser, signed);
  const history = await api(signed, 'GET', '/api/phone-control/history');
  receipt.checks.history = (history.json?.history || []).map((e) => `${e.at || e.createdAt || ''} | ${e.action} | ${e.summary} | ${e.ok ? 'worked' : `failed: ${e.error}`}`);
  receipt.checks.bridgeOnComputer = (await api(signed, 'POST', `/api/computers/${computerId}/run`, { tool: 'shell.exec',
    arguments: { command: 'python3 -I "$HOME/.local/share/oshal-phone-bridge/oshal_phone_bridge.py" ble-status --b64 e30=', timeout_ms: 20000 }, limit_ms: 30000 })).json;
  receipt.pass = !receipt.consoleErrors.length && !receipt.removedRequested.length;
}

async function phaseOffline(browser, signed) {
  receipt.checks.computers = (await api(signed, 'GET', '/api/computers')).json;
  const ctx = await context(browser, signed, PHONE);
  const page = await ctx.newPage();
  watch(page, 'offline-390');
  await page.goto(`${base}/cockpit/?app=phone-control&screen=phone-control-config`, { waitUntil: 'domcontentloaded' });
  const frame = await appFrame(page, 'config/ui');
  await settled(frame);
  await sleep(1500);
  receipt.checks.offline_390 = { ...(await readScreen(frame)),
    useDisabled: await frame.locator('#computersBody button:has-text("Use this computer")').first().isDisabled().catch(() => null) };
  await shot(page, 'offline-390-connect');
  await ctx.close();
  receipt.pass = !receipt.checks.offline_390.connectedClaims.length && receipt.checks.offline_390.useDisabled !== false && !receipt.consoleErrors.length;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const signed = await signIn();
  try {
    if (phase === 'empty') await phaseEmpty(browser, signed);
    else if (phase === 'computer') await phaseComputer(browser, signed);
    else if (phase === 'offline') await phaseOffline(browser, signed);
    else throw new Error(`unknown phase ${phase}`);
  } catch (error) {
    receipt.pass = false;
    receipt.failure = String(error.stack || error);
    process.exitCode = 1;
  } finally {
    await fetch(`${base}/sessions`, { method: 'DELETE', headers: { authorization: `Bearer ${signed.session}` } }).catch(() => {});
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, `receipt-${phase}.json`), JSON.stringify(receipt, null, 1));
    console.log(JSON.stringify({ phase, pass: receipt.pass, failure: receipt.failure?.split('\n')[0], consoleErrors: receipt.consoleErrors.length }));
    await browser.close();
  }
})();
