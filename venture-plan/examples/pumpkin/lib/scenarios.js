/**
 * Run the pumpkin venture through the engine across the scenario grid.
 *
 * THE GRID IS NOT DECORATION. The dataset forbids presenting a single landed cost
 * while the tariff classification is unresolved, and it says a 2.85x-wide cost band
 * collapsed to a midpoint destroys the only honest thing about it. So every
 * decision-bearing question is answered at both tariff branches and at all three
 * corners of the cost bands, and the documents print the spread rather than a
 * comforting point.
 *
 * TWO PRICING MODES, ANSWERING TWO DIFFERENT QUESTIONS, and conflating them is the
 * easiest way to produce a plan that reads well and means nothing:
 *
 *   - `from-cost` answers "what would this have to sell for". Break-even is
 *     meaningless in this mode, because the price floats up with the cost and the
 *     contribution rate is held by construction. These runs exist to be compared
 *     against the observed shelf ceilings.
 *   - `fixed-shelf` answers "at the price the market actually shows, what happens".
 *     These are the runs whose break-even, cash trough and funding requirement mean
 *     something, and they are where the engine returns a negative contribution and
 *     refuses to name a break-even volume.
 *
 * THE CONTROL MODEL is a deliberate demonstration rather than an accident: the same
 * base case built with the tariff classification left unregistered, showing that the
 * engine sets `canPublish` false when a load-bearing figure rests on nothing. A
 * refusal mechanism that is never exercised is a refusal mechanism nobody has
 * tested.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the twenty-scenario grid across both tariff branches and three cost corners, the needs-quote provenance shares, the reconciliation against the dataset's independent hand-check, the sensitivity sweep and inversions on the base case, and the unpublishable control model.
 */
'use strict';

const { engine } = require('./format');
const { loadDataset, atCorner } = require('./ledger');
const { buildInput, DUTY_BRANCHES } = require('./input');

const M = engine('venture-model');
const Sn = engine('venture-sensitivity');
const A = engine('venture-assumptions');

/** Contribution rate the cost-up runs are priced to hit. */
const TARGET_CONTRIBUTION_BPS = 2500;

/** The scenario the narrative documents key off. */
const BASE_ID = 'va-mid-8528-dtc';

/**
 * Every scenario the document set is generated from. `question` is what the run
 * exists to answer; a scenario without one is padding and does not belong here.
 */
