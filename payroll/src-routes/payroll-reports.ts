/**
 * Reports that connect payroll to the rest of the business.
 *
 * Two of these are the difference between a calculator and a system:
 *
 * GL JOURNAL — payroll's output is an accounting entry, and without one the
 * numbers never reach the books. Gross wages are an expense, every withholding
 * is a LIABILITY the employer holds and later remits (not a reduction of
 * expense), net pay is cash out, and the employer's own taxes are a second
 * expense with a matching liability. The entry must balance to the cent, and the
 * generator asserts that rather than trusting it.
 *
 * DEPOSIT SCHEDULE — federal employment taxes are not due quarterly, which is
 * the mistake the v1 quarterly-liability report invited. A monthly depositor owes
 * by the 15th of the following month; a semiweekly depositor owes on a Wednesday
 * or Friday depending on the payday; and taxes ACCUMULATING to $100,000 within
 * a deposit period are due the NEXT BUSINESS DAY regardless of status. Reporting
 * the quarter total tells an employer nothing about whether they are already late.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 19:30:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — the balancing GL journal, the per-payday federal deposit schedule with monthly/semiweekly due dates and the $100,000 next-day rule, the deduction register, and labor distribution by department.
 * 2                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 8: the deposit schedule rolled due dates off weekends only and applied the $100,000 rule to each payday alone. It now hands the year's paydays to payroll-deposits, which groups them by deposit period, takes due dates from the IRS legal-holiday calendar with the semiweekly extra-day allowance, accumulates the One-Day test over the period, and reports the $2,500 pay-with-return test per quarter.
 *
 * @module payroll-reports
 */

import type { AppContext } from '@/app/composition/app-context';
import { buildDepositSchedule, type DepositSchedule } from './payroll-deposits';
import { isoDate, type Row } from './payroll-store';

type Pool = AppContext['pool'];

/** One side of a journal entry. */
export interface JournalLine {
  account: string;
  label: string;
  debitCents: number;
  creditCents: number;
  department?: string;
}

/** A balanced journal entry for one pay run. */
export interface Journal {
  runId: string;
  payDate: string;
  lines: JournalLine[];
  totalDebitsCents: number;
  totalCreditsCents: number;
  balanced: boolean;
}

/** Chart-of-accounts codes. Deliberately conventional; an export maps them. */
const ACCT = {
  wageExpense: '6000',
  employerTaxExpense: '6010',
  fitPayable: '2100',
  ficaPayable: '2110',
  statePayable: '2120',
  futaPayable: '2130',
  sutaPayable: '2140',
  deductionsPayable: '2150',
  cash: '1000',
};

/**
 * @description Build the balancing journal entry for one paid run.
 *
 * Withholdings are credited to LIABILITY accounts because the employer is
 * holding someone else's money until it is remitted — booking them against wage
 * expense (a common shortcut) understates both payroll cost and what is owed.
 * @param pool - Postgres pool.
 * @param sub - Owning OIDC sub.
 * @param runId - The run to post.
 * @returns The journal, with a computed balance check.
 */
export async function runJournal(pool: Pool, sub: string, runId: string): Promise<Journal | null> {
  const run = (await pool.query(
    'SELECT run_id, pay_date FROM payroll_runs WHERE run_id = $1 AND user_sub = $2', [runId, sub])).rows[0];
  if (!run) return null;

  const t = (await pool.query(
    `SELECT COALESCE(SUM(l.gross_cents),0) gross, COALESCE(SUM(l.fit_cents),0) fit,
            COALESCE(SUM(l.ss_cents + l.medicare_cents + l.addl_medicare_cents),0) fica_ee,
            COALESCE(SUM(l.state_cents),0) state,
            COALESCE(SUM(l.pretax_cents + l.posttax_cents),0) deductions,
            COALESCE(SUM(l.net_cents),0) net,
            COALESCE(SUM(l.er_ss_cents + l.er_medicare_cents),0) fica_er,
            COALESCE(SUM(l.futa_cents),0) futa, COALESCE(SUM(l.suta_cents),0) suta,
            COALESCE(SUM(l.imputed_cents),0) imputed, COALESCE(SUM(l.tips_cents),0) tips
       FROM payroll_run_lines l WHERE l.user_sub = $1 AND l.run_id = $2`, [sub, runId])).rows[0];

  const n = (k: string) => Number(t[k] || 0);
  const lines: JournalLine[] = [];
  const push = (account: string, label: string, debit: number, credit: number) => {
    if (debit === 0 && credit === 0) return;
    lines.push({ account, label, debitCents: debit, creditCents: credit });
  };

  // Imputed income and reported cash tips are wages that never became cash, so
  // they are backed out of the credit side rather than shown as money paid.
  const nonCashWages = n('imputed') + n('tips');

  push(ACCT.wageExpense, 'Gross wages', n('gross'), 0);
  push(ACCT.employerTaxExpense, 'Employer payroll taxes', n('fica_er') + n('futa') + n('suta'), 0);
  push(ACCT.fitPayable, 'Federal income tax withheld', 0, n('fit'));
  push(ACCT.ficaPayable, 'FICA payable (employee + employer)', 0, n('fica_ee') + n('fica_er'));
  push(ACCT.statePayable, 'State income tax withheld', 0, n('state'));
  push(ACCT.futaPayable, 'FUTA payable', 0, n('futa'));
  push(ACCT.sutaPayable, 'SUTA payable', 0, n('suta'));
  push(ACCT.deductionsPayable, 'Employee deductions payable', 0, n('deductions'));
  push(ACCT.cash, 'Net pay', 0, n('net'));
  // The balancing contra for wages that were taxed but never paid in cash.
  push(ACCT.wageExpense, 'Less: imputed income and reported cash tips (non-cash wages)', 0, nonCashWages);

  const totalDebitsCents = lines.reduce((a, l) => a + l.debitCents, 0);
  const totalCreditsCents = lines.reduce((a, l) => a + l.creditCents, 0);
  return {
    runId: String(run.run_id), payDate: isoDate(run.pay_date), lines,
    totalDebitsCents, totalCreditsCents, balanced: totalDebitsCents === totalCreditsCents,
  };
}

