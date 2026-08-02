/**
 * Guards for the profit-and-loss, cash and working-capital statements, the peak
 * cash requirement and break-even.
 *
 * THE PROPERTY THIS SUITE EXISTS FOR: break-even must AGREE WITH THE MONTHLY P&L.
 * The engine bisects over models rebuilt at each candidate volume, so the guard
 * asserts the model itself — at the break-even volume cumulative net income is
 * non-negative, and one unit less it is not. A break-even that does not tie to
 * the statement it came from is the single most dangerous number this app can
 * produce, because it is the one a person acts on.
 *
 * The second property: cost of goods is recognised on SALE and paid at the
 * PURCHASE ORDER, so moving the order month must move cash and leave the P&L
 * alone. That is asserted directly, because a model that computes cash by
 * adjusting profit gets the trough month wrong.
 *
 * Dependency-free `node --test` suite over the COMPILED module.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — the hand-derived P&L and cash trough, COGS on sale versus paid at order, break-even consistency with the P&L by construction, the closed-form divergence report, the null (not negative) break-even at non-positive contribution, and the working-capital recognition gap.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { engine, D, ventureInput } = require('./fixture-venture');

const M = engine('venture-model');
const Fin = engine('venture-financials');

const model = (over) => M.buildVentureModel(ventureInput(over));
const monthOf = (rows, m) => rows.find((r) => r.month === m);

/**
 * @description Rebuild the exact FinancialsInput a model was computed from, so a
 *   guard can re-run `computeFinancials` with ONE term mutated and prove the
 *   reconciliation catches it. Mirrors `buildVentureCore` field for field.
 * @param {object} m - A built model.
 * @returns {object} The financials input.
 */
function financialsInputOf(m) {
  return {
    horizon: m.horizon,
    events: m.schedule.events,
    unitsSoldByMonth: m.schedule.unitsSoldByMonth,
    unitsOnHandByMonth: m.schedule.unitsOnHandByMonth,
    landedUnitMicros: m.landed.buyerUnitMicros,
    waterfalls: m.waterfalls,
    channels: m.input.channels,
    headcount: m.headcount,
    fixedOpexByMonth: m.input.fixedOpexByMonth,
    oneTimeToolingMicros: m.bom.oneTimeMicros,
    openingCashMicros: m.input.openingCashMicros,
    inventoryChargeByMonth: m.schedule.disposition.chargeByMonth,
    unitsBuilt: m.bom.runQtyUnits,
    landedBuyerTotalMicros: m.landed.buyerTotalMicros,
    purchaseRoundingMicros: m.bom.roundingResidualMicros,
  };
}

test('the profit and loss statement computes to hand-derived values', () => {
  const m = model();
  const oct = monthOf(m.financials.pnl, '2026-10');

  // 1,000 units at $79.99 gross revenue.
  assert.equal(oct.revenueMicros, D(79990));
  // COGS is the landed cost net of returns salvage: 15,476,809 x 1,000.
  assert.equal(oct.cogsMicros, 15_476_809_000);
  assert.equal(oct.grossProfitMicros, D(79990) - 15_476_809_000);
  // Acquisition spend is MARKETING, not a channel charge — $12.00 x 1,000.
  assert.equal(oct.marketingMicros, D(12000));
  // The remaining channel deductions: 26,519,210 - 12,000,000 = 14,519,210 each.
  assert.equal(oct.channelFeeMicros, 14_519_210_000);
  // A quarter-FTE contractor at $24,000 a year is $500 a month; fixed opex $250.
  assert.equal(oct.payrollMicros, D(500));
  assert.equal(oct.opexMicros, D(250));

  // Across the horizon: revenue $79,990, net income $23,993.981
  assert.equal(m.financials.totals.revenueMicros, D(79990));
  assert.equal(m.financials.totals.netIncomeMicros, 23_993_981_000);
});

test('contribution less net income IS fixed cost, and it equals headcount + opex + tooling', () => {
  const m = model();
  // Contribution: 37,993,981 per unit x 1,000 units.
  assert.equal(m.financials.totals.contributionMicros, 37_993_981_000);
  // Fixed: 12 months of $500 contractor + 24 months of $250 opex + $2,000 tooling
  //      = $6,000 + $6,000 + $2,000 = $14,000
  assert.equal(m.financials.totals.fixedCostsMicros, D(14000));
  // The two independent routes to the same figure must agree exactly.
  assert.equal(M.fixedCostsMicros(m), m.financials.totals.fixedCostsMicros);
  // And the identity closes: contribution - fixed = net income.
  assert.equal(
    m.financials.totals.contributionMicros - m.financials.totals.fixedCostsMicros,
    m.financials.totals.netIncomeMicros,
  );
});

