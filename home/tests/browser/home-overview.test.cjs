/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Smart Home overview regressions against its actual shipped page and browser assets. Every browser request is synthetic and every unexpected write is refused.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const STORE = path.resolve(__dirname, '../../..');
const { playwright, openPage, overflow } = require('./phone-fixture.cjs');
const files = {
  '/api/home/ui': path.join(STORE, 'home/tools/home.html'),
  '/api/home/ui/home-tvs.js': path.join(STORE, 'home/tools/home-tvs.js'),
  '/api/phone-control/ui/computer-link.js': path.join(STORE, 'phone-control/tools/computer-link.js'),
  '/api/phone-control/ui/phone-rdp.js': path.join(STORE, 'phone-control/tools/phone-rdp.js'),
};

const DEVICES = [
  { key: 'lamp', name: 'Reading lamp', room: 'Den', switch: 'on', level: 17, capabilities: ['switch', 'switchLevel'] },
  { key: 'thermostat', name: 'Hall thermostat', temperatureF: 68, capabilities: ['thermostat'] },
  { key: 'unknown', name: 'Porch light', capabilities: ['switch'] },
];
const COMPUTERS = [{ id: 'fixture-den', name: 'Den PC', platform: 'linux', connected: true, can_control: true,
  tools: ['shell.exec', 'desktop.control'], bound: ['chrome'] }];
const READS = {
  '/api/swarm/apps': { apps: [{ name: 'home', authorized: true }, { name: 'phone-control', authorized: true, accessChanged: false }] },
  '/api/home/devices': { devices: DEVICES, hubs: ['smartthings'], generatedAt: '2026-11-12T12:00:00Z' },
  '/api/home/scenes': { scenes: [{ name: 'Evening lights', steps: [{ device: 'Reading lamp', cmd: 'on' }] }] },
  '/api/home/schedules': { schedules: [] },
  '/api/home/operations-guide': { ok: true, playbooks: [], entries: [], discoveredDevices: [] },
  '/api/home/lan/devices': { ok: true, tvs: [] },
  '/api/computers': { computers: COMPUTERS },
  '/api/phone-control/devices': { devices: [] },
};
let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });
async function open(viewport = { width: 412, height: 915 }, reads = READS, configure) {
  const errors = [];
  const result = await openPage(browser, viewport, { url: '/api/home/ui', files, reads, framed: viewport.width < 400,
    onPage: async page => { page.on('pageerror', error => errors.push(error.message)); await configure?.(page); } });
  await result.page.locator('#homeInventoryState').waitFor();
  return { ...result, errors };
}

test('reported dimmer brightness is shown instead of a made-up midpoint', async () => {
  const { page, context } = await open();
  try {
    const brightness = page.getByRole('slider', { name: 'Brightness for Reading lamp' });
    assert.equal(await brightness.inputValue(), '17');
    assert.match(await page.locator('#card-lamp').innerText(), /17%/);
  } finally { await context.close(); }
});

test('a refused brightness change restores the last reported value and says why', async () => {
  const sent = [];
  const { page, context } = await open(undefined, READS, async view => {
    await view.route('**/api/home/control', async route => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 428, json: { error: 'confirmation refused' } });
    });
  });
  try {
    const brightness = page.getByRole('slider', { name: 'Brightness for Reading lamp' });
    await brightness.focus(); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('confirmation refused'));
    assert.deepEqual(sent, [{ device: 'lamp', cmd: 'set', capability: 'switchLevel', command: 'setLevel', arg: 18, confirm: true }]);
    assert.equal(await brightness.inputValue(), '17');
    assert.match(await page.locator('#card-lamp').innerText(), /17%/);
  } finally { await context.close(); }
});

test('missing or invalid brightness is labelled unknown and never becomes a live slider', async () => {
  const variants = [undefined, null, '17', -2, 101];
  const devices = variants.map((level, i) => ({ ...DEVICES[0], key: `bad-${i}`, name: `Unknown brightness ${i}`, level }));
  const { page, context } = await open(undefined, { ...READS, '/api/home/devices': { devices, hubs: ['smartthings'] } });
  try {
    assert.equal(await page.locator('#grid input[type="range"]').count(), 0);
    assert.equal(await page.locator('#grid .card').count(), variants.length);
    assert.equal(await page.locator('#grid .card', { hasText: 'Brightness not reported' }).count(), variants.length);
  } finally { await context.close(); }
});

