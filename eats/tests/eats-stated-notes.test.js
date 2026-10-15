/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Round 8 review: statedNotes matched whole words, so for "I'm
 *                     |                             | allergic to peanuts, hold the onion, I eat vegan" it kept only
 *                     |                             | 'vegan' and the stated peanut allergy was never saved; and a "say"
 *                     |                             | holding a raw newline lost its text, so the diner got the route's
 *                     |                             | "I found a few options" default. Through the COMPILED route: a
 *                     |                             | stated allergy, a paraphrased dislike and a diet are saved, an
 *                     |                             | unstated note is still dropped, the newline say is the reply, and
 *                     |                             | an empty say is neither the raw object nor a claim of options
 *                     |                             | when no card goes out.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakePool, loadRoutes, authed, call } = require('./eats-routes-harness');

const ALLERGY_MESSAGE = "I'm allergic to peanuts, hold the onion, I eat vegan";

test('a stated allergy, a paraphrased dislike and a diet are saved through the chat turn', async () => {
  const reply = JSON.stringify({ say: 'Noted. Anything else?', show: [], add: [], remember: ['peanut allergy', 'no onions', 'vegan', 'spicy preference'], checkout: false });
  const { handlers, store } = loadRoutes({ pool: fakePool(), notes: [], reply });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: ALLERGY_MESSAGE } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.remembered, ['peanut allergy', 'no onions', 'vegan']);
  assert.deepEqual(store().notes, ['peanut allergy', 'no onions', 'vegan']);
});

test('statedNotes keeps paraphrased allergies and short food words, never an unstated note', () => {
  const { exports } = loadRoutes({ pool: fakePool() });
  assert.deepEqual(exports.statedNotes(['peanut allergy', 'no onions', 'vegan'], ALLERGY_MESSAGE), ['peanut allergy', 'no onions', 'vegan']);
  assert.deepEqual(exports.statedNotes(['egg allergy', 'no soy'], 'No eggs please, and I cannot have soy'), ['egg allergy', 'no soy']);
  assert.deepEqual(exports.statedNotes(['shellfish allergy'], "I can't eat shrimp or crab"), ['shellfish allergy'],
    'an allergy the diner states in other words is kept');
  assert.deepEqual(exports.statedNotes(['peanut allergy', 'wants spicy food'], 'something for two under 30 dollars'), [],
    'nothing about an allergy or spice was said, so neither is saved');
  assert.deepEqual(exports.statedNotes(['vegetarian preference', 'spicy preference'], 'something vegetarian for two'), ['vegetarian preference']);
});

test('a say holding a raw newline is the reply, and the envelope still acts', async () => {
  const raw = '{ "say": "Try the falafel place.\nIt is cheap." "remember": [] }';
  const { handlers } = loadRoutes({ pool: fakePool(), notes: [], reply: raw });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'cheap lunch' } }));
  assert.equal(res.body.reply, 'Try the falafel place.\nIt is cheap.');
  const { exports } = loadRoutes({ pool: fakePool() });
  const env = exports.parseEnvelope('{"say":"Line one.\nLine two.","show":[],"add":[],"remember":["no onions"],"checkout":false}');
  assert.deepEqual([env.say, env.remember], ['Line one.\nLine two.', ['no onions']]);
});

test('the default reply never names options when no card is shown', async () => {
  const reply = JSON.stringify({ say: '', show: ['not-a-candidate'], add: [], remember: [], checkout: false });
  const { handlers } = loadRoutes({ pool: fakePool(), notes: [], reply });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'burgers' } }));
  assert.deepEqual(res.body.cards, []);
  assert.doesNotMatch(res.body.reply, /options|"say"|^\{/, 'neither a claim of options nor the raw object');
});
