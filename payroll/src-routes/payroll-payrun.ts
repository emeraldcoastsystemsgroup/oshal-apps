/**
 * Pay-run assembler — turns EARNINGS ROWS and DEDUCTION ROWS into a paycheck.
 *
 * This is the layer v1 did not have. payroll-engine.ts stays the verified tax
 * CORE (Pub 15-T withholding, FICA, the CCPA ceiling) and is unchanged; this
 * module builds the taxable bases that feed it out of a real earnings model, and
 * applies deductions in the order the law requires.
 *
 * THE FOUR THINGS THAT MAKE IT A SYSTEM RATHER THAN A CALCULATOR:
 *
 * 1. FLSA overtime is computed PER WORKWEEK and never averaged across weeks
 *    (29 CFR 778.104). Earnings rows carry a workweek index; 30h + 50h across a
 *    biweekly period yields 10 overtime hours, not zero.
 * 2. The regular rate is WEIGHTED, and nondiscretionary pay enters it
 *    (29 CFR 778.115 / 778.117). Two rates in one week, or a production bonus,
 *    both change what an overtime hour is worth.
 * 3. Each tax base is reduced independently. Section 125 reduces FIT, FICA, FUTA
 *    and state; a 401(k) deferral reduces income tax only. One "pretax" flag
 *    cannot express that.
 * 4. Deductions are applied against LIMITED net in a defined order, garnishments
 *    share one CCPA ceiling in statutory priority, and what does not fit goes to
 *    ARREARS instead of silently vanishing or driving the check negative.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 15:45:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — earnings rows with per-workweek FLSA overtime derivation and the weighted regular rate; independent per-base pre-tax reduction; ordered deduction application with 402(g) sharing, garnishment priority under one CCPA ceiling, and arrears; imputed-income and reported-tips handling (taxed, not paid).
 * 2                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 7: garnishment orders go through payroll-garnish. The shared room had been the 25 percent creditor limit, so a support order was held to 25 percent where 15 U.S.C. 1673(b)(2) allows 50 to 65; a levy and an agency order were held to the creditor limit too. Each order now meets its own cumulative federal ceiling (29 CFR 870.11), the levy takes take-home pay above the Publication 1494 exempt amount, and a check whose priority or allocation facts are missing carries refusals that stop approval.
 * 3                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 3: earning rows may carry the workday they were worked; a workweek that an earlier check also paid is computed over the whole workweek (its hours, its weighted regular rate, less premium already paid; 29 CFR 778.104), where the overtime used to be computed on this check's share alone; derived premium rows carry the workweek's first day so the next check can see them.
 *
 * @module payroll-payrun
 */

import {
  DEDUCTION_CODES, EARNINGS_CODES, deductionCode, earningsCode,
  type DeductionCode, type EarningsCode,
} from './payroll-codes';
import {
  computeTaxes, type EmployerTaxSettings, type TaxBases, type TaxResult,
  type W4Profile, type YtdBefore,
} from './payroll-engine';
import {
  allocateGarnishments, type GarnishmentCode, type GarnishmentOrder, type LevyFilingStatus,
} from './payroll-garnish';
import { FEDERAL_MIN_WAGE_CENTS, deferralLimitCents } from './payroll-tax-tables';

/** One line of pay. Hours-based codes use hours x rate; amount codes use amountCents. */
export interface EarningRow {
  /** An EARNINGS_CODES key. Unknown codes are rejected by validateEarnings. */
  code: string;
  /** Hours for an hourly code. */
  hours: number;
  /** Base hourly rate for THIS row — supports a worker with two jobs at two rates. */
  rateCents: number;
  /** Flat amount for an 'amount' code. */
  amountCents: number;
  /** 1-based workweek index within the pay period. Overtime is derived per week. */
  workweek: number;
  /** Optional free-text (job, cost center) carried through to the register. */
  memo?: string;
  /**
   * The workday the hours were worked, YYYY-MM-DD (29 CFR 516.2(a)(7): "Hours
   * worked each workday"). When rows are dated, the workweek index is derived
   * from the date and the employer's fixed workweek, never typed.
   */
  workDate?: string;
}

