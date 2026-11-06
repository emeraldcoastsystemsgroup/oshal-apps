/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.1.0 T5, the browser half: signed in as the throwaway installation's administrator (the same person whose computer pressed Allow), it presses the real buttons - Use this computer, Set up this computer, Pair with an address where no phone listens - and reads what the page says, then opens Devices, the computer's picture and Work on it, inside the cockpit too. It checks the bridge on the computer has the package's sha256, the history rows match what was pressed, no request goes to a route 1.1.0 removed, and the phone layout has no sideways scroll; screenshots at 1280x800 and 412x915. Usage: node chain-browser.cjs <base> <token> <out dir> <computer.json>
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');

const STORE = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(path.join(STORE, 'scripts', 'toolchain', 'node_modules', 'playwright'));
const [base, token, out, computerFile] = process.argv.slice(2);
const computer = JSON.parse(fs.readFileSync(computerFile, 'utf8'));
const REMOVED = /\/api\/phone-control\/(concierge|import-artifact|control-contract|agent-devices|artifacts|blobs\/|devices\/[^/]+\/(screen|operations|frame)|config\/(pair-|hardware))/;
const checks = {};
const shots = [];

function closedPort() {
  return new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}

async function shot(page, name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(file);
}

async function text(page, selector) {
  return (await page.locator(selector).innerText()).trim();
}

