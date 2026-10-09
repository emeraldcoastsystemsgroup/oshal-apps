/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the Shopping commerce smoke in real Chromium at 390 x 844, the actual surface iframed by a parent page over the compiled router: no horizontal overflow; a search fills a grid the page scrolls to the end of; two grid adds show the server's exact total and send no price; a chat checkout renders the shared client's confirm card with no hand-off POST and no window.open until Confirm, which fires exactly one POST /checkout and opens the Walmart link once; a relayed custom checkout from the floating assistant shows the same card and Cancel hands off nothing; a relayed add_product and set_field land through the page's own functions; the parent receives `context` envelopes carrying the cart total and `submit` for the confirm; no page errors.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The fixture now applies the native admission rule, so GET /cart answers a fresh shopper listId null instead of creating the list. The first grid add must create the default list through exactly one POST /lists before its item POST, and no GET in the whole session may attempt a SQL write.
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
const handoffs = () => f.requests.filter((r) => r.method === 'POST' && r.path === '/api/purchasing/checkout');
const opened = () => frame.evaluate(() => window.__opened);
const inbox = (op) => page.evaluate((want) => window.__inbox.filter((e) => e.op === want), op);
/** Post one bridge op into the surface the way the cockpit relay delivers the floating assistant's. */
const relay = (op) => page.evaluate((message) => {
  document.getElementById('surface').contentWindow.postMessage({ channel: 'oshal-surface-bridge', v: 1, app: 'purchasing', ...message }, location.origin);
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
  await page.goto(f.origin + '/harness.html?src=/api/purchasing/chat');
  frame = page.frames().find((candidate) => new URL(candidate.url()).pathname === '/api/purchasing/chat');
  assert.ok(frame, 'the surface is iframed');
  await frame.waitForSelector('#grid .card');
  await frame.waitForFunction(() => Boolean(window.__bridge && window.__bridgeProducer));
});
test.after(async () => { await browser?.close(); await f?.close(); });

