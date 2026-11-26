/**
 * Venture Plan — side-by-side scenario compare guards (pure engine + HTTP route).
 *
 * Tests run against the COMPILED modules in routes/ (`venture-compare.js`,
 * `venture-model.js`, `venture-routes.js`) — the exact bytes the kernel loads.
 *
 * Covers:
 * - Pure engine: exact integer micro-currency & basis-point metrics and deltas
 *   checked against independent `buildVentureModel` runs, baseline switching
 *   symmetry (delta(B, A) === -delta(A, B)), provenance posture & weakest
 *   confidence, assumption value + confidence diff detection, scenario lever
 *   diff detection, deduplication, 2..10 cardinality bounds, unknown/foreign id
 *   refusals, byte-identical determinism, and zero input mutation.
 * - HTTP route (`GET /ventures/:id/scenarios/compare`): anonymous 401 before DB,
 *   foreign venture 404, foreign/unknown scenario id 404 without leaking, `< 2`
 *   and `> 10` refusals (400), omitted `ids` auto-selecting up to 10 scenarios,
 *   explicit `baseline` switching, and strictly zero bot calls / zero DB writes.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial guards for 1.5.5 side-by-side scenario compare (pure engine + owner-scoped HTTP route).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { PKG, D, engine, ventureInput } = require('./fixture-venture');

const C = engine('venture-compare');
const M = engine('venture-model');
const P = engine('venture-primitives');

/* ── 1. Pure engine tests ────────────────────────────────────────────────── */

