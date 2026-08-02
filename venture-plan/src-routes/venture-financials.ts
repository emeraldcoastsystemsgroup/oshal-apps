/**
 * Venture engine — monthly profit and loss, cash flow, working capital,
 * break-even and the peak cash requirement.
 *
 * WHY P&L AND CASH ARE COMPUTED SEPARATELY AND ARE ALLOWED TO DISAGREE. Cost of
 * goods is recognised on SALE; it is PAID at the purchase order, months earlier.
 * Revenue is recognised on sale; it is RECEIVED on the channel's terms, months
 * later. Those two lags are the whole story of a seasonal physical product, and a
 * model that computes cash by adjusting profit rather than by adding up dated
 * events will get the trough month wrong — which is the one month that decides
 * whether the company survives.
 *
 * WHY BREAK-EVEN IS A SEARCH AND NOT `fixed / contribution`. Contribution is not
 * constant in volume. Ocean freight is a step function of container count, price
 * breaks are steps, and supplier minimums force overbuy at low volume. So
 * `computeBreakEven` bisects over models REBUILT at each candidate volume, and
 * keeps the textbook formula only as a cross-check that raises an issue when the
 * two disagree by more than a percent. That makes the break-even/P&L consistency
 * exact by construction instead of an approximation the guards have to tolerate.
 *
 * WHY A NON-POSITIVE CONTRIBUTION RETURNS NULL. `fixed / contribution` with a
 * negative contribution returns a negative number that reads to a human like an
 * achievable target. There is no break-even volume for a product that loses money
 * on every unit, and the model says so.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — monthly P&L with COGS on sale, cash from the dated event stream, working capital from the recognition-versus-settlement gap, the peak cash trough and its funding requirement, and break-even by bisection over rebuilt models with a closed-form cross-check.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | The profit statement now charges the cost of stock that did NOT sell. Recognising cost of goods only on units sold, with nothing anywhere for the rest of the run, made reported profit RISE with the size of the over-build — the plan's headline verdict inverted. Added the reconciliation the module always claimed and never had: cash at the horizon end must tie to net income through the closing working-capital position, and a residual is a BLOCKING issue rather than a paragraph of prose explaining a permanent difference as a timing one. Accounts payable is now what has been incurred and not yet paid, rather than the entire future purchase programme from month one.
 *
 * @module venture-financials
 */

import { normalisedShares, type Channel, type ChannelWaterfall } from './venture-channels';
import type { HeadcountResult } from './venture-headcount';
import { issue, type VentureIssue } from './venture-issues';
import type { CashEvent } from './venture-schedule';
import {
  MICROS_PER_DOLLAR, addMicros, allocateMicros, applyBps, roundHalfUp, scaleMicros, subMicros, ymCompare,
  type Micros, type YearMonth,
} from './venture-primitives';

/** One month of the profit and loss statement. */
export interface MonthlyPnl {
  month: YearMonth;
  revenueMicros: Micros;
  cogsMicros: Micros;
  /**
   * The cost of stock that did not sell: the write-down net of liquidation
   * proceeds in the month the leftovers are dumped, or the holding cost in each
   * month they are carried. It sits inside gross profit because units bought to
   * sell and never sold are a cost of the same programme — and because leaving it
   * out is how a plan reports MORE profit the more it over-builds.
   */
  inventoryWriteDownMicros: Micros;
  grossProfitMicros: Micros;
  channelFeeMicros: Micros;
  marketingMicros: Micros;
  payrollMicros: Micros;
  opexMicros: Micros;
  ebitdaMicros: Micros;
  toolingAmortizationMicros: Micros;
  netIncomeMicros: Micros;
  cumulativeNetIncomeMicros: Micros;
}

/** One month of the cash statement. */
export interface MonthlyCash {
  month: YearMonth;
  openingMicros: Micros;
  inflowsMicros: Micros;
  outflowsMicros: Micros;
  netMicros: Micros;
  closingMicros: Micros;
  /** Closing position measured from the opening cash — the funding curve. */
  cumulativeMicros: Micros;
}

