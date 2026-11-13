/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | home 1.6.0, Home as tiles in headless Chromium at 412 x 915 (Roger, 2026-11-10: "Smart home needs a redesign ... connected devices are smart home items, fire sticks are as well"). The first screen shows the refrigerator, the TVs, the switch cards, the person's phones and their computers in groups that fit the phone; no label on it names a provider key or a device capability; the refrigerator tile opens its page and Back returns; a phone or computer tile opens Phone & Device Control; a device known to both lists shows once; with Phone & Device Control waiting for re-approval it is asked for nothing and the tiles open the Devices page; opening the screen writes nothing.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The overview names its hub inventory count home devices so it does not imply the separately listed phones, computers and remotes are included.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { playwright, openPage, overflow } = require('./phone-fixture.cjs');

const HOME = path.resolve(__dirname, '../..');
const PHONE = path.resolve(HOME, '../phone-control');
const FILES = {
  '/api/home/ui': path.join(HOME, 'tools', 'home.html'),
  '/api/home/ui/home-tvs.js': path.join(HOME, 'tools', 'home-tvs.js'),
  '/api/phone-control/ui/computer-link.js': path.join(PHONE, 'tools', 'computer-link.js'),
  '/api/phone-control/ui/phone-rdp.js': path.join(PHONE, 'tools', 'phone-rdp.js'),
};
const PHONE_VIEW = { width: 412, height: 915 };
const DEVICES = [
  { key: 'fridge', name: 'Samsung Family Hub Refrigerator', switch: 'on', temperatureF: 37, capabilities: ['refrigeration', 'samsungce.viewInside'], sources: [{ hub: 'smartthings' }] },
  { key: 'lamp', name: 'Reading lamp', switch: 'off', capabilities: ['switch', 'switchLevel'], sources: [{ hub: 'smartthings' }] },
  { key: 'plug', name: 'Coffee plug', switch: 'on', capabilities: ['switch'], sources: [{ hub: 'swarm-local' }], protocol: 'lan-http' },
];
const COMPUTERS = [
  { id: 'c-1', name: 'Den PC', platform: 'linux', connected: true, can_control: true, tools: ['shell.exec'], bound: ['libreoffice-writer', 'chrome'] },
  { id: 'c-2', name: 'Attic laptop', platform: 'windows', connected: false, can_control: false, bound: [] },
  { id: 'c-3', name: 'Galaxy S25 (Android)', platform: 'android', connected: true, can_control: true },
  { id: 'c-4', name: 'Bedroom Fire TV', platform: 'android', connected: false, can_control: false },
];
const PAIRED = [
  { id: 'ph_1', name: 'Galaxy S25', platform: 'android', form: 'phone', address: '10.0.0.7:5555' },
  { id: 'ph_2', name: 'Kitchen iPhone', platform: 'ios', form: 'phone', address: 'AA:BB' },
  { id: 'ph_3', name: 'Garage stick', platform: 'android', form: 'tv', address: '10.0.0.9:5555' },
];
const APPS = (phoneControl = { authorized: true, accessChanged: false }) => ({ apps: [{ name: 'home', authorized: true }, { name: 'phone-control', ...phoneControl }] });
const reads = (apps = APPS()) => ({
  '/api/swarm/apps': apps,
  '/api/home/devices': { deviceCount: DEVICES.length, devices: DEVICES, hubs: ['smartthings', 'swarm-local'], generatedAt: '2026-11-10T22:00:00Z' },
  '/api/home/scenes': { scenes: [{ name: 'Movie night', steps: [{}, {}] }] }, '/api/home/schedules': { schedules: [] },
  '/api/home/operations-guide': { ok: true, playbooks: [], entries: [], discoveredDevices: [] },
  '/api/home/fridge-assessment': { ok: true },
  '/api/home/lan/devices': { ok: true, tvs: [{ id: 'tv-1', name: 'Den TV', kind: 'samsung-tizen', address: '10.20.30.40', controllable: true }] },
  '/api/computers': { computers: COMPUTERS },
  '/api/phone-control/devices': { devices: PAIRED },
  '/api/phone-control/bridge/manifest.json': { version: '1.5.2', files: [] },
});

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function open(apps) {
  const errors = [], requested = [];
  const onPage = (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  };
  const opened = await openPage(browser, PHONE_VIEW, { url: '/api/home/ui', files: FILES, reads: reads(apps), onPage });
  return { ...opened, errors, requested };
}
/** The tiles of one group as "name | state" lines, in the order shown. */
const tiles = (page, group) => page.locator(`#${group} .tile`).evaluateAll((nodes) => nodes.map((n) => `${n.querySelector('.tile-nm').textContent} | ${n.querySelector('.tile-st').textContent}`));

