/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the Shopping money and hand-off boundary, driven through the COMPILED route module with an in-memory pool and a recording Walmart provider. Pins: a line is priced from the catalog by exact productId and a browser-sent price is ignored; an id the catalog cannot confirm is refused 422 with nothing stored; another shopper's list is 403 before any provider call; /cart totals are exact integer cents with unpriced lines counted; a chat "checkout" returns a proposal and neither builds the deep link nor writes shop_purchase_history, while POST /checkout (the confirm) still does both; an anonymous caller is 401 before any query.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Read-only GETs under the native admission rule. GET /cart created a list for a shopper who had none, which the native host refuses on a GET (500 'SQL mutation requires original writer admission'). Pins: a fresh shopper's GET /cart answers 200 with listId null and creates nothing; every registered GET route answers a fresh shopper without attempting a write; the list is created by POST /lists and the following GET /cart reads it; and the admission double itself refuses a write in read mode, so a lazy INSERT reintroduced into any GET fails this suite.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WRITER_REFUSAL, fakePool, fakeProvider, admittedPool, callAdmitted, loadRoutes, authed, anon, call } = require('./shopping-routes-harness');

const SAVED_MOCK = process.env.MOCK_OIDC;
test.beforeEach(() => { delete process.env.MOCK_OIDC; });
test.after(() => { if (SAVED_MOCK === undefined) delete process.env.MOCK_OIDC; else process.env.MOCK_OIDC = SAVED_MOCK; });

const shopperList = (sub = 'shopper-a') => ({ list_id: 'list-a', user_sub: sub, status: 'active' });
const line = (over) => ({ item_id: `row-${Math.random()}`, list_id: 'list-a', user_sub: 'shopper-a', status: 'pending', quantity: 1, ...over });

