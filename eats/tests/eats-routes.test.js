/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the Eats money and hand-off boundary, driven through the COMPILED route module with an in-memory pool and a recording Uber Eats provider. Pins: a line is priced from the restaurant's menu by exact storeId + productId and a browser-sent price, title or store is ignored; a dish the menu does not list (or one from another restaurant) is 422 with nothing stored; malformed ids are 400 before any provider call; a store switch starts a new order; /cart totals are exact integer cents with unpriced lines counted; a chat "checkout" returns a proposal and neither builds the deep link nor writes eats_orders, while POST /order (the confirm) does both; one diner cannot remove another's line; an anonymous caller is 401 before any query.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Read-only GETs under the native admission rule. GET /cart created the diner's cart when none existed, which the native host refuses on a GET (500 'SQL mutation requires original writer admission'). Pins: a fresh diner's GET /cart answers 200 with cartId, storeId and storeName null and creates nothing; every registered GET route answers a fresh diner without attempting a write; the first add (POST /cart/items) creates the cart and the following GET /cart reads it; and the admission double itself refuses a write in read mode.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WRITER_REFUSAL, fakePool, fakeProvider, admittedPool, callAdmitted, loadRoutes, authed, anon, call } = require('./eats-routes-harness');

const SAVED_MOCK = process.env.MOCK_OIDC;
test.beforeEach(() => { delete process.env.MOCK_OIDC; });
test.after(() => { if (SAVED_MOCK === undefined) delete process.env.MOCK_OIDC; else process.env.MOCK_OIDC = SAVED_MOCK; });

const cart = (sub = 'diner-a', over = {}) => ({ cart_id: `cart-${sub}`, user_sub: sub, store_id: 'chipotle', store_name: 'Chipotle Mexican Grill', status: 'active', ...over });
const line = (over) => ({ row_id: `row-${Math.random()}`, cart_id: 'cart-diner-a', user_sub: 'diner-a', store_id: 'chipotle', status: 'pending', quantity: 1, ...over });
const add = (handlers, sub, body) => call(handlers, 'post', '/cart/items', authed(sub, { body }));

