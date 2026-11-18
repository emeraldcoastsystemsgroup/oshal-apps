/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Phone & Device Control 1.20.3 (Roger, 2026-11-16/17: one concierge chat window everywhere):
 *     |                                         | verify in Chromium at 1440x900 and 412x915 (touch) over the real
 *     |                                         | phone-control router and a kernel platform export that (1) Device Concierge
 *     |                                         | (#phoneConciergeWindow iframe.jarvis-chat-frame) and Connection Concierge
 *     |                                         | (#connectConciergeWindow iframe.jarvis-chat-frame) mount the kernel's one
 *     |                                         | chat window as phone-control / device-concierge with model menu, conversations,
 *     |                                         | Files, Tap to talk and Keep trying, pass live screen_state, and send zero
 *     |                                         | POST /api/phone-control/concierge/turn; and (2) Phone & Device Control inside
 *     |                                         | Today (/cockpit/?app=phone-control&screen=phone-control-execution) opens the
 *     |                                         | one chat window with device-concierge.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-control-one-window-'));
process.env.OSHAL_PACKAGE_DATA_DIR = work;

const store = require(path.join(PKG, 'lib', 'db.js'));
const { bridgeManifest } = require(path.join(PKG, 'lib', 'bridge-files.js'));
const { createPhoneControlRoutes } = require(path.join(PKG, 'routes', 'phone-control-routes.js'));

const SESSION_WINDOW = '#phoneConciergeWindow iframe.jarvis-chat-frame';
const CONNECT_WINDOW = '#connectConciergeWindow iframe.jarvis-chat-frame';
const BOT_ID = 'f518c3e9-92a4-47d6-85c1-d827a93c1058';
const ANSWER = 'Hallway Fire TV is connected through Desk Linux.';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const COMPUTER = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Desk Linux',
  platform: 'linux',
  connected: true,
  can_control: true,
  tools: ['shell.exec', 'desktop.control', 'app.open']
});

let helper, todayHost, fixture, browser;

function answerTurn(ask) {
  const validBot = ask.bot === 'device-concierge' || ask.bot === BOT_ID;
  if (!validBot || ask.context?.app !== 'phone-control') return 'Wrong application.';
  return ANSWER;
}

function bridgeReply(cmd, manifest) {
  const sha256 = crypto.createHash('sha256').update(PNG_1X1).digest('hex');
  if (cmd.includes(' adb-frame ')) {
    return {
      ok: true, verb: 'adb-frame', id: sha256.slice(0, 16), sha256, mime: 'image/png',
      bytes: PNG_1X1.length, chunks: 1, index: 0, data: PNG_1X1.toString('base64'),
      deviceWidth: 1920, deviceHeight: 1080, slow: false
    };
  }
  if (cmd.includes(' adb-apps ')) return { ok: true, verb: 'adb-apps', apps: ['com.oshal.remote'] };
  if (cmd.includes(' version ')) {
    return {
      ok: true, verb: 'version', version: manifest.version,
      files: Object.fromEntries(manifest.files.map((f) => [f.name, f.sha256]))
    };
  }
  if (cmd.includes(' status ')) {
    return {
      ok: true, verb: 'status', version: manifest.version,
      adb: { ready: true, version: '34.0.4', devices: [{ serial: '192.0.2.60:5555', state: 'device' }] },
      bluetooth: { ready: true, address: '02:00:00:00:00:AA' },
      ble: { registered: true, advertising: true, phones: [] },
      mirror: { ready: true, running: false, hasFrame: false, message: 'Idle' },
      ffmpeg: true, readAt: Date.now()
    };
  }
  return { ok: true, sent: true };
}

