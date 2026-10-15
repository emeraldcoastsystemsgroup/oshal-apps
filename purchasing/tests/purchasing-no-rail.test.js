/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Shopping with no Walmart rail, through the COMPILED route module. The provider double answers like the native kernel (status not_connected; search, deals and cart refuse 503 and would fail the call). The concierge turn answers without touching the catalog, adds nothing, and its prompt states the fact and forbids "connect Walmart"; /config names the absent rail. Red on the previous route, whose chat searched first and 503'd before the concierge spoke.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeProvider, loadRoutes, authed, call } = require('./shopping-routes-harness');

const refuse = () => { throw Object.assign(new Error('Walmart provider operation is unavailable in this native runtime'), { status: 503 }); };
const nativeProvider = () => fakeProvider({
  status: () => ({ configured: false, connected: false, live: false, mode: 'not_connected', provider: 'Walmart', reason: 'Walmart is not connected: this installation has no native Walmart connector.' }),
  search: refuse, deals: refuse, cart: refuse,
});

test('the concierge answers with no Walmart rail, never calls the catalog and adds nothing', async () => {
  const { handlers, provider, orchestratorCalls, pool } = loadRoutes({ provider: nativeProvider(),
    reply: { say: 'Walmart is not available on this installation.', add: [{ productId: 'wm-towels', quantity: 1 }], checkout: true } });
  const res = await call(handlers, 'post', '/chat', authed('shopper-a', { body: { message: 'find me paper towels' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(provider.calls.map((c) => c[0]), ['status'], 'only the status probe reached the provider');
  assert.deepEqual([res.body.added, res.body.proposal, res.body.rail, res.body.catalogActionable], [[], null, 'absent', false]);
  assert.equal(pool.tables.items.length, 0, 'nothing was added to the list');
  assert.match(orchestratorCalls[0], /CATALOG STATUS: NO WALMART RAIL — This installation has no Walmart rail/);
  assert.match(orchestratorCalls[0], /never tell them to connect Walmart/);
});

test('/config names the absent rail, and a connected rail answers as before', async () => {
  const absent = loadRoutes({ provider: nativeProvider() });
  const res = await call(absent.handlers, 'get', '/config', authed('shopper-a'));
  assert.deepEqual(res.body, { walmartConnected: false, rail: 'absent', railNote: absent.exports.PURCHASING_NO_RAIL });
  assert.doesNotMatch(res.body.railNote, /\/utilities|once a Walmart connection/i);
  const live = loadRoutes();
  const ok = await call(live.handlers, 'get', '/config', authed('shopper-a'));
  assert.deepEqual(ok.body, { walmartConnected: false, rail: 'provider' });
});
