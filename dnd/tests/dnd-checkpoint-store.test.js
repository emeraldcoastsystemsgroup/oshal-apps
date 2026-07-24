/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 13:20:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Verify permanent round marks retain exact playable state while excluding regenerable media.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { _test } = require('../lib/dnd-checkpoint-store');

test('checkpoint state keeps gameplay facts and removes generated media recursively', () => {
  const source = {
    sceneId: 'bell-tower', round: 3, mode: 'combat',
    cutaway: { url: 'paid-image' },
    tokens: [{ id: 'bram', hp: 7, inventory: ['rope'], roundImage: 'temporary' }],
    story: { clue: 'charter', imageUrl: 'temporary' },
  };
  const saved = _test.checkpointState(source);
  assert.deepEqual(saved, {
    sceneId: 'bell-tower', round: 3, mode: 'combat',
    tokens: [{ id: 'bram', hp: 7, inventory: ['rope'] }],
    story: { clue: 'charter' },
  });
  assert.notEqual(saved, source);
});

test('round marks occur only when a persisted combat round begins', () => {
  const setup = { mode: 'setup', round: 0 };
  const roundOne = { mode: 'combat', round: 1 };
  const sameRound = { mode: 'combat', round: 1 };
  const roundTwo = { mode: 'combat', round: 2 };
  assert.equal(_test.crossedRoundBoundary(setup, roundOne), true);
  assert.equal(_test.crossedRoundBoundary(roundOne, sameRound), false);
  assert.equal(_test.crossedRoundBoundary(roundOne, roundTwo), true);
  assert.equal(_test.crossedRoundBoundary(roundTwo, { mode: 'resolved', round: 2 }), false);
});

test('round labels identify the authored scene and exact round', () => {
  const deps = { sceneById: () => ({ title: 'The Third Late Bell' }) };
  assert.match(
    _test.roundCheckpointLabel(deps, { sceneId: 'bell-tower', round: 4 }),
    /The Third Late Bell.*Round 4 start/,
  );
});