test('a dish is priced from the restaurant menu, not by what the browser sent', async () => {
  const { handlers, pool, provider } = loadRoutes();
  const res = await add(handlers, 'diner-a', { storeId: 'chipotle', productId: 'chp-burrito', price: 0.01, title: 'Forged', storeName: 'Elsewhere', imageUrl: 'https://evil.example/x.png', quantity: 2 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(provider.calls, [['menu', 'chipotle']]);
  const stored = pool.tables.items[0];
  assert.equal(stored.price, '9.95', 'the menu price');
  assert.equal(stored.title, 'Chicken Burrito');
  assert.equal(stored.store_name, 'Chipotle Mexican Grill');
  assert.equal(stored.image_url, null, 'the browser-sent image is not stored');
  assert.equal(stored.quantity, 2);
  assert.equal(res.body.totalCents, 1990);
  assert.equal(res.body.total, 19.9);
  assert.equal(res.body.storeName, 'Chipotle Mexican Grill');
});

test('a dish the menu does not list, or one from another restaurant, is refused with nothing stored', async () => {
  const { handlers, pool } = loadRoutes();
  for (const body of [{ storeId: 'chipotle', productId: 'chp-lobster', price: 1 }, { storeId: 'mcdonalds', productId: 'chp-burrito', price: 1 }, { storeId: 'nowhere', productId: 'x-1' }]) {
    const res = await add(handlers, 'diner-a', body);
    assert.equal(res.statusCode, 422, JSON.stringify(body));
    assert.equal(res.body.error, 'unknown_item');
  }
  assert.equal(pool.tables.items.length, 0);
});

test('malformed ids are refused before any provider call', async () => {
  const { handlers, provider } = loadRoutes();
  for (const body of [{}, { storeId: 'chipotle' }, { productId: 'chp-bowl' }, { storeId: 'chip otle', productId: 'chp-bowl' }, { storeId: 'chipotle', productId: 'x'.repeat(65) }]) {
    const res = await add(handlers, 'diner-a', body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(provider.calls.length, 0);
});

test('adding from another restaurant starts a new order and the total follows exactly', async () => {
  const { handlers, pool } = loadRoutes();
  await add(handlers, 'diner-a', { storeId: 'chipotle', productId: 'chp-chips', quantity: 1 });
  const res = await add(handlers, 'diner-a', { storeId: 'mcdonalds', productId: 'mcd-fries', quantity: 3 });
  assert.equal(res.body.storeSwitched, true);
  assert.equal(res.body.storeName, "McDonald's");
  assert.deepEqual(res.body.items.map((i) => [i.item_id, i.price, i.quantity]), [['mcd-fries', '3.99', 3]]);
  assert.equal(res.body.totalCents, 1197);
  assert.equal(pool.tables.items.filter((i) => i.status === 'removed').length, 1);
});

test('/cart totals are exact integer cents, keep the existing shape, and count unpriced lines', async () => {
  const pool = fakePool({ carts: [cart()], items: [
    line({ item_id: 'chp-tacos', price: '9.45', quantity: 2 }), line({ item_id: 'chp-chips', price: '4.55' }),
    line({ item_id: 'x-legacy', price: null }),
  ] });
  const { handlers } = loadRoutes({ pool });
  const res = await call(handlers, 'get', '/cart', authed('diner-a'));
  assert.deepEqual(Object.keys(res.body).slice(0, 5), ['cartId', 'storeId', 'storeName', 'items', 'total']);
  assert.equal(res.body.totalCents, 2345, '1890 + 455');
  assert.equal(res.body.total, 23.45);
  assert.equal(res.body.unpricedLines, 1);
});

test('a chat checkout returns a proposal and builds no hand-off and no order row', async () => {
  const pool = fakePool({ carts: [cart()], items: [line({ item_id: 'chp-bowl', price: '9.95', quantity: 2 })] });
  const { handlers, provider } = loadRoutes({ pool, reply: { say: 'Ready when you are.', show: [], add: [], remember: [], checkout: true } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'order it' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.checkout, null);
  assert.equal(res.body.proposal.actionId, 'place_order');
  assert.equal(res.body.proposal.store, 'Chipotle Mexican Grill');
  assert.equal(res.body.proposal.totalCents, 1990);
  assert.match(res.body.proposal.summary, /2 items from Chipotle Mexican Grill totalling \$19\.90/);
  assert.equal(provider.calls.filter((c) => c[0] === 'order').length, 0, 'no deep link');
  assert.equal(pool.tables.orders.length, 0, 'no eats_orders row');
  assert.equal(res.body.cart.totalCents, 1990);
});

test('a chat add takes the dish from the menu candidates at the menu price', async () => {
  const { handlers, pool } = loadRoutes({ reply: { say: 'Added a bowl.', add: [{ productId: 'chp-bowl', quantity: 1 }, { productId: 'invented-1', quantity: 1 }] } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'burrito bowl' } }));
  assert.deepEqual(res.body.added.map((a) => [a.productId, a.price]), [['chp-bowl', 9.95]], 'an id outside the candidates is dropped');
  assert.deepEqual(pool.tables.items.map((i) => [i.item_id, i.price]), [['chp-bowl', '9.95']]);
  assert.equal(res.body.proposal, null);
});

test('the confirm (POST /order) builds the link once and records the exact total', async () => {
  const pool = fakePool({ carts: [cart()], items: [line({ item_id: 'chp-bowl', price: '9.95', quantity: 2 }), line({ item_id: 'chp-chips', price: '4.55' })] });
  const { handlers, provider } = loadRoutes({ pool });
  const res = await call(handlers, 'post', '/order', authed('diner-a'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(provider.calls, [['order', 'chipotle']]);
  assert.equal(res.body.totalCents, 2445);
  assert.equal(res.body.total, 24.45);
  assert.equal(pool.tables.orders.length, 1);
  assert.equal(pool.tables.orders[0].total, '24.45');
});

test('one diner cannot remove another diner\'s line', async () => {
  const pool = fakePool({ carts: [cart(), cart('diner-b', { cart_id: 'cart-diner-b' })], items: [line({ row_id: 'row-a', item_id: 'chp-bowl', price: '9.95' })] });
  const { handlers } = loadRoutes({ pool });
  await call(handlers, 'delete', '/cart/items/:rowId', authed('diner-b', { params: { rowId: 'row-a' } }));
  assert.equal(pool.tables.items[0].status, 'pending');
  const own = await call(handlers, 'delete', '/cart/items/:rowId', authed('diner-a', { params: { rowId: 'row-a' } }));
  assert.equal(pool.tables.items[0].status, 'removed');
  assert.equal(own.body.totalCents, 0);
});

test('an anonymous caller is 401 before any query or provider call', async () => {
  const { handlers, pool, provider } = loadRoutes();
  for (const [method, route, req] of [
    ['get', '/cart', anon()],
    ['post', '/cart/items', anon({ body: { storeId: 'chipotle', productId: 'chp-bowl' } })],
    ['post', '/order', anon()],
    ['post', '/chat', anon({ body: { message: 'hi' } })],
  ]) {
    const res = await call(handlers, method, route, req);
    assert.equal(res.statusCode, 401, `${method} ${route}`);
  }
  assert.equal(pool.sql.length, 0);
  assert.equal(provider.calls.length, 0);
});

/** What a GET route needs in its request to do its real work for a fresh diner. */
const GET_REQUESTS = { '/search': { query: { q: 'tacos' } }, '/menu': { query: { storeId: 'chipotle' } } };
/** The empty cart a diner with no cart reads. */
const NO_CART = { cartId: null, storeId: null, storeName: null, items: [], total: 0, totalCents: 0, unpricedLines: 0 };

test('the admission double refuses a SQL write while a GET runs, as the native host does', async () => {
  const pool = admittedPool(fakePool());
  pool.mode = 'read';
  await assert.rejects(pool.query('INSERT INTO eats_carts (user_sub) VALUES ($1) RETURNING *', ['x']), new RegExp(WRITER_REFUSAL));
  assert.deepEqual((await pool.query(`SELECT * FROM eats_carts WHERE user_sub = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, ['x'])).rows, []);
  assert.equal(pool.refused.length, 1);
});

test('a fresh diner reads an empty cart under read-only admission: 200, no cart created', async () => {
  const pool = admittedPool(fakePool());
  const { handlers } = loadRoutes({ pool });
  const res = await callAdmitted(handlers, pool, 'get', '/cart', authed('diner-new'));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, NO_CART);
  assert.deepEqual(pool.refused, [], 'GET /cart attempted no write');
  assert.equal(pool.tables.carts.length, 0, 'reading the cart created no cart');
});

test('every Eats GET route answers a fresh diner without attempting a SQL write', async () => {
  const pool = admittedPool(fakePool());
  const { handlers } = loadRoutes({ pool });
  const routes = [...handlers.get.keys()];
  assert.ok(routes.includes('/cart') && routes.length >= 9, `registered GET routes: ${routes.join(', ')}`);
  for (const route of routes) {
    const res = await callAdmitted(handlers, pool, 'get', route, authed('diner-new', GET_REQUESTS[route] || {}));
    assert.ok(res.statusCode < 500, `GET ${route} answered ${res.statusCode}: ${JSON.stringify(res.body)}`);
  }
  assert.deepEqual(pool.refused, [], 'no GET route attempted a SQL write');
});

test('the first add creates the cart, and GET /cart then reads it without writing', async () => {
  const pool = admittedPool(fakePool());
  const { handlers } = loadRoutes({ pool });
  const added = await callAdmitted(handlers, pool, 'post', '/cart/items', authed('diner-new', { body: { storeId: 'chipotle', productId: 'chp-bowl', quantity: 2 } }));
  assert.equal(added.statusCode, 200, JSON.stringify(added.body));
  const res = await callAdmitted(handlers, pool, 'get', '/cart', authed('diner-new'));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.cartId, pool.tables.carts[0].cart_id);
  assert.equal(res.body.storeId, 'chipotle');
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.totalCents, 1990);
  assert.equal(pool.tables.carts.length, 1, 'exactly one cart, created by the write');
  assert.deepEqual(pool.refused, []);
});
