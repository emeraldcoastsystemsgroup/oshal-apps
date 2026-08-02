/**
 * Tax form worksheets — Form 941, Form 940, and the W-2, computed from the
 * ledger with the exact line numbers the forms use.
 *
 * THE MODEL, same as NACHA: oshal computes and produces; the employer files.
 * We do not transmit to the IRS or the SSA, which is why these are worksheets
 * and documents rather than an e-file pipeline — but every figure is the one
 * that belongs in the numbered box, so filing is transcription rather than
 * arithmetic.
 *
 * WHY THE LINE NUMBERS MATTER: "quarterly liability" as a single total is not
 * useful at a filing desk. Form 941 line 5a wants Social Security WAGES times
 * 0.124 — both halves, computed on the wage base, not the tax actually withheld;
 * line 5d is the additional Medicare wages at 0.009 with no employer share; and
 * line 12 must reconcile to what was actually deposited or the return is wrong.
 * Producing the boxes forces the engine to have kept the right accumulators, and
 * the reconciliation check is where a mismatch surfaces.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 22:15:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — Form 941 quarterly worksheet (lines 1–2, 3, 5a–5d with their statutory rates, 5e, 6, 10, 12) with a deposit reconciliation, Form 940 annual FUTA worksheet (lines 3, 5, 7, 8) honoring the per-employee wage base, and the W-2 box set gated on identity readiness so a document is only produced when it can legally be issued.
 *
 * @module payroll-forms
 */

import type { AppContext } from '@/app/composition/app-context';
import {
  ADDL_MEDICARE_RATE, FUTA_RATE, FUTA_WAGE_BASE_CENTS, MEDICARE_RATE, SS_RATE, SS_WAGE_BASE_CENTS,
} from './payroll-tax-tables';

type Pool = AppContext['pool'];

/** COMBINED employee + employer rates, which is what the 941 lines actually use. */
const SS_COMBINED = SS_RATE * 2;
const MEDICARE_COMBINED = MEDICARE_RATE * 2;

/** One numbered line on a form. */
export interface FormLine {
  line: string;
  label: string;
  valueCents: number;
  note?: string;
}

/** A completed worksheet. */
export interface FormWorksheet {
  form: string;
  period: string;
  lines: FormLine[];
  /** Whether the computed liability reconciles to what was recorded as deposited. */
  reconciles: boolean;
  reconciliation: string;
  caveat: string;
}

/** Round half-up to whole cents. */
function cents(v: number): number {
  return Math.round(v);
}