/** What earlier checks already paid in a workweek this check also falls in. */
export interface CarriedWorkweek {
  /** Hours worked in that workweek on earlier paid checks. */
  hours: number;
  /** Their straight-time earnings: the regular-rate numerator. */
  straightCents: number;
  /** Overtime premium already paid for that workweek. */
  premiumCents: number;
}

/** One deduction election resolved for this period. */
export interface DeductionRow {
  /** The stored election this row came from, so its balance moves by election and not by code. */
  electionId?: string;
  /** A DEDUCTION_CODES key. */
  code: string;
  /** Flat amount per period; ignored when percentOfGross is set. */
  amountCents: number;
  /** Percent of gross, when the election is a percentage. */
  percentOfGross?: number;
  /** Annual ceiling for this deduction (plan or statutory), if any. */
  annualLimitCents?: number;
  /** Amount already taken toward that ceiling this year. */
  ytdCents?: number;
  /** Balance carried in from a period where net pay ran out. */
  arrearsCents?: number;
  /**
   * Support orders only: the CCPA percentage that applies (50/55/60/65) based on
   * whether the worker supports another family and whether arrears exceed 12 weeks.
   */
  supportCcpaPct?: number;
  /** The date this election starts; a levy is sized against deductions in effect when it was served. */
  effectiveFrom?: string;
  /** Garnishment orders only: the percentage of disposable earnings (or pay) the order directs. */
  orderPct?: number;
  /** Garnishment orders only: the date served on the employer (a levy: the date of levy). */
  servedOn?: string;
  /** Support orders only: the date the order was entered. */
  enteredOn?: string;
  /** Non-support garnishment orders: the person-stated order of priority, 1 first. */
  priorityRank?: number;
  /** Federal tax levy only: the Statement of Exemptions and Filing Status, and what is still owed. */
  levy?: {
    filingStatus: LevyFilingStatus | '';
    dependents: number;
    additionalStandardDeductions: number;
    statementOn?: string;
    balanceCents: number;
  };
}

/** What a deduction actually did this period. */
export interface AppliedDeduction {
  /** The election it came from, when it came from one. */
  electionId?: string;
  code: string;
  label: string;
  requestedCents: number;
  appliedCents: number;
  /** Newly deferred to arrears because net pay ran out or a ceiling bound. */
  arrearsAddedCents: number;
  reason?: string;
}

/** The assembled paycheck. */
export interface PayCheck {
  earnings: Array<EarningRow & { grossCents: number; label: string }>;
  grossCents: number;
  /** Gross that is actually paid in cash (excludes imputed income and reported cash tips). */
  cashEarningsCents: number;
  /** Imputed income: taxed, never paid. */
  imputedCents: number;
  /** Reported cash tips: taxed, already in the employee's pocket. */
  reportedTipsCents: number;
  /** Non-taxable reimbursements paid on this check. */
  nontaxablePaidCents: number;
  bases: TaxBases;
  taxes: TaxResult;
  deductions: AppliedDeduction[];
  preTaxCents: number;
  postTaxCents: number;
  garnishmentCents: number;
  disposableEarningsCents: number;
  /** Garnishment facts missing or law not held. A check with any cannot be approved. */
  garnishmentRefusals: string[];
  netCents: number;
  /** Hours worked per workweek, after overtime derivation — the FLSA record. */
  workweekHours: Record<number, number>;
  /** Qualified overtime PREMIUM for W-2 box 12 TT. */
  qualifiedOvertimeCents: number;
  warnings: string[];
}

/** Round half-up to whole cents. */
function cents(v: number): number {
  return Math.round(v);
}