function attachMockHostRoutes(web, manifest) {
  web.get('/ui/kernel/table.js', (_req, res) => res.type('application/javascript').send(''));
  web.get('/ui/kernel/:file', (_req, res) => res.type('text/css').send(':root {}'));
  web.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [] }));
  web.get('/api/devices/downloads', (_req, res) => res.json({ downloads: [] }));
  web.get('/api/computers', (_req, res) => res.json({ computers: [COMPUTER] }));
  web.get('/api/computers/:id/screen', (_req, res) => res.type('image/png').send(PNG_1X1));
  web.post('/api/computers/:id/run', (req, res) => {
    const cmd = String(req.body?.arguments?.command || '');
    const line = JSON.stringify(bridgeReply(cmd, manifest));
    res.json({ ok: true, output: { stdout: `${line}\n`, stderr: '', exitCode: 0 } });
  });
}

async function startFixture() {
  const express = helper.toolchain('express');
  const platform = helper.kernelPlatform(path.resolve(PKG, '..', '..', 'oshal-kernel', 'platform'));
  const kernel = helper.windowKernel({ answer: answerTurn });
  const manifest = bridgeManifest(PKG);
  const db = store.getDatabase(path.join(work, 'one-window.sqlite'));
  const actor = { issuer: 'https://issuer.example', sub: 'operator-window' };
  store.savePhone(db, actor, {
    name: 'Hallway Fire TV', platform: 'android', form: 'tv',
    computerNodeId: COMPUTER.id, address: '192.0.2.60:5555'
  });
  store.saveComputerReport(db, actor, COMPUTER.id, bridgeReply(' status ', manifest));
  const routes = createPhoneControlRoutes({
    appPackageDir: PKG, db,
    authorization: { currentActor: () => ({ isActive: true, ...actor }), registerResource() {} }
  });
  const posts = [];
  const web = express();
  web.use(express.json());
  helper.mountWindow(web, { platform, kernel });
  web.use((req, _res, next) => {
    if (req.method !== 'GET') posts.push({ method: req.method, path: req.path });
    next();
  });
  attachMockHostRoutes(web, manifest);
  web.use('/api/phone-control', (req, res, next) => {
    for (const key of ['path', 'query']) {
      Object.defineProperty(req, key, { value: req[key], writable: true, configurable: true });
    }
    routes.handle(req, res, next);
  });
  todayHost.mountToday(web, { platform, apps: ['phone-control'] });
  web.use((_req, res) => res.status(404).json({ error: 'fixture_route_unavailable' }));
  const server = await new Promise((resolve) => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    kernel,
    posts,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  };
}

test.before(async () => {
  helper = await import('../../scripts/one-chat-window/kernel-window.mjs');
  todayHost = await import('../../scripts/one-chat-window/today-host.mjs');
  fixture = await startFixture();
  browser = await helper.toolchain('playwright').chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  await fixture?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

async function openPage(urlPath, width, height) {
  const phone = width < 600;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  const errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (
    new URL(route.request().url()).origin === fixture.origin
      ? route.continue()
      : (outside.push(route.request().url()), route.abort())
  ));
  const press = phone ? (locator) => locator.tap() : (locator) => locator.click();
  await page.goto(`${fixture.origin}${urlPath}`);
  return { context, page, errors, outside, press };
}

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`${width}x${height}: Device Concierge mounts the kernel's one chat window as device-concierge and sends screen_state`, async () => {
    const { context, page, errors, outside, press } = await openPage('/api/phone-control/ui', width, height);
    try {
      const row = page.locator('.pc-rail .pc-rail-item', { hasText: 'Hallway Fire TV' }).first();
      await row.waitFor({ timeout: 15000 });
      await press(row);
      await page.locator('#screenImage:not([hidden])').waitFor({ timeout: 15000 });
      if (width < 600) {
        await press(page.locator('#sessionHandleBtn'));
        await page.locator('#sessionSheet:not([hidden])').waitFor({ timeout: 15000 });
      }
      await page.locator(SESSION_WINDOW).scrollIntoViewIfNeeded();
      const chat = await helper.chatWindow(page, SESSION_WINDOW);
      const addr = await todayHost.windowAddress(page, SESSION_WINDOW);
      assert.equal(addr.path, '/api/jarvis/');
      assert.equal(addr.app, 'phone-control');
      assert.equal(addr.bot, 'device-concierge');
      await helper.windowControls(chat);
      const pickedLabel = await helper.pickModel(chat, press, 'picked');
      assert.match(pickedLabel, /Picked model/);
      const { ask } = await helper.sendInWindow(chat, 'Which TV is connected?', press, fixture.kernel);
      assert.equal(ask.bot, 'device-concierge');
      assert.equal(ask.context.app, 'phone-control');
      assert.equal(ask.context.provider, 'picked');
      assert.equal(ask.context.model, 'picked-model');
      assert.equal(ask.context.screen_state.tab, 'TV Concierge');
      assert.equal(ask.context.screen_state.device.name, 'Hallway Fire TV');
      assert.match(ask.context.screen_state.text, /Hallway Fire TV/);
      assert.equal(await page.locator('#conciergeForm, #conciergeInput, #conciergeSendBtn').count(), 0);
      assert.deepEqual(fixture.posts.filter((p) => p.path === '/api/phone-control/concierge/turn'), []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual([errors, outside], [[], []]);
    } finally {
      await context.close();
    }
  });
}

