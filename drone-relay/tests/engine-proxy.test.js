/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Proxy replies and the command queue (backlog B11), in memory: an envelope without a proxy stamp signs byte for byte as before B11 (the MAC recomputed by hand over the eight original fields); a proxy stamp is covered by the MAC (changing whom it stands for or its age, stripping it, adding it or nulling it all fail verification, none throws) and is legal only on a reply, for another node, with a finite age; decideForward walks a proxy reply and a query exactly like any other envelope; the ProxyQueue refuses a hold past the replay window and a bad size, holds commands only, oldest first, bounded, measured from the command's own timestamp, and drops a stale one naming its age and the window; the relay role forwards when the next hop answers, answers a query for a node it cannot reach by proxy (its own key, the far node's heartbeat untouched as the payload), holds a command and releases it on the original MAC the moment it hears the next hop again, and drops what it cannot hold naming why.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHmac } = require('node:crypto');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const KEYS = { tip: 'tip-base-key', r2: 'r2-base-key' };
const WINDOW_MS = 30_000;
const T0 = 1_000_000;

/** A link view over an explicit set of neighbours that are down. */
const linkView = (down = []) => ({ up: (id) => !down.includes(id) });

/** The tip's heartbeat as r2 receives it: route tip → r2 → r1 → base, one hop in. */
function tipHeartbeat(ts, id = `hb-${ts}`) {
  const env = e.signEnvelope(e.buildEnvelope({ kind: 'heartbeat', route: ['tip', 'r2', 'r1', 'base'], payload: { battery: 71, s: 1000 }, ts, id }), KEYS.tip);
  return e.advance(env);
}

/** A command (or query) from the base to the tip as r2 receives it: two hops out. */
function outward(kind, ts, id) {
  const env = e.signEnvelope(e.buildEnvelope({ kind, route: ['base', 'r1', 'r2', 'tip'], payload: kind === 'command' ? { id, command: 'gotoPoint', args: { s: 900 } } : {}, ts, id }), KEYS.tip);
  return e.advance(e.advance(env));
}

test('an envelope without a proxy stamp signs exactly as it did before the stamp existed', () => {
  const env = e.buildEnvelope({ kind: 'command', route: ['base', 'r1', 'tip'], payload: { id: 'c1', command: 'land', args: {} }, ts: 5, id: 'c1' });
  const byHand = createHmac('sha256', 'k').update(JSON.stringify([1, 'c1', 'command', 'base', 'tip', ['base', 'r1', 'tip'], 5, { id: 'c1', command: 'land', args: {} }])).digest('hex').slice(0, 32);
  assert.equal(e.signEnvelope(env, 'k').mac, byHand);
  assert.equal(Object.prototype.hasOwnProperty.call(env, 'proxy'), false);
});

