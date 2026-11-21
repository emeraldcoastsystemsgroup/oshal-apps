/**
 * Garnishment orders on one paycheck: which comes first, how much each may
 * take, and what the law protects.
 *
 * THE FEDERAL CEILINGS ARE CUMULATIVE. 29 CFR 870.11(b)(2): "in no event may the
 * amount of any individual's disposable earnings which may be garnished exceed
 * the percentages specified in section 303", and its four illustrations all
 * subtract what orders WITH PRIORITY already took. So each order's ceiling is
 * measured on the total withheld so far plus itself, not on itself alone:
 *
 *   - support (15 U.S.C. 1673(b)(2)): 50, 55, 60 or 65 percent of disposable
 *     earnings, less what was withheld before it;
 *   - an ordinary creditor writ (15 U.S.C. 1673(a)): the lesser of 25 percent or
 *     the excess over 30 times the federal minimum wage, less what was withheld
 *     before it, so a support order taking 25 percent leaves it nothing;
 *   - a federal agency's administrative wage garnishment, which includes a
 *     Department of Education student-loan order (31 CFR 285.11(i)): the order's
 *     amount up to 15 percent of disposable PAY (which, unlike disposable
 *     earnings, is also after health insurance premiums), at most the excess over
 *     30 times the minimum wage, and, behind any order with priority, at most 25
 *     percent of disposable pay less what that order took;
 *   - a federal tax levy: no CCPA ceiling at all (15 U.S.C. 1673(b)(1)(C)). It
 *     takes the take-home pay above the amount Publication 1494 exempts.
 *
 * PRIORITY IS LAW THE PACKAGE MOSTLY DOES NOT HOLD. 29 CFR 870.1(a): the CCPA
 * does not set priorities, "as such priorities are determined by other Federal
 * statutes or by State law". What federal law does say is applied: support
 * comes before other legal process (42 U.S.C. 666(b)(7); for an agency order,
 * 31 CFR 285.11(i)(3)(i)), except that a levy is ahead of a support order
 * entered AFTER the levy, because only support "entered prior to the date of
 * levy" is exempt from it (26 U.S.C. 6334(a)(8)). Between two or more of the
 * other orders the package does not guess: the person states the order of
 * priority, and a check with that fact missing is refused in words. So is a
 * set of support orders that together ask for more than the ceiling, because
 * how they share it is the work state's law (42 U.S.C. 666(b)(6)(A)(i)(IV)).
 *
 * SOURCES, read on 2026-11-20:
 *   - 15 U.S.C. 1672, 1673 (United States Code, 2024 Edition, govinfo.gov).
 *   - 29 CFR part 870, 870.1, 870.10, 870.11 (eCFR, current to 2026-11-18).
 *   - 29 U.S.C. 206(a)(1)(C) (2024 Edition): the $7.25 federal minimum wage.
 *   - 31 CFR 285.11(c) "Disposable pay" and (i) (eCFR, current to 2026-11-18).
 *   - 42 U.S.C. 666(b)(6)(A)(i) and (b)(7) (2024 Edition).
 *   - 26 U.S.C. 6334(a)(8), (a)(9) and (d) (2024 Edition).
 *   - IRS Publication 1494 (Rev. 12-2025), "Tables for Figuring Amount Exempt from
 *     Levy on Wages, Salary, and Other Income ... in 2026",
 *     https://www.irs.gov/pub/irs-pdf/p1494.pdf — tables 1 and 2.
 *   - IRS Publication 15 (2026), section 9: "If a levy issued in a prior year is
 *     still in effect and the taxpayer submits a new Statement of Exemptions and
 *     Filing Status, use the current year Pub. 1494".
 *   - IRM 5.11.5.4.1(1) (the statement not returned: "married filing separate
 *     with no dependents") and 5.11.5.4.5 (a levy attaches to the usual take-home
 *     pay; deductions in effect when it is served are kept).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 7: one allocator for every garnishment order on a check. Cumulative federal ceilings per 29 CFR 870.11 (support no longer capped at the 25 percent creditor limit), federal administrative wage garnishment per 31 CFR 285.11(i), the federal tax levy against take-home pay above the 2026 Publication 1494 exempt amount, support-before-levy only for support entered before the levy, and refusals in words where priority or allocation is law the package does not hold.
 *
 * @module payroll-garnish
 */