/**
 * @description The federal employment-tax deposit schedule for a year.
 *
 * Liability per payday = federal income tax withheld + BOTH halves of FICA
 * (26 CFR 31.6302-1(e)(1): the employee tax under section 3102, the employer
 * tax under section 3111 and the income tax withheld under section 3402). A
 * void is a paid run of negated amounts on its own pay date, so it counts
 * against the period it falls in. Grouping, due dates, the One-Day rule and the
 * $2,500 test are payroll-deposits, which reads the IRS legal-holiday calendar.
 * @param pool - Postgres pool.
 * @param sub - Owning OIDC sub.
 * @param year - Tax year.
 * @param depositorStatus - 'monthly' or 'semiweekly'.
 * @param today - Today, YYYY-MM-DD.
 * @returns Obligations by deposit period, any forced status change, and the quarter summary.
 */
export async function depositSchedule(
  pool: Pool, sub: string, year: number, depositorStatus: string, today: string,
): Promise<DepositSchedule> {
  const rows = (await pool.query(
    `SELECT r.pay_date,
            COALESCE(SUM(l.fit_cents + l.ss_cents + l.medicare_cents + l.addl_medicare_cents
                       + l.er_ss_cents + l.er_medicare_cents),0) AS liability
       FROM payroll_run_lines l
       JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
      WHERE l.user_sub = $1 AND r.status = 'paid' AND date_part('year', r.pay_date) = $2
      GROUP BY r.pay_date ORDER BY r.pay_date`, [sub, year])).rows;
  const paydays = rows.map((r: Row) => ({ payDate: isoDate(r.pay_date), liabilityCents: Number(r.liability || 0) }));
  return buildDepositSchedule(paydays, depositorStatus === 'semiweekly' ? 'semiweekly' : 'monthly', year, today);
}

/** Every deduction taken in a period, by code — what each payee is owed. */
export async function deductionRegister(pool: Pool, sub: string, from: string, to: string): Promise<Row[]> {
  return (await pool.query(
    `SELECT d.code, COUNT(DISTINCT d.employee_id) AS employees,
            COALESCE(SUM(d.applied_cents),0) AS applied_cents,
            COALESCE(SUM(d.arrears_added_cents),0) AS arrears_added_cents
       FROM payroll_line_deductions d
       JOIN payroll_runs r ON r.run_id = d.run_id AND r.user_sub = d.user_sub
      WHERE d.user_sub = $1 AND r.status = 'paid' AND r.pay_date BETWEEN $2 AND $3
      GROUP BY d.code ORDER BY d.code`, [sub, from, to])).rows;
}

/** Payroll cost by department — the allocation an accountant needs to post. */
export async function laborDistribution(pool: Pool, sub: string, from: string, to: string): Promise<Row[]> {
  return (await pool.query(
    `SELECT COALESCE(NULLIF(e.department,''),'(unassigned)') AS department,
            COALESCE(NULLIF(e.cost_center,''),'(none)') AS cost_center,
            COUNT(DISTINCT l.employee_id) AS employees,
            COALESCE(SUM(l.gross_cents),0) AS gross_cents,
            COALESCE(SUM(l.er_ss_cents + l.er_medicare_cents + l.futa_cents + l.suta_cents),0) AS employer_tax_cents
       FROM payroll_run_lines l
       JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
       JOIN payroll_employees e ON e.employee_id = l.employee_id AND e.user_sub = l.user_sub
      WHERE l.user_sub = $1 AND r.status = 'paid' AND r.pay_date BETWEEN $2 AND $3
      GROUP BY 1, 2 ORDER BY 1, 2`, [sub, from, to])).rows;
}