test('Connect sheet Connection Concierge mounts the kernel\'s one chat window as device-concierge and sends setup screen_state', async () => {
  const { context, page, errors, outside, press } = await openPage('/api/phone-control/config/ui', 1280, 860);
  try {
    await page.locator('#tvAddress').waitFor({ timeout: 15000 });
    await page.locator('#tvAddress').fill('192.0.2.60');
    await press(page.locator('#connectConciergeCard'));
    await page.locator(CONNECT_WINDOW).scrollIntoViewIfNeeded();
    const chat = await helper.chatWindow(page, CONNECT_WINDOW);
    const addr = await todayHost.windowAddress(page, CONNECT_WINDOW);
    assert.equal(addr.path, '/api/jarvis/');
    assert.equal(addr.app, 'phone-control');
    assert.equal(addr.bot, 'device-concierge');
    await helper.windowControls(chat);
    const { ask } = await helper.sendInWindow(chat, 'Help me finish connecting this TV', press, fixture.kernel);
    assert.equal(ask.bot, 'device-concierge');
    assert.equal(ask.context.app, 'phone-control');
    assert.equal(ask.context.screen_state.tab, 'Add a device');
    assert.match(ask.context.screen_state.text, /\[field\] TV address: 192\.0\.2\.60/);
    assert.equal(await page.locator('#connectConciergeForm, #connectConciergeInput').count(), 0);
    assert.deepEqual(fixture.posts.filter((p) => p.path === '/api/phone-control/concierge/turn'), []);
    assert.deepEqual([errors, outside], [[], []]);
  } finally {
    await context.close();
  }
});

test('Today (/cockpit/?app=phone-control&screen=phone-control-execution): Phone & Device Control Concierge opens the one chat window with device-concierge', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${fixture.origin}/cockpit/?app=phone-control&screen=phone-control-execution`);
    const appFrame = page.frameLocator('.tool-view-container > iframe');
    await appFrame.locator('#addDeviceBtn').waitFor({ timeout: 15000 });
    const entries = todayHost.conciergeEntries(page);
    let opened = false;
    for (const entry of entries) {
      if (await entry.locator.isVisible().catch(() => false)) {
        await entry.locator.click();
        opened = true;
        break;
      }
    }
    assert.equal(opened, true, 'Today exposes a visible Concierge entry for Phone & Device Control');
    const chat = await helper.chatWindow(page, '#chatWorkspaceFrame');
    const addr = await todayHost.windowAddress(page, '#chatWorkspaceFrame');
    assert.equal(addr.path, '/api/jarvis/');
    assert.equal(addr.app, 'phone-control');
    assert.equal(addr.bot, BOT_ID);
    await helper.windowControls(chat);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
