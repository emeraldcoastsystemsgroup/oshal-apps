/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (eats-concierge, eats-browse): "What the concierge remembers (8)" listed "address: pending" and
 *   "not on boarded" (the concierge's own profile line, saved as notes) and listed one taste twice ("spicy preference", "wants spicy food"). The
 *   compiled rememberedList drops state notes and lists a note that says the same as a newer one once; forgetNote over a person-scoped documents
 *   pool removes every copy that says the same thing, for the caller only.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const notes = require(path.join(__dirname, '..', 'routes', 'remembered-notes.js'));

test('state notes leave the list; real tastes, allergies and budgets stay', () => {
  const list = notes.rememberedList(['address: pending', 'not on boarded', 'Not onboarded', 'address: ask', 'diet: none', 'onboarded: false',
    'allergic to peanuts', 'budget: cheap', 'vegetarian', 'likes thai']);
  assert.deepEqual(list.map((r) => r.note), ['allergic to peanuts', 'budget: cheap', 'vegetarian', 'likes thai']);
  assert.deepEqual(list.map((r) => [r.restriction, r.budget]), [[true, false], [false, true], [true, false], [false, false]]);
});

test('a note that says the same as a newer one is listed once, the newer wording', () => {
  const list = notes.rememberedList(['wants spicy food', 'allergic to peanuts', 'spicy preference', 'Wants  spicy food']);
  assert.deepEqual(list.map((r) => r.note), ['wants spicy food', 'allergic to peanuts']);
  assert.notEqual(notes.conceptKey('allergic to peanuts'), notes.conceptKey('allergic to shellfish'), 'different allergies stay apart');
  assert.notEqual(notes.conceptKey('budget: cheap'), notes.conceptKey('budget under $25'));
});

test('Forget removes every copy that says the same thing, and only the caller\'s', async () => {
  const rows = [
    { id: '1', user_sub: 'a', body: JSON.stringify({ note: 'wants spicy food' }) },
    { id: '2', user_sub: 'a', body: JSON.stringify({ note: 'spicy preference' }) },
    { id: '3', user_sub: 'a', body: { note: 'allergic to peanuts' } },
    { id: '4', user_sub: 'b', body: JSON.stringify({ note: 'spicy preference' }) },
  ];
  const pool = { async query(text, v) {
    if (/^SELECT id, body FROM eats_concierge_feedback WHERE user_sub = \$1$/.test(text)) return { rows: rows.filter((r) => r.user_sub === v[0]) };
    if (/^DELETE FROM eats_concierge_feedback WHERE user_sub = \$1 AND id = \$2$/.test(text)) { const i = rows.findIndex((r) => r.user_sub === v[0] && r.id === v[1]); if (i >= 0) rows.splice(i, 1); return { rows: [], rowCount: i >= 0 ? 1 : 0 }; }
    throw new Error('unexpected ' + text);
  } };
  const gone = await notes.forgetNote(pool, { feedback: { table: 'eats_concierge_feedback' } }, 'a', 'wants spicy food');
  assert.equal(gone, 2);
  assert.deepEqual(rows.map((r) => r.id), ['3', '4']);
});
