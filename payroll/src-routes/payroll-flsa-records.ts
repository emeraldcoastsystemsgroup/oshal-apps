/**
 * The Fair Labor Standards Act payroll record for one employee, read from the
 * rows the package stored when it paid them.
 *
 * 29 CFR 516.2(a) lists what an employer must keep for each employee covered by
 * the minimum-wage and overtime provisions, and 516.5 and 516.6 say for how
 * long. This module answers each item from stored rows, and names an item it
 * cannot answer rather than filling it in:
 *
 *   (1) name, and the number used in place of it on payroll records
 *   (2) home address
 *   (3) date of birth, if under 19
 *   (4) sex (the regulation allows the title: "Mr., Mrs., Miss., or Ms.") and occupation
 *   (5) time of day and day of week the workweek begins
 *   (6) the regular hourly rate in a workweek with overtime, the basis of pay,
 *       and payments excluded from the regular rate
 *   (7) hours worked each workday and in total each workweek
 *   (8) straight-time earnings; (9) overtime premium
 *   (10) additions to and deductions from wages, with their nature
 *   (11) total wages paid each pay period; (12) the date of payment and period
 *
 * Hours recorded for a pay period rather than by the day (the hours-and-rate
 * line) cannot answer (7)'s daily half: the record says so for that period.
 *
 * Retention: payroll records "for at least 3 years ... From the last date of
 * entry" (516.5(a)); time cards and other supplementary records "for a period of
 * at least 2 years" (516.6(a)(1)). Paid runs are never deleted here (a mistake is
 * voided, not erased), and an employee with history is terminated rather than
 * deleted, so the stored rows are the record for as long as the database is kept.
 *
 * SOURCES, read on 2026-11-20: 29 CFR 516.2, 516.5, 516.6 (eCFR, current to
 * 2026-11-18), https://www.ecfr.gov/current/title-29/part-516.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 3: the 29 CFR 516.2(a) record set per pay period from stored rows (identity items, workweek start, hours by workday and by workweek, regular rate in overtime weeks, basis of pay, excluded payments, straight time, premium, additions and deductions, wages paid, date and period), each item it cannot answer named, and the 516.5/516.6 keep-until dates.
 *
 * @module payroll-flsa-records
 */

import type { AppContext } from '@/app/composition/app-context';
import { deductionCode, earningsCode } from './payroll-codes';
import { workweekStart } from './payroll-workweek';
import { workweekTotals, type EarningRow } from './payroll-payrun';

type Queryable = { query: AppContext['pool']['query'] };
type Row = Record<string, unknown>;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A stored DATE as YYYY-MM-DD. */
function day(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v ? String(v).slice(0, 10) : '';
}

/** Whole cents from a stored value. */
const c = (v: unknown) => Math.round(Number(v) || 0);

/** A date some whole years later (the keep-until dates). */
function yearsAfter(date: string, years: number): string {
  return `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
}

/** Age in whole years on a date. */
function ageOn(birth: string, date: string): number {
  const years = Number(date.slice(0, 4)) - Number(birth.slice(0, 4));
  return date.slice(5) < birth.slice(5) ? years - 1 : years;
}

/** One workweek of the record. */
export interface RecordWorkweek {
  start: string;
  hours: number;
  straightTimeCents: number;
  premiumCents: number;
  /** (6)(i): only for a workweek in which overtime is due. */
  regularRateCents: number | null;
}

/** One pay period of the record. */
export interface RecordPeriod {
  runId: string;
  kind: string;
  payDate: string;
  periodStart: string;
  periodEnd: string;
  /** Hours by workday, or null when the hours were recorded for the period only. */
  daily: Array<{ date: string; hours: number }> | null;
  workweeks: RecordWorkweek[];
  excludedPayments: Array<{ nature: string; amountCents: number }>;
  straightTimeCents: number;
  premiumCents: number;
  additionsAndDeductions: Array<{ nature: string; amountCents: number }>;
  totalWagesCents: number;
  netPaidCents: number;
  keepUntil: string;
  gaps: string[];
}

/** The employee's identity items, or the item missing. */
function identity(emp: Row, company: Row, payDates: string[]) {
  const address = [emp.address_line1, emp.address_line2, emp.city, emp.postal_code].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
  const birth = day(emp.birth_date);
  const under19 = birth && payDates.some((d) => ageOn(birth, d) < 19);
  const gaps: string[] = [];
  if (!address) gaps.push('(2) home address is not on file');
  if (!String(emp.occupation || '').trim()) gaps.push('(4) occupation is not on file');
  if (!String(emp.name_prefix || '').trim()) gaps.push('(4) the title that may stand for sex (Mr., Mrs., Miss, Ms.) is not on file');
  if (!birth) gaps.push('(3) date of birth is not on file, so whether the employee is under 19 cannot be shown');
  return {
    name: `${String(emp.name_prefix || '').trim()} ${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
    employeeNumber: String(emp.employee_id), homeAddress: address, dateOfBirthIfUnder19: under19 ? birth : '',
    occupation: String(emp.occupation || ''),
    workweekBegins: `${DAYS[Math.min(6, Math.max(0, Math.trunc(Number(company.workweek_start_day) || 0)))]} at ${String(company.workweek_start_time || '00:00')}`,
    basisOfPay: emp.comp_type === 'salary' ? `Salary, $${(c(emp.annual_salary_cents) / 100).toFixed(2)} a year` : `Per hour, $${(c(emp.hourly_rate_cents) / 100).toFixed(2)}`,
    gaps,
  };
}

