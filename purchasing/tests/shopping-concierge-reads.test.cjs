/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The shopping concierge reads the shopper's list and cart. The Home assistant answered "I do not
 *   have direct access to view your current shopping list or cart" while the Home list showed an item, because no declared tool read
 *   them. Each read tool must be a GET the native kernel offers a bot automatically (inside /api/purchasing, defaultAuthMode set,
 *   no approval), and its endpoint, rendered as the kernel renders it, must reach the real route and return the item under the
 *   native host's read admission. shopping-concierge runs inline, and Home borrows it as its concierge.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakePool, admittedPool, callAdmitted, loadRoutes, authed } = require('./shopping-routes-harness');

const ROOT = path.resolve(__dirname, '..', '..');
const yaml = require(path.join(ROOT, 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
const load = (rel) => yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const manifest = load('purchasing/oshal-app.yaml');
const tool = (name) => manifest.tools.find((t) => t.name === name);
const MILK = { item_id: 'item-milk', list_id: 'list-a', user_sub: 'shopper-a', title: 'sweep2-milk-test', quantity: 1, unit_price: null, status: 'pending' };

/** The kernel's rendering (crates/oshald/src/package_api_tools.rs render): method, mount-relative route, input placeholders. */
function render(name, input) {
  const [method, target] = tool(name).executor.apiEndpoint.split(' ');
  assert.ok(target.startsWith('/api/purchasing/'), `${name} stays inside the package mount`);
  const local = target.slice('/api/purchasing'.length);
  return { method: method.toLowerCase(), route: local.replace(/\{input\.(\w+)\}/g, ':$1'), params: input };
}

async function read(name, input = {}) {
  const pool = admittedPool(fakePool({ lists: [{ list_id: 'list-a', user_sub: 'shopper-a', name: 'Shopping list', status: 'active' }], items: [MILK] }));
  const { handlers } = loadRoutes({ pool });
  const { method, route, params } = render(name, input);
  const res = await callAdmitted(handlers, pool, method, route, authed('shopper-a', { params }));
  assert.deepEqual(pool.refused, [], `${name} writes nothing on a read`);
  return res;
}

test('each list and cart read is a GET the kernel offers the bot without approval', () => {
  for (const name of ['shopping-lists', 'shopping-list-items', 'shopping-cart']) {
    const t = tool(name);
    assert.ok(t, `${name} is declared`);
    assert.equal(t.executor.executorType, 'api');
    assert.match(t.executor.apiEndpoint, /^GET \/api\/purchasing\//);
    assert.equal(t.requiresApproval, false);
    assert.equal(t.defaultAuthMode, 'auto');
  }
});

test('the rendered endpoints reach the real routes and return the item on the list', async () => {
  const lists = await read('shopping-lists');
  assert.equal(lists.statusCode, 200);
  assert.equal(lists.body.lists[0].list_id, 'list-a');
  assert.equal(lists.body.lists[0].item_count, '1');
  const items = await read('shopping-list-items', { listId: 'list-a' });
  assert.deepEqual(items.body.items.map((i) => i.title), ['sweep2-milk-test']);
  const cart = await read('shopping-cart');
  assert.equal(cart.body.listId, 'list-a');
  assert.deepEqual(cart.body.items.map((i) => i.title), ['sweep2-milk-test']);
  assert.equal(cart.body.unpricedLines, 1);
});

test('shopping-concierge runs inline and is the Home concierge', () => {
  const bot = manifest.bots.find((b) => b.name === 'shopping-concierge');
  assert.equal(bot.posture, 'inline');
  assert.equal(bot.requiresOwnNode, undefined);
  const home = load('home-experience/oshal-app.yaml');
  assert.equal(home.chatBot, 'shopping-concierge');
  assert.deepEqual(home.dependencies.required.bots, [{ app: 'purchasing', name: 'shopping-concierge' }]);
});
