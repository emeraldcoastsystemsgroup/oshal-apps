/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 18:45:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard canonical multiplayer death saves, turn eligibility, natural-20 continuation, healing recovery, and irreversible legacy death.
 * 2026-07-22 00:33:17 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep post-revival attacks and healing fixtures on the authoritative position-and-exact-roll action path.
 */

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ENG = require('../ui/engine.js');
const {
  canTakeTurn, nextTurn, pcLifeStateValid, stateWriteDecision,
} = require('../lib/multiplayer-guard.js');

const clone = (value) => JSON.parse(JSON.stringify(value));
const seat = [{ user_sub: 'alice', character_slug: 'bram' }];
const campaign = { is_owner: false, user_sub: 'host' };

/** @description Build one exact single-target action roll event. */
function actionRoll(actor, target, actionName, kind, faces, bonus) {
  const total = faces.reduce((sum, face) => sum + face, bonus);
  const effect = {
    kind, actorId: actor.id, actorName: actor.name, targetId: target.id,
    targetName: target.name, actionName, dice: `${faces.length}d${kind === 'healing' ? 8 : 8}`,
    faces, bonus, total, targetKind: null, target: null,
    outcome: kind === 'healing' ? 'healed' : 'damage', ordinal: 1, count: 1,
  };
  if (kind === 'healing') return { v: 1, eventId: `test:heal:${actor.id}:7`, rolls: [effect] };
  const attack = {
    kind: 'attack', actorId: actor.id, actorName: actor.name, targetId: target.id,
    targetName: target.name, actionName, dice: '1d20', faces: [14], bonus: 0,
    total: 14, targetKind: 'ac', target: target.ac, outcome: 'hit', ordinal: 1, count: 1,
  };
  return { v: 1, eventId: `test:attack:${actor.id}:7`, rolls: [attack, effect] };
}

/** @description A compact claimed-PC death-save turn with two later actors. */
function deathBoard() {
  return {
    adventureId: 'goblin-ambush', sceneId: 'coast-road', mode: 'combat',
    round: 2, turnIndex: 0, turnSerial: 7, order: ['bram', 'pip', 'goblin'],
    tokens: [
      {
        id: 'bram', slug: 'bram', kind: 'pc', name: 'Bram', x: 1, y: 1,
        hp: 0, maxHp: 12, ac: 16, speed: 30, slots: {},
        downed: true, stable: false, dead: false,
        deathSaves: { successes: 0, failures: 0 },
        turnSerial: 7, moveRemaining: 30, moved: false, acted: false,
      },
      { id: 'pip', slug: 'pip', kind: 'pc', name: 'Pip', x: 4, y: 1, hp: 9, maxHp: 9, ac: 14, speed: 30, slots: {} },
      { id: 'goblin', ref: 'goblin', kind: 'monster', name: 'Goblin', x: 6, y: 1, hp: 7, maxHp: 7, ac: 13, speed: 30 },
    ],
  };
}

/** @description Terrain/sheet rules used by structural guard assertions. */
function rules(extraSheets) {
  return {
    scene: { grid: { w: 18, h: 12, unitFeet: 5 }, terrain: { blocking: [], difficult: [] } },
    sheets: {
      bram: { name: 'Bram', speed: 30, maxHp: 12, actions: [{ id: 'sword', name: 'Sword', mode: 'attack', delivery: 'melee', reach: 5, toHit: 0, damage: { dice: '1d8', bonus: 3 } }] },
      pip: { name: 'Pip', speed: 30, maxHp: 9, actions: [] },
      ...(extraSheets || {}),
    },
    monsters: { goblin: { actions: [] } },
  };
}

/** @description Apply the canonical result for one selected natural d20. */
function saveOutcome(current, natural) {
  const proposed = clone(current), hero = proposed.tokens[0], old = current.tokens[0].deathSaves;
  const engineState = clone(current), engineResult = ENG.resolveDeathSave(engineState.tokens[0], current.turnSerial, natural);
  let successes = old.successes, failures = old.failures;
  if (natural === 20) {
    hero.hp = 1; hero.downed = false; hero.stable = false; hero.dead = false;
    hero.deathSaves = { successes: 0, failures: 0, lastRoll: 20, turnSerial: current.turnSerial };
    hero.turnResult = { serial: current.turnSerial, text: engineResult.text, lease: 'test-tab', leaseAt: 1, complete: false };
    return proposed;
  }
  if (natural === 1) failures = Math.min(3, failures + 2);
  else if (natural < 10) failures = Math.min(3, failures + 1);
  else successes = Math.min(3, successes + 1);
  hero.deathSaves = { successes, failures, lastRoll: natural, turnSerial: current.turnSerial };
  hero.dead = failures === 3;
  hero.stable = !hero.dead && successes === 3;
  hero.downed = !hero.dead;
  hero.turnResult = { serial: current.turnSerial, text: engineResult.text, lease: 'test-tab', leaseAt: 1, complete: false };
  return proposed;
}