/** The workweeks of a check built from earning rows, by the workweek's first day. */
function rowWorkweeks(rows: EarningRow[], startDay: number): RecordWorkweek[] {
  const byStart = new Map<string, EarningRow[]>();
  for (const r of rows) {
    const key = r.workDate ? workweekStart(r.workDate, startDay) : `week ${r.workweek}`;
    if (!byStart.has(key)) byStart.set(key, []);
    byStart.get(key)!.push(r);
  }
  return [...byStart.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([start, wk]) => {
    const t = workweekTotals(wk);
    return { start, hours: t.hours, straightTimeCents: t.straightCents, premiumCents: t.premiumCents,
      regularRateCents: (t.hours > 40 || t.premiumCents > 0) && t.hours > 0 ? Math.round(t.straightCents / t.hours) : null };
  });
}

/** One pay period built from earning rows. */
function periodFromRows(rows: EarningRow[], startDay: number) {
  const worked = rows.filter((r) => earningsCode(r.code)?.hoursWorked && Number(r.hours) > 0);
  const dated = worked.length > 0 && worked.every((r) => r.workDate);
  const daily = new Map<string, number>();
  for (const r of worked) if (r.workDate) daily.set(r.workDate, (daily.get(r.workDate) || 0) + Number(r.hours));
  const excluded = rows.filter((r) => earningsCode(r.code)?.regularRate === 'excluded')
    .map((r) => ({ nature: earningsCode(r.code)!.label, amountCents: c(r.amountCents) || Math.round(Number(r.hours) * c(r.rateCents)) }));
  const workweeks = rowWorkweeks(rows, startDay);
  return {
    daily: dated ? [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, hours]) => ({ date, hours })) : null,
    workweeks, excluded,
    straight: workweeks.reduce((a, w) => a + w.straightTimeCents, 0), premium: workweeks.reduce((a, w) => a + w.premiumCents, 0),
  };
}

/** One pay period from an hours-and-rate line: hours for the period only. */
function periodFromHours(line: Row) {
  const computed = (typeof line.computed === 'string' ? JSON.parse(line.computed) : line.computed || {}) as Row;
  const ot = c(computed.overtimeCents);
  const otStraight = Math.round(ot / 1.5);
  const hours = Number(line.hours || 0) + Number(line.ot_hours || 0);
  return {
    daily: null, excluded: [] as Array<{ nature: string; amountCents: number }>,
    workweeks: [{ start: 'pay period', hours, straightTimeCents: c(computed.regularCents) + otStraight, premiumCents: ot - otStraight,
      regularRateCents: ot > 0 && Number(line.ot_hours) > 0 ? Math.round(otStraight / Number(line.ot_hours)) : null }],
    straight: c(computed.regularCents) + otStraight, premium: ot - otStraight,
  };
}

