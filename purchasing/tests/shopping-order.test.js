/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Shopping 1.5.0: the grocery order is made from the list. On the test installation (2026-11-14) "add eggs, bread and bananas to my grocery list" then "order the groceries" ended with nothing ordered: checkout takes only lines matched to a Walmart product, a written item has none, and the native kernel runs no Walmart operation (POST /checkout answered 500 there, and a link to an EMPTY Walmart cart where a rail exists). POST /order makes the order from every item still to buy: each with the address that finds it at Walmart, one cart link for lines already matched to a product where the installation has that rail, and a record in the purchase history. It never contacts a store for a written item and never says anything was bought. The chain is driven through the tools' own endpoints as the kernel renders them (add several, then order), on the compiled routes.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakePool, fakeProvider, admittedPool, callAdmitted, loadRoutes, authed, anon, call } = require('./shopping-routes-harness');

const ROOT = path.resolve(__dirname, '..', '..');
const yaml = require(path.join(ROOT, 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'purchasing', 'oshal-app.yaml'), 'utf8'));
const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'purchasing', 'personas', 'shopping-concierge.yaml'), 'utf8'));
const page = fs.readFileSync(path.join(ROOT, 'purchasing', 'tools', 'shopping-dashboard.html'), 'utf8');
const SUB = 'shopper-a';

/** The native kernel's Walmart answer (crates/host-process/bridge/provider_rails.js): status says not connected, every other operation is refused. */
function nativeRail() {
  const refused = () => { throw Object.assign(new Error('Walmart provider operation (Walmart is not connected: no native connector)'), { status: 503 }); };
  return fakeProvider({ status: () => ({ configured: false, connected: false, live: false, mode: 'not_connected' }), search: refused, cart: refused, deals: refused });
}
/** A list with the given lines for SUB. */
function seeded(lines) {
  return { lists: [{ list_id: 'list-a', user_sub: SUB, name: 'My List', status: 'active' }],
    items: lines.map((line, n) => ({ item_id: `item-${n + 1}`, list_id: 'list-a', user_sub: SUB, retailer: 'walmart', product_id: null, quantity: 1, unit_price: null, status: 'pending', ...line })) };
}
const written = () => seeded([{ title: 'eggs' }, { title: 'bread' }, { title: 'bananas', quantity: 6 }]);
/** A manifest tool's endpoint as the kernel renders it (crates/oshald/src/package_api_tools.rs): method and mount-relative route. */
function endpoint(name) {
  const tool = manifest.tools.find((entry) => entry.name === name);
  assert.ok(tool, `${name} is declared`);
  const [method, target] = tool.executor.apiEndpoint.split(' ');
  assert.ok(target.startsWith('/api/purchasing/'), `${name} stays inside the package mount`);
  return { tool, method: method.toLowerCase(), route: target.slice('/api/purchasing'.length).replace('/lists/default/', '/lists/:listId/') };
}