/** @description Mark the immutable death-save story as durably narrated. */
function narrated(current) {
  const proposed = clone(current), result = proposed.tokens[0].turnResult;
  result.complete = true; result.leaseAt += 1;
  return proposed;
}

/** @description Advance to Pip without requiring a remote client's turn init. */
function advanceToPip(current) {
  const proposed = clone(current);
  proposed.turnIndex = 1;
  proposed.turnSerial = Number(current.turnSerial) + 1;
  return proposed;
}

test('initiative skips stable, final-dead, and fled tokens but includes unstable downed PCs', () => {
  const state = deathBoard();
  state.order = ['goblin', 'stable', 'legacy', 'fled', 'unstable', 'pip'];
  state.turnIndex = 0;
  state.tokens.push(
    { id: 'stable', kind: 'pc', hp: 0, downed: true, stable: true, dead: false, deathSaves: { successes: 3, failures: 1, lastRoll: 14, turnSerial: 5 } },
    { id: 'legacy', kind: 'pc', hp: 0, dead: true },
    { id: 'fled', kind: 'monster', hp: 7, dead: false, fled: true },
    { id: 'unstable', kind: 'pc', hp: 0, downed: true, stable: false, dead: false, deathSaves: { successes: 1, failures: 1 } },
  );

  assert.equal(canTakeTurn(state.tokens.find((token) => token.id === 'stable')), false);
  assert.equal(canTakeTurn(state.tokens.find((token) => token.id === 'legacy')), false);
  assert.equal(canTakeTurn(state.tokens.find((token) => token.id === 'fled')), false);
  assert.equal(canTakeTurn(state.tokens.find((token) => token.id === 'unstable')), true);
  assert.deepEqual(nextTurn(state, state.tokens), { index: 4, round: 2, serial: 8 });
});

test('claimed downed PC may persist one exact ordinary death-save outcome then only advance', () => {
  const current = deathBoard();
  const outcome = saveOutcome(current, 12);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', current, outcome, rules()).ok, true);
  assert.deepEqual(outcome.tokens[0].deathSaves, { successes: 1, failures: 0, lastRoll: 12, turnSerial: 7 });

  const premature = advanceToPip(outcome);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', outcome, premature, rules()).code, 'STATE_FORBIDDEN');
  const told = narrated(outcome);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', outcome, told, rules()).ok, true);
  const advance = advanceToPip(told);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', told, advance, rules()).ok, true);

  const reroll = saveOutcome(current, 8);
  reroll.tokens[0].deathSaves = { successes: 1, failures: 1, lastRoll: 8, turnSerial: 7 };
  assert.equal(stateWriteDecision(campaign, seat, 'alice', outcome, reroll, rules()).code, 'STATE_FORBIDDEN');
  assert.equal(stateWriteDecision(campaign, seat, 'alice', current, advanceToPip(current), rules()).code, 'STATE_FORBIDDEN');
});

test('guard accepts every exact d20 outcome emitted by the shared engine', () => {
  for (let natural = 1; natural <= 20; natural++) {
    const current = deathBoard(), proposed = clone(current);
    const result = ENG.resolveDeathSave(proposed.tokens[0], current.turnSerial, natural);
    assert.equal(result.blocked, false);
    proposed.tokens[0].turnResult = { serial: current.turnSerial, text: result.text, lease: 'test-tab', leaseAt: 1, complete: false };
    assert.equal(stateWriteDecision(campaign, seat, 'alice', current, proposed, rules()).ok, true, `natural ${natural}`);
  }
});

