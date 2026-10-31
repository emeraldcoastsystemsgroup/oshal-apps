/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the Eats assistant rail under plain node: the manifest declares its surface.ops from the closed bridge vocabulary, the page loads the SHARED client and producer, marks its bridge fields and hosts, advertises exactly the custom ops its handler applies, opens Uber Eats from ONE place and never from the chat reply, and keeps its digest under the contract's 4000-character cap.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 1.4.0: the custom ops are `search` and `open_uber_eats` (no menu, no cart); the one hand-off site is requestOrder, which sends only the restaurant's place id and the address; a chat proposal and a relayed open_uber_eats both become the shared confirm card whose Confirm alone hands off; the digest is the restaurants on screen with their place ids.
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
  assert.deepEqual(advertised.map((m) => m[1]), ['search', 'open_uber_eats']);
  const handler = fn('onBridgeCustom');
  assert.match(handler, /detail\.name === 'request_context'/, 'the floating assistant asks for a snapshot when it opens');
  for (const [, name, constant] of advertised) {
    assert.match(handler, new RegExp(`detail\\.name === '${name}'`), `the handler applies ${name}`);
    const doc = new RegExp(`const ${constant} = '([^\\n]*)';`).exec(page);
    assert.ok(doc, `${constant} is a single-line literal`);
    assert.ok(doc[1].length <= 600, `${name}: the contract caps a customOps description at 600 characters`);
  }
  assert.match(handler, /if \(proposal\) proposeOrder\(proposal\)/, 'a relayed open_uber_eats proposes, it never opens');
  assert.doesNotMatch(handler, /requestOrder\(|window\.open/, 'the handler never hands off by itself');
});
test('Uber Eats opens from the explicit hand-off only; a chat reply becomes a confirm card', () => {
  const opens = [...page.matchAll(/window\.open\(/g)];
  assert.equal(opens.length, 1, 'exactly one hand-off site');
  assert.match(fn('requestOrder'), /window\.open\(result\.checkoutUrl, '_blank'\)/, 'and it is the explicit hand-off');
  const chat = fn('sendChat');
  assert.doesNotMatch(chat, /window\.open|checkoutUrl/, 'the chat reply never opens a hand-off');
  assert.match(chat, /if \(result\.proposal\) proposeOrder\(result\.proposal\)/);
  assert.match(chat, /hydrateCards\(result\.cards\)/, 'chat-shown restaurants get working Order buttons');
  assert.match(fn('proposeOrder'), /op: 'propose', actionId: 'open_uber_eats'/);
  assert.doesNotMatch(fn('proposeOrder'), /requestOrder\(|window\.open/, 'proposing never hands off');
  const click = fn('onProposalClick');
  assert.match(click, /classList\.contains\('bridge-confirm'\)/);
  assert.match(click, /if \(action === 'open_uber_eats'\) requestOrder\(state\.proposedPlaceId\);/, 'only the confirm of a hand-off card hands off');
  assert.match(page, /\$\('#bridgeOptions'\)\.addEventListener\('click', onProposalClick, true\)/, 'capture phase: before the client clears the card');
});
test('a hand-off sends only the restaurant\'s place id and the address: the server builds the link', () => {
  const order = fn('requestOrder');
  assert.match(order, /\{ placeId, address: \$\('#address'\)\.value\.trim\(\) \}/);
  assert.doesNotMatch(order, /price|checkoutUrl: |uberUrl/);
  assert.doesNotMatch(page, /data-price=|data-url=/, 'cards carry no price and no link for the browser to send');
});
test('the digest stays under the 4000-character contract cap on a long list of restaurants', () => {
  const start = page.indexOf('// digest-helpers:start');
  const end = page.indexOf('// digest-helpers:end');
  assert.ok(start > 0 && end > start, 'the digest helper is where the guard expects it');
  const ctx = { DIGEST_CAP: 3900 };
  vm.createContext(ctx);
  vm.runInContext(page.slice(start, end), ctx);
  const restaurants = Array.from({ length: 40 }, (_, i) => ({ placeId: `ChIJ-${'x'.repeat(24)}-${i}`, name: `Restaurant number ${i} with a long descriptive name`, cuisine: 'Mediterranean restaurant', rating: 4.5, priceLabel: '$$', openNow: true }));
  ctx.view = { heading: 'Results for "pizza"', address: '1 Example Way', restaurants };
  const digest = vm.runInContext('eatsDigest(view)', ctx);
  assert.ok(digest.length <= 4000, `digest ${digest.length} chars: over the cap the whole context op is dropped`);
  assert.match(digest, /^Deliver to: 1 Example Way\nShowing: Results for "pizza"\nRestaurants: ChIJ-x+-0 Restaurant number 0/);
  assert.match(digest, /…\(truncated\)$/);
  ctx.view = { heading: 'Restaurants near you', address: '', restaurants: [{ placeId: 'ChIJ-sushi', name: 'Sushi House', cuisine: 'Japanese restaurant', rating: 4.8, priceLabel: '$$', openNow: true }] };
  const small = vm.runInContext('eatsDigest(view)', ctx);
  assert.match(small, /Deliver to: not set/);
  assert.match(small, /Restaurants: ChIJ-sushi Sushi House \(Japanese restaurant\) 4\.8★ \$\$ open/);
  assert.match(small, /Ordering opens Uber Eats at the address; no menu or prices are known here\./);
  assert.doesNotMatch(small, /truncated/);
});
