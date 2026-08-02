/**
 * Payroll tax tables — tax year 2026 constants for the payroll engine.
 *
 * DATA-DRIVEN BY DESIGN: every figure the engine uses lives here, not in the
 * math. Updating a tax year = replacing this module's numbers against the
 * primary sources (IRS Pub 15-T percentage method, SSA wage-base announcement,
 * state agency schedules) — the engine never changes.
 *
 * PROVENANCE — every federal figure below was verified 2026-08-01 against the
 * retrieved primary document, not from memory. Per-constant citations are inline.
 *   - Rate schedules + standard deductions: IRS Rev. Proc. 2025-32 §4.01 Tables 1–3
 *     (https://www.irs.gov/pub/irs-drop/rp-25-32.pdf)
 *   - Social Security wage base: SSA 2026 COLA fact sheet
 *     (https://www.ssa.gov/news/en/cola/factsheets/2026.html)
 *   - Withholding METHOD + supplemental rates: IRS Pub. 15-T (2026) Worksheet 1A
 *     (https://www.irs.gov/pub/irs-pdf/p15t.pdf)
 *   - Retirement deferral limits: IRS Notice 2025-67
 *     (https://www.irs.gov/pub/irs-drop/n-25-67.pdf)
 *   - Florida reemployment tax: Florida DOR rate page
 *     (https://floridarevenue.com/taxes/taxesfees/Pages/rt_rate.aspx)
 *
 * POSTURE: verified for tax year 2026. A NEW TAX YEAR INVALIDATES THIS FILE —
 * re-verify every constant against that year's publications before running a live
 * payroll. This app computes payroll; it is not a tax-filing service.
 *
 * All money is integer CENTS. Bracket thresholds are ANNUAL amounts.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 22:30:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — 2026 federal brackets (single/married/hoh), standard deductions, FICA (SS 6.2% to $184,500 base; Medicare 1.45% + 0.9% additional over $200,000), FUTA net 0.6% on $7,000, FL new-employer SUTA default 2.7% on $7,000, pay-period counts.
 * 2026-08-01 09:00:00 | maintainer@emeraldcoastsystemsgroup.com | Primary-source verification pass: every existing constant confirmed against the retrieved Rev. Proc. 2025-32 / SSA COLA / Pub 15-T / FL DOR documents (all matched exactly — no value changed). Added the constants v1.1 needs: IRC 402(g) elective-deferral + catch-up limits, the supplemental-wage flat rates (22% optional / 37% mandatory over $1M), and the Pub 15-T Worksheet 1A line-1g allowance-equivalent amounts that make the engine's method provably identical to the IRS worksheet.
 *
 * @module payroll-tax-tables
 */

/** W-4 filing statuses the engine understands (2020+ Form W-4). */
export type FilingStatus = 'single' | 'married' | 'hoh';

/**
 * The minimum a withholding computation needs to know about a filer. Declared
 * here (rather than in the engine) so the state module can depend on it without
 * a circular import: tax-tables ← state-tax ← engine.
 */
export interface W4LikeProfile {
  filingStatus: FilingStatus;
  /**
   * Step 2 — two jobs / working spouse. States use it too: Missouri's standard
   * deduction is $16,100 when the spouse works and $32,200 when they do not.
   */
  step2: boolean;
}

/** One progressive bracket: marginal `rate` applies up to `upToCents` (annual). */
export interface TaxBracket {
  upToCents: number;
  rate: number;
}

/** The tax year these tables describe. Surfaces display it; reports key on it. */
export const TAX_YEAR = 2026;

/** Pay periods per year by pay frequency. */
export const PAY_PERIODS: Record<string, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

/** Social Security employee/employer rate (each). */
export const SS_RATE = 0.062;

/** 2026 Social Security taxable wage base. VERIFIED: SSA 2026 COLA fact sheet — "taxable maximum" rises to $184,500 (from $176,100). */
export const SS_WAGE_BASE_CENTS = 18_450_000; // $184,500

/** Medicare employee/employer rate (each), no wage cap. */
export const MEDICARE_RATE = 0.0145;

/** Additional Medicare employee-only rate above the withholding threshold. */
export const ADDL_MEDICARE_RATE = 0.009;

/**
 * Additional-Medicare WITHHOLDING threshold — statutory $200,000 of wages from
 * one employer regardless of filing status (the employee reconciles on 8959).
 */