test('terminal save outcomes derive stable and dead state exactly and may coalesce with advancement', () => {
  let current = deathBoard();
  current.tokens[0].deathSaves = { successes: 2, failures: 1, lastRoll: 4, turnSerial: 4 };
  let outcome = saveOutcome(current, 10);
  assert.equal(outcome.tokens[0].stable, true);
  assert.equal(outcome.tokens[0].downed, true);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', current, outcome, rules()).ok, true);
  let told = narrated(outcome);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', outcome, told, rules()).ok, true);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', told, advanceToPip(told), rules()).ok, true);

  current = deathBoard();
  current.tokens[0].deathSaves = { successes: 1, failures: 2, lastRoll: 15, turnSerial: 4 };
  outcome = saveOutcome(current, 1);
  told = narrated(outcome);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', current, outcome, rules()).ok, true);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', outcome, told, rules()).ok, true);
  const atomic = advanceToPip(told);
  assert.equal(outcome.tokens[0].dead, true);
  assert.equal(outcome.tokens[0].downed, false);
  assert.equal(outcome.tokens[0].deathSaves.failures, 3);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', told, atomic, rules()).ok, true);
});

test('a terminal save may resolve defeat only when no conscious or unstable hero remains', () => {
  const current = deathBoard();
  current.tokens[0].deathSaves = { successes: 2, failures: 0, lastRoll: 16, turnSerial: 4 };
  Object.assign(current.tokens[1], {
    hp: 0, downed: true, stable: true, dead: false,
    deathSaves: { successes: 3, failures: 1, lastRoll: 11, turnSerial: 6 },
  });
  const stable = saveOutcome(current, 14);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', current, stable, rules()).ok, true);
  const told = narrated(stable);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', stable, told, rules()).ok, true);
  const defeat = clone(told); defeat.mode = 'defeat';
  assert.equal(stateWriteDecision(campaign, seat, 'alice', told, defeat, rules()).ok, true);

  const stillFighting = deathBoard();
  stillFighting.tokens[0].deathSaves = { successes: 2, failures: 0, lastRoll: 16, turnSerial: 4 };
  const notDefeat = saveOutcome(stillFighting, 14); notDefeat.mode = 'defeat';
  assert.equal(stateWriteDecision(campaign, seat, 'alice', stillFighting, notDefeat, rules()).code, 'STATE_FORBIDDEN');
});

test('fresh death-save turns may clear only the actor stale result marker', () => {
  const current = deathBoard();
  current.tokens[0].turnSerial = 6;
  current.tokens[0].acted = true;
  current.tokens[0].turnResult = { serial: 6, text: 'The prior turn finished.', lease: 'old-tab', leaseAt: 1, complete: true };
  const proposed = saveOutcome(current, 12);
  proposed.tokens[0].turnSerial = 7;
  proposed.tokens[0].acted = false;
  assert.equal(stateWriteDecision(campaign, seat, 'alice', current, proposed, rules()).ok, true);

  const told = narrated(proposed);
  const forgedNext = advanceToPip(told);
  forgedNext.tokens[1].turnResult = { serial: 99, text: 'Forged result.', lease: 'bad-tab', leaseAt: 1, complete: true };
  assert.equal(stateWriteDecision(campaign, seat, 'alice', told, forgedNext, rules()).code, 'STATE_FORBIDDEN');
});

test('forged death-save counters, status, movement, and unrelated damage are rejected', () => {
  const current = deathBoard();
  const forged = [];

  let proposed = saveOutcome(current, 12);
  proposed.tokens[0].deathSaves.successes = 2;
  forged.push(proposed);

  proposed = saveOutcome(current, 1);
  proposed.tokens[0].deathSaves.failures = 1;
  forged.push(proposed);

  proposed = saveOutcome(current, 8);
  proposed.tokens[0].stable = true;
  forged.push(proposed);

  proposed = saveOutcome(current, 15);
  proposed.tokens[0].x = 2;
  proposed.tokens[0].moveRemaining = 25;
  proposed.tokens[0].moved = true;
  forged.push(proposed);

  proposed = saveOutcome(current, 15);
  proposed.tokens[2].hp = 1;
  forged.push(proposed);

  for (const state of forged) {
    assert.equal(stateWriteDecision(campaign, seat, 'alice', current, state, rules()).code, 'STATE_FORBIDDEN');
  }
});

