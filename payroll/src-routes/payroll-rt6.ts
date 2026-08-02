/**
 * Florida RT-6 — Employer's Quarterly Report (reemployment tax).
 *
 * The first state return, and it follows the Form 941/940 pattern deliberately:
 * every line value is computed from the SAME ledger the paychecks came from and
 * reconciled against the SUTA actually accrued, so a disagreement surfaces
 * instead of being papered over by a confident total.
 *
 * WHY FLORIDA FIRST. Backlog item 16 requires that state coverage never outrun
 * correctness — a return may only ship for a state whose withholding treatment
 * is already verified. Florida levies no wage income tax, so there is no
 * withholding table to get wrong, which makes it the one state where the return
 * can be trusted before the tables are.
 *
 * THE TRAP, and it is the same one FUTA has: the $7,000 wage base is PER
 * EMPLOYEE PER CALENDAR YEAR, and the quarterly return must carry each person's
 * year-to-date forward. Someone earning $4,000 a quarter is fully taxable in Q1,
 * partly taxable in Q2 and entirely excess thereafter. Computing excess wages
 * company-wide understates the base by roughly the headcount.
 *
 * WHAT THIS DOES NOT DO. It does not generate the payment coupon's OCR
 * scanline. The blank form prints a sample string, but no retrieved document
 * describes its field structure or check digit, and a wrong scanline misroutes
 * a payment. It also does not transmit — the employer files.
 *
 * SOURCES, all retrieved and independently re-verified:
 *   - Form RT-6 and RT-6N (instructions), R. 07/23, Rule 73B-10.037, F.A.C.
 *   - Form RT-6A, Employer's Quarterly Report Continuation Sheet, R. 07/23
 *   - RT-800002, Employer Guide to Reemployment Tax, R. 03/25
 *   - Reemployment Tax Import File Specifications, Version 7 (December 2023)
 *   - Florida DOR Reemployment Tax Rate Information (2026 figures)
 *   - TIP #26ADM-02 — floating interest rate, 11% for 2026
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 02:35:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — RT-6 lines 2 through 9b from the ledger with per-employee year-to-date excess wages, the 2026 rate bounds checked rather than assumed, $25-per-30-days late penalty and the 11% daily-factor interest, the RT-6A employee wage detail with Florida's own SSN validity rules, the e-file threshold, and a reconciliation against SUTA accrued.
 *
 * @module payroll-rt6
 */

import type { AppContext } from '@/app/composition/app-context';
import type { FormLine, FormWorksheet } from './payroll-forms';

type Pool = AppContext['pool'];
type Row = Record<string, unknown>;

/* ── Florida parameters, each with the document it came from ─────────────── */

/**
 * Taxable wage base — $7,000 per employee per calendar year.
 * VERIFIED: FL DOR Reemployment Tax Rate Information; RT-800002 R. 03/25 p9.
 */
export const FL_WAGE_BASE_CENTS = 700_000;

/**
 * 2026 rate bounds. VERIFIED, verbatim: "Effective January 1, 2026, the minimum
 * rate is 0.0010 (0.1%) … Minimum rate: 0.0010 (0.1%) or $7 per employee
 * Maximum rate: 0.0540 (5.4%) or $378 per employee."
 */
export const FL_MIN_RATE_PCT = 0.10;
export const FL_MAX_RATE_PCT = 5.40;

/** A new Florida employer pays 2.7% until roughly ten quarters are reported. */
export const FL_INITIAL_RATE_PCT = 2.70;

/**
 * Late-filing penalty: "$25 for each 30 days or fraction thereof" that the
 * report is late. VERIFIED: RT-6N Line 6; RT-800002 p13. No maximum is stated
 * in either document — see the caveat rather than inventing a cap.
 */
export const FL_LATE_PENALTY_PER_30_DAYS_CENTS = 2_500;

