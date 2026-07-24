/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 00:36:15 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove tactical results and AI-companion stages persist and advance within one second after the exact die, without awaiting archive, natural narration, or a Dungeon Master model call.
 * 2026-07-22 00:50:11 | roger.murphy@emeraldcoastsystemsgroup.com  | Cover the durable completed-position and Take No Action path when an AI companion has no legal target.
 * 2026-07-22 10:10:58 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove tactical phases await their bounded presentation seam in movement-target-dice-result order while archive and model work remain detached.
 * 2026-07-22 22:19:02 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove resolved rolls request one bounded cinematic DM beat while movement and no-action fallbacks remain immediate.
 * 2026-07-22 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Prove stationary automated positions complete and archive without another spoken filler phase.
 * 2026-07-23 00:49:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Await the scheduled post-movement handoff deterministically under full-suite load.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Supply deterministic defaults for configurable action, dice, and NPC-pace presentation.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'table-automation.js'), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const never = () => new Promise(() => {});

/** @description Build deterministic actors, board, counters, and die control. */
function tacticalParts() {
  const action = {
    id: 'longsword', name: 'Longsword', type: 'weapon', mode: 'attack', delivery: 'melee', reach: 5,
  };
  const hero = {
    id: 'bram', slug: 'bram', kind: 'pc', name: 'Bram', x: 0, y: 0, speed: 30,
    moveRemaining: 30, hp: 12, maxHp: 12, positionSet: false, moved: false, acted: false, slots: {},
  };
  const goblin = { id: 'goblin-1', kind: 'monster', name: 'Goblin Archer', x: 2, y: 0, hp: 7, maxHp: 7, ac: 13 };
  const board = {
    mode: 'combat', sceneId: 'road', turnSerial: 4, turnIndex: 0,
    order: [hero.id, goblin.id], tokens: [hero, goblin],
  };
  const state = { events: [], snapshots: [], advances: 0, beginCalls: 0, modelCalls: 0, resolvedWith: null };
  let releaseDie;
  const diePending = new Promise((resolve) => { releaseDie = resolve; });
  const run = { epoch: 1, campaignId: 'camp-1', sceneId: 'road', actorId: hero.id, serial: 4, kind: 'pc' };
  return { action, board, diePending, goblin, hero, releaseDie: () => releaseDie('shown'), run, state };
}

/** @description Build the stable rules and turn-state half of the VM global. */
function tacticalGlobals(parts, options) {
  const { action, board, goblin, hero } = parts;
  return {
    board, campaign: { campaign_id: 'camp-1' }, automationPhase: null, telegraph: null,
    automationClientId: 'host-tab', automationEpoch: 1, turnResolutionPending: null,
    selected: null, selectedAction: null, AUTOMATION_LEASE_MS: 20000, AUTOMATION_HEARTBEAT_MS: 5000,
    automatedResultJobs: new Map(), automatedMovementJobs: new Map(),
    locallyNarratedResults: new Set(), locallyNarratedMovements: new Set(), locallyPresentedCues: new Set(),
    Promise, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    ENG: { computeMovementCosts: () => new Map([['0,0', 0], ['1,0', 1]]) },
    actionsOf: () => [action], validTargets: (actor) => !options.noTargets && actor.x >= 1 ? [goblin] : [],
    living: (kind) => kind === 'monster' ? [goblin] : [hero],
    cheb: (left, right) => Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y)),
    movementLeft: (actor) => actor.moveRemaining, unitFeet: () => 5,
    positionChosen: (actor) => !!actor.positionSet,
    movementStoryPending: (actor) => !!(actor.movementResult && !actor.movementResult.complete),
    turnStoryPending: (actor) => !!(actor.turnResult && !actor.turnResult.complete),
    automationActor: (candidate) => candidate && candidate.actorId === hero.id && board.order[board.turnIndex] === hero.id ? hero : null,
    activeToken: () => board.tokens.find((token) => token.id === board.order[board.turnIndex]),
    isOwner: () => true, isAICompanion: (actor) => actor === hero, controls: () => false,
    isConscious: (actor) => actor.hp > 0, isDowned: () => false,
    shortTokenLabel: (token) => String(token.name).split(/\s/)[0],
    turnKey: (token, serial) => `camp-1:road:${serial}:${token.id}`,
    makeTurnRollEvent: (_candidate, rolls) => Array.isArray(rolls) && rolls.length
      ? { v: 1, eventId: 'bram-4-longsword', rolls } : null,
    withShow: (_actor, _action, _target, resolve) => resolve(),
    combatMovementNarration: (actor) => `${actor.name} crosses the road.`,
    combatMovementShouldNarrate: (movement) => Number(movement && movement.feet) > 0,
    combatActionCueNarration: (actor, target) => `${actor.name} closes on ${target.name}.`,
    combatOutcomeActionNarration: (actor) => `${actor.name} attacks.`,
    combatRecoveredCueNarration: (actor) => `${actor.name} commits to the attack.`,
    combatOutcomeFallback: (actor) => `${actor.name} holds the line.`,
    combatDiceNarration: () => '',
    dmPlaySetting: () => false, dmNpcPaceMs: (milliseconds) => milliseconds,
    acknowledgeDowned: async () => never(),
    scheduleAutomatedCallback() {}, computeReachable() {}, setTurnFlag() {},
    W: () => ({ sheetFor: () => ({ actions: [action] }), tokens: board.tokens }),
  };
}

