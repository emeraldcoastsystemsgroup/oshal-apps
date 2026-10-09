/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the Eats assistant rail under plain node: the manifest declares its surface.ops from the closed bridge vocabulary (without them the cockpit relay forwards nothing), the page loads the SHARED client and producer rather than a hand-rolled postMessage, marks its bridge fields and hosts, advertises exactly the custom ops its handler applies (each description under the contract's 600-character cap), opens Uber Eats from ONE place (the explicit order button) and never from the chat reply, sends no price when adding a dish, wires the Add buttons of chat-shown dishes, and keeps its digest under the contract's 4000-character cap.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PKG = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
const page = fs.readFileSync(path.join(PKG, 'tools', 'eats-app.html'), 'utf8');
const VOCABULARY = ['render_options', 'set_field', 'set_content', 'propose', 'navigate', 'notify', 'custom', 'select', 'field_change', 'submit', 'event', 'context'];

/** The body of one named function in the page's classic script (up to the next top-level function). */
function fn(name) {
  const start = page.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  assert.ok(start > 0, `${name} is defined`);
  const next = page.slice(start + 1).search(/\n(?:async )?function |\n<\/script>/);
  return page.slice(start, start + 1 + next);
}

test('the manifest declares its surface-bridge ops from the closed vocabulary', () => {
  const block = manifest.match(/^surface:\s*\n\s*ops:\s*\[([^\]]*)\]/m);
  assert.ok(block, 'no `surface: ops:` block: the cockpit relay forwards NOTHING for this app');
  const ops = block[1].split(',').map((s) => s.trim());
  for (const op of ['context', 'set_field', 'field_change', 'custom', 'propose', 'submit', 'notify']) assert.ok(ops.includes(op), `surface.ops missing ${op}`);
  for (const op of ops) assert.ok(VOCABULARY.includes(op), `${op} is not a surface-bridge op`);
});

test('the page speaks the shared bridge: client attached, producer on its own window, fields and hosts marked', () => {
  assert.match(page, /import\('\/shared\/ui\/js\/surface-bridge-client\.js'\)/);
  assert.match(page, /import\('\/shared\/ui\/js\/surface-bridge-producer\.js'\)/);
  assert.match(page, /createSurfaceBridgeClient\(\{ app: 'eats' \}\)/);
  assert.match(page, /bridge\.attach\(\)/);
  assert.match(page, /createSurfaceProducer\(\{ win: window, postTarget: 'self', app: 'eats' \}\)/);
  assert.match(page, /id="address" data-bridge-field="address"/);
  assert.match(page, /id="query" data-bridge-field="query"/);
  assert.match(page, /data-bridge-host="options"/);
  assert.match(page, /data-bridge-host="notices"/);
  assert.doesNotMatch(page, /parent\.postMessage/, 'no hand-rolled postMessage vocabulary');
});

test('the custom ops the page advertises are exactly the ones its handler applies', () => {
  const advertised = [...fn('publishContext').matchAll(/\{ name: '([a-z_]+)', description: ([A-Z_]+) \}/g)];
  assert.deepEqual(advertised.map((m) => m[1]), ['search', 'open_menu', 'add_item', 'place_order']);
  const handler = fn('onBridgeCustom');
  assert.match(handler, /detail\.name === 'request_context'/, 'the floating assistant asks for a snapshot when it opens');
  for (const [, name, constant] of advertised) {
    assert.match(handler, new RegExp(`detail\\.name === '${name}'`), `the handler applies ${name}`);
    const doc = new RegExp(`const ${constant} = '([^\\n]*)';`).exec(page);
    assert.ok(doc, `${constant} is a single-line literal`);
    assert.ok(doc[1].length <= 600, `${name}: the contract caps a customOps description at 600 characters`);
  }
});

test('Uber Eats opens from the explicit order button only; a chat reply becomes a confirm card', () => {
  const opens = [...page.matchAll(/window\.open\(/g)];
  assert.equal(opens.length, 1, 'exactly one hand-off site');
  assert.match(fn('requestOrder'), /window\.open\(result\.checkoutUrl, '_blank'\)/, 'and it is the explicit order');
  const chat = fn('sendChat');
  assert.doesNotMatch(chat, /window\.open|checkoutUrl/, 'the chat reply never opens a hand-off');
  assert.match(chat, /if \(result\.proposal\) proposeOrder\(result\.proposal\)/);
  assert.match(chat, /hydrateDishButtons\(result\.cards\)/, 'chat-shown dishes get working Add buttons');
  assert.match(fn('proposeOrder'), /op: 'propose', actionId: 'place_order'/);
  assert.doesNotMatch(fn('proposeOrder'), /requestOrder\(\)|window\.open/, 'proposing never hands off');
  const click = fn('onProposalClick');
  assert.match(click, /classList\.contains\('bridge-confirm'\)/);
  assert.match(click, /if \(action === 'place_order'\) requestOrder\(\);/, 'only the confirm of an order card hands off');
  assert.match(page, /\$\('#bridgeOptions'\)\.addEventListener\('click', onProposalClick, true\)/, 'capture phase: before the client clears the card');
});

test('adding a dish sends ids only: the server prices the line', () => {
  const add = fn('addItem');
  assert.match(add, /\{ storeId: item\.storeId, productId: item\.productId, quantity: 1 \}/);
  assert.doesNotMatch(add, /price:|imageUrl:|dataset.price/);
  assert.doesNotMatch(page, /data-price=/, 'dish cards no longer carry a price for the browser to send');
});

test('the digest stays under the 4000-character contract cap on a large order and menu', () => {
  const start = page.indexOf('// digest-helpers:start');
  const end = page.indexOf('// digest-helpers:end');
  assert.ok(start > 0 && end > start, 'the digest helper is where the guard expects it');
  const ctx = { DIGEST_CAP: 3900 };
  vm.createContext(ctx);
  vm.runInContext(page.slice(start, end), ctx);
  const dishes = Array.from({ length: 40 }, (_, i) => ({ storeId: 'store-with-a-long-identifier', productId: `dish-${i}`, title: `Dish number ${i} with a long descriptive menu title`, price: 9 + i / 100 }));
  const items = Array.from({ length: 30 }, (_, i) => ({ item_id: `dish-${i}`, title: `Order line ${i} with a long descriptive menu title`, quantity: 1 + (i % 3), price: '9.95' }));
  ctx.view = { cart: { items, total: 596.99, storeName: 'Sushi House', unpricedLines: 1 }, mode: 'menu', heading: 'Sushi House', address: '1 Example Way', restaurants: [], dishes };
  const digest = vm.runInContext('eatsDigest(view)', ctx);
  assert.ok(digest.length <= 4000, `digest ${digest.length} chars: over the cap the whole context op is dropped`);
  assert.match(digest, /^Order: 30 lines from Sushi House, total \$596\.99 \(1 without a price\)/);
  assert.match(digest, /…\(truncated\)$/);
  ctx.view = { cart: { items: [], total: 0, storeName: '' }, mode: 'restaurants', heading: 'Popular near you', address: '', restaurants: [{ productId: 'sushi-house', title: 'Sushi House', cuisine: 'Japanese' }], dishes: [] };
  const small = vm.runInContext('eatsDigest(view)', ctx);
  assert.match(small, /Deliver to: not set/);
  assert.match(small, /Restaurants: sushi-house Sushi House \(Japanese\)/);
  assert.doesNotMatch(small, /Menu:|truncated/);
});
