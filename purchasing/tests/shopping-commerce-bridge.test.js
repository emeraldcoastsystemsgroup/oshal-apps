/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the Shopping assistant rail under plain node: the manifest declares its surface.ops from the closed bridge vocabulary (without them the cockpit relay forwards nothing), the page loads the SHARED client and producer rather than a hand-rolled postMessage, marks its bridge fields and hosts, advertises exactly the custom ops its handler applies (each description under the contract's 600-character cap), opens Walmart from ONE place (the explicit checkout) and never from the chat reply, and its digest stays under the contract's 4000-character cap on a 40-product, 60-line cart.
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
const page = fs.readFileSync(path.join(PKG, 'tools', 'shopping-chat.html'), 'utf8');
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
  assert.match(page, /createSurfaceBridgeClient\(\{ app: 'purchasing' \}\)/);
  assert.match(page, /bridge\.attach\(\)/);
  assert.match(page, /createSurfaceProducer\(\{ win: window, postTarget: 'self', app: 'purchasing' \}\)/);
  assert.match(page, /id="shipAddress" data-bridge-field="shipAddress"/);
  assert.match(page, /id="query" data-bridge-field="query"/);
  assert.match(page, /data-bridge-host="options"/);
  assert.match(page, /data-bridge-host="notices"/);
  assert.doesNotMatch(page, /parent\.postMessage/, 'no hand-rolled postMessage vocabulary');
});

test('the custom ops the page advertises are exactly the ones its handler applies', () => {
  const advertised = [...fn('publishContext').matchAll(/\{ name: '([a-z_]+)', description: ([A-Z_]+) \}/g)];
  assert.deepEqual(advertised.map((m) => m[1]), ['search', 'add_product', 'checkout']);
  const handler = fn('onBridgeCustom');
  assert.match(handler, /detail\.name === 'request_context'/, 'the floating assistant asks for a snapshot when it opens');
  for (const [, name, constant] of advertised) {
    assert.match(handler, new RegExp(`detail\\.name === '${name}'`), `the handler applies ${name}`);
    const doc = new RegExp(`const ${constant} = '([^\\n]*)';`).exec(page);
    assert.ok(doc, `${constant} is a single-line literal`);
    assert.ok(doc[1].length <= 600, `${name}: the contract caps a customOps description at 600 characters`);
  }
  assert.match(fn('publishContext'), /can: \['set_field', 'custom', 'propose', 'notify'\]/);
});

test('Walmart opens from the explicit checkout only; a chat reply becomes a confirm card', () => {
  const opens = [...page.matchAll(/window\.open\(/g)];
  assert.equal(opens.length, 1, 'exactly one hand-off site');
  assert.match(fn('checkout'), /window\.open\(result\.checkoutUrl, '_blank'\)/, 'and it is the explicit checkout');
  const chat = fn('sendChat');
  assert.doesNotMatch(chat, /window\.open|checkoutUrl/, 'the chat reply never opens a hand-off');
  assert.match(chat, /if \(result\.proposal\) proposeCheckout\(result\.proposal\)/);
  assert.match(fn('proposeCheckout'), /op: 'propose', actionId: 'checkout'/);
  assert.doesNotMatch(fn('proposeCheckout'), /checkout\(\)|window\.open/, 'proposing never hands off');
  const click = fn('onProposalClick');
  assert.match(click, /classList\.contains\('bridge-confirm'\)/);
  assert.match(click, /if \(action === 'checkout'\) checkout\(\);/, 'only the confirm of a checkout card hands off');
  assert.match(page, /\$\('#bridgeOptions'\)\.addEventListener\('click', onProposalClick, true\)/, 'capture phase: before the client clears the card');
});

test('a direct add sends no price: the server prices the line', () => {
  const add = fn('addProduct');
  assert.match(add, /productId: product\.productId/);
  assert.doesNotMatch(add, /price:|imageUrl:|brand:/);
});

test('the digest stays under the 4000-character contract cap on a large cart', () => {
  const start = page.indexOf('// digest-helpers:start');
  const end = page.indexOf('// digest-helpers:end');
  assert.ok(start > 0 && end > start, 'the digest helper is where the guard expects it');
  const ctx = { money: (v) => (Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '--'), DIGEST_CAP: 3900 };
  vm.createContext(ctx);
  vm.runInContext(page.slice(start, end), ctx);
  const products = Array.from({ length: 40 }, (_, i) => ({ productId: String(10000000 + i), title: `Product number ${i} with a long descriptive retail title`, price: 1 + i / 100 }));
  const items = Array.from({ length: 60 }, (_, i) => ({ product_id: String(20000000 + i), title: `Cart line ${i} with a long descriptive retail title`, quantity: 1 + (i % 3), unit_price: '2.78' }));
  ctx.view = { cart: { items, total: 333.6, unpricedLines: 2 }, products, shipAddress: '1 Example Way', heading: 'Results for "milk"', source: 'demo' };
  const digest = vm.runInContext('shoppingDigest(view)', ctx);
  assert.ok(digest.length <= 4000, `digest ${digest.length} chars: over the cap the whole context op is dropped`);
  assert.match(digest, /^Cart: 60 lines, total \$333\.60 \(2 without a price\)/);
  assert.match(digest, /…\(truncated\)$/);
  ctx.view = { cart: { items: items.slice(0, 1), total: 2.78 }, products: products.slice(0, 1), shipAddress: '', heading: 'Deals and staples', source: 'walmart' };
  const small = vm.runInContext('shoppingDigest(view)', ctx);
  assert.match(small, /Lines: 20000000 Cart line 0 with a long descriptive retail title x1 @ \$2\.78/);
  assert.match(small, /Ship to: not set/);
  assert.match(small, /Products: 10000000 Product number 0/);
  assert.doesNotMatch(small, /truncated/);
});