test('the proxy stamp is covered by the MAC and legal only on a reply for another node', () => {
  const reply = e.signEnvelope(e.buildEnvelope({ kind: 'reply', route: ['r2', 'r1', 'base'], payload: {}, ts: T0, id: 'proxy-q1', proxy: { for: 'tip', ageS: 12.04 } }), KEYS.r2);
  assert.deepEqual(reply.proxy, { for: 'tip', ageS: 12 }, 'the age is rounded to a tenth of a second');
  assert.equal(e.verifyEnvelope(reply, KEYS.r2), true);
  assert.equal(e.verifyEnvelope(reply, KEYS.tip), false, 'a proxy reply is the relay\'s word, not the tip\'s');
  assert.equal(e.verifyEnvelope({ ...reply, proxy: { for: 'tip', ageS: 1 } }, KEYS.r2), false, 'a relay on the way back cannot make it look fresher');
  assert.equal(e.verifyEnvelope({ ...reply, proxy: { for: 'r3', ageS: 12 } }, KEYS.r2), false);
  assert.equal(e.verifyEnvelope({ ...reply, proxy: { ageS: 12, for: 'tip' } }, KEYS.r2), true, 'key order does not matter');
  const { proxy: _stripped, ...bare } = reply;
  assert.equal(e.verifyEnvelope(bare, KEYS.r2), false, 'stripping the stamp breaks the MAC');
  const plain = e.signEnvelope(e.buildEnvelope({ kind: 'reply', route: ['r2', 'r1', 'base'], payload: {}, ts: T0, id: 'r' }), KEYS.r2);
  assert.equal(e.verifyEnvelope({ ...plain, proxy: { for: 'tip', ageS: 0 } }, KEYS.r2), false, 'adding a stamp breaks the MAC');
  assert.equal(e.verifyEnvelope({ ...plain, proxy: null }, KEYS.r2), false, 'a null stamp is not an absent one, and does not throw');
  assert.equal(e.verifyEnvelope({ ...plain, proxy: 'tip' }, KEYS.r2), false);
  const refuse = (fields, pattern) => assert.throws(() => e.buildEnvelope({ route: ['r2', 'r1', 'base'], payload: {}, ts: 1, ...fields }), pattern);
  refuse({ kind: 'command', proxy: { for: 'tip', ageS: 1 } }, /only a reply/);
  refuse({ kind: 'heartbeat', proxy: { for: 'tip', ageS: 1 } }, /only a reply/);
  refuse({ kind: 'reply', proxy: { for: 'r2', ageS: 1 } }, /does not stand in for itself/);
  refuse({ kind: 'reply', proxy: { for: 'Tip!', ageS: 1 } }, /node id/);
  refuse({ kind: 'reply', proxy: { for: 'tip', ageS: -1 } }, /ageS/);
  refuse({ kind: 'reply', proxy: { for: 'tip', ageS: Number.NaN } }, /ageS/);
});

test('forwarding still reads the route alone: a proxy reply and a query walk like any envelope', () => {
  let reply = e.signEnvelope(e.buildEnvelope({ kind: 'reply', route: ['r2', 'r1', 'base'], payload: {}, ts: T0, id: 'p', proxy: { for: 'tip', ageS: 3 } }), KEYS.r2);
  assert.deepEqual(e.decideForward(reply, 'r2'), { action: 'forward', to: 'r1' });
  reply = e.advance(reply);
  assert.deepEqual(e.decideForward(reply, 'r1'), { action: 'forward', to: 'base' });
  assert.deepEqual(e.decideForward(e.advance(reply), 'base'), { action: 'deliver' });
  assert.deepEqual(e.decideForward(reply, 'r2'), { action: 'drop', reason: 'not addressed to r2 at hop 1' });
  const query = e.buildEnvelope({ kind: 'query', route: ['base', 'r1', 'tip'], payload: {}, ts: T0, id: 'q' });
  assert.deepEqual(e.decideForward(query, 'base'), { action: 'forward', to: 'r1' });
  assert.deepEqual(e.decideForward(e.advance(e.advance(query)), 'tip'), { action: 'deliver' });
});

test('the queue refuses a hold past the replay window and a size it cannot keep', () => {
  assert.throws(() => new e.ProxyQueue({ capacity: 4, replayWindowMs: WINDOW_MS, holdMs: WINDOW_MS + 1 }), /exceeds the 30000 ms replay window/);
  assert.throws(() => new e.ProxyQueue({ capacity: 0, replayWindowMs: WINDOW_MS }), /capacity/);
  assert.throws(() => new e.ProxyQueue({ capacity: e.PROXY_QUEUE_MAX_CAPACITY + 1, replayWindowMs: WINDOW_MS }), /capacity/);
  assert.throws(() => new e.ProxyQueue({ capacity: 2.5, replayWindowMs: WINDOW_MS }), /capacity/);
  assert.throws(() => new e.ProxyQueue({ capacity: 4, replayWindowMs: 0 }), /replayWindowMs/);
  assert.equal(new e.ProxyQueue({ capacity: 4, replayWindowMs: WINDOW_MS }).holdMs, WINDOW_MS, 'the hold defaults to the window');
  assert.equal(new e.ProxyQueue({ capacity: 4, replayWindowMs: WINDOW_MS, holdMs: 20_000 }).holdMs, 20_000);
});