test('Home shows the refrigerator, TVs, switches, phones and computers as groups that fit a phone, in plain words', async () => {
  const { page, context, writes, errors } = await open();
  try {
    await page.waitForFunction(() => document.querySelectorAll('#tiles-computers .tile').length === 2 && document.querySelectorAll('#tiles-tv .tile').length === 4);
    assert.deepEqual(await tiles(page, 'tiles-kitchen'), ['Samsung Family Hub Refrigerator | 37°F']);
    assert.deepEqual(await tiles(page, 'tiles-tv'), [
      'Den TV | Open the remote', 'Bedroom Fire TV | Not connected', 'Garage stick | TV · paired through a computer',
      'Find TVs | Look for TVs and streaming sticks on this network',
    ]);
    assert.deepEqual(await tiles(page, 'tiles-phones'), ['Galaxy S25 | Connected', 'Kitchen iPhone | iPhone · paired through a computer'],
      'the phone in both lists shows once, from the list that knows it is connected');
    assert.deepEqual(await tiles(page, 'tiles-computers'), ['Den PC | Connected · 2 programs', 'Attic laptop | Not connected']);
    assert.deepEqual(await page.locator('#grid .card .nm').allTextContents(), ['Reading lamp', 'Coffee plug On this network'],
      'the switch cards are the devices with no tile of their own');
    assert.equal(await page.textContent('#count'), '3 home devices');
    assert.equal(await page.locator('#scenes .scene').count(), 1);
    for (const hidden of ['#fridgeCameraSection', '#tvSection', '#runbookSection', '#hubsPanel']) assert.equal(await page.isVisible(hidden), false, `${hidden} is not on the first screen`);

    const shown = await page.evaluate(() => document.querySelector('.wrap').innerText);
    for (const internal of [/samsungce/i, /viewInside/, /smartthings,/i, /swarm-local/i, /\$0 API/, /Operations Guide/i, /Optical Camera Bays/i]) {
      assert.ok(!internal.test(shown), `the first screen does not say ${internal}`);
    }
    const fit = await overflow(page);
    assert.ok(fit.scrollWidth <= fit.clientWidth, `the page is ${fit.scrollWidth}px wide in a ${fit.clientWidth}px screen: ${fit.offenders.join(', ')}`);
    assert.deepEqual(fit.offenders, []);
    for (const group of ['tiles-phones', 'tiles-computers']) {
      for (const tile of await page.locator(`#${group} .tile`).all()) {
        assert.equal(await tile.getAttribute('href'), '/cockpit/?app=phone-control');
        assert.equal(await tile.getAttribute('target'), '_top');
      }
    }
    assert.deepEqual(writes, [], 'opening Home wrote nothing');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a tile opens its page and Back returns to Home; Connections and Help and notes are at the foot of Home', async () => {
  const { page, context, errors } = await open();
  try {
    await page.locator('#tiles-kitchen .tile').click();
    await page.waitForSelector('#page-fridge:not([hidden])');
    assert.equal(await page.isVisible('#homeView'), false);
    assert.equal(await page.textContent('#page-fridge h2'), 'Refrigerator');
    assert.deepEqual(await page.locator('#page-fridge .fridge-actions .btn').allTextContents(),
      ['Look inside', 'Take new photos', 'Check what is inside now', 'Start a grocery list']);
    assert.equal(new URL(page.url()).hash, '#fridge');
    const fit = await overflow(page);
    assert.ok(fit.scrollWidth <= fit.clientWidth, `the refrigerator page is ${fit.scrollWidth}px wide in a ${fit.clientWidth}px screen: ${fit.offenders.join(', ')}`);
    await page.goBack();
    await page.waitForSelector('#homeView:not([hidden])');
    assert.equal(await page.isVisible('#page-fridge'), false);

    await page.locator('#tiles-tv .tile', { hasText: 'Den TV' }).click();
    await page.waitForSelector('#page-tvs:not([hidden])');
    await page.waitForFunction(() => document.querySelectorAll('#tvList .tv-card').length === 1);
    await page.locator('#page-tvs [data-page-back]').click();
    await page.waitForSelector('#homeView:not([hidden])');

    await page.locator('#homeFoot [data-open="help"]').click();
    await page.waitForSelector('#page-help:not([hidden])');
    assert.equal(await page.textContent('#page-help h2'), 'Help and notes');
    assert.equal(await page.textContent('#inspectAllBtn'), 'Read again what my devices can do');
    await page.goBack();
    await page.waitForSelector('#homeView:not([hidden])');
    await page.locator('#openConnections').click();
    await page.waitForSelector('#hubsPanel:not([hidden])');
    assert.equal(await page.textContent('#hubs-title'), 'Connections');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('with Phone & Device Control waiting for re-approval it is asked for nothing, and the tiles open the Devices page', async () => {
  const { page, context, requested, errors } = await open(APPS({ authorized: false, accessChanged: true }));
  try {
    await page.waitForFunction(() => document.querySelectorAll('#tiles-computers .tile').length === 2);
    assert.deepEqual(await tiles(page, 'tiles-phones'), ['Galaxy S25 | Connected'], 'only the device list is read');
    assert.equal(await page.locator('#tiles-computers .tile').first().getAttribute('href'), '/devices');
    assert.ok(!requested.some((p) => p.startsWith('/api/phone-control/')), `asked Phone & Device Control for ${requested.filter((p) => p.startsWith('/api/phone-control/')).join(', ')}`);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a refrigerator temperature shows only when the hub reported it: placeholders are never shown as readings', async () => {
  // 1.6.1: the weekly state starts with 37 and 0, and the page showed them ("Cooler: 37°F · Closed") for everyone.
  const comparison = { depletedFromLastWeek: [], runningLow: [], useFirst: [], summary: '' };
  const state = (telemetry) => ({ ok: true, comparison, telemetry, currentSnapshot: { items: [] }, cart: { items: [], status: 'recommended', activeItemCount: 0 }, mealPlan: { entries: [] },
    weeklySchedule: { dayOfWeek: 'Sunday', time: '09:00', enabled: true } });
  const withAssessment = async (telemetry) => {
    const { page, context } = await openPage(browser, PHONE_VIEW, { url: '/api/home/ui', files: FILES,
      reads: { ...reads(), '/api/home/devices': { devices: [{ ...DEVICES[0], temperatureF: undefined }], hubs: ['smartthings'], generatedAt: '2026-11-10T22:00:00Z' }, '/api/home/fridge-assessment': state(telemetry) } });
    await page.locator('#tiles-kitchen .tile').waitFor();
    await page.waitForFunction(() => document.getElementById('fridgeWeeklySchedBadge').textContent.includes('Sunday'));
    const tile = await page.locator('#tiles-kitchen .tile .tile-st').textContent();
    await page.locator('#tiles-kitchen .tile').click();
    await page.waitForSelector('#page-fridge:not([hidden])');
    const shown = { tile, cooler: await page.isVisible('#fridgeTempCooler'), freezer: await page.isVisible('#fridgeTempFreezer'),
      none: await page.isVisible('#fridgeTempNone'), words: (await page.locator('#page-fridge .crow').first().innerText()).replace(/\s+/g, ' ').trim() };
    await context.close();
    return shown;
  };
  const placeholders = await withAssessment({ coolerTempF: 37, freezerTempF: 0, measuredAt: null });
  assert.deepEqual({ tile: placeholders.tile, cooler: placeholders.cooler, freezer: placeholders.freezer, none: placeholders.none },
    { tile: 'Look inside, list and meal ideas', cooler: false, freezer: false, none: true });
  assert.ok(!/37|0°F/.test(placeholders.words), `no placeholder temperature on the page: ${placeholders.words}`);
  assert.match(placeholders.words, /Temperature not read yet/);
  const read = await withAssessment({ coolerTempF: 36, freezerTempF: -2, measuredAt: '2026-11-10T15:00:00Z' });
  assert.deepEqual({ tile: read.tile, cooler: read.cooler, freezer: read.freezer, none: read.none },
    { tile: 'Fridge 36°F · Freezer -2°F', cooler: true, freezer: true, none: false });
});