const SCENARIOS = [
  { id: 'va-mid-8528-dtc', variantId: 'V-A', corner: 'mid', branchId: '8528', runQty: 5000, channels: { dtc: 1 }, mode: 'cost-up', question: 'What would the self-contained unit have to sell for direct, at midpoint costs and the adverse tariff reading?' },
  { id: 'va-mid-9505-dtc', variantId: 'V-A', corner: 'mid', branchId: '9505', runQty: 5000, channels: { dtc: 1 }, mode: 'cost-up', question: 'The same, if the festive-article classification holds.' },
  { id: 'va-low-9505-dtc', variantId: 'V-A', corner: 'low', branchId: '9505', runQty: 5000, channels: { dtc: 1 }, mode: 'cost-up', question: 'Every cost band at its best corner and the favourable tariff at once — the best case that exists.' },
  { id: 'va-high-8528-dtc', variantId: 'V-A', corner: 'high', branchId: '8528', runQty: 5000, channels: { dtc: 1 }, mode: 'cost-up', question: 'Every band at its worst corner — what the downside actually looks like.' },
  { id: 'va-mid-8528-amazon', variantId: 'V-A', corner: 'mid', branchId: '8528', runQty: 5000, channels: { amazon: 1 }, mode: 'cost-up', question: 'What would it have to sell for on the marketplace, carrying peak-season storage?' },
  { id: 'va-mid-8528-bigbox', variantId: 'V-A', corner: 'mid', branchId: '8528', runQty: 5000, channels: { bigbox: 1 }, mode: 'cost-up', question: 'What shelf price would a big-box retailer have to set?' },
  { id: 'va-mid-9505-bigbox', variantId: 'V-A', corner: 'mid', branchId: '9505', runQty: 5000, channels: { bigbox: 1 }, mode: 'cost-up', question: 'The same on the favourable tariff reading.' },
  { id: 'vb-mid-8528-dtc', variantId: 'V-B', corner: 'mid', branchId: '8528', runQty: 5000, channels: { dtc: 1 }, mode: 'cost-up', question: 'What would the customer-supplies-the-projector kit have to sell for direct?' },
  { id: 'vb-mid-9505-dtc', variantId: 'V-B', corner: 'mid', branchId: '9505', runQty: 5000, channels: { dtc: 1 }, mode: 'cost-up', question: 'The same on the favourable tariff reading.' },
  { id: 'vb-low-9505-dtc', variantId: 'V-B', corner: 'low', branchId: '9505', runQty: 5000, channels: { dtc: 1 }, mode: 'cost-up', question: 'The kit at its best corner — the cheapest hardware this venture can produce.' },
  { id: 'vb-mid-8528-amazon', variantId: 'V-B', corner: 'mid', branchId: '8528', runQty: 5000, channels: { amazon: 1 }, mode: 'cost-up', question: 'The kit on the marketplace.' },
  { id: 'vb-mid-8528-bigbox', variantId: 'V-B', corner: 'mid', branchId: '8528', runQty: 5000, channels: { bigbox: 1 }, mode: 'cost-up', question: 'The kit through big-box, against a shelf anchored at the incumbent price.' },
  { id: 'va-pilot-500-dtc', variantId: 'V-A', corner: 'mid', branchId: '8528', runQty: 500, channels: { dtc: 1 }, mode: 'cost-up', question: 'What a first-timer can actually order: a 500-unit pilot at the dataset\'s own small-run cost uplift.' },
  { id: 'vb-pilot-500-dtc', variantId: 'V-B', corner: 'mid', branchId: '8528', runQty: 500, channels: { dtc: 1 }, mode: 'cost-up', question: 'The kit at pilot volume.' },
  { id: 'va-market-dtc', variantId: 'V-A', corner: 'mid', branchId: '8528', runQty: 5000, channels: { dtc: 1 }, mode: 'market', ceilingId: 'MKT-BUNDLE-CEILING', question: 'Priced at the TOP of the observed direct-sold projector bundle band: does it make money?' },
  // The same comparable kit sells at two very different prices on two surfaces, and
  // the verdict of the whole plan turns on which one is used. Both are run. Pricing
  // at the higher surface alone would be optimism selected into the inputs at the
  // one place it changes the answer.
  { id: 'va-market-dtc-floor', variantId: 'V-A', corner: 'mid', branchId: '8528', runQty: 5000, channels: { dtc: 1 }, mode: 'market', ceilingId: 'MKT-BUNDLE-FLOOR', question: 'Priced at the BOTTOM of the same band — the mass-retailer shelf price for the identical comparable kit — does it still make money?' },
  { id: 'va-market-bigbox', variantId: 'V-A', corner: 'mid', branchId: '8528', runQty: 5000, channels: { bigbox: 1 }, mode: 'market', ceilingId: 'MKT-ANIMATRONICS-CEILING', question: 'Placed at the top of the animatronics shelf: does it make money?' },
  { id: 'vb-market-dtc', variantId: 'V-B', corner: 'mid', branchId: '8528', runQty: 5000, channels: { dtc: 1 }, mode: 'market', ceilingId: 'MKT-INCUMBENT-ANCHOR', question: 'The kit priced at the incumbent projection inflatable: does it make money?' },
  { id: 'vb-market-bigbox', variantId: 'V-B', corner: 'mid', branchId: '8528', runQty: 5000, channels: { bigbox: 1 }, mode: 'market', ceilingId: 'MKT-INFLATABLES-CEILING', question: 'The kit at the top of the plain inflatables shelf: does it make money?' },
  { id: 'va-mid-8528-mix', variantId: 'V-A', corner: 'mid', branchId: '8528', runQty: 5000, channels: { dtc: 0.5, amazon: 0.3, bigbox: 0.2 }, mode: 'cost-up', question: 'A blended route to market rather than one channel.' },
  { id: 'va-mid-8528-dtc-staffed', variantId: 'V-A', corner: 'mid', branchId: '8528', runQty: 5000, channels: { dtc: 1 }, mode: 'cost-up', staffed: true, question: 'The same plan with the six roles the dataset names actually paid.' },
];