test('the cash trough is hand-derivable month by month, and it falls BEFORE any revenue', () => {
  const m = model();
  const cum = (mo) => monthOf(m.financials.cash, mo).cumulativeMicros;
  // Jan: payroll $500 + opex $250                                    = -750
  assert.equal(cum('2026-01'), -D(750));
  // Feb: + tooling $2,000                                            = -3,500
  assert.equal(cum('2026-02'), -D(3500));
  // Mar: + deposits $1,200.00 (Acme) and $10.20 (FastCo)             = -5,460.20
  assert.equal(cum('2026-03'), -5_460_200_000);
  // May: + FastCo balance $10.20                                     = -6,970.40
  assert.equal(cum('2026-05'), -6_970_400_000);
  // Aug: + Acme balance $2,800.00
  //      + freight $9,000.00 and marine insurance $65.102
  //      + duty, fees, clearance, drayage and receiving $2,788.1478
  //                                                                  = -23,873.6498
  assert.equal(cum('2026-08'), -23_873_649_800);
  // Sep: the last month before the window                            = -24,623.6498
  assert.equal(cum('2026-09'), -24_623_649_800);
  // Oct: the season arrives.
  assert.ok(cum('2026-10') > 0);

  assert.equal(m.financials.peakCash.troughMicros, -24_623_649_800);
  assert.equal(m.financials.peakCash.month, '2026-09');
  assert.equal(m.financials.peakCash.fundingRequiredMicros, 24_623_649_800);
  assert.equal(m.financials.peakCash.monthsUnderwater, 9);
});

test('the trough is exactly the minimum of the cumulative series, not an approximation of it', () => {
  const m = model();
  const min = Math.min(...m.financials.cash.map((c) => c.cumulativeMicros));
  assert.equal(m.financials.peakCash.troughMicros, min);
  assert.equal(m.financials.peakCash.fundingRequiredMicros, Math.max(0, -min));
});

test('COGS is recognised on SALE and paid at the ORDER — moving the order moves cash, not profit', () => {
  const base = model();
  const later = model({ timing: { ...ventureInput().timing, poMonth: '2026-04' } });
  // The profit and loss statement is identical: nothing about the product changed.
  assert.equal(later.financials.totals.netIncomeMicros, base.financials.totals.netIncomeMicros);
  assert.equal(
    monthOf(later.financials.pnl, '2026-10').cogsMicros,
    monthOf(base.financials.pnl, '2026-10').cogsMicros,
  );
  // The cash statement is NOT: the deposit moved a month later, so March improves.
  assert.ok(monthOf(later.financials.cash, '2026-03').cumulativeMicros
    > monthOf(base.financials.cash, '2026-03').cumulativeMicros);
  // A model that derived cash from profit could not tell these two plans apart.
});

test('break-even AGREES with the monthly P&L by construction', () => {
  const m = model();
  const be = m.breakEven.units;
  assert.ok(Number.isInteger(be) && be > 0, 'a break-even volume was found');
  const at = M.rebuildWithVolume(ventureInput(), be);
  const below = M.rebuildWithVolume(ventureInput(), be - 1);
  const cum = (x) => x.financials.pnl[x.financials.pnl.length - 1].cumulativeNetIncomeMicros;
  assert.ok(cum(at) >= 0, `at ${be} units the plan is at or above break-even`);
  assert.ok(cum(below) < 0, `at ${be - 1} units it is not`);
});

test('the textbook formula DISAGREES here, and the divergence is reported rather than averaged away', () => {
  const m = model();
  // fixed / contribution = 14,000,000,000 / 37,993,981 = 368.5 -> 369.
  assert.equal(m.breakEven.unitsClosedForm, 369);
  // The search says otherwise, because contribution is not constant in volume:
  // below 1,000 units the shell loses its price break, the run drops to fewer
  // containers, and the marine insurance minimum starts to bind.
  assert.ok(m.breakEven.units > m.breakEven.unitsClosedForm);
  const diverged = m.breakEven.issues.find((i) => i.code === 'break-even-crosscheck-diverged');
  assert.ok(diverged, 'the disagreement must be surfaced, not smoothed');
  assert.equal(diverged.data.closedFormUnits, 369);
  assert.equal(diverged.data.searchUnits, m.breakEven.units);
});