/** One month of the working-capital position. */
export interface MonthlyWorkingCapital {
  month: YearMonth;
  inventoryUnits: number;
  inventoryValueMicros: Micros;
  accountsReceivableMicros: Micros;
  accountsPayableMicros: Micros;
  workingCapitalMicros: Micros;
}

/** The funding requirement, stated as the cheque somebody has to write. */
export interface PeakCash {
  /** The most negative cumulative cash position; zero or below. */
  troughMicros: Micros;
  month: YearMonth | null;
  /** `max(0, -trough)` — the money needed before revenue exists. */
  fundingRequiredMicros: Micros;
  monthsUnderwater: number;
}

/** Break-even in units and in dates. */
export interface BreakEven {
  /** Search-derived over rebuilt models. Null when no volume breaks even. */
  units: number | null;
  /** Textbook cross-check; a divergence over 1% raises an issue. */
  unitsClosedForm: number | null;
  /** First month cumulative NET INCOME turns non-negative. */
  accountingBreakEvenMonth: YearMonth | null;
  /** First month cumulative CASH turns non-negative. Allowed to differ. */
  cashBreakEvenMonth: YearMonth | null;
  contributionPerUnitMicros: Micros;
  fixedCostsMicros: Micros;
  horizonMonths: number;
  issues: VentureIssue[];
}

/** Everything the financial statements need. */
export interface FinancialsInput {
  horizon: YearMonth[];
  events: CashEvent[];
  unitsSoldByMonth: Record<YearMonth, number>;
  unitsOnHandByMonth: Record<YearMonth, number>;
  landedUnitMicros: Micros;
  waterfalls: ChannelWaterfall[];
  channels: Channel[];
  headcount: HeadcountResult;
  fixedOpexByMonth: Record<YearMonth, Micros>;
  oneTimeToolingMicros: Micros;
  openingCashMicros: Micros;
  /** The cost of what did not sell, by month — from the schedule, computed once. */
  inventoryChargeByMonth: Record<YearMonth, Micros>;
  /** Units in the production run, for the reconciliation bridge. */
  unitsBuilt: number;
  /** Buyer-paid landed cost of the whole run, for the reconciliation bridge. */
  landedBuyerTotalMicros: Micros;
  /**
   * `runRecurringMicros - recurringUnitMicros x units`. Purchase orders are paid at
   * line totals while cost of goods is expensed at the rounded per-unit landed cost;
   * the difference is named here so the reconciliation does not absorb it as slack.
   */
  purchaseRoundingMicros: Micros;
}

/**
 * The tie between the profit statement and the cash statement, stated term by term.
 *
 * WHY THIS EXISTS. The two statements are ALLOWED to differ — that is the whole
 * point of a seasonal model — but every micro of the difference has to have a name.
 * When it did not, a permanent difference (the cost of stock that never sold) was
 * published as a timing one, in a document whose own horizon had fifteen months of
 * settled quiet after the last cash event. A residual here is a defect in the
 * engine, so it blocks.
 */
export interface Reconciliation {
  cumulativeCashMicros: Micros;
  netIncomeMicros: Micros;
  closingReceivableMicros: Micros;
  closingInventoryMicros: Micros;
  closingPayableMicros: Micros;
  /** Non-cash cost credit for resellable returns: landed x sold, less COGS expensed. */
  returnsSalvageCreditMicros: Micros;
  purchaseRoundingMicros: Micros;
  /** `landedBuyerTotal - landedUnit x unitsBuilt` — the per-unit rounding of the landed stack. */
  landedRoundingMicros: Micros;
  /** What the cash statement must show if every difference is accounted for. */
  expectedCashMicros: Micros;
  residualMicros: Micros;
  toleranceMicros: Micros;
  ties: boolean;
}

