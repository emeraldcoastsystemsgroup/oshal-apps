/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Lists route scenarios (1.0.0), written once and run twice: over the memory pool (tests/lists-routes.test.cjs) and over a real PostgreSQL with the package's migration applied (tests/lists-postgres.test.cjs), so the stand-in pool cannot drift from what a database answers. Every case goes through the package's real router over loopback HTTP.
 */
'use strict';
const assert = require('node:assert/strict');

const titles = (res) => res.body.items.map((item) => item.title);
const open = (res) => res.body.items.filter((item) => !item.done).map((item) => item.title);
const done = (res) => res.body.items.filter((item) => item.done).map((item) => item.title);

/** @description Add items to a list by name and return the answer. */
async function add(f, list, items, person) {
  const res = await f.call('POST', '/items/add', { list, items: items.map((title) => (typeof title === 'string' ? { title } : title)) }, person);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res;
}

const CASES = {
  'a person makes a list, adds one item and then several, and reads them back in the order added': async (f) => {
    const made = await f.call('POST', '/lists', { name: 'Packing' });
    assert.equal(made.status, 201);
    assert.deepEqual([made.body.list.name, made.body.list.open, made.body.list.done], ['Packing', 0, 0]);
    const one = await f.call('POST', '/items/add', { list: made.body.list.id, title: 'Passport', note: 'in the blue folder', quantity: 1, due: '2026-12-01' });
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.deepEqual(one.body.added.map((i) => [i.title, i.note, i.quantity, i.due, i.done]), [['Passport', 'in the blue folder', 1, '2026-12-01', false]]);
    const many = await add(f, 'Packing', ['Socks', { title: 'Phone charger', quantity: 2 }, 'Sunscreen']);
    assert.deepEqual(many.body.added.map((i) => i.title), ['Socks', 'Phone charger', 'Sunscreen']);
    assert.equal(many.body.created, false);
    const shown = await f.call('GET', `/show?list=${made.body.list.id}`);
    assert.equal(shown.status, 200);
    assert.deepEqual(titles(shown), ['Passport', 'Socks', 'Phone charger', 'Sunscreen']);
    assert.deepEqual([shown.body.list.open, shown.body.list.done], [4, 0]);
    const all = await f.call('GET', '/lists');
    assert.deepEqual(all.body.lists.map((l) => [l.name, l.open, l.done]), [['Packing', 4, 0]]);
    assert.deepEqual(all.body.groceries, { keptBy: 'Shopping', app: 'purchasing', open: '/cockpit/?app=purchasing' });
  },

  'ticking an item puts it under the open ones, newest first; unticking puts it back at the bottom of the open ones': async (f) => {
    await add(f, 'Chores', ['Laundry', 'Dishes', 'Vacuum']);
    const first = await f.call('POST', '/items/check', { list: 'Chores', item: 'Laundry' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual([first.body.item.title, first.body.item.done, typeof first.body.item.doneAt], ['Laundry', true, 'string']);
    assert.deepEqual([first.body.list.open, first.body.list.done], [2, 1]);
    await f.call('POST', '/items/check', { list: 'Chores', item: 'Vacuum' });
    let shown = await f.call('GET', '/show?list=Chores');
    assert.deepEqual([open(shown), done(shown)], [['Dishes'], ['Vacuum', 'Laundry']]);
    assert.equal((await f.call('POST', '/items/check', { list: 'Chores', item: 'Laundry' })).status, 200, 'ticking a done item again is not an error');
    const back = await f.call('POST', '/items/uncheck', { list: 'Chores', item: 'Laundry' });
    assert.deepEqual([back.status, back.body.item.done, back.body.item.doneAt], [200, false, null]);
    shown = await f.call('GET', '/show?list=Chores');
    assert.deepEqual([open(shown), done(shown)], [['Dishes', 'Laundry'], ['Vacuum']]);
    assert.deepEqual([shown.body.list.open, shown.body.list.done], [2, 1]);
  },

  'an item is edited: its words, note, quantity and due date; an empty value clears one; bad values are refused and change nothing': async (f) => {
    const made = await add(f, 'Gift ideas', ['Scarf for Dana']);
    const id = made.body.added[0].id;
    const edited = await f.call('POST', '/items/edit', { list: 'Gift ideas', item: id, title: 'Wool scarf for Dana', note: 'green, not blue', quantity: 2, due: '2026-12-20' });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.deepEqual([edited.body.item.title, edited.body.item.note, edited.body.item.quantity, edited.body.item.due], ['Wool scarf for Dana', 'green, not blue', 2, '2026-12-20']);
    const cleared = await f.call('POST', '/items/edit', { list: 'Gift ideas', item: id, note: '', quantity: null, due: null });
    assert.deepEqual([cleared.body.item.title, cleared.body.item.note, cleared.body.item.quantity, cleared.body.item.due], ['Wool scarf for Dana', null, null, null]);
    for (const bad of [{ title: '' }, { title: 'x'.repeat(301) }, { quantity: 0 }, { quantity: 2.5 }, { quantity: 10000 }, { due: '2026-02-30' }, { due: 'next Friday' }, { note: 'n'.repeat(1001) }, {}]) {
      const res = await f.call('POST', '/items/edit', { list: 'Gift ideas', item: id, ...bad });
      assert.equal(res.status, 400, `refused: ${JSON.stringify(bad)}`);
      assert.equal(typeof res.body.message, 'string');
    }
    const after = await f.call('GET', '/show?list=Gift ideas');
    assert.deepEqual(after.body.items.map((i) => [i.title, i.note, i.quantity, i.due]), [['Wool scarf for Dana', null, null, null]]);
  },

  'items are put in a new order: to the top, to the bottom, up, down and to a place; a done item has no place': async (f) => {
    await add(f, 'Errands', ['Bank', 'Post office', 'Pharmacy', 'Library']);
    const order = async () => open(await f.call('GET', '/show?list=Errands'));
    const move = (item, change) => f.call('POST', '/items/move', { list: 'Errands', item, ...change });
    assert.deepEqual((await move('Library', { to: 'top' })).body.order, ['Library', 'Bank', 'Post office', 'Pharmacy']);
    assert.deepEqual((await move('Library', { to: 'bottom' })).body.order, ['Bank', 'Post office', 'Pharmacy', 'Library']);
    assert.deepEqual((await move('Pharmacy', { to: 'up' })).body.order, ['Bank', 'Pharmacy', 'Post office', 'Library']);
    assert.deepEqual((await move('Bank', { to: 'down' })).body.order, ['Pharmacy', 'Bank', 'Post office', 'Library']);
    assert.deepEqual((await move('Library', { position: 2 })).body.order, ['Pharmacy', 'Library', 'Bank', 'Post office']);
    assert.deepEqual((await move('Pharmacy', { position: 4 })).body.order, ['Library', 'Bank', 'Post office', 'Pharmacy']);
    assert.deepEqual((await move('Library', { to: 'up' })).body.order, ['Library', 'Bank', 'Post office', 'Pharmacy'], 'the first item stays first');
    for (let round = 0; round < 24; round += 1) await move(round % 2 ? 'Bank' : 'Post office', { position: 2 });
    assert.deepEqual(await order(), ['Library', 'Bank', 'Post office', 'Pharmacy'], 'many moves into one gap still keep an exact order');
    assert.equal((await move('Bank', { to: 'sideways' })).status, 400);
    assert.equal((await move('Bank', { position: 0 })).status, 400);
    await f.call('POST', '/items/check', { list: 'Errands', item: 'Bank' });
    const refused = await move('Bank', { to: 'top' });
    assert.deepEqual([refused.status, refused.body.error], [409, 'item_is_done']);
  },

  'a list is renamed; a name another list has is refused; deleting a list removes it and its items': async (f) => {
    await add(f, 'Books', ['Dune', 'Emma']);
    await f.call('POST', '/lists', { name: 'Movies' });
    const renamed = await f.call('POST', '/rename', { list: 'Books', name: 'Books to read' });
    assert.deepEqual([renamed.status, renamed.body.list.name, renamed.body.list.open], [200, 'Books to read', 2]);
    const taken = await f.call('POST', '/rename', { list: 'Movies', name: 'books to read list' });
    assert.deepEqual([taken.status, taken.body.error], [409, 'name_taken']);
    assert.equal((await f.call('POST', '/rename', { list: 'Movies', name: '   ' })).status, 400);
    assert.equal((await f.call('POST', '/rename', { list: 'Nowhere', name: 'X' })).status, 404);
    const gone = await f.call('POST', '/delete', { list: 'Books to read' });
    assert.deepEqual([gone.status, gone.body.removed.name, gone.body.removed.items], [200, 'Books to read', 2]);
    assert.deepEqual((await f.call('GET', '/lists')).body.lists.map((l) => l.name), ['Movies']);
    assert.equal((await f.call('GET', '/show?list=Books to read')).status, 404);
    const again = await add(f, 'Books to read', ['Persuasion']);
    assert.deepEqual([again.body.created, titles(await f.call('GET', '/show?list=Books to read'))], [true, ['Persuasion']], 'no item of the deleted list comes back');
  },

  'clearing the done items removes only those': async (f) => {
    await add(f, 'Weekend', ['Mow', 'Paint', 'Rake', 'Sweep']);
    await f.call('POST', '/items/check', { list: 'Weekend', item: 'Paint' });
    await f.call('POST', '/items/check', { list: 'Weekend', item: 'Sweep' });
    const cleared = await f.call('POST', '/clear-done', { list: 'Weekend' });
    assert.deepEqual([cleared.status, cleared.body.cleared, cleared.body.list.open, cleared.body.list.done], [200, 2, 2, 0]);
    assert.deepEqual(titles(await f.call('GET', '/show?list=Weekend')), ['Mow', 'Rake']);
    assert.equal((await f.call('POST', '/clear-done', { list: 'Weekend' })).body.cleared, 0);
  },

  'one item is removed, by its words or its id': async (f) => {
    const made = await add(f, 'House', ['Light bulbs', 'Furnace filter', 'Batteries']);
    const byWords = await f.call('POST', '/items/remove', { list: 'House', item: 'furnace filter' });
    assert.deepEqual([byWords.status, byWords.body.removed.title, byWords.body.list.open], [200, 'Furnace filter', 2]);
    const byId = await f.call('POST', '/items/remove', { list: 'House', item: made.body.added[2].id });
    assert.deepEqual([byId.status, byId.body.removed.title], [200, 'Batteries']);
    assert.deepEqual(titles(await f.call('GET', '/show?list=House')), ['Light bulbs']);
    assert.equal((await f.call('POST', '/items/remove', { list: 'House', item: 'Batteries' })).status, 404);
  },

  'a list and an item are found by name as people say them; an unknown one answers what exists; two matches are not guessed': async (f) => {
    await add(f, 'Packing', ['Rain jacket', 'Hiking boots', 'Wool socks', 'Cotton socks']);
    await f.call('POST', '/lists', { name: 'Paris packing' });
    for (const said of ['packing', 'PACKING', 'my packing list', 'the Packing List', '  packing  ']) {
      const res = await f.call('GET', `/show?list=${encodeURIComponent(said)}`);
      assert.deepEqual([res.status, res.body.list && res.body.list.name], [200, 'Packing'], said);
    }
    assert.equal((await f.call('GET', '/show?list=paris')).body.list.name, 'Paris packing', 'one list holds the words');
    const none = await f.call('GET', '/show?list=camping');
    assert.deepEqual([none.status, none.body.error, none.body.lists], [404, 'no_such_list', ['Packing', 'Paris packing']]);
    assert.equal((await f.call('GET', '/show')).status, 400);
    assert.equal((await f.call('POST', '/items/check', { list: 'Packing', item: 'rain jacket' })).body.item.title, 'Rain jacket');
    assert.equal((await f.call('POST', '/items/check', { list: 'Packing', item: 'boots' })).body.item.title, 'Hiking boots', 'one item holds the word');
    const several = await f.call('POST', '/items/check', { list: 'Packing', item: 'socks' });
    assert.deepEqual([several.status, several.body.error, several.body.matches], [409, 'several_match', ['Wool socks', 'Cotton socks']]);
    const missing = await f.call('POST', '/items/check', { list: 'Packing', item: 'umbrella' });
    assert.deepEqual([missing.status, missing.body.error, missing.body.items], [404, 'no_such_item', ['Wool socks', 'Cotton socks', 'Hiking boots', 'Rain jacket']]);
  },

  'adding to a list that does not exist makes it; an item already on the list is not added twice; a done one comes back': async (f) => {
    const first = await f.call('POST', '/items/add', { list: 'my camping list', items: [{ title: 'Tent' }, { title: 'Stove' }] });
    assert.deepEqual([first.status, first.body.created, first.body.list.name, first.body.added.length], [200, true, 'Camping', 2]);
    const again = await f.call('POST', '/items/add', { list: 'camping', items: [{ title: 'tent' }, { title: 'Lantern' }] });
    assert.deepEqual([again.body.created, again.body.added.map((i) => i.title), again.body.already], [false, ['Lantern'], ['Tent']]);
    await f.call('POST', '/items/check', { list: 'camping', item: 'Stove' });
    const back = await f.call('POST', '/items/add', { list: 'camping', title: 'stove' });
    assert.deepEqual([back.body.added, back.body.reopened.map((i) => [i.title, i.done])], [[], [['Stove', false]]]);
    assert.deepEqual(open(await f.call('GET', '/show?list=camping')), ['Tent', 'Lantern', 'Stove']);
    const made = await f.call('POST', '/lists', { name: 'CAMPING list' });
    assert.deepEqual([made.status, made.body.already, made.body.list.name], [200, true, 'Camping'], 'making a list that exists answers the one there is');
    for (const bad of [{ list: 'camping' }, { list: 'camping', items: [] }, { list: 'camping', items: [{ title: ' ' }] }, { items: [{ title: 'x' }] }, { list: 'x'.repeat(81), title: 'y' }]) {
      assert.equal((await f.call('POST', '/items/add', bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    }
  },

  'each person has their own lists: another person sees none of them and changes none': async (f) => {
    const mine = await add(f, 'Private', ['Alpha', 'Beta'], 'alice');
    const listId = mine.body.list.id, itemId = mine.body.added[0].id;
    assert.deepEqual((await f.call('GET', '/lists', undefined, 'bob')).body.lists, []);
    assert.equal((await f.call('GET', `/show?list=${listId}`, undefined, 'bob')).status, 404);
    for (const [route, body] of [['/rename', { list: listId, name: 'Taken' }], ['/delete', { list: listId }], ['/clear-done', { list: listId }],
      ['/items/check', { list: listId, item: itemId }], ['/items/edit', { list: listId, item: itemId, title: 'Changed' }],
      ['/items/move', { list: listId, item: itemId, to: 'bottom' }], ['/items/remove', { list: listId, item: itemId }]]) {
      assert.equal((await f.call('POST', route, body, 'bob')).status, 404, `${route} as another person`);
    }
    const theirs = await f.call('POST', '/items/add', { list: 'Private', title: 'Gamma' }, 'bob');
    assert.deepEqual([theirs.body.created, theirs.body.list.id === listId], [true, false], 'the same name is another list for another person');
    assert.deepEqual(titles(await f.call('GET', '/show?list=Private', undefined, 'alice')), ['Alpha', 'Beta']);
    assert.deepEqual(titles(await f.call('GET', '/show?list=Private', undefined, 'bob')), ['Gamma']);
  },

  'nobody signed in is refused everywhere and nothing is written': async (f) => {
    for (const [method, route, body] of [['GET', '/lists'], ['GET', '/show?list=x'], ['POST', '/lists', { name: 'X' }], ['POST', '/items/add', { list: 'X', title: 'y' }],
      ['POST', '/rename', { list: 'X', name: 'Y' }], ['POST', '/delete', { list: 'X' }], ['POST', '/clear-done', { list: 'X' }], ['POST', '/items/check', { list: 'X', item: 'y' }],
      ['POST', '/items/uncheck', { list: 'X', item: 'y' }], ['POST', '/items/edit', { list: 'X', item: 'y', title: 'z' }], ['POST', '/items/move', { list: 'X', item: 'y', to: 'top' }],
      ['POST', '/items/remove', { list: 'X', item: 'y' }]]) {
      const res = await f.call(method, route, body, null);
      assert.deepEqual([res.status, res.body.error], [401, 'not_authenticated'], `${method} ${route}`);
    }
    assert.deepEqual((await f.call('GET', '/lists')).body.lists, []);
  },

  'the grocery list is not kept here: a grocery or shopping name is refused and says where it lives': async (f) => {
    for (const name of ['Groceries', 'grocery', 'my grocery list', 'Shopping', 'the shopping list', 'Grocery shopping']) {
      const made = await f.call('POST', '/lists', { name });
      assert.deepEqual([made.status, made.body.error], [409, 'kept_by_shopping'], name);
      assert.match(made.body.message, /kept by Shopping/);
      const added = await f.call('POST', '/items/add', { list: name, items: [{ title: 'eggs' }] });
      assert.deepEqual([added.status, added.body.error], [409, 'kept_by_shopping'], name);
      assert.equal((await f.call('GET', `/show?list=${encodeURIComponent(name)}`)).body.error, 'kept_by_shopping');
    }
    assert.equal((await f.call('POST', '/lists', { name: 'Christmas shopping' })).status, 201, 'other lists about shopping are ordinary lists');
    assert.equal((await f.call('POST', '/rename', { list: 'Christmas shopping', name: 'Groceries' })).body.error, 'kept_by_shopping');
    assert.deepEqual((await f.call('GET', '/lists')).body.lists.map((l) => l.name), ['Christmas shopping']);
  },

  'a list holds at most 300 items, a call at most 50, a person at most 100 lists': async (f) => {
    const batch = (from, n) => Array.from({ length: n }, (_, i) => ({ title: `Item ${from + i}` }));
    assert.equal((await f.call('POST', '/items/add', { list: 'Big', items: batch(1, 51) })).status, 400);
    for (let from = 1; from <= 300; from += 50) assert.equal((await f.call('POST', '/items/add', { list: 'Big', items: batch(from, 50) })).status, 200);
    const full = await f.call('POST', '/items/add', { list: 'Big', title: 'One more' });
    assert.deepEqual([full.status, full.body.error], [409, 'list_full']);
    assert.equal((await f.call('GET', '/show?list=Big')).body.items.length, 300);
    for (let n = 2; n <= 100; n += 1) assert.equal((await f.call('POST', '/lists', { name: `List ${n}` })).status, 201);
    const over = await f.call('POST', '/lists', { name: 'List 101' });
    assert.deepEqual([over.status, over.body.error], [409, 'too_many_lists']);
    assert.equal((await f.call('POST', '/items/add', { list: 'A new one', title: 'x' })).body.error, 'too_many_lists');
  },
};

module.exports = { CASES };