/** Non-negative finite coercion. */
function safe(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Gross for one earnings row before any overtime derivation. */
function rowGross(row: EarningRow, def: EarningsCode): number {
  return def.entry === 'hourly'
    ? cents(safe(row.rateCents) * safe(row.hours) * def.multiplier)
    : cents(safe(row.amountCents));
}

/**
 * @description Reject unknown codes loudly rather than silently dropping pay.
 * @param rows - Earnings rows as supplied.
 * @returns The unknown codes found, empty when all are valid.
 */
export function unknownEarningsCodes(rows: EarningRow[]): string[] {
  return [...new Set(rows.map((r) => String(r.code || '').toUpperCase()))].filter((c) => !EARNINGS_CODES[c]);
}

/** Reject unknown deduction codes the same way. */
export function unknownDeductionCodes(rows: DeductionRow[]): string[] {
  return [...new Set(rows.map((r) => String(r.code || '').toUpperCase()))].filter((c) => !DEDUCTION_CODES[c]);
}

/**
 * @description Derive FLSA overtime PER WORKWEEK from straight-time rows.
 *
 * For each workweek: sum hours that count as hours worked. Anything over 40 is
 * overtime, and the premium is half the WEIGHTED regular rate for that week —
 * straight-time earnings plus nondiscretionary pay, divided by hours worked
 * (29 CFR 778.115). Hours are never averaged across weeks, which is the whole
 * point: 30 + 50 over a biweekly period owes 10 hours of premium even though the
 * period total is 80.
 *
 * Rows already coded OT/DT are treated as explicitly entered and left alone; the
 * derivation then only tops up the premium owed on nondiscretionary pay.
 * @param rows - Earnings rows for the period.
 * @returns Derived premium rows to append, the hours-worked map, and warnings.
 */
export function deriveFlsaOvertime(
  rows: EarningRow[], carried: Record<number, CarriedWorkweek> = {}, weekStarts: Record<number, string> = {},
): {
  premiumRows: EarningRow[];
  workweekHours: Record<number, number>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const weeks = new Map<number, EarningRow[]>();
  for (const r of rows) {
    const wk = Math.max(1, Math.trunc(safe(r.workweek, 1)) || 1);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk)!.push(r);
  }

  const premiumRows: EarningRow[] = [];
  const workweekHours: Record<number, number> = {};

  for (const [wk, wkRows] of [...weeks.entries()].sort((a, b) => a[0] - b[0])) {
    const t = workweekTotals(wkRows);
    workweekHours[wk] = t.hours;
    const prior = carried[wk];
    if (prior && prior.hours > 0) {
      const row = straddlingPremium(wk, t, prior, weekStarts[wk]);
      if (row) {
        premiumRows.push(row);
        warnings.push(`Week ${wk}: ${prior.hours + t.hours} hours worked in the workweek, ${prior.hours} of them paid on an earlier check — ${row.amountCents} of FLSA premium is owed on this check (29 CFR 778.104).`);
      }
      continue;
    }
    if (t.hours <= 0) continue;

    const regularRate = t.straightCents / t.hours;
    const overHours = Math.max(0, t.hours - 40);

    if (overHours > 0 && t.explicitOtHours === 0) {
      // Straight time was recorded past 40 with no overtime row — owe the premium.
      premiumRows.push({
        code: 'OTP', hours: 0, rateCents: 0,
        amountCents: cents(regularRate * 0.5 * overHours),
        workweek: wk, memo: `derived FLSA premium, week ${wk}`, workDate: weekStarts[wk],
      });
      warnings.push(`Week ${wk}: ${t.hours} hours worked with no overtime recorded — ${overHours} hours of FLSA premium were derived at the weighted regular rate.`);
    } else if (t.explicitOtHours > 0) {
      // Overtime was entered at a base rate; top up if nondiscretionary pay lifted
      // the regular rate above that base.
      const premiumOwed = cents(regularRate * 0.5 * t.explicitOtHours);
      const topUp = premiumOwed - t.premiumCents;
      if (topUp > 0) {
        premiumRows.push({
          code: 'OTP', hours: 0, rateCents: 0, amountCents: topUp,
          workweek: wk, memo: `regular-rate top-up on ${t.explicitOtHours} OT hours, week ${wk}`, workDate: weekStarts[wk],
        });
        warnings.push(`Week ${wk}: nondiscretionary pay raised the regular rate, so ${topUp} of additional overtime premium was added (29 CFR 778.117).`);
      }
    }
  }
  return { premiumRows, workweekHours, warnings };
}

/**
 * @description Hours worked, straight-time earnings, explicit overtime hours and
 * premium already paid, for rows of one workweek.
 *
 * An OT row pays straight time PLUS a premium. Only the straight-time portion
 * belongs in the regular-rate numerator; counting the premium there would
 * inflate the rate the premium is computed from.
 * @param rows - Earning rows of one workweek.
 * @returns The four totals.
 */
