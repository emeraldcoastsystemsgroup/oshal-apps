/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | home 1.9.4: Chromium browser tests at 412 x 915 and 1440 x 900 for Roku and Samsung TV card application controls (last-reported in-front app, What's in front, List apps, Samsung application picker, bounded listed-app launch buttons without contentId, Android/Cast exclusion, hostile textContent XSS safety, refusal handling, 44px touch targets and zero horizontal overflow).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { playwright, openPage, overflow } = require('./phone-fixture.cjs');

const HOME = path.resolve(__dirname, '../..');
const PHONE = path.resolve(HOME, '../phone-control');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'home-tv-apps-card-'));
process.env.OSHAL_HOME_DATA_DIR = DATA;
const lan = require(path.join(HOME, 'routes', 'home-lan-devices.js'));
const MANIFEST = require(path.join(PHONE, 'lib', 'bridge-files.js')).bridgeManifest(PHONE);

const FILES = {
  '/api/home/ui': path.join(HOME, 'tools', 'home.html'),
  '/api/home/ui/home-tvs.js': path.join(HOME, 'tools', 'home-tvs.js'),
  '/api/phone-control/ui/computer-link.js': path.join(PHONE, 'tools', 'computer-link.js'),
  '/api/phone-control/ui/phone-rdp.js': path.join(PHONE, 'tools', 'phone-rdp.js'),
};

const DEN_PC = {
  id: '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f',
  name: 'Den PC',
  platform: 'linux',
  connected: true,
  can_control: true,
  tools: ['shell.exec'],
  busy: false,
};
const VERSION = {
  ok: true,
  verb: 'version',
  version: MANIFEST.version,
  files: Object.fromEntries(MANIFEST.files.map((f) => [f.name, f.sha256])),
};
const APPS_LIST = { apps: [{ name: 'home', authorized: true }, { name: 'phone-control', authorized: true, accessChanged: false }] };
const line = (value) => ({ ok: true, output: { stdout: `${JSON.stringify(value)}\n`, stderr: '', exitCode: 0 } });
const decodeCommand = (command) => JSON.parse(Buffer.from(command.split(' ').pop(), 'base64').toString('utf8'));

function baseReads(sub) {
  return {
    '/api/swarm/apps': APPS_LIST,
    '/api/home/devices': { deviceCount: 0, devices: [], empty: true, generatedAt: null, hubs: [] },
    '/api/home/scenes': { scenes: [] },
    '/api/home/schedules': { schedules: [] },
    '/api/home/operations-guide': { ok: true, playbooks: [], entries: [], discoveredDevices: [] },
    '/api/home/lan/devices': { ok: true, ...lan.readLan(sub) },
    '/api/computers': { computers: [DEN_PC] },
    '/api/phone-control/bridge/manifest.json': MANIFEST,
    '/api/phone-control/devices': { devices: [] },
  };
}

function seedDevices(sub, tvs) {
  lan.writeLan(sub, { tvs, lastScan: { at: '2026-11-21T10:00:00.000Z', ok: true, found: tvs.length, computer: { id: DEN_PC.id, name: DEN_PC.name }, error: null, message: `Found ${tvs.length}.` } });
}

