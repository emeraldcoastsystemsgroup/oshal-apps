/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the Rides assistant rail under plain node: the manifest declares its surface.ops from the closed bridge vocabulary (without them the cockpit relay forwards nothing), the page loads the SHARED client and producer rather than a hand-rolled postMessage, marks pickup and destination as bridge fields and carries the options and notices hosts, advertises exactly the custom ops its handler applies (each description under the contract's 600-character cap), opens Uber from ONE place (the explicit request) and never from the chat reply, selects the proposed ride before showing the card, and keeps its digest under the contract's 4000-character cap.
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
const page = fs.readFileSync(path.join(PKG, 'tools', 'rides-app.html'), 'utf8');
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
  assert.match(page, /createSurfaceBridgeClient\(\{ app: 'rides' \}\)/);
  assert.match(page, /bridge\.attach\(\)/);
  assert.match(page, /createSurfaceProducer\(\{ win: window, postTarget: 'self', app: 'rides' \}\)/);
  assert.match(page, /id="pickup" data-bridge-field="pickup"/);
  assert.match(page, /id="dropoff" data-bridge-field="dropoff"/);
  assert.match(page, /data-bridge-host="options"/);
  assert.match(page, /data-bridge-host="notices"/);
  assert.doesNotMatch(page, /parent\.postMessage/, 'no hand-rolled postMessage vocabulary');
});

test('the custom ops the page advertises are exactly the ones its handler applies', () => {
  const advertised = [...fn('publishContext').matchAll(/\{ name: '([a-z_]+)', description: ([A-Z_]+) \}/g)];
  assert.deepEqual(advertised.map((m) => m[1]), ['estimate', 'select_ride', 'request_ride']);
  const handler = fn('onBridgeCustom');
  assert.match(handler, /detail\.name === 'request_context'/, 'the floating assistant asks for a snapshot when it opens');
  for (const [, name, constant] of advertised) {
    assert.match(handler, new RegExp(`detail\\.name === '${name}'`), `the handler applies ${name}`);
    const doc = new RegExp(`const ${constant} = '([^\\n]*)';`).exec(page);
    assert.ok(doc, `${constant} is a single-line literal`);
    assert.ok(doc[1].length <= 600, `${name}: the contract caps a customOps description at 600 characters`);
  }
  assert.match(handler, /estimate\(\);/, 'estimate runs the same pricing the Show rides button does');
});

test('Uber opens from the explicit request only; a chat booking selects the ride and becomes a confirm card', () => {
  const opens = [...page.matchAll(/window\.open\(/g)];
  assert.equal(opens.length, 1, 'exactly one hand-off site');
  assert.match(fn('requestRide'), /window\.open\(result\.rideUrl, '_blank'\)/, 'and it is the explicit request');
  const chat = fn('sendChat');
  assert.doesNotMatch(chat, /window\.open|rideUrl/, 'the chat reply never opens a hand-off');
  assert.match(chat, /if \(result\.proposal\.rideType\) selectRide\(result\.proposal\.rideType\);\s*proposeRide\(result\.proposal\);/);
  assert.match(fn('proposeRide'), /op: 'propose', actionId: 'request_ride'/);
  assert.doesNotMatch(fn('proposeRide'), /requestRide\(\)|window\.open/, 'proposing never hands off');
  const click = fn('onProposalClick');
  assert.match(click, /classList\.contains\('bridge-confirm'\)/);
  assert.match(click, /if \(action === 'request_ride'\) requestRide\(\);/, 'only the confirm of a ride card hands off');
  assert.match(page, /\$\('#bridgeOptions'\)\.addEventListener\('click', onProposalClick, true\)/, 'capture phase: before the client clears the card');
});

test('the digest stays under the 4000-character contract cap and says when a fare is missing', () => {
  const start = page.indexOf('// digest-helpers:start');
  const end = page.indexOf('// digest-helpers:end');
  assert.ok(start > 0 && end > start, 'the digest helper is where the guard expects it');
  const ctx = { DIGEST_CAP: 3900 };
  vm.createContext(ctx);
  vm.runInContext(page.slice(start, end), ctx);
  const options = Array.from({ length: 300 }, (_, i) => ({ type: `type${i}`, label: `Ride type number ${i}`, fareLow: 10 + i, fareHigh: 14 + i, tripMin: 20 }));
  ctx.view = { pickup: 'my location', dropoff: 'x'.repeat(300), basis: 'geocoded', distance: '7.7 km straight line', options, selected: options[1], trips: 3 };
  const digest = vm.runInContext('ridesDigest(view)', ctx);
  assert.ok(digest.length <= 4000, `digest ${digest.length} chars: over the cap the whole context op is dropped`);
  assert.match(digest, /…\(truncated\)$/);
  ctx.view = { pickup: 'my location', dropoff: 'Airport', basis: 'unresolved', distance: '', options: [{ type: 'uberx', label: 'UberX', fareLow: null, fareHigh: null }], selected: null, trips: 0 };
  const small = vm.runInContext('ridesDigest(view)', ctx);
  assert.match(small, /^Trip: my location to Airport/);
  assert.match(small, /did not resolve to a location, so there are no fares/);
  assert.match(small, /Options: uberx UberX no estimate/);
  assert.doesNotMatch(small, /\$|truncated/);
});