/**
 * Interest: 11% annually for 2026, applied as a DAILY FACTOR.
 * VERIFIED: TIP #26ADM-02 (issued 2026-05-12), row 01/01/26–12/31/26.
 */
export const FL_INTEREST_DAILY_FACTOR_2026 = 0.000301370;

/** The one-time-per-year installment filing fee. VERIFIED: RT-6N Line 8. */
export const FL_INSTALLMENT_FEE_CENTS = 500;

/**
 * Mandatory e-filing threshold: "10 or more employees in any quarter during the
 * State of Florida's prior fiscal year (July 1 through June 30)".
 * VERIFIED: RT-6N; RT-800002 p12.
 */
export const FL_EFILE_EMPLOYEE_THRESHOLD = 10;

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Round half-up to whole cents. */
function cents(v: number): number {
  return Math.round(v);
}

/** The calendar bounds of a quarter. */
function quarterBounds(year: number, quarter: number): { from: string; to: string } {
  const startMonth = (Math.min(4, Math.max(1, quarter)) - 1) * 3;
  return {
    from: new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, startMonth + 3, 0)).toISOString().slice(0, 10),
  };
}

/**
 * Florida's own SSN validity rules, from the import-file specification: not all
 * zeroes, not beginning 000, not 00 in the middle pair, not ending 0000, not
 * beginning 666, and not beginning 9. Stricter than "nine digits", and an
 * invalid one carries its own penalty.
 */
export function isValidFloridaSsn(ssn: unknown): boolean {
  const d = String(ssn ?? '').replace(/\D/g, '');
  if (d.length !== 9) return false;
  if (/^0+$/.test(d)) return false;
  if (d.startsWith('000') || d.startsWith('666') || d.startsWith('9')) return false;
  if (d.slice(3, 5) === '00') return false;
  if (d.slice(5) === '0000') return false;
  return true;
}

/**
 * @description The RT-6 due date and delinquency date for a quarter.
 *
 * VERIFIED, verbatim: the report is "due the 1st day of the month following the
 * end of each calendar quarter and is late if not postmarked by the last day of
 * the month". Both dates are reported EXACTLY as the rule states them.
 *
 * Deliberately NOT rolled off a weekend. Florida's own treatment of a
 * postmark deadline falling on a Saturday or Sunday was not found in any
 * retrieved document, and the federal calendar is the wrong authority for a
 * state deadline — the IRS legal-holiday set includes District of Columbia
 * Emancipation Day, which has nothing to do with Tallahassee. When the date
 * lands on a weekend the worksheet says so and tells the operator to file
 * early, which is correct under either reading.
 * @param year - Calendar year.
 * @param quarter - 1–4.
 * @returns The statutory due date and penalty-after date.
 */
export function rt6Dates(year: number, quarter: number): { dueDate: string; penaltyAfter: string } {
  const endMonth = Math.min(4, Math.max(1, quarter)) * 3; // 3, 6, 9, 12
  return {
    dueDate: new Date(Date.UTC(year, endMonth, 1)).toISOString().slice(0, 10),
    penaltyAfter: new Date(Date.UTC(year, endMonth + 1, 0)).toISOString().slice(0, 10),
  };
}

