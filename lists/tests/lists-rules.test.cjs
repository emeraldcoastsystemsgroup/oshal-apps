/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lists 1.0.0 rules, as pure functions: how a list is named and found, what an item may hold, a real due date, the order of open and done items, and the place a moved item gets between its neighbours.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./support/fixture.cjs');

test('a list name is kept as written, without "my", "the" or a trailing "list", and its key ignores case', async () => {
  const { listName } = await load('lists-rules.mjs');
  const cases = [['Packing', 'Packing', 'packing'], ['  my   packing list ', 'Packing', 'packing'], ['The Gift Ideas List', 'Gift Ideas', 'gift ideas'],
    ['our house projects', 'House projects', 'house projects'], ['to-do', 'To-do', 'to-do'], ['My list', 'My list', 'my list'], ['list', 'List', 'list'],
    ['Books to read', 'Books to read', 'books to read'], ['ÉTÉ 2027', 'ÉTÉ 2027', 'été 2027']];
  for (const [said, name, key] of cases) assert.deepEqual(listName(said), { ok: true, name, key }, said);
  for (const bad of ['', '   ', null, undefined, 42, 'x'.repeat(81), 'a\u0000b']) assert.equal(listName(bad).ok, false, String(bad).slice(0, 12));
});

test('the grocery and shopping names belong to Shopping', async () => {
  const { listName, keptByShopping } = await load('lists-rules.mjs');
  for (const said of ['groceries', 'Grocery', 'my grocery list', 'shopping', 'The Shopping List', 'grocery shopping']) assert.equal(keptByShopping(listName(said).key), true, said);
  for (const said of ['Christmas shopping', 'Shopping for the house', 'Grocery budget ideas', 'Packing']) assert.equal(keptByShopping(listName(said).key), false, said);
});

test('an item holds its words and, when given, a note, a whole quantity and a real day', async () => {
  const { itemFields } = await load('lists-rules.mjs');
  assert.deepEqual(itemFields({ title: '  Phone   charger ' }), { ok: true, value: { title: 'Phone charger', note: null, quantity: null, due: null } });
  assert.deepEqual(itemFields({ title: 'Eggs', note: ' free range ', quantity: '12', due: '2026-11-20' }).value, { title: 'Eggs', note: 'free range', quantity: 12, due: '2026-11-20' });
  assert.deepEqual(itemFields({ title: 'Leap', due: '2028-02-29' }).value.due, '2028-02-29');
  for (const bad of [{}, { title: '' }, { title: 7 }, { title: 'x'.repeat(301) }, { title: 'a', note: 5 }, { title: 'a', note: 'n'.repeat(1001) }, { title: 'a', quantity: 0 },
    { title: 'a', quantity: -1 }, { title: 'a', quantity: 1.5 }, { title: 'a', quantity: 'two' }, { title: 'a', quantity: 10000 }, { title: 'a', due: '2026-02-30' },
    { title: 'a', due: '11/20/2026' }, { title: 'a', due: 20261120 }]) {
    const out = itemFields(bad);
    assert.equal(out.ok, false, JSON.stringify(bad).slice(0, 50));
    assert.equal(typeof out.error, 'string');
  }
});

test('a change to an item names only what changes; an empty value clears a note, a quantity or a day, never the words', async () => {
  const { itemChange } = await load('lists-rules.mjs');
  const current = { title: 'Tent', note: 'two person', quantity: 1, due_on: '2026-12-01' };
  assert.deepEqual(itemChange(current, { note: '' }).value, { title: 'Tent', note: null, quantity: 1, due: '2026-12-01' });
  assert.deepEqual(itemChange(current, { quantity: null, due: null }).value, { title: 'Tent', note: 'two person', quantity: null, due: null });
  assert.deepEqual(itemChange(current, { title: 'Big tent', quantity: 2 }).value, { title: 'Big tent', note: 'two person', quantity: 2, due: '2026-12-01' });
  assert.deepEqual(itemChange(current, { clear: ['quantity', 'due'] }).value, { title: 'Tent', note: 'two person', quantity: null, due: null }, 'the assistant names what to empty');
  assert.deepEqual(itemChange(current, { clear: ['note'], quantity: 3 }).value, { title: 'Tent', note: null, quantity: 3, due: '2026-12-01' });
  for (const bad of [{}, { title: '' }, { title: null }, { quantity: 0 }, { due: 'soon' }, { unknown: 1 }, { clear: ['title'] }, { clear: 'note' }]) assert.equal(itemChange(current, bad).ok, false, JSON.stringify(bad));
});

test('open items keep their order; done items follow, the one finished last first', async () => {
  const { sortItems } = await load('lists-rules.mjs');
  const rows = [
    { id: 'c', title: 'C', done: false, position: 300, created_at: '3' }, { id: 'a', title: 'A', done: false, position: 100, created_at: '1' },
    { id: 'd1', title: 'D1', done: true, position: 50, done_at: '2026-11-10T10:00:00.000Z' }, { id: 'b', title: 'B', done: false, position: 100, created_at: '2' },
    { id: 'd2', title: 'D2', done: true, position: 999, done_at: '2026-11-12T10:00:00.000Z' },
  ];
  assert.deepEqual(sortItems(rows).map((r) => r.id), ['a', 'b', 'c', 'd2', 'd1']);
});

test('a moved item gets a place between its neighbours, or none when no whole number is left between them', async () => {
  const { between, STEP } = await load('lists-rules.mjs');
  assert.equal(between(null, null), STEP);
  assert.equal(between(null, 1000), 500);
  assert.equal(between(1000, null), 1000 + STEP);
  assert.equal(between(1000, 2000), 1500);
  assert.equal(between(7, 8), null);
  assert.equal(between(null, 1), null);
});

test('a list or an item is found by id, then by its exact words, then by the one that holds the words', async () => {
  const { findList, findItem } = await load('lists-rules.mjs');
  const lists = [{ id: 'l1', name: 'Packing', name_key: 'packing' }, { id: 'l2', name: 'Paris packing', name_key: 'paris packing' }, { id: 'l3', name: 'Books', name_key: 'books' }];
  assert.equal(findList(lists, 'l3').found.id, 'l3');
  assert.equal(findList(lists, 'my PACKING list').found.id, 'l1', 'the exact name wins over a name that holds it');
  assert.equal(findList(lists, 'paris').found.id, 'l2');
  assert.deepEqual(findList(lists, 'pack').several, ['Packing', 'Paris packing']);
  assert.equal(findList(lists, 'camping').none, true);
  assert.equal(findList(lists, '').none, true);
  const items = [{ id: 'i1', title: 'Wool socks', done: false }, { id: 'i2', title: 'Cotton socks', done: false }, { id: 'i3', title: 'Socks', done: true }, { id: 'i4', title: 'Boots', done: false }];
  assert.equal(findItem(items, 'i2').found.id, 'i2');
  assert.equal(findItem(items, 'socks').found.id, 'i3', 'exact words win');
  assert.equal(findItem(items, 'BOOT').found.id, 'i4');
  assert.deepEqual(findItem(items, 'sock').several, ['Wool socks', 'Cotton socks', 'Socks']);
  assert.equal(findItem(items, 'hat').none, true);
});
