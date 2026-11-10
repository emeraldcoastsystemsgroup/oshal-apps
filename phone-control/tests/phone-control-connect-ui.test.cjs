/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.2.0 browser regression test: pressing Use this computer on not-connected, control-off and Windows rows answers in #computersStatus; pressing Connect while a step runs answers in #androidStatus; a 403 on /devices shows #notAllowed and hides the device views; a saved TV shows the TV remote and refuses touch taps with remote guidance.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0: adapt for merged Connect sheet and full-frame session view, verify TV session remote and tap guidance, and verify iPhone Start mirroring / mirror-frame / Stop mirroring in Chromium.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: report 1.4.0 bridge status in mock runner.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: report 1.4.1 bridge status and verify compact TV remote visibility on Fire TV sessions.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const PKG = path.resolve(__dirname, '..');
const STORE = path.resolve(PKG, '..');
const { chromium } = require(path.join(STORE, 'scripts', 'toolchain', 'node_modules', 'playwright'));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-control-ui-'));
process.env.OSHAL_PACKAGE_DATA_DIR = work;
const store = require(path.join(PKG, 'lib', 'db.js'));
const { createPhoneControlRoutes } = require(path.join(PKG, 'routes', 'phone-control-routes.js'));

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const COMPUTERS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Offline Box', platform: 'linux', connected: false, can_control: false, tools: [] },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Locked Spark', platform: 'linux', connected: true, can_control: false, tools: [] },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Desk PC', platform: 'windows', connected: true, can_control: true, tools: ['shell.exec'] },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Spark', platform: 'linux', connected: true, can_control: true, tools: ['shell.exec'] }
];

let server;
let browser;
let base;
let mode = { denyDevices: false, holdRun: null, mirrorRunning: false };

function serveSharedAsset(req, res) {
  if ((req.url.startsWith('/ui/kernel/') || req.url.startsWith('/shared/ui/')) && req.url.endsWith('.css')) {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    res.end(':root { --bg-primary: #ffffff; --text-primary: #0f172a; --text-secondary: #475569; --accent-primary: #2563eb; } [hidden] { display: none !important; }');
    return true;
  }
  if (req.url.startsWith('/shared/ui/js/') || req.url === '/ui/kernel/table.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    res.end(req.url.endsWith('surface-theme.js') || req.url.endsWith('table.js') ? '' : 'export {};');
    return true;
  }
  return false;
}

function buildBridgeLine(cmd) {
  const sha256 = crypto.createHash('sha256').update(PNG_1X1).digest('hex');
  if (cmd.includes(' adb-frame ') || cmd.includes(' mirror-frame ')) {
    const verb = cmd.includes(' mirror-frame ') ? 'mirror-frame' : 'adb-frame';
    return JSON.stringify({
      ok: true, verb, id: sha256.slice(0, 16), sha256, mime: 'image/png',
      bytes: PNG_1X1.length, chunks: 1, index: 0, data: PNG_1X1.toString('base64'),
      deviceWidth: verb === 'mirror-frame' ? 1170 : 1920, deviceHeight: verb === 'mirror-frame' ? 2532 : 1080, slow: false
    });
  }
  if (cmd.includes(' mirror-start')) {
    mode.mirrorRunning = true;
    return JSON.stringify({
      ok: true, verb: 'mirror-start', pid: 4242, receiverName: 'OSHAL Mirror (Spark)',
      mirror: { ready: true, version: '1.68.2', running: true, receiverName: 'OSHAL Mirror (Spark)', hasFrame: true, message: 'AirPlay receiver on as OSHAL Mirror (Spark)' }
    });
  }
  if (cmd.includes(' mirror-stop')) {
    mode.mirrorRunning = false;
    return JSON.stringify({ ok: true, verb: 'mirror-stop', stopped: true });
  }
  if (cmd.includes(' ble-tap ')) {
    return JSON.stringify({ ok: true, verb: 'ble-tap', nx: 0.5, ny: 0.5, sent: true });
  }
  if (cmd.includes(' adb-tap ')) {
    return JSON.stringify({ ok: true, verb: 'adb-tap', sent: true });
  }
  if (cmd.includes(' keyboard-type ')) {
    return JSON.stringify({ ok: true, verb: 'keyboard-type', typed: 5, sent: true });
  }
  if (cmd.includes(' adb-apps ')) return JSON.stringify({ ok: true, verb: 'adb-apps', apps: ['com.amazon.tv.launcher'] });
  return JSON.stringify({
    ok: true, verb: 'status', version: '1.4.1', adb: { ready: true, version: '34.0.4', devices: [] },
    bluetooth: { ready: false, message: 'No Bluetooth adapter on this computer.' }, ble: null,
    mirror: { ready: true, version: '1.68.2', running: mode.mirrorRunning, receiverName: 'OSHAL Mirror (Spark)', hasFrame: false, message: 'AirPlay receiver ready' },
    ffmpeg: true, readAt: Date.now()
  });
}