test('compareScenarios matches independent buildVentureModel runs to the exact micro and bps', () => {
  const baseInput = ventureInput();
  const higherPriceInput = ventureInput({ pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(89.99) } });
  const higherFreightInput = M.withAssumption(ventureInput(), 'freight.container.rate', D(5000));

  const mBase = M.buildVentureModel(baseInput);
  const mPrice = M.buildVentureModel(higherPriceInput);
  const mFreight = M.buildVentureModel(higherFreightInput);

  const cmp = C.compareScenarios([
    { scenarioId: 'sc-base', name: 'Base ($79.99)', isBase: true, input: baseInput },
    { scenarioId: 'sc-price', name: 'Premium ($89.99)', isBase: false, input: higherPriceInput },
    { scenarioId: 'sc-freight', name: 'High Freight ($5k)', isBase: false, input: higherFreightInput },
  ], 'sc-base');

  assert.equal(cmp.baselineScenarioId, 'sc-base');
  assert.equal(cmp.scenarioCount, 3);
  assert.equal(cmp.scenarios.length, 3);

  const sBase = cmp.scenarios[0];
  const sPrice = cmp.scenarios[1];
  const sFreight = cmp.scenarios[2];

  // Baseline flags & zero baseline deltas.
  assert.equal(sBase.isBaseline, true);
  assert.equal(sPrice.isBaseline, false);
  assert.equal(sFreight.isBaseline, false);
  for (const [k, v] of Object.entries(sBase.deltas)) {
    if (v !== null) assert.equal(v, 0, `baseline delta for ${k} must be 0`);
  }

  // Exact integer figures match independent engine builds.
  assert.equal(sBase.metrics.landedUnitMicros, mBase.landed.buyerUnitMicros);
  assert.equal(sBase.metrics.revenueMicros, mBase.financials.totals.revenueMicros);
  assert.equal(sBase.metrics.netIncomeMicros, mBase.financials.totals.netIncomeMicros);
  assert.equal(sBase.metrics.cashTroughMicros, mBase.financials.peakCash.troughMicros);
  assert.equal(sBase.metrics.fundingRequiredMicros, mBase.financials.peakCash.fundingRequiredMicros);
  assert.equal(sBase.metrics.breakEvenUnits, mBase.breakEven.units);

  // Hand-checked gross margin bps = roundHalfUp((sum(grossProfitMicros) * 10000) / revenueMicros).
  const baseGrossProfit = mBase.financials.pnl.reduce((acc, r) => acc + r.grossProfitMicros, 0);
  const expectedBaseGrossBps = P.bpsOf(baseGrossProfit, mBase.financials.totals.revenueMicros);
  assert.equal(sBase.metrics.grossMarginBps, expectedBaseGrossBps);
  assert.ok(Number.isInteger(sBase.metrics.grossMarginBps), 'grossMarginBps is an integer');

  // Exact integer deltas: Premium ($89.99) lifts revenue and net income over Base ($79.99).
  assert.equal(sPrice.deltas.revenueMicros, mPrice.financials.totals.revenueMicros - mBase.financials.totals.revenueMicros);
  assert.equal(sPrice.deltas.netIncomeMicros, mPrice.financials.totals.netIncomeMicros - mBase.financials.totals.netIncomeMicros);
  assert.ok(sPrice.deltas.revenueMicros > 0, 'higher price raises revenue');
  assert.ok(sPrice.deltas.netIncomeMicros > 0, 'higher price raises net income');
  assert.equal(sPrice.deltas.landedUnitMicros, 0, 'shelf price does not change landed cost');

  // High Freight ($5k vs $3k container) raises landed cost by $6,000 across 3 containers / 1,000 units = +$6.00/unit + insurance/duty effects.
  assert.equal(sFreight.deltas.landedUnitMicros, mFreight.landed.buyerUnitMicros - mBase.landed.buyerUnitMicros);
  assert.ok(sFreight.deltas.landedUnitMicros >= D(6), '3 containers x +$2,000 / 1,000 units is at least +$6.00/unit landed');
  assert.ok(sFreight.deltas.netIncomeMicros < 0, 'higher freight lowers net income');

  // Every numeric metric & delta is a safe integer (no floats in financial math).
  for (const sc of cmp.scenarios) {
    for (const [k, v] of Object.entries(sc.metrics)) {
      if (typeof v === 'number') assert.ok(Number.isSafeInteger(v), `${sc.scenarioId}.metrics.${k}=${v} must be integer`);
    }
    for (const [k, v] of Object.entries(sc.deltas)) {
      if (typeof v === 'number') assert.ok(Number.isSafeInteger(v), `${sc.scenarioId}.deltas.${k}=${v} must be integer`);
    }
  }

  // Provenance posture rolls up honestly from the engine.
  assert.equal(sBase.provenance.canPublish, mBase.canPublish);
  assert.equal(sBase.provenance.posture, 'estimate');
  assert.equal(sBase.provenance.weakestConfidence, 'guessed');
  assert.equal(sBase.provenance.unsourcedFigureCount, 0);
  assert.ok(sBase.provenance.estimatedOrGuessedCount >= 1);

  // Differing assumptions & levers surface both retail price lever and freight assumption.
  const diffKeys = cmp.assumptionDiffs.map((d) => d.key);
  assert.ok(diffKeys.includes('@scenario.retailPriceMicros'), 'shelf price lever diff surfaced');
  assert.ok(diffKeys.includes('freight.container.rate'), 'freight rate assumption diff surfaced');
  const freightDiff = cmp.assumptionDiffs.find((d) => d.key === 'freight.container.rate');
  assert.equal(freightDiff.valueDiffers, true);
  assert.equal(freightDiff.confidenceDiffers, false);
  assert.equal(freightDiff.byScenario['sc-base'].value, D(3000));
  assert.equal(freightDiff.byScenario['sc-freight'].value, D(5000));
  assert.equal(freightDiff.byScenario['sc-freight'].deltaFromBaseline, D(2000));
});