/**
 * @description Which assumptions still need a supplier quote, from the metadata
 *   the ledger builder carried across from the dataset.
 * @param {object} meta - Per-assumption metadata.
 * @returns {Set<string>} Assumption ids flagged needs-quote.
 */
function needsQuoteIds(meta) {
  return new Set(Object.values(meta).filter((m) => m.needsQuote).map((m) => m.id));
}

/**
 * @description The share of ex-works cost resting on lines nobody has quoted. The
 *   dataset calls this "the honest confidence in the whole plan", so it is computed
 *   from the flags rather than asserted.
 * @param {object} model - A built model.
 * @param {Set<string>} nq - Needs-quote assumption ids.
 * @returns {{shareRatio: number, quotedMicros: number, unquotedMicros: number}} The split.
 */
function exWorksProvenance(model, nq) {
  let unquoted = 0;
  let quoted = 0;
  for (const line of model.bom.lines) {
    const tainted = line.assumptionRefs.some((r) => nq.has(r));
    if (tainted) unquoted += line.extendedMicros;
    else quoted += line.extendedMicros;
  }
  const total = unquoted + quoted;
  return { shareRatio: total > 0 ? unquoted / total : 0, quotedMicros: quoted, unquotedMicros: unquoted };
}

/**
 * @description The same split across the whole landed stack, so the headline
 *   provenance number covers freight and duty rather than only the parts.
 * @param {object} model - A built model.
 * @param {Set<string>} nq - Needs-quote assumption ids.
 * @returns {{shareRatio: number, quotedMicros: number, unquotedMicros: number, legs: Array}} The split.
 */
function landedProvenance(model, nq) {
  const ex = exWorksProvenance(model, nq);
  let unquoted = ex.unquotedMicros;
  let quoted = ex.quotedMicros;
  const legs = [];
  for (const leg of model.landed.legs) {
    if (leg.key === 'exWorks' || leg.paidBy !== 'buyer') continue;
    const tainted = leg.assumptionRefs.some((r) => nq.has(r));
    legs.push({ key: leg.key, totalMicros: leg.totalMicros, tainted });
    if (tainted) unquoted += leg.totalMicros;
    else quoted += leg.totalMicros;
  }
  const total = unquoted + quoted;
  return { shareRatio: total > 0 ? unquoted / total : 0, quotedMicros: quoted, unquotedMicros: unquoted, legs };
}

/**
 * @description Build and run one scenario.
 * @param {object} ds - The dataset.
 * @param {object} spec - A SCENARIOS entry.
 * @returns {object} The run: spec, input, ledger, metadata, model and provenance.
 */
function runScenario(ds, spec) {
  const pricing = spec.mode === 'market'
    ? { kind: 'fixed-shelf', shelfPriceMicros: null }
    : { kind: 'from-cost', targetContributionBps: TARGET_CONTRIBUTION_BPS };
  const first = buildInput(ds, { ...spec, pricing });
  // A market-priced run needs a ceiling out of the ledger, which only exists once
  // the ledger is built — so the price is resolved and the input rebuilt.
  const resolved = spec.mode === 'market'
    ? buildInput(ds, { ...spec, pricing: { kind: 'fixed-shelf', shelfPriceMicros: first.ledger.byId[spec.ceilingId].value } })
    : first;
  const model = M.buildVentureModel(resolved.input);
  const nq = needsQuoteIds(resolved.meta);
  return {
    spec, model, ledger: resolved.ledger, meta: resolved.meta,
    input: resolved.input, ledgerIssues: resolved.ledgerIssues,
    exWorks: exWorksProvenance(model, nq), landed: landedProvenance(model, nq),
    stats: A.ledgerStats(resolved.ledger),
  };
}

