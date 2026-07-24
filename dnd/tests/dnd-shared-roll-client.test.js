/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 00:36:25 | roger.murphy@emeraldcoastsystemsgroup.com  | Exercise authoritative shared-roll pauses, exact same-turn resumption, controller takeover, and durable visible-result recovery.
 * 2026-07-23 11:36:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep the isolated reconciliation harness aware of byte-equivalent authoritative-state adoption.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const storySource = fs.readFileSync(path.join(root, 'ui', 'table-story.js'), 'utf8');
const turnsSource = fs.readFileSync(path.join(root, 'ui', 'table-turns.js'), 'utf8');

/** @description Extract one named source interval for focused browser-state execution. */
function sourceBetween(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source interval: ${start}`);
  return source.slice(from, to);
}

/** @description Build a deterministic authoritative-state scheduler with browser collaborators stubbed. */
function authoritativeHarness() {
  const timers = [], context = vm.createContext({ setTimeout: (fn) => { timers.push(fn); } });
  const pendingSource = sourceBetween(turnsSource, 'function sharedRollPending(', 'function automatedTurnState(');
  const applySource = sourceBetween(storySource, 'function applyAuthoritativeState(', 'async function restoreAuthoritativeBoard(');
  vm.runInContext(`
    let board = { sceneId: 'road', mode: 'combat', turnSerial: 17, tokens: [] }, rev = 4;
    let boardSheets = {}, sheetsRev = '', selected, selectedAction, inspect, telegraph, automationPhase;
    let turnResolutionPending, turnAdvanceInFlight, rewindArchiveTransitionGate = null, TV = true;
    const counts = { cancels: 0, begins: 0, presents: 0 };
    function cancelAutomatedWork() { counts.cancels++; }
    function boardsEquivalent(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
    function cancelCombatDice() {} function stopSpeech() {} function dismissCaption() {}
    function rememberConfirmedBoard() {} function clearReachable() {} function closeOverlay() {}
    function setStoryOpen() {} function indexTerrain() {} function layout() {} function updateInitiativeBar() {}
    function handleAuthoritativePresentationGate() { return false; }
    function presentSharedRoll() { counts.presents++; } function beginTurn() { counts.begins++; }
    function renderDock() {} function setTurnFlag() {} function controls() { return false; }
    function isDowned() { return false; } function acknowledgeDowned() {}
    function showResolvedState() {} function showDefeatState() {}
    function $(id) { return { dataset: { screen: id === 'overlayCard' ? '' : '' } }; }
    ${pendingSource}
    ${applySource}
    globalThis.harness = {
      apply: applyAuthoritativeState,
      drain() {},
      snapshot() { return { ...counts, serial: board.turnSerial, status: board.sharedRoll && board.sharedRoll.status }; }
    };
  `, context);
  context.harness.drain = () => { while (timers.length) timers.shift()(); };
  return context.harness;
}

/** @description Execute presentation-key transitions against one mutable seat roster. */
function presentationHarness() {
  const controllerSource = sourceBetween(storySource, 'function sharedRollControllerKey(', 'function createDiceContext(');
  const presentSource = sourceBetween(storySource, 'function presentSharedRoll(', '/** Prose fallback');
  const context = vm.createContext({});
  vm.runInContext(`
    let players = [], sharedRollPresentation = '', visible = null, shows = 0;
    function requestedRollHero(roll) { return { slug: roll.actorSlug }; }
    function claimedBy(slug) { return players.find((seat) => seat.slug === slug); }
    function isOwner() { return true; } function presentationGatePending() { return false; }
    function $(id) { return { querySelector() { return id === 'stage' ? visible : null; } }; }
    function finishResolvedDiceContext() {} function presentPersistedDice() {}
    function showDice() { shows++; }
    ${controllerSource}
    ${presentSource}
    globalThis.harness = {
      human(roll) {
        players = [{ slug: roll.actorSlug, seatKey: 'seat-a', name: 'Faye', me: false }];
        const controllerKey = sharedRollControllerKey(roll);
        sharedRollPresentation = sharedRollPresentationKey(roll);
        visible = { _sharedDiceContext: { controllerKey, req: roll, rolling: false, done: false } };
      },
      release() { players = []; }, present: presentSharedRoll,
      snapshot() { return { shows, key: sharedRollPresentation }; }
    };
  `, context);
  return context.harness;
}

test('requested and rolled shared states cancel automation until authoritative resolution', () => {
  const harness = authoritativeHarness();
  const requested = { sceneId: 'road', mode: 'combat', turnSerial: 17, tokens: [],
    sharedRoll: { id: 'roll-1', actorSlug: 'fenwick', status: 'requested' } };
  harness.apply(requested, 5); harness.drain();
  assert.deepEqual({ ...harness.snapshot() }, { cancels: 1, begins: 0, presents: 1, serial: 17, status: 'requested' });
  const resolved = { ...requested, sharedRoll: { ...requested.sharedRoll, status: 'resolved', natural: 12, modifier: 2, total: 14 } };
  harness.apply(resolved, 6); harness.drain();
  assert.deepEqual({ ...harness.snapshot() }, { cancels: 2, begins: 1, presents: 2, serial: 17, status: 'resolved' });
});

test('controller changes invalidate a waiting die and resolved rolls present only once', () => {
  const harness = presentationHarness();
  const requested = { id: 'roll-2', actorSlug: 'fenwick', status: 'requested' };
  harness.human(requested); harness.release(); harness.present(requested);
  assert.equal(harness.snapshot().shows, 1);
  assert.match(harness.snapshot().key, /requested:ai:driver$/);
  const resolved = { ...requested, status: 'resolved', natural: 10, modifier: 2, total: 12 };
  harness.present(resolved); harness.present(resolved);
  assert.equal(harness.snapshot().shows, 2, 'the final die appears once even when the rolled revision was skipped');
});

test('shared dice recover exact stored results visibly and never expose a dismiss gap', () => {
  const dmSource = sourceBetween(storySource, 'async function dmNarrate(', '// Three tappable next-move suggestions');
  const rollSource = sourceBetween(storySource, 'async function performDiceRoll(', 'function wireDiceContext(');
  const wireSource = sourceBetween(storySource, 'function wireDiceContext(', 'function showDice(');
  const showSource = sourceBetween(storySource, 'function showDice(', 'function presentSharedRoll(');
  const persistedSource = sourceBetween(storySource, 'async function presentPersistedDice(', 'function localDiceResult(');
  const automationSource = sourceBetween(turnsSource, 'function automationActor(', 'function scheduleMonsterCallback(');
  const nextSource = sourceBetween(turnsSource, 'async function nextTurn(', 'async function checkEnd(');
  assert.match(dmSource, /applyAuthoritativeState\(r\.state, r\.rev, r\.sheets, r\.sheetsRev\)/);
  assert.doesNotMatch(dmSource, /board\s*=\s*r\.state/);
  assert.match(dmSource, /sharedRollPending\(board\) && !opts\.rollResult/);
  assert.match(rollSource, /applyAuthoritativeState\(response\.state, response\.rev\)/);
  assert.match(automationSource, /!sharedRollPending\(board\)/);
  assert.match(nextSource, /board\.mode !== 'combat' \|\| sharedRollPending\(board\)/);
  assert.match(wireSource, /\['rolled', 'resolved'\][\s\S]*presentPersistedDice\(ctx\)/);
  assert.match(wireSource, /ctx\.aiRequested[\s\S]*setTimeout\(\(\) => void performDiceRoll\(ctx\), 700\)/);
  assert.match(wireSource, /ctx\.closeButton\.disabled = locked/);
  assert.match(showSource, /!req && sharedRollPending\(board\)[\s\S]*presentSharedRoll\(board\.sharedRoll\)/);
  assert.match(persistedSource, /!ctx\.spectator[\s\S]*submitDiceNarration\(ctx, diceResultCopy\(ctx, ctx\.req\)\)/);
  assert.match(storySource, /<div class="die" id="bigDie"><span class="dnum">20<\/span><\/div>/);
});
