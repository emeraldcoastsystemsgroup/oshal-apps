"use strict";
/**
 * Federal employment-tax deposits: which schedule an employer is on, and what
 * each deposit period owes and by when.
 *
 * WHY THIS IS ITS OWN MODULE. The deposit report used to roll a due date off a
 * weekend only, and it applied the $100,000 rule to each payday on its own. Both
 * are wrong against the regulation: a legal holiday moves a due date (and, for a
 * semiweekly depositor, adds a day for each holiday in the three weekdays after
 * the period closes), and the $100,000 test is made on taxes ACCUMULATED in the
 * deposit period, so two paydays in one month can trigger it together.
 *
 * SOURCES, each read on 2026-11-20 and quoted beside the value it justifies:
 *   - 26 CFR 31.6302-1 (eCFR, current to 2026-11-18),
 *     https://www.ecfr.gov/current/title-26/part-31/section-31.6302-1 —
 *     (b)(2)-(4) the lookback period and the $50,000 line, (c)(1)-(4) the
 *     monthly, semi-weekly and One-Day rules, (f)(4) the $2,500 de minimis rule.
 *   - IRS Publication 15 (2026) (Circular E), section 11 "Depositing Taxes",
 *     https://www.irs.gov/pub/irs-pdf/p15.pdf — "Payment with return", "Lookback
 *     period" with Table 1, "Deposit period", "New employers", "Semiweekly deposit
 *     period spanning 2 quarters", "$100,000 Next-Day Deposit Rule" and its Elm,
 *     Inc. and Fir Co. examples, and "How to claim credit for overpayments".
 *   - The due dates themselves come from payroll-calendar (the IRS legal-holiday
 *     lists), which refuses a year it does not hold.
 *
 * WHAT IT DOES NOT HOLD. The lookback period for 2026 is July 2024 to June 2025;
 * this package keeps no payroll from then, so the four amounts are asked for
 * rather than assumed. Form 943, 944 and 945 filers are out of scope: the package
 * produces Form 941 only.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 8: depositor status from the four lookback quarters ($50,000 line, 26 CFR 31.6302-1(b)); a deposit schedule grouped by deposit period (calendar month, or Wednesday-Friday and Saturday-Tuesday split by quarter) with due dates from the IRS legal-holiday calendar; the One-Day rule on taxes accumulated in the period, restarting after the day it is met, and a monthly depositor becoming semiweekly the next day; and the $2,500 pay-with-return test per quarter.
 *
 * @module payroll-deposits
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LookbackInputError = exports.LOOKBACK_RULE_YEARS = exports.DE_MINIMIS_CENTS = exports.LOOKBACK_THRESHOLD_CENTS = void 0;
exports.lookbackPeriod = lookbackPeriod;
exports.requireLookbackYear = requireLookbackYear;
exports.depositorStatusFromLookback = depositorStatusFromLookback;
exports.buildDepositSchedule = buildDepositSchedule;
const payroll_calendar_1 = require("./payroll-calendar");
/**
 * 26 CFR 31.6302-1(b)(2)(i): "An employer is a monthly depositor for the entire
 * calendar year if the aggregate amount of employment taxes reported for the
 * lookback period is $50,000 or less." (b)(3): semi-weekly if it "exceeds
 * $50,000". Pub 15 (2026) §11 prints the same line.
 */
exports.LOOKBACK_THRESHOLD_CENTS = 5_000_000;
/**
 * 26 CFR 31.6302-1(f)(4)(i): accumulated employment taxes are de minimis "if it
 * is less than $2,500 for the return period". Pub 15 (2026) §11, "Payment with
 * return": "Form 941, line 12 ... for either the current quarter or the prior
 * quarter is less than $2,500, and you didn't incur a $100,000 next-day deposit
 * obligation during the current quarter."
 */
exports.DE_MINIMIS_CENTS = 250_000;
/**
 * The calendar years whose depositor status this module will work out. 2026 is
 * the year Pub 15 (2026) Table 1 prints. 2027 rests on the regulation itself
 * (in force; eCFR current to 2026-11-18), whose (b)(4)(i) rule "the twelve month
 * period ended the preceding June 30" does not change by year; the IRS draft of
 * Pub 15 (2027) prints the same rule with a 2027 lookback example. Any other
 * year is refused.
 */
