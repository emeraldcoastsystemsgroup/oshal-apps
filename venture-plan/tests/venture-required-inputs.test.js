/**
 * Venture Plan - after the analysts run, every input the model names is registered and the plan traces.
 *
 * Live (2026-10-12) bom, market and ops all completed and the model still refused with model:traceability on
 * bom.final-assembly.cost, channel.dtc.terms, landed.duty.hts-rate, landed.freight.container-rate,
 * market.demand.base-units, season.sell-through and two org.<id>.cost keys: the analysts named their own keys
 * ("demand.units.base", "logistics.ocean.container-cost" in "usd"), and nothing registered the rest. This suite
 * takes fixture analyst replies in the contract the prompts now state, turns them into stored assumption rows
 * through the package's own parsers and phase helpers, and composes and builds the REAL model from them: no input
 * is missing, no figure is unsourced, and a registered freight, duty, demand, price and assembly value is the
 * number the model computes with. The prompts name every slot, and a slot left empty is named, never invented.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fixture analyst outputs register every input the model names; the composed model traces with no unsourced figure and computes with the registered values; prompts carry the slots; an empty or out-of-range slot is named.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The ops fixture fills the container-fill slots; the registered order cost, units per container and CBM per unit are what the composed input computes with, and a slot list without them names them.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | One range for the shipped volume per unit: a registered 0.00005 CBM (which the slot accepts) is what the freight computes with, the slot's bounds are CBM_PER_UNIT_BOUNDS, a smaller value is named out of range, and compose clamps to the same upper bound.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async (_c, _b, agentId, request) => { prompts.push({ agentId, text: request.text }); return { response: '{}', cost: 0 }; } },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
};
const prompts = [];
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const required = require(path.join(PKG, 'routes', 'venture-required-inputs.js'));
const contracts = require(path.join(PKG, 'routes', 'venture-bot-contracts.js'));
const compose = require(path.join(PKG, 'routes', 'venture-store-compose.js'));
const { buildVentureModel } = require(path.join(PKG, 'routes', 'venture-model.js'));
const bots = require(path.join(PKG, 'routes', 'venture-bots.js'));
const quiet = new Proxy({}, { get: () => async () => ({}) });
const run = (() => {
  const saved = Module._load;
  Module._load = function load(request, ...rest) {
    if (request.startsWith('./venture-store') || request === './venture-rebaseline') return quiet;
    return saved.call(this, request, ...rest);
  };
  try { return require(path.join(PKG, 'routes', 'venture-run.js')); } finally { Module._load = saved; }
})();
Module._load = originalLoad;

const slot = (value, low, high, basis) => ({ value, low, high, confidence: 'medium', basis, sourceUrl: null });

/** A market reply in the stated contract: free-form rows plus every required slot. */
const MARKET_REPLY = JSON.stringify({
  assumptions: [{ key: 'channel.amazon.referral', domain: 'channel', label: 'Referral fee', unit: 'bps', valueNum: 1500,
    lowNum: 800, highNum: 1500, sourceKind: 'model-estimate', sourceDetail: 'marketplace schedule', sourceUrl: null, confidence: 'medium' }],
  required: {
    baseDemandUnits: slot(4000, 2500, 6000, 'comparable clip lights'), retailPriceUsd: slot(24.99, 19.99, 29.99, 'comparable listings'),
    dtcCostPerOrderUsd: slot(14.5, 10, 20, 'paid social plus postage'), seasonSellThroughPercent: slot(85, 70, 95, 'holiday gift item'),
  },
});

/** An ops reply in the stated contract, with two proposed roles. */
const OPS_REPLY = JSON.stringify({
  assumptions: [], schedule_tasks: [],
  headcount_roles: [{ role: 'Ops lead', kind: 'contractor', fte: 0.5, startMonth: 0, endMonth: null, baseSalaryMicros: 90_000_000_000, burdenBps: 0, confidence: 'low' }],
  required: {
    containerFreightUsd: slot(4500, 3500, 6500, 'Shenzhen to Long Beach spot'), htsDutyPercent: slot(3.9, 0, 3.9, '9405.40 lamps'),
    finalAssemblyCostUsd: slot(1.25, 0.8, 2, 'contract assembly'),
    unitsPerContainer: slot(2500, 2000, 3000, 'retail box 18x12x6 cm'), cbmPerUnit: slot(0.0015, 0.001, 0.002, 'retail box volume'),
  },
});

let seq = 0;
/** A stored assumption row as liveAssumptions returns it. */
function stored(input, authoredBy) {
  seq += 1;
  return { id: `a${seq}`, ventureId: 'v1', valueText: null, lowNum: null, highNum: null, sourceUrl: null, sourceDetail: null,
    ...input, authoredBy, runId: 'run-1', supersededBy: null, createdAt: '2026-10-12T00:00:00.000Z', provenance: 'assumed' };
}