test('the queue holds commands only, bounded, oldest first, and measures the hold from the command\'s own timestamp', () => {
  const q = new e.ProxyQueue({ capacity: 2, replayWindowMs: WINDOW_MS });
  assert.deepEqual(q.enqueue(outward('query', T0, 'q1'), T0), { queued: false, reason: 'only commands are held for a node out of reach; a query is not queued' });
  assert.deepEqual(q.enqueue(outward('command', T0, 'c1'), T0 + 100), { queued: true, size: 1 });
  assert.deepEqual(q.enqueue(outward('command', T0, 'c1'), T0 + 200), { queued: false, reason: 'command c1 from base is already held' });
  assert.deepEqual(q.enqueue(outward('command', T0 + 500, 'c2'), T0 + 600), { queued: true, size: 2 });
  assert.deepEqual(q.enqueue(outward('command', T0 + 700, 'c3'), T0 + 800), { queued: false, reason: 'proxy queue full: 2 commands already held' });
  const late = q.enqueue(outward('command', T0 - 31_000, 'old'), T0);
  assert.equal(late.queued, false);
  assert.equal(late.reason, 'held 31000 ms since it was signed, past the 30000 ms the destination\'s replay window allows: it would be refused as stale');
  const atTip = e.advance(outward('command', T0, 'here'));
  assert.equal(q.enqueue(atTip, T0).reason, 'nothing to hold: this node is the destination');
  assert.deepEqual(q.pending().map((p) => [p.id, p.next]), [['c1', 'tip'], ['c2', 'tip']]);
  assert.deepEqual(q.drain(T0 + 5_000, 'r3'), { deliver: [], dropped: [] }, 'nothing waits for another neighbour');
  const { deliver, dropped } = q.drain(T0 + 5_000, 'tip');
  assert.deepEqual(deliver.map((env) => env.id), ['c1', 'c2'], 'oldest first');
  assert.deepEqual(dropped, []);
  assert.equal(q.size, 0);
  q.enqueue(outward('command', T0, 'c4'), T0 + 29_000);
  assert.equal(q.size, 1, 'signed 29 s ago is still inside the window');
  assert.deepEqual(q.expire(T0 + 30_000), [], 'exactly at the window it still verifies at the tip');
  const expired = q.expire(T0 + 30_001);
  assert.deepEqual(expired, [{ id: 'c4', src: 'base', dst: 'tip', reason: 'held 30001 ms since it was signed, past the 30000 ms the destination\'s replay window allows: it would be refused as stale' }]);
});

test('the relay role forwards when it can and answers for the tip by proxy when it cannot', () => {
  const r2 = new e.RelayRole({ self: 'r2', pairKey: KEYS.r2, replayWindowMs: WINDOW_MS });
  const hb = tipHeartbeat(T0);
  const [inward] = r2.receive(hb, T0 + 40, linkView());
  assert.equal(inward.action, 'forward');
  assert.equal(inward.to, 'r1');
  assert.equal(inward.env.hop, 2, 'handed on as r1 will receive it');
  const [answer] = r2.receive(outward('query', T0 + 12_000, 'q1'), T0 + 12_040, linkView(['tip']));
  assert.equal(answer.action, 'proxy-reply');
  assert.equal(answer.to, 'r1');
  const reply = answer.env;
  assert.deepEqual([reply.kind, reply.src, reply.dst, reply.route, reply.hop, reply.id], ['reply', 'r2', 'base', ['r2', 'r1', 'base'], 1, 'proxy-q1']);
  assert.deepEqual(reply.proxy, { for: 'tip', ageS: 12 }, 'twelve seconds since r2 last heard the tip');
  assert.equal(e.verifyEnvelope(reply, KEYS.r2), true, 'signed with the relay\'s own pair key');
  assert.equal(e.verifyEnvelope(reply.payload, KEYS.tip), true, 'the payload is the tip\'s own heartbeat, still verifiable with the tip\'s key');
  assert.deepEqual(reply.payload.payload, { battery: 71, s: 1000 });
  const fresh = new e.RelayRole({ self: 'r2', pairKey: KEYS.r2, replayWindowMs: WINDOW_MS });
  assert.deepEqual(fresh.receive(outward('query', T0, 'q2'), T0, linkView(['tip'])), [{ action: 'drop', id: 'q2', reason: 'next hop tip is out of reach and r2 has heard no heartbeat from tip to answer for it' }]);
});

