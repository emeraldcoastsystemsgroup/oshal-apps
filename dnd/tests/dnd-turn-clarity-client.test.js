/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 00:15:33 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard persistent actor ownership, explicit automated stages, and view-only AI action controls.
 * 2026-07-23 00:49:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Replace sequential stage claims with simultaneous movement, action, slots, and health budgets.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const turnSource = fs.readFileSync(path.join(root, 'ui', 'table-turns.js'), 'utf8');
const screenSource = fs.readFileSync(path.join(root, 'ui', 'table-screens.js'), 'utf8');
const presentationSource = fs.readFileSync(path.join(root, 'ui', 'table-presentation.js'), 'utf8');

/** @description Create one isolated automated-turn HUD with deterministic shared state. */
function turnClient() {
  const flag = { className: '', innerHTML: '' };
  const actor = { id: 'bram', slug: 'bram', kind: 'pc', name: 'Bram', positionSet: false,
    moveRemaining: 30, speed: 30, hp: 12, maxHp: 12, acted: false, slots: { 1: 2 }, turnSerial: 4 };
  const context = vm.createContext({
    board: { mode: 'combat', turnSerial: 4, turnIndex: 0, order: ['bram'], tokens: [actor], sharedRoll: null },
    campaign: { campaign_id: 'campaign-1' }, selected: null, selectedAction: null, TV: false,
    sessionStorage: { getItem: () => 'turn-client', setItem() {} }, crypto: { randomUUID: () => 'turn-client' },
    Promise, Map, Set, Date, Math, setTimeout, clearTimeout, setInterval, clearInterval,
    $: () => flag, activeToken: () => actor, shortTokenLabel: (token) => token.name,
    actionsOf: () => [{ name: 'Longsword', type: 'weapon' }, { name: 'Second Wind', type: 'feature' }],
    positionChosen: (token) => !!token.positionSet, movementStoryPending: (token) => !!(token.movementResult && !token.movementResult.complete),
    movementLeft: (token) => token.moveRemaining,
    combatTelegraph: () => context.warning || null, controls: () => false, claimedBy: () => null,
    isAICompanion: (token) => token.kind === 'pc', isDowned: () => false,
    deathSaveScore: () => ({ successes: 0, failures: 0 }), requestedRollHero: () => actor,
    renderPresentationGateFlag: () => false, esc: (value) => String(value),
  });
  vm.runInContext(`${turnSource}\n;globalThis.__turn = { setTurnFlag, setPhase(value) { automationPhase = value; } };`, context);
  return { actor, flag, render: () => context.__turn.setTurnFlag(), setPhase: context.__turn.setPhase };
}

test('AI turns always name the actor while showing simultaneous turn resources', () => {
  const client = turnClient();
  client.render();
  assert.match(client.flag.innerHTML, /Bram's turn/); assert.match(client.flag.innerHTML, /Bram is moving/);
  assert.match(client.flag.innerHTML, /Movement[\s\S]*30 ft left[\s\S]*Action[\s\S]*1 left[\s\S]*Spell slots[\s\S]*L1: 2[\s\S]*Health[\s\S]*12\/12 HP/);
  client.actor.positionSet = true; client.render();
  assert.match(client.flag.innerHTML, /Bram is choosing Longsword or Second Wind/);
  client.setPhase({ id: 'bram', cue: 'Bram · AI Companion chooses Longsword against Archer.' }); client.render();
  assert.match(client.flag.innerHTML, /Bram targets Archer with Longsword/);
  client.actor.turnResult = { serial: 4, text: 'Bram hits Archer.', rollEvent: { rolls: [{ actionName: 'Longsword' }] } };
  client.actor.acted = true;
  client.setPhase({ id: 'bram', cue: 'Rolls · Bram rolls for Longsword.' }); client.render();
  assert.match(client.flag.innerHTML, /Bram rolls now/);
  client.setPhase({ id: 'bram', cue: 'Result · Bram hits Archer.' }); client.render();
  assert.match(client.flag.innerHTML, /Result: Bram hits Archer/);
});

test('opening and dock surfaces preserve turn ownership without selectable AI controls', () => {
  assert.match(presentationSource, /function renderPresentationGateFlag\(flag, suppliedActor\)/);
  assert.match(presentationSource, /<strong>\$\{esc\(name\)\}'s turn<\/strong>/);
  assert.match(presentationSource, /turn is unlocking automatically/);
  assert.match(screenSource, /Watching \$\{shortTokenLabel\(active\)\}/);
  assert.match(screenSource, /appendDockWatchNote\(acts, dockLockMessage\(t, false\)\)/);
  assert.match(screenSource, /appendDockAction\(acts, action, false, false, t\)/);
  assert.doesNotMatch(screenSource, /AI Acting|Skip Monster/);
});
