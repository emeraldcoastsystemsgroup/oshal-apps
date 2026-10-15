/**
 * Venture Plan - authoring runs on the native kernel.
 *
 * The native kernel answers a package's host calls (SQL, bot turns) only while the request that
 * made them is open; after the response the bridge refuses them with "Completed application request
 * is unavailable in this native runtime" (oshal-kernel crates/host-process/bridge/unavailable_call.js).
 * Live, the detached drive's first write after its BOM call was refused and the run stayed at
 * 'phase: bom' running for 21+ minutes. This suite gives the compiled orchestrator store and bot
 * doubles that refuse exactly like that once the request has answered, and proves the run is driven
 * and closed inside its request: a cut-off BOM reply fails the phase with that reason, the analysts
 * one request cannot fit are deferred, the next Run continues from them, and a run an earlier
 * request left running is closed as interrupted.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Native in-request run driving, cut-off reply reason, deferred analysts and their continuation, interrupted-run closing.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A prose reply or a closed but invalid JSON reply keeps the parser's reason; only an opened, unclosed JSON reply is called cut off.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A run whose request was abandoned mid-call (the page closed) is left 'running' by the refused writes and is presented interrupted by a read once it is past the request deadline plus a margin, without writing; a fresh run, a run this process drives and any run off the native kernel are presented as stored.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Run the analysts continues from the first analyst the latest full run deferred, failed or left with an input it did not supply, and starts over only after a clean cycle (live, a further Run restarted at bom). A native full run stores every catalogue document rendered from the computed numbers with no bot call, so a document can be opened and its prose regenerated (every document was "not generated yet"). A market reply that leaves a required slot empty finishes the phase with that slot named.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The venture-types double names heldAgainstAnalysts, which the run now reads to tell a slot a held row answers from a gap; the held-row behaviour itself is proven against PostgreSQL in venture-run-evidence-slots.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The venture-store double names retireAnalystRows, which a BOM phase now calls after its redraft; closing the analyst's orphaned rows is proven against PostgreSQL in venture-run-evidence-slots.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: a BOM reply that does not parse (prose, 15 s) is asked for once more with the strict JSON rule and the run goes on with the strict reply; a slow first reply leaves no room and fails with the parser's reason after ONE call; a cut-off reply is never retried. Regenerate prose tells the strategist which figures are not reachable and stores no sentence claiming the plan reaches break-even.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | A native run stores its computed documents in ONE batched write (insertDocumentVersions) instead of one insert per document, and with less than NATIVE_DOCUMENTS_RESERVE_MS of its request left it stores none and defers the Documents phase with DOCUMENTS_LATE (live: an ops run timed out at 60 s in 17 single inserts after the model was stored). The batched SQL itself is proven against PostgreSQL in venture-prose-export.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Review of sweep 10: Regenerate prose stores the conditions "What would have to be true" is for ("To break even within the horizon, the landed cost would have to fall to $2.10 per lid.") exactly as written, and a section whose only sentence claimed break-even is stored with a note saying why instead of disappearing from the document.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Round 14: Regenerate prose gives the strategist break-even as computed (BREAK-EVEN AS COMPUTED lines, not a NOT REACHABLE figure) and deletes nothing: the conditions are stored exactly as written with no note, and a section claiming break-even is reached (including the round-13 modal form "would cover ... before the venture reaches break-even") is stored as written with the visible check note after it.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const REFUSED = 'Completed application request is unavailable in this native runtime';
/** A BOM reply that reached the output limit mid-array, as the live 2048-token reply did. */
const CUT_OFF = '```json\n{"bom_lines": [{"ref": "A1", "partName": "Housing", "specText": "ABS shell';

/** A market reply that fills every required slot (venture-required-inputs). */
const MARKET_FILLED = JSON.stringify({ assumptions: [], required: Object.fromEntries(
  ['baseDemandUnits', 'retailPriceUsd', 'dtcCostPerOrderUsd', 'seasonSellThroughPercent'].map((k) => [k,
    { value: 10, low: 5, high: 20, confidence: 'low', basis: 'fixture', sourceUrl: null }])) });

const clock = { offset: 0 };
const realNow = Date.now;
Date.now = () => realNow() + clock.offset;

const state = {
  open: true, refused: [], botCalls: [], advances: [], closes: [], opened: [],
  latest: null, runs: [], bomText: CUT_OFF, bomSeconds: 39, marketText: MARKET_FILLED, documents: [], batches: [],
  opsSeconds: 0, bomTexts: [], bomStrict: [], narrateText: '{}', narrateArgs: [],
};

