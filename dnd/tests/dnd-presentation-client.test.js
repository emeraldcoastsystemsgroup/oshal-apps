/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:47:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove two clients remain locked behind one leased presenter and failed gate writes restore a retryable pending state without duplicate story media.
 * 2026-07-21 22:15:31 | roger.murphy@emeraldcoastsystemsgroup.com  | Stub the structured initiative dependency while exercising the presentation gate in isolation.
 * 2026-07-21 23:04:51 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep the opening gate locked until its narration archive write is durably confirmed.
 * 2026-07-22 00:18:41 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove slow or failed natural narration and archive writes cannot retain the gameplay gate, while state recovery never replays media.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'table-presentation.js'), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));

/** @description Build one exact pending client gate. */
function gate(lease, leaseAt) {
  return {
    id: 'gate-1', kind: 'opening', sceneId: 'coast-road', turnSerial: 1,
    message: 'Goblin arrows split the rain.', createdAt: 1, complete: false,
    lease, leaseAt,
  };
}

/** @description Build the compact combat board shared by two VM clients. */
function boardWithGate(value) {
  return { mode: 'combat', sceneId: 'coast-road', turnSerial: 1, round: 1, tokens: [], presentationGate: clone(value) };
}

/** @description Create one isolated browser-like presentation client. */
function createClient(options) {
  const counters = { archives: 0, cutaways: 0, presents: 0, flushes: 0, begins: 0, snapshots: 0 };
  const memory = new Map([['dnd-presentation-client', options.clientId]]), flag = { innerHTML: '', className: '' };
  flag.querySelector = (selector) => selector === '[data-presentation-audio-retry]' && flag.innerHTML.includes('data-presentation-audio-retry') ? {} : null;
  const context = vm.createContext({
    board: clone(options.board), campaign: { campaign_id: 'camp-1', is_owner: options.owner }, rev: 5,
    selected: {}, selectedAction: {}, inspect: {}, TV: false, Math, Date, JSON, Promise,
    crypto: { randomUUID: () => `generated-${options.clientId}` },
    sessionStorage: { getItem: (key) => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) },
    setTimeout, clearTimeout, isOwner: () => options.owner,
    esc: (value) => String(value), activeToken: () => null, shortTokenLabel: (token) => token && token.name || '',
    cancelAutomatedWork() {}, cancelCombatDice() {}, clearReachable() {}, renderChoices() {},
    initiativeDiceForGate() { return false; }, presentOpeningInitiative() { return Promise.resolve('shown'); },
    updateInitiativeBar() {}, renderDock() {}, banner() {}, setStoryOpen() {}, caption() {},
    recordArchivedBeat() { counters.archives++; return options.archive ? options.archive() : undefined; }, requestCutaway() { counters.cutaways++; },
    presentPhase(_text, _minimum, _priority, onSettled) {
      counters.presents++;
      void Promise.resolve(options.present()).then((status) => { if (onSettled) onSettled(status); });
      return Promise.resolve('playing');
    },
    retryNaturalVoice() { return Promise.resolve('done'); }, setVoiceMuted() {}, speakCaption() { return Promise.resolve('done'); },
    persist() {}, flushPendingState() { counters.flushes++; return Promise.resolve(options.control.save); },
    beginTurn() { counters.begins++; }, autoSnapshot() { counters.snapshots++; },
    showLobby() {}, showResolvedState() {}, showDefeatState() {}, overlay() {},
    SC: () => ({ title: 'Ambush', openingChoices: [] }),
  });
  const exports = `\n;globalThis.__gateTest = {
    pendingPresentationGate, presentationGatePending, resumePendingPresentationGate,
    handleAuthoritativePresentationGate, renderPresentationGateFlag,
    presentationAudioRetryText,
    retryAudio: retryPresentationNarration,
    stopRecovery() { clearTimeout(presentationGateRetryTimer); presentationGateRetryTimer = null; },
    reset() { resetPresentationGateController(true); },
    retry() { presentationGateFailure = null; return resumePendingPresentationGate(); }
  };`;
  vm.runInContext(source + exports, context, { filename: 'table-presentation.js' });
  return { context, counters, flag, api: context.__gateTest };
}