export function workweekTotals(rows: EarningRow[]): { hours: number; straightCents: number; explicitOtHours: number; premiumCents: number } {
  const out = { hours: 0, straightCents: 0, explicitOtHours: 0, premiumCents: 0 };
  for (const r of rows) {
    const def = earningsCode(r.code);
    if (!def) continue;
    const g = rowGross(r, def);
    if (def.hoursWorked) out.hours += safe(r.hours);
    if (def.regularRate === 'included' || def.regularRate === 'included-no-hours') out.straightCents += g;
    if (def.regularRate === 'premium') {
      out.explicitOtHours += safe(r.hours);
      if (def.multiplier > 1) out.straightCents += cents(g / def.multiplier);
      out.premiumCents += def.multiplier > 1 ? g - cents(g / def.multiplier) : g;
    }
  }
  return out;
}

/**
 * The premium still owed for a workweek split across two checks. 29 CFR 778.104
 * makes the workweek the unit, so the regular rate and the hours over 40 are
 * taken over the whole workweek, and what earlier checks already paid as
 * premium is subtracted.
 */
function straddlingPremium(
  wk: number, t: ReturnType<typeof workweekTotals>, prior: CarriedWorkweek, weekStart?: string,
): EarningRow | null {
  const hours = prior.hours + t.hours;
  if (hours <= 40) return null;
  const rate = (prior.straightCents + t.straightCents) / hours;
  const owed = cents(rate * 0.5 * (hours - 40)) - prior.premiumCents - t.premiumCents;
  if (owed <= 0) return null;
  return {
    code: 'OTP', hours: 0, rateCents: 0, amountCents: owed, workweek: wk, workDate: weekStart,
    memo: `derived FLSA premium, week ${wk}, counting ${prior.hours} hours paid on an earlier check`,
  };
}

/** Split gross across tax bases according to each code's taxability. */
function buildBases(all: Array<EarningRow & { grossCents: number; def: EarningsCode }>): TaxBases {
  const b: TaxBases = { fitCents: 0, ficaCents: 0, futaCents: 0, stateCents: 0, supplementalCents: 0 };
  for (const r of all) {
    if (r.def.tax.fit) b.fitCents += r.grossCents;
    if (r.def.tax.fica) b.ficaCents += r.grossCents;
    if (r.def.tax.futa) b.futaCents += r.grossCents;
    if (r.def.tax.state) b.stateCents += r.grossCents;
  }
  return b;
}

/** Resolve a deduction row's requested amount for this period. */
function requestedAmount(d: DeductionRow, grossCents: number): number {
  const base = d.percentOfGross !== undefined
    ? cents((grossCents * Math.min(100, safe(d.percentOfGross))) / 100)
    : cents(safe(d.amountCents));
  const withArrears = base + cents(safe(d.arrearsCents));
  if (d.annualLimitCents === undefined) return withArrears;
  const room = Math.max(0, safe(d.annualLimitCents) - safe(d.ytdCents));
  return Math.min(withArrears, room);
}