async function handleRun(req, res, raw) {
  if (mode.holdRun) await mode.holdRun;
  const parsed = JSON.parse(raw || '{}');
  const line = buildBridgeLine(String(parsed?.arguments?.command || ''));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, output: { stdout: `${line}\n`, stderr: '', exitCode: 0 } }));
}

before(async () => {
  const db = store.getDatabase(path.join(work, 'ui.sqlite'));
  const actor = { issuer: 'https://issuer.example', sub: 'alice' };
  store.savePhone(db, actor, {
    name: 'Living Room Fire TV', platform: 'android', form: 'tv',
    computerNodeId: COMPUTERS[3].id, address: '192.168.1.60:5555'
  });
  store.savePhone(db, actor, {
    name: "Roger's iPhone", platform: 'ios',
    computerNodeId: COMPUTERS[3].id, address: '7C:4B:26:00:00:01'
  });
  const routes = createPhoneControlRoutes({
    appPackageDir: PKG, db,
    authorization: { currentActor: () => ({ isActive: true, ...actor }), registerResource() {} }
  });
  server = http.createServer((req, res) => {
    if (serveSharedAsset(req, res)) return;
    if (req.url === '/api/computers' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ computers: COMPUTERS }));
      return;
    }
    if (req.url === '/api/rdp/sessions' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sessions: [] }));
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (req.url.startsWith('/api/computers/') && req.url.endsWith('/run')) { void handleRun(req, res, raw); return; }
      if (mode.denyDevices && req.url.startsWith('/api/phone-control/devices')) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'application_resource_denied', message: 'Device features require administrator access.' }));
        return;
      }
      req.body = raw ? JSON.parse(raw) : {};
      req.url = req.url.slice('/api/phone-control'.length) || '/';
      routes.handle(req, res, () => { res.statusCode = 404; res.end('{}'); });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  server?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