/** The calendar bounds of a quarter. */
function quarterBounds(year: number, quarter: number): { from: string; to: string } {
  const startMonth = (quarter - 1) * 3;
  const from = new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, startMonth + 3, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * @description Build the Form 941 worksheet for one quarter.
 *
 * Lines 5a–5d are computed from WAGES at the statutory combined rates, not from
 * the tax withheld — that is what the form asks for, and computing it the other
 * way hides an under-withholding error instead of surfacing it at line 12.
 * @param pool - Postgres pool.
 * @param sub - Owning OIDC sub.
 * @param year - Tax year.
 * @param quarter - 1–4.
 * @returns The worksheet with its reconciliation verdict.
 */
export async function form941(pool: Pool, sub: string, year: number, quarter: number): Promise<FormWorksheet> {
  const { from, to } = quarterBounds(year, quarter);
  const t = (await pool.query(
    `SELECT COUNT(DISTINCT l.employee_id) AS employees,
            COALESCE(SUM(l.fit_taxable_cents + l.supplemental_taxable_cents),0) AS wages,
            COALESCE(SUM(l.fit_cents),0) AS fit,
            COALESCE(SUM(l.ss_taxable_cents),0) AS ss_wages,
            COALESCE(SUM(l.tips_cents),0) AS tips,
            COALESCE(SUM(l.fica_taxable_cents),0) AS medicare_wages,
            COALESCE(SUM(l.addl_medicare_cents),0) AS addl_withheld,
            COALESCE(SUM(l.ss_cents + l.medicare_cents + l.addl_medicare_cents
                       + l.er_ss_cents + l.er_medicare_cents),0) AS fica_actual
       FROM payroll_run_lines l
       JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
      WHERE l.user_sub = $1 AND r.status = 'paid' AND r.pay_date BETWEEN $2 AND $3`,
    [sub, from, to])).rows[0];

  const n = (k: string) => Number(t[k] || 0);
  // Additional-Medicare WAGES are derived from the tax withheld, because the
  // engine tracks the tax at the threshold crossing rather than the wage slice.
  const addlWages = ADDL_MEDICARE_RATE > 0 ? cents(n('addl_withheld') / ADDL_MEDICARE_RATE) : 0;

  const l5a = cents(n('ss_wages') * SS_COMBINED);
  const l5b = cents(n('tips') * SS_COMBINED);
  const l5c = cents(n('medicare_wages') * MEDICARE_COMBINED);
  const l5d = cents(addlWages * ADDL_MEDICARE_RATE);
  const l5e = l5a + l5b + l5c + l5d;
  const l6 = n('fit') + l5e;

  const lines: FormLine[] = [
    { line: '1', label: 'Number of employees who received wages this quarter', valueCents: n('employees'),
      note: 'A COUNT, not a dollar amount.' },
    { line: '2', label: 'Wages, tips, and other compensation', valueCents: n('wages') },
    { line: '3', label: 'Federal income tax withheld from wages and tips', valueCents: n('fit') },
    { line: '5a', label: 'Taxable social security wages x 0.124', valueCents: l5a,
      note: `Wages ${n('ss_wages')} at the combined employee+employer rate.` },
    { line: '5b', label: 'Taxable social security tips x 0.124', valueCents: l5b },
    { line: '5c', label: 'Taxable Medicare wages and tips x 0.029', valueCents: l5c,
      note: `Wages ${n('medicare_wages')}; Medicare has no wage base.` },
    { line: '5d', label: 'Taxable wages subject to Additional Medicare Tax x 0.009', valueCents: l5d,
      note: 'Employee-only — there is no employer share of the additional 0.9%.' },
    { line: '5e', label: 'Total social security and Medicare taxes (5a + 5b + 5c + 5d)', valueCents: l5e },
    { line: '6', label: 'Total taxes before adjustments (3 + 5e)', valueCents: l6 },
    { line: '10', label: 'Total taxes after adjustments', valueCents: l6,
      note: 'Equal to line 6 — this worksheet models no adjustments (sick pay, tips, group-term life).' },
    { line: '12', label: 'Total taxes after adjustments and nonrefundable credits', valueCents: l6 },
  ];

  // The reconciliation that matters: the form's own arithmetic against what the
  // ledger actually withheld and accrued. A gap means a line is being computed
  // from the wrong accumulator.
  const drift = Math.abs(l5e - n('fica_actual'));
  return {
    form: '941',
    period: `${year} Q${quarter} (${from} to ${to})`,
    lines,
    reconciles: drift <= 2 * Number(t.employees || 0) + 2,
    reconciliation: drift === 0
      ? 'Line 5e matches the FICA actually withheld and accrued exactly.'
      : `Line 5e differs from the FICA actually withheld and accrued by ${drift} cents. Small amounts are per-check rounding across ${n('employees')} employees; a large gap means a wage base or threshold was applied inconsistently.`,
    caveat: 'A worksheet, not a filed return. Lines 7–9 (adjustments), 11 (credits) and 13+ (deposits and balance due) are not modelled — transcribe these values onto the form you file.',
  };
}

/**
 * @description Build the Form 940 annual FUTA worksheet.
 *
 * FUTA's $7,000 wage base is PER EMPLOYEE, so line 5 (excess payments) has to be
 * computed employee by employee — a company-wide total would silently under-state
 * the exclusion for anyone earning more than the base.
 * @param pool - Postgres pool.
 * @param sub - Owning OIDC sub.
 * @param year - Tax year.
 * @returns The worksheet.
 */
export async function form940(pool: Pool, sub: string, year: number): Promise<FormWorksheet> {
  const rows = (await pool.query(
    `SELECT l.employee_id,
            COALESCE(SUM(l.fica_taxable_cents),0) AS wages,
            COALESCE(SUM(l.futa_cents),0) AS futa
       FROM payroll_run_lines l
       JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
      WHERE l.user_sub = $1 AND r.status = 'paid' AND date_part('year', r.pay_date) = $2
      GROUP BY l.employee_id`, [sub, year])).rows;

  let totalWages = 0;
  let excess = 0;
  let futaAccrued = 0;
  for (const r of rows) {
    const w = Number(r.wages || 0);
    totalWages += w;
    excess += Math.max(0, w - FUTA_WAGE_BASE_CENTS); // per-employee base
    futaAccrued += Number(r.futa || 0);
  }
  const taxable = Math.max(0, totalWages - excess);
  const computed = cents(taxable * FUTA_RATE);

  const lines: FormLine[] = [
    { line: '3', label: 'Total payments to all employees', valueCents: totalWages },
    { line: '5', label: 'Payments exceeding the $7,000 FUTA wage base', valueCents: excess,
      note: `Computed per employee across ${rows.length} employees — the base is per person, not per company.` },
    { line: '7', label: 'Total taxable FUTA wages (3 − 5)', valueCents: taxable },
    { line: '8', label: 'FUTA tax before adjustments (7 x 0.006)', valueCents: computed,
      note: 'The 0.006 net rate assumes the full 5.4% state credit. A credit-reduction state owes more — see the company FUTA credit-reduction setting.' },
  ];

  const drift = Math.abs(computed - futaAccrued);
  return {
    form: '940',
    period: String(year),
    lines,
    reconciles: drift <= rows.length + 2,
    reconciliation: drift === 0
      ? 'Line 8 matches the FUTA accrued across the year exactly.'
      : `Line 8 differs from the FUTA accrued per check by ${drift} cents (per-check rounding across ${rows.length} employees, or a credit-reduction rate applied mid-year).`,
    caveat: 'A worksheet, not a filed return. Part 2 line 4 (exempt payments), the credit-reduction schedule (Schedule A) and Part 5 are not modelled.',
  };
}

/** Every box on a W-2, plus whether it may actually be issued. */
export interface W2Document {
  year: number;
  issuable: boolean;
  missing: string[];
  employer: { name: string; ein: string; address: string };
  employee: { name: string; ssn: string; address: string };
  boxes: Record<string, number>;
  box12: Array<{ code: string; amountCents: number; label: string }>;
  box14b: string;
  caveat: string;
}

/**
 * @description Build the W-2 box set for one employee and year.
 *
 * `issuable` is COMPUTED from whether the identity required by the form is on
 * file, so the document either carries real identifiers or says exactly what is
 * missing — the "preview" label is a state, not a disclaimer.
 * @param pool - Postgres pool.
 * @param sub - Owning OIDC sub.
 * @param employee - The employee row.
 * @param company - The company row.
 * @param year - Tax year.
 * @param revealed - Decrypted { ssn, ein } when the caller is entitled to them.
 * @returns The document.
 */
export async function w2Document(
  pool: Pool, sub: string, employee: Record<string, unknown>, company: Record<string, unknown>,
  year: number, revealed: { ssn: string | null; ein: string | null },
): Promise<W2Document> {
  const t = (await pool.query(
    `SELECT COALESCE(SUM(l.fit_taxable_cents + l.supplemental_taxable_cents),0) b1,
            COALESCE(SUM(l.fit_cents),0) b2,
            COALESCE(SUM(l.ss_taxable_cents),0) b3,
            COALESCE(SUM(l.ss_cents),0) b4,
            COALESCE(SUM(l.fica_taxable_cents),0) b5,
            COALESCE(SUM(l.medicare_cents + l.addl_medicare_cents),0) b6,
            COALESCE(SUM(l.tips_cents),0) b7,
            COALESCE(SUM(l.state_cents),0) b17,
            COALESCE(SUM(l.deferral_cents),0) d,
            COALESCE(SUM(l.qualified_ot_cents),0) tt
       FROM payroll_run_lines l
       JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
      WHERE l.user_sub = $1 AND l.employee_id = $2 AND r.status = 'paid'
        AND date_part('year', r.pay_date) = $3`,
    [sub, employee.employee_id, year])).rows[0];

  const missing: string[] = [];
  if (!revealed.ein) missing.push('employer EIN');
  if (!String(company.legal_name || '').trim()) missing.push('employer legal name');
  if (!String(company.address_line1 || '').trim()) missing.push('employer address');
  if (!revealed.ssn) missing.push('employee SSN');
  if (!String(employee.address_line1 || '').trim()) missing.push('employee address');

  const priorApplies = Number(employee.prior_ytd_year || 0) === year;
  const n = (k: string) => Number(t[k] || 0);
  const box12 = [
    { code: 'D', amountCents: n('d'), label: 'Elective deferrals to a 401(k)' },
    { code: 'TT', amountCents: n('tt'), label: 'Qualified overtime compensation (the FLSA premium only)' },
    { code: 'TP', amountCents: n('b7'), label: 'Total cash tips' },
  ].filter((c) => c.amountCents > 0);

  const fmtEin = (e: string | null) => (e ? `${e.slice(0, 2)}-${e.slice(2)}` : '');
  const fmtSsn = (s: string | null) => (s ? `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}` : '');
  const addr = (r: Record<string, unknown>) => [r.address_line1, r.address_line2,
    [r.city, r.state_code, r.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return {
    year,
    issuable: missing.length === 0,
    missing,
    employer: { name: String(company.legal_name || company.company_name || ''), ein: fmtEin(revealed.ein), address: addr(company) },
    employee: {
      name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
      ssn: fmtSsn(revealed.ssn), address: addr(employee),
    },
    boxes: {
      1: n('b1'), 2: n('b2'), 3: Math.min(n('b3'), SS_WAGE_BASE_CENTS), 4: n('b4'),
      5: n('b5'), 6: n('b6'), 7: n('b7'), 17: n('b17'),
    },
    box12,
    box14b: String(employee.tipped_occupation_code || ''),
    caveat: priorApplies
      ? 'Covers wages paid through THIS system only. Prior-YTD figures entered for a mid-year switch are excluded — your previous provider issues its own W-2 for the wages it paid.'
      : 'Computed from runs paid in this system. Verify against your own records before filing with the SSA.',
  };
}
