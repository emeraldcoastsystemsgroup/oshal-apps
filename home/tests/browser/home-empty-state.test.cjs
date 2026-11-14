/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-05 (home-dashboard, D), in headless Chromium at 412 x 915 and in the 392 px cockpit frame with synthetic reads: with no hub the page is one empty state (No devices yet, one primary Connect a hub that opens the SmartThings and Google Home rows, each with a status pill), no schedule form, no Refresh and no inline Ask bar; a refused refresh (409) is an alert with Connect a hub, never silence; with devices the order is devices, scenes, schedules; the diagnostic brief stays withheld while no connected action mounts. Replaces home-phone-layout and home-reply-words, which proved the removed Ask bar.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The split: schedules are the Automations screen (?view=automations), with one empty state when there is nothing to run; the Smart Home screen is devices then scenes.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Verify #fridgeCameraSection renders the Samsung Family Hub weekly schedule badge, week-over-week shelf comparison, grocery cart starter, and 5-day meal list builder, and updates state on POST /api/home/fridge-meal-plan.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | 1.6.2: the refrigerator page of a person nothing was read for lists nothing and says so in each part; starting an empty list says so; an item the person adds is on the list; a focus invents no meal. Until 1.6.2 this case asserted one fixed set of groceries and meals.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | home 1.9.0: Smart Home keeps no grocery list. The refrigerator page's Grocery list card shows the person's list in Shopping and adds to it and ticks it off through Shopping's own routes (a stand-in that answers as Shopping's routes do); Smart Home's own state stays empty. Items a person had on the refrigerator's own list are moved to Shopping when the page opens and forgotten here; when Shopping refuses this account they stay and are shown. There is no Start a grocery list button.
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

/** A stand-in for Shopping that answers as its own routes do (GET /cart, POST /lists/default/items, POST /lists/:id/items/:itemId); `open: false` refuses everyone. */
function shoppingStandIn({ open = true } = {}) {
  const items = [], asked = [];
  return {
    items, asked,
    async route(route) {
      const req = route.request(), url = new URL(req.url()), body = req.postData() ? JSON.parse(req.postData()) : {};
      asked.push(`${req.method()} ${url.pathname}`);
      const answer = (status, json) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
      if (!open) return answer(403, { error: 'authorization_denied' });
      if (req.method() === 'GET' && url.pathname === '/api/purchasing/cart') return answer(200, { listId: items.length ? 'list-1' : null, items: items.filter((i) => i.status === 'pending'), total: 0, totalCents: 0, unpricedLines: items.length });
      if (req.method() === 'POST' && url.pathname === '/api/purchasing/lists/default/items') {
        const added = (Array.isArray(body.items) ? body.items : [body]).map((entry) => ({ item_id: `item-${items.length + 1 + Math.random()}`, list_id: 'list-1', title: entry.title, quantity: entry.quantity || 1, status: 'pending' }));
        items.push(...added);
        return answer(200, Array.isArray(body.items) ? { items: added } : { item: added[0] });
      }
      const tick = /^\/api\/purchasing\/lists\/list-1\/items\/(.+)$/.exec(url.pathname);
      if (req.method() === 'POST' && tick) { const row = items.find((i) => i.item_id === decodeURIComponent(tick[1])); row.status = body.checked ? 'done' : 'pending'; return answer(200, { item: row }); }
      return answer(404, { error: 'not_found' });
    },
  };
}

