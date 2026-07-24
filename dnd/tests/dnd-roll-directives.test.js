/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 20:04:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard forgiving but bounded Dungeon Master ROLL directive parsing, including actor hints and markdown wrappers.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDndRoutes } = require('../routes/dnd-routes.js');

createDndRoutes({});
const parse = createDndRoutes._parseDirectives;

test('ROLL parser accepts markdown, bare DC numbers, and trailing actor text', () => {
  const parsed = parse('The branches twitch.\n**ROLL: wisdom 10 - Fenwick notices the tracks.**');
  assert.deepEqual(parsed.roll, {
    ability: 'wisdom',
    dc: 10,
    actorHint: 'Fenwick notices the tracks.',
  });
  assert.equal(parsed.narration, 'The branches twitch.');
  assert.doesNotMatch(parsed.narration, /ROLL|Fenwick notices/i);
});

test('ROLL parser tolerates optional colon, pipe, and DC label case-insensitively', () => {
  assert.deepEqual(parse('A loose stone shifts.\nroll dexterity DC 14').roll, { ability: 'dexterity', dc: 14 });
  assert.deepEqual(parse('Listen closely.\n`RoLl: perception | dc: 12`').roll, null);
  assert.deepEqual(parse('Brace yourself.\n_ROLL constitution | DC 15_').roll, { ability: 'constitution', dc: 15 });
  assert.deepEqual(parse('Take aim.\nROLL attack 11: Bram fires through the fog.').roll, {
    ability: 'attack', dc: 11, actorHint: 'Bram fires through the fog.',
  });
});

test('forgiving ROLL formatting does not weaken ability or DC bounds', () => {
  assert.equal(parse('x\n**ROLL: luck 10 - wish hard**').roll, null);
  assert.equal(parse('x\nROLL wisdom DC 4 - too easy').roll, null);
  assert.equal(parse('x\nROLL wisdom 26 - too hard').roll, null);
});