test('Use this computer explains disconnected, control-off and Windows rows, and busy Connect answers in its own card', async () => {
  mode = { denyDevices: false, holdRun: null, mirrorRunning: false };
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/api/phone-control/config/ui`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#connectSheet').isHidden(), false);
  const buttons = page.locator('#computersBody button', { hasText: 'Use this computer' });
  await assert.doesNotReject(() => buttons.nth(0).waitFor());
  assert.equal(await buttons.count(), 4);

  await buttons.nth(0).click();
  assert.match(await page.locator('#computersStatus').textContent(), /Offline Box is not connected.*open oshal Node/i);
  assert.equal(await page.locator('#setupCard').isHidden(), true);

  await buttons.nth(1).click();
  assert.match(await page.locator('#computersStatus').textContent(), /Let Jarvis control this computer/);
  assert.equal(await page.locator('#setupCard').isHidden(), true);

  await buttons.nth(2).click();
  assert.match(await page.locator('#computersStatus').textContent(), /Desk PC runs Windows.*Linux computer only/);
  assert.equal(await page.locator('#setupCard').isHidden(), true);

  let releaseRun;
  mode.holdRun = new Promise((resolve) => { releaseRun = resolve; });
  await buttons.nth(3).click();
  assert.equal(await page.locator('#setupCard').isHidden(), false);
  assert.equal(await page.locator('#tvCard').isHidden(), false);

  await page.locator('#connectSend').click();
  assert.match(await page.locator('#androidStatus').textContent(), /Reading that computer is still running on Spark/);
  assert.equal(await page.locator('#setupStatus').textContent(), '');

  releaseRun();
  mode.holdRun = null;
  await page.close();
});

test('non-admin 403 shows the not-available card, and an Android Fire TV session sits in the unified image stage with its compact TV remote', async () => {
  mode = { denyDevices: true, holdRun: null, mirrorRunning: false };
  const viewer = await browser.newPage({ viewport: { width: 412, height: 915 } });
  await viewer.goto(`${base}/api/phone-control/ui`, { waitUntil: 'networkidle' });
  assert.equal(await viewer.locator('#notAllowed').isHidden(), false);
  assert.equal(await viewer.locator('#devicesView').isHidden(), true);
  assert.equal(await viewer.locator('#connectSheet').isHidden(), true);
  assert.equal(await viewer.locator('#pageActions').isHidden(), true);
  await viewer.close();

  mode = { denyDevices: false, holdRun: null, mirrorRunning: false };
  const admin = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await admin.goto(`${base}/api/phone-control/ui`, { waitUntil: 'networkidle' });
  assert.match(await admin.locator('#phoneRail').textContent(), /TV · last seen offline/);
  await admin.locator('#phoneRail .pc-rail-item', { hasText: 'Living Room Fire TV' }).click();
  await admin.waitForFunction(() => {
    const img = document.getElementById('screenImage');
    return img && !img.hidden && img.complete && img.getBoundingClientRect().height > 20;
  });
  assert.match(await admin.locator('#stageSub').textContent(), /TV over Wi-Fi · 1920×1080 · through Spark/);
  assert.equal(await admin.locator('#tvRemote').isHidden(), false);
  assert.equal(await admin.locator('#androidNavBar').isHidden(), true);
  assert.equal(await admin.locator('#androidNavBar [data-key="RECENTS"]').isHidden(), true);

  await admin.locator('#sessionControlsBtn').click();
  assert.equal(await admin.locator('[data-key="POWER"]').isHidden(), true);
  await admin.locator('#sessionSheetDoneBtn').click();

  await admin.locator('#screenImage').click();
  await admin.waitForFunction(() => /Tap at \d+, \d+: done\./.test(document.getElementById('stageStatus')?.textContent || ''));
  assert.equal(await admin.evaluate(() => document.activeElement?.id), 'deviceFrame');
  await admin.close();
});

test('an iPhone session starts UxPlay mirroring, streams mirror-frame pictures, clicks directly, types from keyboard, and stops cleanly', async () => {
  mode = { denyDevices: false, holdRun: null, mirrorRunning: false };
  const admin = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await admin.goto(`${base}/api/phone-control/ui`, { waitUntil: 'networkidle' });
  await admin.locator('#phoneRail .pc-rail-item', { hasText: "Roger's iPhone" }).click();
  assert.equal(await admin.locator('#sessionMirrorBtn').textContent(), 'Start mirroring');
  await admin.locator('#sessionMirrorBtn').click();
  await admin.waitForFunction(() => {
    const img = document.getElementById('screenImage');
    return img && !img.hidden && img.complete && img.getBoundingClientRect().height > 20;
  });
  assert.equal(await admin.locator('#sessionMirrorBtn').textContent(), 'Stop mirroring');
  assert.match(await admin.locator('#stageSub').textContent(), /iPhone over Bluetooth \+ AirPlay · 1170×2532 · through Spark/);
  await admin.locator('#screenImage').click();
  await admin.waitForFunction(() => /Tap at \d+, \d+: done\./.test(document.getElementById('stageStatus')?.textContent || ''));
  assert.equal(await admin.evaluate(() => document.activeElement?.id), 'deviceFrame');
  await admin.keyboard.type('hello');
  await admin.waitForFunction(() => /Type 5 characters: done\./.test(document.getElementById('stageStatus')?.textContent || ''));
  await admin.locator('#sessionMirrorBtn').click();
  await admin.waitForFunction(() => document.getElementById('sessionMirrorBtn')?.textContent === 'Start mirroring');
  assert.equal(await admin.locator('#screenImage').isHidden(), true);
  await admin.close();
});