test('a non-positive contribution returns NULL, never a negative number that reads as a target', () => {
  // Price the product below its own landed cost.
  const m = model({ pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(19.99) } });
  assert.ok(M.contributionPerUnitMicros(m) < 0);
  assert.equal(m.breakEven.units, null);
  assert.equal(m.breakEven.unitsClosedForm, null);
  const blocked = m.breakEven.issues.find((i) => i.code === 'no-break-even');
  assert.ok(blocked && blocked.severity === 'block');
  assert.equal(m.canPublish, false);
  // The naive fixed/contribution would have returned about -368 here, and -368
  // units reads to a human like a number rather than like an impossibility.
});

test('accounting and cash break-even months are reported separately and may differ', () => {
  const m = model();
  // Profit turns positive the month the season sells; cash the same month here,
  // but they are computed from different statements and both are reported.
  assert.equal(m.breakEven.accountingBreakEvenMonth, '2026-10');
  assert.equal(m.breakEven.cashBreakEvenMonth, '2026-10');
  assert.equal(
    Fin.firstNonNegativeMonth(m.financials.cash, (r) => r.cumulativeMicros),
    m.breakEven.cashBreakEvenMonth,
  );
});

test('working capital shows the recognition gap: stock owned, money owed, money due', () => {
  const m = model();
  const sep = monthOf(m.financials.workingCapital, '2026-09');
  // In September the whole run is on hand and nothing has been sold.
  assert.equal(sep.inventoryUnits, 1000);
  assert.equal(sep.inventoryValueMicros, 15_873_650 * 1000);
  assert.equal(sep.accountsReceivableMicros, 0);
  // By December everything has shipped, sold and been paid for.
  const dec = monthOf(m.financials.workingCapital, '2026-12');
  assert.equal(dec.inventoryUnits, 0);
  assert.equal(dec.accountsReceivableMicros, 0);
  assert.equal(dec.accountsPayableMicros, 0);
});

test('accounts payable is what has been INCURRED and not yet paid — not the whole programme', () => {
  const m = model();
  const wc = (mo) => monthOf(m.financials.workingCapital, mo);
  // January: the horizon opens with no inventory, no receivable and NO activity.
  // The earlier build reported the entire future purchase programme as payable
  // from month one, which put working capital at minus the whole run before a
  // single obligation existed.
  assert.equal(wc('2026-01').accountsPayableMicros, 0);
  assert.equal(wc('2026-01').workingCapitalMicros, 0);
  // Acme ships in July and is due net 30, so the $2,800 balance is a payable in
  // July and settled in August. Nothing else is outstanding at that point.
  assert.equal(wc('2026-07').accountsPayableMicros, D(2800));
  assert.equal(wc('2026-08').accountsPayableMicros, 0);
  // No month of the horizon carries a payable larger than the whole programme.
  const programme = D(2000) + D(4000) + D(20.4) + 65_102_000 + 2_788_147_800 + D(9000);
  for (const row of m.financials.workingCapital) {
    assert.ok(row.accountsPayableMicros >= 0, `${row.month} payable is not negative`);
    assert.ok(row.accountsPayableMicros <= programme, `${row.month} payable is within the programme`);
  }
});

test('the profit statement CHARGES the stock that did not sell', () => {
  // Demand at this price is 1,200 units. Build 1,400 and 200 never sell.
  const over = model({ runQtyUnits: 1400 });
  const exact = model({ runQtyUnits: 1200 });
  assert.equal(exact.schedule.unsoldAtWindowEnd, 0);
  const writeDown = over.financials.totals.inventoryWriteDownMicros;
  assert.ok(writeDown > 0, 'over-building costs something');
  assert.equal(over.schedule.unsoldAtWindowEnd, 200);
  // The charge is the schedule's per-unit rate times the leftovers, and it lands
  // in the month the leftovers are dumped.
  assert.equal(writeDown, over.schedule.disposition.writeDownPerUnitMicros * 200);
  assert.equal(monthOf(over.financials.pnl, '2026-11').inventoryWriteDownMicros, writeDown);
  // THE POINT: over-building must not raise reported profit. Before the fix the
  // cost of the 400 units appeared in no P&L line at all, so net income rose with
  // the size of the over-build and the plan's headline verdict was inverted.
  assert.ok(
    over.financials.totals.netIncomeMicros < exact.financials.totals.netIncomeMicros,
    'building 40% more than can be sold cannot make the plan more profitable',
  );
});