/** Every host call the doubles serve passes the native request gate first. */
function host(name) {
  if (!state.open) {
    state.refused.push(name);
    throw Object.assign(new Error(REFUSED), { code: 'native_executor_unavailable', status: 503 });
  }
}

const model = {
  bom: { runQtyUnits: 100, recurringUnitMicros: 5000, lines: [] },
  figures: {}, issues: [], posture: 'estimate', canPublish: false,
};

const STUBS = {
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  './venture-model': { buildVentureModel: () => model },
  './venture-store-compose': {
    composeModelInput: () => ({ input: { ledger: { byId: {}, order: [] }, runQtyUnits: 100 }, missingAssumptionKeys: [] }),
    hashableInputs: () => ({}),
  },
  './venture-bots': {
    AGENT_IDS: { bomAnalyst: 'bom-bot', marketAnalyst: 'market-bot', opsAnalyst: 'ops-bot', strategist: 'strategy-bot' },
    authorBom: async (_ctx, _client, _sub, _spec, _qty, strict) => {
      host('bot_turn'); state.botCalls.push('bom'); state.bomStrict.push(Boolean(strict));
      await new Promise((resolve) => setImmediate(resolve));
      clock.offset += state.bomSeconds * 1000;
      const text = state.bomTexts.length ? state.bomTexts.shift() : state.bomText;
      return { text, costUsd: 0, model: 'test', durationMs: state.bomSeconds * 1000 };
    },
    authorMarket: async () => {
      host('bot_turn'); state.botCalls.push('market'); clock.offset += 30_000;
      return { text: state.marketText, costUsd: 0, model: 'test', durationMs: 1 };
    },
    authorOps: async () => {
      host('bot_turn'); state.botCalls.push('ops'); clock.offset += state.opsSeconds * 1000;
      return { text: JSON.stringify({ required: Object.fromEntries(['containerFreightUsd', 'htsDutyPercent', 'finalAssemblyCostUsd']
        .map((k) => [k, { value: 10, low: 5, high: 20, confidence: 'low', basis: 'fixture', sourceUrl: null }])) }),
      costUsd: 0, model: 'test', durationMs: 1 };
    },
    narrate: async (...args) => {
      host('bot_turn'); state.botCalls.push('narrate'); state.narrateArgs.push(args.slice(3));
      return { text: state.narrateText, costUsd: 0 };
    },
  },
  './venture-bot-contracts': {
    parseBomOutput: (text) => (text.trim().endsWith('}')
      ? { ok: true, vendors: [], rows: [] } : { ok: false, error: 'Unexpected end of JSON input' }),
    parseAssumptionOutput: () => ({ ok: true, rows: [] }),
    parseOpsOutput: () => ({ ok: true, rows: [], tasks: [], roles: [] }),
    parseProseOutput: (text) => { try { return JSON.parse(text).sections || {}; } catch { return {}; } },
    extractJsonObject: (text) => { try { return JSON.parse(text); } catch { return null; } },
  },
  './venture-documents': { buildTables: () => ({}), renderDocument: (spec, src) => ({ docKey: spec.key, title: spec.key, bodyMd: JSON.stringify(src.prose || {}),
    sections: [], unverifiedNumbers: [], assumptionsCited: [], estimatePct: 0 }) },
  './venture-doc-catalog': { DOC_CATALOG: [{ key: 'one-pager' }, { key: 'pitch' }], proseKeysFor: () => ['summary'],
    getDocSpec: (key) => ({ key, sections: [{ kind: 'figures', heading: 'Unit economics', keys: [], optionalKeys: ['breakEven.units'] },
      { kind: 'prose', heading: 'What would have to be true', proseKey: 'summary' }] }) },
  './venture-store': {
    getVenture: async (_pool, ownerSub, ventureId) => { host('sql'); return { id: ventureId, ownerSub, name: 'Widget', ideaText: 'idea', spec: {} }; },
    liveAssumptions: async () => { host('sql'); return []; },
    getScenario: async () => null,
    coverageOf: () => ({ totalAssumptions: 0, bySourceKind: {}, byConfidence: {}, estimatePct: 0 }),
    bulkInsertAssumptions: async () => { host('sql'); return { written: 0, failed: [] }; },
    retireAnalystRows: async () => { host('sql'); return []; },
    openRun: async (_pool, _sub, _venture, kind, phases) => {
      host('sql'); state.opened.push({ kind, phases: phases.map((x) => x.name) });
      return `run-${state.opened.length}`;
    },
    advanceRun: async (...args) => { host('sql'); state.advances.push(args); },
    closeRun: async (...args) => { host('sql'); state.closes.push(args); },
    latestRun: async () => { host('sql'); return state.latest; },
    listRuns: async () => { host('sql'); return state.runs; },
  },
  './venture-store-supply': {
    listBom: async () => { host('sql'); return []; }, listVendors: async () => [], listHeadcount: async () => [],
    listScheduleTasks: async () => [], replaceBomFromBot: async () => { host('sql'); },
    replaceHeadcount: async () => {}, replaceScheduleTasks: async () => {}, insertVendor: async () => ({ id: 'vendor' }),
  },
  './venture-store-outputs': {
    hashInputs: () => 'hash',
    insertModel: async () => {
      host('sql');
      return { id: 'model-1', figures: {}, tables: {}, coverage: {}, warnings: [], posture: 'estimate', canPublish: false, computedAt: 'now' };
    },
    insertDocumentVersion: async (_pool, _sub, _venture, doc) => { host('sql'); state.documents.push(doc); },
    insertDocumentVersions: async (_pool, _sub, _venture, docs) => {
      host('sql'); state.batches.push(docs.length); state.documents.push(...docs); return docs.length;
    },
  },
  './venture-store-rebaseline': { openScheduledRun: async () => null, updateScheduledRunCost: async () => true },
  './venture-types': { ENGINE_VERSION: 'test', heldAgainstAnalysts: () => false },
};

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const Run = require(path.join(PKG, 'routes', 'venture-run.js'));
Module._load = originalLoad;

