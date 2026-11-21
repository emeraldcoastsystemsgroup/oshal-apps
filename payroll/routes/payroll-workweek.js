"use strict";
/**
 * The employer's fixed workweek, applied to hours recorded by the day.
 *
 * 29 CFR 516.2(a)(7) asks for the "Hours worked each workday and total hours
 * worked each workweek", and defines a workweek as "any fixed and regularly
 * recurring period of 7 consecutive workdays"; (a)(5) asks for the "Time of day
 * and day of week on which the employee's workweek begins". So once a row carries
 * the date it was worked, its workweek is the date's, counted from the company's
 * workweek start day, not a number typed beside it.
 *
 * A workweek need not line up with a pay period: a semimonthly period always
 * splits some. 29 CFR 778.104 makes the workweek the unit for overtime, so this
 * module also reads what EARLIER PAID checks already recorded for a workweek this
 * check shares (hours, straight-time pay, overtime premium), from their dated
 * rows. A voided check is left out.
 *
 * SOURCES, read on 2026-11-20: 29 CFR part 516 and 29 CFR 778.104 (eCFR, current
 * to 2026-11-18).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 3: dated earning rows get their workweek from the company's workweek start day, a date outside the run's period is refused in words, and the hours, straight-time pay and premium of earlier paid checks in a shared workweek are read from their dated rows for the overtime computation.
 *
 * @module payroll-workweek
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.workweekStart = workweekStart;
exports.assignWorkweeks = assignWorkweeks;
exports.carriedWorkweeks = carriedWorkweeks;
const payroll_codes_1 = require("./payroll-codes");
const payroll_payrun_1 = require("./payroll-payrun");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** Whole days from a to b (both YYYY-MM-DD). */
function daysBetween(a, b) {
    return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}
/** A date plus days. */
function plusDays(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
/**
 * @description The first day of the workweek a date falls in.
 * @param date - YYYY-MM-DD.
 * @param startDay - The company's workweek start, 0 = Sunday.
 * @returns The workweek's first day, YYYY-MM-DD.
 */
function workweekStart(date, startDay) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    return plusDays(date, -((dow - startDay + 7) % 7));
}
/**
 * @description Give dated rows the workweek their date falls in.
 *
 * Index 1 is the workweek holding the period's first day. When any row is
 * dated, every row of HOURS must be: an undated hour would go into a workweek by
 * guesswork. An amount row (a bonus, tips, a reimbursement) may stay undated and
 * keeps the workweek index it was given.
 * @param rows - Earning rows as entered.
 * @param periodStart - The run's first day.
 * @param periodEnd - The run's last day.
 * @param startDay - The company's workweek start, 0 = Sunday.
 * @returns The rows with workweek set, the week starts, or a refusal in words.
 */
function assignWorkweeks(rows, periodStart, periodEnd, startDay) {
    const dated = rows.filter((r) => r.workDate);
    if (!dated.length)
        return { rows, weekStarts: {}, refusal: '' };
    if (rows.some((r) => !r.workDate && (0, payroll_codes_1.earningsCode)(r.code)?.entry === 'hourly')) {
        return { rows: [], weekStarts: {}, refusal: 'Give every row of hours the day it was worked, or none: an hour without a day cannot be placed in a workweek.' };
    }
    const bad = dated.find((r) => !ISO.test(String(r.workDate)) || r.workDate < periodStart || r.workDate > periodEnd);
    if (bad) {
        return { rows: [], weekStarts: {}, refusal: `${bad.workDate} is not a day of this pay period (${periodStart} to ${periodEnd}). Record it on the run for the period it falls in.` };
    }
    const first = workweekStart(periodStart, startDay);
    const weekStarts = {};
    for (let i = 0; i * 7 <= daysBetween(first, periodEnd); i += 1)
        weekStarts[i + 1] = plusDays(first, i * 7);
    const out = rows.map((r) => {
        if (!r.workDate)
            return r;
        const start = workweekStart(String(r.workDate), startDay);
        const workweek = Math.floor(daysBetween(first, start) / 7) + 1;
        weekStarts[workweek] = start;
        return { ...r, workweek };
    });
    return { rows: out, weekStarts, refusal: '' };
}
/**
 * @description What earlier paid checks recorded for the workweeks this check
 * shares with them: only a workweek that began before the period did.
 * @param q - Pool or transaction client.
 * @param sub - Owning OIDC sub.
 * @param employeeId - The employee.
 * @param runId - This run, left out.
 * @param weekStarts - This check's workweek indexes and their first days.
 * @param periodStart - This run's first day.
 * @returns Carried totals by this check's workweek index.
 */
async function carriedWorkweeks(q, sub, employeeId, runId, weekStarts, periodStart) {
    const shared = Object.entries(weekStarts).filter(([, start]) => start < periodStart);
    const out = {};
    for (const [index, start] of shared) {
        const rows = (await q.query(`SELECT e.code, e.hours, e.rate_cents, e.amount_cents
         FROM payroll_line_earnings e
         JOIN payroll_runs r ON r.run_id = e.run_id AND r.user_sub = e.user_sub
        WHERE e.user_sub = $1 AND e.employee_id = $2 AND e.run_id <> $3
          AND e.work_date >= $4 AND e.work_date < $5
          AND r.status = 'paid' AND r.kind <> 'void'
          AND NOT EXISTS (SELECT 1 FROM payroll_runs v
                           WHERE v.user_sub = r.user_sub AND v.corrects_run_id = r.run_id AND v.kind = 'void')`, [sub, employeeId, runId, start, periodStart])).rows;
        if (!rows.length)
            continue;
        const t = (0, payroll_payrun_1.workweekTotals)(rows.map((x) => ({
            code: String(x.code), hours: Number(x.hours) || 0, rateCents: Math.round(Number(x.rate_cents) || 0),
            amountCents: Math.round(Number(x.amount_cents) || 0), workweek: 1,
        })));
        out[Number(index)] = { hours: t.hours, straightCents: t.straightCents, premiumCents: t.premiumCents };
    }
    return out;
}
//# sourceMappingURL=payroll-workweek.js.map