/** (10): every addition to and deduction from wages on the check, with its nature. */
function additionsAndDeductions(line: Row, deductions: Row[]): Array<{ nature: string; amountCents: number }> {
  const out = [
    { nature: 'Federal income tax withheld', amountCents: -c(line.fit_cents) },
    { nature: 'Social Security tax withheld', amountCents: -c(line.ss_cents) },
    { nature: 'Medicare tax withheld', amountCents: -(c(line.medicare_cents) + c(line.addl_medicare_cents)) },
    { nature: 'State income tax withheld', amountCents: -c(line.state_cents) },
    { nature: 'Reimbursement paid', amountCents: c(line.reimbursement_cents) },
  ];
  let itemized = 0;
  for (const d of deductions) {
    itemized += c(d.applied_cents);
    out.push({ nature: deductionCode(String(d.code))?.label || String(d.code), amountCents: -c(d.applied_cents) });
  }
  // What the line deducted that no deduction row itemizes (the hours-and-rate line's 401(k), health and other
  // post-tax amounts), so the record's total always matches the check.
  const rest = c(line.pretax_cents) + c(line.posttax_cents) - itemized;
  if (rest !== 0) out.push({ nature: 'Other deductions on this check (401(k), health, other post-tax)', amountCents: -rest });
  return out.filter((x) => x.amountCents !== 0);
}

/**
 * @description The 29 CFR 516.2(a) record for one employee's paid pay periods.
 * @param q - Pool or client.
 * @param sub - Owning OIDC sub.
 * @param employeeId - The employee.
 * @param from - First pay date, YYYY-MM-DD.
 * @param to - Last pay date, YYYY-MM-DD.
 * @returns The record, or null when the employee is not the caller's.
 */
export async function flsaRecords(q: Queryable, sub: string, employeeId: string, from: string, to: string) {
  const emp = (await q.query('SELECT * FROM payroll_employees WHERE employee_id = $1 AND user_sub = $2', [employeeId, sub])).rows[0];
  if (!emp) return null;
  const company = (await q.query('SELECT * FROM payroll_company WHERE user_sub = $1', [sub])).rows[0] || {};
  const startDay = Math.trunc(Number(company.workweek_start_day) || 0);
  const lines = (await q.query(
    `SELECT l.*, r.kind, r.pay_date, r.period_start, r.period_end
       FROM payroll_run_lines l JOIN payroll_runs r ON r.run_id = l.run_id AND r.user_sub = l.user_sub
      WHERE l.user_sub = $1 AND l.employee_id = $2 AND r.status = 'paid' AND r.pay_date >= $3 AND r.pay_date <= $4
      ORDER BY r.pay_date`, [sub, employeeId, from, to])).rows;
  const periods: RecordPeriod[] = [];
  for (const line of lines) periods.push(await period(q, sub, employeeId, line, startDay));
  return { employee: identity(emp, company, periods.map((p) => p.payDate)), from, to, periods,
    retention: '29 CFR 516.5(a): payroll records at least 3 years from the last date of entry; 516.6(a)(1): time cards at least 2 years.' };
}

/** One paid pay period of the record. */
async function period(q: Queryable, sub: string, employeeId: string, line: Row, startDay: number): Promise<RecordPeriod> {
  const runId = String(line.run_id);
  const rows = (await q.query(
    `SELECT code, hours, rate_cents, amount_cents, workweek, work_date FROM payroll_line_earnings
      WHERE user_sub = $1 AND run_id = $2 AND employee_id = $3`, [sub, runId, employeeId])).rows
    .map((x: Row): EarningRow => ({ code: String(x.code), hours: Number(x.hours) || 0, rateCents: c(x.rate_cents),
      amountCents: c(x.amount_cents), workweek: Number(x.workweek) || 1, ...(x.work_date ? { workDate: day(x.work_date) } : {}) }));
  const deductions = (await q.query(
    'SELECT code, applied_cents FROM payroll_line_deductions WHERE user_sub = $1 AND run_id = $2 AND employee_id = $3',
    [sub, runId, employeeId])).rows;
  const built = line.uses_earning_rows === true && rows.length ? periodFromRows(rows, startDay) : periodFromHours(line);
  const payDate = day(line.pay_date);
  return {
    runId, kind: String(line.kind || 'regular'), payDate, periodStart: day(line.period_start), periodEnd: day(line.period_end),
    daily: built.daily, workweeks: built.workweeks, excludedPayments: built.excluded,
    straightTimeCents: built.straight, premiumCents: built.premium,
    additionsAndDeductions: additionsAndDeductions(line, deductions),
    totalWagesCents: c(line.gross_cents), netPaidCents: c(line.net_cents), keepUntil: yearsAfter(payDate, 3),
    gaps: built.daily ? [] : ['(7) hours were recorded for the pay period, not by workday: enter them by the day on the run to keep the daily record.'],
  };
}
