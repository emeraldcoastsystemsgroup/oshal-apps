/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-27 22:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove a joined player leaves the lobby for BOTH live quest modes, so a story-first investigation cannot run behind a stuck join-code screen.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'ui');
const sources = ['table-dice.js', 'table-presentation.js', 'table-story.js']
  .map((name) => fs.readFileSync(path.join(root, name), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

/** @description Build the smallest overlay surface the synchronizer reads and retires. */
function fakeElement(id) {
  const node = { id, className: '', dataset: {}, children: [], style: {}, scrollTop: 0, scrollHeight: 0 };
  const classes = new Set();
  node.classList = { add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)), contains: (name) => classes.has(name) };
  let html = '';
  Object.defineProperty(node, 'innerHTML', { get: () => html, set: (value) => { html = String(value); } });
  node.appendChild = (child) => { node.children.push(child); };
  node.remove = () => {};
  node.querySelector = () => ({ onclick: null });
  node.querySelectorAll = () => [];
  return node;
}

/** @description Assemble one isolated joined-player client parked on a staging screen. */
function joinedPlayerClient(options) {
  const events = [], nodes = new Map();
  ['log', 'stage', 'overlayCard', 'turnflag', 'banner'].forEach((id) => nodes.set(id, fakeElement(id)));
  nodes.get('overlayCard').dataset.screen = options.screen;
  const document = {
    hidden: true, nodes, createElement: () => fakeElement(''),
    getElementById: (id) => nodes.get(id) || fakeElement(id), querySelectorAll: () => [],
  };
  const context = vm.createContext({
    board: clone(options.board), campaign: { campaign_id: 'camp-1', is_owner: false, name: 'The Crownfall Masquerade' },
    players: [{ user_sub: 'joiner', me: true, slug: 'bram', name: 'Roger' }], rev: 4,
    boardSheets: {}, sheetsRev: '', selected: null, selectedAction: null, inspect: null, TV: !!options.tv,
    lastSeq: 0, archiveSeenSeq: new Set(),
    confirmedBoard: null, confirmedBoardRev: 0, confirmedCampaignId: '', campaignEpoch: 0,
    sharedRollPresentation: '', telegraph: null, automationPhase: null, turnResolutionPending: null,
    turnAdvanceInFlight: null, document, Math, Date, JSON, Promise, AbortController,
    sessionStorage: { getItem: () => 'joined-tab', setItem() {} },
    crypto: { randomUUID: () => 'joined-tab-generated' },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
    waitMs: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isOwner: () => false, esc: (value) => String(value), $: (id) => document.getElementById(id),
    sharedRollPending: () => false,
    cancelAutomatedWork() {}, resetTurnPresentationMemory() {}, clearReachable() {}, renderChoices() {},
    updateInitiativeBar() {}, renderDock() { events.push('render-dock'); }, setTurnFlag() {},
    stopSpeech() {}, dismissCaption() {}, persist() {}, indexTerrain() {}, layout() {},
    setStoryOpen: (open) => events.push(`story-open:${open}`),
    flushPendingState: () => Promise.resolve(true),
    closeOverlay: () => { events.push('close-overlay'); nodes.get('overlayCard').dataset.screen = ''; },
    resumeExploration: () => events.push('resume-exploration'),
    controls: () => false, isDowned: () => false, acknowledgeDowned() {},
    showLobby: () => { events.push('show-lobby'); nodes.get('overlayCard').dataset.screen = 'lobby'; },
    showResolvedState: () => events.push('show-resolved'), showDefeatState: () => events.push('show-defeat'),
    overlay() {}, autoSnapshot() {}, SC: () => ({ title: 'The Crownfall Masquerade', openingChoices: [] }),
    caption() {}, speakCaption() {}, addBeat() {}, presentCombatDie: () => Promise.resolve('shown'),
    banner: (message) => events.push(`banner:${message}`),
    presentPhase: () => Promise.resolve('done'), beginTurn: () => events.push('begin-turn'),
  });
  context.api = async () => ({ ok: true, changed: false, archiveTail: [], players: [] });
  sources.forEach((source, index) => vm.runInContext(source, context, { filename: `lobby-${index}.js` }));
  vm.runInContext(`;globalThis.__lobbyTest = {
    reconcile(response) { return reconcileSyncResponse(response, syncEpoch, campaign.campaign_id); },
    screen() { return $('overlayCard').dataset.screen; },
  };`, context);
  return { context, events, api: context.__lobbyTest };
}