/** The three statements plus the funding requirement. */
export interface FinancialsResult {
  pnl: MonthlyPnl[];
  cash: MonthlyCash[];
  workingCapital: MonthlyWorkingCapital[];
  peakCash: PeakCash;
  totals: {
    revenueMicros: Micros; netIncomeMicros: Micros; contributionMicros: Micros;
    fixedCostsMicros: Micros; inventoryWriteDownMicros: Micros;
  };
  /** Payroll and opex events this module adds to the schedule's stream. */
  derivedEvents: CashEvent[];
  reconciliation: Reconciliation;
  issues: VentureIssue[];
}

/** Per-unit revenue, fee, marketing and contribution, blended across the mix. */
export interface BlendedUnitEconomics {
  grossRevenueMicros: Micros;
  channelFeeMicros: Micros;
  marketingMicros: Micros;
  cogsMicros: Micros;
  contributionMicros: Micros;
}

/**
 * @description Blend per-unit economics across the channel mix. Marketing is
 *   split out of the channel fee stack (acquisition and advertising spend are
 *   marketing, not a channel charge) so the P&L reads the way an operator expects.
 * @param waterfalls - One waterfall per channel.
 * @param channels - The channels carrying the volume shares.
 * @returns Volume-weighted per-unit revenue, fees, marketing, COGS and contribution.
 */
export function blendedUnitEconomics(
  waterfalls: readonly ChannelWaterfall[], channels: readonly Channel[],
): BlendedUnitEconomics {
  const shares = normalisedShares(channels);
  let gross = 0;
  let fee = 0;
  let marketing = 0;
  let cogs = 0;
  channels.forEach((c, i) => {
    const w = waterfalls.find((x) => x.channelId === c.id);
    if (!w) return;
    const share = shares[i] ?? 0;
    gross += w.grossRevenueMicros * share;
    fee += (w.totalFeeMicros - w.marketingMicros) * share;
    marketing += w.marketingMicros * share;
    cogs += applyBps(w.landedUnitMicros, w.landedFactorBps) * share;
  });
  const g = roundHalfUp(gross);
  const f = roundHalfUp(fee);
  const m = roundHalfUp(marketing);
  const c = roundHalfUp(cogs);
  return {
    grossRevenueMicros: g, channelFeeMicros: f, marketingMicros: m, cogsMicros: c,
    contributionMicros: subMicros(subMicros(subMicros(g, f), m), c),
  };
}

/** Build the monthly P&L. Tooling amortises across the months that actually sell. */
function buildPnl(input: FinancialsInput, unit: BlendedUnitEconomics): MonthlyPnl[] {
  const soldWeights = input.horizon.map((m) => input.unitsSoldByMonth[m] ?? 0);
  const amortization = allocateMicros(input.oneTimeToolingMicros, soldWeights);
  let cumulative = 0;
  return input.horizon.map((month, i) => {
    const units = soldWeights[i];
    const revenueMicros = scaleMicros(unit.grossRevenueMicros, units);
    const cogsMicros = scaleMicros(unit.cogsMicros, units);
    const inventoryWriteDownMicros = input.inventoryChargeByMonth[month] ?? 0;
    const channelFeeMicros = scaleMicros(unit.channelFeeMicros, units);
    const marketingMicros = scaleMicros(unit.marketingMicros, units);
    const payrollMicros = input.headcount.byMonth[month]?.costMicros ?? 0;
    const opexMicros = input.fixedOpexByMonth[month] ?? 0;
    const grossProfitMicros = subMicros(subMicros(revenueMicros, cogsMicros), inventoryWriteDownMicros);
    const ebitdaMicros = subMicros(grossProfitMicros, addMicros(channelFeeMicros, marketingMicros, payrollMicros, opexMicros));
    const toolingAmortizationMicros = amortization[i];
    const netIncomeMicros = subMicros(ebitdaMicros, toolingAmortizationMicros);
    cumulative = addMicros(cumulative, netIncomeMicros);
    return {
      month, revenueMicros, cogsMicros, inventoryWriteDownMicros, grossProfitMicros,
      channelFeeMicros, marketingMicros,
      payrollMicros, opexMicros, ebitdaMicros, toolingAmortizationMicros, netIncomeMicros,
      cumulativeNetIncomeMicros: cumulative,
    };
  });
}