/** The garnishment codes this allocator handles. */
export type GarnishmentCode = 'GARN_SUPPORT' | 'GARN_LEVY' | 'GARN_STUDENT' | 'GARN_CREDITOR';

/** Filing status on the levy's Statement of Exemptions and Filing Status. */
export type LevyFilingStatus = 'single' | 'mfj' | 'hoh' | 'mfs';

/** One order as the check sees it. */
export interface GarnishmentOrder {
  /** The stored election this order is, when it is one. */
  electionId?: string;
  code: GarnishmentCode;
  label: string;
  /** A fixed amount this period, including any arrears being caught up. */
  amountCents: number;
  /** A percentage of disposable earnings (or, for an agency order, disposable pay) the order directs. */
  orderPct?: number;
  /** Support only: the maximum percentage the order and the work state allow (at most 65). */
  supportCcpaPct?: number;
  /** The date the order was served on the employer (for a levy, the date of levy). */
  servedOn?: string;
  /** Support only: the date the support order was entered. */
  enteredOn?: string;
  /** The person-stated order among non-support orders, 1 first. */
  priorityRank?: number;
  /** Levy only. */
  levy?: {
    /** Empty when the statement was not returned. */
    filingStatus: LevyFilingStatus | '';
    dependents: number;
    additionalStandardDeductions: number;
    /** The date of the latest Statement of Exemptions and Filing Status, if any. */
    statementOn?: string;
    /** What is still owed on the levy. */
    balanceCents: number;
  };
}

/** The check facts the allocator needs. */
export interface GarnishmentContext {
  payDate: string;
  periodsPerYear: number;
  federalMinWageCents: number;
  /** 15 U.S.C. 1672(b): earnings less amounts required by law to be withheld. */
  disposableCents: number;
  /** Health insurance premiums withheld this check (31 CFR 285.11(c) "Disposable pay"). */
  healthPremiumCents: number;
  /** Cash wages left after taxes and pre-tax deductions: nothing can be withheld beyond it. */
  cashCents: number;
  /** Voluntary post-tax deductions in effect when the levy was served (they stay, IRM 5.11.5.4.5(2)). */
  voluntaryPostTaxCents: number;
}

/** What one order did. */
export interface GarnishmentApplied {
  electionId?: string;
  code: GarnishmentCode;
  label: string;
  requestedCents: number;
  appliedCents: number;
  /** Requested but not withheld; carried as arrears for every order but a levy. */
  shortfallCents: number;
  reason: string;
}

/** The allocation for a check. */
export interface GarnishmentResult {
  applied: GarnishmentApplied[];
  totalCents: number;
  warnings: string[];
  /** Facts missing or law not held: the check cannot be approved while any remain. */
  refusals: string[];
}

/* ── a stored election as an engine row ──────────────────────────────────── */

