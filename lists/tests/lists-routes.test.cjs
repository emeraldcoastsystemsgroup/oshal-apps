/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lists 1.0.0 routes over the memory pool: every shared scenario (tests/support/scenarios.cjs), then what only this pool can show: a GET issues no write (the native kernel admits a GET read-only and refuses any other statement), every statement names the caller, the page and its two files are served, and an unknown file is not.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, WRITER_REFUSAL } = require('./support/fixture.cjs');
const { CASES } = require('./support/scenarios.cjs');

for (const [name, run] of Object.entries(CASES)) {
  test(name, async () => {
    const f = await app();
    try { await run(f); } finally { await f.close(); }
  });
}

test('a GET never writes: the reads of a person with nothing, and of one with lists, issue only queries', async () => {
  const f = await app();
  try {
    assert.equal((await f.call('GET', '/lists')).status, 200);
    assert.equal((await f.call('GET', '/show?list=Anything')).status, 404);
    await f.call('POST', '/items/add', { list: 'Trip', items: [{ title: 'Map' }] });
    const before = f.pool.sql.length;
    assert.equal((await f.call('GET', '/lists')).status, 200);
    assert.equal((await f.call('GET', '/show?list=Trip')).status, 200);
    assert.equal((await f.call('GET', '/app')).status, 200);
    assert.deepEqual(f.pool.refused, [], `no statement was refused with "${WRITER_REFUSAL}"`);
    for (const statement of f.pool.sql.slice(before)) assert.match(statement, /^SELECT /, statement);
  } finally { await f.close(); }
});

test('every statement the routes issue names the caller', async () => {
  const f = await app();
  try {
    const made = await f.call('POST', '/items/add', { list: 'Audit', items: [{ title: 'One' }, { title: 'Two' }] });
    const [one, two] = made.body.added;
    await f.call('POST', '/items/check', { list: 'Audit', item: one.id });
    await f.call('POST', '/items/uncheck', { list: 'Audit', item: one.id });
    await f.call('POST', '/items/edit', { list: 'Audit', item: two.id, note: 'n' });
    await f.call('POST', '/items/move', { list: 'Audit', item: two.id, to: 'top' });
    await f.call('POST', '/items/check', { list: 'Audit', item: two.id });
    await f.call('POST', '/clear-done', { list: 'Audit' });
    await f.call('POST', '/items/remove', { list: 'Audit', item: one.id });
    await f.call('POST', '/rename', { list: 'Audit', name: 'Audited' });
    await f.call('POST', '/delete', { list: 'Audited' });
    assert.ok(f.pool.sql.length > 20);
    for (const statement of f.pool.sql) assert.match(statement, /user_sub(?: = \$1|, )/, statement);
    assert.deepEqual([f.pool.tables.lists.length, f.pool.tables.items.length], [0, 0]);
  } finally { await f.close(); }
});

test('the page and its two files are served; nothing else in the folder is', async () => {
  const f = await app();
  try {
    const page = await f.call('GET', '/app');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.text, /<title>Lists<\/title>/);
    const css = await f.call('GET', '/static/lists.css');
    assert.deepEqual([css.status, /text\/css/.test(css.type)], [200, true]);
    const js = await f.call('GET', '/static/lists.js');
    assert.deepEqual([js.status, /javascript/.test(js.type)], [200, true]);
    for (const name of ['lists.html', '..%2Foshal-app.yaml', 'nothing.js']) assert.equal((await f.call('GET', `/static/${name}`)).status, 404, name);
    assert.equal((await f.call('GET', '/app', undefined, null)).status, 401, 'the page is for a signed-in person');
  } finally { await f.close(); }
});

test('a store that fails answers 503 in words, never a stack or the statement', async () => {
  const broken = { query: async () => { throw new Error('connection terminated: SELECT id FROM lists_lists'); } };
  const f = await app({ pool: broken });
  try {
    for (const [method, route, body] of [['GET', '/lists'], ['GET', '/show?list=x'], ['POST', '/lists', { name: 'X' }], ['POST', '/items/add', { list: 'X', title: 'y' }]]) {
      const res = await f.call(method, route, body);
      assert.deepEqual([res.status, res.body.error], [503, 'lists_unavailable'], `${method} ${route}`);
      assert.doesNotMatch(JSON.stringify(res.body), /SELECT|lists_lists|terminated/);
    }
  } finally { await f.close(); }
});
