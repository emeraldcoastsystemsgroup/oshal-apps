/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Smart Home's available-width catalogue, deliberate details selection, focus return and responsive controls with the shipped page and synthetic read-only inventory.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Cover filtering the selected device away: release the detail rail, retain search focus and keep details closed when the filter clears.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { playwright, openPage, overflow } = require('./phone-fixture.cjs');

const STORE = path.resolve(__dirname, '../../..');
const FILES = {
  '/api/home/ui': path.join(STORE, 'home/tools/home.html'),
  '/api/home/ui/home-tvs.js': path.join(STORE, 'home/tools/home-tvs.js'),
  '/api/phone-control/ui/computer-link.js': path.join(STORE, 'phone-control/tools/computer-link.js'),
  '/api/phone-control/ui/phone-rdp.js': path.join(STORE, 'phone-control/tools/phone-rdp.js'),
};
// Synthetic names and telemetry only. The fixture refuses writes and off-origin requests.
const DEVICES = [
  { key: 'fixture-fridge', name: 'Fixture Family Hub Refrigerator', temperatureF: 37, capabilities: ['refrigeration'] },
  { key: 'fixture-second-fridge', name: 'Fixture Kitchen Refrigerator with a long display name', capabilities: ['refrigeration'] },
  { key: 'fixture-lamp', name: 'Fixture reading lamp', room: 'Den', switch: 'on', level: 17, capabilities: ['switch', 'switchLevel'] },
  { key: 'fixture-porch', name: 'Fixture Front Porch Light', capabilities: ['switch'] },
  { key: 'fixture-dining', name: 'Fixture Formal Dining Room Chandelier', capabilities: ['switch', 'switchLevel'] },
  { key: 'fixture-thermostat', name: 'Fixture Hall Thermostat', temperatureF: 68, capabilities: ['thermostat'] },
];
const READS = {
  '/api/swarm/apps': { apps: [{ name: 'home', authorized: true }, { name: 'phone-control', authorized: true, accessChanged: false }] },
  '/api/home/devices': { devices: DEVICES, hubs: ['smartthings'], generatedAt: '2026-11-12T12:00:00Z' },
  '/api/home/scenes': { scenes: [{ name: 'Fixture evening lights', steps: [{ device: 'fixture-lamp', cmd: 'on' }] }] },
  '/api/home/schedules': { schedules: [] },
  '/api/home/operations-guide': { ok: true, playbooks: [], entries: [], discoveredDevices: [] },
  '/api/home/lan/devices': { ok: true, tvs: [
    { id: 'fixture-tv-1', name: 'Fixture Living Room Television', kind: 'samsung-tizen', controllable: true },
    { id: 'fixture-tv-2', name: 'Fixture Bedroom Streaming Stick', kind: 'roku', controllable: true },
  ] },
  '/api/computers': { computers: [
    { id: 'fixture-den', name: 'Fixture Den PC', platform: 'linux', connected: true, can_control: true, tools: ['shell.exec'], bound: ['chrome'] },
    { id: 'fixture-laptop', name: 'Fixture Study Laptop', platform: 'windows', connected: false, can_control: false },
  ] },
  '/api/phone-control/devices': { devices: [{ id: 'fixture-phone', name: 'Fixture Kitchen Phone', platform: 'android', form: 'phone' }] },
};
let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function open(width) {
  const errors = [];
  const result = await openPage(browser, { width, height: 1000 }, {
    url: '/api/home/ui', files: FILES, reads: READS, framed: true,
    onPage: page => page.on('pageerror', error => errors.push(error.message)),
  });
  await result.page.locator('#tiles-computers .home-tile-shell').nth(1).waitFor();
  await result.page.locator('#tiles-tv .home-tile-shell').nth(1).waitFor();
  return { ...result, errors };
}

async function bounds(page, selector) {
  return page.locator(selector).evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  });
}

async function assertFits(page) {
  const fit = await overflow(page);
  assert.ok(fit.scrollWidth <= fit.clientWidth, `document ${fit.scrollWidth}px exceeds viewport ${fit.clientWidth}px`);
  assert.deepEqual(fit.offenders, [], 'visible content stays within its available width');
  const controls = await page.locator('#homeSearch, #refresh').evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    return { id: el.id, x: r.x, right: r.right, width: r.width, height: r.height, viewport: innerWidth };
  }));
  for (const c of controls) {
    assert.ok(c.width >= 44 && c.height >= 44, `${c.id} keeps a usable target: ${JSON.stringify(c)}`);
    assert.ok(c.x >= 0 && c.right <= c.viewport + 1, `${c.id} fits the viewport`);
  }
  const search = await bounds(page, '#homeSearch'), refresh = await bounds(page, '#refresh');
  const overlaps = search.x < refresh.right && search.right > refresh.x && search.y < refresh.bottom && search.bottom > refresh.y;
  assert.equal(overlaps, false, 'search and Refresh do not overlap');
}

