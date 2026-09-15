/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The relay envelope: routes built from the chain order both ways; an envelope signed at its source verifies at its destination and fails after any covered field is touched (a relay's via stamp is not covered); each node on the route forwards to exactly the next id and the destination delivers; a node not at the current hop, a loop, an exhausted hop budget, an off-route hop index and a route ending elsewhere are dropped naming the reason; replay inside the window is refused; frames fragment to an MTU and reassemble out of order, and a missing fragment yields nothing.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));
const chain = ['r1', 'r2', 'r3', 'tip'];

test('routes follow the chain order outward and back', () => {
  assert.deepEqual(e.routeThrough(chain, 'tip', 'outward'), ['base', 'r1', 'r2', 'r3', 'tip']);
  assert.deepEqual(e.routeThrough(chain, 'r2', 'outward'), ['base', 'r1', 'r2']);
  assert.deepEqual(e.routeThrough(chain, 'r2', 'inward'), ['r2', 'r1', 'base']);
  assert.throws(() => e.routeThrough(chain, 'r9', 'outward'), /not on the chain/);
  assert.throws(() => e.validateRoute(['base', 'r1', 'base']), /loop/);
  assert.throws(() => e.validateRoute(['base']), /at least/);
  assert.throws(() => e.validateRoute(Array.from({ length: 17 }, (_, i) => `n${i}`)), /longer than 16/);
});

test('an envelope walks the chain: forward, forward, deliver — and drops name their reason', () => {
  const route = e.routeThrough(chain, 'tip', 'outward');
  let env = e.buildEnvelope({ kind: 'command', route, payload: { id: 'c1', command: 'gotoPoint', args: { lat: 1 } }, ts: 1000, id: 'c1' });
  assert.equal(env.src, 'base');
  assert.equal(env.dst, 'tip');
  assert.equal(env.ttl, 5);
  assert.deepEqual(e.decideForward(env, 'base'), { action: 'forward', to: 'r1' });
  assert.deepEqual(e.decideForward(env, 'r1'), { action: 'drop', reason: 'not addressed to r1 at hop 0' });
  env = e.advance(env);
  assert.deepEqual(e.decideForward(env, 'r1'), { action: 'forward', to: 'r2' });
  env = e.advance(e.advance(env));
  assert.deepEqual(e.decideForward(env, 'r3'), { action: 'forward', to: 'tip' });
  env = e.advance(env);
  assert.deepEqual(e.decideForward(env, 'tip'), { action: 'deliver' });
  assert.equal(env.ttl, 1);
  assert.deepEqual(e.decideForward({ ...env, ttl: 0 }, 'tip'), { action: 'drop', reason: 'ttl exhausted' });
  assert.deepEqual(e.decideForward({ ...env, hop: 9 }, 'tip'), { action: 'drop', reason: 'hop index off the route' });
  assert.deepEqual(e.decideForward({ ...env, route: ['base', 'r1', 'r1', 'tip'], hop: 2 }, 'r1'), { action: 'drop', reason: 'route loops through this node' });
  assert.deepEqual(e.decideForward({ ...env, dst: 'r3' }, 'tip'), { action: 'drop', reason: 'route ends at a node that is not the destination' });
  assert.deepEqual(e.decideForward({ ...env, v: 2 }, 'tip'), { action: 'drop', reason: 'unknown envelope version' });
});

test('the end-to-end MAC survives relaying and via stamps but not tampering', () => {
  const route = e.routeThrough(chain, 'tip', 'outward');
  const signed = e.signEnvelope(e.buildEnvelope({ kind: 'command', route, payload: { command: 'land' }, ts: 5, id: 'x' }), 'pair-key');
  assert.equal(signed.mac.length, 32);
  assert.equal(e.verifyEnvelope(signed, 'pair-key'), true);
  assert.equal(e.verifyEnvelope(signed, 'other-key'), false);
  assert.equal(e.verifyEnvelope(e.advance(e.advance(signed)), 'pair-key'), true, 'hop and ttl are not covered');
  assert.equal(e.verifyEnvelope(e.viaAppend(signed, 'r1', -61.4), 'pair-key'), true, 'via is not covered');
  assert.equal(e.verifyEnvelope({ ...signed, payload: { command: 'takeoff' } }, 'pair-key'), false);
  assert.equal(e.verifyEnvelope({ ...signed, dst: 'r2' }, 'pair-key'), false);
  assert.equal(e.verifyEnvelope({ ...signed, route: ['base', 'tip'] }, 'pair-key'), false);
  assert.equal(e.verifyEnvelope({ ...signed, mac: undefined }, 'pair-key'), false);
  assert.deepEqual(e.viaAppend(e.viaAppend(signed, 'r3', -70.2), 'r2', -55).via, [{ node: 'r3', rssiDbm: -70 }, { node: 'r2', rssiDbm: -55 }]);
});

test('replay inside the window is refused; stale timestamps too', () => {
  const w = new e.ReplayWindow(10_000);
  const env = e.buildEnvelope({ kind: 'heartbeat', route: ['tip', 'r1', 'base'], payload: {}, ts: 100_000, id: 'h1' });
  assert.equal(w.accept(env, 100_500), true);
  assert.equal(w.accept(env, 101_000), false, 'same id again');
  assert.equal(w.accept({ ...env, id: 'h2' }, 101_000), true);
  assert.equal(w.accept({ ...env, id: 'h3', ts: 50_000 }, 101_000), false, 'too old');
  assert.equal(w.accept(env, 200_000), false, 'the id would be fresh again but the timestamp is stale');
});

test('frames fragment to the MTU and reassemble in any order', () => {
  const bytes = new Uint8Array(1000).map((_, i) => i % 251);
  const frags = e.fragment(bytes, 250, 'f1');
  assert.equal(frags.length, 4);
  assert.deepEqual(frags.map((f) => f.data.length), [250, 250, 250, 250]);
  assert.deepEqual(e.reassemble([frags[3], frags[0], frags[2], frags[1]]), bytes);
  assert.equal(e.reassemble([frags[0], frags[1], frags[2]]), null);
  assert.equal(e.reassemble([]), null);
  assert.equal(e.reassemble([frags[0], { ...frags[1], id: 'f2' }]), null);
  assert.equal(e.fragment(new Uint8Array(0), 250, 'z').length, 1);
  assert.throws(() => e.fragment(bytes, 0, 'f1'), /mtu/);
  const odd = e.fragment(new Uint8Array(501), 250, 'o');
  assert.deepEqual(odd.map((f) => f.data.length), [250, 250, 1]);
});
