/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Sweeps 5 and 6: asked "something vegetarian for two people under
 *                     |                             | 30 dollars", the Eats concierge answered "vegetarian and spicy".
 *                     |                             | The conversation held only that message; the diner's saved notes
 *                     |                             | held "wants spicy food" five times (one earlier "something spicy
 *                     |                             | for dinner", then re-saved every turn) under "THINGS THE DINER
 *                     |                             | TAUGHT YOU". Through the COMPILED route: saved notes reach the
 *                     |                             | prompt as preferences from earlier conversations that are not
 *                     |                             | this request, and a chat turn saves only a note not already saved.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Live re-drive still folded "spicy food desire" into the reply: the
 *                     |                             | prompt now shows a note saved many times once, and a saved
 *                     |                             | preference is asked about as its own question.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakePool, loadRoutes, authed, call } = require('./eats-routes-harness');

const SAVED = ['wants spicy food', 'vegetarian preference', 'Wants spicy food'];

test('saved notes reach the prompt as earlier preferences, never as this request', async () => {
  const { handlers, prompts } = loadRoutes({ pool: fakePool(), notes: SAVED, reply: { say: 'Vegetarian for two, got it.', show: [], add: [], remember: [], checkout: false } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'something vegetarian for two people under 30 dollars' } }));
  assert.equal(res.statusCode, 200);
  const prompt = prompts[0];
  assert.match(prompt, /SAVED PREFERENCES \(from earlier conversations, NOT part of this request: never fold one into your summary of what the diner asked; if one matters, ask about it as its own question/);
  assert.equal((prompt.match(/- wants spicy food/gi) || []).length, 1, 'a note saved many times is shown once');
  assert.doesNotMatch(prompt, /THINGS THE DINER TAUGHT YOU/);
  assert.match(prompt, /"remember" only a NEW food preference the diner states in THIS message/);
  assert.ok(prompt.indexOf('SAVED PREFERENCES') < prompt.indexOf('DINER: something vegetarian'), 'the request comes after, on its own line');
});

test('a chat turn saves only notes not already saved, once each', async () => {
  const { handlers, store } = loadRoutes({ pool: fakePool(), notes: SAVED,
    reply: { say: 'ok', show: [], add: [], remember: ['Wants  spicy food', 'budget: $30', 'budget: $30', ' '], checkout: false } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'under 30 dollars' } }));
  assert.deepEqual(store().notes, ['budget: $30']);
  assert.deepEqual(res.body.remembered, ['budget: $30'], 'the reply names only what was saved');
});

test('newNotes ignores case and spacing and keeps order', () => {
  const { exports } = loadRoutes({ pool: fakePool() });
  assert.deepEqual(exports.newNotes(['A  b', 'c', 'a b', 'C', 'd'], ['x']), ['A  b', 'c', 'd']);
  assert.deepEqual(exports.newNotes(undefined, ['x']), []);
});