/** A stored value as whole cents (BIGINT columns arrive as strings). */
function centsOf(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** A stored DATE as YYYY-MM-DD, or undefined when absent. */
function dateOf(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** A nullable NUMERIC/INTEGER column. */
function optionalNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** The engine's view of a stored deduction election (the fields payroll-payrun's DeductionRow carries). */
export interface StoredElection {
  electionId: string;
  code: string;
  amountCents: number;
  percentOfGross?: number;
  annualLimitCents?: number;
  ytdCents: number;
  arrearsCents: number;
  supportCcpaPct?: number;
  effectiveFrom?: string;
  orderPct?: number;
  servedOn?: string;
  enteredOn?: string;
  priorityRank?: number;
  levy?: NonNullable<GarnishmentOrder['levy']>;
}

/**
 * @description Read a payroll_deduction_elections row into the engine's shape.
 * A levy's balance is what the levy says is owed less what has been withheld.
 * @param e - The stored row.
 * @returns The election as the engine reads it.
 */
export function electionFromRow(e: Record<string, unknown>): StoredElection {
  const code = String(e.code);
  const status = String(e.levy_filing_status || '');
  return {
    electionId: String(e.election_id || ''),
    code,
    amountCents: centsOf(e.amount_cents),
    percentOfGross: optionalNumber(e.percent_of_gross),
    annualLimitCents: optionalNumber(e.annual_limit_cents),
    ytdCents: centsOf(e.ytd_cents),
    arrearsCents: centsOf(e.arrears_cents),
    supportCcpaPct: optionalNumber(e.support_ccpa_pct),
    effectiveFrom: dateOf(e.effective_from),
    orderPct: optionalNumber(e.order_pct),
    servedOn: dateOf(e.served_on),
    enteredOn: dateOf(e.entered_on),
    priorityRank: optionalNumber(e.priority_rank),
    levy: code !== 'GARN_LEVY' ? undefined : {
      filingStatus: (['single', 'mfj', 'hoh', 'mfs'].includes(status) ? status : '') as LevyFilingStatus | '',
      dependents: centsOf(e.levy_dependents),
      additionalStandardDeductions: centsOf(e.levy_additional_std),
      statementOn: dateOf(e.levy_statement_on),
      balanceCents: Math.max(0, centsOf(e.amount_cents) - centsOf(e.lifetime_cents)),
    },
  };
}

/* ── Publication 1494 (Rev. 12-2025): amounts exempt from levy in 2026 ────── */

/** The year Publication 1494 (Rev. 12-2025) covers: "delinquent tax in 2026". */
export const LEVY_TABLE_YEAR = 2026;

/** Pay periods per year → the Publication 1494 column. Daily pay is not a frequency this package runs. */
const LEVY_PERIOD: Record<number, 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'> = {
  52: 'weekly', 26: 'biweekly', 24: 'semimonthly', 12: 'monthly',
};

type LevyColumns = Record<'weekly' | 'biweekly' | 'semimonthly' | 'monthly', number>;

/**
 * Table 1, the "0" dependents column, in cents. Every other column is this plus
 * PUB1494_PER_DEPENDENT per dependent, which is how the table's own "More Than
 * 5" column reads ("309.62 plus 101.92 for each dependent"); the tests check the
 * printed 1-to-5 columns against it cell by cell.
 */
export const PUB1494_BASE: Readonly<Record<LevyFilingStatus, LevyColumns>> = Object.freeze({
  single: { weekly: 30_962, biweekly: 61_923, semimonthly: 67_083, monthly: 134_167 },
  mfj: { weekly: 61_923, biweekly: 123_846, semimonthly: 134_167, monthly: 268_333 },
  hoh: { weekly: 46_442, biweekly: 92_885, semimonthly: 100_625, monthly: 201_250 },
  mfs: { weekly: 30_962, biweekly: 61_923, semimonthly: 67_083, monthly: 134_167 },
});

/** Table 1's "plus ... for each dependent", in cents; the same for every filing status. */
export const PUB1494_PER_DEPENDENT: Readonly<LevyColumns> = Object.freeze({
  weekly: 10_192, biweekly: 20_385, semimonthly: 22_083, monthly: 44_167,
});

/**
 * Table 2, "Additional Exempt Amount" for taxpayers at least 65 and/or blind, in
 * cents, by the number of additional standard deductions claimed on the levy.
 */
export const PUB1494_ADDITIONAL: Readonly<Record<'singleOrHoh' | 'other', LevyColumns[]>> = Object.freeze({
  singleOrHoh: [
    { weekly: 3_942, biweekly: 7_885, semimonthly: 8_542, monthly: 17_083 },
    { weekly: 7_885, biweekly: 15_769, semimonthly: 17_083, monthly: 34_167 },
  ],
  other: [
    { weekly: 3_173, biweekly: 6_346, semimonthly: 6_875, monthly: 13_750 },
    { weekly: 6_346, biweekly: 12_692, semimonthly: 13_750, monthly: 27_500 },
    { weekly: 9_519, biweekly: 19_038, semimonthly: 20_625, monthly: 41_250 },
    { weekly: 12_692, biweekly: 25_385, semimonthly: 27_500, monthly: 55_000 },
  ],
});

/** Thrown when an exempt amount cannot be read from the table held. */
export class LevyTableError extends Error {
  readonly code = 'levy_table_not_held';
}

