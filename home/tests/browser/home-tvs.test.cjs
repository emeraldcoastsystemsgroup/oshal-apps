/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | home 1.4.0, TVs and streaming sticks in headless Chromium at 412 x 915: the section shows on the Smart Home screen with one Scan for TVs button that says what it does, the empty screen keeps its one primary and nothing is written on open; with no computer it says what to do and Scan is off; Scan checks the bridge on the chosen computer, installs it when it is not phone-control's (the real installer command), runs the real planned scan, saves the TVs and adds the Android TV to Phone & Device Control; a press says what the computer answered, "Press Allow on the TV, then Retry." for a waiting Samsung with the power left as it was; a Roku has no Open oshal; no console error. The computer is played by the test, the routes are the compiled package's own.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | home 1.6.0: the TVs are a page behind Home's Find TVs tile, so each case opens it the way a person does; Home shows a tile for every saved TV and for the person's computer, and asks Phone & Device Control for nothing when its access waits for re-approval.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | A person whose app list says Phone & Device Control changed and waits for re-approval (bare-metal blue's admin persona on 2026-11-08) reads exactly that, the page requests nothing from Phone & Device Control (no console error), Scan is off, and the saved TVs are still listed, without buttons.
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
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'home-tvs-ui-'));
process.env.OSHAL_HOME_DATA_DIR = DATA;
const lan = require(path.join(HOME, 'routes', 'home-lan-devices.js'));
const MANIFEST = require(path.join(PHONE, 'lib', 'bridge-files.js')).bridgeManifest(PHONE);
const FILES = {
  '/api/home/ui': path.join(HOME, 'tools', 'home.html'),
  '/api/home/ui/home-tvs.js': path.join(HOME, 'tools', 'home-tvs.js'),
  '/api/phone-control/ui/computer-link.js': path.join(PHONE, 'tools', 'computer-link.js'),
  '/api/phone-control/ui/phone-rdp.js': path.join(PHONE, 'tools', 'phone-rdp.js'),
};
const DEN_PC = { id: '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f', name: 'Den PC', platform: 'linux', connected: true, can_control: true, tools: ['shell.exec'], busy: false };
const FOUND = [
  { address: '10.20.30.40', kind: 'samsung-tizen', name: 'Den TV', power: 'on', mac: '02:00:5e:10:20:30', controllable: true, samsung: { tokenSaved: false } },
  { address: '10.20.30.41', kind: 'roku', name: 'Guest room stick', room: 'Guest room', mac: '02:00:5e:40:50:60', controllable: true },
  { address: '10.20.30.42', kind: 'android-tv', name: 'Shed TV', controllable: true, adb: { state: 'device', appVersionCode: null } },
  { address: '10.20.30.43', kind: 'cast', name: 'Hall screen', controllable: false },
];
const APPS = (phoneControl = { authorized: true, accessChanged: false }) => ({ apps: [{ name: 'home', authorized: true }, { name: 'phone-control', ...phoneControl }] });
const reads = (computers, sub, apps = APPS()) => ({
  '/api/swarm/apps': apps,
  '/api/home/devices': { deviceCount: 0, devices: [], empty: true, generatedAt: null, hubs: [] },
  '/api/home/scenes': { scenes: [] }, '/api/home/schedules': { schedules: [] },
  '/api/home/operations-guide': { ok: true, playbooks: [], entries: [], discoveredDevices: [] },
  '/api/home/lan/devices': { ok: true, ...lan.readLan(sub) },
  '/api/computers': { computers },
  '/api/phone-control/bridge/manifest.json': MANIFEST,
  '/api/phone-control/devices': { devices: [] },
});
const visible = (page, sel) => page.locator(sel).first().isVisible();
/** Open the TVs and streaming page the way a person does: Home's Find TVs tile. */
async function openTvs(page) {
  await page.locator('#tiles-tv .tile[data-kind="find"]').click();
  await page.waitForSelector('#page-tvs:not([hidden])');
}
const line = (value) => ({ ok: true, output: { stdout: `${JSON.stringify(value)}\n`, stderr: '', exitCode: 0 } });
const VERSION = { ok: true, verb: 'version', version: MANIFEST.version, files: Object.fromEntries(MANIFEST.files.map((f) => [f.name, f.sha256])) };

