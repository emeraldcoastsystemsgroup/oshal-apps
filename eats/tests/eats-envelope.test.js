/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 8: the in-app Eats concierge reply was shown as the raw object
 *                     |                             | ('{ "say": ... "remember": [...] }') because the model left out the
 *                     |                             | commas between fields, and its remember list held preferences the
 *                     |                             | diner never stated ('spicy preference', 'address: pending', 'not on
 *                     |                             | boarded'). Through the COMPILED route: the reply is the say text,
 *                     |                             | never the object, and only a note grounded in this message is saved.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakePool, loadRoutes, authed, call } = require('./eats-routes-harness');

const MESSAGE = 'sweep8: something vegetarian for two people under 30 dollars';
// The sweep-8 model answer, verbatim in shape: no commas between the fields.
const SWEEP8_REPLY = `{
  "say": "I cannot search for restaurants here. Would you like advice on vegetarian cuisines that fit that budget?"
  "show": [],
  "add": [],
  "remember": [
    "spicy preference",
    "order for two people",
    "address: pending",
    "budget: cheap",
    "wants spicy food",
    "vegetarian preference",
    "not on boarded"
  ],
  "checkout": false
}`;

test('a comma-less envelope shows its say text and saves only notes the diner stated', async () => {
  const { handlers, store } = loadRoutes({ pool: fakePool(), notes: [], reply: SWEEP8_REPLY });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: MESSAGE } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, 'I cannot search for restaurants here. Would you like advice on vegetarian cuisines that fit that budget?');
  assert.doesNotMatch(res.body.reply, /"say"|"remember"|^\{/);
  assert.deepEqual(res.body.remembered, ['order for two people', 'vegetarian preference']);
  assert.deepEqual(store().notes, ['order for two people', 'vegetarian preference']);
});

test('an envelope that stays unparsable shows only its say text and acts on nothing', async () => {
  const broken = '{ "say": "Here are \\"veggie\\" ideas.", "show": [oops, "remember": ["spicy"] }';
  const { handlers, store } = loadRoutes({ pool: fakePool(), notes: [], reply: broken });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'spicy please' } }));
  assert.equal(res.body.reply, 'Here are "veggie" ideas.');
  assert.deepEqual(res.body.remembered, []);
  assert.deepEqual(store().notes, []);
});

test('plain prose with no object is still the reply, and a valid envelope parses as before', () => {
  const { exports } = loadRoutes({ pool: fakePool() });
  assert.equal(exports.parseEnvelope('Sure, what cuisine?').say, 'Sure, what cuisine?');
  const ok = exports.parseEnvelope('```json\n{"say":"ok","show":["a"],"remember":["no onions"],"order":"a"}\n```');
  assert.deepEqual([ok.say, ok.show, ok.remember, ok.order], ['ok', ['a'], ['no onions'], 'a']);
  assert.equal(exports.parseEnvelope('{"say":"x","order":"null"}').order, null, 'a literal "null" string proposes nothing');
});

test('statedNotes keeps a note sharing a word or number with the message, ignoring filler', () => {
  const { exports } = loadRoutes({ pool: fakePool() });
  assert.deepEqual(exports.statedNotes(['wants spicy food', 'budget: $30', 'likes thai'], 'I want food under 30 dollars'), ['budget: $30']);
  assert.deepEqual(exports.statedNotes(undefined, 'anything'), []);
});