const VENDOR = { id: 'vend-1', ventureId: 'v1', name: 'Shenzhen Lights', kind: 'cm', country: 'CN', moq: 1000, leadTimeDays: 45,
  qualificationDays: 30, depositBps: 3000, balanceNetDays: 30, qualified: false, sourceKind: 'model-estimate', confidence: 'medium' };
const line = (ref, micros, vendorId) => ({ id: `line-${ref}`, ventureId: 'v1', parentLineId: null, ref, partName: ref, specText: null,
  qtyPerUnit: 1, uom: 'ea', discrete: true, material: null, process: null, makeOrBuy: 'buy', unitCostMicros: micros,
  lowMicros: micros, highMicros: micros, scrapPct: 2, moq: null, leadTimeDays: 30, toolingCostMicros: 0, toolingLifeUnits: null,
  vendorId, assumptionKey: `bom.${ref}.unit-cost`, htsCode: null, dutyPct: null, sourceKind: 'model-estimate', confidence: 'medium', sortOrder: 0 });
const ROLE = { id: 'role-1', ventureId: 'v1', role: 'Ops lead', kind: 'contractor', fte: 0.5, startMonth: 0, endMonth: null,
  baseSalaryMicros: 90_000_000_000, burdenBps: 0, recruitCostMicros: 0, assumptionKey: null, sourceKind: 'model-estimate', confidence: 'low' };

/** Everything the analysts register for the fixture venture, as the phases register it. */
function registeredAfterAnalysts() {
  const bomLines = [line('housing', 4_000_000, VENDOR.id), line('led', 1_500_000, null)];
  const rows = bomLines.map((l) => stored({ key: l.assumptionKey, domain: 'manufacturing', label: l.partName, unit: 'micros',
    valueNum: l.unitCostMicros, lowNum: l.lowMicros, highNum: l.highMicros, sourceKind: 'model-estimate', confidence: 'medium' }, 'bom-bot'));
  rows.push(stored({ key: `supplier.${VENDOR.id}.terms`, domain: 'manufacturing', label: 'deposit', unit: 'bps', valueNum: 3000,
    sourceKind: 'model-estimate', confidence: 'medium' }, 'bom-bot'));
  const market = contracts.parseAssumptionOutput(MARKET_REPLY);
  assert.equal(market.ok, true);
  rows.push(...market.rows.map((r) => stored(r, 'market-bot')));
  const marketSlots = required.parseRequiredInputs(contracts.extractJsonObject(MARKET_REPLY), 'market');
  const opsSlots = required.parseRequiredInputs(contracts.extractJsonObject(OPS_REPLY), 'ops');
  assert.deepEqual([...marketSlots.missing, ...opsSlots.missing], []);
  rows.push(...marketSlots.rows.map((r) => stored(r, 'market-bot')), ...opsSlots.rows.map((r) => stored(r, 'ops-bot')));
  rows.push(...run.roleCosts([ROLE]).map((r) => stored(r, 'ops-bot')));
  return { rows, bomLines };
}

function composeFor(assumptions, bomLines) {
  return compose.composeModelInput({
    venture: { id: 'v1', ownerSub: 'alice', name: 'Clip light', ideaText: 'idea', spec: {}, currency: 'USD', horizonMonths: 36 },
    assumptions, bomLines, vendors: [VENDOR], headcount: [ROLE], scenario: null, onDate: '2026-10-12',
  });
}

test('after the analysts, every input the model names is registered and no figure is unsourced', () => {
  const { rows, bomLines } = registeredAfterAnalysts();
  const composed = composeFor(rows, bomLines);
  assert.deepEqual(composed.missingAssumptionKeys, []);
  const model = buildVentureModel(composed.input);
  assert.deepEqual(model.traceability.unsourcedFigureIds, []);
  assert.equal(model.issues.some((i) => i.where === 'model:traceability'), false, JSON.stringify(model.issues.map((i) => i.message)));
});

test('the parent failure shape: without the registered inputs the same plan names each missing key', () => {
  const { bomLines } = registeredAfterAnalysts();
  const composed = composeFor([], bomLines);
  for (const key of ['bom.final-assembly.cost', 'channel.dtc.terms', 'landed.duty.hts-rate', 'landed.freight.container-rate',
    'market.demand.base-units', 'season.sell-through', 'org.role-1.cost', 'supplier.vend-1.terms']) {
    assert.ok(composed.missingAssumptionKeys.includes(key), key);
  }
  // Every slot is an input the model names; the shelf price is the one it binds (pricing.shelfPriceMicros) rather than lists.
  for (const r of required.REQUIRED_INPUTS.filter((x) => x.key !== 'channel.retail-price')) {
    assert.ok(composed.missingAssumptionKeys.includes(r.key), `${r.key} is referenced by the model`);
  }
});