/** Saturday or Sunday, for the weekend caveat on a postmark deadline. */
function fallsOnWeekend(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/**
 * Whole 30-day blocks in a span of days, counting any fraction as a whole
 * block — RT-6N Line 6 charges "$25 for each 30 days or fraction thereof", so
 * one day late is a full $25.
 */
function thirtyDayBlocks(days: number): number {
  return days <= 0 ? 0 : Math.ceil(days / 30);
}

/* ── the return ──────────────────────────────────────────────────────────── */

/** One person's line on the RT-6 page 2 / RT-6A wage detail. */
export interface Rt6Employee {
  employeeId: string;
  name: string;
  ssnLast4: string;
  ssnValid: boolean;
  grossWagesCents: number;
  taxableWagesCents: number;
  excessWagesCents: number;
}

/** A completed RT-6 worksheet. */
export interface Rt6Worksheet extends FormWorksheet {
  ratePct: number;
  rateWithinBounds: boolean;
  dueDate: string;
  penaltyAfter: string;
  employees: Rt6Employee[];
  employeeCount: number;
  mustFileElectronically: boolean;
  warnings: string[];
}

/** Optional filing details that change lines 6, 7 and 8. */
export interface Rt6Options {
  /** When the return will actually be filed — drives penalty and interest. */
  filedOn?: string;
  /** True when paying under the quarterly installment option (adds the $5 fee). */
  installment?: boolean;
}

/**
 * @description Build the Florida RT-6 worksheet for one quarter.
 *
 * Excess wages are computed PER EMPLOYEE against their year-to-date wages
 * before this quarter, which is the only way the $7,000 base lands correctly on
 * a quarterly return.
 * @param pool - Postgres pool.
 * @param sub - Owning OIDC sub.
 * @param company - The company settings row (rate, wage base, state).
 * @param year - Calendar year.
 * @param quarter - 1–4.
 * @param opts - Filing date and installment election.
 * @returns The worksheet, its employee detail, and a reconciliation verdict.
 */
export async function formRt6(
  pool: Pool, sub: string, company: Row, year: number, quarter: number, opts: Rt6Options = {},
): Promise<Rt6Worksheet> {
  const { from, to } = quarterBounds(year, quarter);
  const warnings: string[] = [];

  const stateCode = String(company.state_code || '').toUpperCase();
  if (stateCode !== 'FL') {
    warnings.push(
      `This company's work state is ${stateCode || 'unset'}, not FL. The RT-6 is a Florida return; `
      + 'the figures below are computed but do not describe a filing obligation in that state.',
    );
  }

  const ratePct = Number(company.suta_rate_pct ?? FL_INITIAL_RATE_PCT);
  const rateWithinBounds = ratePct >= FL_MIN_RATE_PCT && ratePct <= FL_MAX_RATE_PCT;
  if (!rateWithinBounds) {
    warnings.push(
      `The reemployment tax rate on file is ${ratePct}%, outside Florida's 2026 range of `
      + `${FL_MIN_RATE_PCT}% to ${FL_MAX_RATE_PCT}%. Check the rate notice from the Department of `
      + 'Revenue — a short-term-compensation employer is the one documented exception to the cap.',
    );
  }
  const wageBaseCents = Number(company.suta_wage_base_cents ?? FL_WAGE_BASE_CENTS);
  if (wageBaseCents !== FL_WAGE_BASE_CENTS) {
    warnings.push(
      `The wage base on file is $${(wageBaseCents / 100).toFixed(2)}; Florida's is `
      + `$${(FL_WAGE_BASE_CENTS / 100).toFixed(2)} per employee per calendar year.`,
    );
  }

  const employees = await employeeWageDetail(pool, sub, year, from, to, wageBaseCents);

  const grossCents = employees.reduce((a, e) => a + e.grossWagesCents, 0);
  const excessCents = employees.reduce((a, e) => a + e.excessWagesCents, 0);
  const taxableCents = employees.reduce((a, e) => a + e.taxableWagesCents, 0);
  const taxDueCents = cents(taxableCents * (ratePct / 100));

  const { dueDate, penaltyAfter } = rt6Dates(year, quarter);
  // Penalty and interest both run from the delinquency date, and both are zero
  // for a return filed on time or with no filing date supplied yet.
  const filedOn = opts.filedOn || '';
  const lateDays = filedOn ? daysBetween(penaltyAfter, filedOn) : 0;
  const lateBlocks = thirtyDayBlocks(lateDays);
  const penaltyCents = lateBlocks * FL_LATE_PENALTY_PER_30_DAYS_CENTS;
  const interestCents = cents(taxDueCents * FL_INTEREST_DAILY_FACTOR_2026 * lateDays);
  const feeCents = opts.installment ? FL_INSTALLMENT_FEE_CENTS : 0;
  const totalCents = taxDueCents + penaltyCents + interestCents + feeCents;

  const invalidSsns = employees.filter((e) => !e.ssnValid).length;
  if (invalidSsns) {
    warnings.push(
      `${invalidSsns} employee record(s) have a missing or structurally invalid Social Security `
      + 'number. Florida charges the greater of $50 or 10% of tax due, capped at $300 per report — '
      + 'waived if a complete report is filed within 30 days of the penalty notice, but not more '
      + 'than once in any twelve-month period.',
    );
  }
  const mustFileElectronically = employees.length >= FL_EFILE_EMPLOYEE_THRESHOLD;
  if (mustFileElectronically) {
    warnings.push(
      `With ${employees.length} employees this report must be filed and paid electronically `
      + '(10 or more in any quarter during Florida\'s prior fiscal year, July 1 – June 30).',
    );
  }
  if (lateBlocks > 0) {
    warnings.push(
      `Filed ${lateDays} day(s) after the penalty-after date of ${penaltyAfter}: `
      + `${lateBlocks} × $25 penalty. Florida's documents state no maximum for this penalty.`,
    );
  }
  if (fallsOnWeekend(penaltyAfter)) {
    warnings.push(
      `The penalty-after date ${penaltyAfter} falls on a weekend. Florida's rule for a postmark `
      + 'deadline landing on a Saturday or Sunday is not stated in any of the department\'s '
      + 'retrieved documents, so this date is shown exactly as the statute reads. File by the '
      + 'preceding business day rather than relying on an extension.',
    );
  }

  const lines: FormLine[] = [
    { line: '2', label: 'Gross wages paid this quarter', valueCents: grossCents },
    {
      line: '3',
      label: 'Excess wages (over $7,000 per employee this calendar year)',
      valueCents: excessCents,
      note: 'Computed PER EMPLOYEE against year-to-date wages, not company-wide.',
    },
    { line: '4', label: 'Taxable wages (line 2 less line 3)', valueCents: taxableCents },
    { line: '5', label: `Tax due (line 4 × ${ratePct}%)`, valueCents: taxDueCents },
    {
      line: '6',
      label: 'Penalty due',
      valueCents: penaltyCents,
      note: '$25 for each 30 days or fraction thereof that the report is late.',
    },
    {
      line: '7',
      label: 'Interest due',
      valueCents: interestCents,
      note: `11% for 2026, applied as a daily factor of ${FL_INTEREST_DAILY_FACTOR_2026}.`,
    },
    {
      line: '8',
      label: 'Installment fee',
      valueCents: feeCents,
      note: '$5, charged one time per calendar year when paying by installment.',
    },
    {
      line: '9a',
      label: 'Total amount due (lines 5 + 6 + 7 + 8)',
      valueCents: totalCents,
      note: 'If under $1, file the report and send no payment.',
    },
    { line: '9b', label: 'Amount enclosed', valueCents: totalCents },
  ];

  const accrued = await sutaAccrued(pool, sub, from, to);
  const drift = taxDueCents - accrued;
  const reconciles = drift === 0;

  return {
    form: 'RT-6 (Florida Employer\'s Quarterly Report)',
    period: `${year} Q${quarter} (${from} to ${to})`,
    lines,
    ratePct,
    rateWithinBounds,
    dueDate,
    penaltyAfter,
    employees,
    employeeCount: employees.length,
    mustFileElectronically,
    warnings,
    reconciles,
    reconciliation: reconciles
      ? 'Line 5 matches the reemployment tax accrued on the paychecks in this quarter.'
      : `Line 5 is ${(taxDueCents / 100).toFixed(2)} but the paychecks in this quarter accrued `
        + `${(accrued / 100).toFixed(2)} — a difference of ${(drift / 100).toFixed(2)}. That usually `
        + 'means the rate changed mid-quarter, or a run was approved under a different wage base. '
        + 'Reconcile before filing.',
    caveat:
      'This is a worksheet, not a filed return. oshal does not transmit to the Florida Department '
      + 'of Revenue, and it deliberately does NOT generate the payment coupon\'s OCR scanline — no '
      + 'published document describes that string\'s structure, and a wrong one misroutes a payment.',
  };
}

/** Whole days between two ISO dates, floored at zero. */
function daysBetween(from: string, to: string): number {
  const d = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  return d > 0 ? d : 0;
}

/**
 * Per-employee wages for the quarter, with the $7,000 base applied against
 * each person's year-to-date total BEFORE this quarter.
 */
async function employeeWageDetail(
  pool: Pool, sub: string, year: number, from: string, to: string, wageBaseCents: number,
): Promise<Rt6Employee[]> {
  const rows = (await pool.query(
    `SELECT e.employee_id, e.first_name, e.last_name, e.ssn_last4,
            COALESCE(SUM(l.gross_cents) FILTER (WHERE r.pay_date BETWEEN $3 AND $4), 0) AS quarter_gross,
            COALESCE(SUM(l.gross_cents) FILTER (WHERE r.pay_date <  $3), 0)             AS prior_gross
       FROM payroll_run_lines l
       JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
       JOIN payroll_employees e ON e.employee_id = l.employee_id AND e.user_sub = l.user_sub
      WHERE l.user_sub = $1
        AND r.status = 'paid'
        AND date_part('year', r.pay_date) = $2
      GROUP BY e.employee_id, e.first_name, e.last_name, e.ssn_last4
      HAVING COALESCE(SUM(l.gross_cents) FILTER (WHERE r.pay_date BETWEEN $3 AND $4), 0) <> 0
      ORDER BY e.last_name, e.first_name`,
    [sub, year, from, to])).rows;

  return rows.map((r: Row) => {
    const grossWagesCents = Number(r.quarter_gross || 0);
    const priorCents = Number(r.prior_gross || 0);
    // How much of this person's base is left after everything paid earlier in
    // the year. Negative means the base was already used up.
    const remainingBase = Math.max(0, wageBaseCents - priorCents);
    const taxableWagesCents = Math.min(grossWagesCents, remainingBase);
    return {
      employeeId: String(r.employee_id),
      name: `${r.last_name}, ${r.first_name}`,
      ssnLast4: String(r.ssn_last4 || ''),
      // Only the last four are stored in the clear; a blank one cannot be valid.
      ssnValid: String(r.ssn_last4 || '').length === 4,
      grossWagesCents,
      taxableWagesCents,
      excessWagesCents: grossWagesCents - taxableWagesCents,
    };
  });
}

/** The reemployment tax actually accrued on the paychecks in the period. */
async function sutaAccrued(pool: Pool, sub: string, from: string, to: string): Promise<number> {
  const r = await pool.query(
    `SELECT COALESCE(SUM(l.suta_cents), 0) AS suta
       FROM payroll_run_lines l
       JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
      WHERE l.user_sub = $1 AND r.status = 'paid' AND r.pay_date BETWEEN $2 AND $3`,
    [sub, from, to]);
  return Number(r.rows[0]?.suta || 0);
}

/**
 * @description The quarterly installment schedule, for an employer electing it.
 *
 * VERIFIED, RT-6N: a Q1 (03/31) return may pay in quarters due 04/30, 07/31,
 * 10/31 and 12/31; a Q2 return in thirds; a Q3 return in halves. A Q4 return has
 * no installment option.
 * @param year - Calendar year.
 * @param quarter - 1–4.
 * @returns The instalment due dates, empty for Q4.
 */
export function rt6InstallmentDates(year: number, quarter: number): string[] {
  const all = [`${year}-04-30`, `${year}-07-31`, `${year}-10-31`, `${year}-12-31`];
  if (quarter === 1) return all;
  if (quarter === 2) return all.slice(1);
  if (quarter === 3) return all.slice(2);
  return [];
}