export const ADDL_MEDICARE_THRESHOLD_CENTS = 20_000_000; // $200,000

/** FUTA net rate assuming the full 5.4% state credit (0.6%). */
export const FUTA_RATE = 0.006;

/** FUTA wage base — statutory $7,000, unchanged. */
export const FUTA_WAGE_BASE_CENTS = 700_000; // $7,000

/** Default SUTA for a new Florida employer: 2.7% until 10 quarters are reported. VERIFIED: FL DOR reemployment-tax rate page. */
export const DEFAULT_SUTA_RATE_PCT = 2.7;

/** Default SUTA wage base (FL $7,000 for 2026) — per-company override in settings. */
export const DEFAULT_SUTA_WAGE_BASE_CENTS = 700_000;

/** 2026 standard deduction by filing status (annual cents). VERIFIED: Rev. Proc. 2025-32 / IRS tax-year-2026 inflation release. */
export const STANDARD_DEDUCTION_CENTS: Record<FilingStatus, number> = {
  single: 1_610_000, // $16,100
  married: 3_220_000, // $32,200
  hoh: 2_415_000, // $24,150
};

/**
 * 2026 federal income-tax brackets by filing status (annual, taxable income).
 * The last bracket's upToCents is Infinity — the engine relies on that.
 *
 * VERIFIED against IRS Rev. Proc. 2025-32 §4.01: Table 1 (MFJ), Table 2 (Heads of
 * Households), Table 3 (Unmarried other than surviving spouses/HoH). Every
 * threshold below matched the published table exactly.
 */
export const FEDERAL_BRACKETS: Record<FilingStatus, TaxBracket[]> = {
  single: [
    { upToCents: 1_240_000, rate: 0.10 }, // to $12,400
    { upToCents: 5_040_000, rate: 0.12 }, // to $50,400
    { upToCents: 10_570_000, rate: 0.22 }, // to $105,700
    { upToCents: 20_177_500, rate: 0.24 }, // to $201,775
    { upToCents: 25_622_500, rate: 0.32 }, // to $256,225
    { upToCents: 64_060_000, rate: 0.35 }, // to $640,600
    { upToCents: Infinity, rate: 0.37 },
  ],
  married: [
    { upToCents: 2_480_000, rate: 0.10 }, // to $24,800
    { upToCents: 10_080_000, rate: 0.12 }, // to $100,800
    { upToCents: 21_140_000, rate: 0.22 }, // to $211,400
    { upToCents: 40_355_000, rate: 0.24 }, // to $403,550
    { upToCents: 51_245_000, rate: 0.32 }, // to $512,450
    { upToCents: 76_870_000, rate: 0.35 }, // to $768,700
    { upToCents: Infinity, rate: 0.37 },
  ],
  hoh: [
    { upToCents: 1_770_000, rate: 0.10 }, // to $17,700
    { upToCents: 6_745_000, rate: 0.12 }, // to $67,450
    { upToCents: 10_570_000, rate: 0.22 }, // to $105,700
    { upToCents: 20_175_000, rate: 0.24 }, // to $201,750
    { upToCents: 25_620_000, rate: 0.32 }, // to $256,200
    { upToCents: 64_060_000, rate: 0.35 }, // to $640,600
    { upToCents: Infinity, rate: 0.37 },
  ],
};

/** Overtime premium multiplier (FLSA time-and-a-half). */
export const OT_MULTIPLIER = 1.5;

/* ───────────────────────────────────────────────────────────────────────────
 * Retirement deferral limits — IRC 402(g), IRS Notice 2025-67 (2026 amounts).
 * The engine caps an employee's pre-tax elective deferral at the remaining room
 * so a percentage election can never silently over-contribute across the year.
 * ─────────────────────────────────────────────────────────────────────────── */

/** 2026 elective-deferral limit under IRC 402(g) — $24,500. */
export const DEFERRAL_LIMIT_CENTS = 2_450_000;

/** Age-50+ catch-up addition — $8,000 for 2026. */
export const CATCHUP_50_CENTS = 800_000;

/** SECURE 2.0 higher catch-up for ages 60–63 — $11,250 for 2026. */
export const CATCHUP_60_63_CENTS = 1_125_000;