async function openTvsPage(browser, viewport, sub, responder) {
  const errors = [];
  const pageErrors = [];
  const ran = [];
  const planCalls = [];
  const onPage = (page) => {
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(err.message));
  };
  const opened = await openPage(browser, viewport, { url: '/api/home/ui', files: FILES, reads: baseReads(sub), onPage });
  const { page } = opened;
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const body = (route) => JSON.parse(route.request().postData() || '{}');
  await page.route('**/api/home/lan/control-plan', (route) => {
    const reqBody = body(route);
    planCalls.push(reqBody);
    const ans = lan.planControl(sub, reqBody, 'home.test');
    return json(route, ans.status, ans.body);
  });
  await page.route('**/api/home/lan/record', (route) => {
    const ans = lan.recordAnswer(sub, body(route));
    return json(route, ans.status, ans.body);
  });
  await page.route(/\/api\/computers\/[^/]+\/run$/, (route) => {
    const command = body(route).arguments.command;
    ran.push(command);
    if (/oshal_phone_bridge\.py" version /.test(command)) return json(route, 200, line(VERSION));
    if (command.startsWith("python3 -I -c '")) return json(route, 200, line({ ok: true, verb: 'install', version: MANIFEST.version, installed: MANIFEST.files.map((f) => f.name) }));
    const args = decodeCommand(command);
    return json(route, 200, line(responder(args, command)));
  });
  await page.locator('#tiles-tv .tile[data-kind="find"]').click();
  await page.waitForSelector('#page-tvs:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#tvList .tv-card').length > 0);
  return { ...opened, errors, pageErrors, ran, planCalls };
}