test('switching baseline inverts deltas symmetrically and flags confidence-only assumption diffs', () => {
  const inputA = ventureInput();
  const inputB = ventureInput({ runQtyUnits: 1500 });
  // Upgrade freight confidence in B while keeping value identical to test confidenceDiffers.
  inputB.ledger.byId['freight.container.rate'] = {
    ...inputB.ledger.byId['freight.container.rate'],
    confidence: 'quoted',
    source: { kind: 'vendor-quote', vendor: 'OceanCo', quoteRef: 'Q-99', quotedOn: '2026-08-01' },
  };

  const cmpA = C.compareScenarios([
    { scenarioId: 'a', name: 'Run 1000', isBase: true, input: inputA },
    { scenarioId: 'b', name: 'Run 1500', isBase: false, input: inputB },
  ], 'a');
  const cmpB = C.compareScenarios([
    { scenarioId: 'a', name: 'Run 1000', isBase: true, input: inputA },
    { scenarioId: 'b', name: 'Run 1500', isBase: false, input: inputB },
  ], 'b');

  assert.equal(cmpA.scenarios[1].deltas.netIncomeMicros, -cmpB.scenarios[0].deltas.netIncomeMicros);
  assert.equal(cmpA.scenarios[1].deltas.landedUnitMicros, -cmpB.scenarios[0].deltas.landedUnitMicros);
  assert.equal(cmpA.scenarios[1].deltas.grossMarginBps, -cmpB.scenarios[0].deltas.grossMarginBps);

  // Run quantity lever diff + confidence-only diff on freight.container.rate both surfaced.
  const runDiff = cmpA.assumptionDiffs.find((d) => d.key === '@scenario.runQtyUnits');
  assert.ok(runDiff);
  assert.equal(runDiff.byScenario.a.value, 1000);
  assert.equal(runDiff.byScenario.b.value, 1500);
  assert.equal(runDiff.byScenario.b.deltaFromBaseline, 500);

  const freightConf = cmpA.assumptionDiffs.find((d) => d.key === 'freight.container.rate');
  assert.ok(freightConf, 'confidence-only difference is surfaced');
  assert.equal(freightConf.valueDiffers, false);
  assert.equal(freightConf.confidenceDiffers, true);
  assert.equal(freightConf.byScenario.a.confidence, 'benchmarked');
  assert.equal(freightConf.byScenario.b.confidence, 'quoted');
});

test('selectScenariosForCompare deduplicates, bounds 2..10, and refuses unknown/foreign ids cleanly', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `s${i + 1}`, name: `Scenario ${i + 1}` }));

  // Omitted ids selects up to 10, defaulting baseline to first.
  const auto = C.selectScenariosForCompare(many, [], null);
  assert.equal(auto.selected.length, 10);
  assert.equal(auto.baselineId, 's1');

  // Deduplicates preserving order.
  const deduped = C.selectScenariosForCompare(many, ['s3', 's1', 's3', 's2'], 's2');
  assert.deepEqual(deduped.selected.map((s) => s.id), ['s3', 's1', 's2']);
  assert.equal(deduped.baselineId, 's2');

  // Fewer than 2 distinct scenarios refused.
  assert.throws(
    () => C.selectScenariosForCompare(many, ['s1', 's1'], null),
    (e) => e instanceof C.ScenarioCompareError && e.code === 'compare_too_few_scenarios',
  );
  assert.throws(
    () => C.selectScenariosForCompare([{ id: 's1' }], [], null),
    (e) => e instanceof C.ScenarioCompareError && e.code === 'compare_too_few_scenarios',
  );

  // More than 10 distinct scenarios refused.
  assert.throws(
    () => C.selectScenariosForCompare(many, many.slice(0, 11).map((s) => s.id), null),
    (e) => e instanceof C.ScenarioCompareError && e.code === 'compare_too_many_scenarios',
  );

  // Unknown / foreign scenario id refused with compare_scenario_not_found (even when only 1 id passed).
  assert.throws(
    () => C.selectScenariosForCompare(many, ['foreign-id'], null),
    (e) => e instanceof C.ScenarioCompareError && e.code === 'compare_scenario_not_found',
  );
  assert.throws(
    () => C.selectScenariosForCompare(many, ['s1', 's2'], 'foreign-baseline'),
    (e) => e instanceof C.ScenarioCompareError && e.code === 'compare_scenario_not_found',
  );

  // Owned baseline not in selected set refused with compare_baseline_not_found.
  assert.throws(
    () => C.selectScenariosForCompare(many, ['s1', 's2'], 's3'),
    (e) => e instanceof C.ScenarioCompareError && e.code === 'compare_baseline_not_found',
  );
});

