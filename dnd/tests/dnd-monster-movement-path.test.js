/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 01:59:22 | roger.murphy@emeraldcoastsystemsgroup.com  | Reproduce Archer-to-Pip turn 4 through coast-road brush and prove the shipped monster mover persists the Dijkstra cost accepted by the unchanged server guard.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ENG = require('../ui/engine.js');
const { _test } = require('../routes/dnd-routes.js');

const automationSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'table-automation.js'), 'utf8');
const adventure = require('../data/adventure-goblin-ambush.json');
const scene = adventure.scenes.find((candidate) => candidate.id === 'coast-road');
const clone = (value) => JSON.parse(JSON.stringify(value));
const goblinSheet = {
  actions: [{ id: 'scimitar', name: 'Scimitar', delivery: 'melee', mode: 'attack',
    type: 'weapon', reach: 5, toHit: 4, damage: { dice: '1d6', bonus: 2, type: 'slashing' } }],
};

/** @description Build the exact authoritative positions observed at stuck turn 4. */
function stuckBoard() {
  return {
    adventureId: 'goblin-ambush', sceneId: 'coast-road', mode: 'combat', round: 1,
    turnIndex: 3, turnSerial: 4,
    order: ['bram', 'fenwick', 'pip', 'g1', 'g2', 'g3', 'boss', 'della'],
    tokens: [
      { id: 'bram', slug: 'bram', kind: 'pc', name: 'Bram', x: 0, y: 1, hp: 12, maxHp: 12, ac: 16, speed: 30 },
      { id: 'della', slug: 'della', kind: 'pc', name: 'Della', x: 4, y: 6, hp: 12, maxHp: 12, ac: 18, speed: 25 },
      { id: 'fenwick', slug: 'fenwick', kind: 'pc', name: 'Fenwick', x: 3, y: 6, hp: 7, maxHp: 7, ac: 12, speed: 30 },
      { id: 'pip', slug: 'pip', kind: 'pc', name: 'Pip', x: 5, y: 7, hp: 10, maxHp: 10, ac: 15, speed: 25 },
      { id: 'g1', ref: 'goblin', kind: 'monster', name: 'Goblin (archer)', x: 13, y: 3, hp: 7, maxHp: 7, ac: 15, speed: 30 },
      { id: 'g2', ref: 'goblin', kind: 'monster', name: 'Goblin (skirmisher)', x: 14, y: 7, hp: 7, maxHp: 7, ac: 15, speed: 30 },
      { id: 'g3', ref: 'goblin', kind: 'monster', name: 'Goblin (cutter)', x: 12, y: 8, hp: 1, maxHp: 7, ac: 15, speed: 30 },
      { id: 'boss', ref: 'goblin-boss', kind: 'monster', name: 'Snaggletooth', x: 15, y: 5, hp: 21, maxHp: 21, ac: 17, speed: 30 },
    ],
  };
}

/** @description Build the same terrain-aware world consumed by client and guard. */
function worldFor(board) {
  const points = (rows) => new Set((rows || []).map((point) => `${point.x},${point.y}`));
  return {
    grid: scene.grid, blockSet: points(scene.terrain.blocking),
    diffSet: points(scene.terrain.difficult), tokens: board.tokens,
    sheetFor: (token) => token.ref === 'goblin' ? goblinSheet : {},
  };
}

/** @description Extract one shipped classic-script function without reimplementing it. */
function sourceBetween(startName, endName) {
  let start = automationSource.indexOf(`function ${startName}`);
  let end = automationSource.indexOf(`function ${endName}`, start + 1);
  if (automationSource.slice(start - 6, start) === 'async ') start -= 6;
  if (automationSource.slice(end - 6, end) === 'async ') end -= 6;
  assert.ok(start >= 0 && end > start, `${startName} must remain in the browser bundle.`);
  return automationSource.slice(start, end);
}

/** @description Run the production monster movement phase against the observed board. */
async function runProductionMove(current) {
  const proposed = clone(current), monster = proposed.tokens.find((token) => token.id === 'g1');
  const target = proposed.tokens.find((token) => token.id === 'pip');
  Object.assign(monster, { turnSerial: 4, moveRemaining: 30, moved: false, positionSet: false, acted: false });
  let persisted = null, finishCalls = 0;
  const sandbox = {
    board: proposed, ENG, automationClientId: 'host-tab', automationPhase: null,
    W: () => worldFor(proposed), cheb: ENG.cheb, unitFeet: () => 5,
    movementLeft: (actor) => Number.isFinite(Number(actor.moveRemaining)) ? Number(actor.moveRemaining) : actor.speed,
    shortTokenLabel: (actor) => actor.name.replace(/^Goblin \(|\)$/g, ''),
    persist: () => { persisted = clone(proposed); }, renderDock() {},
    flushPendingState: async () => true, automationActor: () => monster,
    finishAutomatedMovement: async () => { finishCalls++; }, Date, Math, JSON,
  };
  const definitions = [
    sourceBetween('moveAutomatedToward(actor, objective)', 'automatedTurnCurrent'),
    sourceBetween('gridDirection(dx, dy)', 'automatedFailure'),
    sourceBetween('makeMovementResult(run, text, before, actor, feet)', 'automatedPositionComplete'),
    sourceBetween('moveMonsterForTurn(run, monster, target)', 'monsterCueForTurn'),
  ].join('\n');
  vm.runInNewContext(`${definitions}\nglobalThis.moveMonsterForTurn = moveMonsterForTurn;`, sandbox);
  await sandbox.moveMonsterForTurn({ serial: 4 }, monster, target);
  return { persisted, finishCalls };
}

/** @description Recreate the rejected displacement-only proposal from the live loop. */
function legacyProposal(current) {
  const proposed = clone(current), actor = proposed.tokens.find((token) => token.id === 'g1');
  Object.assign(actor, { x: 8, y: 8, turnSerial: 4, moveRemaining: 5,
    moved: true, positionSet: true, acted: false });
  actor.movementResult = {
    serial: 4, text: 'Archer moves 25 ft south-west toward Pip · position set.',
    fromX: 13, fromY: 3, toX: 8, toY: 8, feet: 25,
    lease: 'host-tab', leaseAt: 1, complete: false,
  };
  return proposed;
}

test('Archer turn 4 uses terrain cost once and leaves the retry loop', async () => {
  const current = stuckBoard(), owner = { is_owner: true };
  const rules = { scene, sheets: {}, monsters: { goblin: goblinSheet } };
  const costs = ENG.computeMovementCosts(worldFor(current), { ...current.tokens[4], speed: 30 });
  assert.equal(costs.get('8,8'), 6, 'The old five-square displacement costs six units through terrain.');
  assert.equal(ENG.cheb(current.tokens[4], { x: 8, y: 8 }) * 5, 25);
  const rejected = _test.stateWriteDecision(owner, [], 'host', current, legacyProposal(current), rules);
  assert.equal(rejected.code, 'STATE_FORBIDDEN'); assert.match(rejected.error, /not reachable/);
  const { persisted, finishCalls } = await runProductionMove(current), actor = persisted.tokens[4];
  assert.deepEqual({ x: actor.x, y: actor.y, remaining: actor.moveRemaining,
    feet: actor.movementResult.feet, fromX: actor.movementResult.fromX,
    fromY: actor.movementResult.fromY },
  { x: 7, y: 5, remaining: 0, feet: 30, fromX: 13, fromY: 3 });
  const accepted = _test.stateWriteDecision(owner, [], 'host', current, persisted, rules);
  assert.equal(accepted.ok, true, accepted.error); assert.equal(finishCalls, 1);
});