/**
 * @description Every banded assumption in a ledger, as sweep inputs. The sweep
 *   excludes anything without a band, which is the correct behaviour: a range
 *   invented for the chart would manufacture the uncertainty it claims to measure.
 * @param {object} ledger - The assumption ledger.
 * @param {object} meta - Per-assumption metadata.
 * @returns {Array<{assumptionId: string, label: string}>} Sweep inputs.
 */
function sweepInputs(ledger, meta) {
  return A.ledgerStats(ledger).bandedIds.map((id) => ({
    assumptionId: id, label: (meta[id] && meta[id].id ? ledger.byId[id].label : ledger.byId[id].label),
  }));
}

/**
 * @description Run the sensitivity sweep and the inversions on a scenario.
 * @param {object} ds - The dataset.
 * @param {object} run - A scenario run.
 * @param {string} objective - Which objective to sweep.
 * @returns {{sweep: object, inversions: object, rebuilds: number}} The results.
 */
function analyse(ds, run, objective) {
  let rebuilds = 0;
  const sweep = Sn.sensitivitySweep({
    ledger: run.ledger, inputs: sweepInputs(run.ledger, run.meta), objective, base: run.model,
    rebuild: (ledger) => {
      rebuilds += 1;
      return M.buildVentureModel(M.withLedger(run.input, ledger));
    },
  });
  const inversions = Sn.computeInversions({
    model: run.model, modelInput: run.input, requiredContributionBps: TARGET_CONTRIBUTION_BPS,
  });
  return { sweep, inversions, rebuilds };
}

/**
 * @description The control model: the base case with the tariff classification
 *   removed from the ledger. Demonstrates the engine's fail-closed rule on a real
 *   model rather than asserting it in prose.
 * @param {object} ds - The dataset.
 * @param {object} base - The base scenario run.
 * @returns {{model: object, removed: string, unsourcedFigureIds: string[]}} The control result.
 */
function refusalControl(ds, base) {
  const stripped = {
    ...base.input,
    ledger: { byId: { ...base.input.ledger.byId }, order: base.input.ledger.order.filter((id) => id !== 'A-DUT-3') },
  };
  delete stripped.ledger.byId['A-DUT-3'];
  const model = M.buildVentureModel(stripped);
  return { model, removed: 'A-DUT-3', unsourcedFigureIds: model.traceability.unsourcedFigureIds };
}

/**
 * @description Reconcile the engine against the dataset's INDEPENDENT hand-check.
 *   The dataset states plainly that if the two disagree by more than a few percent
 *   one of them is broken; this makes that check a computation instead of a hope.
 * @param {object} ds - The dataset.
 * @param {object[]} runs - The scenario runs.
 * @returns {Array<object>} One row per hand-checked scenario the grid can match.
 */