/**
 * @description The amount of one pay period's take-home pay exempt from a federal levy.
 *
 * A statement not returned is figured "as if the taxpayer is married filing
 * separate with no dependents" (IRM 5.11.5.4.1(1); 26 U.S.C. 6334(d)(2)). The
 * table year is the year of the latest statement, else the levy's own year
 * (Pub 15 (2026), section 9).
 * @param levy - The levy's statement facts and dates.
 * @param periodsPerYear - 52, 26, 24 or 12.
 * @param servedOn - The date of levy.
 * @returns The exempt amount in cents.
 * @throws LevyTableError for a table year or pay period the table does not hold.
 */
export function levyExemptCents(
  levy: NonNullable<GarnishmentOrder['levy']>, periodsPerYear: number, servedOn: string,
): number {
  const tableYear = Number(String(levy.statementOn || servedOn || '').slice(0, 4));
  if (tableYear !== LEVY_TABLE_YEAR) {
    throw new LevyTableError(`The levy's exempt amount comes from the Publication 1494 for ${tableYear || 'the levy year'}, `
      + `and the table held here is for ${LEVY_TABLE_YEAR} (Rev. 12-2025). Nothing was taken from another year's table.`);
  }
  const column = LEVY_PERIOD[periodsPerYear];
  if (!column) throw new LevyTableError(`Publication 1494 has no column for ${periodsPerYear} pay periods a year.`);
  const status: LevyFilingStatus = levy.filingStatus || 'mfs';
  const dependents = levy.filingStatus ? Math.max(0, Math.trunc(levy.dependents || 0)) : 0;
  const base = PUB1494_BASE[status][column] + dependents * PUB1494_PER_DEPENDENT[column];
  const extra = Math.max(0, Math.trunc(levy.additionalStandardDeductions || 0));
  if (!levy.filingStatus || extra === 0) return base;
  const rows = PUB1494_ADDITIONAL[status === 'single' || status === 'hoh' ? 'singleOrHoh' : 'other'];
  if (extra > rows.length) {
    throw new LevyTableError(`Publication 1494 table 2 lists at most ${rows.length} additional standard deductions for this filing status.`);
  }
  return base + rows[extra - 1][column];
}

/* ── the federal ceilings ────────────────────────────────────────────────── */

/** 30 times the federal minimum wage, scaled to the pay period (29 CFR 870.10(c)). */
function protectedFloorCents(ctx: GarnishmentContext): number {
  // 870.10(c)(2): "a calendar month is considered to consist of 4 1/3 workweeks",
  // which is 52/12; a semimonthly period is half of that, 52/24.
  return (ctx.federalMinWageCents * 30 * 52) / ctx.periodsPerYear;
}

/** 15 U.S.C. 1673(a): the lesser of 25 percent or the excess over the protected floor. */
function ordinaryCeilingCents(ctx: GarnishmentContext): number {
  const d = Math.max(0, ctx.disposableCents);
  return Math.max(0, Math.min(d * 0.25, d - protectedFloorCents(ctx)));
}

/* ── priority ────────────────────────────────────────────────────────────── */

/** Whether a support order goes ahead of a given levy (6334(a)(8)). */
function supportBeforeLevy(support: GarnishmentOrder, levy: GarnishmentOrder): boolean {
  return Boolean(support.enteredOn && levy.servedOn && support.enteredOn < levy.servedOn);
}

/**
 * @description Put the orders in the order they are paid, or say what is missing.
 * @param orders - Every garnishment order active on the pay date.
 * @returns The ordered list and any refusals.
 */