test('compareScenarios is byte-identical deterministic and never mutates its inputs', () => {
  const a = ventureInput();
  const b = ventureInput({ pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(89.99) } });
  const snapA = JSON.stringify(a);
  const snapB = JSON.stringify(b);
  const r1 = C.compareScenarios([
    { scenarioId: 'a', name: 'A', isBase: true, input: a },
    { scenarioId: 'b', name: 'B', isBase: false, input: b },
  ]);
  const r2 = C.compareScenarios([
    { scenarioId: 'a', name: 'A', isBase: true, input: a },
    { scenarioId: 'b', name: 'B', isBase: false, input: b },
  ]);
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
  assert.equal(JSON.stringify(a), snapA);
  assert.equal(JSON.stringify(b), snapB);
});

/* ── 2. HTTP route + owner isolation + zero-bot-call tests ───────────────── */

function loadRoutesWithStubs() {
  const botCalls = [];
  function fakeRouter() {
    const routes = new Map();
    const reg = (m) => (p, h) => { routes.set(`${m} ${p}`, h); };
    return { routes, get: reg('get'), post: reg('post'), patch: reg('patch'), put: reg('put'), delete: reg('delete') };
  }
  const stubs = {
    express: { Router: () => fakeRouter() },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/app/routes/caller-sub': { callerSub: (req) => (req && req.oidc && req.oidc.user && req.oidc.user.sub) || null },
    '@/features/agent-management': { BotNodeClient: class { hasEndpoint() { return false; } }, createRegistryEndpointResolver: () => ({}) },
    '@/app/routes/inline-bot-execution': {
      executeBotOrInline: async (_ctx, _c, agentId, req) => {
        botCalls.push({ agentId, userSub: req.userSub });
        return { success: true, response: '{}', cost: 0.01, model: 'stub', usage: {} };
      },
    },
  };
  const orig = Module._load;
  Module._load = function load(req, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, req)) return stubs[req];
    return orig.call(this, req, ...rest);
  };
  try {
    delete require.cache[require.resolve(path.join(PKG, 'routes', 'venture-routes.js'))];
    const { createVentureRoutes } = require(path.join(PKG, 'routes', 'venture-routes.js'));
    return { createVentureRoutes, botCalls };
  } finally {
    Module._load = orig;
  }
}

function makeHttpPool(ownerSub, scenarioRows, assumptionRows) {
  const calls = [];
  const venture = {
    id: 'v1', owner_sub: ownerSub, name: 'Desk Lamp', idea_text: 'An aluminum desk lamp for makers.',
    spec: {}, currency: 'USD', target_launch_date: null, stage: 'modelled', horizon_months: 24,
    open_questions: [], created_at: new Date(0), updated_at: new Date(0),
  };
  const query = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (/FROM venture_ventures/.test(text)) {
      return params.includes(ownerSub) && params.includes('v1') ? { rows: [venture], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/FROM venture_scenarios/.test(text)) {
      return params.includes(ownerSub) ? { rows: scenarioRows, rowCount: scenarioRows.length } : { rows: [], rowCount: 0 };
    }
    if (/FROM venture_assumptions/.test(text)) {
      return params.includes(ownerSub) ? { rows: assumptionRows, rowCount: assumptionRows.length } : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  };
  return { calls, query, connect: async () => ({ query, release() {} }) };
}

function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (o) => { r.body = o; return r; };
  return r;
}