function reconcile(ds, runs) {
  const byId = Object.fromEntries(runs.map((r) => [r.spec.id, r]));
  const pairs = [
    { check: 'V-A midpoint, 25 percent duty, peak-season freight', runId: 'va-mid-8528-dtc' },
    { check: 'V-A midpoint, 7.5 percent duty, peak-season freight', runId: 'va-mid-9505-dtc' },
    { check: 'V-A simultaneous LOW corner of every band, 7.5 percent duty, low freight', runId: 'va-low-9505-dtc' },
    { check: 'V-B midpoint, 25 percent duty, peak freight', runId: 'vb-mid-8528-dtc' },
    { check: 'V-B simultaneous LOW corner, 7.5 percent duty, low freight', runId: 'vb-low-9505-dtc' },
  ];
  return pairs.map(({ check, runId }) => {
    const hand = ds.sanityExpectations.checks.find((c) => c.scenario === check);
    const run = byId[runId];
    const engineExWorks = run.model.bom.recurringUnitMicros;
    const engineLanded = run.model.landed.buyerUnitMicros;
    const handExWorks = Math.round(hand.exWorks * 1e6);
    const handLanded = Math.round(hand.landed * 1e6);
    // The engine carries two lines the hand-check does not: a final-assembly
    // charge and a scrap rate, both minted by this run and both zero at the low
    // corner. Comparing without them isolates a genuine arithmetic disagreement
    // from a difference in what is being counted.
    const addedMicros = engineExWorks - handExWorks;
    return {
      check, runId, handExWorks: handExWorks, engineExWorks, addedMicros,
      handLanded, engineLanded,
      landedDeltaRatio: handLanded > 0 ? (engineLanded - addedMicros - handLanded) / handLanded : 0,
    };
  });
}

/**
 * @description Money that leaves before any arrives. This is most of the answer to
 *   "what does it cost to find out if this works", and it is read off the engine's
 *   own dated cash statement rather than added up by hand.
 * @param {object} model - A built model.
 * @returns {{totalMicros: number, byKind: object, firstRevenueMonth: string|null, months: number}} The pre-revenue spend.
 */
function preRevenueOutflow(model) {
  const firstRevenue = model.financials.pnl.find((p) => p.revenueMicros > 0);
  const firstRevenueMonth = firstRevenue ? firstRevenue.month : null;
  const byKind = {};
  let total = 0;
  let months = 0;
  for (const e of model.schedule.events) {
    if (firstRevenueMonth && e.month >= firstRevenueMonth) continue;
    if (e.amountMicros >= 0) continue;
    byKind[e.kind] = (byKind[e.kind] || 0) + e.amountMicros;
    total += e.amountMicros;
  }
  for (const [month, micros] of Object.entries(model.input.fixedOpexByMonth)) {
    if (!micros) continue;
    if (firstRevenueMonth && month >= firstRevenueMonth) continue;
    byKind.compliance = (byKind.compliance || 0) - micros;
    total -= micros;
  }
  for (const m of model.horizon) {
    if (firstRevenueMonth && m >= firstRevenueMonth) months += 0;
    else months += 1;
  }
  return { totalMicros: total, byKind, firstRevenueMonth, months };
}

/**
 * @description The month the plan actually gets its money back, read off the
 *   engine's own statements.
 *
 *   THE ENGINE'S OWN BREAK-EVEN MONTH IS THE FIRST MONTH CUMULATIVE IS NON-NEGATIVE,
 *   which on a plan that opens at zero is the first month of the horizon — true,
 *   and useless as a date. What a reader means by "when do I get my money back" is
 *   the first month AFTER the position has gone negative at which it returns to
 *   zero. Both are reported; neither is silently substituted for the other.
 * @param {object} model - A built model.
 * @returns {{cashMonth: string|null, accountingMonth: string|null, wentNegative: boolean}} The recovery months.
 */
function recoveryMonths(model) {
  const after = (rows, read) => {
    let seenNegative = false;
    for (const row of rows) {
      const v = read(row);
      if (v < 0) { seenNegative = true; continue; }
      if (seenNegative && v >= 0) return row.month;
    }
    return null;
  };
  const cash = model.financials.cash;
  return {
    cashMonth: after(cash, (r) => r.cumulativeMicros),
    accountingMonth: after(model.financials.pnl, (r) => r.cumulativeNetIncomeMicros),
    wentNegative: cash.some((r) => r.cumulativeMicros < 0),
  };
}

/**
 * @description The inversions for one run. On a market-priced run these are the
 *   decision numbers: the highest landed cost and the highest factory price the
 *   observed shelf price can carry at the target contribution. On a cost-up run
 *   they are degenerate by construction, because the price was solved to hit the
 *   target exactly — which is itself worth saying rather than printing a number
 *   that looks like a finding.
 * @param {object} run - A scenario run.
 * @returns {object} The inversions plus the actuals they are compared against.
 */
