/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-05 (home-dashboard, D), in headless Chromium at 412 x 915 and in the 392 px cockpit frame with synthetic reads: with no hub the page is one empty state (No devices yet, one primary Connect a hub that opens the SmartThings and Google Home rows, each with a status pill), no schedule form, no Refresh and no inline Ask bar; a refused refresh (409) is an alert with Connect a hub, never silence; with devices the order is devices, scenes, schedules; the diagnostic brief stays withheld while no connected action mounts. Replaces home-phone-layout and home-reply-words, which proved the removed Ask bar.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The split: schedules are the Automations screen (?view=automations), with one empty state when there is nothing to run; the Smart Home screen is devices then scenes.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Verify #fridgeCameraSection renders the Samsung Family Hub weekly schedule badge, week-over-week shelf comparison, grocery cart starter, and 5-day meal list builder, and updates state on POST /api/home/fridge-meal-plan.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { VIEWPORTS, playwright, openPage, overflow } = require('./phone-fixture.cjs');

const PAGE = path.resolve(__dirname, '../../tools/home.html');
const EMPTY = { '/api/home/devices': { deviceCount: 0, devices: [], empty: true, generatedAt: null, hubs: [] }, '/api/home/scenes': { scenes: [] }, '/api/home/schedules': { schedules: [] } };
const DEVICES = Array.from({ length: 2 }, (_, i) => ({ key: `fixture-${i}`, name: `Fixture lamp ${i + 1}`, switch: 'off', capabilities: ['switch'] }));
const FULL = { '/api/home/devices': { devices: DEVICES, hubs: ['SmartThings'], generatedAt: '2026-11-06T10:42:00Z' }, '/api/home/scenes': { scenes: [{ name: 'Movie night', steps: [{}] }] }, '/api/home/schedules': { schedules: [] } };
const visible = (page, sel) => page.locator(sel).first().isVisible();

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

for (const viewport of VIEWPORTS) {
  test(`with no hub the page is one empty state with one primary on a ${viewport.width} px screen`, async () => {
    const { page, context, writes } = await openPage(browser, viewport, { url: '/api/home/ui', files: { '/api/home/ui': PAGE }, reads: EMPTY, framed: viewport.width < 400 });
    try {
      await page.waitForSelector('#emptyState:not([hidden])');
      assert.equal(await page.textContent('#empty-title'), 'No devices yet');
      const primaries = await page.locator('button.solid:visible, a.solid:visible').allTextContents();
      assert.deepEqual(primaries, ['Connect a hub'], 'one primary on the empty screen');
      for (const sel of ['#schedSection', '#refresh', '#devicesSection', '#hubsPanel', '#evidenceReview', 'h1']) assert.equal(await visible(page, sel), false, `${sel} is not shown`);
      assert.equal(await page.locator('#msg, #send').count(), 0, 'no inline Ask bar');
      const b = await page.locator('#connectHub').boundingBox();
      assert.ok(b.height >= 44, `Connect a hub is ${b.height}px tall`);
      await page.locator('#connectHub').tap();
      assert.ok(await visible(page, '#hubsPanel'), 'Connect a hub opens the hub rows');
      assert.equal(await page.textContent('#pill-smartthings'), 'Not connected');
      assert.equal(await page.textContent('#pill-google-home'), 'Not connected');
      const link = page.locator('#hubsPanel a', { hasText: 'Connect SmartThings' });
      assert.equal(await link.getAttribute('href'), '/api/connect/smartthings/start');
      assert.equal(await link.evaluate((el) => getComputedStyle(el).textDecorationLine), 'none', 'a button, not an underlined link');
      const fit = await overflow(page);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `the page is ${fit.scrollWidth}px wide in ${fit.clientWidth}px`);
      assert.deepEqual(writes, [], 'opening the page wrote nothing');
    } finally { await context.close(); }
  });
}