/** Plays the person's computer: the bridge's answers to the commands the page sends, and records each command. */
function computer(ran, { bridgeVersion = VERSION } = {}) {
  return (command) => {
    ran.push(command);
    if (/oshal_phone_bridge\.py" version /.test(command)) return line(bridgeVersion);
    if (command.startsWith("python3 -I -c '")) return line({ ok: true, verb: 'install', version: MANIFEST.version, installed: MANIFEST.files.map((f) => f.name) });
    if (/ lan-discover --b64 /.test(command)) return line({ ok: true, verb: 'lan-discover', found: FOUND, woke: [], subnets: ['10.20.30.0/24'] });
    const args = JSON.parse(Buffer.from(command.split(' ').pop(), 'base64').toString('utf8'));
    if (args.action === 'wake') return line({ ok: false, error: 'samsung_allow_on_tv', message: 'Press Allow on the TV, then Retry.' });
    return line({ ok: true, verb: 'lan-control', kind: args.kind, address: args.address, action: args.action, sent: true });
  };
}

/** The package's own routes for the page's writes, and the computer for /api/computers/<id>/run. */
async function wire(page, sub, play, saved) {
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const body = (route) => JSON.parse(route.request().postData() || '{}');
  await page.route('**/api/home/lan/discover-plan', (route) => { const a = lan.planDiscover(sub, body(route)); return json(route, a.status, a.body); });
  await page.route('**/api/home/lan/control-plan', (route) => { const a = lan.planControl(sub, body(route), 'home.test'); return json(route, a.status, a.body); });
  await page.route('**/api/home/lan/record', (route) => { const a = lan.recordAnswer(sub, body(route)); return json(route, a.status, a.body); });
  await page.route(/\/api\/computers\/[^/]+\/run$/, (route) => json(route, 200, play(body(route).arguments.command)));
  await page.route('**/api/phone-control/devices', (route) => (route.request().method() === 'POST'
    ? (saved.push(body(route)), json(route, 201, { device: { id: 'ph_1', ...body(route) }, created: true })) : route.fallback()));
}

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

async function open(viewport, computers, sub, apps) {
  const errors = [];
  const requested = [];
  const onPage = (page) => {
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  };
  const opened = await openPage(browser, viewport, { url: '/api/home/ui', files: FILES, reads: reads(computers, sub, apps), onPage });
  return { ...opened, errors, requested };
}

test('the section shows on the Smart Home screen with one Scan button that says what it does; nothing is written on open', async () => {
  const { page, context, writes, errors } = await open({ width: 412, height: 915 }, [DEN_PC], 'ui-empty');
  try {
    await openTvs(page);
    await page.waitForSelector('#tvSection:not([hidden])');
    await page.waitForFunction(() => document.querySelectorAll('#tvComputer option').length === 1);
    assert.equal(await page.textContent('#tv-title'), 'TVs and streaming');
    assert.equal(await page.textContent('#tvScan'), 'Scan for TVs');
    assert.equal(await page.isEnabled('#tvScan'), true);
    assert.match(await page.textContent('#tvScanWhat'), /looks for TVs and streaming sticks on its Wi-Fi.*Nothing is installed or changed on them\./);
    assert.equal(await page.textContent('#tvEmpty'), 'No TVs saved yet. Press Scan for TVs.');
    assert.equal(await page.textContent('#tvComputer option'), 'Den PC · Connected');
    for (const sel of ['#tvDevicesLink', '#tvComputerHelp']) assert.equal(await visible(page, sel), false, `${sel} is hidden with a usable computer`);
    assert.deepEqual(await page.locator('button.solid:visible, a.solid:visible').allTextContents(), ['Connect a hub'], 'the screen keeps one primary');
    const box = await page.locator('#tvScan').boundingBox();
    assert.ok(box.height >= 44, `Scan is ${box.height}px tall`);
    const fit = await overflow(page);
    assert.ok(fit.scrollWidth <= fit.clientWidth, `the page is ${fit.scrollWidth}px wide: ${fit.offenders.join(', ')}`);
    assert.deepEqual(writes, [], 'opening the page wrote nothing');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('with no computer the section says what to do and Scan is off', async () => {
  const offline = { ...DEN_PC, connected: false, can_control: false };
  for (const computers of [[], [{ ...offline, platform: 'android', name: 'Phone' }]]) {
    const { page, context, errors } = await open({ width: 412, height: 915 }, computers, 'ui-none');
    try {
      await openTvs(page);
      await page.waitForSelector('#tvComputerHelp:not([hidden])');
      assert.match(await page.textContent('#tvComputerHelp'), /^No computer of yours is connected\. TVs are found by your own computer on the same Wi-Fi/);
      assert.equal(await page.isDisabled('#tvScan'), true);
      assert.equal(await page.getAttribute('#tvDevicesLink', 'href'), '/devices');
      for (const sel of ['#tvComputer', '#tvComputerLabel']) assert.equal(await visible(page, sel), false, `${sel} is hidden with no computer`);
      assert.ok(await visible(page, '#tvDevicesLink'), 'the Devices page link shows with no computer');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('Scan installs the bridge when it is not phone-control\'s, saves the TVs, and each press says what the computer answered', async () => {
  const { page, context, errors } = await open({ width: 412, height: 915 }, [DEN_PC], 'ui-scan');
  const ran = [];
  const saved = [];
  try {
    await wire(page, 'ui-scan', computer(ran, { bridgeVersion: { ...VERSION, version: '1.4.1' } }), saved);
    await openTvs(page);
    await page.waitForFunction(() => document.querySelectorAll('#tvComputer option').length === 1);
    await page.locator('#tvScan').tap();
    await page.waitForFunction(() => document.querySelectorAll('#tvList .tv-card').length === 4);
    assert.match(ran[0], /oshal_phone_bridge\.py" version --b64 /);
    assert.match(ran[1], /^python3 -I -c '.*"oshal_phone_lan\.py":d/s, 'the old bridge is replaced with the real installer');
    assert.match(ran[2], / lan-discover --b64 /);
    assert.match(await page.textContent('#tvStatus'), /^Found Den TV, Guest room stick, Shed TV, Hall screen\. Added Shed TV to Phone & Device Control\.$/);
    assert.deepEqual(saved, [{ name: 'Shed TV', address: '10.20.30.42:5555', platform: 'android', form: 'tv', computerNodeId: DEN_PC.id }]);
    const den = page.locator('[data-tv="tv-02005e102030"]');
    await den.getByRole('button', { name: 'Volume up on Den TV' }).tap();
    await page.waitForFunction(() => /Volume up: done on Den TV\./.test(document.querySelector('[data-tv="tv-02005e102030"] .tv-result')?.textContent || ''));
    await page.locator('[data-tv="tv-02005e102030"]').getByRole('button', { name: 'Wake on Den TV' }).tap();
    await page.waitForFunction(() => /^Press Allow on the TV, then Retry\./.test(document.querySelector('[data-tv="tv-02005e102030"] .tv-result')?.textContent || ''));
    assert.ok(await page.locator('[data-tv="tv-02005e102030"] .tv-result button', { hasText: 'Retry' }).isVisible());
    assert.equal(await page.locator('[data-tv="tv-02005e102030"] .pill.on').textContent(), 'On', 'a refused wake left the power as the scan read it');
    const roku = page.locator('[data-tv="tv-02005e405060"]');
    assert.equal(await roku.getByRole('button', { name: /Open oshal/ }).count(), 0, 'a Roku cannot open a page');
    assert.match(await page.locator('[data-tv="tv-ip-10-20-30-43"]').textContent(), /A Google Cast device: your computer cannot press its buttons\./);
    assert.equal(await page.locator('[data-tv="tv-ip-10-20-30-42"]').getByRole('button', { name: 'Install the TV app on Shed TV' }).count(), 1);
    const fit = await overflow(page);
    assert.ok(fit.scrollWidth <= fit.clientWidth, `the page is ${fit.scrollWidth}px wide: ${fit.offenders.join(', ')}`);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a person whose Phone & Device Control waits for re-approval reads that, and nothing is asked of it', async () => {
  lan.recordAnswer('ui-changed', { op: 'discover', computer: { id: DEN_PC.id, name: DEN_PC.name }, reply: JSON.stringify({ ok: true, verb: 'lan-discover', found: FOUND.slice(0, 2) }) });
  const apps = APPS({ authorized: false, accessChanged: true });
  const { page, context, errors, requested, writes } = await open({ width: 412, height: 915 }, [DEN_PC], 'ui-changed', apps);
  try {
    await openTvs(page);
    await page.waitForFunction(() => /re-approve/.test(document.querySelector('#tvStatus')?.textContent || ''));
    assert.equal(await page.textContent('#tvStatus'), 'Finding TVs uses the Phone & Device Control helper on your computer. Phone & Device Control changed, and an administrator must re-approve your access to it.');
    assert.equal(await page.isDisabled('#tvScan'), true);
    for (const sel of ['#tvComputerLabel', '#tvComputer', '#tvDevicesLink', '#tvComputerHelp']) assert.equal(await visible(page, sel), false, `${sel} is hidden`);
    await page.waitForFunction(() => document.querySelectorAll('#tvList .tv-card').length === 2);
    assert.equal(await page.locator('#tvList .tv-card button').count(), 0, 'saved TVs are listed without buttons');
    assert.equal(await visible(page, '#tvEmpty'), false);
    assert.ok(!requested.some((p) => p.startsWith('/api/phone-control/')), `asked Phone & Device Control for ${requested.filter((p) => p.startsWith('/api/phone-control/')).join(', ')}`);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