test('at 390 px the surface fits the width, and a search fills a grid the page scrolls through', async () => {
  const width = () => frame.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  let fit = await width();
  assert.ok(fit.scroll <= fit.client, `no horizontal overflow (${fit.scroll} > ${fit.client})`);
  await frame.fill('#query', 'great value');
  await frame.click('#searchBtn');
  await frame.waitForFunction(() => /Results for "great value"/.test(document.querySelector('#sectionTitle').textContent)
    && document.querySelectorAll('#grid .card').length === 4);
  const scrolled = await frame.evaluate(async () => {
    const root = document.scrollingElement;
    const last = [...document.querySelectorAll('#grid .card')].pop();
    last.scrollIntoView({ block: 'end' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = last.getBoundingClientRect();
    return { scrollable: root.scrollHeight > root.clientHeight, top: root.scrollTop, visible: box.bottom <= innerHeight + 1 && box.top >= 0 };
  });
  assert.equal(scrolled.scrollable, true, 'the results run past one screen');
  assert.ok(scrolled.top > 0, 'the page scrolled');
  assert.equal(scrolled.visible, true, 'the last result is reachable');
  fit = await width();
  assert.ok(fit.scroll <= fit.client, 'still no horizontal overflow with results');
});

test('two grid adds show the exact server total, and no price leaves the browser', async () => {
  await frame.locator('[data-add="10450115"]').click();
  await frame.waitForFunction(() => document.querySelector('#total').textContent === '$2.78');
  await frame.locator('[data-add="23656343"]').click();
  await frame.waitForFunction(() => document.querySelector('#total').textContent === '$4.90');
  const adds = f.requests.filter((r) => r.method === 'POST' && /\/lists\/[^/]+\/items$/.test(r.path));
  assert.equal(adds.length, 2);
  const creations = f.requests.filter((r) => r.method === 'POST' && r.path === '/api/purchasing/lists');
  assert.equal(creations.length, 1, 'the first add creates the default list once, through POST /lists');
  assert.ok(f.requests.indexOf(creations[0]) < f.requests.indexOf(adds[0]), 'the list exists before the first item POST');
  assert.equal(f.pool.tables.lists.length, 1);
  for (const add of adds) assert.equal('price' in add.body, false, 'the surface sends no price');
  assert.deepEqual(f.pool.tables.items.map((i) => [i.product_id, i.unit_price]), [['10450115', '2.78'], ['23656343', '2.12']]);
  assert.match(await frame.locator('#cartMeta').innerText(), /2 cart lines/);
});

test('a chat checkout is a confirm card: nothing is handed off until Confirm, then exactly once', async () => {
  f.setReply({ say: 'Your cart is ready.', show: [], add: [], remember: [], checkout: true });
  await frame.fill('#chatInput', 'check out please');
  await frame.click('#chatSend');
  const card = frame.locator('#bridgeOptions .bridge-propose');
  await card.waitFor();
  assert.match(await card.innerText(), /2 items totalling \$4\.90/);
  assert.equal(handoffs().length, 0, 'no hand-off POST before the confirm');
  assert.deepEqual(await opened(), [], 'no window.open before the confirm');
  assert.equal(f.pool.tables.history.length, 0, 'nothing recorded before the confirm');
  await frame.locator('#bridgeOptions .bridge-confirm').click();
  await frame.waitForFunction(() => window.__opened.length === 1);
  assert.equal(handoffs().length, 1, 'the confirm fires exactly one hand-off POST');
  assert.equal((await opened())[0][0], 'https://affil.walmart.com/cart/addToCart?items=10450115_1%2C23656343_1');
  assert.equal(f.pool.tables.history.length, 1);
  assert.equal(f.pool.tables.history[0].total, '4.90');
  assert.deepEqual((await inbox('submit')).map((e) => [e.actionId, e.confirmed]), [['checkout', true]], 'the answer travels back to the assistant');
});

test('the floating assistant drives the same card: a relayed checkout proposes and Cancel hands off nothing', async () => {
  await relay({ op: 'custom', name: 'checkout', data: {} });
  await frame.locator('#bridgeOptions .bridge-propose').waitFor();
  assert.match(await frame.locator('#bridgeOptions .bridge-propose').innerText(), /totalling \$4\.90/);
  await frame.locator('#bridgeOptions .bridge-cancel').click();
  await frame.waitForFunction(() => !document.querySelector('#bridgeOptions .bridge-propose'));
  assert.equal(handoffs().length, 1, 'still only the one confirmed hand-off');
  assert.equal((await opened()).length, 1);
});

test('relayed add_product and set_field land through the page, and the parent sees the new cart as context', async () => {
  await relay({ op: 'custom', name: 'add_product', data: { productId: '15206353', price: 0.01 } });
  await frame.waitForFunction(() => document.querySelector('#total').textContent === '$13.88');
  const last = f.requests.filter((r) => r.method === 'POST' && /\/items$/.test(r.path)).pop();
  assert.deepEqual(Object.keys(last.body).sort(), ['itemKey', 'productId', 'quantity', 'reason', 'title']);
  await relay({ op: 'set_field', field: 'shipAddress', value: '1 Example Way' });
  await page.waitForFunction(() => {
    const context = window.__inbox.filter((e) => e.op === 'context').pop();
    return context && context.fields.totalCents === 1388 && context.fields.shipAddress === '1 Example Way';
  });
  const context = (await inbox('context')).pop();
  assert.equal(context.app, 'purchasing');
  assert.equal(context.v, 1);
  assert.equal(context.surface, 'shopping');
  assert.match(context.digest, /^Cart: 3 lines, total \$13\.88/);
  assert.match(context.digest, /Ship to: 1 Example Way/);
  assert.ok(context.digest.length <= 4000);
  assert.deepEqual(context.customOps.map((o) => o.name), ['search', 'add_product', 'checkout']);
  assert.ok((await inbox('field_change')).some((e) => e.field === 'shipAddress' && e.value === '1 Example Way'));
});

test('the page raised no errors', () => {
  assert.deepEqual(errors, []);
});

test('no GET in the whole session attempted a SQL write, which the native host would refuse', () => {
  assert.deepEqual(f.pool.refused, []);
});
