/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | phone-control 1.4.1 unit, Python bridge, and Chromium suite: verifies studio toolbar (#syncDeviceBtn, single #sessionMirrorBtn, #fullscreenStageBtn + Escape exit, #toggleConciergeBtn), BLE 0x1801/connect_bonded/ble-sync + non-flooding AssistiveTouch swipes, pre-mirror stage touchpad gestures, Fire TV protectedSurface notice + TV keyboard navigation + fast frame wakeups, zero default /api/rdp/sessions polling, and guided Android pairing IP prefill.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const PKG = path.resolve(__dirname, '..');
const STORE = path.resolve(PKG, '..');
const { chromium } = require(path.join(STORE, 'scripts', 'toolchain', 'node_modules', 'playwright'));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-control-141-'));
process.env.OSHAL_PACKAGE_DATA_DIR = work;
const store = require(path.join(PKG, 'lib', 'db.js'));
const { createPhoneControlRoutes } = require(path.join(PKG, 'routes', 'phone-control-routes.js'));

function makeSolidPng(width, height, r, g, b) {
  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y += 1) {
    const baseOff = y * rowLen;
    raw[baseOff] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[baseOff + 1 + x * 3] = r;
      raw[baseOff + 2 + x * 3] = g;
      raw[baseOff + 3 + x * 3] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const BLACK_PNG = makeSolidPng(80, 64, 0, 0, 0);
const COLOR_PNG = makeSolidPng(80, 64, 36, 120, 210);
const SPARK = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Spark', platform: 'linux', connected: true, can_control: true, tools: ['shell.exec']
};

let server;
let browser;
let base;
let state = { rdpHits: 0, bridgeCalls: [], tvProtected: true };

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

function decodeBridgeCall(cmd) {
  const match = /oshal_phone_bridge\.py"\s+([a-z0-9-]+)(?:\s+--b64\s+([A-Za-z0-9+/=]+))?/.exec(cmd);
  if (!match) return { verb: 'unknown', args: {} };
  const args = match[2] ? JSON.parse(Buffer.from(match[2], 'base64').toString('utf8')) : {};
  return { verb: match[1], args };
}

function buildMockAdbFrame() {
  const png = state.tvProtected ? BLACK_PNG : COLOR_PNG;
  const sha256 = crypto.createHash('sha256').update(png).digest('hex');
  return {
    ok: true, verb: 'adb-frame', id: sha256.slice(0, 16), sha256, mime: 'image/png',
    bytes: png.length, chunks: 1, index: 0, data: png.toString('base64'),
    deviceWidth: 1920, deviceHeight: 1080, slow: false,
    protectedSurface: state.tvProtected, screenAsleep: false,
    activePackage: state.tvProtected ? 'com.amazon.firetv.youtube.tv' : 'com.amazon.tv.launcher',
    activeActivity: state.tvProtected ? 'dev.cobalt.app.MainActivity' : '.ui.HomeActivity_vNext'
  };
}

function replyForBridgeCall(verb, args) {
  state.bridgeCalls.push({ verb, args, at: Date.now() });
  if (verb === 'adb-frame') return buildMockAdbFrame();
  if (verb === 'ble-sync') {
    return {
      ok: true, verb: 'ble-sync', connected: true,
      subscribed: { keyboard: true, consumer: true, mouse: true },
      pointerCentered: true, message: 'Synced with iPhone and centered AssistiveTouch pointer.'
    };
  }
  if (verb === 'ble-swipe') return { ok: true, verb: 'ble-swipe', sent: true, steps: 14 };
  if (verb === 'ble-tap') return { ok: true, verb: 'ble-tap', sent: true };
  if (verb === 'adb-key') {
    if (args.key === 'HOME') state.tvProtected = false;
    return { ok: true, verb: 'adb-key', key: args.key };
  }
  if (verb === 'adb-apps') return { ok: true, verb: 'adb-apps', apps: ['com.amazon.tv.launcher', 'com.amazon.firetv.youtube.tv'] };
  if (verb === 'version') {
    const manifest = require(path.join(PKG, 'lib', 'bridge-files.js')).bridgeManifest(PKG);
    return { ok: true, verb: 'version', version: manifest.version, files: Object.fromEntries(manifest.files.map((f) => [f.name, f.sha256])) };
  }
  if (verb === 'adb-pair') return { ok: true, verb: 'adb-pair', paired: args.address, adb: 'Successfully paired' };
  if (verb === 'adb-connect') {
    if (args.host === '192.168.1.70') return { ok: true, verb: 'adb-connect', serial: '192.168.1.70:36007', adb: 'connected to 192.168.1.70:36007' };
    return { ok: false, error: 'not_found', message: 'No paired phone advertised Wireless debugging on this network.' };
  }
  if (verb === 'adb-info' && args.serial === '192.168.1.70:36007') {
    return { ok: true, verb: 'adb-info', serial: '192.168.1.70:36007', manufacturer: 'samsung', model: 'SM-S936U', android: '16', width: 1080, height: 2340 };
  }
  return {
    ok: true, verb: 'status', version: '1.4.1',
    adb: { ready: true, version: '34.0.4', devices: [{ serial: '192.168.1.60:5555', state: 'device', model: 'AFTMD001', wireless: true }] },
    bluetooth: { ready: true, adapter: { address: 'AA:BB:CC:DD:EE:FF', name: 'Spark' }, bluez: '5.72' },
    ble: { registered: true, advertising: true, phones: [{ address: '7C:4B:26:2B:6C:02', name: 'iPhone', paired: true, connected: true }] },
    mirror: { ready: true, version: '1.68.2', running: false, receiverName: 'OSHAL Mirror (Spark)', hasFrame: false, message: 'AirPlay ready' },
    tvApk: { file: 'Open-Swarm-FireTV-0.7.3-arm64-v8a.apk', bytes: 5120000, sha256: 'abcd1234' },
    ffmpeg: true, readAt: Date.now()
  };
}

before(async () => {
  const db = store.getDatabase(path.join(work, 'ui-141.sqlite'));
  const actor = { issuer: 'https://issuer.example', sub: 'roger' };
  store.savePhone(db, actor, {
    name: 'Living Room Fire TV', platform: 'android', form: 'tv',
    computerNodeId: SPARK.id, address: '192.168.1.60:5555'
  });
  store.savePhone(db, actor, {
    name: "Roger's iPhone", platform: 'ios',
    computerNodeId: SPARK.id, address: '7C:4B:26:2B:6C:02'
  });
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
      res.end(JSON.stringify({ downloads: [{ file: 'Open-Swarm-FireTV-0.7.3-arm64-v8a.apk', bytes: 5120000, sha256: 'abcd1234' }] }));
      return;
    }
    if (req.url.startsWith('/api/rdp/sessions')) {
      state.rdpHits += 1;
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (req.url.startsWith('/api/computers/') && req.url.endsWith('/run')) {
        const parsed = JSON.parse(raw || '{}');
        const { verb, args } = decodeBridgeCall(String(parsed?.arguments?.command || ''));
        const line = JSON.stringify(replyForBridgeCall(verb, args));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, output: { stdout: `${line}\n`, stderr: '', exitCode: 0 } }));
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

test('Python BLE & Mirror helpers verify 0x1801/0x2A05, non-flooding pointer steps, string span_for, and protectedSurface detection', () => {
  const pyScript = `
import json, os, sys, tempfile, types
sys.path.insert(0, ${JSON.stringify(path.join(PKG, 'bridge'))})
import oshal_phone_bridge as b
import oshal_phone_mirror as m

tmp_home = tempfile.mkdtemp(prefix='pc141-py-')
os.environ['HOME'] = tmp_home
os.environ['XDG_RUNTIME_DIR'] = tmp_home

black = bytes.fromhex(${JSON.stringify(BLACK_PNG.toString('hex'))})
color = bytes.fromhex(${JSON.stringify(COLOR_PNG.toString('hex'))})
assert m.png_is_uniform_black(black, 80, 64) is True
assert m.png_is_uniform_black(color, 80, 64) is False

mode = {'val': 'drm'}
def fake_adb_call(args, timeout=30, binary=False, data=None):
    if args[-2:] == ['screencap', '-p']:
        return 0, (black if mode['val'] in ('drm', 'sleep') else color), b''
    return 0, '', ''

def fake_adb_shell(serial, cmd, timeout=20):
    lines = []
    if 'dumpsys window' in cmd:
        lines.append('  mCurrentFocus=Window{123 u0 com.amazon.firetv.youtube.tv/dev.cobalt.app.MainActivity}')
    if 'dumpsys power' in cmd:
        lines.append('mWakefulness=Asleep' if mode['val'] == 'sleep' else 'mWakefulness=Awake')
    return 0, '\\n'.join(lines), ''

ctx = types.SimpleNamespace(**{**vars(b.MIRROR_CTX), 'adb_call': fake_adb_call, 'adb_shell': fake_adb_shell, 'run': lambda *a, **kw: (1, b'', b'')})
r_drm = m.verb_adb_frame(ctx, {'serial': '192.168.1.60:5555'})
assert r_drm['protectedSurface'] is True and r_drm['activePackage'] == 'com.amazon.firetv.youtube.tv'
mode['val'] = 'sleep'
r_sleep = m.verb_adb_frame(ctx, {'serial': '192.168.1.60:5555'})
assert r_sleep['protectedSurface'] is False and r_sleep['screenAsleep'] is True
mode['val'] = 'home'
r_home = m.verb_adb_frame(ctx, {'serial': '192.168.1.60:5555'})
assert r_home['protectedSurface'] is False and r_home['screenAsleep'] is False

ble_src = open(${JSON.stringify(path.join(PKG, 'bridge', 'oshal_phone_ble.py'))}, encoding='utf-8').read()
assert "'1801'" in ble_src and "'2a05'" in ble_src
assert "def connect_bonded(" in ble_src and "def ensure_listening(" in ble_src and "def sync(" in ble_src
assert "for _ in range(12):" in ble_src and "(-110) & 0xFF" in ble_src and "0.065, 0.030" in ble_src
print(json.dumps({'ok': True}))
`;
  const out = JSON.parse(execFileSync('python3', ['-B', '-c', pyScript], { encoding: 'utf8' }).trim());
  assert.equal(out.ok, true);
});

test('Python bridge resolves avahi-browse Android TLS ports, excludes Fire TV, and auto-reconnects rotated TLS ports', () => {
  const pyScript = `
import json, os, subprocess, sys, tempfile, types
sys.path.insert(0, ${JSON.stringify(path.join(PKG, 'bridge'))})
import oshal_phone_bridge as b
import oshal_phone_mirror as m

os.environ['OSHAL_AVAHI_BIN'] = 'avahi-browse'
color = bytes.fromhex(${JSON.stringify(COLOR_PNG.toString('hex'))})
avahi_out = '\\n'.join([
    '=;wlP9s9;IPv4;tv;_adb-tls-connect._tcp;local;firetv.local;192.168.1.60;5555;"name=AFTMD001"',
    '=;wlP9s9;IPv4;adb-R3GY;_adb-tls-connect._tcp;local;Android.local;192.168.1.70;36007;"name=SM-S936U"',
    '=;enP7s7;IPv4;adb-R3GY;_adb-tls-connect._tcp;local;Android.local;192.168.1.70;36007;"name=SM-S936U"',
])
b.subprocess.run = lambda *a, **kw: types.SimpleNamespace(returncode=0, stdout=avahi_out, stderr='')
b.list_devices = lambda: ([{'serial': '192.168.1.60:5555', 'state': 'device', 'model': 'AFTMD001', 'wireless': True}], 0)
calls = []
def fake_adb(args, timeout=30, binary=False, data=None):
    calls.append(list(args))
    if args == ['mdns', 'services']:
        return 0, 'List of discovered mdns services\\n', ''
    if args[0] == 'connect' and args[1] == '192.168.1.70:36007':
        return 0, 'connected to 192.168.1.70:36007\\n', ''
    if args[:2] == ['-s', '192.168.1.70:45021']:
        return 1, (b'' if binary else ''), "adb: device '192.168.1.70:45021' not found"
    if args[:2] == ['-s', '192.168.1.70:36007'] and args[-2:] == ['screencap', '-p']:
        return 0, color, ''
    return 0, (b'' if binary else ''), ''

b.adb_call = fake_adb
assert b.discover_connect_address('192.168.1.70') == '192.168.1.70:36007'
assert b.discover_connect_address(None) == '192.168.1.70:36007'
ctx = types.SimpleNamespace(**{**vars(b.MIRROR_CTX), 'adb_call': fake_adb, 'adb_device_call': b.adb_device_call, 'run': lambda *a, **kw: (1, b'', b'')})
fr = m.verb_adb_frame(ctx, {'serial': '192.168.1.70:45021'})
assert fr['ok'] is True and fr['serial'] == '192.168.1.70:36007'
assert ['connect', '192.168.1.70:36007'] in calls
print(json.dumps({'ok': True}))
`;
  const out = JSON.parse(execFileSync('python3', ['-B', '-c', pyScript], { encoding: 'utf8' }).trim());
  assert.equal(out.ok, true);
});

test('SQLite store updates rotated Android Wireless Debugging port in place without duplicating phone rows', () => {
  const rotDb = store.getDatabase(path.join(work, 'rotate-141.sqlite'));
  const actor = { issuer: 'https://issuer.example', sub: 'roger-rot' };
  const first = store.savePhone(rotDb, actor, {
    name: 'samsung SM-S936U', platform: 'android', form: 'phone',
    computerNodeId: SPARK.id, address: '192.168.1.70:45021'
  });
  assert.equal(first.created, true);
  const second = store.savePhone(rotDb, actor, {
    name: 'samsung SM-S936U', platform: 'android', form: 'phone',
    computerNodeId: SPARK.id, address: '192.168.1.70:36007'
  });
  assert.equal(second.created, false);
  assert.equal(second.phone.id, first.phone.id);
  assert.equal(second.phone.address, '192.168.1.70:36007');
  const updated = store.updatePhone(rotDb, actor, first.phone.id, { address: '192.168.1.70:41535' });
  assert.equal(updated.address, '192.168.1.70:41535');
  assert.equal(store.listPhones(rotDb, actor).length, 1);
});

test('computer-link supports pre-mirror touchpad gestures, protectedSurface frame metadata, and zero RDP polling when unset', async () => {
  const linkUrl = pathToFileURL(path.join(PKG, 'tools', 'computer-link.js')).href;
  const link = await import(linkUrl);
  assert.ok(link.VERBS.includes('ble-sync'));

  const tap = link.iosGestureFromDrag({ x: 90, y: 180 }, { x: 92, y: 181 }, { width: 180, height: 360 }, null, 80);
  assert.equal(tap.verb, 'ble-tap');
  assert.equal(tap.args.nx, 0.511);

  const swipe = link.iosGestureFromDrag({ x: 150, y: 180 }, { x: 30, y: 180 }, { width: 180, height: 360 }, null, 180);
  assert.equal(swipe.verb, 'ble-swipe');
  assert.ok(swipe.args.nx1 > swipe.args.nx2);

  const sha = crypto.createHash('sha256').update(BLACK_PNG).digest('hex');
  const frame = await link.readFrame(async () => ({
    ok: true, id: 'f1', sha256: sha, mime: 'image/png', bytes: BLACK_PNG.length, chunks: 1, index: 0,
    data: BLACK_PNG.toString('base64'), deviceWidth: 1920, deviceHeight: 1080,
    protectedSurface: true, screenAsleep: false, activePackage: 'com.amazon.firetv.youtube.tv', activeActivity: 'MainActivity'
  }), '192.168.1.60:5555', 720, 'adb-frame');
  assert.equal(frame.protectedSurface, true);
  assert.equal(frame.activePackage, 'com.amazon.firetv.youtube.tv');

  let fetchCount = 0;
  const rdp = link.createRdpClient({ fetchImpl: async () => { fetchCount += 1; return { ok: true, json: async () => ({ sessions: [] }) }; } });
  const listed = await rdp.list();
  assert.deepEqual(listed, []);
  assert.equal(fetchCount, 0);
});

async function assertPinnedStudioRail(page) {
  const railMetrics = await page.evaluate(() => {
    const rail = document.getElementById('sideColumn');
    const composer = document.getElementById('conciergeComposer');
    const railRect = rail.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    return {
      railWidth: Math.round(railRect.width),
      bottomGap: railRect.bottom - composerRect.bottom,
      scrollHeight: rail.scrollHeight,
      clientHeight: rail.clientHeight,
      deviceOptions: document.querySelectorAll('#sessionDeviceSelect option').length
    };
  });
  assert.ok(Math.abs(railMetrics.railWidth - 340) <= 2, `expected 340px rail, got ${railMetrics.railWidth}`);
  assert.ok(railMetrics.bottomGap >= 0 && railMetrics.bottomGap <= 20, `expected composer pinned <=20px from bottom, got ${railMetrics.bottomGap}`);
  assert.ok(railMetrics.scrollHeight <= railMetrics.clientHeight + 2, `expected zero outer rail scrollbar (${railMetrics.scrollHeight} vs ${railMetrics.clientHeight})`);
  assert.equal(railMetrics.deviceOptions, 3);

  await page.locator('#railTabControls').click();
  assert.equal(await page.locator('#railControlsPane').isHidden(), false);
  assert.equal(await page.locator('#railConciergePane').isHidden(), true);
  await page.locator('#railTabConcierge').click();
  assert.equal(await page.locator('#railConciergePane').isHidden(), false);
  await page.locator('#closeConciergeRailBtn').click();
  assert.equal(await page.locator('#sideColumn').isHidden(), true);
  await page.locator('#toggleConciergeBtn').click();
  assert.equal(await page.locator('#sideColumn').isHidden(), false);
}

test('iPhone AI Office studio workspace (1440x900): pinned-bottom composer (<=20px), zero rail scrollbar, Controls | Concierge tabs, × close, Sync, Full screen + Esc, and pre-mirror touchpad swipe', async () => {
  state.rdpHits = 0;
  state.bridgeCalls = [];
  const consoleErrors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto(`${base}/api/phone-control/ui`, { waitUntil: 'networkidle' });
  assert.equal(state.rdpHits, 0, 'zero /api/rdp/sessions calls on default page load');

  await page.locator('#phoneRail .pc-rail-item', { hasText: "Roger's iPhone" }).click();
  assert.equal(await page.locator('#sessionMirrorBtn').isHidden(), false);
  assert.equal(await page.locator('#iosMirrorBar').isHidden(), true);
  assert.equal(await page.locator('#quickMirrorBtn').isHidden(), true);
  assert.equal((await page.locator('#sessionMirrorBtn').textContent()).trim(), 'Start mirroring');
  await page.waitForFunction(() => (document.getElementById('iosStageGuide')?.textContent || '').includes('OSHAL Mirror (Spark)'));
  assert.equal(await page.locator('#iosStageGuide').isHidden(), false);
  assert.match(await page.locator('#iosStageGuide').textContent(), /Step 1 \(See Screen\)/);
  assert.match(await page.locator('#iosStageGuide').textContent(), /OSHAL-KB/);
  assert.match(await page.locator('#iosStageGuide').textContent(), /AssistiveTouch/);

  await assertPinnedStudioRail(page);

  await page.locator('#syncDeviceBtn').click();
  await page.waitForFunction(() => (document.getElementById('stageStatus')?.textContent || '').includes('Synced with iPhone'));
  assert.ok(state.bridgeCalls.some((c) => c.verb === 'ble-sync' && c.args.address === '7C:4B:26:2B:6C:02'));

  await page.locator('#fullscreenStageBtn').click();
  assert.equal(await page.locator('#stageCard').evaluate((el) => el.classList.contains('is-fullscreen')), true);
  assert.equal(await page.locator('#fullscreenHud').isHidden(), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#stageCard').evaluate((el) => el.classList.contains('is-fullscreen')), false);
  assert.equal(await page.locator('#fullscreenHud').isHidden(), true);

  const box = await page.locator('#deviceFrame').boundingBox();
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => /Swipe .*done\./.test(document.getElementById('stageStatus')?.textContent || ''));
  assert.ok(state.bridgeCalls.some((c) => c.verb === 'ble-swipe' && c.args.address === '7C:4B:26:2B:6C:02'));
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test('Fire TV session displays protectedSurface notice on DRM black frame, supports keyboard navigation + fast frame wakeup, and clears notice on Home', async () => {
  state.bridgeCalls = [];
  state.tvProtected = true;
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  await page.goto(`${base}/api/phone-control/ui`, { waitUntil: 'networkidle' });
  await page.locator('#phoneRail .pc-rail-item', { hasText: 'Living Room Fire TV' }).click();

  await page.waitForFunction(() => !document.getElementById('protectedSurfaceNotice')?.hidden);
  assert.match(await page.locator('#protectedSurfaceTitle').textContent(), /com\.amazon\.firetv\.youtube\.tv/);
  assert.equal(await page.locator('#tvRemote').isHidden(), false);

  await page.locator('#deviceFrame').focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => (document.getElementById('stageStatus')?.textContent || '').includes('Down: done.'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (document.getElementById('stageStatus')?.textContent || '').includes('OK: done.'));
  assert.ok(state.bridgeCalls.some((c) => c.verb === 'adb-key' && c.args.key === 'DOWN'));
  assert.ok(state.bridgeCalls.some((c) => c.verb === 'adb-key' && c.args.key === 'OK'));

  const beforeHomeFrames = state.bridgeCalls.filter((c) => c.verb === 'adb-frame').length;
  const sentAt = Date.now();
  await page.locator('#protectedGoHomeBtn').click();
  await page.waitForFunction(() => document.getElementById('protectedSurfaceNotice')?.hidden === true);
  const fastElapsed = Date.now() - sentAt;
  assert.ok(fastElapsed < 1100, `expected fast frame refresh after Go to TV Home, took ${fastElapsed}ms`);
  assert.ok(state.bridgeCalls.filter((c) => c.verb === 'adb-frame').length > beforeHomeFrames);
  await page.close();
});

test('Add a device shows iPhone vs Android guide, Samsung Auto Blocker pairing steps, and prefills host IP after adb-pair when mDNS is absent', async () => {
  state.bridgeCalls = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  await page.addInitScript(() => { window.__PC_PAIR_SETTLE_MS = 30; });
  await page.goto(`${base}/api/phone-control/config/ui`, { waitUntil: 'networkidle' });

  await page.locator('#computersBody button', { hasText: 'Use this computer' }).click();
  assert.equal(await page.locator('#deviceKindGuide').isHidden(), false);
  assert.match(await page.locator('#androidPairingSteps').textContent(), /Auto Blocker/);
  assert.match(await page.locator('#androidPairingSteps').textContent(), /words “Wireless debugging” on the left side/);

  await page.locator('#pushAndroidApkBtn').click();
  await page.waitForFunction(() => (document.getElementById('androidStatus')?.textContent || '').includes('Connect your Android phone'));
  assert.equal(state.bridgeCalls.some((c) => c.verb === 'adb-install-apk'), false, 'never installs Fire TV APK onto already-connected Fire TV');

  await page.locator('#connectAddress').fill('192.168.1.70');
  await page.locator('#pushAndroidApkBtn').click();
  await page.waitForFunction(() => (document.getElementById('androidStatus')?.textContent || '').includes('No Android Orbit APK is staged'));
  assert.equal(state.bridgeCalls.some((c) => c.verb === 'adb-install-apk'), false, 'never substitutes Fire TV APK when Orbit APK is absent');
  await page.locator('#connectAddress').fill('');

  await page.locator('#pairAddress').fill('192.168.1.42:37123');
  await page.locator('#pairCode').fill('654321');
  await page.locator('#pairSend').click();
  await page.waitForFunction(() => (document.getElementById('androidStatus')?.textContent || '').includes('192.168.1.42:_____'));
  assert.equal(await page.locator('#connectAddress').inputValue(), '192.168.1.42:');
  assert.ok(state.bridgeCalls.some((c) => c.verb === 'adb-connect' && c.args.host === '192.168.1.42'));
  assert.equal(state.bridgeCalls.some((c) => c.verb === 'adb-info' && c.args.serial === '192.168.1.60:5555'), false, 'must never grab already-connected Fire TV');

  state.bridgeCalls = [];
  await page.locator('#connectAddress').fill('');
  await page.locator('#pairAddress').fill('192.168.1.70:37123');
  await page.locator('#pairCode').fill('654321');
  await page.locator('#pairSend').click();
  await page.waitForFunction(() => (document.getElementById('stageTitle')?.textContent || '') === 'samsung SM-S936U');
  assert.ok(state.bridgeCalls.some((c) => c.verb === 'adb-connect' && c.args.host === '192.168.1.70'));
  assert.ok(state.bridgeCalls.some((c) => c.verb === 'adb-info' && c.args.serial === '192.168.1.70:36007'));
  await page.close();
});
