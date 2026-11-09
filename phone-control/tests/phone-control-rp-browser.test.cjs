/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0 Chromium acceptance suite: verifies all 13 Reference-Product session features (RP-PHC-01..13), Phone & TV Concierge task chips + anti-loop stop, ble-calibrate, 1-step Fire TV Load oshal TV with unauthorized auto-poll + APK install, RDP X.224 setup/probe, overflow ⋯ button, zero console/404 errors, shell orb visibility, and 412x743 + 1440x900 layout geometry.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.1: update mock bridge status version to 1.4.1.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.5.1: Connect in console is hidden until an RDP session backend exists (nothing implements /api/rdp/sessions): the Connect sheet case proves the button and its Username, Password and Domain fields are not shown, the Any RDP Host steps point at Check RDP port, Check RDP port still answers through the bridge, and the sheet makes no /api/rdp/sessions request (red on 1.5.0, which showed the button). The session viewer kept for that backend is now reached from a listed session (the page's own oshal.pc.hasRdp path) instead of the hidden button, with the same click, dictation, voice Concierge and APK push assertions.
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

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-control-rp-browser-'));
process.env.OSHAL_PACKAGE_DATA_DIR = work;
const store = require(path.join(PKG, 'lib', 'db.js'));
const { bridgeManifest } = require(path.join(PKG, 'lib', 'bridge-files.js'));
const { createPhoneControlRoutes } = require(path.join(PKG, 'routes', 'phone-control-routes.js'));
const MANIFEST = bridgeManifest(PKG);

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const SPARK = {
  id: '44444444-4444-4444-8444-444444444444', name: 'Spark', platform: 'linux',
  connected: true, can_control: true, tools: ['shell.exec', 'desktop.control', 'app.open']
};

const FAKE_APK = Buffer.from('PK\x03\x04oshal-orbit-android-apk');
const FAKE_APK_SHA = crypto.createHash('sha256').update(FAKE_APK).digest('hex');

let server;
let browser;
let base;
let calls = [];
let rdpInputs = [];
let rdpSessions = [];
let ambientTranscriptions = [];
let tvConnectCount = 0;

function handleRdpRoute(req, res, raw) {
  if (req.url === '/api/rdp/sessions' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sessions: rdpSessions }));
    return true;
  }
  if (req.url === '/api/rdp/sessions' && req.method === 'POST') {
    const body = raw ? JSON.parse(raw) : {};
    const session = {
      sessionId: 'rdp_desk_1', host: body.host || '192.168.1.50', port: body.port || 3389,
      username: body.username || 'roger', width: body.width || 1280, height: body.height || 800, connected: true
    };
    rdpSessions = [session, ...rdpSessions.filter((s) => s.sessionId !== session.sessionId)];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(session));
    return true;
  }
  if (req.url === '/api/rdp/sessions/rdp_desk_1/frame' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'image/png', 'x-rdp-width': '1280', 'x-rdp-height': '800' });
    res.end(PNG_1X1);
    return true;
  }
  if (req.url === '/api/rdp/sessions/rdp_desk_1/input' && req.method === 'POST') {
    const body = raw ? JSON.parse(raw) : {};
    rdpInputs.push(body);
    const payload = body.action === 'snapshot'
      ? { ok: true, frameSha256: 'rdp-sig-1', items: [{ text: 'Netflix', x: 640, y: 400, nx: 0.5, ny: 0.5 }] }
      : { ok: true };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
    return true;
  }
  if (req.url === '/api/rdp/sessions/rdp_desk_1' && req.method === 'DELETE') {
    rdpSessions = [];
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

function serveSharedAsset(req, res) {
  if ((req.url.startsWith('/ui/kernel/') || req.url.startsWith('/shared/ui/')) && req.url.endsWith('.css')) {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    res.end(':root { --bg-primary: #ffffff; --text-primary: #0f172a; --text-secondary: #475569; --accent-primary: #2563eb; } [hidden] { display: none !important; } body { margin: 0; }');
    return true;
  }
  if (req.url === '/shared/ui/js/surface-bridge-client.js' || req.url === '/shared/ui/js/surface-theme.js' || req.url === '/ui/kernel/table.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    res.end(req.url.endsWith('surface-bridge-client.js') ? 'export function createSurfaceBridgeClient(){ return { attach(){}, emitContext(){} }; }' : '');
    return true;
  }
  return false;
}

function decodeB64Arg(cmd) {
  const m = / --b64 ([A-Za-z0-9+/=]+)/.exec(cmd);
  if (!m) return {};
  try { return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch { return {}; }
}

function handleBridgeVerb(cmd) {
  const sha256 = crypto.createHash('sha256').update(PNG_1X1).digest('hex');
  const args = decodeB64Arg(cmd);
  if (cmd.includes(' mirror-frame ') || cmd.includes(' adb-frame ')) {
    const verb = cmd.includes(' mirror-frame ') ? 'mirror-frame' : 'adb-frame';
    return {
      ok: true, verb, id: sha256.slice(0, 16), sha256, mime: 'image/png',
      bytes: PNG_1X1.length, chunks: 1, index: 0, data: PNG_1X1.toString('base64'),
      deviceWidth: verb === 'mirror-frame' ? 1170 : 1920, deviceHeight: verb === 'mirror-frame' ? 2532 : 1080, slow: false
    };
  }
  if (cmd.includes(' mirror-ui ')) {
    return {
      ok: true, verb: 'mirror-ui', frameSha256: 'sig-1', deviceWidth: 1170, deviceHeight: 2532,
      items: [
        { text: 'Notes', nx: 0.22, ny: 0.32, iconNy: 0.26, x: 257, y: 810 },
        { text: 'Reminders', nx: 0.48, ny: 0.32, iconNy: 0.26, x: 561, y: 810 }
      ]
    };
  }
  if (cmd.includes(' ble-calibrate ')) {
    return { ok: true, verb: 'ble-calibrate', profile: { span_x: 412, span_y: 896, gain_x: 2.84, gain_y: 2.82 } };
  }
  if (cmd.includes(' adb-connect-tv ')) {
    tvConnectCount += 1;
    return tvConnectCount === 1
      ? { ok: false, verb: 'adb-connect-tv', error: 'device_unauthorized', message: 'Allow USB debugging on TV' }
      : { ok: true, verb: 'adb-connect-tv', serial: '192.168.1.138:5555', address: '192.168.1.138:5555', state: 'device', ready: true, model: 'AFTMD001' };
  }
  if (cmd.includes(' adb-devices ')) {
    return { ok: true, verb: 'adb-devices', devices: [{ serial: '192.168.1.138:5555', state: 'device' }] };
  }
  if (cmd.includes(' adb-install-apk ')) {
    return { ok: true, verb: 'adb-install-apk', installed: true, launched: args.launchPackage || 'com.oshal.remote' };
  }
  if (cmd.includes(' adb-connect ')) {
    return { ok: true, verb: 'adb-connect', serial: args.address || '192.168.1.77:5555', state: 'device' };
  }
  if (cmd.includes(' adb-info ')) {
    return { ok: true, verb: 'adb-info', manufacturer: 'Google', model: 'Pixel 9', width: 1080, height: 2400 };
  }
  if (cmd.includes(' stage-chunk ')) {
    return { ok: true, verb: 'stage-chunk', staged: true, sha256: args.sha256 };
  }
  if (cmd.includes(' rdp-probe ')) {
    return { ok: true, verb: 'rdp-probe', address: `${args.host}:${args.port || 3389}`, reachable: true, rdpHandshake: true, security: 'NLA (CredSSP)', latencyMs: 4 };
  }
  if (cmd.includes(' adb-apps ')) return { ok: true, verb: 'adb-apps', apps: ['com.oshal.remote', 'com.amazon.firetv.youtube'] };
  if (cmd.includes(' version ')) {
    return {
      ok: true, verb: 'version', version: MANIFEST.version,
      files: Object.fromEntries(MANIFEST.files.map((f) => [f.name, f.sha256]))
    };
  }
  if (cmd.includes(' status ')) {
    return {
      ok: true, verb: 'status', version: '1.4.1',
      adb: { ready: true, version: '34.0.4', devices: [] },
      bluetooth: { ready: true, address: 'AA:BB:CC:DD:EE:FF' },
      ble: { registered: true, advertising: true, phones: [{ address: '7C:4B:26:00:00:01', name: "Roger's iPhone", paired: true, connected: true }] },
      mirror: { ready: true, version: '1.68.2', running: true, receiverName: 'OSHAL Mirror (Spark)', hasFrame: true, message: 'AirPlay on' },
      tvApk: { file: 'Open-Swarm-FireTV-0.7.3-arm64-v8a.apk', bytes: 5120000, sha256: 'abcd1234' },
      ffmpeg: true, readAt: Date.now()
    };
  }
  return { ok: true, sent: true, args };
}

function handleComputerShell(cmd) {
  if (cmd.includes('xrandr')) {
    return {
      ok: true, platform: 'linux',
      monitors: [
        { id: 'DP-1', label: 'DP-1 (1920x1080)', width: 1920, height: 1080, originX: 0, originY: 0, primary: true },
        { id: 'HDMI-1', label: 'HDMI-1 (1920x1080)', width: 1920, height: 1080, originX: 1920, originY: 0, primary: false }
      ]
    };
  }
  if (cmd.includes('oshal-privacy-hook')) return { ok: false, code: 'no_driver', message: 'oshal-privacy-hook is not installed on that computer.' };
  if (cmd.includes('loginctl')) return { ok: true };
  if (cmd.includes('os.listdir(d)')) return { ok: true, folder: '~/Downloads', files: [{ name: 'report.txt', sizeBytes: 2048 }] };
  if (cmd.includes('open(p,"ab"')) return { ok: true, path: '~/Downloads/notes.txt', sizeBytes: 12 };
  if (cmd.includes('wl-paste')) return { ok: true, text: 'RemoteClipboardText' };
  if (cmd.includes('wl-copy')) return { ok: true };
  if (cmd.includes('chat-inbox.jsonl')) return { ok: true, replies: ['Reply from Spark user'] };
  return handleBridgeVerb(cmd);
}

function handleComputerRun(req, res, raw) {
  const parsed = JSON.parse(raw || '{}');
  calls.push(parsed);
  if (parsed.tool === 'desktop.control' || parsed.tool === 'app.open') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  const line = JSON.stringify(handleComputerShell(String(parsed?.arguments?.command || '')));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, output: { stdout: `${line}\n`, stderr: '', exitCode: 0 } }));
}

