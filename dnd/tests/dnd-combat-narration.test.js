/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 22:19:02 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove cinematic combat prose preserves actors, targets, outcomes, and compass direction without reading exact rules math.
 * 2026-07-22 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove stationary position filler stays silent and repeated action cues rotate across turns.
 * 2026-07-23 00:16:04 | roger.murphy@emeraldcoastsystemsgroup.com  | Reproduce and prohibit metadata-like "commits to Scimitar, bearing down" narration.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

global.shortTokenLabel = (token) => String(token && token.name || '').split(/[\s,(]/)[0];
global.board = {
  tokens: [
    { id: 'archer', kind: 'monster', name: 'Goblin Archer', hp: 7, maxHp: 7 },
    { id: 'bram', kind: 'pc', name: 'Bram Ironhand', hp: 12, maxHp: 12 },
    { id: 'snaggletooth', kind: 'monster', name: 'Snaggletooth', hp: 21, maxHp: 21 },
  ],
};

const {
  combatActionCueNarration,
  combatAutomatedTurnNarration,
  combatMovementNarration,
  combatMovementShouldNarrate,
  combatOutcomeFallback,
} = require('../ui/table-combat-narration');

/** @description Build one exact structured result without coupling prose to math text. */
function outcome(roll, text) {
  return { text, rollEvent: { v: 1, eventId: 'turn-1', rolls: [roll] } };
}

test('a ranged miss becomes story while exact AC math stays out of speech', () => {
  const result = combatOutcomeFallback(global.board.tokens[0], outcome({
    kind: 'attack', actorId: 'archer', actorName: 'Goblin Archer',
    targetId: 'bram', targetName: 'Bram', actionName: 'Shortbow', outcome: 'miss',
  }, "Goblin Archer's Shortbow: 7+4=11 vs AC 18 — miss."));
  assert.match(result, /Archer|Goblin/i);
  assert.match(result, /Bram/);
  assert.match(result, /shot|fly|shaft|bow/i);
  assert.doesNotMatch(result, /\bAC\b|7\s*\+\s*4|11|18/);
});

test('movement narration follows the fixed screen compass', () => {
  const result = combatMovementNarration(global.board.tokens[2], {
    fromX: 8, fromY: 6, toX: 6, toY: 4, feet: 10,
  });
  assert.match(result, /north-west/);
  assert.doesNotMatch(result, /south|east/);
});

test('stationary position remains exact ledger data without repeated narration', () => {
  const movement = { fromX: 6, fromY: 4, toX: 6, toY: 4, feet: 0 };
  assert.equal(combatMovementShouldNarrate(movement), false);
  assert.equal(combatMovementNarration(global.board.tokens[2], movement), '');
});

test('action intent names the attack and target without defense jargon', () => {
  const result = combatActionCueNarration(global.board.tokens[0], global.board.tokens[1], { name: 'Shortbow' });
  assert.match(result, /Shortbow/);
  assert.match(result, /Bram/);
  assert.doesNotMatch(result, /\bAC\b|legal target|defense/i);
});

test('scimitar intent sounds spoken rather than like action metadata', () => {
  global.board.turnSerial = 5;
  const cook = { id: 'cook', kind: 'monster', name: 'Goblin Cook' };
  const result = combatActionCueNarration(cook, global.board.tokens[1], {
    name: 'Scimitar', mode: 'attack', delivery: 'melee',
  });
  assert.match(result, /Goblin/);
  assert.match(result, /Bram/);
  assert.match(result, /scimitar/);
  assert.doesNotMatch(result, /commits to|bearing down|with Scimitar|Scimitar already/i);
});

test('the same action receives fresh wording on a later turn', () => {
  global.board.turnSerial = 7;
  const first = combatActionCueNarration(global.board.tokens[0], global.board.tokens[1], { name: 'Shortbow' });
  global.board.turnSerial = 8;
  const second = combatActionCueNarration(global.board.tokens[0], global.board.tokens[1], { name: 'Shortbow' });
  assert.notEqual(first, second);
});

test('self-healing never attacks its own user', () => {
  const bram = global.board.tokens[1];
  const result = combatActionCueNarration(bram, bram, {
    name: 'Second Wind', mode: 'heal', delivery: 'self',
  });
  assert.match(result, /breath|strength|reaches inward/i);
  assert.doesNotMatch(result, /bearing down|attack|strike|toward Bram/i);
});

test('automated turn handoffs vary without claiming a companion just arrived', () => {
  global.board.turnSerial = 11;
  const first = combatAutomatedTurnNarration(global.board.tokens[1]);
  global.board.turnSerial = 12;
  const second = combatAutomatedTurnNarration(global.board.tokens[1]);
  assert.notEqual(first, second);
  assert.doesNotMatch(`${first} ${second}`, /steps into the fight|seizes the initiative/i);
});

test('a defeated target remains defeated in fallback narration', () => {
  const target = global.board.tokens[1], original = target.hp;
  target.hp = 0; target.dead = true;
  const result = combatOutcomeFallback(global.board.tokens[2], outcome({
    kind: 'attack', actorId: 'snaggletooth', actorName: 'Snaggletooth',
    targetId: 'bram', targetName: 'Bram', actionName: 'Javelin', outcome: 'hit',
  }, "Snaggletooth's Javelin hits Bram."));
  target.hp = original; delete target.dead;
  assert.match(result, /Bram.*(?:crumples|out of the fight)/i);
});