exports.LOOKBACK_RULE_YEARS = Object.freeze([2026, 2027]);
/** Thrown for a lookback request that cannot be answered as asked. */
class LookbackInputError extends Error {
    code = 'lookback_input';
}
exports.LookbackInputError = LookbackInputError;
const QUARTER_SPANS = ['January 1 to March 31', 'April 1 to June 30', 'July 1 to September 30', 'October 1 to December 31'];
/**
 * @description The four quarters of a Form 941 filer's lookback period.
 *
 * 26 CFR 31.6302-1(b)(4)(i): "the lookback period for each calendar year is the
 * twelve month period ended the preceding June 30", and for an employer that
 * "filed Form 944 ... for either of the two previous calendar years, is the
 * second calendar year preceding the current calendar year". Pub 15 (2026)
 * Table 1 prints 2026's: July 1, 2024 through June 30, 2025.
 * @param year - The calendar year the status is for.
 * @param filed944 - Whether a Form 944 was filed for either of the two previous years.
 * @returns The four quarters, oldest first.
 */
function lookbackPeriod(year, filed944) {
    const pairs = filed944
        ? [[year - 2, 1], [year - 2, 2], [year - 2, 3], [year - 2, 4]]
        : [[year - 2, 3], [year - 2, 4], [year - 1, 1], [year - 1, 2]];
    return pairs.map(([y, q]) => ({ year: y, quarter: q, label: `${QUARTER_SPANS[q - 1]}, ${y}` }));
}
/**
 * @description The lookback quarters for a year this module holds the rule for.
 * @param year - Calendar year the status is for.
 * @param filed944 - Whether a Form 944 was filed for either of the two previous years.
 * @returns The four quarters, oldest first.
 * @throws LookbackInputError naming the years held when the year is not one of them.
 */
function requireLookbackYear(year, filed944) {
    if (!exports.LOOKBACK_RULE_YEARS.includes(year)) {
        throw new LookbackInputError(`A depositor status for ${year} is not worked out here: the rules held cover `
            + `${exports.LOOKBACK_RULE_YEARS.join(' and ')}. Nothing was assumed from another year.`);
    }
    return lookbackPeriod(year, filed944);
}
/** Whole cents, never negative, never fractional. */
function lookbackCents(value, label) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new LookbackInputError(`The amount for ${label} must be whole cents of zero or more. `
            + 'Enter what was reported on Form 941, line 12 for that quarter; enter 0 for a quarter before the business started.');
    }
    return n;
}
/**
 * @description Monthly or semiweekly, from the taxes reported in the lookback period.
 *
 * The amounts are the ORIGINAL Form 941 line 12 figures: (b)(4)(ii) "Any amounts
 * reported on adjusted returns or claims for refund ... are not taken into
 * account". A quarter before the business started counts as zero: "New
 * employers shall be treated as having employment tax liabilities of zero for
 * any part of the lookback period before the date the employer started".
 * @param year - Calendar year the status is for; must be in LOOKBACK_RULE_YEARS.
 * @param amountsCents - Four amounts, oldest quarter first, in cents.
 * @param filed944 - Whether a Form 944 was filed for either of the two previous years.
 * @returns The status, the total and the reason in words.
 * @throws LookbackInputError for an unheld year or a bad amount.
 */
function depositorStatusFromLookback(year, amountsCents, filed944 = false) {
    const period = requireLookbackYear(year, filed944);
    if (!Array.isArray(amountsCents) || amountsCents.length !== 4) {
        throw new LookbackInputError('Four amounts are needed, one for each quarter of the lookback period.');
    }
    const quarters = period.map((q, i) => ({ ...q, cents: lookbackCents(amountsCents[i], q.label) }));
    const totalCents = quarters.reduce((sum, q) => sum + q.cents, 0);
    const status = totalCents > exports.LOOKBACK_THRESHOLD_CENTS ? 'semiweekly' : 'monthly';
    const first = period[0];
    const last = period[3];
    const span = `${QUARTER_SPANS[first.quarter - 1].split(' to ')[0]}, ${first.year} to ${QUARTER_SPANS[last.quarter - 1].split(' to ')[1]}, ${last.year}`;
    return {
        year, status, totalCents, quarters,
        reason: `${dollars(totalCents)} was reported for the lookback period (${span}), which is `
            + `${status === 'monthly' ? '$50,000 or less' : 'more than $50,000'}, so you are a ${status} schedule depositor `
            + `for ${year} (Publication 15, section 11; 26 CFR 31.6302-1(b)).`,
    };
}
/** $1,234.56 from cents, for sentences. */
function dollars(cents) {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}
/** Calendar quarter of a date. */
function quarterOf(date) {
    return Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
}
/**
 * The deposit period a payday belongs to. 26 CFR 31.6302-1(c)(3)(i)-(ii): a
 * monthly depositor accumulates "in the calendar month"; a semi-weekly depositor
 * "in the Wednesday-Friday or Saturday-Tuesday semi-weekly period". Pub 15
 * (2026), "Semiweekly deposit period spanning 2 quarters": pay dates in
 * different quarters "need to make separate deposits", so the quarter is part
 * of the key.
 */