/**
 * @description Annual elective-deferral ceiling for an employee, including the
 * age-based catch-up they qualify for. Age 60–63 gets the SECURE 2.0 amount;
 * 50+ (and 64+) gets the standard catch-up.
 * @param age - The employee's age at year end, or null when unknown (no catch-up).
 * @returns The 402(g) ceiling in cents.
 */
export function deferralLimitCents(age: number | null): number {
  if (age === null || !Number.isFinite(age) || age < 50) return DEFERRAL_LIMIT_CENTS;
  if (age >= 60 && age <= 63) return DEFERRAL_LIMIT_CENTS + CATCHUP_60_63_CENTS;
  return DEFERRAL_LIMIT_CENTS + CATCHUP_50_CENTS;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Supplemental wages — IRS Pub. 15-T (2026) / Pub. 15 §7.
 * Bonuses and other supplemental pay may be withheld at a flat rate when paid
 * as a separate payment (or separately stated). Above the annual threshold the
 * higher rate is MANDATORY on the excess.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Optional flat rate for supplemental wages paid separately — 22%. */
export const SUPPLEMENTAL_FLAT_RATE = 0.22;

/** Mandatory rate on supplemental wages above the threshold — 37%. */
export const SUPPLEMENTAL_MANDATORY_RATE = 0.37;

/** Annual supplemental-wage threshold above which 37% is mandatory — $1,000,000. */
export const SUPPLEMENTAL_MANDATORY_THRESHOLD_CENTS = 100_000_000;

/* ───────────────────────────────────────────────────────────────────────────
 * Pub. 15-T Worksheet 1A line 1g — the "allowance-equivalent" subtracted from
 * annual wages when the W-4 Step 2 box is NOT checked. Documented here because
 * it is what makes this engine's simpler formulation provably identical to the
 * IRS worksheet:
 *
 *   line 1g ($8,600 / $12,900) + the rate schedule's built-in 0% band
 *     === the full standard deduction this engine subtracts directly.
 *
 * With Step 2 CHECKED, line 1g is zero and the checkbox schedules carry a 0%
 * band of exactly half the standard deduction with every bracket width halved —
 * which is exactly this engine's `scale = 0.5`. Neither path is an approximation.
 * The equivalence is proven numerically in tests/payroll-engine.test.mjs.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Worksheet 1A line 1g amount, Step 2 unchecked, married filing jointly. */
export const W4_LINE_1G_MARRIED_CENTS = 1_290_000;

/** Worksheet 1A line 1g amount, Step 2 unchecked, all other filing statuses. */
export const W4_LINE_1G_OTHER_CENTS = 860_000;

/* ───────────────────────────────────────────────────────────────────────────
 * Minimum wage — the FLSA floor and the state floors that exceed it.
 *
 * These are EFFECTIVE-DATED because state minimums step mid-year: Florida's
 * constitutional schedule raises the floor to $15.00 on 2026-09-30, which lands
 * between pay periods. The engine checks against whichever rate is in force on
 * the run's PAY DATE, so a run must resolve the floor rather than assume one.
 * The federal figure also drives the CCPA garnishment floor (30x per week).
 * ─────────────────────────────────────────────────────────────────────────── */

/** Federal minimum wage — $7.25/hour, unchanged since 2009. */
export const FEDERAL_MIN_WAGE_CENTS = 725;

/** Effective-dated state minimum wage steps, ascending by date. */
const STATE_MIN_WAGE: Record<string, Array<{ from: string; cents: number }>> = {
  FL: [
    { from: '2025-09-30', cents: 1_400 },
    { from: '2026-09-30', cents: 1_500 },
  ],
};

/**
 * @description The minimum hourly wage in force for a state on a given date —
 * the higher of the federal floor and any state schedule.
 * @param stateCode - Two-letter state code (case-insensitive); may be empty.
 * @param isoDate - The pay date, YYYY-MM-DD.
 * @returns The applicable floor in cents.
 */
export function minimumWageCents(stateCode: string, isoDate: string): number {
  const steps = STATE_MIN_WAGE[String(stateCode || '').toUpperCase()] || [];
  let rate = FEDERAL_MIN_WAGE_CENTS;
  for (const s of steps) if (isoDate >= s.from) rate = Math.max(rate, s.cents);
  return rate;
}