before(async () => {
  const db = store.getDatabase(path.join(work, 'rp.sqlite'));
  const actor = { issuer: 'https://issuer.example', sub: 'roger' };
  store.savePhone(db, actor, { name: "Roger's iPhone", platform: 'ios', computerNodeId: SPARK.id, address: '7C:4B:26:00:00:01' });
  store.savePhone(db, actor, { name: 'Living Room Fire TV', platform: 'android', form: 'tv', computerNodeId: SPARK.id, address: '192.168.1.138:5555' });
  store.saveComputerReport(db, actor, SPARK.id, handleBridgeVerb(' status '));
  const routes = createPhoneControlRoutes({
    appPackageDir: PKG, db,
    authorization: { currentActor: () => ({ isActive: true, ...actor }), registerResource() {} }
  });
  server = http.createServer((req, res) => {
    if (serveSharedAsset(req, res)) return;
    if (req.url === '/api/computers' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ computers: [SPARK] }));
      return;
    }
    if (req.url === '/api/devices/downloads' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        downloads: [
          { file: 'Open-Swarm-FireTV-0.7.3-arm64-v8a.apk', bytes: FAKE_APK.length, sha256: FAKE_APK_SHA, url: '/api/devices/downloads/Open-Swarm-FireTV-0.7.3-arm64-v8a.apk' },
          { file: 'Open-Swarm-Orbit-0.7.3-android.apk', bytes: FAKE_APK.length, sha256: FAKE_APK_SHA, url: '/api/devices/downloads/Open-Swarm-Orbit-0.7.3-android.apk' }
        ]
      }));
      return;
    }
    if (req.url.startsWith('/api/devices/downloads/') && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive' });
      res.end(FAKE_APK);
      return;
    }
    if (req.url.startsWith('/api/computers/') && req.url.endsWith('/screen')) {
      res.writeHead(200, { 'content-type': 'image/png', etag: '"frame-1"' });
      res.end(PNG_1X1);
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (req.url === '/api/voice/transcribe' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { fallback: 'unconfigured' } }));
        return;
      }
      if (req.url === '/api/jarvis/ambient/transcribe' && req.method === 'POST') {
        ambientTranscriptions.push(JSON.parse(raw || '{}'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, text: 'dictated over mic' }));
        return;
      }
      if (req.url.startsWith('/api/rdp/sessions') && handleRdpRoute(req, res, raw)) return;
      if (req.url.startsWith('/api/computers/') && req.url.endsWith('/run')) { handleComputerRun(req, res, raw); return; }
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

