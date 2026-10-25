/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove bounded account isolation, restoration and failure behavior for remembered browser searches.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { create, criteria } = require('../tools/career-search-memory.js');
function store() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
test('last and named searches persist for one account, isolated across accounts and tenants', () => {
  const storage = store(), a = create(storage, 'tenant:a');
  const search = { near: 'a regional federal hub, FL', radius_miles: '35', remote: '0', min_pay: '140000', include_unknown_pay: '1', view: 'map' };
  a.remember(search); const row = a.save('Local IT', search);
  assert.deepEqual(create(storage, 'tenant:a').last(), search);
  assert.deepEqual(create(storage, 'tenant:a').list()[0].criteria, search);
  for (const account of ['tenant:b', 'other:a']) {
    assert.equal(create(storage, account).last(), null);
    assert.deepEqual(create(storage, account).list(), []);
  }
  a.clearLast(); assert.equal(a.last(), null); assert.equal(a.list().length, 1);
  a.remove(row.id); assert.deepEqual(a.list(), []);
});
test('named searches replace duplicate names and retain only the newest twenty', () => {
  const a = create(store(), 'a'), initial = a.save('Local', { near: '32542' });
  const updated = a.save('LOCAL', { near: '32578' });
  assert.equal(initial.id, updated.id); assert.equal(a.list().length, 1);
  assert.equal(a.list()[0].criteria.near, '32578');
  for (let i = 0; i < 25; i++) a.save('Search ' + i, { radius_miles: String(i + 1) });
  assert.equal(a.list().length, 20); assert.equal(a.list()[0].name, 'Search 24');
});
test('stored values are bounded and only recognized string criteria survive', () => {
  assert.deepEqual(criteria({ near: ' 32542 ', q: 'x'.repeat(241), radius_miles: 50, secret: 'no', page: '99' }), { near: '32542' });
  const storage = store(), a = create(storage, 'a');
  storage.setItem(a.key, '{broken'); assert.equal(a.last(), null); assert.deepEqual(a.list(), []);
  storage.setItem(a.key, JSON.stringify({ last: [], saved: [null, { id: 'a', name: ' Valid ', criteria: { near: '32542', unexpected: 'no' } }] }));
  assert.deepEqual(a.last(), {}); assert.deepEqual(a.list(), [{ id: 'a', name: 'Valid', criteria: { near: '32542' } }]);
  assert.throws(() => a.save('  ', {}), /name/); assert.throws(() => create(storage, ''), /Sign in/);
});
test('blocked or full browser storage is reported instead of claiming a saved search', () => {
  const a = create({ getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } }, 'a');
  assert.equal(a.last(), null); assert.deepEqual(a.list(), []);
  assert.throws(() => a.remember({ near: '32542' }), /cannot save/);
  assert.throws(() => a.save('Local', {}), /cannot save/);
  assert.throws(() => a.remove('one'), /cannot save/);
});
