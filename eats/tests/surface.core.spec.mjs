/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the Eats commerce smoke in real Chromium at 390 x 844, the actual surface iframed by a parent page over the compiled router: no horizontal overflow; a search and a restaurant's menu fill a grid the page scrolls to the end of; two dish adds show the server's exact total and send ids only; a chat order renders the shared client's confirm card with no hand-off POST and no window.open until Confirm, which fires exactly one POST /order and opens Uber Eats once; a relayed place_order from the floating assistant shows the same card and Cancel hands off nothing; relayed add_item and set_field land through the page's own functions; a chat-shown dish's Add button works; the parent receives `context` envelopes with the order total and `submit` for the confirm; no page errors.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The fixture now applies the native admission rule, so the page's /cart reads on a fresh diner answer the empty cart instead of creating one; the adds still create it, and no GET in the whole session may attempt a SQL write.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express, playwright and the shared bridge client.
 * Not part of the store-CI wildcard; run locally:
 *   OSHAL_CORE_DIR=<framework checkout> node --test tests/surface.core.spec.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixture, coreRequire } from './surface.core.fixture.mjs';

let f, browser, page, frame;
const errors = [];
const handoffs = () => f.requests.filter((r) => r.method === 'POST' && r.path === '/api/eats/order');
const opened = () => frame.evaluate(() => window.__opened);
const inbox = (op) => page.evaluate((want) => window.__inbox.filter((e) => e.op === want), op);
const total = (text) => frame.waitForFunction((want) => document.querySelector('#total').textContent === want, text);
/** Post one bridge op into the surface the way the cockpit relay delivers the floating assistant's. */
const relay = (op) => page.evaluate((message) => {
  document.getElementById('surface').contentWindow.postMessage({ channel: 'oshal-surface-bridge', v: 1, app: 'eats', ...message }, location.origin);
}, op);

test.before(async () => {
  f = await startFixture();
  const { chromium } = coreRequire('playwright');
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === f.origin ? route.continue() : route.abort()));
  await context.addInitScript(() => { window.__opened = []; window.open = (...args) => { window.__opened.push(args.map(String)); return null; }; });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(f.origin + '/harness.html?src=/api/eats/app');
  frame = page.frames().find((candidate) => new URL(candidate.url()).pathname === '/api/eats/app');
  assert.ok(frame, 'the surface is iframed');
  await frame.waitForSelector('#grid [data-store]');
  await frame.waitForFunction(() => Boolean(window.__bridge && window.__bridgeProducer));
});
test.after(async () => { await browser?.close(); await f?.close(); });