test('a refused refresh (409, not connected) is an alert with the fix, never silence', async () => {
  const reads = { ...FULL };
  const { page, context } = await openPage(browser, VIEWPORTS[0], { url: '/api/home/ui', files: { '/api/home/ui': PAGE }, reads });
  try {
    await page.route('**/api/home/refresh', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"SmartThings not connected"}' }));
    await page.waitForSelector('#refresh:not([hidden])');
    await page.locator('#refresh').tap();
    await page.waitForSelector('#alert:not([hidden])');
    assert.match(await page.textContent('#alert'), /^SmartThings isn't connected yet\. Connect it above\./);
    assert.doesNotMatch(await page.textContent('#alert'), /\/utilities/);
    assert.ok(await page.locator('#alert button', { hasText: 'Connect a hub' }).isVisible());
  } finally { await context.close(); }
});

test('with devices the Smart Home screen is devices then scenes, and the hub pill says when it was read', async () => {
  const { page, context } = await openPage(browser, { width: 1440, height: 900 }, { url: '/api/home/ui', files: { '/api/home/ui': PAGE }, reads: FULL });
  try {
    await page.waitForFunction(() => document.querySelectorAll('#grid .card').length === 2 && document.querySelectorAll('#scenes .scene').length === 1);
    assert.equal(await visible(page, '#emptyState'), false);
    const y = async (sel) => (await page.locator(sel).first().boundingBox()).y;
    assert.ok(await y('#devicesSection') < await y('#scenes'), 'devices before scenes');
    assert.equal(await visible(page, '#schedSection'), false, 'schedules are the Automations screen');
    assert.ok(await visible(page, '#refresh'), 'Refresh once a hub has reported');
    assert.match(await page.textContent('#pill-smartthings'), /^Connected · read /);
    assert.equal(await visible(page, '#evidenceReview'), false, 'no connected action mounts, so no diagnostic brief');
  } finally { await context.close(); }
});

test('Automations is its own screen: the schedules with something to run, one empty state without', async () => {
  const MANIFEST = require('node:fs').readFileSync(path.resolve(__dirname, '../../oshal-app.yaml'), 'utf8');
  assert.match(MANIFEST, /toolName: home-automations\n\s+label: Automations\n\s+icon: [^\n]+\n\s+iframeUrl: \/api\/home\/ui\?view=automations/);
  let { page, context } = await openPage(browser, VIEWPORTS[0], { url: '/api/home/ui?view=automations', files: { '/api/home/ui': PAGE }, reads: FULL });
  try {
    await page.waitForSelector('#schedSection:not([hidden])');
    assert.ok(await page.locator('#sch-what').isVisible(), 'New schedule is there');
    for (const sel of ['#devicesSection', '#scenes', '#emptyState']) assert.equal(await visible(page, sel), false, `${sel} is not on Automations`);
  } finally { await context.close(); }
  ({ page, context } = await openPage(browser, VIEWPORTS[0], { url: '/api/home/ui?view=automations', files: { '/api/home/ui': PAGE }, reads: EMPTY }));
  try {
    await page.waitForSelector('#emptyState:not([hidden])');
    assert.equal(await page.textContent('#empty-title'), 'No automations yet');
    assert.equal(await visible(page, '#schedSection'), false, 'no schedule form with nothing to run');
    assert.deepEqual(await page.locator('button.solid:visible, a.solid:visible').allTextContents(), ['Connect a hub']);
  } finally { await context.close(); }
});

test('with a Family Hub refrigerator device, #fridgeCameraSection renders weekly comparison, grocery cart starter, and 5-day meal list builder', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { formatFridgeAssessmentResponse, mutateFridgeMealAndCart } = require('../../routes/fridge-weekly-assessment.js');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-fridge-ui-'));
  const prevDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  process.env.OSHAL_PACKAGE_DATA_DIR = tmpDir;
  const fridgeReads = {
    '/api/home/devices': {
      devices: [
        { key: 'samsung-family-hub', name: 'Samsung Family Hub Refrigerator', switch: 'on', temperatureF: 37, capabilities: ['refrigeration', 'samsungce.viewInside'] },
      ],
      hubs: ['SmartThings'],
      generatedAt: '2026-11-08T06:00:00Z',
    },
    '/api/home/scenes': { scenes: [] },
    '/api/home/schedules': { schedules: [] },
    '/api/home/fridge-assessment': formatFridgeAssessmentResponse('owner-ui'),
  };
  const { page, context } = await openPage(browser, { width: 1280, height: 900 }, { url: '/api/home/ui', files: { '/api/home/ui': PAGE }, reads: fridgeReads });
  try {
    await page.route('**/api/home/fridge-meal-plan', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const updated = mutateFridgeMealAndCart('owner-ui', body);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
    });
    await page.waitForSelector('#fridgeCameraSection:not([hidden])');
    assert.match(await page.textContent('#fridgeWeeklySchedBadge'), /Weekly Assessment: Sunday 09:00 · Active/);
    assert.match(await page.textContent('#fridgeShelfInventory'), /Silver Floss Sauerkraut Jar/);
    assert.match(await page.textContent('#fridgeComparisonLists'), /Organic Whole Milk/);
    assert.match(await page.textContent('#fridgeMealPlanList'), /Prepped Glass-Bowl Chopped Salad/);
    await page.locator('#startFridgeCartBtn').click();
    await page.waitForFunction(() => document.getElementById('fridgeCartStatusBadge')?.textContent?.includes('Cart Started'));
    assert.match(await page.textContent('#fridgeCartStatusBadge'), /Cart Started · [67] items/);
    await page.locator('#fridge-meal-focus').selectOption('high-protein');
    await page.waitForFunction(() => document.getElementById('fridgeMealPlanList')?.textContent?.includes('Double-Protein'));
  } finally {
    await context.close();
    if (prevDir === undefined) delete process.env.OSHAL_PACKAGE_DATA_DIR;
    else process.env.OSHAL_PACKAGE_DATA_DIR = prevDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
