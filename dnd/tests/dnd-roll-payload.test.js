/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:54:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard bounded canonical combat-roll payloads and immutable narration handoffs.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove optional spoken dice preserve exact faces, modifiers, AC, totals, and outcomes.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ENG = require('../ui/engine');
const { combatDiceNarration } = require('../ui/table-dice');
const {
  MAX_ROLLS, normalizeRollPayload, turnResultRecord, turnResultTransition,
} = require('../lib/multiplayer-guard');

/** @description Build one real engine outcome for payload validation. */
function attackOutcome() {
  const actor = { id: 'bram', name: 'Bram', kind: 'pc' };
  const target = { id: 'goblin-1', name: 'Goblin', kind: 'monster', hp: 12, maxHp: 12, ac: 13 };
  const action = {
    name: 'Longsword', mode: 'attack', toHit: 5,
    damage: { dice: '1d8', bonus: 3, type: 'slashing' },
  };
  const world = { tokens: [actor, target], sheetFor: () => ({ mods: {} }) };
  ENG.setRng(() => 0.5);
  return ENG.resolveAction(world, actor, action, target);
}

/** @description Wrap engine rolls in the persisted versioned event contract. */
function payload(eventId) {
  return { v: 1, eventId: eventId || 'turn:camp-1:7:bram:action', rolls: attackOutcome().rolls };
}

/** @description Produce every non-attack roll kind through real engine paths. */
function otherEngineRolls() {
  ENG.setRng(() => 0.5);
  const wizard = { id: 'fenwick', name: 'Fenwick', kind: 'pc', x: 0, y: 0, slots: { '1': 9 } };
  const ally = { id: 'della', name: 'Della', kind: 'pc', x: 0, y: 1, hp: 2, maxHp: 12 };
  const foeA = { id: 'goblin-a', name: 'Goblin A', kind: 'monster', x: 1, y: 0, hp: 40, maxHp: 40, ac: 10 };
  const foeB = { id: 'goblin-b', name: 'Goblin B', kind: 'monster', x: 2, y: 1, hp: 40, maxHp: 40, ac: 10 };
  const world = { grid: { w: 5, h: 5 }, blockSet: new Set(), diffSet: new Set(),
    tokens: [wizard, ally, foeA, foeB], sheetFor: () => ({ mods: { dex: 1 } }) };
  const magic = ENG.resolveAction(world, wizard, {
    name: 'Magic Missile', type: 'spell', slot: 1, mode: 'autohit', darts: 3,
    damage: { dice: '1d4', bonus: 1, type: 'force' },
  }, foeA);
  const healing = ENG.resolveAction(world, wizard, {
    name: 'Healing Light', mode: 'heal', heal: { dice: '1d8', bonus: 2 },
  }, ally);
  const cone = ENG.resolveAction(world, wizard, {
    name: 'Burning Hands', mode: 'save', aoeShape: 'cone', aoeSize: 15,
    save: { ability: 'DEX', dc: 13, half: true }, damage: { dice: '2d6', bonus: 0, type: 'fire' },
  }, { x: 3, y: 0 });
  const rogue = { id: 'pip', name: 'Pip', kind: 'pc', x: 1, y: 1 };
  ally.x = 1; ally.y = 2;
  world.tokens.push(rogue);
  const sneak = ENG.resolveAction(world, rogue, {
    name: 'Dagger', mode: 'attack', toHit: 5, damage: { dice: '1d4', bonus: 3, type: 'piercing' }, sneak: '1d6',
  }, foeB);
  const downed = { id: 'bram', name: 'Bram', kind: 'pc', hp: 0, downed: true, stable: false, dead: false, deathSaves: { successes: 0, failures: 0 } };
  const death = ENG.resolveDeathSave(downed, 9, 12);
  const initiative = ENG.rollInitiativeDetailed([wizard, ally, foeA]);
  return magic.rolls.concat(healing.rolls, cone.rolls, sneak.rolls, death.rolls, initiative.rolls);
}

/** @description Build one durable turn result carrying a roll event. */
function result(rollEvent, complete, leaseAt) {
  return {
    serial: 7, text: 'Bram attacks.', lease: 'presenter-a',
    leaseAt: leaseAt || 100, complete: !!complete, rollEvent,
  };
}

test('a real engine outcome round-trips through the v1 payload contract', () => {
  const input = payload();
  const normalized = normalizeRollPayload(input);
  assert.deepEqual(normalized, input);
  assert.notEqual(normalized, input);
  assert.notEqual(normalized.rolls, input.rolls);
  assert.deepEqual(normalized.rolls.map((roll) => roll.kind), ['attack', 'damage']);
  assert.equal(normalized.rolls[0].faces[0], 11);
});

test('all engine roll kinds satisfy the same persisted event schema', () => {
  const rolls = otherEngineRolls();
  const normalized = normalizeRollPayload({ v: 1, eventId: 'combat:all-engine-kinds', rolls });
  assert.ok(normalized);
  assert.deepEqual(new Set(normalized.rolls.map((roll) => roll.kind)), new Set([
    'initiative', 'attack', 'save', 'damage', 'healing', 'autohit', 'sneak', 'death-save',
  ]));
});

test('payload validation rejects arithmetic changes, unknown fields, and oversized groups', () => {
  const changedTotal = payload();
  changedTotal.rolls[0].total++;
  assert.equal(normalizeRollPayload(changedTotal), null);
  const unknown = payload();
  unknown.secret = 'not archived';
  assert.equal(normalizeRollPayload(unknown), null);
  const tooMany = payload();
  tooMany.rolls = Array.from({ length: MAX_ROLLS + 1 }, () => payload().rolls[0]);
  assert.equal(normalizeRollPayload(tooMany), null);
});

test('turn-result leases retain the exact roll event through narration completion', () => {
  const event = payload(), pending = result(event, false, 100);
  const complete = result(JSON.parse(JSON.stringify(event)), true, 120);
  assert.ok(turnResultRecord(pending, 7));
  assert.ok(turnResultTransition(pending, complete, 7));
  const rewritten = result(payload('turn:camp-1:7:bram:rerolled'), true, 120);
  assert.equal(turnResultTransition(pending, rewritten, 7), false);
  const invalid = result({ ...event, rolls: [{ ...event.rolls[0], total: 999 }] }, false, 100);
  assert.equal(turnResultRecord(invalid, 7), null);
});

test('spoken dice describe the exact saved roll and defense target', () => {
  const words = combatDiceNarration(payload());
  assert.match(words, /Bram rolls a d 20 for Longsword against Goblin's AC 13\./);
  assert.match(words, /11 plus 5 is 16: hit\./);
  assert.match(words, /Damage rolls a d 8\./);
  assert.match(words, /5 plus 3 is 8: damage\./);
  assert.equal(combatDiceNarration({ v: 1, eventId: 'bad', rolls: [{ total: 99 }] }), '');
});
