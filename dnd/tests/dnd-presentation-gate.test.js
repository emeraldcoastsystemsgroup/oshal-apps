/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 22:06:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard host-owned opening and rewind presentation creation, completion, lease takeover, and immutability.
 * 2026-07-22 00:18:41 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove abandoned presentation ownership transfers after the shortened recovery lease.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { stateWriteDecision } = require('../lib/multiplayer-guard');
const { LEASE_STALE_MS, presentationGateDecision, presentationGateRecord } = require('../lib/dnd-presentation-gate');

const owner = { user_sub: 'host', is_owner: true };
const clone = (value) => JSON.parse(JSON.stringify(value));

/** @description Build a compact board carrying no transient renderer state. */
function board(mode) {
  return { mode: mode || 'setup', sceneId: 'coast-road', turnSerial: 1, round: 1, tokens: [] };
}

/** @description Build one exact durable gate for the supplied board. */
function gate(forBoard, kind, complete, lease) {
  const value = {
    id: `${kind}:camp-1:coast-road:1`, kind, sceneId: forBoard.sceneId,
    turnSerial: Number(forBoard.turnSerial) || 0, message: `${kind} narration`,
    createdAt: 100, complete: !!complete, lease: lease || 'presenter-a', leaseAt: 100,
  };
  if (complete) value.completedAt = 150;
  return value;
}

test('setup requires one valid pending opening gate before combat', () => {
  const current = board('setup'), proposed = board('combat');
  assert.equal(stateWriteDecision(owner, [], 'host', current, proposed, {}).ok, false);
  proposed.presentationGate = gate(proposed, 'opening', false);
  assert.equal(stateWriteDecision(owner, [], 'host', current, proposed, {}).ok, true);
  assert.equal(stateWriteDecision({ user_sub: 'host' }, [], 'guest', current, proposed, {}).ok, false);
});

test('a pending gate blocks board changes and accepts only exact host completion', () => {
  const current = board('combat'); current.presentationGate = gate(current, 'opening', false);
  const changed = clone(current); changed.round = 2;
  assert.equal(presentationGateDecision(current, changed, true, 200).ok, false);
  const spectator = clone(current);
  assert.equal(presentationGateDecision(current, spectator, false, 200).ok, false);
  const completed = clone(current);
  completed.presentationGate.complete = true;
  completed.presentationGate.completedAt = 150;
  assert.equal(presentationGateDecision(current, completed, true, 200).ok, true);
  assert.ok(presentationGateRecord(completed.presentationGate, completed));
});

test('presenter leases refresh in place and transfer only after expiry', () => {
  const current = board('combat'); current.presentationGate = gate(current, 'opening', false);
  const refresh = clone(current); refresh.presentationGate.leaseAt = 1000;
  assert.equal(presentationGateDecision(current, refresh, true, 1000).ok, true);
  const early = clone(current); early.presentationGate.lease = 'presenter-b'; early.presentationGate.leaseAt = 1000;
  assert.equal(presentationGateDecision(current, early, true, 1000).ok, false);
  const takeoverAt = LEASE_STALE_MS + 101;
  const takeover = clone(current); takeover.presentationGate.lease = 'presenter-b'; takeover.presentationGate.leaseAt = takeoverAt;
  assert.equal(presentationGateDecision(current, takeover, true, takeoverAt).ok, true);
});

test('completed gates are immutable except rewind-to-opening replacement', () => {
  const combat = board('combat'); combat.presentationGate = gate(combat, 'opening', true);
  assert.equal(presentationGateDecision(combat, clone(combat), true, 200), null);
  const removed = clone(combat); delete removed.presentationGate;
  assert.equal(presentationGateDecision(combat, removed, true, 200).ok, false);
  const setup = board('setup'); setup.presentationGate = gate(setup, 'rewind', true);
  const restarted = board('combat'); restarted.presentationGate = gate(restarted, 'opening', false);
  assert.equal(stateWriteDecision(owner, [], 'host', setup, restarted, {}).ok, true);
});
