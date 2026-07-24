/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 22:48:44 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove host and synchronized clients replace abandoned rewind state before presentation, and retry safely after archive failure.
 * 2026-07-21 23:04:51 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove exact combat rolls retry until archived and synchronized movement reaches observers before its dice presentation.
 * 2026-07-22 00:10:49 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove reconnect archive catch-up renders silently and only a later newest live beat presents once.
 * 2026-07-22 00:44:42 | roger.murphy@emeraldcoastsystemsgroup.com  | Provide the turn module shared-roll pause dependency in isolated authoritative-story clients.
 * 2026-07-22 22:19:02 | roger.murphy@emeraldcoastsystemsgroup.com  | Require every newly arrived live beat to present in order while reconnect history remains silent.
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

/** @description Return one rewind gate shared by the host and observers. */
function rewindGate(lease) {
  return {
    id: 'rewind-gate-1', kind: 'rewind', sceneId: 'coast-road', turnSerial: 4,
    message: 'The threads of fate rewind to the fork.', complete: false,
    lease, leaseAt: Date.now(), createdAt: Date.now(),
  };
}

/** @description Return a compact board carrying one exact rewind gate. */
function boardWithGate(gate) {
  return {
    mode: 'combat', sceneId: 'coast-road', turnSerial: 4, round: 2,
    tokens: [], presentationGate: clone(gate),
  };
}

/** @description Return the exact pruned archive branch after the rewind. */
function branchRows() {
  return [
    { seq: 1, kind: 'narration', content: 'The road bends into rain.' },
    { seq: 2, kind: 'combat', content: 'Bram blocks the first arrow.' },
    { seq: 3, kind: 'milestone', content: 'Save point: At the fork.' },
    { seq: 4, kind: 'milestone', content: 'The threads of fate rewind to: At the fork.' },
  ];
}

/** @description Build a minimal DOM node used by archive rendering. */
function fakeElement(id, events) {
  const node = { id, className: '', dataset: {}, children: [], style: {}, scrollTop: 0, scrollHeight: 0, isConnected: false };
  const classes = new Set();
  node.classList = { add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)), contains: (name) => classes.has(name) };
  let html = '';
  Object.defineProperty(node, 'innerHTML', {
    get: () => html,
    set: (value) => { html = String(value); if (!value) node.children = []; },
  });
  node.appendChild = (child) => {
    child.isConnected = true; node.children.push(child); node.scrollHeight = node.children.length;
    if (id === 'log') events.push(`log:${child.innerHTML}`);
  };
  node.remove = () => { node.isConnected = false; };
  node.querySelector = () => ({ onclick: null });
  node.querySelectorAll = () => [];
  return node;
}

/** @description Build the small document surface exercised by rewind logic. */
function fakeDocument(events) {
  const nodes = new Map();
  ['log', 'stage', 'overlayCard', 'turnflag'].forEach((id) => nodes.set(id, fakeElement(id, events)));
  nodes.get('overlayCard').dataset.screen = '';
  return {
    hidden: true, nodes,
    createElement: () => fakeElement('', events),
    getElementById: (id) => nodes.get(id) || fakeElement(id, events),
    querySelectorAll: () => [],
  };
}

/** @description Export only the client seams and cache state under test. */
function rewindExports() {
  return `;globalThis.__rewindTest = {
    loadSnapshot, recordCombat,
    reconcile(response) { return reconcileSyncResponse(response, syncEpoch, campaign.campaign_id); },
    markArchiveLive() { archivePlaybackLive = true; archiveSyncCompletedAt = Date.now(); },
    seed(cursor) {
      lastSeq = cursor; archiveSeenSeq = new Set(Array.from({ length: cursor }, (_v, index) => index + 1));
      localArchiveEchoes = [{ kind: 'narration', content: 'abandoned future', payload: null, element: null }];
      rememberPresentationArchiveBeat('narration', 'abandoned future'); combatDiceSeen.add('abandoned-die');
      const stale = document.createElement('div'); stale.innerHTML = 'abandoned future'; $('log').appendChild(stale);
    },
    state() {
      const gate = rewindArchiveGate(board);
      return { cursor: lastSeq, seen: Array.from(archiveSeenSeq), echoes: localArchiveEchoes.length,
        abandonedSignature: presentationArchiveHas('narration', 'abandoned future'),
        abandonedDie: combatDiceSeen.has('abandoned-die'), ready: !!(gate && rewindArchiveReady(gate)),
        blocked: presentationGateBlocksInput(), complete: !!(board.presentationGate && board.presentationGate.complete),
        clientId: presentationClientId, lease: board.presentationGate && board.presentationGate.lease,
        gateEpoch: presentationGateEpoch, jobId: presentationGateJob && presentationGateJob.id };
    }
  };`;
}

