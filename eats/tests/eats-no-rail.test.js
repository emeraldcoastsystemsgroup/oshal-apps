/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Eats with no Uber Eats rail, through the COMPILED route module. The provider double answers like the native kernel (status not_connected; search, menu and order refuse 503 and would fail the call). The concierge turn answers, never touches search or menu, and its prompt states the fact and forbids "connect Uber Eats"; /config names the absent rail. Red on the previous route, whose chat searched first and 503'd before the concierge spoke.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | With no rail the prompt says no search ran (sweep 7: the concierge reported 'no vegetarian restaurants in the search results' for a search that never happened); with a rail an empty search still reads as no results.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | No rail now means the package's own catalog (./uber-catalog): the native double's status still answers not_connected, and the turn, /search, /menu, the cart and the order handoff answer from the curated catalog with an ubereats.com link while only the status probe reaches the refusing provider. /config names rail 'catalog'. Red on the previous route, which searched nothing and offered no link, so Jarvis invented an order.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeProvider, loadRoutes, authed, call } = require('./eats-routes-harness');

const refuse = () => { throw Object.assign(new Error('Uber Eats provider operation is unavailable in this native runtime'), { status: 503 }); };
const nativeProvider = () => fakeProvider({
  status: () => ({ configured: false, connected: false, live: false, mode: 'not_connected', provider: 'Uber Eats', reason: 'Uber Eats is not connected: this installation has no native Uber Eats connector.' }),
  search: refuse, menu: refuse, order: refuse,
});

test('with no Uber Eats rail the concierge turn searches the package catalog and never calls the refusing provider', async () => {
  const { handlers, provider, prompts } = loadRoutes({ provider: nativeProvider(), reply: { say: 'Chipotle has tacos.' } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'I want tacos' } }));
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.cards.length > 0, 'the catalog offers dishes');
  assert.ok(res.body.cards.some((c) => /Taco/.test(c.title || '')), 'a taco dish is offered');
  assert.deepEqual(provider.calls.map((c) => c[0]), ['status'], 'only the status probe reached the provider');
  assert.match(prompts[0], /CANDIDATES \(real, from search/);
  assert.doesNotMatch(prompts[0], /no Uber Eats rail/);
});

test('/config names the catalog rail, and a connected rail answers as before', async () => {
  const native = loadRoutes({ provider: nativeProvider() });
  const res = await call(native.handlers, 'get', '/config', authed('diner-a'));
  assert.equal(res.body.rail, 'catalog');
  assert.equal(res.body.uberConnected, false);
  assert.match(res.body.railNote, /opens Uber Eats/);
  const live = loadRoutes();
  const ok = await call(live.handlers, 'get', '/config', authed('diner-a'));
  assert.deepEqual(ok.body, { uberConnected: false, rail: 'provider' });
});

test('with a rail the turn still searches and offers its dishes', async () => {
  const { handlers, provider } = loadRoutes({ reply: { say: 'Here you go.' } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'tacos' } }));
  assert.equal(res.statusCode, 200);
  assert.ok(provider.calls.some((c) => c[0] === 'search'));
  assert.ok(res.body.cards.length > 0);
});

test('with no rail search, menu and the order handoff answer from the catalog with an ubereats.com link', async () => {
  const { handlers, provider } = loadRoutes({ provider: nativeProvider() });
  const found = await call(handlers, 'get', '/search', authed('diner-a', { query: { q: 'pizza' } }));
  assert.equal(found.statusCode, 200);
  assert.equal(found.body.items[0].productId, 'pizza-corner');
  const menu = await call(handlers, 'get', '/menu', authed('diner-a', { query: { storeId: 'pizza-corner' } }));
  assert.ok(menu.body.items.some((i) => i.productId === 'pc-pepperoni'));
  const added = await call(handlers, 'post', '/cart/items', authed('diner-a', { body: { storeId: 'pizza-corner', productId: 'pc-pepperoni' } }));
  assert.equal(added.statusCode, 200);
  const order = await call(handlers, 'post', '/order', authed('diner-a', { body: {} }));
  assert.equal(order.statusCode, 200);
  assert.match(order.body.checkoutUrl, /^https:\/\/www\.ubereats\.com\/store\/pizza-corner\?utm_source=oshal$/);
  assert.match(order.body.note, /handoff, not an in-app charge/);
  assert.deepEqual(provider.calls.map((c) => c[0]), ['status'], 'the refusing provider is never called');
});

test('with a rail an empty search still reads as no results for this message', async () => {
  const { handlers, prompts } = loadRoutes({ provider: fakeProvider({ search: () => ({ source: 'catalog', items: [] }) }), reply: { say: 'ok' } });
  await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'zzz' } }));
  assert.match(prompts[0], /CANDIDATES \(real, from search/);
  assert.match(prompts[0], /no results for this message/);
});
