/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the compiled chat route when no restaurant search can run. With Places API (New) not enabled on the key, with the kernel holding no key, and with no delivery address anywhere, the prompt states that no search ran and why, in the server's own words, and forbids calling it an empty result; the turn still answers; the cards are empty and the reason travels in searchNote; with no address no Places call is made at all. A search that ran and matched nothing is still "no restaurant matched".
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SERVICE_DISABLED, NOT_CONNECTED, fakePlaces, loadRoutes, authed, call } = require('./eats-routes-harness');

const ADDRESS = '1 Synthetic Way, Pensacola';
const chat = (handlers, body) => call(handlers, 'post', '/chat', authed('diner-a', { body }));

test('with Places API (New) not enabled the turn says so in the prompt and never reports an empty result', async () => {
  const { handlers, prompts } = loadRoutes({ places: fakePlaces({ status: 403, body: SERVICE_DISABLED }), reply: { say: 'I cannot look restaurants up right now; the restaurant source is not enabled on this installation.' } });
  const res = await chat(handlers, { message: 'tacos tonight', location: ADDRESS });
  assert.equal(res.statusCode, 200);
  assert.match(prompts[0], /CANDIDATES \(none: no search ran\. Places API \(New\) is not enabled for this installation's Google key \(project 1085759851735\)\./);
  assert.match(prompts[0], /Never say a search came back empty, found nothing, or that nothing matched; say what is missing instead\./);
  assert.doesNotMatch(prompts[0], /CANDIDATES \(real/);
  assert.deepEqual(res.body.cards, []);
  assert.match(res.body.searchNote, /Places API \(New\) is not enabled/);
  assert.equal(res.body.proposal, null);
  assert.match(res.body.reply, /not enabled/);
});

test('with no key in the kernel the prompt names the variable to set', async () => {
  const { handlers, prompts } = loadRoutes({ places: fakePlaces({ throws: new Error(NOT_CONNECTED) }), reply: { say: 'ok' } });
  const res = await chat(handlers, { message: 'pizza', location: ADDRESS });
  assert.equal(res.statusCode, 200);
  assert.match(prompts[0], /no search ran\. Google Places is not configured for this installation: set OSHAL_CONNECTOR_SECRET_GOOGLE_PLACES/);
  assert.match(res.body.searchNote, /OSHAL_CONNECTOR_SECRET_GOOGLE_PLACES/);
});

test('with no delivery address anywhere the prompt says that, and no Places call is made', async () => {
  const { handlers, prompts, places } = loadRoutes({ reply: { say: 'Where should I deliver to?' } });
  const res = await chat(handlers, { message: 'something spicy' });
  assert.equal(res.statusCode, 200);
  assert.match(prompts[0], /no search ran\. Set your delivery address first/);
  assert.equal(places.requests.length, 0);
  assert.equal(res.body.place, null);
  assert.deepEqual(res.body.cards, []);
});

test('a search that ran and matched nothing is said as no match, not as a missing source', async () => {
  const { handlers, prompts } = loadRoutes({ places: fakePlaces({ search: () => ({ places: [] }) }), reply: { say: 'Nothing for that craving nearby; another?' } });
  const res = await chat(handlers, { message: 'durian pancakes', location: ADDRESS });
  assert.match(prompts[0], /CANDIDATES \(real, from Google Places near .*\):\n\(no restaurant matched this craving near the address: say so and ask for another craving\)/);
  assert.equal(res.body.searchNote, '');
});