/** @description Assemble one isolated browser-like tabletop client. */
function createClient(options) {
  const events = [], document = fakeDocument(events), archivePlan = [...options.archivePlan];
  const archivePostPlan = [...(options.archivePostPlan || [])], archivePostBodies = [];
  const counters = { archiveGets: 0, archivePosts: 0, presents: 0, begins: 0 };
  const context = vm.createContext({
    board: options.board || { mode: 'combat', sceneId: 'coast-road', turnSerial: 9, tokens: [] },
    campaign: { campaign_id: 'camp-1', is_owner: options.owner }, players: [], rev: 5,
    boardSheets: {}, sheetsRev: '', selected: {}, selectedAction: {}, inspect: {}, TV: false,
    lastSeq: 0, archiveSeenSeq: new Set(),
    confirmedBoard: null, confirmedBoardRev: 0, confirmedCampaignId: '', campaignEpoch: 0,
    sharedRollPresentation: '', telegraph: null, automationPhase: null, turnResolutionPending: null,
    turnAdvanceInFlight: null, document, Math, Date, JSON, Promise, AbortController,
    sessionStorage: { getItem: () => options.clientId, setItem() {} },
    crypto: { randomUUID: () => `${options.clientId}-generated` },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
    waitMs: options.waitMs || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    isOwner: () => options.owner, esc: (value) => String(value), $: (id) => document.getElementById(id),
    sharedRollPending: (state) => !!(state && state.sharedRoll && ['requested', 'rolled'].includes(state.sharedRoll.status)),
    cancelAutomatedWork() {}, resetTurnPresentationMemory() { events.push('turn-memory-reset'); },
    clearReachable() {}, renderChoices() {}, updateInitiativeBar() {}, renderDock() {}, setTurnFlag() {},
    stopSpeech() {}, dismissCaption() {}, setStoryOpen() {}, persist() {},
    flushPendingState: () => Promise.resolve(true), indexTerrain() {}, layout() {}, closeOverlay() {},
    controls: () => false, isDowned: () => false, acknowledgeDowned() {}, showLobby() {},
    showResolvedState() {}, showDefeatState() {}, overlay() {}, autoSnapshot() {},
    SC: () => ({ title: 'Ambush', openingChoices: [] }), caption() {}, speakCaption() {},
    banner: (message) => events.push(`banner:${message}`),
    presentPhase: () => { counters.presents++; events.push('present'); return Promise.resolve('done'); },
    beginTurn: () => { counters.begins++; events.push('begin'); },
  });
  context.api = async (pathname, request) => {
    if (pathname === '/restore') { events.push('restore'); return clone(options.restore); }
    if (pathname === '/state') { events.push('state-save'); return { ok: true, rev: Number(context.rev) + 1 }; }
    if (pathname === '/archive') {
      counters.archivePosts++; archivePostBodies.push(JSON.parse(request.body)); events.push('archive-post');
      const next = archivePostPlan.shift(); if (next instanceof Error) throw next;
      return clone(await next);
    }
    if (pathname.startsWith('/archive?')) {
      counters.archiveGets++; events.push('archive-get');
      const next = archivePlan.shift(); if (next instanceof Error) throw next;
      return clone(await next);
    }
    return { ok: true, changed: false, archiveTail: [], players: [] };
  };
  sources.forEach((source, index) => vm.runInContext(source, context, { filename: `rewind-${index}.js` }));
  vm.runInContext(rewindExports(), context);
  return { context, events, counters, archivePostBodies, api: context.__rewindTest, log: document.nodes.get('log') };
}