test('cash TIES to profit through the closing working-capital position, or it blocks', () => {
  for (const [label, m] of [['sold out', model()], ['over-built', model({ runQtyUnits: 1400 })]]) {
    const r = m.financials.reconciliation;
    assert.ok(r.ties, `${label}: residual ${r.residualMicros} exceeds tolerance ${r.toleranceMicros}`);
    assert.equal(
      r.expectedCashMicros,
      r.netIncomeMicros + r.closingPayableMicros - r.closingReceivableMicros - r.closingInventoryMicros
        - r.returnsSalvageCreditMicros - r.purchaseRoundingMicros - r.landedRoundingMicros,
      `${label}: the bridge is the sum of its named terms`,
    );
    assert.ok(!m.financials.issues.some((i) => i.code === 'reconciliation-residual'), `${label}: no residual issue`);
    assert.ok(!m.financials.issues.some((i) => i.code === 'landed-cash-mismatch'), `${label}: every landed leg is paid`);
  }
});

test('the reconciliation goes RED when a cost is spent in one statement and not the other', () => {
  // Mutation: drop the inventory write-down the schedule computed. This is exactly
  // the defect that shipped — cost of goods on sale, nothing anywhere for the rest
  // of the run — and the reconciliation is what has to catch it.
  const m = model({ runQtyUnits: 1400 });
  const broken = Fin.computeFinancials({
    ...financialsInputOf(m), inventoryChargeByMonth: {},
  });
  const blocked = broken.issues.find((i) => i.code === 'reconciliation-residual');
  assert.ok(blocked, 'an omitted cost must surface as an issue, not as a paragraph of prose');
  assert.equal(blocked.severity, 'block');
  assert.equal(broken.reconciliation.ties, false);
  assert.equal(
    Math.abs(broken.reconciliation.residualMicros),
    m.financials.totals.inventoryWriteDownMicros,
    'the residual is exactly the cost that went missing',
  );
});

test('a landed leg that leaves cost of goods but not the bank BLOCKS', () => {
  // Mutation: strip the import charges out of the cash calendar while leaving the
  // landed cost they came from intact — the shape of the marine-insurance defect.
  const m = model();
  const input = financialsInputOf(m);
  const starved = Fin.computeFinancials({
    ...input,
    events: input.events.filter((e) => e.kind !== 'freight' && e.kind !== 'duty-and-fees'),
  });
  const blocked = starved.issues.find((i) => i.code === 'landed-cash-mismatch');
  assert.ok(blocked && blocked.severity === 'block');
  assert.match(blocked.message, /funding requirement is understated/);
});

test('the cash statement chains: each month opens where the last one closed', () => {
  const m = model();
  let expected = 0;
  for (const row of m.financials.cash) {
    assert.equal(row.openingMicros, expected, `${row.month} opens where the prior month closed`);
    assert.equal(row.closingMicros, row.openingMicros + row.netMicros);
    assert.equal(row.netMicros, row.inflowsMicros + row.outflowsMicros);
    expected = row.closingMicros;
  }
});

test('tooling amortises across the months that actually sell, and sums to the tooling spend', () => {
  const m = model();
  const total = m.financials.pnl.reduce((a, p) => a + p.toolingAmortizationMicros, 0);
  assert.equal(total, D(2000));
  // Nothing sells before October, so nothing amortises before October.
  assert.equal(monthOf(m.financials.pnl, '2026-09').toolingAmortizationMicros, 0);
  assert.equal(monthOf(m.financials.pnl, '2026-10').toolingAmortizationMicros, D(2000));
});

test('headcount is plan-altitude and says so: burden is one labelled rate, months are whole', () => {
  const H = engine('venture-headcount');
  const employee = {
    id: 'e', title: 'Engineer', kind: 'employee', startMonth: '2026-03', endMonth: '2026-05',
    annualBaseMicros: D(120000), fteRatio: 1, burdenBps: 3000, oneTimeRecruitMicros: D(5000),
    assumptionRefs: [],
  };
  const r = H.computeHeadcount([employee], ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
  // $120,000 x 1.30 / 12 = $13,000 a month.
  assert.equal(r.byMonth['2026-04'].costMicros, D(13000));
  // The recruiting fee lands whole in the start month, on top of the salary.
  assert.equal(r.byMonth['2026-03'].costMicros, D(18000));
  assert.equal(r.byMonth['2026-02'].costMicros, 0);
  assert.equal(r.byMonth['2026-06'].costMicros, 0);
  assert.equal(r.totalMicros, D(13000) * 3 + D(5000));
  assert.equal(r.peakFte, 1);
  assert.equal(r.peakFteMonth, '2026-03');
  // A contractor carries no employer burden by definition.
  const contractor = H.computeHeadcount([{ ...employee, kind: 'contractor', oneTimeRecruitMicros: 0 }], ['2026-04']);
  assert.equal(contractor.byMonth['2026-04'].costMicros, D(10000));
});