/** Apply the pre-tax deductions, reducing each base independently. */
function applyPreTax(
  deds: DeductionRow[], grossCents: number, bases: TaxBases, age: number | null, ytdDeferral: number,
): { applied: AppliedDeduction[]; total: number; warnings: string[] } {
  const applied: AppliedDeduction[] = [];
  const warnings: string[] = [];
  let total = 0;
  let deferralRoom = Math.max(0, deferralLimitCents(age) - safe(ytdDeferral));

  for (const d of deds) {
    const def = deductionCode(d.code);
    if (!def) continue;
    const reducesSomething = def.reduces.fit || def.reduces.fica || def.reduces.futa || def.reduces.state;
    if (!reducesSomething && !def.countsToward402g) continue; // post-tax handled later

    let want = requestedAmount(d, grossCents);
    let reason: string | undefined;

    // 402(g) is ONE ceiling shared by pre-tax and Roth deferrals.
    if (def.countsToward402g) {
      if (want > deferralRoom) {
        reason = `Capped by the IRC 402(g) combined elective-deferral limit.`;
        warnings.push(`${def.label} reduced to ${deferralRoom} — 402(g) is a COMBINED pre-tax and Roth ceiling.`);
        want = deferralRoom;
      }
      deferralRoom -= want;
    }
    // Never let pre-tax exceed the pay it comes out of.
    const room = Math.max(0, grossCents - total);
    if (want > room) { want = room; reason = 'Limited by available pay.'; }

    if (def.reduces.fit) bases.fitCents = Math.max(0, bases.fitCents - want);
    if (def.reduces.fica) bases.ficaCents = Math.max(0, bases.ficaCents - want);
    if (def.reduces.futa) bases.futaCents = Math.max(0, bases.futaCents - want);
    if (def.reduces.state) bases.stateCents = Math.max(0, bases.stateCents - want);

    total += want;
    applied.push({
      electionId: d.electionId, code: def.code, label: def.label, requestedCents: requestedAmount(d, grossCents),
      appliedCents: want, arrearsAddedCents: 0, reason,
    });
  }
  return { applied, total, warnings };
}

/**
 * Health insurance premiums: 31 CFR 285.11(c) takes them out of "disposable
 * pay" for a federal agency order, though not out of CCPA disposable earnings.
 * Medical, dental and vision coverage are read as health insurance; an FSA or
 * HSA contribution is not a premium.
 */
const HEALTH_PREMIUM_CODES = new Set(['MED125', 'DEN125', 'VIS125']);

/** A garnishment election as the allocator sees it. */
function garnishmentOrder(d: DeductionRow, def: DeductionCode): GarnishmentOrder {
  return {
    electionId: d.electionId, code: def.code as GarnishmentCode, label: def.label, amountCents: cents(safe(d.amountCents)) + cents(safe(d.arrearsCents)),
    orderPct: d.orderPct, supportCcpaPct: d.supportCcpaPct, servedOn: d.servedOn, enteredOn: d.enteredOn,
    priorityRank: d.priorityRank, levy: d.levy,
  };
}

/** Voluntary post-tax deductions in effect when the earliest levy was served. */
function voluntaryBeforeLevy(rows: Array<{ d: DeductionRow; def: DeductionCode }>, grossCents: number): number {
  const levyDates = rows.filter((x) => x.def.code === 'GARN_LEVY' && x.d.servedOn).map((x) => String(x.d.servedOn)).sort();
  if (!levyDates.length) return 0;
  return rows.filter((x) => x.def.garnishmentPriority === undefined && (!x.d.effectiveFrom || x.d.effectiveFrom < levyDates[0]))
    .reduce((a, x) => a + requestedAmount(x.d, grossCents), 0);
}

/**
 * Allocate the garnishment orders, then turn the result into applied rows.
 * A levy carries no arrears: what it did not take stays on its balance.
 */
function applyGarnishments(
  rows: Array<{ d: DeductionRow; def: DeductionCode }>, applied: AppliedDeduction[], check: {
    grossCents: number; disposableEarningsCents: number; healthCents: number; cashCents: number; periods: number; payDate: string;
  },
): { total: number; warnings: string[]; refusals: string[] } {
  const garn = rows.filter((x) => x.def.garnishmentPriority !== undefined);
  if (!garn.length) return { total: 0, warnings: [], refusals: [] };
  const result = allocateGarnishments(garn.map((x) => garnishmentOrder(x.d, x.def)), {
    payDate: check.payDate, periodsPerYear: check.periods, federalMinWageCents: FEDERAL_MIN_WAGE_CENTS,
    disposableCents: check.disposableEarningsCents, healthPremiumCents: check.healthCents, cashCents: check.cashCents,
    voluntaryPostTaxCents: voluntaryBeforeLevy(rows, check.grossCents),
  });
  const warnings = [...result.warnings, ...result.refusals.map((r) => `Garnishment not computed: ${r}`)];
  for (const a of result.applied) {
    const arrears = a.code === 'GARN_LEVY' ? 0 : a.shortfallCents;
    if (arrears > 0) warnings.push(`${a.label}: ${arrears} carried to arrears — ${a.reason}`);
    applied.push({ electionId: a.electionId, code: a.code, label: a.label, requestedCents: a.requestedCents, appliedCents: a.appliedCents,
      arrearsAddedCents: arrears, reason: a.reason || undefined });
  }
  return { total: result.totalCents, warnings, refusals: result.refusals };
}