function periodKey(payDate, status) {
    return status === 'monthly'
        ? `M|${payDate.slice(0, 7)}`
        : `S|${(0, payroll_calendar_1.closeOfSemiweeklyPeriod)(payDate)}|Q${quarterOf(payDate)}`;
}
/** The period in words. */
function periodWords(open) {
    if (open.status === 'monthly') {
        const [y, m] = open.paydays[0].split('-').map(Number);
        return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${y}`;
    }
    const close = (0, payroll_calendar_1.closeOfSemiweeklyPeriod)(open.paydays[0]);
    const start = (0, payroll_calendar_1.addDays)(close, new Date(`${close}T00:00:00Z`).getUTCDay() === 5 ? -2 : -3);
    return `${start} to ${close}`;
}
/** Compute a due date, turning a year the IRS calendar does not hold into words. */
function dueOrRefusal(compute) {
    try {
        return { due: compute(), refusal: '' };
    }
    catch (err) {
        if (!(0, payroll_calendar_1.isCalendarCoverageError)(err))
            throw err;
        return { due: null, refusal: err.message };
    }
}
/** Build one obligation from a closed period. */
function obligation(open, kind, compute) {
    const { due, refusal } = dueOrRefusal(compute);
    const net = open.cents;
    return {
        kind,
        period: kind === 'next-day' ? `taxes accumulated through ${open.paydays[open.paydays.length - 1]}` : periodWords(open),
        quarter: quarterOf(open.paydays[0]),
        paydays: [...open.paydays],
        liabilityCents: net,
        amountDueCents: Math.max(0, net),
        dueDate: due ? due.dueDate : null,
        rule: due ? due.rule : '',
        extraDaysForHolidays: due ? due.extraDaysForHolidays : 0,
        verified: due ? due.verified : false,
        calendarNote: due ? due.calendarNote : '',
        refusal,
        note: net < 0
            ? 'Nothing to deposit: a void in this period reverses more than was paid in it. How an amount already '
                + 'deposited comes back is set by Form 941 (Publication 15, section 11, "How to claim credit for overpayments").'
            : '',
    };
}
/** Sum paydays that share a date, in date order. */
function byDay(paydays) {
    const sums = new Map();
    for (const p of paydays)
        sums.set(p.payDate, (sums.get(p.payDate) || 0) + Math.trunc(Number(p.liabilityCents) || 0));
    return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([payDate, liabilityCents]) => ({ payDate, liabilityCents }));
}
/**
 * @description The deposit schedule for a year's paydays.
 *
 * The One-Day rule, 26 CFR 31.6302-1(c)(3): "if on any day within a deposit
 * period (monthly or semi-weekly) an employer has accumulated $100,000 or more
 * of employment taxes, those taxes must be deposited ... by the close of the
 * next day". Pub 15 (2026): "once you accumulate at least $100,000 in a deposit
 * period, stop accumulating at the end of that day and begin to accumulate anew
 * on the next day". And (b)(2)(ii): a monthly depositor "immediately becomes a
 * semi-weekly depositor for the remainder of the calendar year and for the
 * following calendar year", from "the first day after" the rule applied.
 * @param paydays - Taxes owed per payday (FIT plus both halves of FICA).
 * @param startingStatus - The status the year began with.
 * @param year - The calendar year.
 * @param today - Today, YYYY-MM-DD, to tell a finished quarter from one still running.
 * @returns Obligations in date order, any forced status change, and the quarter summary.
 */
function buildDepositSchedule(paydays, startingStatus, year, today) {
    const out = [];
    let status = startingStatus;
    let statusChange = null;
    let open = null;
    const close = () => {
        if (!open)
            return;
        const last = open.paydays[open.paydays.length - 1];
        const s = open.status;
        out.push(obligation(open, s, () => (0, payroll_calendar_1.depositDueDate)(last, s, 0)));
        open = null;
    };
    for (const day of byDay(paydays)) {
        const key = periodKey(day.payDate, status);
        if (open && open.key !== key)
            close();
        if (!open)
            open = { key, status, paydays: [], cents: 0 };
        const current = open;
        current.paydays.push(day.payDate);
        current.cents += day.liabilityCents;
        if (current.cents < payroll_calendar_1.NEXT_DAY_THRESHOLD_CENTS)
            continue;
        out.push(obligation(current, 'next-day', () => (0, payroll_calendar_1.nextDayDue)(day.payDate)));
        open = null;
        if (status === 'monthly') {
            status = 'semiweekly';
            statusChange = monthlyToSemiweekly(day.payDate, year);
        }
    }
    close();
    return { year, startingStatus, obligations: out, statusChange, quarters: quarterSummary(out, year, today) };
}
/** The forced change, in words. */
function monthlyToSemiweekly(day, year) {
    const effective = (0, payroll_calendar_1.addDays)(day, 1);
    return {
        from: 'monthly', to: 'semiweekly', effective,
        reason: `$100,000 or more accumulated on ${day}, so from ${effective} you are a semiweekly schedule depositor for `
            + `the rest of ${year} and all of ${year + 1} (26 CFR 31.6302-1(b)(2)(ii)). Set Depositor status to Semiweekly `
            + 'in Settings before you start next year.',
    };
}
/** Last day of a quarter. */
function quarterEnd(year, quarter) {
    return new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10);
}
/**
 * The $2,500 test per quarter (26 CFR 31.6302-1(f)(4); Pub 15 (2026) §11,
 * "Payment with return"). A quarter qualifies on its own total once it has
 * ended, or on the prior quarter's total when this schedule holds that quarter;
 * the One-Day rule arising in the quarter disqualifies it either way. Pub 15
 * adds: "if you're unsure that your total tax liability for the current quarter
 * will be less than $2,500 (and your liability for the prior quarter wasn't less
 * than $2,500), make deposits", which is why a running quarter never qualifies
 * on its own figure.
 */
function quarterSummary(obligations, year, today) {
    const quarters = [...new Set(obligations.map((o) => o.quarter))].sort((a, b) => a - b);
    const total = (q) => obligations.filter((o) => o.quarter === q).reduce((s, o) => s + o.liabilityCents, 0);
    return quarters.map((q) => {
        const totalCents = total(q);
        const nextDayRuleArose = obligations.some((o) => o.quarter === q && o.kind === 'next-day');
        const complete = quarterEnd(year, q) < today;
        const priorHeld = quarters.includes(q - 1);
        const own = complete && totalCents < exports.DE_MINIMIS_CENTS;
        const prior = priorHeld && total(q - 1) < exports.DE_MINIMIS_CENTS;
        const payWithReturn = !nextDayRuleArose && (own || prior);
        return { quarter: q, totalCents, nextDayRuleArose, complete, payWithReturn, note: quarterNote(q, year, payWithReturn, own, nextDayRuleArose, priorHeld) };
    });
}
/** Why a quarter may or may not be paid with Form 941. */
function quarterNote(q, year, allowed, own, nextDay, priorHeld) {
    if (nextDay)
        return `A $100,000 next-day deposit arose in Q${q}, so its taxes must be deposited, not paid with the return.`;
    if (allowed) {
        return `Q${q} may be paid with a timely filed Form 941 instead of deposited: `
            + (own ? `its own total is under $2,500.` : `Q${q - 1}'s total in this schedule is under $2,500.`);
    }
    const prior = priorHeld ? '' : ` This schedule holds no Q${q === 1 ? `4 ${year - 1}` : q - 1} payroll, so that quarter's total is not judged here.`;
    return `Deposit Q${q}'s taxes on the schedule above.${prior}`;
}
//# sourceMappingURL=payroll-deposits.js.map