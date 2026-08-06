/**
 * Venture Plan - compiled scheduled-run integration guards.
 *
 * This suite crosses the actual venture-run orchestration boundary while
 * replacing its database and bot adapters with recording seams. The pure budget,
 * store SQL, and route gates have separate real-module suites; this one proves
 * the orchestrator actually wires them together and still computes after capped
 * analyst phases are skipped.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove scheduled run cost gating, owner-scoped progress, free compute continuation, and slot replay behavior through the compiled orchestrator.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const state = {
  botCalls: [], costUpdates: [], advances: [], closes: [], reservations: [],
  modelWrites: 0, reserveInserted: true, costUpdateThrows: false, closeResolve: null,
};

const model = {
  bom: { runQtyUnits: 100, recurringUnitMicros: 5000, lines: [] },
  figures: {}, issues: [], posture: 'estimate', canPublish: false,
};

const STUBS = {
  '@/features/agent-management': {
    BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}),
  },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  './venture-model': { buildVentureModel: () => model },
  './venture-store-compose': {
    composeModelInput: () => ({
      input: { ledger: { byId: {}, order: [] }, runQtyUnits: 100 },
      missingAssumptionKeys: [],
    }),
    hashableInputs: () => ({}),
  },
  './venture-bots': {
    AGENT_IDS: { bomAnalyst: 'bom-bot', marketAnalyst: 'market-bot', opsAnalyst: 'ops-bot', strategist: 'strategy-bot' },
    authorBom: async () => {
      state.botCalls.push('bom');
      return { text: '{}', costUsd: 0.006, model: 'test', durationMs: 1 };
    },
    authorMarket: async () => {
      state.botCalls.push('market');
      return { text: '{}', costUsd: 0.001, model: 'test', durationMs: 1 };
    },
    authorOps: async () => {
      state.botCalls.push('ops');
      return { text: '{}', costUsd: 0.001, model: 'test', durationMs: 1 };
    },
    narrate: async () => ({ text: '{}', costUsd: 0.001, model: 'test', durationMs: 1 }),
  },
  './venture-bot-contracts': {
    parseBomOutput: () => ({ ok: true, vendors: [], rows: [] }),
    parseAssumptionOutput: () => ({ ok: true, rows: [] }),
    parseOpsOutput: () => ({ ok: true, rows: [], tasks: [], roles: [] }),
    parseProseOutput: () => ({}),
  },
  './venture-documents': { buildTables: () => ({}), renderDocument: () => ({}) },
  './venture-doc-catalog': { DOC_CATALOG: [], getDocSpec: () => null, proseKeysFor: () => [] },
  './venture-store': {
    getVenture: async (_pool, ownerSub, ventureId) => ({
      id: ventureId, ownerSub, name: 'Widget', ideaText: 'idea', spec: {},
    }),
    liveAssumptions: async () => [],
    getScenario: async () => null,
    coverageOf: () => ({ totalAssumptions: 0, bySourceKind: {}, byConfidence: {}, estimatePct: 0 }),
    bulkInsertAssumptions: async () => {},
    openRun: async () => 'manual',
    advanceRun: async (...args) => { state.advances.push(args); },
    closeRun: async (...args) => {
      state.closes.push(args);
      if (state.closeResolve) state.closeResolve();
    },
  },
  './venture-store-supply': {
    listBom: async () => [], listVendors: async () => [], listHeadcount: async () => [],
    listScheduleTasks: async () => [], replaceBomFromBot: async () => {},
    replaceHeadcount: async () => {}, replaceScheduleTasks: async () => {},
    insertVendor: async () => ({ id: 'vendor' }),
  },
  './venture-store-outputs': {
    hashInputs: () => 'hash',
    insertModel: async () => {
      state.modelWrites += 1;
      return {
        id: `model-${state.modelWrites}`, figures: {}, tables: {}, coverage: {}, warnings: [],
        posture: 'estimate', canPublish: false, computedAt: '2026-08-06T00:00:00Z',
      };
    },
    insertDocumentVersion: async () => {},
  },
  './venture-store-rebaseline': {
    openScheduledRun: async (...args) => {
      state.reservations.push(args);
      return { runId: state.reserveInserted ? 'scheduled-1' : 'existing-1', inserted: state.reserveInserted };
    },
    updateScheduledRunCost: async (_pool, ownerSub, ventureId, runId, budget) => {
      state.costUpdates.push({ ownerSub, ventureId, runId, budget });
      if (state.costUpdateThrows) throw new Error('cost evidence database unavailable');
      return true;
    },
  },
  './venture-types': { ENGINE_VERSION: 'test' },
};

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};

const Run = require(path.join(PKG, 'routes', 'venture-run.js'));
const ctx = { pool: {} };

function reset() {
  state.botCalls.length = 0;
  state.costUpdates.length = 0;
  state.advances.length = 0;
  state.closes.length = 0;
  state.reservations.length = 0;
  state.modelWrites = 0;
  state.reserveInserted = true;
  state.costUpdateThrows = false;
  state.closeResolve = null;
}

test('an overshooting scheduled analyst call blocks later bots but free compute closes the run', async () => {
  reset();
  const closed = new Promise((resolve) => { state.closeResolve = resolve; });
  const opened = await Run.startScheduledRebaseline(
    ctx, 'alice', 'v1', 'nightly:2026-08-06', '2026-08-06', 5_000,
  );
  assert.deepEqual(opened, {
    runId: 'scheduled-1', alreadyRunning: false, alreadyScheduled: false,
    phases: ['bom', 'market', 'ops', 'compute'],
  });
  await closed;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(state.botCalls, ['bom'], 'market and ops never cross the bot boundary');
  assert.equal(state.costUpdates[0].budget.status, 'overshot');
  assert.equal(state.costUpdates[0].budget.spentMicros, 6_000);
  assert.ok(state.costUpdates.every((entry) => entry.ownerSub === 'alice'
    && entry.ventureId === 'v1' && entry.runId === 'scheduled-1'));
  assert.ok(state.costUpdates.at(-1).budget.callsSkipped >= 2);
  assert.ok(state.modelWrites >= 3, 'BOM/ops context and terminal compute remain code-only model writes');

  const finalPhases = state.closes[0][5];
  assert.deepEqual(finalPhases.map((phase) => [phase.name, phase.status]), [
    ['bom', 'done'], ['market', 'skipped'], ['ops', 'skipped'], ['compute', 'done'],
  ]);
  assert.deepEqual(state.closes[0].slice(1, 4), ['alice', 'v1', 'scheduled-1']);
  assert.equal(state.closes[0][4], 'done', 'a free computed model remains usable with named gaps');
  assert.match(state.closes[0][6], /scheduled bot call blocked/);
  assert.equal(Run.inFlightRun('v1'), null);
});

test('an already-reserved UTC slot returns its run without bot or progress work', async () => {
  reset();
  state.reserveInserted = false;
  const opened = await Run.startScheduledRebaseline(
    ctx, 'alice', 'v2', 'weekly:2026-08-03', '2026-08-03', 5_000,
  );
  assert.equal(opened.runId, 'existing-1');
  assert.equal(opened.alreadyScheduled, true);
  assert.deepEqual(state.botCalls, []);
  assert.deepEqual(state.costUpdates, []);
  assert.deepEqual(state.advances, []);
  assert.deepEqual(state.closes, []);
});

test('a thrown cost-evidence write fails closed before any later bot dispatch', async () => {
  reset();
  state.costUpdateThrows = true;
  const closed = new Promise((resolve) => { state.closeResolve = resolve; });
  await Run.startScheduledRebaseline(
    ctx, 'alice', 'v3', 'nightly:2026-08-07', '2026-08-07', 50_000,
  );
  await closed;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(state.botCalls, ['bom']);
  assert.equal(state.costUpdates[1].budget.status, 'capture-failed');
  assert.match(state.closes[0][6], /cost evidence database unavailable/);
  assert.equal(Run.inFlightRun('v3'), null);
});