/**
 * Payroll, fixed opex and acquisition spend become dated cash events so the cash
 * statement is ONE stream. Marketing is here rather than netted out of the channel
 * remittance because it is money you pay out, not money the channel withholds.
 */
function derivedCashEvents(input: FinancialsInput, pnl: readonly MonthlyPnl[]): CashEvent[] {
  const out: CashEvent[] = [];
  input.horizon.forEach((month, i) => {
    const payroll = input.headcount.byMonth[month]?.costMicros ?? 0;
    if (payroll) out.push({ month, kind: 'payroll', amountMicros: -payroll, note: 'Fully-loaded headcount', assumptionRefs: input.headcount.assumptionRefs });
    const opex = input.fixedOpexByMonth[month] ?? 0;
    if (opex) out.push({ month, kind: 'opex', amountMicros: -opex, note: 'Fixed operating expenses', assumptionRefs: [] });
    const marketing = pnl[i]?.marketingMicros ?? 0;
    if (marketing) out.push({ month, kind: 'marketing', amountMicros: -marketing, note: 'Customer acquisition and advertising', assumptionRefs: [] });
  });
  return out;
}

/** Build the monthly cash statement from the whole dated event stream. */
function buildCash(horizon: readonly YearMonth[], events: readonly CashEvent[], openingCash: Micros): MonthlyCash[] {
  let opening = openingCash;
  return horizon.map((month) => {
    const inMonth = events.filter((e) => e.month === month);
    const inflowsMicros = addMicros(...inMonth.filter((e) => e.amountMicros > 0).map((e) => e.amountMicros));
    const outflowsMicros = addMicros(...inMonth.filter((e) => e.amountMicros < 0).map((e) => e.amountMicros));
    const netMicros = addMicros(inflowsMicros, outflowsMicros);
    const closingMicros = addMicros(opening, netMicros);
    const row: MonthlyCash = {
      month, openingMicros: opening, inflowsMicros, outflowsMicros, netMicros, closingMicros,
      cumulativeMicros: subMicros(closingMicros, openingCash),
    };
    opening = closingMicros;
    return row;
  });
}

/** Cash kinds that settle a receivable the profit statement already recognised. */
const RECEIPT_KINDS: ReadonlySet<string> = new Set(['channel-remittance', 'retailer-payment']);

/** Cash kinds that settle an obligation for goods, freight, duty or tooling. */
const SUPPLY_KINDS: ReadonlySet<string> = new Set(['po-deposit', 'po-balance', 'freight', 'duty-and-fees', 'tooling']);

/**
 * Build the working-capital position from the recognition-versus-settlement gap.
 *
 * ACCOUNTS PAYABLE IS WHAT HAS BEEN INCURRED AND NOT YET PAID — not, as an earlier
 * build had it, the entire future purchase programme from the first month of the
 * horizon regardless of date. That version published a working-capital position of
 * minus a million dollars in a month with no inventory, no receivables and no
 * activity of any kind, which is not a conservative reading of anything; it is a
 * column of numbers that means nothing. The obligation date comes from the cash
 * event's own `incurredMonth`, so a purchase-order balance becomes payable when the
 * goods ship and stops being payable when the supplier is paid.
 */
function buildWorkingCapital(
  input: FinancialsInput, pnl: readonly MonthlyPnl[], events: readonly CashEvent[],
): MonthlyWorkingCapital[] {
  const supply = events.filter((e) => SUPPLY_KINDS.has(e.kind));
  let recognisedRevenue = 0;
  let receivedCash = 0;
  return input.horizon.map((month, i) => {
    recognisedRevenue = addMicros(recognisedRevenue, pnl[i].revenueMicros, -pnl[i].channelFeeMicros);
    receivedCash = addMicros(receivedCash, ...events.filter((e) => e.month === month && RECEIPT_KINDS.has(e.kind)).map((e) => e.amountMicros));
    const inventoryUnits = input.unitsOnHandByMonth[month] ?? 0;
    const inventoryValueMicros = scaleMicros(input.landedUnitMicros, inventoryUnits);
    // Not clamped at zero. A negative position is money taken before it was earned
    // or an obligation settled before it arose, and both are findings a reader
    // should see rather than a floor the column quietly applies.
    const accountsReceivableMicros = subMicros(recognisedRevenue, receivedCash);
    const accountsPayableMicros = subMicros(0, addMicros(...supply
      .filter((e) => ymCompare(e.incurredMonth ?? e.month, month) <= 0 && ymCompare(e.month, month) > 0)
      .map((e) => e.amountMicros)));
    return {
      month, inventoryUnits, inventoryValueMicros, accountsReceivableMicros, accountsPayableMicros,
      workingCapitalMicros: subMicros(addMicros(inventoryValueMicros, accountsReceivableMicros), accountsPayableMicros),
    };
  });
}