test('on the native kernel the order is made from the written items: each with its place at Walmart, recorded, and no store is contacted', async () => {
  const provider = nativeRail(), pool = admittedPool(fakePool(written()));
  const { handlers } = loadRoutes({ pool, provider });
  const res = await callAdmitted(handlers, pool, 'post', '/order', authed(SUB, { body: {} }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.items.map((item) => [item.title, item.quantity, item.findUrl]), [
    ['eggs', 1, 'https://www.walmart.com/search?q=eggs'], ['bread', 1, 'https://www.walmart.com/search?q=bread'], ['bananas', 6, 'https://www.walmart.com/search?q=bananas']]);
  assert.deepEqual([res.body.ok, res.body.retailer, res.body.cartUrl, res.body.listId, res.body.openUrl], [true, 'Walmart', null, 'list-a', '/cockpit/?app=purchasing']);
  assert.match(res.body.orderRef, /^order-/);
  assert.match(res.body.note, /add it to your cart and pay/);
  assert.match(res.body.note, /Nothing is bought or charged here/);
  assert.deepEqual(provider.calls.filter(([operation]) => operation !== 'status'), [], 'a written item never reaches the Walmart rail');
  assert.equal(pool.tables.history.length, 1);
  const kept = pool.tables.history[0];
  assert.deepEqual([kept.user_sub, kept.order_ref, kept.handoff_url, kept.total], [SUB, res.body.orderRef, null, '0.00']);
  assert.deepEqual(JSON.parse(kept.items).map((line) => [line.title, line.quantity]), [['eggs', 1], ['bread', 1], ['bananas', 6]]);
  assert.deepEqual(pool.tables.items.map((line) => line.status), ['pending', 'pending', 'pending'], 'ordering marks nothing bought: the shopper ticks an item when it is in their cart');
});

test('with a Walmart rail, lines matched to a product go in one cart link and written lines keep their search address', async () => {
  const provider = fakeProvider(), pool = fakePool(seeded([
    { title: 'Great Value 2% Reduced Fat Milk, 1 Gallon', product_id: '10450115', quantity: 2, unit_price: '2.78', product_url: 'https://www.walmart.com/ip/10450115' },
    { title: 'eggs' }, { title: 'Fresh Bananas, each', product_id: '44390948', quantity: 6, unit_price: '0.24' }]));
  const { handlers } = loadRoutes({ pool, provider });
  const res = await call(handlers, 'post', '/order', authed(SUB, { body: {} }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(provider.calls.filter(([operation]) => operation === 'cart'), [['cart', '10450115_2,44390948_6']]);
  assert.equal(res.body.cartUrl, 'https://affil.walmart.com/cart/addToCart?items=10450115_2%2C44390948_6');
  assert.deepEqual(res.body.items.map((item) => [item.title, item.inCartLink, item.findUrl]), [
    ['Great Value 2% Reduced Fat Milk, 1 Gallon', true, 'https://www.walmart.com/ip/10450115'], ['eggs', false, 'https://www.walmart.com/search?q=eggs'],
    ['Fresh Bananas, each', true, 'https://www.walmart.com/search?q=Fresh%20Bananas%2C%20each']]);
  assert.deepEqual([res.body.totalCents, res.body.total, res.body.unpricedLines], [700, 7, 1]);
  assert.deepEqual([pool.tables.history.length, pool.tables.history[0].handoff_url, pool.tables.history[0].total], [1, res.body.cartUrl, '7.00']);
});

test('matched lines on the native kernel still get their place at Walmart, and the missing rail does not fail the order', async () => {
  const provider = nativeRail(), pool = fakePool(seeded([{ title: 'Folgers Classic Roast Ground Coffee, 25.9 oz', product_id: '15206353', unit_price: '8.98' }, { title: 'eggs' }]));
  const { handlers } = loadRoutes({ pool, provider });
  const res = await call(handlers, 'post', '/order', authed(SUB, { body: {} }));
  assert.deepEqual([res.statusCode, res.body.cartUrl, res.body.items.length], [200, null, 2]);
  assert.deepEqual(res.body.items.map((item) => item.inCartLink), [false, false]);
  assert.deepEqual(provider.calls.map(([operation]) => operation), ['status'], 'only the status probe is asked');
});

test('nothing left to buy makes no order: an empty list, only ticked or removed lines, or no list at all', async () => {
  const cases = [seeded([]), seeded([{ title: 'eggs', status: 'done' }, { title: 'bread', status: 'removed' }]), {}];
  for (const data of cases) {
    const provider = nativeRail(), pool = admittedPool(fakePool(data));
    const { handlers } = loadRoutes({ pool, provider });
    const res = await callAdmitted(handlers, pool, 'post', '/order', authed(SUB, { body: {} }));
    assert.deepEqual([res.statusCode, res.body.error], [409, 'nothing_to_order'], JSON.stringify(res.body));
    assert.match(res.body.message, /nothing left to buy/);
    assert.deepEqual([pool.tables.history.length, provider.calls.length, pool.tables.lists.length], [0, 0, (data.lists || []).length], 'nothing recorded, no rail asked, no list made');
  }
});

test('ticked and removed lines are left out of the order', async () => {
  const pool = fakePool(seeded([{ title: 'eggs' }, { title: 'bread', status: 'done' }, { title: 'bananas', status: 'removed' }, { title: 'coffee' }]));
  const { handlers } = loadRoutes({ pool, provider: nativeRail() });
  const res = await call(handlers, 'post', '/order', authed(SUB, { body: {} }));
  assert.deepEqual(res.body.items.map((item) => item.title), ['eggs', 'coffee']);
});

test('an item\'s words are carried into the address as text, never as address syntax', async () => {
  const pool = fakePool(seeded([{ title: 'AA batteries & "foil" 50% off? #1 /x' }, { title: 'café au lait' }]));
  const { handlers } = loadRoutes({ pool, provider: nativeRail() });
  const res = await call(handlers, 'post', '/order', authed(SUB, { body: {} }));
  assert.deepEqual(res.body.items.map((item) => item.findUrl), [
    'https://www.walmart.com/search?q=AA%20batteries%20%26%20%22foil%22%2050%25%20off%3F%20%231%20%2Fx', 'https://www.walmart.com/search?q=caf%C3%A9%20au%20lait']);
  for (const item of res.body.items) assert.equal(new URL(item.findUrl).origin, 'https://www.walmart.com');
});

test('the order is the signed-in shopper\'s own list: nobody signed in is refused, and another shopper orders nothing of it', async () => {
  const pool = fakePool(written());
  const { handlers } = loadRoutes({ pool, provider: nativeRail() });
  assert.equal((await call(handlers, 'post', '/order', anon({ body: {} }))).statusCode, 401);
  const other = await call(handlers, 'post', '/order', authed('shopper-b', { body: { listId: 'list-a' } }));
  assert.deepEqual([other.statusCode, other.body.error], [409, 'nothing_to_order'], 'a list id in the body is not read: the order is always from the caller\'s own list');
  assert.equal(pool.tables.history.length, 0);
});

test('the grocery chain through the tools as the kernel renders them: add several, then order, and the order is those items', async () => {
  const provider = nativeRail(), pool = admittedPool(fakePool());
  const { handlers } = loadRoutes({ pool, provider });
  const add = endpoint('shopping-list-add-many'), order = endpoint('shopping-order');
  const added = await callAdmitted(handlers, pool, add.method, add.route, authed(SUB, { params: { listId: 'default' }, body: { items: [{ title: 'eggs' }, { title: 'bread' }, { title: 'bananas' }] } }));
  assert.equal(added.statusCode, 200, JSON.stringify(added.body));
  const made = await callAdmitted(handlers, pool, order.method, order.route, authed(SUB, { body: {} }));
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  assert.deepEqual(made.body.items.map((item) => item.title), ['eggs', 'bread', 'bananas']);
  assert.equal(made.body.listId, added.body.items[0].list_id, 'the order is made from the list the add wrote to');
  assert.deepEqual(pool.refused, []);
});

test('POST /checkout no longer hands Walmart an empty cart: a list of written items answers 400 and records nothing', async () => {
  const provider = fakeProvider(), pool = fakePool(written());
  const { handlers } = loadRoutes({ pool, provider });
  const res = await call(handlers, 'post', '/checkout', authed(SUB, { body: {} }));
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.deepEqual([provider.calls.filter(([operation]) => operation === 'cart').length, pool.tables.history.length], [0, 0]);
  assert.match(res.body.error, /matched to a Walmart product/);
});

test('one tool makes the order, held for the shopper\'s approval; the add tools stay as they were', () => {
  const { tool } = endpoint('shopping-order');
  assert.deepEqual([tool.executor.apiEndpoint, tool.requiresApproval, tool.defaultAuthMode], ['POST /api/purchasing/order', true, 'ask']);
  assert.match(tool.cardText, /Nothing is bought here\.$/);
  for (const words of [/order the groceries/, /grocery and shopping list/, /adds the items to their Walmart cart and pays at Walmart/, /nothing is bought or charged here/]) assert.match(tool.description, words);
  assert.deepEqual(tool.inputSchema, { type: 'object', properties: {} }, 'the order takes no input: it is always the shopper\'s own list');
  assert.equal(manifest.tools.find((entry) => entry.name === 'prepare-checkout'), undefined, 'the checkout tool that could only answer an empty cart or a refusal is gone');
  const add = manifest.tools.find((entry) => entry.name === 'shopping-list-add');
  assert.equal(add.requiresApproval, true);
  assert.match(add.description, /Call it as soon as they ask/, 'the kernel pins these words (crates/packages/tests/store_tool_contracts.rs)');
  for (const name of ['shopping-list-add', 'shopping-list-add-many']) assert.match(manifest.tools.find((entry) => entry.name === name).description, /grocery/, `${name} says the grocery list`);
});

test('the description says Shopping keeps the grocery and shopping list and makes the order from it', () => {
  const text = String(manifest.description).split(/\s+/).join(' ');
  assert.match(text, /Keeps your grocery and shopping list and makes the grocery order from it/);
  assert.match(text, /add it to your Walmart cart and pay there/);
  assert.match(text, /Nothing is bought or charged here/);
  assert.ok(text.length <= 1500);
  assert.match(manifest.version, /^1\.5\.\d+$/);
});

test('the concierge orders with the tool, names every item with its link, and never says anything was bought', () => {
  const text = persona.perspective;
  assert.match(text, /shopping-order/);
  assert.match(text, /never say (?:an order was placed|anything was bought)/i);
  assert.match(text, /grocery list/);
  assert.doesNotMatch(text, /prepare-checkout/);
});

test('the List screen has Order: it makes the order and shows each item with Find at Walmart, opened in a new tab', () => {
  assert.match(page, /<button id="order"[^>]*>Order<\/button>/);
  assert.match(page, /api\('\/order', \{ method: 'POST', body: '\{\}' \}\)/);
  assert.match(page, /Find at Walmart/);
  assert.match(page, /rel = 'noopener'/);
  assert.doesNotMatch(page, /id="checkout"/, 'Order replaces the Checkout button that was drawn only with a rail');
  assert.doesNotMatch(page, /innerHTML = [^'"]*\+/, 'server text is never concatenated into markup');
});