export function orderGarnishments(orders: GarnishmentOrder[]): { ordered: GarnishmentOrder[]; refusals: string[] } {
  const refusals: string[] = [];
  const supports = orders.filter((o) => o.code === 'GARN_SUPPORT');
  const others = orders.filter((o) => o.code !== 'GARN_SUPPORT');
  const levies = others.filter((o) => o.code === 'GARN_LEVY');
  for (const levy of levies) {
    if (!levy.servedOn) refusals.push(`${levy.label}: enter the date of levy. It decides which support orders come before it.`);
    for (const s of supports) {
      if (!s.enteredOn) {
        refusals.push(`${s.label}: enter the date this support order was entered. A federal levy is reduced only by `
          + 'support ordered before the levy (26 U.S.C. 6334(a)(8)).');
      }
    }
  }
  if (others.length > 1) {
    const ranks = others.map((o) => o.priorityRank);
    if (ranks.some((r) => !Number.isInteger(r)) || new Set(ranks).size !== ranks.length) {
      refusals.push(`${others.map((o) => o.label).join(', ')}: set the order of priority for each (1 first). Which of these `
        + 'is paid first is set by State law or other federal law (29 CFR 870.1(a)), which this package does not hold.');
    }
  }
  if (refusals.length) return { ordered: [], refusals };
  const ordered = placeSupports([...others].sort((a, b) => (a.priorityRank || 0) - (b.priorityRank || 0)), supports);
  const conflict = ordered.find((o, i) => o.code === 'GARN_SUPPORT'
    && ordered.slice(i + 1).some((l) => l.code === 'GARN_LEVY' && !supportBeforeLevy(o, l)));
  if (conflict) {
    return {
      ordered: [],
      refusals: [`${conflict.label}: this support order was entered after the levy, so the levy comes first (26 U.S.C. `
        + '6334(a)(8)), yet support comes before a creditor or agency order ranked ahead of that levy (42 U.S.C. '
        + '666(b)(7)). Re-check the order of priority set on the non-support orders.'],
    };
  }
  return { ordered, refusals };
}

/**
 * Support goes before every agency order and creditor writ (42 U.S.C. 666(b)(7);
 * 31 CFR 285.11(i)(3)(i)), and before a levy only when entered before it
 * (26 U.S.C. 6334(a)(8)); a support order entered after every levy follows them.
 */
function placeSupports(rankedOthers: GarnishmentOrder[], supports: GarnishmentOrder[]): GarnishmentOrder[] {
  const out: GarnishmentOrder[] = [];
  const unplaced = (pred: (s: GarnishmentOrder) => boolean) => supports.filter((s) => !out.includes(s) && pred(s));
  for (const o of rankedOthers) {
    out.push(...unplaced((s) => o.code !== 'GARN_LEVY' || supportBeforeLevy(s, o)));
    out.push(o);
  }
  out.push(...unplaced(() => true));
  return out;
}

/* ── allocation ──────────────────────────────────────────────────────────── */

/** Running totals while orders are paid in priority. */
interface Running {
  withheld: number;
  cashLeft: number;
}

/** The amount an order asks for this period. */
function requested(o: GarnishmentOrder, base: number): number {
  if (o.code === 'GARN_LEVY') return Math.max(0, Math.round(o.levy?.balanceCents || 0));
  if (o.orderPct !== undefined && o.orderPct > 0) return Math.floor((base * Math.min(100, o.orderPct)) / 100);
  return Math.max(0, Math.round(o.amountCents || 0));
}

/** The most one order may take, before the cash on hand is considered. */
function ceilingFor(o: GarnishmentOrder, ctx: GarnishmentContext, run: Running, warnings: string[]): number {
  const d = Math.max(0, ctx.disposableCents);
  if (o.code === 'GARN_SUPPORT') return Math.max(0, Math.floor((d * Math.min(65, o.supportCcpaPct || 0)) / 100) - run.withheld);
  if (o.code === 'GARN_CREDITOR') return Math.max(0, Math.floor(ordinaryCeilingCents(ctx)) - run.withheld);
  if (o.code === 'GARN_STUDENT') {
    const pay = Math.max(0, d - ctx.healthPremiumCents);
    let cap = Math.min(Math.floor(pay * 0.15), Math.floor(pay - protectedFloorCents(ctx)));
    if (run.withheld > 0) cap = Math.min(cap, Math.floor(pay * 0.25) - run.withheld);
    return Math.max(0, cap);
  }
  // The levy: take-home pay above the exempt amount, after what came first.
  const takeHome = ctx.cashCents - ctx.voluntaryPostTaxCents - run.withheld;
  if (ctx.voluntaryPostTaxCents > 0) {
    warnings.push(`${o.label}: voluntary deductions are treated as in effect when the levy was served; IRS guidance `
      + '(IRM 5.11.5.4.5) is that new voluntary deductions generally should not start after a levy.');
  }
  return Math.max(0, takeHome - levyExemptCents(o.levy!, ctx.periodsPerYear, o.servedOn || ''));
}