test('at 390 px the surface fits the width; a search and a menu fill a grid the page scrolls through', async () => {
  const width = () => frame.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  let fit = await width();
  assert.ok(fit.scroll <= fit.client, `no horizontal overflow (${fit.scroll} > ${fit.client})`);
  await frame.fill('#query', 'burgers');
  await frame.click('#searchBtn');
  await frame.waitForFunction(() => /Results for "burgers"/.test(document.querySelector('#sectionTitle').textContent)
    && document.querySelectorAll('#grid [data-store]').length === 1);
  await frame.locator('#grid [data-store="mcdonalds"]').click();
  await frame.waitForFunction(() => document.querySelectorAll('#grid [data-add]').length === 4);
  const scrolled = await frame.evaluate(async () => {
    const root = document.scrollingElement;
    const last = [...document.querySelectorAll('#grid .card')].pop();
    last.scrollIntoView({ block: 'end' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = last.getBoundingClientRect();
    return { scrollable: root.scrollHeight > root.clientHeight, top: root.scrollTop, visible: box.bottom <= innerHeight + 1 && box.top >= 0 };
  });
  assert.equal(scrolled.scrollable, true, 'the menu runs past one screen');
  assert.ok(scrolled.top > 0, 'the page scrolled');
  assert.equal(scrolled.visible, true, 'the last dish is reachable');
  fit = await width();
  assert.ok(fit.scroll <= fit.client, 'still no horizontal overflow on the menu');
});

test('two dish adds show the exact server total, and only ids leave the browser', async () => {
  await frame.locator('[data-add][data-product-id="mcd-bigmac"]').click();
  await total('$5.99');
  await frame.locator('[data-add][data-product-id="mcd-fries"]').click();
  await total('$9.98');
  const adds = f.requests.filter((r) => r.method === 'POST' && r.path === '/api/eats/cart/items');
  assert.equal(adds.length, 2);
  for (const add of adds) assert.deepEqual(Object.keys(add.body).sort(), ['productId', 'quantity', 'storeId']);
  assert.deepEqual(f.pool.tables.items.map((i) => [i.item_id, i.price]), [['mcd-bigmac', '5.99'], ['mcd-fries', '3.99']]);
  assert.equal(await frame.locator('#cartStore').innerText(), "McDonald's");
});

test('a chat order is a confirm card: nothing is handed off until Confirm, then exactly once', async () => {
  f.setReply({ say: 'Your order is ready.', show: [], add: [], remember: [], checkout: true });
  await frame.fill('#chatInput', 'order it');
  await frame.click('#chatSend');
  const card = frame.locator('#bridgeOptions .bridge-propose');
  await card.waitFor();
  assert.match(await card.innerText(), /2 items from McDonald's totalling \$9\.98/);
  assert.equal(handoffs().length, 0, 'no hand-off POST before the confirm');
  assert.deepEqual(await opened(), [], 'no window.open before the confirm');
  assert.equal(f.pool.tables.orders.length, 0, 'nothing recorded before the confirm');
  await frame.locator('#bridgeOptions .bridge-confirm').click();
  await frame.waitForFunction(() => window.__opened.length === 1);
  assert.equal(handoffs().length, 1, 'the confirm fires exactly one hand-off POST');
  assert.equal((await opened())[0][0], 'https://www.ubereats.com/store/mcdonalds');
  assert.equal(f.pool.tables.orders.length, 1);
  assert.equal(f.pool.tables.orders[0].total, '9.98');
  assert.deepEqual((await inbox('submit')).map((e) => [e.actionId, e.confirmed]), [['place_order', true]], 'the answer travels back to the assistant');
});

test('the floating assistant drives the same card: a relayed place_order proposes and Cancel hands off nothing', async () => {
  await relay({ op: 'custom', name: 'place_order', data: {} });
  await frame.locator('#bridgeOptions .bridge-propose').waitFor();
  assert.match(await frame.locator('#bridgeOptions .bridge-propose').innerText(), /totalling \$9\.98/);
  await frame.locator('#bridgeOptions .bridge-cancel').click();
  await frame.waitForFunction(() => !document.querySelector('#bridgeOptions .bridge-propose'));
  assert.equal(handoffs().length, 1, 'still only the one confirmed hand-off');
  assert.equal((await opened()).length, 1);
});

test('relayed add_item and set_field land through the page, and the parent sees the new order as context', async () => {
  await relay({ op: 'custom', name: 'add_item', data: { storeId: 'mcdonalds', productId: 'mcd-mccafe', price: 0.01 } });
  await total('$13.27');
  const last = f.requests.filter((r) => r.method === 'POST' && r.path === '/api/eats/cart/items').pop();
  assert.deepEqual(last.body, { storeId: 'mcdonalds', productId: 'mcd-mccafe', quantity: 1 });
  await relay({ op: 'set_field', field: 'address', value: '1 Example Way' });
  await page.waitForFunction(() => {
    const context = window.__inbox.filter((e) => e.op === 'context').pop();
    return context && context.fields.totalCents === 1327 && context.fields.address === '1 Example Way';
  });
  const context = (await inbox('context')).pop();
  assert.equal(context.app, 'eats');
  assert.equal(context.surface, 'eats-menu');
  assert.match(context.digest, /^Order: 3 lines from McDonald's, total \$13\.27/);
  assert.match(context.digest, /Deliver to: 1 Example Way/);
  assert.match(context.digest, /Showing: Concierge picks \(menu\)/, 'the chat order turn showed its picks');
  assert.match(context.digest, /Menu: .*mcdonalds\/mcd-bigmac Big Mac \$5\.99/);
  assert.ok(context.digest.length <= 4000);
  assert.deepEqual(context.customOps.map((o) => o.name), ['search', 'open_menu', 'add_item', 'place_order']);
  assert.ok((await inbox('field_change')).some((e) => e.field === 'address' && e.value === '1 Example Way'));
});

test('a dish the concierge shows in chat has a working Add button', async () => {
  f.setReply({ say: 'Try the ramen.', show: ['sh-ramen'], add: [], remember: [], checkout: false });
  await frame.fill('#chatInput', 'ramen');
  await frame.click('#chatSend');
  await frame.waitForSelector('[data-add][data-product-id="sh-ramen"]');
  await frame.locator('[data-add][data-product-id="sh-ramen"]').click();
  await total('$13.95');
  assert.equal(await frame.locator('#cartStore').innerText(), 'Sushi House', 'a dish from another restaurant starts a new order');
});

test('the page raised no errors', () => {
  assert.deepEqual(errors, []);
});

test('no GET in the whole session attempted a SQL write, which the native host would refuse', () => {
  assert.deepEqual(f.pool.refused, []);
});