function attachConsoleAnd404Guard(page, errors) {
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => { if (res.status() === 404) errors.push(`404: ${res.url()}`); });
}

test('Computer session ships RP-PHC-01..13 end-to-end with zero placeholders, zero 404s, and responsive ⋯ overflow', async () => {
  calls = [];
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  attachConsoleAnd404Guard(page, errors);
  await page.goto(`${base}/api/phone-control/ui`, { waitUntil: 'networkidle' });

  assert.equal(await page.locator('[data-ds-backlog], [data-ds-not-yet]').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
  assert.notEqual(await page.evaluate(() => document.documentElement.getAttribute('data-oshal-assistant-hidden')), 'true');

  await page.locator('#computerRail .pc-rail-item', { hasText: 'Spark' }).click();
  await page.waitForFunction(() => {
    const img = document.getElementById('screenImage');
    return img && !img.hidden && img.complete && img.getBoundingClientRect().height > 20;
  });
  assert.equal((await page.locator('#sessionControlsBtn').textContent()).trim(), '⋯');
  assert.equal(await page.locator('#sessionHandleBtn').isVisible(), false);

  await page.locator('#screenImage').click();
  await page.waitForFunction(() => true);
  await page.locator('#sessionControlsBtn').click();
  await page.locator('#sessionSheet:not([hidden])').waitFor();

  await page.locator('#inputModeBtn').click();
  assert.match(await page.locator('#inputModeBtn').textContent(), /Mouse pad/);
  await page.locator('#ctrlAltDelBtn').click();
  await page.locator('#specialKeySelect').selectOption('alt+Tab');
  await page.locator('#sendSpecialKeyBtn').click();
  await page.locator('#scanMonitorsBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#monitorSelect option').length >= 2);
  await page.locator('#qualitySelect').selectOption('high');
  await page.locator('#screenshotBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#capturesList li').length >= 1);
  await page.locator('#privacyScreenBtn').click();
  await page.locator('#lockOnEndBtn').click();

  await page.evaluate(() => {
    for (const id of ['filesDrawer', 'clipboardDrawer', 'chatDrawer', 'whiteboardDrawer']) document.getElementById(id).open = true;
  });
  await page.locator('#listRemoteFilesBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#remoteFilesList li').length === 1);
  await page.locator('#fileUploadInput').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello world\n') });
  await page.waitForFunction(() => document.querySelectorAll('#transfersList li').length >= 1);

  await page.locator('#readClipboardBtn').click();
  await page.waitForFunction(() => document.getElementById('clipboardText').value === 'RemoteClipboardText');
  await page.locator('#clipboardText').fill('OperatorClip');
  await page.locator('#writeClipboardBtn').click();

  await page.locator('#chatInput').fill('Checking Spark display');
  await page.locator('#chatSendBtn').click();
  await page.waitForFunction(() => document.getElementById('chatLog').textContent.includes('Reply from Spark user'));

  await page.locator('#whiteboardToggleBtn').click();
  await page.locator('#sessionSheetDoneBtn').click();
  const wbBox = await page.locator('#whiteboardCanvas').boundingBox();
  await page.mouse.move(wbBox.x + wbBox.width * 0.2, wbBox.y + wbBox.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(wbBox.x + wbBox.width * 0.7, wbBox.y + wbBox.height * 0.7);
  await page.mouse.up();
  await page.locator('#sessionControlsBtn').click();
  await page.locator('#saveWhiteboardBtn').click();
  await page.waitForFunction(() => document.getElementById('whiteboardStatus').textContent.includes('Saved'));

  const desktopTools = calls.filter((c) => c.tool === 'desktop.control').map((c) => c.arguments);
  assert.ok(desktopTools.some((a) => a.kind === 'click' && a.coordinateSpace === 'screenshot'));
  assert.ok(desktopTools.some((a) => a.kind === 'key' && a.keys === 'ctrl+alt+delete'));
  assert.ok(desktopTools.some((a) => a.kind === 'key' && a.keys === 'alt+Tab'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('Phone Concierge organizes apps & calibrates on iPhone, TV Concierge adapts for Fire TV, and 412x743 mobile fits cleanly', async () => {
  calls = [];
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 412, height: 743 } });
  attachConsoleAnd404Guard(page, errors);
  await page.goto(`${base}/api/phone-control/ui`, { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);

  await page.locator('#phoneRail .pc-rail-item', { hasText: "Roger's iPhone" }).click();
  await page.locator('#screenImage:not([hidden])').waitFor();
  assert.equal(await page.locator('#sessionHandleBtn').isVisible(), true);
  await page.locator('#sessionHandleBtn').click();
  await page.locator('#sessionSheet:not([hidden])').waitFor();
  assert.equal((await page.locator('#conciergeHeading').textContent()).trim(), 'Phone Concierge');
  assert.equal(await page.locator('#chipOrganizeApps').isHidden(), false);

  await page.locator('#chipOrganizeApps').click();
  await page.waitForFunction(() => document.getElementById('conciergeLog').textContent.includes('Grouped 2 visible apps'));
  assert.ok(calls.some((c) => String(c.arguments?.command || '').includes(' ble-drag ')));

  await page.locator('#calibratePointerBtn').click();
  await page.waitForFunction(() => document.getElementById('stageStatus').textContent.includes('Pointer calibrated'));
  await page.locator('#switchSidesBtn').click();
  assert.match(await page.locator('#stageStatus').textContent(), /cannot view or control your operator browser session/);
  await page.locator('#endSessionBtn').click();

  await page.locator('#phoneRail .pc-rail-item', { hasText: 'Living Room Fire TV' }).click();
  await page.waitForFunction(() => {
    const img = document.getElementById('screenImage');
    return img && !img.hidden && img.complete && img.getBoundingClientRect().height > 20;
  });
  await page.locator('#screenImage').click();
  await page.waitForFunction(() => /Tap at \d+, \d+: done\./.test(document.getElementById('stageStatus')?.textContent || ''));
  assert.ok(calls.some((c) => String(c.arguments?.command || '').includes(' adb-tap ')));
  await page.locator('#sessionHandleBtn').click();
  await page.locator('#sessionSheet:not([hidden])').waitFor();
  assert.equal((await page.locator('#conciergeHeading').textContent()).trim(), 'TV Concierge');
  assert.equal(await page.locator('#chipOrganizeApps').isHidden(), true);
  assert.equal((await page.locator('#chipOpenNotes').textContent()).trim(), 'Open YouTube');
  assert.equal((await page.locator('#conciergeSwipeLeftBtn').textContent()).trim(), 'Open oshal TV');
  await page.locator('#conciergeSwipeLeftBtn').click();
  await page.waitForFunction(() => document.getElementById('conciergeLog').textContent.includes('Opening oshal TV on your TV'));
  assert.ok(calls.some((c) => String(c.arguments?.command || '').includes(' adb-launch ')));
  assert.deepEqual(errors, []);
  await page.close();
});

test('Connect sheet 1-step Load oshal TV polls unauthorized -> device + installs APK, and RDP setup switches OS + probes port with Connect in console hidden', async () => {
  calls = [];
  tvConnectCount = 0;
  const errors = [];
  const rdpRequests = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  attachConsoleAnd404Guard(page, errors);
  page.on('request', (request) => { if (request.url().includes('/api/rdp/sessions')) rdpRequests.push(request.url()); });
  await page.addInitScript(() => { window.__PC_TV_POLL_MS = 35; });
  await page.goto(`${base}/api/phone-control/config/ui`, { waitUntil: 'networkidle' });

  await page.locator('#computersBody button', { hasText: 'Use this computer' }).first().click();
  await page.waitForFunction(() => !document.getElementById('tvCard').hidden && !document.getElementById('tvSend').hasAttribute('aria-busy'));

  for (const id of ['#rdpConnectBtn', '#rdpUsername', '#rdpPassword', '#rdpDomain']) {
    assert.equal(await page.locator(id).isHidden(), true, `${id} is not shown while no RDP session backend exists`);
  }
  assert.equal(await page.getByText('Connect in console').isVisible(), false);
  assert.equal(await page.locator('#rdpProbeBtn').isVisible(), true);
  assert.equal(await page.locator('#copyRdpScriptBtn').isVisible(), true);
  await page.locator('#rdpOsAnyBtn').click();
  assert.match(await page.locator('#rdpSetupScript').textContent(), /press Check RDP port/);
  assert.doesNotMatch(await page.locator('#rdpSetupScript').textContent(), /Connect in console|password/i);
  await page.locator('#rdpOsLinuxBtn').click();
  assert.match(await page.locator('#rdpSetupScript').textContent(), /grdctl|xrdp/);
  await page.locator('#rdpHost').fill('192.168.1.50');
  await page.locator('#rdpProbeBtn').click();
  await page.waitForFunction(() => !document.getElementById('rdpWorkLink').hidden && !document.getElementById('tvSend').hasAttribute('aria-busy'));
  assert.match(await page.locator('#rdpStatus').textContent(), /RDP X\.224 handshake verified/);
  assert.ok(calls.some((c) => String(c.arguments?.command || '').includes(' rdp-probe ')), 'Check RDP port ran the bridge rdp-probe');

  await page.locator('#tvAddress').fill('192.168.1.138');
  await page.locator('#tvSend').click();
  await page.waitForFunction(() => !document.getElementById('sessionView').hidden, null, { timeout: 4000 }).catch(async (err) => {
    const tvStatus = await page.locator('#tvStatus').textContent();
    throw new Error(`${err.message} | tvStatus=${tvStatus} | tvConnectCount=${tvConnectCount}`);
  });
  assert.equal(tvConnectCount >= 2, true);
  assert.ok(calls.some((c) => String(c.arguments?.command || '').includes(' adb-install-apk ')));
  assert.deepEqual(rdpRequests, [], 'the Connect sheet never calls the RDP session route nothing implements');
  assert.deepEqual(errors, []);
  await page.close();
});

test('A listed RDP session (the viewer kept for a future backend) streams frames, maps clicks + voice dictation + voice Concierge, and pushes Android Companion APK', async () => {
  calls = [];
  rdpInputs = [];
  rdpSessions = [{ sessionId: 'rdp_desk_1', host: '192.168.1.50', port: 3389, username: 'roger', width: 1280, height: 800, connected: true }];
  ambientTranscriptions = [];
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  attachConsoleAnd404Guard(page, errors);
  await page.addInitScript(() => {
    localStorage.setItem('oshal.pc.hasRdp', '1');
    window.__PC_VOICE_RECORD_MS = 60;
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    window.MediaRecorder = class {
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }) });
        this.onstop?.();
      }
    };
  });
  await page.goto(`${base}/api/phone-control/ui`, { waitUntil: 'networkidle' });

  await page.locator('#computerRail .pc-rail-item', { hasText: 'roger@192.168.1.50' }).click();

  await page.waitForFunction(() => {
    const img = document.getElementById('screenImage');
    return !document.getElementById('sessionView').hidden && img && !img.hidden && img.complete && img.getBoundingClientRect().height > 20;
  });
  assert.match(await page.locator('#stageSub').textContent(), /RDP desktop · 1280×800 · connected/);
  assert.equal((await page.locator('#conciergeHeading').textContent()).trim(), 'RDP Concierge');

  await page.locator('#screenImage').click();
  await page.waitForFunction(() => /Click at \d+, \d+: done\./.test(document.getElementById('stageStatus')?.textContent || ''));
  await page.locator('#railTabControls').click();
  await page.locator('#quickVoiceBtn').click();
  await page.waitForFunction(() => /Type 17 characters: done\./.test(document.getElementById('stageStatus')?.textContent || ''));
  assert.equal(ambientTranscriptions.length, 1);

  await page.evaluate(() => {
    window.SpeechRecognition = class {
      start() {
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: "What's on screen?" }]] });
          this.onend?.();
        }, 10);
      }
      stop() { this.onend?.(); }
    };
    document.getElementById('screenTextCard').open = true;
  });
  await page.locator('#readScreen').click();
  await page.waitForFunction(() => document.getElementById('screenTextBody').textContent.includes('Netflix'));
  await page.locator('#railTabConcierge').click();
  await page.locator('#conciergeVoiceBtn').click();
  await page.waitForFunction(() => document.getElementById('conciergeLog').textContent.includes('Netflix'));

  assert.ok(rdpInputs.some((i) => i.action === 'click' && Number.isFinite(i.x) && Number.isFinite(i.y)));
  assert.ok(rdpInputs.some((i) => i.action === 'type' && i.text === 'dictated over mic'));
  assert.ok(rdpInputs.some((i) => i.action === 'snapshot'));

  await page.locator('#sessionControlsBtn').click();
  await page.locator('#endSessionBtn').click();
  await page.locator('#addDeviceBtn').click();
  await page.locator('#computersBody button', { hasText: 'Use this computer' }).first().click();
  await page.locator('#connectAddress').fill('192.168.1.77:5555');
  await page.locator('#pushAndroidApkBtn').click();
  await page.waitForFunction(() => !document.getElementById('sessionView').hidden && document.getElementById('stageTitle').textContent.includes('Pixel 9'));
  assert.ok(calls.some((c) => String(c.arguments?.command || '').includes(' stage-chunk ')));
  assert.ok(calls.some((c) => String(c.arguments?.command || '').includes(' adb-install-apk ')));
  await page.locator('#sessionControlsBtn').click();
  assert.equal(await page.locator('#installSessionApkBtn').isHidden(), false);
  assert.deepEqual(errors, []);
  await page.close();
});