/** Plain words for why an order got less than it asked. */
function shortfallReason(o: GarnishmentOrder, byCeiling: boolean): string {
  if (!byCeiling) return 'Not enough cash pay left on this check.';
  switch (o.code) {
    case 'GARN_SUPPORT': return `Held to ${o.supportCcpaPct}% of disposable earnings, counting orders paid before it (15 U.S.C. 1673(b)(2); 29 CFR 870.11).`;
    case 'GARN_CREDITOR': return 'Held to the 15 U.S.C. 1673(a) limit, counting orders paid before it (29 CFR 870.11(b)(2)).';
    case 'GARN_STUDENT': return 'Held to the 31 CFR 285.11(i) limit: 15% of disposable pay, the 30-times-minimum-wage floor, and 25% less orders with priority.';
    default: return 'Held to take-home pay above the Publication 1494 exempt amount.';
  }
}

/**
 * @description Allocate a check's garnishment orders in priority under the federal ceilings.
 * @param orders - Every garnishment order active on the pay date.
 * @param ctx - The check facts.
 * @returns What each order withheld, the total, warnings, and refusals.
 */
export function allocateGarnishments(orders: GarnishmentOrder[], ctx: GarnishmentContext): GarnishmentResult {
  const warnings: string[] = [];
  const { ordered, refusals } = orderGarnishments(orders);
  for (const o of orders) {
    if (o.code === 'GARN_SUPPORT' && !(Number(o.supportCcpaPct) > 0)) {
      refusals.push(`${o.label}: enter the maximum percentage this support order may take (50, 55, 60 or 65, or less if the work state sets less; 15 U.S.C. 1673(b)(2)).`);
    }
  }
  if (refusals.length) return { applied: [], totalCents: 0, warnings, refusals };
  const run: Running = { withheld: 0, cashLeft: Math.max(0, ctx.cashCents) };
  const applied: GarnishmentApplied[] = [];
  for (const o of ordered) {
    const base = o.code === 'GARN_STUDENT' ? Math.max(0, ctx.disposableCents - ctx.healthPremiumCents) : Math.max(0, ctx.disposableCents);
    const want = requested(o, base);
    let ceiling: number;
    try {
      ceiling = ceilingFor(o, ctx, run, warnings);
    } catch (err) {
      if (!(err instanceof LevyTableError)) throw err;
      return { applied: [], totalCents: 0, warnings, refusals: [`${o.label}: ${err.message}`] };
    }
    const cashBefore = run.cashLeft;
    const take = Math.max(0, Math.min(want, ceiling, cashBefore));
    run.withheld += take;
    run.cashLeft -= take;
    applied.push({
      electionId: o.electionId, code: o.code, label: o.label, requestedCents: want, appliedCents: take, shortfallCents: want - take,
      reason: take < want ? shortfallReason(o, ceiling <= cashBefore) : '',
    });
  }
  const shared = supportShareRefusal(applied);
  if (shared) return { applied: [], totalCents: 0, warnings, refusals: [shared] };
  return { applied, totalCents: run.withheld, warnings, refusals };
}

/** Two or more support orders squeezed by the ceiling: how they share it is the work state's law. */
function supportShareRefusal(applied: GarnishmentApplied[]): string {
  const support = applied.filter((a) => a.code === 'GARN_SUPPORT');
  if (support.length < 2 || !support.some((a) => a.shortfallCents > 0)) return '';
  return `${support.map((a) => a.label).join(', ')}: together these support orders ask for more than may be withheld. `
    + "How they share it is set by the law of the state of the employee's principal place of employment "
    + '(42 U.S.C. 666(b)(6)(A)(i)(IV)); enter each order\'s amount as that law allocates it.';
}

/* ── the hours-and-rate check (payroll-engine) ───────────────────────────── */

