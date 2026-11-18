/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.5.8 (the coordinator, 2026-11-17: a dish the one chat window's bot names is never
 *   re-checked against the diner's saved allergies; the check must not rest on the persona alone). Through the COMPILED routes, the call
 *   the kernel makes after each turn of the Eats concierge (the manifest's replyCheck: the person's words and the bot's reply, as that
 *   person): a reply naming a peanut dish for a diner whose saved notes or profile diet say peanut allergy, or whose words say it, is
 *   answered with the after-check line POST /chat gives its own replies ("Allergy and diet check: Pad Thai usually contains peanuts (you
 *   avoid peanuts). ..."); a reply that warns in the same sentence, a diner with nothing saved, and another diner's notes give no line;
 *   the check writes nothing; a call with no reply is refused; and the manifest declares the route as Eats' reply check. Red on 1.5.7:
 *   POST /reply-check did not exist (404) and the manifest declared no replyCheck.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.5.8, after the independent review of the kernel's replyCheck: the check is its own router mounted as
 *   the exact POST route /api/eats/reply-check (createEatsReplyCheckRoutes, POST / of the mount), and the manifest names it with its label and
 *   unavailable line.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakePool, loadRoutes, authed, call } = require('./eats-routes-harness');

const PAD_THAI = 'Allergy and diet check: Pad Thai usually contains peanuts (you avoid peanuts). Ask the restaurant before ordering it.';
/** The window bot's reply of the demo (sweep 2): a peanut dish named with no warning. */
const REPLY = 'Thai Garden is a good pick tonight. Try the Pad Thai, or a green curry if you want something spicy.';
/** The kernel's call of Eats' reply check: POST / of its own mount, /api/eats/reply-check. */
const check = (handlers, sub, body) => call(handlers, 'post', '/', authed(sub, { body }));

test('a reply naming a peanut dish for a diner with a saved peanut allergy is flagged on one line', async () => {
  const { handlers, pool } = loadRoutes({ notes: ['peanut allergy'] });
  const before = pool.sql.length;
  const res = await check(handlers, 'diner-a', { message: 'What should I get for dinner?', reply: REPLY });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.note, PAD_THAI);
  assert.deepEqual(res.body.restrictions, ['peanuts']);
  assert.deepEqual(res.body.mentions.map((m) => m.dish), ['Pad Thai']);
  assert.ok(pool.sql.slice(before).every((q) => /^\s*SELECT/i.test(q.text)), 'the check only reads');
});

test('the profile\'s saved diet and an allergy said in the person\'s words flag the same way', async () => {
  const pool = fakePool({ profiles: { 'diner-b': { user_sub: 'diner-b', dietary: ['peanut allergy'], favorite_cuisines: [] } } });
  const { handlers } = loadRoutes({ pool });
  assert.equal((await check(handlers, 'diner-b', { message: 'Dinner ideas?', reply: REPLY })).body.note, PAD_THAI);
  const said = await check(handlers, 'diner-c', { message: 'I am allergic to peanuts. Dinner ideas?', reply: REPLY });
  assert.equal(said.body.note, PAD_THAI);
});

test('no line when the reply warns in the same sentence, when nothing is saved, or for another diner\'s notes', async () => {
  const { handlers } = loadRoutes({ notes: ['peanut allergy'] });
  const warned = await check(handlers, 'diner-a', { message: 'Dinner?', reply: 'Pad Thai usually contains peanuts, so ask for it without peanuts.' });
  assert.equal(warned.body.note, '', JSON.stringify(warned.body));
  const plain = loadRoutes();
  const none = await check(plain.handlers, 'diner-d', { message: 'Dinner?', reply: REPLY });
  assert.deepEqual([none.body.note, none.body.restrictions], ['', []], 'a diner with nothing saved gets no line');
  // One diner keeps a peanut allergy; the next diner's reply is checked against their own notes only.
  const kept = await call(plain.handlers, 'post', '/notes', authed('diner-e', { body: { note: 'peanut allergy', said: 'I have a peanut allergy' } }));
  assert.deepEqual(kept.body.remembered, ['peanut allergy']);
  assert.equal((await check(plain.handlers, 'diner-e', { message: 'Dinner?', reply: REPLY })).body.note, PAD_THAI);
  assert.equal((await check(plain.handlers, 'diner-f', { message: 'Dinner?', reply: REPLY })).body.note, '', 'another diner\'s note never applies');
});

test('a call with no reply is refused', async () => {
  const { handlers } = loadRoutes({ notes: ['peanut allergy'] });
  const res = await check(handlers, 'diner-a', { message: 'Dinner?' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'reply_required');
});

test('the manifest names Eats\' reply check as its own exact POST route, with its label and unavailable line', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /\nreplyCheck:\n  path: \/api\/eats\/reply-check\n  label: Allergy check\n  unavailable: Allergy check could not run for this reply\. /);
  assert.match(manifest, /  - module: routes\/eats-routes\.js\n    factory: createEatsReplyCheckRoutes\n    mountPath: \/api\/eats\/reply-check\n    method: POST\n/,
    'the exact POST route the kernel requires (a typo or a mount is refused at install)');
  assert.match(manifest, /\nchatBot: eats-concierge\n/, 'the bot whose replies it checks');
});