function inversionsFor(run) {
  const inv = Sn.computeInversions({
    model: run.model, modelInput: run.input, requiredContributionBps: TARGET_CONTRIBUTION_BPS,
  });
  return {
    ...inv,
    degenerate: run.spec.mode !== 'market',
    actualLandedUnitMicros: run.model.landed.buyerUnitMicros,
    actualFactoryUnitMicros: run.model.bom.recurringUnitMicros,
    shelfPriceMicros: run.model.waterfalls[0] ? run.model.waterfalls[0].shelfPriceMicros : null,
  };
}

/**
 * @description Read the contribution per unit off a model, blended across its mix.
 * @param {object} model - A built model.
 * @returns {number} Micros per unit.
 */
function contributionOf(model) {
  return M.contributionPerUnitMicros(model);
}

/**
 * @description Find the value of one assumption at which a market-priced run
 *   stops losing money on every unit — by rebuilding the whole model, not by
 *   rearranging a formula. The band is sampled first so a crossing is BRACKETED
 *   before it is bisected: bisecting an unbracketed range would return a confident
 *   number for a crossing that is not there.
 *
 *   A driver with no crossing inside its researched band returns `crossing: null`
 *   and states the best the band can do. That is the honest answer, and it is a
 *   more useful one than a number outside the range anybody has evidence for.
 * @param {object} run - A market-priced scenario run.
 * @param {string} assumptionId - The driver to move.
 * @param {number} [samples=9] - Bracketing samples across the band.
 * @returns {object} The scan: samples, the crossing value if one exists, and the
 *   base and best contribution figures.
 */
function driverCrossing(run, assumptionId, samples = 9) {
  const a = run.ledger.byId[assumptionId];
  if (!a || !a.band) return { assumptionId, crossing: null, reason: 'no-band', samples: [] };
  const at = (v) => contributionOf(M.rebuildWithAssumption(run.input, assumptionId, v));
  const points = [];
  for (let i = 0; i < samples; i += 1) {
    const value = a.band.low + ((a.band.high - a.band.low) * i) / (samples - 1);
    points.push({ value, contributionMicros: at(value) });
  }
  const bracket = findSignChange(points);
  const best = points.reduce((x, y) => (y.contributionMicros > x.contributionMicros ? y : x));
  if (!bracket) {
    return {
      assumptionId, label: a.label, unit: a.unit, band: a.band, samples: points,
      crossing: null, reason: points.every((p) => p.contributionMicros >= 0) ? 'always-positive' : 'never-positive',
      bestValue: best.value, bestContributionMicros: best.contributionMicros,
      baseValue: a.value, baseContributionMicros: contributionOf(run.model),
    };
  }
  return {
    assumptionId, label: a.label, unit: a.unit, band: a.band, samples: points,
    crossing: bisectCrossing(bracket, at), reason: 'bracketed',
    bestValue: best.value, bestContributionMicros: best.contributionMicros,
    baseValue: a.value, baseContributionMicros: contributionOf(run.model),
  };
}

/**
 * @description Find the adjacent sample pair whose contribution changes sign.
 * @param {Array<{value: number, contributionMicros: number}>} points - Samples, ordered.
 * @returns {{lo: object, hi: object}|null} The bracketing pair, or null.
 */
function findSignChange(points) {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if ((a.contributionMicros < 0) !== (b.contributionMicros < 0)) return { lo: a, hi: b };
  }
  return null;
}

/**
 * @description Bisect a bracketed sign change to the driver value at which
 *   contribution reaches zero.
 * @param {{lo: object, hi: object}} bracket - The bracketing samples.
 * @param {(value: number) => number} at - Rebuild-and-read.
 * @returns {number} The driver value at the crossing.
 */