/**
 * @description Assemble a paycheck from earnings and deduction rows.
 * @param earnings - Earnings rows for the period (workweek-tagged).
 * @param deductions - Resolved deduction elections for the period.
 * @param w4 - The employee's W-4 profile.
 * @param opts - Periods per year, age, state profile, YTD, employer settings.
 * @returns The assembled check with every component and any warnings.
 */
export function computeCheck(
  earnings: EarningRow[],
  deductions: DeductionRow[],
  w4: W4Profile,
  opts: {
    periodsPerYear: number;
    age: number | null;
    state: { code: string; manualRatePct: number; allowances: number };
    ytd: YtdBefore;
    employerTax: EmployerTaxSettings;
    /** Suppress voluntary deductions — used by bonus-only and off-cycle runs. */
    suppressVoluntaryDeductions?: boolean;
    /** The pay date: a levy's exempt amount is read from the Publication 1494 for its year. */
    payDate?: string;
    /** Hours and pay already on earlier checks for a workweek this check shares, by workweek index. */
    carriedWorkweeks?: Record<number, CarriedWorkweek>;
    /** The first day of each workweek index, so derived premium rows carry a date. */
    weekStarts?: Record<number, string>;
  },
): PayCheck {
  const warnings: string[] = [];
  const periods = safe(opts.periodsPerYear, 26) || 26;

  const bad = unknownEarningsCodes(earnings);
  if (bad.length) warnings.push(`Unknown earnings code(s) ignored: ${bad.join(', ')}.`);
  const badD = unknownDeductionCodes(deductions);
  if (badD.length) warnings.push(`Unknown deduction code(s) ignored: ${badD.join(', ')}.`);

  // ── Earnings, with FLSA overtime derived per workweek ─────────────────────
  const derived = deriveFlsaOvertime(earnings, opts.carriedWorkweeks || {}, opts.weekStarts || {});
  warnings.push(...derived.warnings);
  const allRows = [...earnings, ...derived.premiumRows];

  const priced = allRows
    .map((r) => { const def = earningsCode(r.code); return def ? { ...r, def, grossCents: rowGross(r, def) } : null; })
    .filter((x): x is EarningRow & { def: EarningsCode; grossCents: number } => x !== null);

  const grossCents = priced.filter((r) => r.def.tax.fit || r.def.tax.fica).reduce((a, r) => a + r.grossCents, 0);
  const nontaxablePaidCents = priced.filter((r) => !r.def.tax.fit && !r.def.tax.fica && r.def.paid)
    .reduce((a, r) => a + r.grossCents, 0);
  const imputedCents = priced.filter((r) => !r.def.paid && r.def.code !== 'TIPS_CASH')
    .reduce((a, r) => a + r.grossCents, 0);
  const reportedTipsCents = priced.filter((r) => r.def.code === 'TIPS_CASH').reduce((a, r) => a + r.grossCents, 0);
  const cashEarningsCents = priced.filter((r) => r.def.paid && (r.def.tax.fit || r.def.tax.fica))
    .reduce((a, r) => a + r.grossCents, 0);

  // Qualified overtime for W-2 box 12 TT is the PREMIUM portion only.
  const qualifiedOvertimeCents = priced
    .filter((r) => r.def.qualifiedPremiumShare !== undefined)
    .reduce((a, r) => a + cents(r.grossCents * (r.def.qualifiedPremiumShare as number)), 0);

  const bases = buildBases(priced);
  const supplementalCents = priced.filter((r) => ['BONUS_ND', 'BONUS_D', 'SEV', 'COMM', 'RETRO'].includes(r.def.code))
    .reduce((a, r) => a + r.grossCents, 0);
  bases.supplementalCents = supplementalCents;

  // ── Pre-tax ───────────────────────────────────────────────────────────────
  const active = opts.suppressVoluntaryDeductions
    ? deductions.filter((d) => deductionCode(d.code)?.statutory)
    : deductions;
  const pre = applyPreTax(active, grossCents, bases, opts.age, opts.ytd.deferralCents);
  warnings.push(...pre.warnings);

  // ── Taxes (the verified core) ─────────────────────────────────────────────
  const taxes = computeTaxes(bases, w4, periods, opts.ytd, opts.state, opts.employerTax);
  warnings.push(...taxes.warnings);

  const totalTax = taxes.fitCents + taxes.ssCents + taxes.medicareCents + taxes.addlMedicareCents + taxes.stateCents;

  // Disposable earnings for the CCPA test = gross less LEGALLY REQUIRED
  // deductions (taxes) only. Voluntary elections never reduce it.
  const disposableEarningsCents = Math.max(0, grossCents - totalTax);

  // ── Post-tax, against what is actually left to pay ────────────────────────
  // Cash available: what we can actually hand over. Imputed income and reported
  // cash tips are taxable but not payable, so they cannot fund a deduction.
  let available = cashEarningsCents + nontaxablePaidCents - pre.total - totalTax;
  const postApplied: AppliedDeduction[] = [];
  const post = [...active]
    .map((d) => ({ d, def: deductionCode(d.code) }))
    .filter((x): x is { d: DeductionRow; def: DeductionCode } => x.def !== null)
    .filter((x) => !(x.def.reduces.fit || x.def.reduces.fica || x.def.reduces.futa || x.def.reduces.state || x.def.countsToward402g));

  // Garnishment orders first, each under its own federal ceiling (payroll-garnish).
  // Reimbursements are not earnings, so they never fund one.
  const health = pre.applied.filter((a) => HEALTH_PREMIUM_CODES.has(a.code)).reduce((a, x) => a + x.appliedCents, 0);
  const garn = applyGarnishments(post, postApplied, {
    grossCents, disposableEarningsCents, healthCents: health, periods,
    cashCents: Math.max(0, cashEarningsCents - pre.total - totalTax), payDate: String(opts.payDate || ''),
  });
  warnings.push(...garn.warnings);
  available -= garn.total;
  let postTotal = garn.total;
  const garnTotal = garn.total;

  for (const { d, def } of post.filter((x) => x.def.garnishmentPriority === undefined)) {
    const requested = requestedAmount(d, grossCents);
    let allowed = requested;
    let reason: string | undefined;
    if (allowed > available) {
      allowed = Math.max(0, available);
      reason = 'Insufficient net pay this period.';
    }

    const shortfall = requested - allowed;
    const arrearsAdded = shortfall > 0 && def.allowArrears ? shortfall : 0;
    if (shortfall > 0 && !def.allowArrears) {
      warnings.push(`${def.label}: ${shortfall} could not be taken and is NOT carried to arrears for this deduction type.`);
    }
    if (arrearsAdded > 0) {
      warnings.push(`${def.label}: ${arrearsAdded} carried to arrears — ${reason || 'limited this period'}`);
    }

    available -= allowed;
    postTotal += allowed;
    postApplied.push({
      electionId: d.electionId, code: def.code, label: def.label, requestedCents: requested,
      appliedCents: allowed, arrearsAddedCents: arrearsAdded, reason,
    });
  }

  const netCents = cashEarningsCents + nontaxablePaidCents - pre.total - totalTax - postTotal;
  if (netCents < 0) {
    warnings.push(`Net pay is negative (${netCents}) — withholding exceeds the cash portion of this check. With imputed income or reported tips, the uncollected tax must be handled outside this run.`);
  }

  return {
    earnings: priced.map(({ def, ...row }) => ({ ...row, label: def.label })),
    grossCents,
    cashEarningsCents,
    imputedCents,
    reportedTipsCents,
    nontaxablePaidCents,
    bases,
    taxes,
    deductions: [...pre.applied, ...postApplied],
    preTaxCents: pre.total,
    postTaxCents: postTotal,
    garnishmentCents: garnTotal,
    disposableEarningsCents,
    garnishmentRefusals: garn.refusals,
    netCents,
    workweekHours: derived.workweekHours,
    qualifiedOvertimeCents,
    warnings,
  };
}