async function setUp(page) {
  await page.goto(`${base}/api/phone-control/config/ui`);
  await page.locator('#computersBody button', { hasText: 'Use this computer' }).first().waitFor({ timeout: 30000 });
  await shot(page, 'connect-1280-before');
  await page.locator('#computersBody button', { hasText: 'Use this computer' }).first().click();
  await page.waitForFunction(() => !document.getElementById('setUp').disabled, null, { timeout: 120000 });
  checks.before_setup = await text(page, '#setupStatus');
  await page.click('#setUp');
  await page.waitForFunction(() => /Android tools/.test(document.getElementById('setupStatus').textContent)
    && !document.getElementById('setUp').disabled, null, { timeout: 420000 });
  checks.setup_status = await text(page, '#setupStatus');
  checks.setup_table = await text(page, '#setupBody');
  assert.match(checks.setup_status, /Android tools ready/);
  assert.match(checks.setup_status, /No Bluetooth adapter on this computer/);
  assert.match(checks.setup_table, /Version 1\.1\.0 installed in your account/);
  assert.match(checks.setup_table, /Android tools ready \(adb \d+\.\d+\.\d+/);
  await shot(page, 'connect-1280-set-up');
}

async function pairWrong(page) {
  const port = await closedPort();
  await page.fill('#pairAddress', `127.0.0.1:${port}`);
  await page.fill('#pairCode', '123456');
  await page.click('#pairSend');
  await page.waitForFunction(() => /did not answer|refused|not/.test(document.getElementById('androidStatus').textContent)
    && !document.getElementById('pairSend').disabled, null, { timeout: 120000 });
  checks.pair_wrong_address = await text(page, '#androidStatus');
  assert.match(checks.pair_wrong_address, /The phone did not answer at 127\.0\.0\.1:\d+/);
  await shot(page, 'connect-1280-pair-refused');
}

async function bridgeOnComputer(page) {
  return page.evaluate(async (id) => {
    const link = await import('/api/phone-control/ui/computer-link.js');
    const manifest = await (await fetch('/api/phone-control/bridge/manifest.json', { credentials: 'same-origin' })).json();
    const reply = await link.createComputerClient().bridge(id, 'version', {});
    return { matches: link.bridgeMatches(reply, manifest), reply, manifestVersion: manifest.version };
  }, computer.id);
}

async function devices(page) {
  await page.click('#tabDevices');
  const item = page.locator('#computerRail button').first();
  await item.waitFor({ timeout: 20000 });
  await item.click();
  await page.locator('#screenImage:not([hidden])').waitFor({ timeout: 40000 });
  checks.computer_picture = await page.evaluate(() => { const img = document.getElementById('screenImage'); return { width: img.naturalWidth, height: img.naturalHeight }; });
  assert.ok(checks.computer_picture.width > 100, 'the computer picture arrived');
  checks.work_on_it = await page.getAttribute('#workOnIt', 'href');
  assert.equal(checks.work_on_it, `/cockpit/tools/computer.html?id=${encodeURIComponent(computer.id)}`);
  await shot(page, 'devices-1280-computer');
  for (const mode of ['#tabDevices', '#tabConnect']) {
    await page.click(mode);
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    checks[`${mode.slice(4).toLowerCase()}-1280_sideways_scroll_px`] = overflow;
    assert.ok(overflow <= 1, `${mode} at 1280 scrolls sideways by ${overflow}px`);
  }
  await page.click('#tabDevices');
}

/** Two phone records on that computer with no phone behind them: every press reaches the real bridge and says so. */
async function phones(page) {
  for (const body of [{ name: 'Test Android', platform: 'android', computerNodeId: computer.id, address: '127.0.0.1:5555' },
    { name: 'Test iPhone', platform: 'ios', computerNodeId: computer.id, address: 'AA:BB:CC:DD:EE:01' }]) {
    const status = await page.evaluate(async (b) => (await fetch('/api/phone-control/devices', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, body);
    assert.equal(status, 201);
  }
  await page.goto(`${base}/api/phone-control/ui`);
  await page.locator('#phoneRail button', { hasText: 'Test iPhone' }).click();
  await page.waitForFunction(() => /iPhone screens can't be shown here/.test(document.getElementById('screenNote').textContent), null, { timeout: 20000 });
  await page.click('.pc-key[data-key="HOME"]');
  await page.waitForFunction(() => /not running|No phone is listening/.test(document.getElementById('stageStatus').textContent), null, { timeout: 60000 });
  checks.iphone_home_answer = await text(page, '#stageStatus');
  await shot(page, 'devices-1280-iphone');
  await page.locator('#phoneRail button', { hasText: 'Test Android' }).click();
  await page.waitForFunction(() => /not connected/.test(document.getElementById('screenNote').textContent), null, { timeout: 60000 });
  checks.android_screen_answer = await text(page, '#screenNote');
  await page.click('.pc-key[data-key="HOME"]');
  await page.waitForFunction(() => /not connected/.test(document.getElementById('stageStatus').textContent), null, { timeout: 60000 });
  checks.android_home_answer = await text(page, '#stageStatus');
  await shot(page, 'devices-1280-android');
  await page.setViewportSize({ width: 412, height: 915 });
  await shot(page, 'devices-412-android');
  await page.setViewportSize({ width: 1280, height: 800 });
  const history = await page.evaluate(async () => (await (await fetch('/api/phone-control/history', { credentials: 'same-origin' })).json()).history);
  checks.phone_presses = history.filter((event) => event.action === 'key home').map((event) => `${event.ok ? 'worked' : 'failed'}: ${event.error}`);
  assert.equal(checks.phone_presses.length, 2);
  assert.ok(history.filter((event) => event.action === 'key home').every((event) => event.ok === false), 'nothing claims it worked');
}

async function phoneLayout(page) {
  await page.setViewportSize({ width: 412, height: 915 });
  for (const [mode, name] of [['#tabDevices', 'devices-412'], ['#tabConnect', 'connect-412']]) {
    await page.click(mode);
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    checks[`${name}_sideways_scroll_px`] = overflow;
    assert.ok(overflow <= 1, `${name} scrolls sideways by ${overflow}px`);
    await shot(page, name);
  }
  const small = await page.evaluate(() => [...document.querySelectorAll('button, a.ks-btn')]
    .filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43).map((el) => el.textContent.trim()).slice(0, 10));
  checks.controls_under_44px = small;
  assert.deepEqual(small, [], 'every control is at least 44 px tall on a phone');
}

async function insideCockpit(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/cockpit/?app=phone-control`);
  const frame = await (async () => {
    for (let i = 0; i < 60; i += 1) {
      const found = page.frames().find((f) => f.url().includes('/api/phone-control/ui'));
      if (found) return found;
      await page.waitForTimeout(500);
    }
    throw new Error('the cockpit never framed phone-control');
  })();
  await frame.locator('#computerRail button').first().waitFor({ timeout: 30000 });
  checks.cockpit_frame_reads_computers = await frame.locator('#computerRail button').count();
  await shot(page, 'cockpit-1280');
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const requests = [];
  context.on('request', (request) => requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(`${base}/version`);
    checks.signed_in = await page.evaluate(async (t) => (await fetch('/sessions', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t }) })).status, token);
    assert.equal(checks.signed_in, 201);
    await setUp(page);
    checks.bridge_on_computer = await bridgeOnComputer(page);
    assert.equal(checks.bridge_on_computer.matches, true, JSON.stringify(checks.bridge_on_computer.reply));
    await pairWrong(page);
    const history = await page.evaluate(async () => (await (await fetch('/api/phone-control/history', { credentials: 'same-origin' })).json()).history);
    checks.history = history.map((event) => `${event.action} | ${event.summary} | ${event.ok ? 'worked' : `failed: ${event.error}`}`);
    assert.ok(history.some((event) => event.action === 'pair' && event.ok === false && /did not answer/.test(event.error)));
    assert.ok(history.some((event) => event.summary === 'Android tools' && event.ok === true));
    await devices(page);
    await phones(page);
    await page.locator('#computerRail button').first().click();
    await phoneLayout(page);
    await insideCockpit(context);
    const work = await context.newPage();
    await work.goto(base + checks.work_on_it);
    await work.waitForFunction(() => /Work on/.test(document.getElementById('title')?.textContent || ''), null, { timeout: 20000 });
    checks.work_on_it_page_title = await work.title();
    await shot(work, 'work-on-it-1280');
    checks.removed_routes_requested = requests.filter((line) => REMOVED.test(line));
    assert.deepEqual(checks.removed_routes_requested, []);
    checks.page_errors = errors;
    checks.pass = true;
  } catch (error) {
    checks.pass = false;
    checks.failure = String(error.stack || error);
    await shot(page, 'failure').catch(() => {});
    process.exitCode = 1;
  } finally {
    checks.requests_to_computers = requests.filter((line) => /\/api\/computers\/[^/]+\/run/.test(line)).length;
    checks.screenshots = shots;
    fs.writeFileSync(path.join(out, 'chain-receipt.json'), JSON.stringify(checks, null, 1));
    console.log(JSON.stringify({ pass: checks.pass, failure: checks.failure?.split('\n')[0] }));
    await browser.close();
  }
})();
