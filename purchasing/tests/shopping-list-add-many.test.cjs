/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Several items behind one approval card. Asked from Jarvis to "add milk, eggs, bread and bananas to my
 *   grocery cart", the concierge proposed one card (milk) and stopped. shopping-list-add-many is an approval-held POST whose items[] body,
 *   through the real compiled route under writer admission, puts every item on the list Home shows exactly as written; an entry with no
 *   title or more than 30 entries is refused with nothing written, and another shopper's list stays refused.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakePool, admittedPool, callAdmitted, loadRoutes, authed } = require('./shopping-routes-harness');

const ROOT = path.resolve(__dirname, '..', '..');
const yaml = require(path.join(ROOT, 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'purchasing', 'oshal-app.yaml'), 'utf8'));
const tool = manifest.tools.find((t) => t.name === 'shopping-list-add-many');

async function add(seed, sub, body, listId = 'default') {
  const pool = admittedPool(fakePool(seed));
  const { handlers } = loadRoutes({ pool });
  const res = await callAdmitted(handlers, pool, 'post', '/lists/:listId/items', authed(sub, { params: { listId }, body }));
  return { res, pool };
}

const home = () => ({ lists: [{ list_id: 'list-home', user_sub: 'shopper-a', name: 'Shopping list', status: 'active' }], items: [] });

test('the tool is an approval-held POST onto the default list that takes items[]', () => {
  assert.ok(tool, 'shopping-list-add-many is declared');
  assert.deepEqual([tool.executor.apiEndpoint, tool.requiresApproval], ['POST /api/purchasing/lists/default/items', true]);
  assert.deepEqual(tool.inputSchema.required, ['items']);
  assert.deepEqual(tool.inputSchema.properties.items.items.required, ['title']);
});

test('every item lands on the list Home shows, as written, in one call', async () => {
  const { res, pool } = await add(home(), 'shopper-a', { items: [{ title: 'milk' }, { title: 'eggs', quantity: 2 }, { title: 'bread' }, { title: 'bananas' }] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.items.map((i) => [i.list_id, i.title]), [['list-home', 'milk'], ['list-home', 'eggs'], ['list-home', 'bread'], ['list-home', 'bananas']]);
  assert.equal(pool.tables.items.length, 4);
});

test('an entry with no title, or more than 30 entries, is refused and nothing is written', async () => {
  for (const items of [[{ title: 'milk' }, { title: '  ' }], [], Array.from({ length: 31 }, (_, i) => ({ title: `item ${i}` }))]) {
    const { res, pool } = await add(home(), 'shopper-a', { items });
    assert.equal(res.statusCode, 400);
    assert.equal(pool.tables.items.length, 0);
  }
});

test('another shopper\'s list id is still refused', async () => {
  const { res, pool } = await add(home(), 'shopper-z', { items: [{ title: 'x' }] }, 'list-home');
  assert.equal(res.statusCode, 403);
  assert.equal(pool.tables.items.length, 0);
});

test('the persona sends several items to the one card', () => {
  const persona = fs.readFileSync(path.join(ROOT, 'purchasing', 'personas', 'shopping-concierge.yaml'), 'utf8');
  assert.match(persona, /call\s+shopping-list-add-many once/);
});