/** The fields of an hours-and-rate paycheck the bridge reads and rewrites. */
export interface HoursCheckFields {
  grossCents: number;
  tipsCreditedCents: number;
  healthCents: number;
  k401Cents: number;
  fitCents: number;
  ssCents: number;
  medicareCents: number;
  addlMedicareCents: number;
  stateCents: number;
  rothCents: number;
  otherPostTaxCents: number;
  garnishmentCents: number;
  disposableEarningsCents: number;
  netCents: number;
  warnings: string[];
}

const ORDER_LABELS: Record<GarnishmentCode, string> = {
  GARN_SUPPORT: 'Child / spousal support', GARN_LEVY: 'Federal tax levy',
  GARN_STUDENT: 'Federal administrative wage garnishment', GARN_CREDITOR: 'Creditor garnishment',
};

/** Whether a stored code is a garnishment order. */
export function isGarnishmentCode(code: string): code is GarnishmentCode {
  return Object.prototype.hasOwnProperty.call(ORDER_LABELS, code);
}

/**
 * @description Apply an employee's garnishment orders to an hours-and-rate check.
 *
 * The check's single garnishment amount (the employee's "Garnishment ($/period)"
 * field) is replaced by the orders: an order carries the facts its ceiling and
 * priority need, the single amount carries none. Voluntary post-tax deductions on
 * the employee have no start date, so a levy treats them as in effect when it
 * was served, and says so.
 * @param check - The computed check; garnishmentCents, netCents and warnings are rewritten.
 * @param elections - The employee's garnishment elections active on the pay date.
 * @param ctx - Pay periods, pay date and the federal minimum wage.
 * @returns The rows to store against the line and any refusals.
 */
export function applyOrdersToHoursCheck(
  check: HoursCheckFields, elections: StoredElection[],
  ctx: { periodsPerYear: number; payDate: string; federalMinWageCents: number },
): { applied: GarnishmentApplied[]; refusals: string[] } {
  const orders = elections.filter((e) => isGarnishmentCode(e.code)).map((e): GarnishmentOrder => ({
    electionId: e.electionId, code: e.code as GarnishmentCode, label: ORDER_LABELS[e.code as GarnishmentCode],
    amountCents: e.amountCents + e.arrearsCents, orderPct: e.orderPct, supportCcpaPct: e.supportCcpaPct,
    servedOn: e.servedOn, enteredOn: e.enteredOn, priorityRank: e.priorityRank, levy: e.levy,
  }));
  if (!orders.length) return { applied: [], refusals: [] };
  const taxes = check.fitCents + check.ssCents + check.medicareCents + check.addlMedicareCents + check.stateCents;
  const result = allocateGarnishments(orders, {
    ...ctx, disposableCents: check.disposableEarningsCents, healthPremiumCents: check.healthCents,
    cashCents: Math.max(0, check.grossCents - check.tipsCreditedCents - check.healthCents - check.k401Cents - taxes),
    voluntaryPostTaxCents: check.rothCents + check.otherPostTaxCents,
  });
  if (check.garnishmentCents > 0) {
    check.warnings.push('The single garnishment amount on this employee is not used: garnishment orders are on file, '
      + 'and each order carries the facts its limit depends on.');
  }
  check.netCents += check.garnishmentCents - result.totalCents;
  check.garnishmentCents = result.totalCents;
  check.warnings.push(...result.warnings, ...result.refusals.map((r) => `Garnishment not computed: ${r}`));
  for (const a of result.applied) {
    if (a.shortfallCents > 0 && a.code !== 'GARN_LEVY') check.warnings.push(`${a.label}: ${a.shortfallCents} carried to arrears — ${a.reason}`);
  }
  return { applied: result.applied, refusals: result.refusals };
}

/* ── an order as a person enters it ──────────────────────────────────────── */

