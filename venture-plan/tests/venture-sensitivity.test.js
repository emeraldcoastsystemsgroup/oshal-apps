/**
 * Guards for the sensitivity sweep and the inversions.
 *
 * THE GUARD THAT MATTERS MOST asserts the sweep genuinely REBUILDS: the rebuild
 * function is instrumented and the call count is asserted to be exactly two per
 * banded assumption. A future refactor that shortcuts the sweep with an analytic
 * approximation — a second, simpler model of the first one, which would drift the
 * moment anyone adds a fee line — goes red here rather than quietly returning a
 * plausible tornado chart.
 *
 * The second: an assumption with no stated range is EXCLUDED, not swept over an
 * invented one. Manufacturing a range would manufacture the very uncertainty the
 * chart is supposed to measure.
 *
 * Dependency-free `node --test` suite over the COMPILED module.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — the sweep's rebuild call count, unbanded exclusion, deterministic swing ordering, the exact blended maximum-affordable-landed solve checked against a forward evaluation, the factory-price inversion, minimum viable volume tied to the model's own break-even, the non-monotone verdict at a container boundary, and the impossible sell-through surface.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { engine, D, ventureInput } = require('./fixture-venture');

const M = engine('venture-model');
const Sn = engine('venture-sensitivity');
const Ch = engine('venture-channels');

const SWEPT = [
  { assumptionId: 'bom.shell.unit-cost', label: 'Shell unit cost' },
  { assumptionId: 'bom.screw.unit-cost', label: 'Fastener unit cost' },
  { assumptionId: 'freight.container.rate', label: 'Ocean rate' },
  { assumptionId: 'duty.hts.rate', label: 'Duty rate' },
  { assumptionId: 'demand.base.units', label: 'Base demand' },
  { assumptionId: 'org.contractor.rate', label: 'Contractor rate (no stated range)' },
];

/** Run a sweep with an instrumented rebuild so the call count can be asserted. */
function sweep(objective) {
  const input = ventureInput();
  const base = M.buildVentureModel(input);
  const calls = [];
  const result = Sn.sensitivitySweep({
    ledger: input.ledger, inputs: SWEPT, objective, base,
    rebuild: (ledger) => {
      calls.push(ledger);
      return M.buildVentureModel(M.withLedger(input, ledger));
    },
  });
  return { input, base, result, calls };
}

test('the sweep REALLY rebuilds: exactly two full models per banded assumption', () => {
  const { result, calls } = sweep('total-net-income');
  // Five of the six requested assumptions carry a band; the contractor rate does not.
  const banded = 5;
  assert.equal(calls.length, banded * 2, 'two rebuilds per banded assumption, no shortcuts');
  assert.equal(result.bars.length, banded);
  // An analytic approximation would leave this at zero and still produce a chart.
  assert.ok(calls.length > 0);
});

test('an assumption with no stated range is EXCLUDED, not swept over an invented one', () => {
  const { result } = sweep('total-net-income');
  assert.ok(!result.bars.some((b) => b.assumptionId === 'org.contractor.rate'));
  const noted = result.issues.find((i) => i.where === 'sensitivity:org.contractor.rate');
  assert.ok(noted, 'the exclusion is stated rather than silent');
  assert.match(noted.message, /invented/);
});

test('an assumption that is not in the ledger at all is reported, not ignored', () => {
  const input = ventureInput();
  const base = M.buildVentureModel(input);
  const r = Sn.sensitivitySweep({
    ledger: input.ledger, inputs: [{ assumptionId: 'does.not.exist', label: 'Phantom' }],
    objective: 'total-net-income', base, rebuild: () => base,
  });
  assert.equal(r.bars.length, 0);
  assert.ok(r.issues.some((i) => i.where === 'sensitivity:does.not.exist'));
});

test('bars rank by swing with deterministic tie-breaking, and the direction is signed', () => {
  const a = sweep('total-net-income').result;
  const b = sweep('total-net-income').result;
  assert.deepEqual(a.bars.map((x) => x.assumptionId), b.bars.map((x) => x.assumptionId));
  for (let i = 1; i < a.bars.length; i += 1) {
    assert.ok(a.bars[i - 1].swingMicros >= a.bars[i].swingMicros, 'descending by swing');
  }
  assert.deepEqual(a.topThree, a.bars.slice(0, 3));
  // Demand moves net income up; every cost input moves it down.
  assert.equal(a.bars.find((x) => x.assumptionId === 'demand.base.units').direction, 'increases');
  assert.equal(a.bars.find((x) => x.assumptionId === 'freight.container.rate').direction, 'decreases');
});

test('the swing is the real objective difference at each band endpoint', () => {
  const { input, base, result } = sweep('total-net-income');
  const bar = result.bars.find((x) => x.assumptionId === 'freight.container.rate');
  const low = M.rebuildWithAssumption(input, 'freight.container.rate', bar.lowValue);
  const high = M.rebuildWithAssumption(input, 'freight.container.rate', bar.highValue);
  assert.equal(bar.lowObjectiveMicros, low.financials.totals.netIncomeMicros);
  assert.equal(bar.highObjectiveMicros, high.financials.totals.netIncomeMicros);
  assert.equal(bar.baseObjectiveMicros, base.financials.totals.netIncomeMicros);
  assert.equal(bar.swingMicros, Math.max(
    Math.abs(bar.lowObjectiveMicros - bar.baseObjectiveMicros),
    Math.abs(bar.highObjectiveMicros - bar.baseObjectiveMicros),
  ));
});