/** @description Let detached presentation promises finish their microtasks. */
async function settlePresentation() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('combat dice cannot finish their phase until the exact archive event retries successfully', async () => {
  let releaseRetry;
  const retryWait = new Promise((resolve) => { releaseRetry = resolve; });
  const client = createClient({
    clientId: 'host-tab', owner: true, archivePlan: [],
    archivePostPlan: [new Error('network'), { entry: { seq: 5, kind: 'combat', content: 'Bram hits.' } }],
    waitMs: () => retryWait,
  });
  client.context.presentCombatDie = () => Promise.resolve('shown');
  const rollEvent = { v: 1, eventId: 'turn-4-bram-attack', rolls: [{ kind: 'attack', actorId: 'bram', dice: '1d20', values: [17], modifier: 5, total: 22 }] };
  let finished = false;
  const pending = client.api.recordCombat('Bram hits.', rollEvent).then((value) => { finished = true; return value; });
  await settlePresentation();
  assert.equal(finished, false); assert.equal(client.counters.archivePosts, 1);
  releaseRetry();
  assert.equal(await pending, 'shown'); assert.equal(client.counters.archivePosts, 2);
  assert.deepEqual(client.archivePostBodies.map((body) => body.payload.eventId), ['turn-4-bram-attack', 'turn-4-bram-attack']);
  assert.deepEqual(client.archivePostBodies.map((body) => body.timelineId), ['', '']);
});

test('spectators receive the moved board before its synchronized combat dice', async () => {
  const before = { mode: 'combat', sceneId: 'coast-road', turnSerial: 1, round: 1, turnIndex: 0,
    order: ['bram'], tokens: [{ id: 'bram', kind: 'pc', x: 0, y: 0, hp: 10, maxHp: 10 }] };
  const after = clone(before); after.tokens[0].x = 2;
  const client = createClient({ clientId: 'player-tab', owner: false, board: before, archivePlan: [] });
  client.context.presentCombatDie = () => {
    client.events.push(`dice-at-x:${client.context.board.tokens[0].x}`); return Promise.resolve('shown');
  };
  client.api.markArchiveLive();
  await client.api.reconcile({
    ok: true, changed: true, rev: 6, state: after, players: [],
    archiveTail: [{ seq: 1, kind: 'combat', content: 'Bram advances and strikes.', payload: null }],
  });
  assert.equal(client.context.board.tokens[0].x, 2);
  assert.ok(client.events.includes('dice-at-x:2'), JSON.stringify(client.events));
  assert.equal(client.events.includes('dice-at-x:0'), false);
});

test('reconnect catch-up renders history silently before one new live beat presents once', async () => {
  const client = createClient({ clientId: 'tv-reconnect', owner: false, archivePlan: [] });
  let dice = 0, speech = 0;
  client.context.TV = true;
  client.context.presentCombatDie = () => { dice++; return Promise.resolve('shown'); };
  client.context.speakCaption = () => { speech++; return Promise.resolve('done'); };
  const response = (archiveTail) => ({ ok: true, changed: false, rev: 5, players: [], archiveTail });

  await client.api.reconcile(response([
    { seq: 1, kind: 'combat', content: 'Old attack: 12+4=16 vs AC 13 hit.' },
    { seq: 2, kind: 'narration', content: 'Old narration.' },
    { seq: 3, kind: 'combat', content: 'Old save: 8+2=10 vs DC 12 failure.' },
  ]));
  assert.equal(dice, 0); assert.equal(speech, 0);
  assert.equal(client.log.children.length, 3); assert.equal(clientState(client).cursor, 3);

  await client.api.reconcile(response([]));
  await client.api.reconcile(response([
    { seq: 4, kind: 'narration', content: 'A prior live setup line.' },
    { seq: 5, kind: 'combat', content: 'Fenwick attacks: 17+5=22 vs AC 13 hit.' },
  ]));
  assert.equal(dice, 1); assert.equal(speech, 1); assert.equal(client.log.children.length, 5);
  await client.api.reconcile(response([{ seq: 5, kind: 'combat', content: 'Fenwick attacks: 17+5=22 vs AC 13 hit.' }]));
  assert.equal(dice, 1); assert.equal(speech, 1);
});

/** @description Normalize cross-realm cache state for strict assertions. */
function clientState(client) {
  return clone(client.api.state());
}