test('a registered value is the number the model computes with, in the ledger unit', () => {
  const { rows, bomLines } = registeredAfterAnalysts();
  const { input } = composeFor(rows, bomLines);
  assert.equal(input.landed.freight.containerCostMicros, 4_500_000_000);
  assert.equal(input.landed.duty.htsDutyBps, 390);
  assert.equal(input.demand.scenarios.find((s) => s.key === 'base').baselineUnits, 4000);
  assert.equal(input.pricing.shelfPriceMicros, 24_990_000);
  assert.equal(input.product.bom.priceBreaks[0].unitCostMicros, 1_250_000);
  assert.equal(input.ledger.byId['season.sell-through'].value, 0.85);
  assert.equal(input.channels[0].economics.orderCostMicros, 14_500_000, 'the registered cost per direct order');
  assert.equal(input.landed.freight.unitsPerContainer, 2500);
  assert.equal(input.landed.freight.cbmPerUnit, 0.0015, 'a volume is stored unrounded');
  const scenario = { id: 's', overrides: {}, volumeUnits: null, retailPriceMicros: 30_000_000 };
  const priced = compose.composeModelInput({ venture: { id: 'v1', name: 'x', spec: {}, horizonMonths: 36 }, assumptions: rows, bomLines,
    vendors: [VENDOR], headcount: [ROLE], scenario, onDate: '2026-10-12' });
  assert.equal(priced.input.pricing.shelfPriceMicros, 30_000_000, "a scenario's own retail price still wins");
});

test('an empty, banded-wrong or out-of-range slot is named and never registered', () => {
  const out = required.parseRequiredInputs({ required: {
    containerFreightUsd: slot(4500, 5000, 6000, 'x'), htsDutyPercent: slot(140, 100, 150, 'x'),
  } }, 'ops');
  assert.deepEqual(out.rows, []);
  assert.deepEqual(out.missing, ['containerFreightUsd: the band does not hold the value', 'htsDutyPercent: outside 0 to 100',
    'finalAssemblyCostUsd: not supplied', 'unitsPerContainer: not supplied', 'cbmPerUnit: not supplied']);
  assert.deepEqual(required.parseRequiredInputs(null, 'market').missing.length, 4);
});

test('a shipped volume per unit is accepted and computed within one range', () => {
  const { rows, bomLines } = registeredAfterAnalysts();
  const cbmRow = rows.find((r) => r.key === 'landed.freight.cbm-per-unit');
  const { input } = composeFor(rows.map((r) => (r === cbmRow ? { ...r, valueNum: 0.00005, lowNum: 0.00004, highNum: 0.00006 } : r)), bomLines);
  assert.equal(input.landed.freight.cbmPerUnit, 0.00005, 'a value the slot accepts is the value the freight computes with');
  const bounds = required.CBM_PER_UNIT_BOUNDS;
  const spec = required.REQUIRED_INPUTS.find((r) => r.slot === 'cbmPerUnit');
  assert.deepEqual([spec.min, spec.max], [bounds.min, bounds.max]);
  const tooSmall = required.parseRequiredInputs({ required: { cbmPerUnit: slot(bounds.min / 2, bounds.min / 4, bounds.min) } }, 'ops');
  assert.ok(tooSmall.missing.some((m) => m.startsWith('cbmPerUnit: outside')), tooSmall.missing.join('; '));
  const huge = composeFor(rows.map((r) => (r === cbmRow ? { ...r, valueNum: 500, lowNum: 400, highNum: 600 } : r)), bomLines);
  assert.equal(huge.input.landed.freight.cbmPerUnit, bounds.max, 'compose clamps to the same upper bound');
});

test('the market and ops prompts ask for exactly their slots', async () => {
  const SPEC = { name: 'Clip light', ideaText: 'idea', spec: {} };
  prompts.length = 0;
  await bots.authorMarket({}, {}, 'alice', SPEC);
  await bots.authorOps({}, {}, 'alice', SPEC, { lines: [] });
  for (const [i, analyst] of [[0, 'market'], [1, 'ops']]) {
    for (const r of required.REQUIRED_INPUTS) {
      assert.equal(prompts[i].text.includes(`- ${r.slot}:`), r.analyst === analyst, `${analyst} prompt and ${r.slot}`);
    }
    assert.match(prompts[i].text, /"required", an object with EXACTLY these fields/);
  }
});