/**
 * @description Tie the cash statement to the profit statement, term by term, and
 *   report the residual. The bridge is the indirect method with every term this
 *   engine can actually produce: closing receivables, closing inventory at landed
 *   cost, closing payables, the non-cash cost credit for resellable returns, and
 *   the two rounding residuals the money units make unavoidable. Anything left over
 *   is an engine defect, not a rounding fact of life, and it blocks.
 * @param input - The financials input.
 * @param pnl - The completed profit statement.
 * @param cash - The completed cash statement.
 * @param wc - The completed working-capital position.
 * @returns Every bridge term, the expected cash figure, and whether it ties.
 */
export function reconcile(
  input: FinancialsInput, pnl: readonly MonthlyPnl[], cash: readonly MonthlyCash[],
  wc: readonly MonthlyWorkingCapital[],
): Reconciliation {
  const last = <T>(rows: readonly T[]): T | null => (rows.length ? rows[rows.length - 1] : null);
  const cumulativeCashMicros = last(cash)?.cumulativeMicros ?? 0;
  const netIncomeMicros = last(pnl)?.cumulativeNetIncomeMicros ?? 0;
  const closing = last(wc);
  const closingReceivableMicros = closing?.accountsReceivableMicros ?? 0;
  const closingInventoryMicros = closing?.inventoryValueMicros ?? 0;
  const closingPayableMicros = closing?.accountsPayableMicros ?? 0;
  const unitsSold = input.horizon.reduce((a, m) => a + (input.unitsSoldByMonth[m] ?? 0), 0);
  const cogsExpensed = addMicros(...pnl.map((p) => p.cogsMicros));
  const returnsSalvageCreditMicros = subMicros(scaleMicros(input.landedUnitMicros, unitsSold), cogsExpensed);
  const landedRoundingMicros = subMicros(
    input.landedBuyerTotalMicros, scaleMicros(input.landedUnitMicros, Math.max(0, Math.trunc(input.unitsBuilt))),
  );
  const expectedCashMicros = subMicros(
    addMicros(netIncomeMicros, closingPayableMicros),
    addMicros(closingReceivableMicros, closingInventoryMicros, returnsSalvageCreditMicros,
      input.purchaseRoundingMicros, landedRoundingMicros),
  );
  const residualMicros = subMicros(cumulativeCashMicros, expectedCashMicros);
  const toleranceMicros = reconciliationTolerance(input);
  return {
    cumulativeCashMicros, netIncomeMicros, closingReceivableMicros, closingInventoryMicros,
    closingPayableMicros, returnsSalvageCreditMicros,
    purchaseRoundingMicros: input.purchaseRoundingMicros, landedRoundingMicros,
    expectedCashMicros, residualMicros, toleranceMicros,
    ties: Math.abs(residualMicros) <= toleranceMicros,
  };
}

/**
 * @description How much residual is rounding rather than a defect. Every per-unit
 *   figure is re-integerised once, so the slack scales with units and months — but
 *   it stays orders of magnitude below the dollars an omitted cost line is worth.
 * @param input - The financials input.
 * @returns The tolerance in micros.
 */