async function assertDesktopCards(page) {
  const narrow = await page.locator('#homeCatalogue .home-tile-shell, #grid > .card').evaluateAll(els => els
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.width < 200; })
    .map(el => ({ text: el.textContent.trim().slice(0, 90), width: el.getBoundingClientRect().width })));
  assert.deepEqual(narrow, [], 'desktop devices do not become narrow nested columns');
}

test('wide overview uses the app viewport and opens without a selected device', async () => {
  const { page, context, writes, errors } = await open(1440);
  try {
    const workspace = await bounds(page, '#homeWorkspace');
    assert.ok(workspace.width >= 1440 - 96, `available app width is wasted: workspace is ${workspace.width}px`);
    assert.equal(await page.locator('#homeSelection').isVisible(), false, 'initial inventory must not select the first device');
    const catalogue = await bounds(page, '#homeCatalogue');
    assert.ok(Math.abs(catalogue.width - workspace.width) <= 2, 'a closed detail rail leaves no reserved column');
    await assertDesktopCards(page);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('search alone never opens details; explicit selection and Close restore width and keyboard focus', async () => {
  const { page, context, writes, errors } = await open(1440);
  try {
    const search = page.getByRole('searchbox', { name: 'Find a device' });
    await search.fill('Fixture Den PC');
    assert.equal(await page.locator('#homeSelection').isVisible(), false, 'filtering is not device selection');
    await search.fill('');
    const before = await bounds(page, '#homeCatalogue');
    const details = page.getByRole('button', { name: 'Details for Fixture Den PC', exact: true });
    await details.click();
    const selected = page.getByRole('region', { name: 'Selected device' });
    assert.equal(await selected.isVisible(), true);
    assert.match(await selected.innerText(), /Fixture Den PC/);
    assert.equal(await selected.getByRole('heading').evaluate(el => el === document.activeElement), true, 'selected device heading receives focus');
    await assertDesktopCards(page);
    await selected.getByRole('button', { name: 'Close details' }).click();
    assert.equal(await selected.isVisible(), false);
    assert.ok(Math.abs((await bounds(page, '#homeCatalogue')).width - before.width) <= 2, 'closing restores the full catalogue width');
    assert.equal(await details.evaluate(el => el === document.activeElement), true, 'focus returns to the originating Details button');
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('filtering out the selected device releases its rail without selecting the remaining match', async () => {
  const { page, context, writes, errors } = await open(1440);
  try {
    const fullWidth = (await bounds(page, '#homeCatalogue')).width;
    await page.getByRole('button', { name: 'Details for Fixture Den PC', exact: true }).click();
    const selected = page.getByRole('region', { name: 'Selected device' });
    const search = page.getByRole('searchbox', { name: 'Find a device' });
    await search.fill('Fixture Den PC');
    assert.equal(await selected.isVisible(), true, 'a filter retaining the selected device keeps its details');
    assert.ok((await bounds(page, '#homeCatalogue')).width < fullWidth, 'an open desktop rail uses catalogue space');
    await search.fill('Fixture Front Porch Light');
    assert.equal(await selected.isVisible(), false, 'removing the selected device closes its details');
    assert.ok(Math.abs((await bounds(page, '#homeCatalogue')).width - fullWidth) <= 2, 'filter dismissal releases the whole detail column');
    assert.equal(await search.evaluate(el => el === document.activeElement), true, 'typing keeps focus in search');
    await page.getByRole('button', { name: 'Clear device search' }).click();
    assert.equal(await selected.isVisible(), false, 'clearing search does not revive an old selection');
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
    await assertFits(page);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`${width}px: catalogue, header controls and opened details fit the app frame`, async () => {
    const { page, context, writes, errors } = await open(width);
    try {
      await assertFits(page);
      if (width >= 1024) await assertDesktopCards(page);
      await page.getByRole('button', { name: 'Details for Fixture Family Hub Refrigerator', exact: true }).click();
      assert.equal(await page.getByRole('region', { name: 'Selected device' }).isVisible(), true);
      await assertFits(page);
      if (width >= 1024) await assertDesktopCards(page);
      await page.getByRole('button', { name: 'Close details' }).click();
      await assertFits(page);
      assert.deepEqual(writes, [], 'layout and detail browsing never issue device commands');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