test('host rebuilds the pruned archive before a restored gate can present or resume', async () => {
  let releaseArchive;
  const archive = new Promise((resolve) => { releaseArchive = resolve; });
  const gate = rewindGate('host-tab');
  const host = createClient({
    clientId: 'host-tab', owner: true, archivePlan: [archive],
    restore: { ok: true, state: boardWithGate(gate), rev: 6, sheets: {}, sheetsRev: 's2', label: 'At the fork' },
  });
  host.api.seed(9);
  const loading = host.api.loadSnapshot('snapshot-1');
  await settlePresentation();
  assert.equal(host.counters.presents, 0); assert.equal(host.counters.begins, 0);
  releaseArchive({ archive: branchRows() });
  assert.equal(await loading, true, JSON.stringify({ events: host.events, state: clientState(host) }));
  const state = clientState(host);
  assert.deepEqual(state.seen, [1, 2, 3, 4]); assert.equal(state.cursor, 4);
  assert.equal(state.echoes, 0); assert.equal(state.abandonedSignature, false); assert.equal(state.abandonedDie, false);
  assert.equal(state.complete, true); assert.equal(host.counters.presents, 1); assert.equal(host.counters.begins, 1);
  const lastLog = Math.max(...host.events.map((event, index) => event.startsWith('log:') ? index : -1));
  assert.ok(lastLog < host.events.indexOf('present')); assert.ok(lastLog < host.events.indexOf('begin'));
  assert.deepEqual(host.log.children.map((node) => node.dataset.archiveSeq), ['1', '2', '3', '4']);
});

test('host and observer independently discard the same poisoned future before sync applies rewind', async () => {
  const gate = rewindGate('host-tab'), response = {
    ok: true, changed: true, rev: 6, state: boardWithGate(gate), players: [],
    archiveTail: [{ seq: 10, kind: 'combat', content: 'POISONED ABANDONED TAIL' }],
  };
  const host = createClient({ clientId: 'host-tab', owner: true, archivePlan: [{ archive: branchRows() }] });
  const player = createClient({ clientId: 'player-tab', owner: false, archivePlan: [{ archive: branchRows() }] });
  host.api.seed(10); player.api.seed(14);
  await Promise.all([host.api.reconcile(clone(response)), player.api.reconcile(clone(response))]);
  await settlePresentation();
  [host, player].forEach((client) => {
    const state = clientState(client);
    assert.equal(state.cursor, 4); assert.deepEqual(state.seen, [1, 2, 3, 4]); assert.equal(state.echoes, 0);
    assert.equal(client.log.children.some((node) => node.innerHTML.includes('POISONED')), false);
  });
  assert.equal(host.counters.presents, 1, JSON.stringify(host.events)); assert.equal(host.counters.begins, 1);
  assert.equal(player.counters.presents, 0); assert.equal(player.counters.begins, 0);
  assert.equal(clientState(player).blocked, true);
});

test('failed rewind archive reload remains locked and retries exactly once on the next poll', async () => {
  const gate = rewindGate('host-tab');
  const host = createClient({
    clientId: 'host-tab', owner: true,
    archivePlan: [new Error('network'), { archive: branchRows() }],
  });
  host.api.seed(9);
  const changed = { ok: true, changed: true, rev: 6, state: boardWithGate(gate), players: [],
    archiveTail: [{ seq: 10, kind: 'narration', content: 'POISONED ABANDONED TAIL' }] };
  await host.api.reconcile(changed);
  let state = clientState(host);
  assert.equal(state.ready, false); assert.equal(state.blocked, true);
  assert.equal(host.counters.presents, 0); assert.equal(host.counters.begins, 0);
  const unchanged = { ok: true, changed: false, rev: 6, players: [], archiveTail: changed.archiveTail };
  await host.api.reconcile(unchanged); await settlePresentation();
  state = clientState(host);
  assert.equal(state.ready, true, JSON.stringify(host.events)); assert.equal(state.complete, true);
  assert.equal(host.counters.archiveGets, 2); assert.equal(host.counters.presents, 1); assert.equal(host.counters.begins, 1);
  assert.equal(host.log.children.some((node) => node.innerHTML.includes('POISONED')), false);
  await host.api.reconcile({ ...unchanged, archiveTail: [] }); await settlePresentation();
  assert.equal(host.counters.archiveGets, 2); assert.equal(host.counters.presents, 1);
});