test('a direct add is priced by the catalog, not by the price the browser sent', async () => {
  const { handlers, pool, provider } = loadRoutes({ pool: fakePool({ lists: [shopperList()] }) });
  const res = await call(handlers, 'post', '/lists/:listId/items', authed('shopper-a', {
    params: { listId: 'list-a' },
    body: { productId: '10450115', title: 'Milk', price: 0.01, brand: 'Forged', imageUrl: 'https://evil.example/x.png', quantity: 2 },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.item.unit_price, '2.78', 'the stored price is the catalog price');
  assert.equal(res.body.item.brand, 'Great Value', 'brand comes from the catalog row');
  assert.equal(res.body.item.image_url, null, 'the browser-sent image is not stored');
  assert.equal(res.body.item.quantity, 2);
  assert.deepEqual(provider.calls[0], ['search', '10450115', '12'], 'the lookup searches by the exact id first');
  assert.equal(pool.tables.items.length, 1);
});

test('an id the catalog cannot confirm is refused with nothing stored', async () => {
  const provider = fakeProvider({ search: () => ({ source: 'walmart', items: [{ productId: '99999999', title: 'Something else', price: 1 }] }) });
  const { handlers, pool } = loadRoutes({ pool: fakePool({ lists: [shopperList()] }), provider });
  const res = await call(handlers, 'post', '/lists/:listId/items', authed('shopper-a', {
    params: { listId: 'list-a' }, body: { productId: '12345', title: 'Made up', price: 1.5 },
  }));
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error, 'unknown_product');
  assert.equal(pool.tables.items.length, 0, 'a search hit that is a different product is not a match');
  assert.equal(provider.calls.length, 2, 'searched by id, then by the title hint');
});

test('the title hint finds the product when the id search does not, and is reduced to the safe query alphabet', async () => {
  const provider = fakeProvider({ search: (args) => (args[1] === '15206353'
    ? { source: 'walmart', items: [] }
    : { source: 'walmart', items: [{ productId: '15206353', title: 'Folgers Classic Roast Ground Coffee, 25.9 oz', price: 8.98 }] }) });
  const { handlers, pool } = loadRoutes({ pool: fakePool({ lists: [shopperList()] }), provider });
  const res = await call(handlers, 'post', '/lists/:listId/items', authed('shopper-a', {
    params: { listId: 'list-a' }, body: { productId: '15206353', title: '"Folgers™ Classic!" #1', price: 0 },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.item.unit_price, '8.98');
  assert.deepEqual(provider.calls[1], ['search', 'Folgers Classic 1', '12']);
  assert.equal(pool.tables.items.length, 1);
});

test('another shopper\'s list is refused before any catalog call', async () => {
  const { handlers, pool, provider } = loadRoutes({ pool: fakePool({ lists: [shopperList('shopper-b')] }) });
  const res = await call(handlers, 'post', '/lists/:listId/items', authed('shopper-a', {
    params: { listId: 'list-a' }, body: { productId: '10450115' },
  }));
  assert.equal(res.statusCode, 403);
  assert.equal(provider.calls.length, 0);
  assert.equal(pool.tables.items.length, 0);
});

test('a missing or malformed productId is 400 before any catalog call', async () => {
  const { handlers, provider } = loadRoutes({ pool: fakePool({ lists: [shopperList()] }) });
  for (const body of [{}, { productId: '' }, { productId: 'has space', title: 'Milk' }, { productId: 'x'.repeat(65) }, { title: '   ' }]) {
    const res = await call(handlers, 'post', '/lists/:listId/items', authed('shopper-a', { params: { listId: 'list-a' }, body }));
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(provider.calls.length, 0);
});

test('a title-only entry is a free-text list item: no product, no price, no catalog call, never in a total', async () => {
  const pool = fakePool({ lists: [shopperList()] });
  const { handlers, provider } = loadRoutes({ pool });
  const res = await call(handlers, 'post', '/lists/:listId/items', authed('shopper-a', {
    params: { listId: 'list-a' }, body: { title: '  Oat   milk ', quantity: 2, price: 99.99 },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.item.title, 'Oat milk');
  assert.equal(res.body.item.product_id, null);
  assert.equal(res.body.item.unit_price, null, 'a client price is ignored here too');
  assert.equal(provider.calls.length, 0);
  const cart = await call(handlers, 'get', '/cart', authed('shopper-a'));
  assert.equal(cart.body.totalCents, 0);
  assert.equal(cart.body.unpricedLines, 1);
});

test('/cart totals are exact integer cents, keep the existing shape, and count unpriced lines', async () => {
  const pool = fakePool({ lists: [shopperList()], items: [
    line({ unit_price: '2.78', quantity: 2 }), line({ unit_price: '0.24', quantity: 3 }),
    line({ unit_price: '0.10' }), line({ unit_price: '0.20' }), line({ unit_price: null }),
  ] });
  const { handlers } = loadRoutes({ pool });
  const res = await call(handlers, 'get', '/cart', authed('shopper-a'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).slice(0, 3), ['listId', 'items', 'total'], 'the shape other surfaces read is unchanged');
  assert.equal(res.body.listId, 'list-a');
  assert.equal(res.body.items.length, 5);
  assert.equal(res.body.totalCents, 658, '556 + 72 + 10 + 20');
  assert.equal(res.body.total, 6.58);
  assert.equal(res.body.unpricedLines, 1);
});

test('a chat checkout returns a proposal and builds no hand-off and no history row', async () => {
  const pool = fakePool({ lists: [shopperList()], items: [line({ product_id: '10450115', unit_price: '2.78', quantity: 2 })] });
  const { handlers, provider } = loadRoutes({ pool, reply: { say: 'Ready when you are.', show: [], add: [], remember: [], checkout: true } });
  const res = await call(handlers, 'post', '/chat', authed('shopper-a', { body: { message: 'check out please' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.checkout, null, 'no hand-off in the chat turn');
  assert.equal(res.body.proposal.actionId, 'checkout');
  assert.equal(res.body.proposal.totalCents, 556);
  assert.equal(res.body.proposal.total, 5.56);
  assert.match(res.body.proposal.summary, /2 items totalling \$5\.56/);
  assert.equal(provider.calls.filter((c) => c[0] === 'cart').length, 0, 'the deep link is not built');
  assert.equal(pool.tables.history.length, 0, 'no shop_purchase_history row');
  assert.equal(pool.sql.filter((q) => /shop_purchase_history/.test(q.text)).length, 0);
});

test('a chat turn that does not ask to check out carries no proposal', async () => {
  const pool = fakePool({ lists: [shopperList()], items: [line({ product_id: '10450115', unit_price: '2.78' })] });
  const { handlers } = loadRoutes({ pool, reply: { say: 'Anything else?', checkout: false } });
  const res = await call(handlers, 'post', '/chat', authed('shopper-a', { body: { message: 'milk' } }));
  assert.equal(res.body.proposal, null);
  assert.equal(res.body.checkout, null);
});

test('a chat add of an id outside the candidates is taken only on an exact catalog match', async () => {
  const provider = fakeProvider({ search: (args) => ({ source: 'walmart', items: args[1] === '777' ? [{ productId: '888', title: 'Wrong item', price: 3 }] : [] }) });
  const pool = fakePool({ lists: [shopperList()] });
  const { handlers } = loadRoutes({ pool, provider, reply: { say: 'Added.', add: [{ productId: '777', quantity: 1 }] } });
  const res = await call(handlers, 'post', '/chat', authed('shopper-a', { body: { message: 'add it' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.added, []);
  assert.equal(pool.tables.items.length, 0, 'the first search hit is not added in place of the named product');
});

test('the confirm (POST /checkout) builds the link and records the exact total', async () => {
  const pool = fakePool({ lists: [shopperList()], items: [
    line({ product_id: '10450115', unit_price: '2.78', quantity: 2 }), line({ product_id: '44390948', unit_price: '0.24', quantity: 3 }),
  ] });
  const { handlers, provider } = loadRoutes({ pool });
  const res = await call(handlers, 'post', '/checkout', authed('shopper-a', { body: { listId: 'list-a' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(provider.calls, [['cart', '10450115_2,44390948_3']]);
  assert.match(res.body.checkoutUrl, /^https:\/\/affil\.walmart\.com\/cart\/addToCart\?items=/);
  assert.equal(res.body.total, 6.28);
  assert.equal(res.body.totalCents, 628);
  assert.equal(pool.tables.history.length, 1);
  assert.equal(pool.tables.history[0].total, '6.28', 'recorded from integer cents, not a float');
});

test('another shopper\'s list cannot be checked out', async () => {
  const pool = fakePool({ lists: [shopperList()], items: [line({ product_id: '10450115', unit_price: '2.78' })] });
  const { handlers, provider } = loadRoutes({ pool });
  const res = await call(handlers, 'post', '/checkout', authed('shopper-b', { body: { listId: 'list-a' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(provider.calls.length, 0);
  assert.equal(pool.tables.history.length, 0);
});

test('an anonymous caller is 401 before any query or catalog call', async () => {
  const { handlers, pool, provider } = loadRoutes({ pool: fakePool({ lists: [shopperList()] }) });
  for (const [method, route, req] of [
    ['get', '/cart', anon()],
    ['post', '/lists/:listId/items', anon({ params: { listId: 'list-a' }, body: { productId: '10450115' } })],
    ['post', '/checkout', anon({ body: {} })],
    ['post', '/chat', anon({ body: { message: 'hi' } })],
  ]) {
    const res = await call(handlers, method, route, req);
    assert.equal(res.statusCode, 401, `${method} ${route}`);
  }
  assert.equal(pool.sql.length, 0);
  assert.equal(provider.calls.length, 0);
});

/** What a GET route needs in its request to do its real work for a fresh shopper. */
const GET_REQUESTS = { '/search': { query: { q: 'milk' } }, '/lists/:listId/items': { params: { listId: 'list-none' } } };

test('the admission double refuses a SQL write while a GET runs, as the native host does', async () => {
  const pool = admittedPool(fakePool());
  pool.mode = 'read';
  await assert.rejects(pool.query(`INSERT INTO shop_lists (user_sub, name) VALUES ($1, 'My List') RETURNING list_id`, ['x']),
    new RegExp(WRITER_REFUSAL));
  assert.deepEqual((await pool.query(`SELECT list_id FROM shop_lists WHERE user_sub = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, ['x'])).rows, []);
  assert.equal(pool.refused.length, 1);
});

test('a fresh shopper reads an empty cart under read-only admission: 200, listId null, nothing created', async () => {
  const pool = admittedPool(fakePool());
  const { handlers } = loadRoutes({ pool });
  const res = await callAdmitted(handlers, pool, 'get', '/cart', authed('shopper-new'));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { listId: null, items: [], total: 0, totalCents: 0, unpricedLines: 0 });
  assert.deepEqual(pool.refused, [], 'GET /cart attempted no write');
  assert.equal(pool.tables.lists.length, 0, 'reading the cart created no list');
});

test('every Shopping GET route answers a fresh shopper without attempting a SQL write', async () => {
  const pool = admittedPool(fakePool());
  const { handlers } = loadRoutes({ pool });
  const routes = [...handlers.get.keys()];
  assert.ok(routes.includes('/cart') && routes.length >= 13, `registered GET routes: ${routes.join(', ')}`);
  for (const route of routes) {
    const res = await callAdmitted(handlers, pool, 'get', route, authed('shopper-new', GET_REQUESTS[route] || {}));
    assert.ok(res.statusCode < 500, `GET ${route} answered ${res.statusCode}: ${JSON.stringify(res.body)}`);
  }
  assert.deepEqual(pool.refused, [], 'no GET route attempted a SQL write');
});

test('the first add creates the list through POST /lists, and GET /cart then reads it without writing', async () => {
  const pool = admittedPool(fakePool());
  const { handlers } = loadRoutes({ pool });
  const created = await callAdmitted(handlers, pool, 'post', '/lists', authed('shopper-new', { body: {} }));
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const listId = created.body.list.list_id;
  const added = await callAdmitted(handlers, pool, 'post', '/lists/:listId/items', authed('shopper-new', {
    params: { listId }, body: { productId: '10450115', title: 'Milk', quantity: 2 },
  }));
  assert.equal(added.statusCode, 200, JSON.stringify(added.body));
  const cart = await callAdmitted(handlers, pool, 'get', '/cart', authed('shopper-new'));
  assert.equal(cart.statusCode, 200, JSON.stringify(cart.body));
  assert.equal(cart.body.listId, listId);
  assert.equal(cart.body.items.length, 1);
  assert.equal(cart.body.totalCents, 556);
  assert.equal(pool.tables.lists.length, 1, 'exactly one list, created by the write');
  assert.deepEqual(pool.refused, []);
});