function reconciliationTolerance(input: FinancialsInput): Micros {
  const units = Math.max(0, Math.trunc(input.unitsBuilt));
  return Math.max(MICROS_PER_DOLLAR, units * 32 + input.horizon.length * 64);
}

/**
 * @description The deepest cash hole and the month it falls in.
 * @param cash - The monthly cash statement.
 * @returns The trough, its month, the funding requirement and how long it lasts.
 */
export function computePeakCash(cash: readonly MonthlyCash[]): PeakCash {
  let troughMicros = 0;
  let month: YearMonth | null = null;
  let monthsUnderwater = 0;
  for (const row of cash) {
    if (row.cumulativeMicros < 0) monthsUnderwater += 1;
    if (row.cumulativeMicros < troughMicros) {
      troughMicros = row.cumulativeMicros;
      month = row.month;
    }
  }
  return { troughMicros, month, fundingRequiredMicros: Math.max(0, -troughMicros), monthsUnderwater };
}

/**
 * @description Build all three statements plus the funding requirement.
 * @param input - The schedule's events, the volumes, the channels and the fixed costs.
 * @returns The P&L, cash statement, working-capital position, peak cash, totals,
 *   the payroll/opex events this module contributed, and any issues.
 */
export function computeFinancials(input: FinancialsInput): FinancialsResult {
  const unit = blendedUnitEconomics(input.waterfalls, input.channels);
  const pnl = buildPnl(input, unit);
  const derivedEvents = derivedCashEvents(input, pnl);
  const events = [...input.events, ...derivedEvents];
  const cash = buildCash(input.horizon, events, input.openingCashMicros);
  const workingCapital = buildWorkingCapital(input, pnl, events);
  const totalUnits = input.horizon.reduce((a, m) => a + (input.unitsSoldByMonth[m] ?? 0), 0);
  const revenueMicros = addMicros(...pnl.map((p) => p.revenueMicros));
  const netIncomeMicros = pnl.length ? pnl[pnl.length - 1].cumulativeNetIncomeMicros : 0;
  const contributionMicros = scaleMicros(unit.contributionMicros, totalUnits);
  const inventoryWriteDownMicros = addMicros(...pnl.map((p) => p.inventoryWriteDownMicros));
  const reconciliation = reconcile(input, pnl, cash, workingCapital);
  const issues: VentureIssue[] = [];
  if (!reconciliation.ties) {
    issues.push(issue('reconciliation-residual', 'block', 'financials:reconciliation',
      `The cash statement closes at ${reconciliation.cumulativeCashMicros} micros but the profit statement, adjusted for closing receivables, inventory, payables and the non-cash returns credit, implies ${reconciliation.expectedCashMicros}. The unexplained ${reconciliation.residualMicros} micros is a cost the model spends in one statement and not the other. Every difference between profit and cash in a seasonal plan has a name; an unnamed one is a defect, not a timing effect.`,
      { residualMicros: reconciliation.residualMicros, toleranceMicros: reconciliation.toleranceMicros }));
  }
  issues.push(...logisticsCashIssues(input, events));
  return {
    pnl, cash, workingCapital, peakCash: computePeakCash(cash), derivedEvents, reconciliation,
    totals: {
      revenueMicros, netIncomeMicros, contributionMicros, inventoryWriteDownMicros,
      // Contribution less net income is headcount, opex, tooling AND the cost of
      // what did not sell. The last of those is not a fixed cost — it scales with
      // how far the run over-shot demand — so it is taken back out. Leaving it in
      // would double-count it in the break-even sell-through inversion, which
      // charges the same write-down again on the units it solves for.
      fixedCostsMicros: subMicros(subMicros(contributionMicros, netIncomeMicros), inventoryWriteDownMicros),
    },
    issues,
  };
}

/**
 * @description Assert that every buyer-paid leg of the landed stack leaves the
 *   bank. Marine insurance and warehouse-in were once inside cost of goods and
 *   inside no cash event, and under EXW the origin legs leaked the same way — money
 *   the plan spends and never has to find. The check is on TOTALS, so a leg added
 *   to the stack later cannot quietly skip the cash statement.
 * @param input - The financials input.
 * @param events - Every cash event, schedule plus derived.
 * @returns A blocking issue when the two totals disagree beyond rounding.
 */