/** @description Return a promise whose presentation finish is test-controlled. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('slow host narration does not hold authoritative completion or another client', async () => {
  const speech = deferred(), pending = gate('host-tab', Date.now());
  const host = createClient({ clientId: 'host-tab', owner: true, board: boardWithGate(pending), control: { save: true }, present: () => speech.promise });
  const player = createClient({ clientId: 'player-tab', owner: false, board: boardWithGate(pending), control: { save: true }, present: () => Promise.resolve('unexpected') });
  const hostRun = host.api.resumePendingPresentationGate();
  assert.equal(await player.api.resumePendingPresentationGate(), false);
  assert.equal(host.counters.presents, 1); assert.equal(player.counters.presents, 0);
  assert.equal(player.counters.begins, 0);
  assert.equal(player.api.presentationGatePending(), true);
  assert.equal(await hostRun, true);
  assert.equal(host.context.board.presentationGate.complete, true);
  assert.equal(host.counters.flushes, 1); assert.equal(host.counters.begins, 1);
  const before = clone(player.context.board);
  player.context.board = clone(host.context.board);
  const locked = player.api.handleAuthoritativePresentationGate(before);
  if (!locked) player.context.beginTurn();
  assert.equal(locked, false); assert.equal(player.counters.begins, 1);
  speech.resolve('done');
});

test('opening caption and turn resume without waiting for its background archive write', async () => {
  const archived = deferred(), pending = gate('host-tab', Date.now());
  const host = createClient({
    clientId: 'host-tab', owner: true, board: boardWithGate(pending), control: { save: true },
    archive: () => archived.promise, present: () => Promise.resolve('done'),
  });
  assert.equal(await host.api.resumePendingPresentationGate(), true);
  assert.equal(host.counters.archives, 1); assert.equal(host.counters.presents, 1);
  assert.equal(host.counters.begins, 1); assert.equal(host.api.presentationGatePending(), false);
  archived.resolve({ seq: 1 });
});

test('failed completion restores the pending gate and retries without duplicate archive or cutaway', async () => {
  const control = { save: false }, pending = gate('host-tab', Date.now());
  const host = createClient({ clientId: 'host-tab', owner: true, board: boardWithGate(pending), control, present: () => Promise.resolve('done') });
  assert.equal(await host.api.resumePendingPresentationGate(), false);
  host.api.stopRecovery();
  assert.equal(host.api.presentationGatePending(), true);
  assert.equal(host.context.board.presentationGate.complete, false);
  assert.equal(host.counters.begins, 0);
  host.api.renderPresentationGateFlag(host.flag);
  assert.match(host.flag.innerHTML, /unlock automatically/);
  assert.doesNotMatch(host.flag.innerHTML, /Retry Presentation/);
  control.save = true;
  assert.equal(await host.api.retry(), true);
  assert.equal(host.context.board.presentationGate.complete, true);
  assert.equal(host.counters.archives, 1); assert.equal(host.counters.cutaways, 1);
  assert.equal(host.counters.presents, 1); assert.equal(host.counters.begins, 1);
  host.api.reset();
});

test('failed natural narration leaves an audio-only retry after gameplay unlocks', async () => {
  const pending = gate('host-tab', Date.now());
  const host = createClient({ clientId: 'host-tab', owner: true, board: boardWithGate(pending), control: { save: true }, present: () => Promise.resolve('unavailable') });
  assert.equal(await host.api.resumePendingPresentationGate(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.api.presentationGatePending(), false);
  assert.equal(host.context.board.presentationGate.complete, true);
  assert.equal(host.api.presentationAudioRetryText(), pending.message);
  const completed = clone(host.context.board.presentationGate), flushes = host.counters.flushes;
  assert.equal(await host.api.retryAudio(), 'done');
  assert.deepEqual(host.context.board.presentationGate, completed);
  assert.equal(host.counters.flushes, flushes);
  assert.equal(host.api.presentationAudioRetryText(), '');
});

test('failed expired-lease claim rolls back the unsaved presenter identity', async () => {
  const pending = gate('old-host-tab', 1);
  const host = createClient({ clientId: 'new-host-tab', owner: true, board: boardWithGate(pending), control: { save: false }, present: () => Promise.resolve('done') });
  assert.equal(await host.api.resumePendingPresentationGate(), false);
  host.api.stopRecovery();
  assert.equal(host.context.board.presentationGate.lease, 'old-host-tab');
  assert.equal(host.context.board.presentationGate.complete, false);
  assert.equal(host.counters.presents, 0); assert.equal(host.counters.begins, 0);
  host.api.reset();
});