test('the relay role holds a command, and releases it on its original MAC when it hears the tip again', () => {
  const r2 = new e.RelayRole({ self: 'r2', pairKey: KEYS.r2, replayWindowMs: WINDOW_MS });
  const cmd = outward('command', T0, 'c1');
  assert.deepEqual(r2.receive(cmd, T0 + 20, linkView(['tip'])), [{ action: 'queued', id: 'c1', next: 'tip', size: 1 }]);
  const actions = r2.receive(tipHeartbeat(T0 + 5_000), T0 + 5_010, linkView());
  assert.deepEqual(actions.map((a) => [a.action, a.to]), [['forward', 'tip'], ['forward', 'r1']], 'the held command first, then the heartbeat inward');
  const released = actions[0].env;
  assert.equal(released.hop, 3);
  assert.equal(released.mac, cmd.mac, 'never re-signed');
  assert.equal(e.verifyEnvelope(released, KEYS.tip), true);
  assert.deepEqual(e.decideForward(released, 'tip'), { action: 'deliver' });
  assert.equal(new e.ReplayWindow(WINDOW_MS).accept(released, T0 + 5_030), true, 'inside the tip\'s replay window on its original timestamp');
  assert.deepEqual(r2.pending(), []);
});

test('a command held past the replay window is dropped naming why, and what cannot be held is dropped too', () => {
  const r2 = new e.RelayRole({ self: 'r2', pairKey: KEYS.r2, replayWindowMs: WINDOW_MS });
  r2.receive(outward('command', T0, 'c2'), T0 + 20, linkView(['tip']));
  const actions = r2.receive(tipHeartbeat(T0 + 31_000), T0 + 31_000, linkView());
  assert.deepEqual(actions[0], { action: 'drop', id: 'c2', reason: 'held 31000 ms since it was signed, past the 30000 ms the destination\'s replay window allows: it would be refused as stale' });
  assert.deepEqual(actions.slice(1).map((a) => [a.action, a.to]), [['forward', 'r1']], 'the stale command never goes out to be refused');
  r2.receive(outward('command', T0, 'c3'), T0, linkView(['tip']));
  assert.equal(r2.expire(T0 + 30_000).length, 0);
  assert.equal(r2.expire(T0 + 30_500)[0].id, 'c3', 'the periodic tick drops it too');
  const heartbeatDown = r2.receive(tipHeartbeat(T0), T0, linkView(['r1']));
  assert.deepEqual(heartbeatDown, [{ action: 'drop', id: `hb-${T0}`, reason: 'next hop r1 is out of reach; a heartbeat is not held (the next one supersedes it)' }]);
  const wrongNode = new e.RelayRole({ self: 'r1', pairKey: 'k', replayWindowMs: WINDOW_MS }).receive(outward('command', T0, 'c4'), T0, linkView());
  assert.deepEqual(wrongNode, [{ action: 'drop', id: 'c4', reason: 'not addressed to r1 at hop 2' }]);
  const atSource = new e.RelayRole({ self: 'base', pairKey: 'k', replayWindowMs: WINDOW_MS }).receive(e.buildEnvelope({ kind: 'command', route: ['base', 'r1'], payload: {}, ts: T0, id: 'c5' }), T0, linkView(['r1']));
  assert.deepEqual(atSource, [{ action: 'drop', id: 'c5', reason: 'next hop r1 is out of reach of the source' }]);
  assert.throws(() => new e.RelayRole({ self: 'r2', pairKey: KEYS.r2, replayWindowMs: WINDOW_MS, holdMs: 40_000 }), /exceeds the 30000 ms replay window/);
});