function logisticsCashIssues(input: FinancialsInput, events: readonly CashEvent[]): VentureIssue[] {
  const goodsCashOut = -addMicros(...events.filter((e) => SUPPLY_KINDS.has(e.kind) && e.kind !== 'tooling').map((e) => e.amountMicros));
  const owed = addMicros(input.landedBuyerTotalMicros, input.purchaseRoundingMicros);
  const gap = subMicros(goodsCashOut, owed);
  const tolerance = reconciliationTolerance(input);
  if (Math.abs(gap) <= tolerance) return [];
  return [issue('landed-cash-mismatch', 'block', 'financials:landed-cash',
    `The landed cost of the run is ${owed} micros but the cash calendar only pays ${goodsCashOut}. A leg of the landed stack is inside cost of goods and inside no outflow, so the funding requirement is understated by ${gap} micros.`,
    { landedOwedMicros: owed, goodsCashOutMicros: goodsCashOut, gapMicros: gap })];
}

/**
 * @description Break-even in units, found by bisection over models REBUILT at
 *   each candidate volume — because contribution moves with volume once freight
 *   containers, price breaks and supplier minimums are in the model. The textbook
 *   formula is computed alongside as a cross-check, and a divergence over one
 *   percent is reported rather than averaged away.
 * @param rebuild - Rebuilds the financial result at a candidate run volume.
 * @param bracket - Search bounds in units.
 * @param contributionPerUnitMicros - Contribution at the model's own volume.
 * @param fixedCostsMicros - Fixed costs at the model's own volume.
 * @param horizonMonths - Horizon length, reported alongside the answer.
 * @returns Break-even units, the closed-form cross-check, both break-even months, and issues.
 */
export function computeBreakEven(
  rebuild: (units: number) => FinancialsResult,
  bracket: { lowUnits: number; highUnits: number },
  contributionPerUnitMicros: Micros,
  fixedCostsMicros: Micros,
  horizonMonths: number,
): BreakEven {
  const issues: VentureIssue[] = [];
  const base = rebuild(bracket.highUnits);
  const accountingBreakEvenMonth = base.pnl.find((p) => p.cumulativeNetIncomeMicros >= 0)?.month ?? null;
  const cashBreakEvenMonth = base.cash.find((c) => c.cumulativeMicros >= 0)?.month ?? null;
  const unitsClosedForm = contributionPerUnitMicros > 0
    ? Math.ceil(fixedCostsMicros / contributionPerUnitMicros)
    : null;
  if (!(contributionPerUnitMicros > 0)) {
    issues.push(issue('no-break-even', 'block', 'financials:break-even',
      `Contribution is ${contributionPerUnitMicros} micros per unit, so every additional unit deepens the loss. There is no break-even volume, and dividing fixed cost by a negative contribution would return a number that reads like an achievable target.`,
      { contributionPerUnitMicros }));
    return { units: null, unitsClosedForm, accountingBreakEvenMonth, cashBreakEvenMonth, contributionPerUnitMicros, fixedCostsMicros, horizonMonths, issues };
  }
  const profitable = (u: number): boolean => rebuild(u).pnl.slice(-1)[0]?.cumulativeNetIncomeMicros >= 0;
  const found = bisectUnits(bracket, profitable, issues);
  issues.push(...monotonicityIssues(profitable, bracket.highUnits, found));
  if (found !== null && unitsClosedForm !== null && unitsClosedForm > 0) {
    const drift = Math.abs(found - unitsClosedForm) / unitsClosedForm;
    if (drift > 0.01) {
      issues.push(issue('break-even-crosscheck-diverged', 'warn', 'financials:break-even',
        `Break-even by search is ${found} units; the textbook fixed-over-contribution formula says ${unitsClosedForm}. They diverge by ${(drift * 100).toFixed(1)}% because contribution is not constant in volume here — freight containers, price breaks and supplier minimums all step. The search figure is the one that ties to the P&L.`,
        { searchUnits: found, closedFormUnits: unitsClosedForm, driftPct: roundHalfUp(drift * 1000) / 10 }));
    }
  }
  return { units: found, unitsClosedForm, accountingBreakEvenMonth, cashBreakEvenMonth, contributionPerUnitMicros, fixedCostsMicros, horizonMonths, issues };
}