/** Open the refrigerator page for one person over the real refrigerator module, with a Shopping stand-in. */
async function openRefrigerator(owner, shop) {
  const { formatFridgeAssessmentResponse, mutateFridgeMealAndCart } = require('../../routes/fridge-weekly-assessment.js');
  const reads = {
    '/api/home/devices': { devices: [{ key: 'samsung-family-hub', name: 'Samsung Family Hub Refrigerator', switch: 'on', temperatureF: 37, capabilities: ['refrigeration', 'samsungce.viewInside'] }], hubs: ['SmartThings'], generatedAt: '2026-11-08T06:00:00Z' },
    '/api/home/scenes': { scenes: [] }, '/api/home/schedules': { schedules: [] },
    '/api/home/fridge-assessment': formatFridgeAssessmentResponse(owner),
  };
  const opened = await openPage(browser, { width: 1280, height: 900 }, { url: '/api/home/ui', files: { '/api/home/ui': PAGE }, reads,
    onPage: async (page) => {
      await page.route('**/api/purchasing/**', (route) => shop.route(route));
      await page.route('**/api/home/fridge-meal-plan', async (route) => {
        const out = mutateFridgeMealAndCart(owner, JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({ status: out.refusal ? 409 : 200, contentType: 'application/json', body: JSON.stringify(out.refusal || out) });
      });
    } });
  const tile = opened.page.locator('#tiles-kitchen .tile');
  await tile.waitFor();
  return { ...opened, tile, state: () => formatFridgeAssessmentResponse(owner) };
}

/** A data folder for one test's refrigerator state, removed afterwards. */
function dataFolder(t) {
  const fs = require('node:fs'), os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-fridge-ui-')), before = process.env.OSHAL_PACKAGE_DATA_DIR;
  process.env.OSHAL_PACKAGE_DATA_DIR = dir;
  t.after(() => { if (before === undefined) delete process.env.OSHAL_PACKAGE_DATA_DIR; else process.env.OSHAL_PACKAGE_DATA_DIR = before; fs.rmSync(dir, { recursive: true, force: true }); });
}
const words = async (page, selector) => (await page.textContent(selector)).replace(/\s+/g, ' ').trim();

test('1.9.0: the refrigerator lists nothing it has not read, and its grocery list is the person\'s list in Shopping', async (t) => {
  dataFolder(t);
  const shop = shoppingStandIn();
  const { page, context, tile, state } = await openRefrigerator('owner-ui', shop);
  try {
    // Home shows the refrigerator as one tile; its page opens from it and Back returns to Home.
    assert.match(await tile.textContent(), /Samsung Family Hub Refrigerator/);
    assert.equal(await page.isVisible('#fridgeCameraSection'), false, 'the refrigerator page is closed until its tile is pressed');
    assert.equal(await page.isVisible('#devicesSection'), false, 'the refrigerator is a tile, not a switch card');
    await tile.click();
    await page.waitForSelector('#fridgeCameraSection:not([hidden])');
    assert.equal(await page.textContent('#page-fridge h2'), 'Refrigerator');
    assert.match(await page.textContent('#fridgeWeeklySchedBadge'), /Checked every Sunday 09:00/);
    assert.equal(await page.textContent('#readViewInsideBtn'), 'Look inside');
    // Nothing was read from this refrigerator, so no shelf, comparison or meal is shown (1.6.2).
    assert.equal(await words(page, '#fridgeShelfInventory'), 'Nothing has been read from this refrigerator yet.');
    assert.match(await words(page, '#fridgeComparisonSummary'), /^Nothing has been read from this refrigerator yet, so there is no list of what is inside, no comparison with last week and no meal ideas\./);
    assert.equal(await words(page, '#fridgeComparisonLists'), '');
    assert.equal(await words(page, '#fridgeMealPlanList'), 'Meal ideas come from a reading of what is inside. None has been read yet.');
    // The grocery list is Shopping's: the card shows it, says so, and there is no list to start here.
    await page.waitForFunction(() => /Nothing is on your grocery list/.test(document.getElementById('fridgeGroceryItems').textContent));
    assert.equal(await words(page, '#fridgeGroceryBadge'), 'In Shopping');
    assert.equal(await page.locator('#startFridgeCartBtn, #fridgeCartItems, #fridge-cart-add-input').count(), 0, 'no grocery list of Smart Home\'s own');
    const open = page.locator('#fridgeGroceryOpen');
    assert.deepEqual([await open.textContent(), await open.getAttribute('href'), await open.getAttribute('target')], ['Open Shopping', '/cockpit/?app=purchasing', '_top']);
    // An item the person adds goes to Shopping's list through Shopping's own route, and Smart Home keeps nothing.
    await page.locator('#fridge-grocery-add-input').fill('Oat milk');
    await page.locator('#fridgeGroceryAddBtn').click();
    await page.waitForFunction(() => document.getElementById('fridgeGroceryItems').textContent.includes('Oat milk'));
    assert.equal(await words(page, '#fridgeGroceryBadge'), 'In Shopping · 1 to buy');
    assert.deepEqual(shop.items.map((item) => [item.title, item.status]), [['Oat milk', 'pending']]);
    assert.ok(shop.asked.includes('POST /api/purchasing/lists/default/items'));
    assert.deepEqual(state().groceryList.earlier, [], 'nothing is written to Smart Home');
    // Ticking it off is Shopping's change too; a ticked item is no longer to buy.
    await page.locator('#fridgeGroceryItems input[type=checkbox]').check();
    await page.waitForFunction(() => /Nothing is on your grocery list/.test(document.getElementById('fridgeGroceryItems').textContent));
    assert.deepEqual(shop.items.map((item) => item.status), ['done']);
    // A focus changes no meal: ideas come from a reading.
    await page.locator('#fridge-meal-focus').selectOption('high-protein');
    await page.waitForFunction(() => /No meal ideas yet: they come from a reading of what is inside/.test(document.body.innerText));
    assert.equal(await words(page, '#fridgeMealPlanList'), 'Meal ideas come from a reading of what is inside. None has been read yet.');
    await page.locator('#page-fridge [data-page-back]').click();
    await page.waitForSelector('#homeView:not([hidden])');
    assert.equal(await page.isVisible('#fridgeCameraSection'), false, 'Back returns to Home');
  } finally { await context.close(); }
});

/** A person's refrigerator state from before 1.9.0, with two items on the refrigerator's own grocery list. */
function withEarlierList(owner) {
  const { writePersistedJson } = require('../../routes/home-local-swarm.js');
  const { formatFridgeAssessmentResponse, mutateFridgeMealAndCart } = require('../../routes/fridge-weekly-assessment.js');
  formatFridgeAssessmentResponse(owner);
  const { readPersistedJson } = require('../../routes/home-local-swarm.js');
  const state = readPersistedJson(owner, 'fridge-weekly-state.json');
  state.cart.items = [{ id: 'cart-oat-milk', name: 'Oat milk', quantity: '2 cartons', category: 'Grocery', reason: 'Added for weekly meal plan', priority: 'high', inCart: true },
    { id: 'cart-eggs', name: 'Eggs', quantity: '1 item', category: 'Grocery', reason: 'Added for weekly meal plan', priority: 'high', inCart: true }];
  assert.equal(writePersistedJson(owner, 'fridge-weekly-state.json', state), true);
  assert.equal(mutateFridgeMealAndCart(owner, { action: 'log-order', name: 'Butter' }).groceryList.earlier.length, 2);
}

test('1.9.0: items a person had on the refrigerator\'s own list are moved to Shopping when the page opens, and forgotten here', async (t) => {
  dataFolder(t);
  withEarlierList('owner-moved');
  const shop = shoppingStandIn();
  const { page, context, tile, state } = await openRefrigerator('owner-moved', shop);
  try {
    await tile.click();
    await page.waitForFunction(() => document.getElementById('fridgeGroceryItems').textContent.includes('Eggs'));
    assert.deepEqual(shop.items.map((item) => item.title), ['Oat milk (2 cartons)', 'Eggs'], 'both are on Shopping\'s list, a real quantity kept in the words');
    assert.equal(await words(page, '#fridgeGroceryBadge'), 'In Shopping · 2 to buy');
    assert.deepEqual(state().groceryList.earlier, [], 'Smart Home holds them no longer');
    assert.deepEqual(state().orderHistory.map((order) => order.name), ['Butter'], 'what else the person kept is untouched');
    assert.equal(await page.locator('#fridgeGroceryEarlier').isVisible(), false);
    assert.equal(shop.asked.filter((line) => line === 'POST /api/purchasing/lists/default/items').length, 1, 'moved once, in one request');
  } finally { await context.close(); }
});

test('1.9.0: when Shopping does not answer for this account the earlier items stay, are shown, and nothing is lost', async (t) => {
  dataFolder(t);
  withEarlierList('owner-kept');
  const shop = shoppingStandIn({ open: false });
  const { page, context, tile, state } = await openRefrigerator('owner-kept', shop);
  try {
    await tile.click();
    await page.waitForFunction(() => /cannot open here/.test(document.getElementById('fridgeGroceryItems').textContent));
    assert.equal(await words(page, '#fridgeGroceryItems'), 'Your grocery list is kept by Shopping, which this account cannot open here.');
    assert.equal(await words(page, '#fridgeGroceryEarlier'), 'Still on the refrigerator\'s earlier list: Oat milk, Eggs.');
    assert.equal(await page.locator('#fridgeGroceryAdd').isVisible(), false, 'nothing can be added where Shopping is closed');
    assert.deepEqual(state().groceryList.earlier.map((item) => item.name), ['Oat milk', 'Eggs'], 'Smart Home still holds them');
    assert.deepEqual(shop.items, []);
  } finally { await context.close(); }
});