async function assertTouchTargets(locator) {
  const boxes = await locator.evaluateAll((nodes) => nodes.map((n) => {
    const r = n.getBoundingClientRect();
    return { label: n.getAttribute('aria-label') || n.textContent.trim(), width: r.width, height: r.height };
  }));
  assert.ok(boxes.length > 0, 'expected interactive controls to measure');
  for (const box of boxes) {
    assert.ok(box.height >= 44 && box.width >= 44, `touch target too small (${box.label}): ${box.width}x${box.height}`);
  }
}

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('412x915 Roku card shows last in-front app, updates via What\'s in front, launches Plex, and refreshes listed apps', async () => {
  const sub = 'roku-card-phone';
  seedDevices(sub, [{
    id: 'tv-02005e405060',
    name: 'Guest room stick',
    kind: 'roku',
    address: '10.20.30.41',
    mac: '02:00:5e:40:50:60',
    model: 'Roku Streaming Stick',
    os: 'Roku OS',
    room: 'Guest room',
    controllable: true,
    power: 'on',
    computer: { id: DEN_PC.id, name: DEN_PC.name },
    adb: null,
    samsung: null,
    steps: null,
    lastSeenAt: '2026-11-21T10:00:00.000Z',
    lastResult: null,
    apps: [{ id: '12', name: 'Netflix' }, { id: '837', name: 'YouTube' }, { id: '13535', name: 'Plex' }],
    appsAt: '2026-11-21T10:00:00.000Z',
    front: { id: '837', name: 'YouTube', inFront: true, running: true, screensaver: null, player: null, at: '2026-11-21T10:00:00.000Z' },
  }]);

  const { page, context, errors, pageErrors, ran } = await openTvsPage(browser, { width: 412, height: 915 }, sub, (args) => {
    if (args.action === 'active_app') {
      return { ok: true, verb: 'lan-control', kind: 'roku', address: args.address, action: 'active_app', sent: true,
        front: { id: '12', name: 'Netflix', home: false, screensaver: null }, player: { state: 'pause' } };
    }
    if (args.action === 'launch_app') {
      return { ok: true, verb: 'lan-control', kind: 'roku', address: args.address, action: 'launch_app', sent: true,
        app: { id: args.app, name: 'Plex' }, front: { id: args.app, name: 'Plex', home: false, screensaver: null }, inFront: true };
    }
    if (args.action === 'list_apps') {
      return { ok: true, verb: 'lan-control', kind: 'roku', address: args.address, action: 'list_apps', sent: true,
        apps: [{ id: '12', name: 'Netflix' }, { id: '837', name: 'YouTube' }, { id: '13535', name: 'Plex' }, { id: '2285', name: 'Hulu' }] };
    }
    return { ok: true, verb: 'lan-control', kind: 'roku', address: args.address, action: args.action, sent: true };
  });

  try {
    const card = page.locator('[data-tv="tv-02005e405060"]');
    assert.match(await card.locator('.tv-front').textContent(), /^In front: YouTube\b/);
    assert.deepEqual(await card.locator('.tv-apps-actions button').allTextContents(), ["What's in front", 'List apps']);
    assert.deepEqual(await card.locator('.tv-app-btn').allTextContents(), ['Netflix', 'YouTube', 'Plex']);
    await assertTouchTargets(card.locator('.tv-apps button'));

    await card.getByRole('button', { name: 'What is in front on Guest room stick' }).tap();
    await page.waitForFunction(() => /^In front: Netflix · paused\b/.test(document.querySelector('[data-tv="tv-02005e405060"] .tv-front')?.textContent || ''));
    assert.match(await card.locator('.tv-result').textContent(), /On Guest room stick, Netflix is in front, its player paused\./);

    await card.getByRole('button', { name: 'Open Plex on Guest room stick' }).tap();
    await page.waitForFunction(() => /^In front: Plex\b/.test(document.querySelector('[data-tv="tv-02005e405060"] .tv-front')?.textContent || ''));
    assert.equal(await card.locator('.tv-result').textContent(), 'Plex is in front on Guest room stick.');

    await card.getByRole('button', { name: 'List apps on Guest room stick' }).tap();
    await page.waitForFunction(() => document.querySelectorAll('[data-tv="tv-02005e405060"] .tv-app-btn').length === 4);
    assert.deepEqual(await card.locator('.tv-app-btn').allTextContents(), ['Netflix', 'YouTube', 'Plex', 'Hulu']);

    const sent = ran.filter((c) => / lan-control --b64 /.test(c)).map(decodeCommand);
    assert.deepEqual(sent.map((a) => ({ action: a.action, app: a.app, hasContentId: 'contentId' in a })), [
      { action: 'active_app', app: undefined, hasContentId: false },
      { action: 'launch_app', app: '13535', hasContentId: false },
      { action: 'list_apps', app: undefined, hasContentId: false },
    ]);

    const fit = await overflow(page);
    assert.ok(fit.scrollWidth <= fit.clientWidth, `horizontal overflow at 412x915: ${fit.scrollWidth} > ${fit.clientWidth} (${fit.offenders.join(', ')})`);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('412x915 Samsung card guards empty active_app, lists apps, checks a chosen app, and launches without contentId', async () => {
  const sub = 'samsung-card-phone';
  seedDevices(sub, [{
    id: 'tv-02005e102030',
    name: 'Den TV',
    kind: 'samsung-tizen',
    address: '10.20.30.40',
    mac: '02:00:5e:10:20:30',
    model: 'QN00TEST',
    os: 'Tizen',
    room: 'Den',
    controllable: true,
    power: 'on',
    computer: { id: DEN_PC.id, name: DEN_PC.name },
    adb: null,
    samsung: { paired: true },
    steps: null,
    lastSeenAt: '2026-11-21T10:00:00.000Z',
    lastResult: null,
    apps: null,
    front: null,
  }]);

  const { page, context, errors, pageErrors, ran, planCalls } = await openTvsPage(browser, { width: 412, height: 915 }, sub, (args) => {
    if (args.action === 'list_apps') {
      return { ok: true, verb: 'lan-control', kind: 'samsung-tizen', address: args.address, action: 'list_apps', sent: true,
        apps: [{ id: '11101200001', name: 'Netflix' }, { id: '111299001912', name: 'YouTube' }, { id: '3201512006963', name: 'Plex' }] };
    }
    if (args.action === 'active_app') {
      return { ok: true, verb: 'lan-control', kind: 'samsung-tizen', address: args.address, action: 'active_app', sent: true,
        app: { id: args.app, name: args.app === '11101200001' ? 'Netflix' : 'YouTube' }, running: true, visible: true, inFront: true, via: 'rest' };
    }
    if (args.action === 'launch_app') {
      return { ok: true, verb: 'lan-control', kind: 'samsung-tizen', address: args.address, action: 'launch_app', sent: true,
        app: { id: args.app, name: 'Plex' }, running: true, visible: true, inFront: true, via: 'rest' };
    }
    return { ok: true, verb: 'lan-control', kind: 'samsung-tizen', address: args.address, action: args.action, sent: true };
  });

  try {
    const card = page.locator('[data-tv="tv-02005e102030"]');
    assert.equal(await card.locator('.tv-front').textContent(), 'In front: not checked yet');

    // Pressing What's in front before any apps are listed must NOT send a broken empty request.
    await card.getByRole('button', { name: 'What is in front on Den TV' }).tap();
    assert.match(await card.locator('.tv-result').textContent(), /Press List apps first/);
    assert.equal(planCalls.length, 0, 'no empty active_app request sent for Samsung TV');

    await card.getByRole('button', { name: 'List apps on Den TV' }).tap();
    await page.waitForFunction(() => document.querySelectorAll('[data-tv="tv-02005e102030"] .tv-app-btn').length === 3);
    assert.deepEqual(await card.locator('.tv-app-btn').allTextContents(), ['Netflix', 'YouTube', 'Plex']);

    const picker = card.locator('.tv-app-select');
    await picker.selectOption('11101200001');
    await card.getByRole('button', { name: 'What is in front on Den TV' }).tap();
    await page.waitForFunction(() => /^In front: Netflix\b/.test(document.querySelector('[data-tv="tv-02005e102030"] .tv-front')?.textContent || ''));
    assert.equal(await card.locator('.tv-result').textContent(), 'On Den TV, Netflix is running and in front.');

    await card.getByRole('button', { name: 'Open Plex on Den TV' }).tap();
    await page.waitForFunction(() => /^In front: Plex\b/.test(document.querySelector('[data-tv="tv-02005e102030"] .tv-front')?.textContent || ''));
    assert.equal(await card.locator('.tv-result').textContent(), 'Plex is running and in front on Den TV.');

    await assertTouchTargets(card.locator('.tv-apps button, .tv-apps select'));

    const sent = ran.filter((c) => / lan-control --b64 /.test(c)).map(decodeCommand);
    assert.deepEqual(sent.map((a) => ({ action: a.action, app: a.app, hasContentId: 'contentId' in a })), [
      { action: 'list_apps', app: undefined, hasContentId: false },
      { action: 'active_app', app: '11101200001', hasContentId: false },
      { action: 'launch_app', app: '3201512006963', hasContentId: false },
    ]);

    const fit = await overflow(page);
    assert.ok(fit.scrollWidth <= fit.clientWidth, `horizontal overflow at 412x915: ${fit.scrollWidth} > ${fit.clientWidth} (${fit.offenders.join(', ')})`);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Android/Cast cards omit app controls, hostile app names stay textContent, 40 apps stay bounded, and 1440x900 works cleanly', async () => {
  const sub = 'mixed-safety-bounds';
  const hostile = '<img src=x onerror=window.__xss=1>';
  const manyApps = [
    { id: '12', name: hostile },
    ...Array.from({ length: 39 }, (_, index) => ({ id: String(1000 + index), name: `Channel ${index + 1}` })),
  ];
  seedDevices(sub, [
    {
      id: 'tv-02005e405060', name: 'Guest room stick', kind: 'roku', address: '10.20.30.41', mac: '02:00:5e:40:50:60',
      model: 'Roku', os: 'Roku OS', room: 'Guest room', controllable: true, power: 'on', computer: { id: DEN_PC.id, name: DEN_PC.name },
      adb: null, samsung: null, steps: null, lastSeenAt: '2026-11-21T10:00:00.000Z', lastResult: null,
      apps: manyApps, appsAt: '2026-11-21T10:00:00.000Z',
      front: { id: '12', name: hostile, inFront: true, running: true, screensaver: null, player: null, at: '2026-11-21T10:00:00.000Z' },
    },
    {
      id: 'tv-ip-10-20-30-42', name: 'Shed TV', kind: 'android-tv', address: '10.20.30.42', mac: null,
      model: 'Fire TV', os: 'Android', room: 'Shed', controllable: true, power: 'on', computer: { id: DEN_PC.id, name: DEN_PC.name },
      adb: { state: 'device', appVersionCode: 709, appInstalled: true }, samsung: null, steps: null, lastSeenAt: '2026-11-21T10:00:00.000Z', lastResult: null,
    },
    {
      id: 'tv-ip-10-20-30-43', name: 'Hall screen', kind: 'cast', address: '10.20.30.43', mac: null,
      model: 'Nest Hub', os: null, room: 'Hall', controllable: false, power: null, computer: { id: DEN_PC.id, name: DEN_PC.name },
      adb: null, samsung: null, steps: null, lastSeenAt: '2026-11-21T10:00:00.000Z', lastResult: null,
    },
  ]);

  const responder = (args) => {
    if (args.action === 'active_app') {
      return { ok: true, verb: 'lan-control', kind: 'roku', address: args.address, action: 'active_app', sent: true,
        front: { id: '1005', name: 'Channel 6', home: false, screensaver: null }, player: { state: 'play' } };
    }
    if (args.action === 'launch_app') {
      return { ok: false, error: 'tv_not_answering', message: 'The TV did not answer.' };
    }
    return { ok: true, verb: 'lan-control', kind: args.kind, address: args.address, action: args.action, sent: true };
  };

  for (const viewport of [{ width: 412, height: 915 }, { width: 1440, height: 900 }]) {
    const { page, context, errors, pageErrors } = await openTvsPage(browser, viewport, sub, responder);
    try {
      // Android TV & Cast cards must have ZERO app controls.
      for (const id of ['tv-ip-10-20-30-42', 'tv-ip-10-20-30-43']) {
        const card = page.locator(`[data-tv="${id}"]`);
        assert.equal(await card.locator('.tv-apps, [data-action="active_app"], [data-action="list_apps"], [data-action="launch_app"]').count(), 0, `${id} has no app controls`);
      }

      // Hostile app name stays strictly textContent with zero XSS execution.
      const roku = page.locator('[data-tv="tv-02005e405060"]');
      assert.equal(await page.evaluate(() => window.__xss), undefined, 'no XSS executed');
      assert.equal(await page.locator('#tvList img').count(), 0, 'no injected img element');
      assert.ok((await roku.locator('.tv-front').textContent()).includes(hostile));
      assert.equal(await roku.locator('.tv-app-btn').first().textContent(), hostile);

      // 40 apps are bounded initially to 8 with filter and Show all 40 apps toggle.
      assert.equal(await roku.locator('.tv-app-btn').count(), 8);
      assert.equal(await roku.locator('.tv-apps-toggle').textContent(), 'Show all 40 apps');
      await roku.locator('.tv-apps-toggle').click();
      assert.equal(await roku.locator('.tv-app-btn').count(), 40);
      assert.equal(await roku.locator('.tv-apps-toggle').textContent(), 'Show fewer apps');

      // Refusal handling renders cleanly without uncaught errors.
      await roku.locator('.tv-app-btn').nth(1).click();
      await page.waitForFunction(() => /The TV did not answer/.test(document.querySelector('[data-tv="tv-02005e405060"] .tv-result')?.textContent || ''));
      assert.ok(await roku.locator('.tv-result button', { hasText: 'Retry' }).isVisible());

      if (viewport.width === 1440) {
        await roku.getByRole('button', { name: 'What is in front on Guest room stick' }).click();
        await page.waitForFunction(() => /^In front: Channel 6 · playing\b/.test(document.querySelector('[data-tv="tv-02005e405060"] .tv-front')?.textContent || ''));
      }

      const fit = await overflow(page);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `horizontal overflow at ${viewport.width}x${viewport.height}: ${fit.scrollWidth} > ${fit.clientWidth} (${fit.offenders.join(', ')})`);
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});
