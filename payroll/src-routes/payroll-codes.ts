/**
 * Earnings and deduction CODES — the catalog that makes payroll a system rather
 * than a calculator.
 *
 * WHY ROWS, NOT COLUMNS: v1 carried scalar `hours` / `otHours` / `bonusCents` /
 * `tipsCents` on a run line and scalar `healthPerPeriodCents` / `k401Pct` on an
 * employee. That shape cannot express the things payroll actually does — PTO
 * against a balance, holiday pay, a second job at a different rate, two
 * garnishments with different statutory priorities, an imputed group-term-life
 * amount that is taxable but never paid. Earnings and deductions are ROWS with a
 * code, and the code carries the tax treatment.
 *
 * A code's taxability is FOUR independent booleans, not one. Section 125 health
 * reduces FIT and FICA and FUTA; a 401(k) elective deferral reduces FIT only;
 * imputed group-term life is FIT/FICA/FUTA taxable but is not paid in cash. Any
 * model with a single "pretax" flag gets at least one of those wrong.
 *
 * FLSA REGULAR RATE is a separate axis from taxability. A nondiscretionary bonus
 * is included in the regular rate (29 CFR 778.117) even though it is supplemental
 * for withholding; a discretionary gift is excluded; PTO hours are paid but are
 * not "hours worked" and so do not create overtime.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 15:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — the earnings-code catalog (regular/OT/double-time/holiday/PTO/sick/bereavement/jury/shift-differential/on-call/commission/bonus discretionary+nondiscretionary/cash+charge tips/severance/retro/imputed GTL + vehicle/reimbursement) and the deduction-code catalog (Section 125 medical-dental-vision-FSA-HSA-dependent care, 401(k) pre-tax + Roth, garnishments by statutory priority, dues, loan repayment, charitable), each carrying an independent FIT/FICA/FUTA/state taxability profile and an FLSA regular-rate treatment.
 *
 * @module payroll-codes
 */

/** How a code is treated for each tax base. Four independent axes, never one flag. */
export interface TaxProfile {
  /** Subject to federal income tax withholding. */
  fit: boolean;
  /** Subject to Social Security + Medicare. */
  fica: boolean;
  /** Subject to FUTA (and, here, SUTA — they share a base in this engine). */
  futa: boolean;
  /** Subject to state income tax withholding. */
  state: boolean;
}

/** How an earnings code participates in the FLSA regular rate. */
export type RegularRateTreatment =
  /** Included in the regular rate AND its hours are hours worked (regular, shift diff). */
  | 'included'
  /** Included in the regular rate but carries no hours (nondiscretionary bonus, commission). */
  | 'included-no-hours'
  /** Excluded entirely (discretionary bonus, gifts, reimbursements, PTO cash-out). */
  | 'excluded'
  /** The premium half of overtime — excluded from the rate it is computed from. */
  | 'premium';

/** What an earnings code contributes. */
export interface EarningsCode {
  code: string;
  label: string;
  /** 'hourly' multiplies rate x hours; 'amount' is entered as a flat figure. */
  entry: 'hourly' | 'amount';
  /** Multiplier applied to the base rate for hourly codes (OT 1.5, double-time 2). */
  multiplier: number;
  tax: TaxProfile;
  regularRate: RegularRateTreatment;
  /**
   * Paid in cash on this check. FALSE for imputed income (taxed but never paid)
   * and for reported cash tips (taxed, but the employee already holds the money).
   */
  paid: boolean;
  /** Counts as hours worked for FLSA overtime accumulation. */
  hoursWorked: boolean;
  /** Draws down a leave balance of this type, when the employer tracks one. */
  leaveType?: 'pto' | 'sick';
  /**
   * Fraction of this row's gross that is the QUALIFIED OVERTIME PREMIUM for W-2
   * box 12 TT. Time-and-a-half is 1/3 of the payment, double time is 1/2, and a
   * premium-only row is all of it. Absent means none.
   */
  qualifiedPremiumShare?: number;
  /** W-2 reporting hook: box 12 code, or a special accumulator. */
  w2Box12?: string;
  note: string;
}