function bisectCrossing(bracket, at) {
  let lo = bracket.lo.value;
  let hi = bracket.hi.value;
  let loNeg = bracket.lo.contributionMicros < 0;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const negative = at(mid) < 0;
    if (negative === loNeg) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * @description Run the whole grid, the analysis and the control.
 * @returns {object} Everything the document renderers consume.
 */
function runAll() {
  const ds = loadDataset();
  const started = Date.now();
  const runs = SCENARIOS.map((spec) => runScenario(ds, spec));
  const byId = Object.fromEntries(runs.map((r) => [r.spec.id, r]));
  const base = byId[BASE_ID];
  const marketInversions = runs
    .filter((r) => r.spec.mode === 'market')
    .map((r) => ({ runId: r.spec.id, run: r, inversions: inversionsFor(r) }));
  // BOTH SWEEPS RUN ON THE MARKET-PRICED CONFIGURATION, not on the cost-up base.
  // In a cost-up run the shelf price floats up with the cost to hold a target
  // contribution rate, so a higher component cost RAISES contribution per unit —
  // arithmetically true, and a chart of it would tell a reader that expensive parts
  // are good for margin. The market-priced run takes its price as given, so the
  // contribution column is a result rather than a restatement of the pricing rule.
  const sweepRun = byId['va-market-dtc'];
  const analyseCache = {
    run: sweepRun,
    cash: analyse(ds, sweepRun, 'peak-cash'),
    margin: analyse(ds, sweepRun, 'contribution-per-unit'),
  };
  return {
    ds, runs, byId, base, marketInversions,
    branches: DUTY_BRANCHES,
    targetContributionBps: TARGET_CONTRIBUTION_BPS,
    cashSweep: analyseCache.cash,
    marginSweep: analyseCache.margin,
    control: refusalControl(ds, base),
    reconciliation: reconcile(ds, runs),
    preRevenue: Object.fromEntries(runs.map((r) => [r.spec.id, preRevenueOutflow(r.model)])),
    recovery: Object.fromEntries(runs.map((r) => [r.spec.id, recoveryMonths(r.model)])),
    breakEvenStep: breakEvenStep(byId['va-market-dtc']),
    sweepRun: analyseCache.run,
    inert: inertInputs(analyseCache.run, [analyseCache.cash, analyseCache.margin]),
    crossings: buildCrossings(byId),
    elapsedMs: Date.now() - started,
  };
}

/**
 * @description Every banded assumption that moved NOTHING on any swept objective,
 *   with whether a binding for it even exists.
 *
 *   THIS IS THE GUARD FOR THE MOST DANGEROUS DEFECT THIS EXAMPLE CAN HAVE. An
 *   assumption with a range but no binding can be edited, swept and charted, and it
 *   will report a swing of zero — which reads as "this input does not matter" when
 *   the truth is "this input is not wired to anything". The first draft of this
 *   example had exactly that defect on nine channel inputs, and the tornado chart
 *   looked entirely plausible with it. Listing every zero-swing input alongside
 *   whether it is bound makes the difference visible on every regeneration.
 * @param {object} run - The base run.
 * @param {Array<object>} sweeps - The sweep results to consider.
 * @returns {Array<object>} One row per input that moved nothing.
 */
function inertInputs(run, sweeps) {
  const bound = new Set(run.input.bindings.map((b) => b.assumptionId));
  const swings = new Map();
  for (const s of sweeps) {
    for (const bar of s.sweep.bars) {
      swings.set(bar.assumptionId, Math.max(swings.get(bar.assumptionId) || 0, Math.abs(bar.swingMicros)));
    }
  }
  const out = [];
  for (const [id, swing] of swings) {
    if (swing !== 0) continue;
    const a = run.ledger.byId[id];
    out.push({
      id, label: a ? a.label : id, bound: bound.has(id),
      band: a && a.band ? a.band : null, unit: a ? a.unit : null,
    });
  }
  return out.sort((a, b) => (a.bound === b.bound ? a.id.localeCompare(b.id) : a.bound ? 1 : -1));
}

/**
 * @description Rebuild a run either side of its break-even volume.
 *
 *   THIS EXISTS BECAUSE THE BREAK-EVEN HERE IS NOT A MARGIN CROSSING. Component
 *   prices are quoted at a stated volume with a small-run uplift below it, so the
 *   cost curve has a step in it, and the engine's search lands on the step rather
 *   than on a gradual crossing. Printing "break-even is N units" without showing
 *   that would be technically correct and would leave a reader believing the plan
 *   degrades smoothly below N. It does not; it falls off a cliff.
 * @param {object} run - A market-priced scenario run.
 * @returns {object|null} The comparison, or null when no break-even exists.
 */
function breakEvenStep(run) {
  const be = run.model.breakEven.units;
  if (be === null || be <= 1) return null;
  const at = M.rebuildWithVolume(run.input, be);
  const below = M.rebuildWithVolume(run.input, be - 1);
  // Read the ladder off the single most expensive PURCHASED component rather than
  // off the root assembly node, which carries only one band and would show the
  // step as no step at all.
  const driver = costliestComponent(run.model);
  const side = (m, units) => {
    const line = m.bom.lines.find((l) => l.componentId === driver) || m.bom.lines[0];
    return {
      units, factoryUnitMicros: m.bom.recurringUnitMicros, landedUnitMicros: m.landed.buyerUnitMicros,
      netIncomeMicros: m.financials.totals.netIncomeMicros,
      purchaseQty: line.purchaseQty, unitCostMicros: line.bandUnitCostMicros,
      band: line.selectedBreak ? line.selectedBreak.minQty : null,
      componentId: line.componentId, componentName: line.name,
    };
  };
  return {
    runId: run.spec.id, units: be, driver,
    at: side(at, be), below: side(below, be - 1),
    issues: run.model.breakEven.issues,
    closedForm: run.model.breakEven.unitsClosedForm,
  };
}

/**
 * @description The component with the largest extended cost in a roll-up, skipping
 *   the root assembly node.
 * @param {object} model - A built model.
 * @returns {string} The component id.
 */
function costliestComponent(model) {
  const lines = model.bom.lines.filter((l) => l.path.length > 1);
  if (!lines.length) return model.bom.lines[0].componentId;
  return lines.reduce((a, b) => (b.extendedMicros > a.extendedMicros ? b : a)).componentId;
}

/**
 * The drivers worth inverting: the dataset's own top-ranked open questions plus
 * the two channel costs the arithmetic showed dominate a market-priced run.
 */
const CROSSING_DRIVERS = [
  { runId: 'vb-market-dtc', assumptionId: 'CH-1-CAC' },
  { runId: 'vb-market-dtc', assumptionId: 'M-DTC-SHIP' },
  { runId: 'vb-market-dtc', assumptionId: 'B-01' },
  { runId: 'va-market-bigbox', assumptionId: 'B-04' },
  { runId: 'va-market-bigbox', assumptionId: 'A-DUT-3' },
  { runId: 'va-market-bigbox', assumptionId: 'A-CH-6' },
  { runId: 'va-market-dtc', assumptionId: 'CH-1-CAC' },
  { runId: 'va-market-dtc', assumptionId: 'B-04' },
];

/**
 * @description Run every declared driver crossing.
 * @param {object} byId - Runs keyed by scenario id.
 * @returns {Array<object>} One scan per driver, carrying its run id.
 */
function buildCrossings(byId) {
  return CROSSING_DRIVERS.map(({ runId, assumptionId }) => ({
    runId, ...driverCrossing(byId[runId], assumptionId),
  }));
}

module.exports = {
  preRevenueOutflow, inversionsFor, driverCrossing, CROSSING_DRIVERS, recoveryMonths, inertInputs,
  SCENARIOS, BASE_ID, TARGET_CONTRIBUTION_BPS,
  runAll, runScenario, analyse, reconcile, refusalControl,
  exWorksProvenance, landedProvenance, needsQuoteIds, atCorner,
};