process.env.OSHAL_EGRESS = 'kernel';
const ctx = { pool: {} };

function reset() {
  Object.assign(state, { open: true, refused: [], botCalls: [], advances: [], closes: [], opened: [],
    latest: null, runs: [], bomText: CUT_OFF, bomSeconds: 39, marketText: MARKET_FILLED, documents: [], batches: [],
    opsSeconds: 0, bomTexts: [], bomStrict: [], narrateText: '{}', narrateArgs: [] });
  clock.offset = 0;
}

/** One POST /ventures/:id/runs on the native kernel: the request answers when startRun resolves. */
async function request(kind = 'full', venture = 'v1') {
  state.open = true;
  const started = await Run.startRun(ctx, 'alice', venture, kind, undefined, '2026-10-11');
  state.open = false;
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return started;
}

const statuses = (close) => close[5].map((phase) => [phase.name, phase.status]);

test('a native run is driven and closed inside its request; a cut-off BOM reply fails the phase with that reason', async () => {
  reset();
  const started = await request();
  assert.equal(started.alreadyRunning, false);
  assert.deepEqual(state.refused, [], 'nothing is attempted after the request answered');
  assert.equal(state.closes.length, 1, 'the run is closed, never left running');
  const [, owner, venture, runId, status, phases, error] = state.closes[0];
  assert.deepEqual([owner, venture, runId, status], ['alice', 'v1', 'run-1', 'done']);
  assert.deepEqual(statuses(state.closes[0]), [
    ['bom', 'failed'], ['market', 'skipped'], ['ops', 'skipped'], ['compute', 'done'], ['narrate', 'skipped'],
  ]);
  assert.match(phases[0].error, /BOM analyst reply was cut off before its JSON closed \(it reached the model's output limit\)/);
  assert.ok(phases.slice(1, 3).every((phase) => phase.error.startsWith(Run.DEFERRED)), 'market and ops wait for the next run');
  assert.match(error, /not run yet: market, ops, narrate/);
  assert.deepEqual(state.botCalls, ['bom'], 'one analyst per 60-second request');
  assert.equal(Run.inFlightRun('v1'), null);
});

test('only a reply that opened its JSON and never closed it is called cut off', () => {
  assert.match(Run.unusableReply('BOM analyst', CUT_OFF, 'x'), /cut off before its JSON closed/);
  assert.equal(Run.unusableReply('BOM analyst', 'I cannot estimate costs for this idea.', 'no JSON object in the reply'),
    'BOM analyst reply unusable: no JSON object in the reply');
  assert.equal(Run.unusableReply('ops analyst', '{"rows": 3}', 'rows must be an array'),
    'ops analyst reply unusable: rows must be an array');
});

test('the next native run continues from the first deferred analyst', async () => {
  reset();
  state.bomText = '{"bom_lines": [], "vendor_candidates": []}';
  state.bomSeconds = 2;
  await request();
  assert.deepEqual(statuses(state.closes[0]).slice(0, 3), [['bom', 'done'], ['market', 'done'], ['ops', 'skipped']]);
  state.latest = { kind: 'full', phases: state.closes[0][5] };
  state.closes.length = 0;
  state.botCalls.length = 0;
  await request();
  assert.deepEqual(state.opened[1].phases, ['ops', 'compute', 'narrate'], 'the run starts at ops');
  assert.deepEqual(state.botCalls, ['ops']);
  assert.deepEqual(statuses(state.closes[0]), [['ops', 'done'], ['compute', 'done'], ['narrate', 'skipped']]);
  assert.deepEqual(state.refused, []);
});

test('a run an earlier request left running is closed as interrupted before a new one opens', async () => {
  reset();
  state.runs = [{ id: 'stale', status: 'running', phases: [
    { name: 'bom', agentId: 'bom-bot', status: 'running', durationMs: 0, error: null },
    { name: 'compute', agentId: null, status: 'pending', durationMs: null, error: null }] }];
  await request();
  const stale = state.closes.find((close) => close[3] === 'stale');
  assert.ok(stale, 'the stale run is closed');
  assert.equal(stale[4], 'failed');
  assert.match(stale[6], /interrupted: the request that ran it ended before it recorded a result/);
  assert.deepEqual(statuses(stale), [['bom', 'failed'], ['compute', 'failed']]);
});

/** A run row as listRuns returns it, from what the abandoned drive last recorded. */
function storedRun(id, startedAt, phases) {
  return { id, ventureId: 'v1', status: 'running', startedAt: new Date(startedAt).toISOString(), phases };
}

test('a run whose request was abandoned mid-call is read as interrupted once it is past the request deadline', async () => {
  reset();
  let answer;
  state.bomSeconds = 0;
  const gate = new Promise((resolve) => { answer = resolve; });
  const authorBom = STUBS['./venture-bots'].authorBom;
  STUBS['./venture-bots'].authorBom = async () => { host('bot_turn'); state.botCalls.push('bom'); await gate; return { text: CUT_OFF, costUsd: 0 }; };
  try {
    const startedAt = Date.now();
    const pending = Run.startRun(ctx, 'alice', 'v1', 'full', undefined, '2026-10-11');
    while (!state.botCalls.length) await new Promise((resolve) => setImmediate(resolve));
    state.open = false; // the page closed: the kernel dropped the request and refuses its later host calls
    answer();
    await pending.catch(() => {});
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.ok(state.refused.length > 0, 'the drive could record nothing after its request was dropped');
    assert.equal(state.closes.length, 0, 'so the run is still running in the store');
    assert.equal(Run.inFlightRun('v1'), null, 'and nothing in this process drives it any more');
    // What the store holds: the last progress write the request made before it was dropped ('bom' running).
    const names = state.opened[0].phases;
    const stored = storedRun('run-1', startedAt, names.map((name) => ({ name, agentId: name === 'compute' ? null : `${name}-bot`,
      status: name === 'bom' ? 'running' : 'pending', durationMs: null, error: null })));

    const early = Run.presentRun(stored, startedAt + 30_000);
    assert.equal(early, stored, 'inside the request deadline it may still be driven');
    const late = Run.presentRun(stored, startedAt + Run.NATIVE_REQUEST_MS + Run.ABANDONED_MARGIN_MS);
    assert.equal(late.status, 'failed');
    assert.equal(late.error, Run.ABANDONED_REASON);
    assert.match(late.error, /Press Run the analysts again/);
    assert.deepEqual(late.phases.map((x) => [x.name, x.status]), [
      ['bom', 'failed'], ['market', 'failed'], ['ops', 'failed'], ['compute', 'failed'], ['narrate', 'failed']]);
    assert.deepEqual([late.phases[0].error, late.phases[1].error], ['interrupted before it recorded a result', 'not run']);
    assert.equal(stored.status, 'running', 'the stored row is not mutated by a read');
    assert.equal(state.closes.length, 0, 'a read writes nothing: the kernel refuses SQL mutations on a read request');
  } finally {
    STUBS['./venture-bots'].authorBom = authorBom;
  }
});

test('a read presents a fresh run, a run this process drives and every run off the native kernel as stored', async () => {
  reset();
  const phase = [{ name: 'bom', agentId: 'bom-bot', status: 'running', durationMs: 0, error: null }];
  const fresh = storedRun('fresh', Date.now() - 20_000, phase);
  assert.equal(Run.presentRun(fresh), fresh, 'a run inside its request deadline');
  const old = storedRun('old', Date.now() - 10 * 60_000, phase);
  process.env.OSHAL_EGRESS = '';
  try {
    assert.equal(Run.presentRun(old), old, 'off native a run is driven detached for minutes');
  } finally {
    process.env.OSHAL_EGRESS = 'kernel';
  }
  assert.equal(Run.presentRun(old).status, 'failed', 'the same old run on native was abandoned');
  assert.equal(Run.presentRun({ ...old, status: 'done' }).status, 'done', 'a closed run is shown as stored');
});

/** Two native requests: a first run whose latest phases are given, then the run that follows it. */
async function after(phases) {
  reset();
  state.bomText = '{"bom_lines": [], "vendor_candidates": []}';
  state.bomSeconds = 2;
  state.latest = { kind: 'full', phases };
  await request();
  return state.opened[0].phases;
}

const phase = (name, status, error = null) => ({ name, agentId: `${name}-bot`, status, durationMs: 1, error });

test('Run continues from an analyst that failed or left an input unsupplied, and starts over only after a clean cycle', async () => {
  assert.deepEqual(await after([phase('market', 'failed', 'market analyst reply unusable: x'), phase('ops', 'skipped', `${Run.DEFERRED}x`)]),
    ['market', 'ops', 'compute', 'narrate'], 'a failed analyst is run again, not the whole plan');
  assert.deepEqual(await after([phase('bom', 'done'), phase('market', 'done', `${Run.GAP}baseDemandUnits: not supplied`), phase('ops', 'done')]),
    ['market', 'ops', 'compute', 'narrate'], 'an analyst that left an input unsupplied is run again');
  assert.deepEqual(await after([phase('ops', 'done'), { name: 'compute', agentId: null, status: 'done', durationMs: 1, error: null },
    phase('narrate', 'skipped', `${Run.DEFERRED}documents`)]), ['bom', 'market', 'ops', 'compute', 'narrate'],
  'a clean cycle (narration is per document) starts a new run');
});

test('a market reply that leaves a required slot empty finishes with that slot named on the phase and the run', async () => {
  reset();
  state.bomText = '{"bom_lines": [], "vendor_candidates": []}';
  state.bomSeconds = 2;
  state.marketText = '{"assumptions": []}';
  await request();
  const market = state.closes[0][5].find((x) => x.name === 'market');
  assert.equal(market.status, 'done');
  assert.match(market.error, new RegExp(`^${Run.GAP}baseDemandUnits: not supplied; retailPriceUsd: not supplied`));
  assert.match(state.closes[0][6], /market: did not supply: baseDemandUnits/);
  assert.equal(Run.needsAnotherRun(market), true);
});

test('a native full run stores every document rendered from the computed numbers, with no narration call', async () => {
  reset();
  state.bomText = '{"bom_lines": [], "vendor_candidates": []}';
  state.bomSeconds = 2;
  await request();
  assert.deepEqual(state.documents.map((d) => [d.docKey, d.proseStatus, d.modelId]), [['one-pager', 'none', 'model-1'], ['pitch', 'none', 'model-1']]);
  assert.deepEqual(state.batches, [2], 'every document in one write, not one write per document');
  assert.equal(state.botCalls.includes('narrate'), false, 'rendering the computed sections spends nothing');
  const narrate = state.closes[0][5].find((x) => x.name === 'narrate');
  assert.equal(narrate.status, 'skipped');
  assert.match(narrate.error, /documents were rendered from the computed numbers; open one and press Regenerate prose/);
  assert.deepEqual(state.refused, []);
});

test('with too little of the request left after the analyst, the documents are left as they were and the phase says why', async () => {
  reset();
  state.bomText = '{"bom_lines": [], "vendor_candidates": []}';
  state.bomSeconds = 2;
  await request();
  state.latest = { kind: 'full', phases: state.closes[0][5] };
  Object.assign(state, { closes: [], botCalls: [], documents: [], batches: [] });
  state.opsSeconds = 50; // the ops analyst answered 50 s into its request (live: 16 s on an idle host, more under load)
  await request();
  assert.deepEqual(state.botCalls, ['ops']);
  assert.deepEqual(state.batches, [], 'no document write is started that the request cannot finish');
  const narrate = state.closes[0][5].find((x) => x.name === 'narrate');
  assert.equal(narrate.status, 'skipped');
  assert.equal(narrate.error, Run.DOCUMENTS_LATE);
  assert.match(narrate.error, /keep the numbers they were rendered from and say so/);
  assert.equal(state.closes[0][4], 'done', 'the run closes inside its request with the model computed');
  assert.deepEqual(state.refused, []);
  assert.ok(Run.NATIVE_REQUEST_MS - 50_000 < Run.NATIVE_DOCUMENTS_RESERVE_MS);
});

test('a BOM reply that does not parse is asked for once more, strictly, and the run goes on with it (sweep 10)', async () => {
  reset();
  state.bomSeconds = 15; // live: 1,070 tokens in 15.3 s that did not parse
  state.bomTexts = ['Here is the bill of materials you asked for: lid, gasket and hinge.', '{"bom_lines": [], "vendor_candidates": []}'];
  await request();
  assert.deepEqual(state.botCalls, ['bom', 'bom'], 'one retry, no more');
  assert.deepEqual(state.bomStrict, [false, true], 'the retry asks for the JSON object alone');
  assert.deepEqual(statuses(state.closes[0])[0], ['bom', 'done']);
  assert.deepEqual(state.refused, []);
});

test('a slow unusable reply leaves no room for a retry and fails with the parser\'s reason; a cut-off one is never retried', async () => {
  reset();
  state.bomSeconds = 30;
  state.bomText = 'I cannot estimate costs for this idea.';
  await request();
  assert.deepEqual(state.botCalls, ['bom'], 'a second 30 s reply plus the documents reserve does not fit the request');
  assert.match(state.closes[0][5][0].error, /^BOM analyst reply unusable: /);
  reset();
  state.bomSeconds = 2;
  await request();
  assert.equal(state.botCalls.filter((call) => call === 'bom').length, 1, 'a reply cut off at the output limit would be cut off again');
  assert.match(state.closes[0][5][0].error, /cut off before its JSON closed/);
});

const CHECK_NOTE = '*Check: the computed model does not reach break-even within the horizon.*';

test('Regenerate prose gives the strategist break-even as computed and keeps a claim with the visible check note', async () => {
  reset();
  const claim = 'The $250,000 raise would cover the {{fig:cash.peakNeedMicros}} cash deficit before the venture reaches break-even. '
    + 'Demand rests on estimates.\n\nWithout a cheaper lid the plan never breaks even.';
  state.narrateText = JSON.stringify({ sections: { summary: claim } });
  await request('narrate');
  assert.deepEqual(state.botCalls, ['narrate', 'narrate'], 'one narration per document');
  const [, , , notReachable, breakEven] = state.narrateArgs[0];
  assert.deepEqual(notReachable, [], 'break-even is stated as computed, not as a NOT REACHABLE figure');
  assert.deepEqual(breakEven, ['Break-even is NOT reached within the plan horizon.',
    'At the planned run size, cumulative net income does NOT turn non-negative within the plan horizon.',
    'No run size in this model breaks even within the plan horizon.']);
  assert.equal(state.documents.length, 2);
  for (const doc of state.documents) assert.equal(JSON.parse(doc.bodyMd).summary, `${claim}\n\n${CHECK_NOTE}`, 'kept as written, note attached');
  assert.deepEqual(state.refused, []);
});

test('Regenerate prose stores the conditions for breaking even exactly as written, with no note', async () => {
  const conditions = 'To break even within the horizon, the landed cost would have to fall to $2.10 per lid. Demand would need to '
    + 'triple for the plan to reach break-even. Pricing above $14 is the main lever.';
  reset();
  state.narrateText = JSON.stringify({ sections: { summary: conditions } });
  await request('narrate');
  assert.equal(state.documents.length, 2);
  for (const doc of state.documents) assert.equal(JSON.parse(doc.bodyMd).summary, conditions, 'every condition is stored');
  reset();
  state.narrateText = JSON.stringify({ sections: { summary: 'The plan breaks even in month 14.' } });
  await request('narrate');
  for (const doc of state.documents) {
    assert.equal(JSON.parse(doc.bodyMd).summary, `The plan breaks even in month 14.\n\n${CHECK_NOTE}`, 'a claim-only section is kept');
  }
  assert.deepEqual(state.refused, []);
});