test('a refused connected-device read is unknown, not a whole-home empty claim', async () => {
  const reads = { ...READS, '/api/home/devices': { devices: [], hubs: [] }, '/api/home/scenes': { scenes: [] } };
  const { page, context, errors, writes } = await open(undefined, reads, async view => {
    await view.route('**/api/computers', route => route.fulfill({ status: 403, json: { error: 'not allowed' } }));
  });
  try {
    await page.waitForFunction(() => document.getElementById('homeInventoryState').textContent.includes('could not be read'));
    assert.equal(await page.locator('#emptyState').isVisible(), false);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('unknown switch state is not presented as Off', async () => {
  const { page, context } = await open();
  try {
    const card = page.locator('#card-unknown');
    assert.match(await card.innerText(), /not (read|reported)|unknown/i);
    assert.equal(await card.getByRole('switch').count(), 0, 'a binary switch must not claim a state before it is known');
  } finally { await context.close(); }
});

test('a thermostat without a switch capability is not given a switch', async () => {
  const { page, context } = await open();
  try {
    assert.equal(await page.locator('#card-thermostat').getByRole('switch').count(), 0);
    assert.doesNotMatch(await page.locator('#card-thermostat').innerText(), /\bOff\b/);
  } finally { await context.close(); }
});

test('a connected computer prevents the whole-home No devices yet state', async () => {
  const reads = { ...READS, '/api/home/devices': { devices: [], hubs: [], generatedAt: null }, '/api/home/scenes': { scenes: [] } };
  const { page, context } = await open(undefined, reads);
  try {
    assert.equal(await page.locator('#emptyState').isVisible(), false);
    assert.match(await page.locator('#tiles-computers').innerText(), /Den PC/);
  } finally { await context.close(); }
});

test('scenes are keyboard buttons and send only their existing confirmed scene request', async () => {
  const { page, context, writes } = await open();
  const sent = [];
  try {
    const scene = page.locator('#scenes .scene').first();
    assert.equal(await scene.evaluate(el => el.tagName), 'BUTTON');
    await page.route('**/api/home/scene/run', async route => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', json: { ok: true, ran: 'Evening lights' } });
    });
    await scene.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Ran Evening lights'));
    assert.deepEqual(sent, [{ name: 'Evening lights', confirm: true }]);
    assert.deepEqual(writes, []);
  } finally { await context.close(); }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 412, height: 915 }, { width: 392, height: 641 }]) {
  test(`${viewport.width}px: search and selected-device workspace guide browsing without commands`, async () => {
    const { page, context, writes, errors } = await open(viewport);
    try {
      const search = page.getByRole('searchbox', { name: 'Find a device' });
      assert.equal(await search.isVisible(), true);
      await search.fill('Den PC');
      await page.getByRole('button', { name: 'Details for Den PC', exact: true }).click();
      const selected = page.getByRole('region', { name: 'Selected device' });
      assert.match(await selected.innerText(), /Den PC/);
      assert.match(await selected.innerText(), /Connected/);
      assert.equal(await selected.getByRole('link', { name: 'Open device controls' }).getAttribute('href'), '/cockpit/?app=phone-control');
      const fits = await overflow(page);
      assert.equal(fits.scrollWidth <= fits.clientWidth, true);
      assert.deepEqual(fits.offenders, []);
      const small = await page.locator('#homeView :is(button,input,a):visible').evaluateAll(els => els.filter(el => {
        const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44;
      }).map(el => el.outerHTML));
      assert.deepEqual(small, []);
      await search.fill('no-such-fixture');
      assert.match(await page.getByRole('status', { name: 'Device search results' }).innerText(), /No matching devices/i);
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('changed Phone Controls approval prevents optional reads, while connected tiles retain their fallback', async () => {
  const reads = { ...READS, '/api/swarm/apps': { apps: [{ name: 'phone-control', authorized: false, accessChanged: true }] } };
  const requested = [], errors = [];
  const { page, context, writes } = await openPage(browser, { width: 412, height: 915 }, { url: '/api/home/ui', files, reads,
    onPage: page => {
      page.on('request', req => requested.push(new URL(req.url()).pathname));
      page.on('pageerror', error => errors.push(error.message));
    } });
  try {
    await page.locator('#tiles-computers .tile').first().waitFor();
    assert.equal(await page.locator('#tiles-computers .tile').first().getAttribute('href'), '/devices');
    assert.equal(requested.some(url => url.startsWith('/api/phone-control/')), false);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