/**
 * @description Scan a coarse grid for a profitability flip. Freight container
 *   steps, price breaks and supplier minimums genuinely make profit non-monotone
 *   in volume — one unit past a container boundary buys a whole extra container —
 *   and a bisected answer over a non-monotone predicate is A crossing, not
 *   provably THE smallest one. When that happens the reader is told, because a
 *   single confident break-even across a step is the failure-that-reports-success
 *   this engine exists to prevent.
 *   The grid INCLUDES the bisected answer, because the crossing the search found
 *   is usually the very point a fixed grid steps over — checking a grid that does
 *   not contain it would report monotone every time.
 * @param profitable - Predicate over run volume.
 * @param hi - Upper bound of the search.
 * @param found - The bisected break-even volume, or null when none was found.
 * @returns The issue list; empty when profitability is monotone on the grid.
 */
function monotonicityIssues(profitable: (u: number) => boolean, hi: number, found: number | null): VentureIssue[] {
  const top = Math.max(1, Math.trunc(hi));
  const points = Array.from({ length: 12 }, (_, i) => Math.max(1, Math.round((top * (i + 1)) / 12)));
  if (found !== null) points.push(found);
  const grid = [...new Set(points)].sort((a, b) => a - b);
  const marks = grid.map((u) => ({ u, ok: profitable(u) }));
  const first = marks.findIndex((m) => m.ok);
  if (first === -1) return [];
  const relapse = marks.slice(first).find((m) => !m.ok);
  if (!relapse) return [];
  return [issue('non-monotone-inversion', 'warn', 'financials:break-even',
    `Profit is not monotone in volume: the plan is profitable at ${marks[first].u} units and unprofitable again at ${relapse.u}. That is what a freight container boundary, a quantity price break or a supplier minimum does. The break-even figure below is the crossing the search found, not a proven global minimum — read it with the volume sensitivity beside it.`,
    { profitableAt: marks[first].u, unprofitableAt: relapse.u })];
}

/** Integer bisection for the smallest volume that turns a profit over the horizon. */
function bisectUnits(
  bracket: { lowUnits: number; highUnits: number }, profitable: (u: number) => boolean, issues: VentureIssue[],
): number | null {
  let lo = Math.max(0, Math.trunc(bracket.lowUnits));
  let hi = Math.max(lo + 1, Math.trunc(bracket.highUnits));
  if (!profitable(hi)) {
    issues.push(issue('break-even-outside-bracket', 'warn', 'financials:break-even',
      `No volume up to ${hi} units turns a profit over the horizon, so break-even lies outside the range this plan contemplates.`,
      { searchedTo: hi }));
    return null;
  }
  if (profitable(lo)) return lo;
  for (let i = 0; i < 48 && hi - lo > 1; i += 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (profitable(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * @description Find the first month a monthly series turns non-negative.
 * @param rows - Any monthly series.
 * @param pick - Reads the cumulative figure from a row.
 * @returns The month, or null when it never turns.
 */
export function firstNonNegativeMonth<T extends { month: YearMonth }>(
  rows: readonly T[], pick: (row: T) => Micros,
): YearMonth | null {
  return rows.find((r) => pick(r) >= 0)?.month ?? null;
}

/**
 * @description Total the signed cash events that fall on or before a month.
 * @param cash - The monthly cash statement.
 * @param month - Inclusive cut-off.
 * @returns Cumulative cash movement in micros.
 */
export function cumulativeCashThrough(cash: readonly MonthlyCash[], month: YearMonth): Micros {
  const row = [...cash].reverse().find((c) => ymCompare(c.month, month) <= 0);
  return row ? row.cumulativeMicros : 0;
}