test('a binding actually moves the model — an unbound assumption edit would be theatre', () => {
  const input = ventureInput();
  const base = M.buildVentureModel(input);
  // The freight rate is bound to landed.freight.containerCostMicros.
  const dearer = M.rebuildWithAssumption(input, 'freight.container.rate', D(5400));
  assert.equal(dearer.input.landed.freight.containerCostMicros, D(5400));
  assert.ok(dearer.landed.buyerUnitMicros > base.landed.buyerUnitMicros);
  // The original input is untouched: a rebuild never mutates what it was given.
  assert.equal(input.landed.freight.containerCostMicros, D(3000));
  assert.equal(input.ledger.byId['freight.container.rate'].value, D(3000));
});

test('a binding path that does not resolve THROWS rather than writing nowhere', () => {
  const input = ventureInput();
  input.bindings.push({ assumptionId: 'duty.hts.rate', path: 'landed.duty.noSuchField' });
  assert.throws(() => M.rebuildWithAssumption(input, 'duty.hts.rate', 500), /binding path/);
  // A silent no-op here would report zero sensitivity for an input that matters.
});

test('every sweep objective is readable and none returns NaN on the base model', () => {
  for (const objective of ['peak-cash', 'contribution-per-unit', 'break-even-units', 'total-net-income']) {
    const v = Sn.objectiveValue(M.buildVentureModel(ventureInput()), objective);
    assert.ok(Number.isFinite(v), `${objective} is a number`);
  }
});

test('the blended maximum affordable landed cost is EXACT against a forward evaluation', () => {
  const input = ventureInput();
  const base = M.buildVentureModel(input);
  const target = 3000;
  const solved = Sn.blendedMaxAffordableLanded(base.waterfalls, input.channels, target);
  // Price the channel again at that landed cost and check the contribution lands
  // on the target — no iteration, no tolerance beyond one micro of rounding.
  const w = Ch.forwardWaterfall({
    channel: input.channels[0], landedUnitMicros: solved.maxLandedUnitMicros,
    pricing: { kind: 'fixed-shelf', shelfPriceMicros: base.waterfalls[0].shelfPriceMicros }, onDate: input.onDate,
  });
  const required = Math.round((w.grossRevenueMicros * target) / 10000);
  assert.ok(w.contributionPerUnitMicros >= required, 'the solved cost clears the target');
  assert.ok(w.contributionPerUnitMicros - required <= 2, 'and clears it by no more than rounding');
});

test('the inversions answer the three questions that change a decision', () => {
  const input = ventureInput();
  const base = M.buildVentureModel(input);
  const inv = Sn.computeInversions({ model: base, modelInput: input, requiredContributionBps: 3000 });

  // The plan's actual landed cost is well under the ceiling at a 30% target.
  assert.ok(inv.maxAffordableLandedUnitMicros > base.landed.buyerUnitMicros);
  // The factory price that implies is below the landed ceiling, because freight,
  // duty and handling have to fit underneath it too.
  assert.ok(inv.maxAffordableFactoryUnitMicros < inv.maxAffordableLandedUnitMicros);
  assert.ok(inv.maxAffordableFactoryUnitMicros > 0);

  // ONE SOURCE PER FIGURE: the minimum viable volume IS the model's break-even.
  assert.equal(inv.minViableVolumeUnits, base.breakEven.units);

  // Break-even sell-through, hand-derived:
  //   write-down per unsold unit = 15,873,650 x (1 - 0.30) = 11,111,555
  //   ratio = (14,000,000,000 + 11,111,555 x 1,000)
  //         / ((37,993,981 + 11,111,555) x 1,000)
  //         = 25,111,555,000 / 49,105,536,000 = 0.51138
  assert.ok(Math.abs(inv.breakEvenSellThroughRatio - (25_111_555_000 / 49_105_536_000)) < 1e-12);
});

test('profit is NOT monotone in volume here, and the model says so instead of pretending', () => {
  const base = M.buildVentureModel(ventureInput());
  const flip = base.breakEven.issues.find((i) => i.code === 'non-monotone-inversion');
  assert.ok(flip, 'the container boundary must be surfaced');
  // 374 units fit one container; 417 units buy a second one and the plan goes
  // back under water. A single confident break-even across that step would be
  // exactly the failure-that-reports-success this engine exists to prevent.
  assert.equal(flip.data.profitableAt, 374);
  assert.equal(flip.data.unprofitableAt, 417);
  assert.match(flip.message, /not a proven global minimum/);
});

test('a sell-through above 100% is reported as impossible, not clamped to look achievable', () => {
  // Halve the price so the contribution barely covers the write-down.
  const m = M.buildVentureModel(ventureInput({ pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(34) } }));
  const r = Sn.breakEvenSellThrough(m);
  assert.ok(r.ratio > 1, 'the requirement exceeds the whole run');
  const flagged = r.issues.find((i) => i.code === 'inversion-impossible');
  assert.ok(flagged);
  assert.match(flagged.message, /more than everything made is not available to sell/);
});

test('an unreachable contribution target BLOCKS the landed inversion rather than returning a number', () => {
  const input = ventureInput();
  const base = M.buildVentureModel(input);
  const solved = Sn.blendedMaxAffordableLanded(base.waterfalls, input.channels, 9000);
  assert.equal(solved.maxLandedUnitMicros, 0);
  assert.ok(solved.issues.some((i) => i.code === 'unreachable-target-margin' && i.severity === 'block'));
});