/** Every earnings code the engine understands. */
export const EARNINGS_CODES: Record<string, EarningsCode> = {
  REG: {
    code: 'REG', label: 'Regular', entry: 'hourly', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'included', paid: true, hoursWorked: true,
    note: 'Straight-time wages.',
  },
  OT: {
    code: 'OT', label: 'Overtime', entry: 'hourly', multiplier: 1.5,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'premium', paid: true, hoursWorked: true,
    qualifiedPremiumShare: 1 / 3, w2Box12: 'TT',
    note: 'FLSA time-and-a-half. Only the half-time PREMIUM is qualified overtime for box 12 TT.',
  },
  DT: {
    code: 'DT', label: 'Double time', entry: 'hourly', multiplier: 2,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'premium', paid: true, hoursWorked: true,
    qualifiedPremiumShare: 1 / 2, w2Box12: 'TT',
    note: 'Double time. Qualified-overtime premium is the portion above the regular rate.',
  },
  OTP: {
    code: 'OTP', label: 'Overtime premium', entry: 'amount', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'premium', paid: true, hoursWorked: false,
    qualifiedPremiumShare: 1, w2Box12: 'TT',
    note: 'The half-time PREMIUM only, for hours already paid at straight time. This is what '
      + 'the per-workweek FLSA derivation emits — adding a full 1.5x row on top of straight time '
      + 'would pay the base hours twice.',
  },
  HOL: {
    code: 'HOL', label: 'Holiday', entry: 'hourly', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'excluded', paid: true, hoursWorked: false,
    note: 'Holiday pay. Paid, but not hours worked — it does not create overtime.',
  },
  PTO: {
    code: 'PTO', label: 'PTO / vacation', entry: 'hourly', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'excluded', paid: true, hoursWorked: false, leaveType: 'pto',
    note: 'Paid time off. Draws a balance; not hours worked.',
  },
  SICK: {
    code: 'SICK', label: 'Sick', entry: 'hourly', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'excluded', paid: true, hoursWorked: false, leaveType: 'sick',
    note: 'Paid sick leave. Draws a balance; not hours worked.',
  },
  BRV: {
    code: 'BRV', label: 'Bereavement', entry: 'hourly', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'excluded', paid: true, hoursWorked: false,
    note: 'Paid bereavement leave.',
  },
  JURY: {
    code: 'JURY', label: 'Jury duty', entry: 'hourly', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'excluded', paid: true, hoursWorked: false,
    note: 'Paid jury-duty leave.',
  },
  SHIFT: {
    code: 'SHIFT', label: 'Shift differential', entry: 'hourly', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'included', paid: true, hoursWorked: true,
    note: 'Premium for an evening/night shift. IS part of the regular rate (29 CFR 778.207).',
  },
  ONCALL: {
    code: 'ONCALL', label: 'On-call', entry: 'amount', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'included-no-hours', paid: true, hoursWorked: false,
    note: 'On-call standby pay. Included in the regular rate but carries no hours.',
  },
  COMM: {
    code: 'COMM', label: 'Commission', entry: 'amount', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'included-no-hours', paid: true, hoursWorked: false,
    note: 'Commission. Nondiscretionary — it enters the regular rate (29 CFR 778.117).',
  },
  BONUS_ND: {
    code: 'BONUS_ND', label: 'Bonus (nondiscretionary)', entry: 'amount', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'included-no-hours', paid: true, hoursWorked: false,
    note: 'Production/attendance/safety/retention bonus. MUST enter the regular rate.',
  },
  BONUS_D: {
    code: 'BONUS_D', label: 'Bonus (discretionary)', entry: 'amount', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'excluded', paid: true, hoursWorked: false,
    note: 'Truly discretionary gift — excluded from the regular rate (29 CFR 778.211).',
  },
  TIPS_CASH: {
    code: 'TIPS_CASH', label: 'Cash tips reported', entry: 'amount', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'excluded', paid: false, hoursWorked: false, w2Box12: 'TP',
    note: 'Taxable wages the employee ALREADY holds — withheld on, never paid again.',
  },
  TIPS_CHARGE: {
    code: 'TIPS_CHARGE', label: 'Charge tips', entry: 'amount', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'excluded', paid: true, hoursWorked: false, w2Box12: 'TP',
    note: 'Tips collected by the employer on card sales and paid out on the check.',
  },
  SEV: {
    code: 'SEV', label: 'Severance', entry: 'amount', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'excluded', paid: true, hoursWorked: false,
    note: 'Severance pay. Supplemental wages; not hours worked.',
  },
  RETRO: {
    code: 'RETRO', label: 'Retroactive pay', entry: 'amount', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'included-no-hours', paid: true, hoursWorked: false,
    note: 'Retro adjustment for a prior period. Nondiscretionary by nature.',
  },
  GTL: {
    code: 'GTL', label: 'Group-term life (imputed)', entry: 'amount', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'excluded', paid: false, hoursWorked: false, w2Box12: 'C',
    note: 'IMPUTED income: employer-paid coverage over $50,000. Taxed but never paid in cash.',
  },
  VEHICLE: {
    code: 'VEHICLE', label: 'Personal use of vehicle (imputed)', entry: 'amount', multiplier: 1,
    tax: { fit: true, fica: true, futa: true, state: true },
    regularRate: 'excluded', paid: false, hoursWorked: false,
    note: 'IMPUTED income for personal use of a company vehicle. Taxed, not paid.',
  },
  REIMB: {
    code: 'REIMB', label: 'Expense reimbursement', entry: 'amount', multiplier: 1,
    tax: { fit: false, fica: false, futa: false, state: false },
    regularRate: 'excluded', paid: true, hoursWorked: false,
    note: 'Accountable-plan reimbursement. Paid, never taxed, never reported as wages.',
  },
};