const SAMPLE_ASSUMPTIONS = [
  { id: 'a1', venture_id: 'v1', owner_sub: 'alice', key: 'bom.final-assembly.cost', domain: 'manufacturing', label: 'Final assembly', unit: 'micros', value_num: D(12), value_text: null, low_num: D(10), high_num: D(15), source_kind: 'user-entered', source_detail: 'Quote', source_url: null, confidence: 'high', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
  { id: 'a2', venture_id: 'v1', owner_sub: 'alice', key: 'landed.freight.container-rate', domain: 'logistics', label: 'Container freight', unit: 'micros', value_num: D(4000), value_text: null, low_num: D(3000), high_num: D(6000), source_kind: 'published-source', source_detail: 'Index', source_url: null, confidence: 'medium', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
  { id: 'a3', venture_id: 'v1', owner_sub: 'alice', key: 'landed.freight.units-per-container', domain: 'logistics', label: 'Units per container', unit: 'units', value_num: 500, value_text: null, low_num: 400, high_num: 600, source_kind: 'user-entered', source_detail: 'Packout', source_url: null, confidence: 'high', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
  { id: 'a4', venture_id: 'v1', owner_sub: 'alice', key: 'landed.freight.cbm-per-unit', domain: 'logistics', label: 'CBM per unit', unit: 'cbm', value_num: 0.04, value_text: null, low_num: 0.03, high_num: 0.05, source_kind: 'user-entered', source_detail: 'Packout', source_url: null, confidence: 'high', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
  { id: 'a5', venture_id: 'v1', owner_sub: 'alice', key: 'landed.duty.hts-rate', domain: 'logistics', label: 'HTS duty rate', unit: 'bps', value_num: 500, value_text: null, low_num: 200, high_num: 1500, source_kind: 'published-source', source_detail: 'USITC', source_url: null, confidence: 'medium', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
  { id: 'a6', venture_id: 'v1', owner_sub: 'alice', key: 'channel.dtc.terms', domain: 'channel', label: 'DTC order cost', unit: 'micros', value_num: D(14), value_text: null, low_num: D(10), high_num: D(18), source_kind: 'model-estimate', source_detail: 'Estimate', source_url: null, confidence: 'medium', authored_by: 'b7000000-0000-0000-0000-000000000003', run_id: null, superseded_by: null, created_at: new Date(0) },
  { id: 'a7', venture_id: 'v1', owner_sub: 'alice', key: 'channel.retail-price', domain: 'channel', label: 'Retail price', unit: 'micros', value_num: D(79), value_text: null, low_num: D(69), high_num: D(99), source_kind: 'user-entered', source_detail: 'Target', source_url: null, confidence: 'high', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
  { id: 'a8', venture_id: 'v1', owner_sub: 'alice', key: 'market.demand.base-units', domain: 'market', label: 'Base demand', unit: 'units', value_num: 3000, value_text: null, low_num: 1500, high_num: 5000, source_kind: 'model-estimate', source_detail: 'Estimate', source_url: null, confidence: 'medium', authored_by: 'b7000000-0000-0000-0000-000000000003', run_id: null, superseded_by: null, created_at: new Date(0) },
  { id: 'a9', venture_id: 'v1', owner_sub: 'alice', key: 'season.sell-through', domain: 'schedule', label: 'Season sell-through', unit: 'ratio', value_num: 0.9, value_text: null, low_num: 0.7, high_num: 1.0, source_kind: 'model-estimate', source_detail: 'Estimate', source_url: null, confidence: 'medium', authored_by: 'b7000000-0000-0000-0000-000000000003', run_id: null, superseded_by: null, created_at: new Date(0) },
];

const SAMPLE_SCENARIOS = [
  { id: 'sc-1', venture_id: 'v1', owner_sub: 'alice', name: 'Base case', overrides: {}, volume_units: 3000, retail_price_micros: D(79), channel_mix: {}, is_base: true, created_at: new Date(0) },
  { id: 'sc-2', venture_id: 'v1', owner_sub: 'alice', name: 'Higher price + tariff shock', overrides: { 'landed.duty.hts-rate': 1500 }, volume_units: 3000, retail_price_micros: D(95), channel_mix: {}, is_base: false, created_at: new Date(1000) },
];

test('GET /ventures/:id/scenarios/compare enforces auth, owner isolation, zero writes, zero bot calls, and exact deltas', async () => {
  const { createVentureRoutes, botCalls } = loadRoutesWithStubs();
  const pool = makeHttpPool('alice', SAMPLE_SCENARIOS, SAMPLE_ASSUMPTIONS);
  const handler = createVentureRoutes({ pool, appPackageDir: PKG, orchestrator: {} }).routes.get('get /ventures/:id/scenarios/compare');
  assert.ok(handler, 'GET /ventures/:id/scenarios/compare must be registered');

  // 1. Anonymous caller gets 401 before touching pool.
  const anon = makeRes();
  await handler({ params: { id: 'v1' }, query: {}, body: {} }, anon);
  assert.equal(anon.statusCode, 401);
  assert.equal(pool.calls.length, 0);

  // 2. Foreign owner gets 404 without leaking existence.
  const foreign = makeRes();
  await handler({ params: { id: 'v1' }, query: { ids: 'sc-1,sc-2' }, body: {}, oidc: { user: { sub: 'mallory' } } }, foreign);
  assert.equal(foreign.statusCode, 404);
  assert.equal(botCalls.length, 0);

  // 3. Owned venture with omitted ids compares all saved scenarios (default baseline = sc-1).
  const ok = makeRes();
  await handler({ params: { id: 'v1' }, query: { onDate: '2026-08-01' }, body: {}, oidc: { user: { sub: 'alice' } } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.ventureId, 'v1');
  assert.equal(ok.body.baselineScenarioId, 'sc-1');
  assert.equal(ok.body.scenarioCount, 2);
  assert.equal(ok.body.scenarios[1].deltas.shelfPriceMicros, D(16));
  assert.ok(ok.body.scenarios[1].deltas.landedUnitMicros > 0, '15% tariff increases landed cost');
  assert.ok(ok.body.assumptionDiffs.some((d) => d.key === 'landed.duty.hts-rate'));
  assert.ok(ok.body.assumptionDiffs.some((d) => d.key === '@scenario.retailPriceMicros'));
  assert.equal(botCalls.length, 0, 'scenario compare never calls a bot');
  assert.equal(pool.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0, 'scenario compare is strictly read-only');

  // 4. Foreign/unknown scenario id returns 404.
  const badId = makeRes();
  await handler({ params: { id: 'v1' }, query: { ids: 'sc-1,foreign-sc' }, body: {}, oidc: { user: { sub: 'alice' } } }, badId);
  assert.equal(badId.statusCode, 404);
  assert.equal(badId.body.error, 'compare_scenario_not_found');

  // 5. Fewer than 2 distinct ids returns 400.
  const tooFew = makeRes();
  await handler({ params: { id: 'v1' }, query: { ids: 'sc-1,sc-1' }, body: {}, oidc: { user: { sub: 'alice' } } }, tooFew);
  assert.equal(tooFew.statusCode, 400);
  assert.equal(tooFew.body.error, 'compare_too_few_scenarios');

  // 6. Switching baseline query param swaps baseline cleanly.
  const swapped = makeRes();
  await handler({ params: { id: 'v1' }, query: { ids: 'sc-1,sc-2', baseline: 'sc-2', onDate: '2026-08-01' }, body: {}, oidc: { user: { sub: 'alice' } } }, swapped);
  assert.equal(swapped.statusCode, 200);
  assert.equal(swapped.body.baselineScenarioId, 'sc-2');
  assert.equal(swapped.body.scenarios[0].deltas.shelfPriceMicros, -D(16));
});
