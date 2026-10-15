/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Eats with no Uber Eats rail, through the COMPILED route module. The provider double answers like the native kernel (status not_connected; search, menu and order refuse 503 and would fail the call). The concierge turn answers, never touches search or menu, and its prompt states the fact and forbids "connect Uber Eats"; /config names the absent rail. Red on the previous route, whose chat searched first and 503'd before the concierge spoke.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | With no rail the prompt says no search ran (sweep 7: the concierge reported 'no vegetarian restaurants in the search results' for a search that never happened); with a rail an empty search still reads as no results.
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

test('the concierge answers with no Uber Eats rail and never calls the refusing catalog', async () => {
  const { handlers, provider, prompts } = loadRoutes({ provider: nativeProvider(), reply: { say: 'Uber Eats is not available on this installation, but tacos sound great.' } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'I want tacos' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, 'Uber Eats is not available on this installation, but tacos sound great.');
  assert.deepEqual(res.body.cards, []);
  assert.deepEqual(provider.calls.map((c) => c[0]), ['status'], 'only the status probe reached the provider');
  assert.match(prompts[0], /THIS INSTALLATION: This installation has no Uber Eats rail \(no Uber Eats connector exists here\)/);
  assert.match(prompts[0], /Never tell the diner to connect Uber Eats/);
});

test('/config names the absent rail and its sentence, and a connected rail answers as before', async () => {
  const absent = loadRoutes({ provider: nativeProvider() });
  const res = await call(absent.handlers, 'get', '/config', authed('diner-a'));
  assert.deepEqual(res.body, { uberConnected: false, rail: 'absent', railNote: absent.exports.EATS_NO_RAIL });
  assert.doesNotMatch(res.body.railNote, /connect it|\/utilities|once an Uber Eats connection/i);
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

test('with no rail the prompt says no search ran instead of an empty search result', async () => {
  const { handlers, prompts } = loadRoutes({ provider: nativeProvider(), reply: { say: 'ok' } });
  await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'something vegetarian for two people under 30 dollars' } }));
  assert.match(prompts[0], /CANDIDATES \(none: search is not available on this installation\)/);
  assert.match(prompts[0], /no search ran/);
  assert.match(prompts[0], /Never say a search came back empty/);
  assert.doesNotMatch(prompts[0], /real, from search/, 'a search that never ran is not called real search results');
  assert.doesNotMatch(prompts[0], /or that nothing matched\)/);
});

test('with a rail an empty search still reads as no results for this message', async () => {
  const { handlers, prompts } = loadRoutes({ provider: fakeProvider({ search: () => ({ source: 'catalog', items: [] }) }), reply: { say: 'ok' } });
  await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'zzz' } }));
  assert.match(prompts[0], /CANDIDATES \(real, from search/);
  assert.match(prompts[0], /no results for this message/);
});