/** @description Build instrumented effects, persistence, dice, and media seams. */
function tacticalEffects(parts, options, sandbox) {
  const { board, diePending, goblin, hero, state } = parts, opts = options || {};
  const { events, snapshots } = state;
  return {
    resolveAction: () => {
      state.resolvedWith = { telegraph: clone(board.telegraph), movement: clone(hero.movementResult) };
      goblin.hp = 3;
      return { text: 'Bram hits Goblin for 4 damage.', rolls: [{ kind: 'attack', actionName: 'Longsword' }] };
    },
    renderDock: () => events.push(`render:${sandbox.automationPhase && sandbox.automationPhase.cue || ''}`),
    banner: (text) => events.push(`banner:${text}`), persist: () => events.push('persist'),
    flushPendingState: async () => { snapshots.push(clone(board)); return true; },
    recordArchivedBeat: (_kind, text) => { events.push(`archive:${text}`); return never(); },
    presentPhase: (text, minimum, _priority, _settled, maximum) => {
      events.push(`voice:${minimum}:${maximum}:${text}`); return Promise.resolve('done');
    },
    presentCombatDie: (text) => {
      events.push(`die:${text}`); return opts.blockDie ? diePending : Promise.resolve('shown');
    },
    speakCaption: async () => 'done',
    requestDungeonMasterCombatNarration: async () => {
      state.modelCalls++; return { text: 'Bram drives the goblin back with a ringing blow.', archived: true };
    },
    waitMs: async (delay) => { events.push(`wait:${delay}`); },
    dmResolve: () => { state.modelCalls++; return never(); },
    checkEnd: async () => false,
    nextTurn: async () => { state.advances++; events.push('advance'); return true; },
    beginTurn: () => { state.beginCalls++; },
  };
}

/** @description Create the minimal classic-script global used by tactical code. */
function tacticalContext(parts, options) {
  const sandbox = tacticalGlobals(parts, options || {});
  Object.assign(sandbox, tacticalEffects(parts, options, sandbox));
  return vm.createContext(sandbox);
}

/** @description Build one browser-like tactical client with blocked media work. */
function tacticalClient(options) {
  const parts = tacticalParts(), context = tacticalContext(parts, options);
  vm.runInContext(`${source}\n;globalThis.__tactical = {
    companionTurn, companionAct, performAutomatedMovementPresentation,
    performAutomatedResultPresentation, makeTurnResult
  };`, context, { filename: 'table-automation.js' });
  return {
    ...parts, context, events: parts.state.events, snapshots: parts.state.snapshots,
    api: context.__tactical,
    counts: () => ({ advances: parts.state.advances, beginCalls: parts.state.beginCalls, modelCalls: parts.state.modelCalls }),
    showDie: parts.releaseDie,
    resolved: () => parts.state.resolvedWith,
  };
}