/** @description Return the shared lobby board every player holds before the host launches. */
function setupBoard() {
  return { mode: 'setup', sceneId: 'crownfall-dawn-court', turnSerial: 0, round: 0, turnIndex: 0,
    order: [], tokens: [{ id: 'bram', kind: 'pc', slug: 'bram', x: 1, y: 1, hp: 12, maxHp: 12 }] };
}

/** @description Return the same board once the host has started a live quest mode. */
function launchedBoard(mode) {
  const board = setupBoard();
  board.mode = mode;
  board.order = ['bram'];
  if (mode === 'exploration') board.exploration = { discovered: [] };
  return board;
}

test('a joined player leaves the lobby when the host starts a story-first investigation', async () => {
  const client = joinedPlayerClient({ screen: 'lobby', board: setupBoard() });
  await client.api.reconcile({ ok: true, changed: true, rev: 5, state: launchedBoard('exploration'), players: [], archiveTail: [] });
  assert.equal(client.api.screen(), '', 'the join-code lobby must not survive the launch');
  assert.ok(client.events.includes('close-overlay'));
  assert.ok(client.events.includes('resume-exploration'), 'the player must land in the running investigation');
  assert.ok(client.events.some((event) => event.startsWith('banner:')), 'the launch must be announced, not silent');
});

test('a joined player still leaves the lobby when the host starts combat', async () => {
  const client = joinedPlayerClient({ screen: 'lobby', board: setupBoard() });
  await client.api.reconcile({ ok: true, changed: true, rev: 5, state: launchedBoard('combat'), players: [], archiveTail: [] });
  assert.equal(client.api.screen(), '');
  assert.ok(client.events.includes('close-overlay'));
});

test('every staging screen is retired by a live quest, not just the lobby', async () => {
  for (const screen of ['claim-heroes', 'character-import', 'tv-lobby']) {
    const client = joinedPlayerClient({ screen, board: setupBoard() });
    await client.api.reconcile({ ok: true, changed: true, rev: 5, state: launchedBoard('exploration'), players: [], archiveTail: [] });
    assert.equal(client.api.screen(), '', `${screen} must not survive the launch`);
  }
});

test('a staged lobby is left alone while the table is still being set up', async () => {
  const client = joinedPlayerClient({ screen: 'lobby', board: setupBoard() });
  const seated = setupBoard();
  await client.api.reconcile({ ok: true, changed: false, rev: 4, state: seated, archiveTail: [],
    players: [{ user_sub: 'joiner', me: true, slug: 'bram', name: 'Roger' }, { user_sub: 'host', me: false, slug: 'della', name: 'Host' }] });
  assert.equal(client.api.screen(), 'lobby', 'seat changes during setup must refresh the lobby, never close it');
  assert.ok(client.events.includes('show-lobby'));
  assert.ok(!client.events.includes('close-overlay'));
});

test('a TV holding its lobby joins the live quest without a player-facing banner', async () => {
  const client = joinedPlayerClient({ screen: 'tv-lobby', board: setupBoard(), tv: true });
  await client.api.reconcile({ ok: true, changed: true, rev: 5, state: launchedBoard('exploration'), players: [], archiveTail: [] });
  assert.equal(client.api.screen(), '');
  assert.ok(!client.events.some((event) => event.startsWith('banner:')));
});