test('natural 20 revives to 1 HP once and then preserves normal claimed movement validation', () => {
  const current = deathBoard();
  const revived = saveOutcome(current, 20);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', current, revived, rules()).ok, true);
  assert.equal(pcLifeStateValid(revived.tokens[0]), true);
  const revivedTold = narrated(revived);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', revived, revivedTold, rules()).ok, true);

  const moved = clone(revivedTold), hero = moved.tokens[0];
  hero.y = 2; hero.moveRemaining = 25; hero.moved = true;
  assert.equal(stateWriteDecision(campaign, seat, 'alice', revivedTold, moved, rules()).ok, true);

  const adjacent = clone(revivedTold); adjacent.tokens[2].x = 2; adjacent.tokens[0].positionSet = true;
  const attacked = clone(adjacent);
  attacked.tokens[0].acted = true; attacked.tokens[0].turnResult = {
    serial: 7, text: 'Bram hits the goblin.', lease: 'test-tab', leaseAt: 1,
    complete: false, rollEvent: actionRoll(attacked.tokens[0], attacked.tokens[2], 'Sword', 'damage', [1], 3),
  }; attacked.tokens[2].hp = 3;
  assert.equal(stateWriteDecision(campaign, seat, 'alice', adjacent, attacked, rules()).ok, true);

  const secondSave = clone(revivedTold);
  Object.assign(secondSave.tokens[0], {
    hp: 0, downed: true, stable: false, dead: false,
    deathSaves: { successes: 1, failures: 0, lastRoll: 13, turnSerial: 7 },
  });
  assert.equal(stateWriteDecision(campaign, seat, 'alice', revivedTold, secondSave, rules()).code, 'STATE_FORBIDDEN');
});

test('legal healing clears downed state and save history, while legacy dead PCs remain final', () => {
  const current = deathBoard();
  const della = {
    id: 'della', slug: 'della', kind: 'pc', name: 'Della', x: 1, y: 2,
    hp: 10, maxHp: 10, ac: 18, speed: 30, slots: { '1': 1 },
    turnSerial: 7, moveRemaining: 30, moved: false, positionSet: true, acted: false,
  };
  current.tokens.unshift(della);
  current.order = ['della', 'bram', 'pip', 'goblin'];
  current.turnIndex = 0;
  current.tokens[1].stable = true;
  current.tokens[1].deathSaves = { successes: 3, failures: 0, lastRoll: 14, turnSerial: 6 };
  const healRules = rules({ della: { name: 'Della', speed: 30, maxHp: 10, actions: [{
    id: 'cure', name: 'Cure Wounds', type: 'spell', slot: 1, mode: 'heal', delivery: 'touch', heal: { dice: '1d8', bonus: 3 },
  }] } });

  const healed = clone(current), healer = healed.tokens[0], target = healed.tokens[1];
  healer.acted = true; healer.turnResult = {
    serial: 7, text: 'Della restores Bram.', lease: 'test-tab', leaseAt: 1,
    complete: false, rollEvent: actionRoll(healer, target, 'Cure Wounds', 'healing', [2], 3),
  }; healer.slots['1'] = 0;
  target.hp = 5; target.downed = false; target.stable = false; delete target.deathSaves;
  assert.equal(stateWriteDecision({ is_owner: false }, [{ user_sub: 'alice', character_slug: 'della' }], 'alice', current, healed, healRules).ok, true);

  const legacy = clone(current);
  legacy.tokens[1] = { ...legacy.tokens[1], hp: 0, dead: true };
  delete legacy.tokens[1].downed; delete legacy.tokens[1].stable; delete legacy.tokens[1].deathSaves;
  const illegal = clone(legacy), illegalHealer = illegal.tokens[0], corpse = illegal.tokens[1];
  illegalHealer.acted = true; illegalHealer.slots['1'] = 0;
  corpse.hp = 5; corpse.dead = false;
  assert.equal(stateWriteDecision({ is_owner: false }, [{ user_sub: 'alice', character_slug: 'della' }], 'alice', legacy, illegal, healRules).code, 'STATE_FORBIDDEN');

  const legacyActive = deathBoard();
  legacyActive.tokens[0] = { ...legacyActive.tokens[0], hp: 0, dead: true };
  delete legacyActive.tokens[0].downed; delete legacyActive.tokens[0].stable; delete legacyActive.tokens[0].deathSaves;
  const skip = advanceToPip(legacyActive);
  assert.equal(stateWriteDecision(campaign, seat, 'alice', legacyActive, skip, rules()).ok, true);
});