/** @description Reject one operation that exceeds the release tactical budget. */
async function withinOneSecond(operation) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('tactical flow exceeded one second')), 900); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** @description Await a scheduled client continuation without relying on one event-loop turn. */
async function waitFor(predicate) {
  const deadline = Date.now() + 500;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('a deterministic result awaits bounded presentation while archive work remains blocked', async () => {
  const client = tacticalClient({ blockDie: true });
  client.hero.acted = true;
  client.hero.turnResult = client.api.makeTurnResult(client.run, 'Bram hits Goblin for 4 damage.', null,
    [{ kind: 'attack', actionName: 'Longsword' }]);
  const operation = client.api.performAutomatedResultPresentation(client.run, 'bram-result');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.hero.turnResult.complete, false, 'Result cannot complete before its exact visible die');
  assert.equal(client.counts().advances, 0);
  client.showDie();
  const result = await withinOneSecond(operation);
  assert.equal(result, true);
  assert.equal(client.hero.turnResult.complete, true);
  assert.deepEqual(client.counts(), { advances: 1, beginCalls: 0, modelCalls: 1 });
  assert.ok(client.events.some((event) => event.startsWith('archive:Bram hits')));
  assert.ok(client.events.some((event) => event.includes('voice:') && event.includes('ringing blow')));
  assert.ok(client.events.some((event) => event.includes('render:Result')));
  const order = ['die:Bram hits', 'render:Result', 'voice:', 'advance']
    .map((prefix) => client.events.findIndex((event) => event.startsWith(prefix)));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual([...order].sort((left, right) => left - right), order);
});

test('AI companion persists move, action, and legal target before resolving once', async () => {
  const client = tacticalClient();
  await withinOneSecond(client.api.companionTurn(client.run));
  await waitFor(() => client.counts().beginCalls === 1);
  assert.match(client.hero.movementResult.text, /^Bram moves 5 ft east toward Goblin/);
  assert.equal(client.hero.movementResult.complete, true);
  assert.equal(client.counts().beginCalls, 1);

  await withinOneSecond(client.api.companionAct(client.run));
  const movementSaved = client.snapshots.find((state) => state.tokens[0].movementResult
    && state.tokens[0].movementResult.complete === false);
  const targetSaved = client.snapshots.find((state) => state.telegraph && state.tokens[0].acted === false);
  assert.ok(movementSaved, 'movement/position must be persisted as its own stage');
  assert.ok(targetSaved, 'choice/target must be persisted before action effects');
  assert.deepEqual(targetSaved.telegraph, {
    actorId: 'bram', targetId: 'goblin-1', turnSerial: 4,
    actionId: 'longsword', actionName: 'Longsword', lease: 'host-tab', leaseAt: targetSaved.telegraph.leaseAt,
  });
  assert.match(client.events.join('\n'), /Bram chooses Longsword\. Bram targets Goblin · legal target/);
  assert.equal(client.resolved().telegraph.targetId, 'goblin-1');
  assert.equal(client.resolved().movement.complete, true);
  assert.ok(client.hero.turnResult, JSON.stringify({ events: client.events, snapshots: client.snapshots }));
  assert.equal(client.hero.turnResult.complete, true);
  assert.equal(client.goblin.hp, 3);
  assert.deepEqual(client.counts(), { advances: 1, beginCalls: 1, modelCalls: 1 });
});

test('AI companion persists completed position and Take No Action before advancing', async () => {
  const client = tacticalClient({ noTargets: true });
  await withinOneSecond(client.api.companionTurn(client.run));
  await waitFor(() => client.counts().beginCalls === 1);
  assert.equal(client.hero.movementResult.complete, true);

  await withinOneSecond(client.api.companionAct(client.run));
  const pendingPass = client.snapshots.find((state) => state.tokens[0].turnResult
    && state.tokens[0].turnResult.complete === false);
  assert.ok(pendingPass, 'Take No Action must be persisted before its visible result completes');
  assert.equal(pendingPass.tokens[0].movementResult.complete, true);
  assert.match(pendingPass.tokens[0].turnResult.text, /Bram.*takes no action/i);
  assert.equal(pendingPass.tokens[0].turnResult.rollEvent, undefined);
  assert.equal(client.hero.turnResult.complete, true);
  assert.equal(client.counts().advances, 1);
  assert.equal(client.counts().modelCalls, 0);
});

test('stationary automated position archives silently and completes', async () => {
  const client = tacticalClient();
  client.hero.positionSet = true;
  client.hero.movementResult = {
    text: 'Bram stays at position (0, 0) · position set · AI Companion.',
    serial: 4, complete: false, lease: 'host-tab', leaseAt: Date.now(),
    fromX: 0, fromY: 0, toX: 0, toY: 0, feet: 0,
  };
  await withinOneSecond(client.api.performAutomatedMovementPresentation(client.run, 'bram-stays'));
  assert.equal(client.hero.movementResult.complete, true);
  assert.ok(client.events.some((event) => event.startsWith('archive:Bram stays')));
  assert.equal(client.events.some((event) => event.startsWith('voice:')), false);
});