/** The stored facts of one garnishment order. */
export interface OrderFacts {
  amountCents: number;
  orderPct: number | null;
  supportCcpaPct: number | null;
  servedOn: string;
  enteredOn: string | null;
  priorityRank: number | null;
  levyFilingStatus: LevyFilingStatus | '';
  levyDependents: number;
  levyAdditionalStd: number;
  levyStatementOn: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date the person entered, or null when blank; anything else is a refusal. */
function enteredDate(v: unknown, what: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  const t = String(v).slice(0, 10);
  if (!ISO_DATE.test(t) || Number.isNaN(Date.parse(`${t}T00:00:00Z`))) throw new RangeError(`${what} must be a date (YYYY-MM-DD).`);
  return t;
}

/** A whole number in range, or the fallback when blank. */
function enteredInt(v: unknown, what: string, min: number, max: number, fallback: number | null): number | null {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new RangeError(`${what} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** A percentage in range, or null when blank. */
function enteredPct(v: unknown, what: string, max: number): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > max) throw new RangeError(`${what} must be more than 0 and at most ${max}.`);
  return n;
}

/**
 * @description Check and normalise the facts of a garnishment order as entered.
 *
 * What each order must carry is what its limit or its priority depends on: the
 * date served on every order; for support, the maximum percentage (at most 65,
 * 15 U.S.C. 1673(b)(2)); for a federal agency order, at most 15 percent of
 * disposable pay without the employee's written consent, which this package does
 * not record (31 CFR 285.11(i)(2), (i)(4)); for a levy, the amount it says is
 * owed and the Statement of Exemptions and Filing Status (blank when the
 * employee did not return it). Table 2 of Publication 1494 lists at most two
 * additional standard deductions for single or head of household and four for
 * the other statuses.
 * @param code - The garnishment code.
 * @param b - The request body.
 * @returns The facts, or a message saying what is wrong.
 */
export function orderFactsFromInput(code: GarnishmentCode, b: Record<string, unknown>): { facts?: OrderFacts; message?: string } {
  try {
    const servedOn = enteredDate(b.servedOn, 'The date the order was served');
    if (!servedOn) return { message: 'Enter the date the order was served on you (for a levy, the date of levy).' };
    const status = String(b.levyFilingStatus || '');
    if (!['', 'single', 'mfj', 'hoh', 'mfs'].includes(status)) return { message: 'Filing status must be single, mfj, hoh or mfs, or blank when the statement was not returned.' };
    const facts: OrderFacts = {
      amountCents: Math.max(0, Math.round(Number(b.amountCents) || 0)),
      orderPct: code === 'GARN_STUDENT' ? enteredPct(b.orderPct, 'The percentage of disposable pay', 15)
        : code === 'GARN_CREDITOR' ? enteredPct(b.orderPct, 'The percentage of disposable earnings', 25) : null,
      supportCcpaPct: code === 'GARN_SUPPORT' ? enteredPct(b.supportCcpaPct, 'The support percentage', 65) : null,
      servedOn,
      enteredOn: code === 'GARN_SUPPORT' ? enteredDate(b.enteredOn, 'The date the support order was entered') : null,
      priorityRank: enteredInt(b.priorityRank, 'The order of priority', 1, 99, null),
      levyFilingStatus: code === 'GARN_LEVY' ? status as LevyFilingStatus | '' : '',
      levyDependents: code === 'GARN_LEVY' ? enteredInt(b.levyDependents, 'Dependents', 0, 99, 0) || 0 : 0,
      levyAdditionalStd: code === 'GARN_LEVY'
        ? enteredInt(b.levyAdditionalStd, 'Additional standard deductions', 0, status === 'single' || status === 'hoh' ? 2 : 4, 0) || 0 : 0,
      levyStatementOn: code === 'GARN_LEVY' ? enteredDate(b.levyStatementOn, 'The statement date') : null,
    };
    if (code === 'GARN_SUPPORT' && facts.supportCcpaPct === null) return { message: 'Enter the most this support order may take, as a percentage of disposable earnings (50, 55, 60 or 65, or less if your state sets less).' };
    if (code === 'GARN_LEVY' && facts.amountCents <= 0) return { message: 'Enter the amount the levy says is owed.' };
    if ((code === 'GARN_STUDENT' || code === 'GARN_CREDITOR') && facts.amountCents <= 0 && facts.orderPct === null) {
      return { message: 'Enter the amount per pay, or the percentage, the order directs.' };
    }
    if (code === 'GARN_SUPPORT' && facts.amountCents <= 0) return { message: 'Enter the amount per pay the support order directs.' };
    return { facts };
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return { message: err.message };
  }
}
