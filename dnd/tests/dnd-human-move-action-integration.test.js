/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 01:48:40 | roger.murphy@emeraldcoastsystemsgroup.com  | Execute the shipped canvas movement handler, authorize its saved board, then authorize an engine-authored human action from that position.
 * 2026-07-23 00:49:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Authorize action-first play and a second movement write after that action's result completes.
 * 2026-07-23 11:21:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Authorize remaining movement while the saved action narration is still playing.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ENG = require('../ui/engine.js');
const { _test } = require('../routes/dnd-routes.js');

const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'table-runtime.js'), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));

/** @description Build the exact small combat board used across both client writes. */
function combatBoard() {
  return {
    adventureId: 'goblin-ambush', sceneId: 'coast-road', mode: 'combat', round: 1,
    turnIndex: 0, turnSerial: 1, order: ['bram', 'goblin-1'],
    tokens: [
      { id: 'bram', slug: 'bram', kind: 'pc', name: 'Bram', x: 1, y: 1,
        hp: 12, maxHp: 12, ac: 16, speed: 30, slots: {}, turnSerial: 1,
        moveRemaining: 30, moved: false, positionSet: false, acted: false },
      { id: 'goblin-1', ref: 'goblin', kind: 'monster', name: 'Goblin', x: 2,
        y: 1, hp: 7, maxHp: 7, ac: 13, speed: 30 },
    ],
  };
}

/** @description Build shared rules for browser resolution and server authorization. */
function rulesFor(sheet) {
  return {
    scene: { grid: { w: 18, h: 12, unitFeet: 5 }, terrain: { blocking: [], difficult: [] } },
    sheets: { bram: sheet }, monsters: {},
  };
}

/** @description Execute the production canvas handler and return its persisted state. */
function executeBrowserMove(state) {
  const moved = clone(state), selected = moved.tokens[0]; let persisted = null;
  const sandbox = {
    selected, reachable: new Set(['1,2']), movementCosts: new Map([['1,2', 1]]),
    keyOf: (x, y) => `${x},${y}`, unitFeet: () => 5,
    movementLeft: (token) => token.moveRemaining, computeReachable() {},
    shortTokenLabel: (token) => token.name, persist: () => { persisted = clone(moved); },
    renderDock() {}, banner() {}, Math,
  };
  const start = runtimeSource.indexOf('function handleMovementTarget(point)');
  const end = runtimeSource.indexOf('\nfunction onBoardPointerDown(event)', start);
  assert.ok(start >= 0 && end > start, 'The production movement handler must remain executable.');
  vm.runInNewContext(`${runtimeSource.slice(start, end)}; handleMovementTarget({ x: 1, y: 2 });`, sandbox);
  assert.ok(persisted, 'A legal canvas movement must persist.');
  return persisted;
}

/** @description Resolve a real deterministic attack and build the pending client write. */
function executeBrowserAction(state, sheet) {
  const acted = clone(state), actor = acted.tokens[0], target = acted.tokens[1];
  const world = {
    grid: rulesFor(sheet).scene.grid, blockSet: new Set(), diffSet: new Set(),
    tokens: acted.tokens, sheetFor: (token) => token.id === actor.id ? sheet : {},
  };
  let result;
  try { ENG.setRng(() => 0); result = ENG.resolveAction(world, actor, sheet.actions[0], target); }
  finally { ENG.setRng(); }
  assert.equal(result.blocked, false); assert.equal(result.rolls[0].outcome, 'miss');
  actor.positionSet = true;
  actor.acted = true;
  actor.turnResult = {
    serial: acted.turnSerial, text: result.text, lease: 'browser-tab', leaseAt: 1,
    complete: false, rollEvent: { v: 1, eventId: 'test:browser-move-action:1', rolls: result.rolls },
  };
  return acted;
}

test('real browser Move enables a server-authorized action from the persisted position', () => {
  const sheet = {
    name: 'Bram', speed: 30, maxHp: 12,
    actions: [{ id: 'longsword', name: 'Longsword', type: 'weapon', mode: 'attack',
      delivery: 'melee', reach: 5, toHit: 5,
      damage: { dice: '1d8', bonus: 3, type: 'slashing' } }],
  };
  const campaign = { is_owner: false };
  const seats = [{ user_sub: 'player-bram', character_slug: 'bram' }];
  const initial = combatBoard(), moved = executeBrowserMove(initial);
  assert.deepEqual({ x: moved.tokens[0].x, y: moved.tokens[0].y,
    moved: moved.tokens[0].moved, positionSet: moved.tokens[0].positionSet,
    moveRemaining: moved.tokens[0].moveRemaining },
  { x: 1, y: 2, moved: true, positionSet: true, moveRemaining: 25 });
  const movementDecision = _test.stateWriteDecision(
    campaign, seats, 'player-bram', initial, moved, rulesFor(sheet));
  assert.equal(movementDecision.ok, true, movementDecision.error);
  const acted = executeBrowserAction(moved, sheet);
  const actionDecision = _test.stateWriteDecision(
    campaign, seats, 'player-bram', moved, acted, rulesFor(sheet));
  assert.equal(actionDecision.ok, true, actionDecision.error);
  assert.equal(acted.tokens[0].positionSet, true);
  assert.equal(acted.tokens[0].turnResult.rollEvent.rolls[0].outcome, 'miss');
});

test('a hero may act first and spend remaining movement while narration plays', () => {
  const sheet = {
    name: 'Bram', speed: 30, maxHp: 12,
    actions: [{ id: 'longsword', name: 'Longsword', type: 'weapon', mode: 'attack',
      delivery: 'melee', reach: 5, toHit: 5,
      damage: { dice: '1d8', bonus: 3, type: 'slashing' } }],
  };
  const campaign = { is_owner: false };
  const seats = [{ user_sub: 'player-bram', character_slug: 'bram' }];
  const initial = combatBoard();
  const acted = executeBrowserAction(initial, sheet);
  const actionDecision = _test.stateWriteDecision(
    campaign, seats, 'player-bram', initial, acted, rulesFor(sheet));
  assert.equal(actionDecision.ok, true, actionDecision.error);
  assert.equal(acted.tokens[0].moveRemaining, 30);

  const movedAfterAction = executeBrowserMove(acted);
  const movementDecision = _test.stateWriteDecision(
    campaign, seats, 'player-bram', acted, movedAfterAction, rulesFor(sheet));
  assert.equal(movementDecision.ok, true, movementDecision.error);
  assert.deepEqual({
    acted: movedAfterAction.tokens[0].acted,
    moveRemaining: movedAfterAction.tokens[0].moveRemaining,
    x: movedAfterAction.tokens[0].x, y: movedAfterAction.tokens[0].y,
  }, { acted: true, moveRemaining: 25, x: 1, y: 2 });

  const completed = clone(movedAfterAction);
  completed.tokens[0].turnResult.complete = true;
  const narrationDecision = _test.stateWriteDecision(
    campaign, seats, 'player-bram', movedAfterAction, completed, rulesFor(sheet));
  assert.equal(narrationDecision.ok, true, narrationDecision.error);
});