/** How a deduction reduces each tax base — the pre-tax class, expressed honestly. */
export interface DeductionCode {
  code: string;
  label: string;
  /**
   * Which tax bases this deduction REDUCES. Section 125 reduces all four;
   * a 401(k) elective deferral reduces FIT and state only; post-tax reduces none.
   */
  reduces: TaxProfile;
  /** Counts toward the IRC 402(g) elective-deferral ceiling (pre-tax AND Roth do). */
  countsToward402g: boolean;
  /** Legally required, so it comes out before disposable earnings are measured. */
  statutory: boolean;
  /**
   * Garnishment priority, lower first. Undefined for non-garnishments. All
   * garnishments share ONE CCPA disposable-earnings ceiling, applied in this order.
   */
  garnishmentPriority?: number;
  /** May be carried into arrears when net pay runs out. */
  allowArrears: boolean;
  w2Box12?: string;
  note: string;
}

/** Every deduction code the engine understands. */
export const DEDUCTION_CODES: Record<string, DeductionCode> = {
  MED125: {
    code: 'MED125', label: 'Medical (Section 125)',
    reduces: { fit: true, fica: true, futa: true, state: true },
    countsToward402g: false, statutory: false, allowArrears: true,
    note: 'Cafeteria-plan medical premium. Reduces every wage base.',
  },
  DEN125: {
    code: 'DEN125', label: 'Dental (Section 125)',
    reduces: { fit: true, fica: true, futa: true, state: true },
    countsToward402g: false, statutory: false, allowArrears: true,
    note: 'Cafeteria-plan dental premium.',
  },
  VIS125: {
    code: 'VIS125', label: 'Vision (Section 125)',
    reduces: { fit: true, fica: true, futa: true, state: true },
    countsToward402g: false, statutory: false, allowArrears: true,
    note: 'Cafeteria-plan vision premium.',
  },
  FSA: {
    code: 'FSA', label: 'Health FSA',
    reduces: { fit: true, fica: true, futa: true, state: true },
    countsToward402g: false, statutory: false, allowArrears: false,
    note: 'Health flexible spending account.',
  },
  HSA: {
    code: 'HSA', label: 'HSA',
    reduces: { fit: true, fica: true, futa: true, state: true },
    countsToward402g: false, statutory: false, allowArrears: false, w2Box12: 'W',
    note: 'Health savings account through a cafeteria plan. W-2 box 12 code W.',
  },
  DCA: {
    code: 'DCA', label: 'Dependent care FSA',
    reduces: { fit: true, fica: true, futa: true, state: true },
    countsToward402g: false, statutory: false, allowArrears: false,
    note: 'Dependent-care assistance. Reported in box 10, not box 12.',
  },
  K401: {
    code: 'K401', label: '401(k) pre-tax',
    reduces: { fit: true, fica: false, futa: false, state: true },
    countsToward402g: true, statutory: false, allowArrears: false, w2Box12: 'D',
    note: 'Elective deferral. Reduces income tax only — deferrals stay FICA and FUTA wages.',
  },
  ROTH401: {
    code: 'ROTH401', label: '401(k) Roth',
    reduces: { fit: false, fica: false, futa: false, state: false },
    countsToward402g: true, statutory: false, allowArrears: false, w2Box12: 'AA',
    note: 'Designated Roth deferral. Post-tax, but shares the 402(g) ceiling with pre-tax.',
  },
  GARN_SUPPORT: {
    code: 'GARN_SUPPORT', label: 'Child / spousal support',
    reduces: { fit: false, fica: false, futa: false, state: false },
    countsToward402g: false, statutory: true, garnishmentPriority: 1, allowArrears: true,
    note: 'Income-withholding order. Highest priority; its own CCPA percentages (50–65%).',
  },
  GARN_LEVY: {
    code: 'GARN_LEVY', label: 'Federal tax levy',
    reduces: { fit: false, fica: false, futa: false, state: false },
    countsToward402g: false, statutory: true, garnishmentPriority: 2, allowArrears: true,
    note: 'IRS levy. Ranks after support.',
  },
  GARN_STUDENT: {
    code: 'GARN_STUDENT', label: 'Student loan garnishment',
    reduces: { fit: false, fica: false, futa: false, state: false },
    countsToward402g: false, statutory: true, garnishmentPriority: 3, allowArrears: true,
    note: 'Administrative wage garnishment, capped at 15% of disposable earnings.',
  },
  GARN_CREDITOR: {
    code: 'GARN_CREDITOR', label: 'Creditor garnishment',
    reduces: { fit: false, fica: false, futa: false, state: false },
    countsToward402g: false, statutory: true, garnishmentPriority: 4, allowArrears: true,
    note: 'Ordinary creditor writ. Lowest priority; 25%/30x CCPA ceiling.',
  },
  DUES: {
    code: 'DUES', label: 'Union dues',
    reduces: { fit: false, fica: false, futa: false, state: false },
    countsToward402g: false, statutory: false, allowArrears: true,
    note: 'Post-tax union dues.',
  },
  LOAN: {
    code: 'LOAN', label: 'Loan repayment',
    reduces: { fit: false, fica: false, futa: false, state: false },
    countsToward402g: false, statutory: false, allowArrears: true,
    note: 'Repayment of an employer or 401(k) loan. Post-tax; usually has a lifetime cap.',
  },
  CHAR: {
    code: 'CHAR', label: 'Charitable contribution',
    reduces: { fit: false, fica: false, futa: false, state: false },
    countsToward402g: false, statutory: false, allowArrears: false,
    note: 'Post-tax charitable withholding.',
  },
  OTHER_POST: {
    code: 'OTHER_POST', label: 'Other post-tax',
    reduces: { fit: false, fica: false, futa: false, state: false },
    countsToward402g: false, statutory: false, allowArrears: true,
    note: 'Catch-all post-tax deduction.',
  },
};

/** Look up an earnings code, or null when unknown. */
export function earningsCode(code: string): EarningsCode | null {
  return EARNINGS_CODES[String(code || '').toUpperCase()] || null;
}

/** Look up a deduction code, or null when unknown. */
export function deductionCode(code: string): DeductionCode | null {
  return DEDUCTION_CODES[String(code || '').toUpperCase()] || null;
}

/** All garnishment codes, in the statutory order they must be applied. */
export function garnishmentCodesByPriority(): DeductionCode[] {
  return Object.values(DEDUCTION_CODES)
    .filter((d) => d.garnishmentPriority !== undefined)
    .sort((a, b) => (a.garnishmentPriority || 0) - (b.garnishmentPriority || 0));
}
