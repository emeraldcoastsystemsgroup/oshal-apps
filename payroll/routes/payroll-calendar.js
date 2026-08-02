"use strict";
/**
 * Two calendars, deliberately — because a payroll system needs two different
 * answers to "is the country closed today?" and conflating them is a real bug.
 *
 * THE FEDERAL RESERVE CALENDAR decides whether money moves. If a pay date is not
 * a Reserve Bank banking day, ACH does not settle and nobody gets paid that day.
 *
 * THE IRS LEGAL-HOLIDAY CALENDAR decides when a tax deposit is due. It is a
 * DIFFERENT set of dates, and the difference is not cosmetic:
 *
 *   - A holiday falling on SATURDAY costs the Fed nothing. Reserve Banks stay
 *     open the preceding Friday, so payroll funds normally. The IRS, by
 *     contrast, OBSERVES it on that Friday — the deposit deadline moves.
 *   - District of Columbia Emancipation Day (April 16) is an IRS legal holiday
 *     because Pub 15 defines the term as "any legal holiday in the District of
 *     Columbia". The Federal Reserve does not observe it at all. Banks open,
 *     money moves, deposit deadline shifts.
 *
 * Friday 2026-07-03 is the case that proves it: Reserve Banks are OPEN (K.8's
 * Saturday rule), and IRS Pub 15 (2026) prints "July 3—Independence Day
 * (observed)". Money moves; the deposit deadline does not fall. One shared
 * isHoliday() would get one of those two wrong.
 *
 * SOURCES, each retrieved and quoted in the constant it justifies:
 *   - Federal Reserve Board, "Holidays Observed — K.8"
 *     https://www.federalreserve.gov/aboutthefed/k8.htm  (2026–2030 schedule),
 *     corroborated by https://www.frbservices.org/about/holiday-schedules
 *   - 5 U.S.C. § 6103(a) as amended by Pub. L. 117-17 (Juneteenth National
 *     Independence Day Act, 2021) — the eleven federal holidays.
 *   - IRS Publication 15 (2026) (Circular E), section 11 "Deposits Due on
 *     Business Days Only", the 2026 legal-holiday list, and Table 2.
 *   - IRS Rev. Rul. 2015-13 — Emancipation Day observance, citing D.C. Code
 *     § 28-2701.
 *   - Federal Reserve Operating Circular No. 4 (eff. 2024-10-28), Appendix B
 *     §3.2 — settlement moves FORWARD to the next banking day, never backward.
 *
 * DELIBERATELY DEPENDENCY-FREE. This is the lowest module in the payroll stack;
 * everything else may import it. Its own UTC date helpers are a few lines and
 * are worth more than a dependency on the database layer would cost.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 01:05:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — the eleven federal holidays as date rules, the Federal Reserve observance rule (Saturday costs nothing, Sunday closes the following Monday), the DIFFERENT IRS observance rule plus DC Emancipation Day, pay-date shifting that chains through consecutive closures, and deposit due dates including the semiweekly extra-day-per-legal-holiday allowance that a naive next-business-day roll gets wrong.
 *
 * @module payroll-calendar
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NEXT_DAY_THRESHOLD_CENTS = exports.IRS_HOLIDAYS_VERIFIED_THROUGH = void 0;
exports.addDays = addDays;
exports.fedBankingClosures = fedBankingClosures;
exports.isFedBankingDay = isFedBankingDay;
exports.nextFedBankingDay = nextFedBankingDay;
exports.previousFedBankingDay = previousFedBankingDay;
exports.irsLegalHolidays = irsLegalHolidays;
exports.isIrsBusinessDay = isIrsBusinessDay;
exports.nextIrsBusinessDay = nextIrsBusinessDay;
exports.resolvePayDate = resolvePayDate;
exports.depositDueDate = depositDueDate;
exports.futaDepositDue = futaDepositDue;
/** The last tax year whose IRS legal-holiday list was read from that year's Pub 15. */
exports.IRS_HOLIDAYS_VERIFIED_THROUGH = 2026;
/* ── minimal UTC date helpers ─────────────────────────────────────────────── */
/** Parse YYYY-MM-DD as UTC midnight. Never uses local time — payroll dates are calendar dates. */
function utc(iso) {
    return new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
}
/** YYYY-MM-DD from a Date. */
function iso(d) {
    return d.toISOString().slice(0, 10);
}
/**
 * @description Add (or subtract) whole days to an ISO date.
 * @param date - YYYY-MM-DD.
 * @param days - Days to add; negative subtracts.
 * @returns The shifted date as YYYY-MM-DD.
 */
function addDays(date, days) {
    const d = utc(date);
    d.setUTCDate(d.getUTCDate() + days);
    return iso(d);
}
/** Day of week, 0 = Sunday. */
function dow(date) {
    return utc(date).getUTCDay();
}
/** Saturday or Sunday. */
function isWeekend(date) {
    const d = dow(date);
    return d === 0 || d === 6;
}
/** The date of the nth given weekday in a month; n = -1 means the last one. */
function nthWeekday(year, month, weekday, n) {
    if (n < 0) {
        const last = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last of this
        const back = (last.getUTCDay() - weekday + 7) % 7;
        last.setUTCDate(last.getUTCDate() - back);
        return iso(last);
    }
    const first = new Date(Date.UTC(year, month - 1, 1));
    const forward = (weekday - first.getUTCDay() + 7) % 7;
    first.setUTCDate(1 + forward + (n - 1) * 7);
    return iso(first);
}
/**
 * 5 U.S.C. § 6103(a). Note which are FIXED-DATE: those are the only ones that
 * can land on a weekend, and therefore the only ones the observance rules touch.
 * Juneteenth is fixed to June 19 — it is NOT Monday-ized, which is why it falls
 * on a weekend roughly two years in seven.
 */
const FEDERAL_HOLIDAYS = Object.freeze([
    { name: "New Year's Day", fixed: [1, 1] },
    { name: 'Birthday of Martin Luther King, Jr.', nth: { month: 1, weekday: 1, n: 3 } },
    { name: "Washington's Birthday", nth: { month: 2, weekday: 1, n: 3 } },
    { name: 'Memorial Day', nth: { month: 5, weekday: 1, n: -1 } },
    { name: 'Juneteenth National Independence Day', fixed: [6, 19] },
    { name: 'Independence Day', fixed: [7, 4] },
    { name: 'Labor Day', nth: { month: 9, weekday: 1, n: 1 } },
    { name: 'Columbus Day', nth: { month: 10, weekday: 1, n: 2 } },
    { name: 'Veterans Day', fixed: [11, 11] },
    { name: 'Thanksgiving Day', nth: { month: 11, weekday: 4, n: 4 } },
    { name: 'Christmas Day', fixed: [12, 25] },
]);
/** The statutory (unobserved) date of each federal holiday in a year. */
function statutoryDates(year) {
    return FEDERAL_HOLIDAYS.map((h) => ({
        name: h.name,
        date: h.fixed
            ? `${year}-${String(h.fixed[0]).padStart(2, '0')}-${String(h.fixed[1]).padStart(2, '0')}`
            : nthWeekday(year, h.nth.month, h.nth.weekday, h.nth.n),
    }));
}
/* ── calendar 1: the Federal Reserve (does money move?) ───────────────────── */
/**
 * @description Reserve Bank closures for a year.
 *
 * Federal Reserve Board K.8, verbatim: "For holidays falling on Saturday,
 * Federal Reserve Banks and Branches will be open the preceding Friday;
 * however, the Board of Governors will be closed. For holidays falling on
 * Sunday, all Federal Reserve offices will be closed the following Monday."
 *
 * So a SATURDAY holiday produces NO closure at all — zero banking days lost —
 * while a SUNDAY holiday closes the following Monday. This is the opposite of
 * the federal-employee rule in 5 U.S.C. § 6103(b), and getting the two mixed up
 * is why payroll systems mispredict funding.
 * @param year - Calendar year.
 * @returns Observed closures, ascending. A Saturday-falling holiday is absent.
 */
function fedBankingClosures(year) {
    const out = [];
    for (const h of statutoryDates(year)) {
        const day = dow(h.date);
        if (day === 6)
            continue; // Saturday — Banks stay open Friday
        const date = day === 0 ? addDays(h.date, 1) : h.date; // Sunday — closed Monday
        out.push({ date, name: h.name, statutoryDate: h.date });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
}
const fedClosureCache = new Map();
/** Memoised closure lookup for a year. */
function fedClosureSet(year) {
    let s = fedClosureCache.get(year);
    if (!s) {
        s = new Set(fedBankingClosures(year).map((o) => o.date));
        fedClosureCache.set(year, s);
    }
    return s;
}
/**
 * @description Whether ACH settles on a date — a Reserve Bank banking day.
 * @param date - YYYY-MM-DD.
 * @returns True on a weekday that is not a Reserve Bank closure.
 */
function isFedBankingDay(date) {
    if (isWeekend(date))
        return false;
    return !fedClosureSet(Number(date.slice(0, 4))).has(date);
}
/**
 * @description The first banking day on or after a date.
 *
 * Chains through consecutive closures (a Thursday holiday before a weekend
 * lands on Monday), which is the case a single "+1 if weekend" check misses.
 * @param date - YYYY-MM-DD.
 * @returns The first date on or after `date` that is a banking day.
 */
function nextFedBankingDay(date) {
    let d = date;
    for (let i = 0; i < 30; i += 1) {
        if (isFedBankingDay(d))
            return d;
        d = addDays(d, 1);
    }
    return d;
}
/** The first banking day on or BEFORE a date — used to pay people early, never late. */
function previousFedBankingDay(date) {
    let d = date;
    for (let i = 0; i < 30; i += 1) {
        if (isFedBankingDay(d))
            return d;
        d = addDays(d, -1);
    }
    return d;
}
/* ── calendar 2: the IRS (when is the deposit due?) ───────────────────────── */
/**
 * D.C. Code § 28-2701 — Emancipation Day, April 16. Per Rev. Rul. 2015-13:
 * "When April 16 is a Saturday, the preceding day is the observed holiday, and
 * when it is a Sunday, the succeeding day is the observed holiday."
 * An IRS legal holiday that is NOT a Reserve Bank closure.
 */
function emancipationDay(year) {
    const statutory = `${year}-04-16`;
    const day = dow(statutory);
    const date = day === 6 ? addDays(statutory, -1) : day === 0 ? addDays(statutory, 1) : statutory;
    return { date, name: 'District of Columbia Emancipation Day', statutoryDate: statutory };
}
/**
 * @description IRS legal holidays for deposit purposes.
 *
 * Pub 15 (2026) §11, verbatim: "The term 'legal holiday' means any legal
 * holiday in the District of Columbia. For purposes of the deposit rules, the
 * term 'legal holiday' doesn't include other statewide legal holidays."
 *
 * The observance rule here is the ordinary one — Saturday observed on the
 * preceding Friday, Sunday on the following Monday — which is what makes the
 * 2026 list read "July 3—Independence Day (observed)" while the Reserve Banks
 * stayed open that same Friday.
 *
 * Pub 15 republishes this list every year. Only 2026 has been read against the
 * document; later years are computed from the same rules and are flagged
 * `verified: false` so a caller can say so rather than imply an authority it
 * does not have.
 * @param year - Calendar year.
 * @returns The observed legal holidays with a verification flag.
 */
function irsLegalHolidays(year) {
    const holidays = statutoryDates(year).map((h) => {
        const day = dow(h.date);
        const date = day === 6 ? addDays(h.date, -1) : day === 0 ? addDays(h.date, 1) : h.date;
        return { date, name: h.name, statutoryDate: h.date };
    });
    holidays.push(emancipationDay(year));
    holidays.sort((a, b) => a.date.localeCompare(b.date));
    const verified = year <= exports.IRS_HOLIDAYS_VERIFIED_THROUGH;
    return {
        holidays,
        verified,
        note: verified
            ? `Matched against the legal-holiday list printed in IRS Publication 15 (${year}), section 11.`
            : `IRS Publication 15 (${year}) has not been read. These dates are computed from the same `
                + 'observance rules that reproduce the verified 2026 list exactly, but Pub 15 republishes '
                + 'the list annually — confirm before relying on a deposit due date in this year.',
    };
}
const irsHolidayCache = new Map();
/**
 * Memoised set of every IRS legal holiday OBSERVED within a calendar year.
 *
 * Gathered from the neighbouring years as well, because the IRS observance rule
 * moves a Saturday holiday BACKWARD: when 1 January falls on a Saturday (2022,
 * 2028, 2033, 2039) New Year's Day is observed on 31 December of the PREVIOUS
 * year. Keying that observance under its statutory year would file it in the
 * wrong bucket, and `isIrsBusinessDay('2027-12-31')` would answer "business
 * day" for a date the IRS treats as a holiday — landing a deposit due date on a
 * closed day. The Federal Reserve calendar has no equivalent hazard because its
 * Saturday rule produces no closure at all and its Sunday rule moves forward
 * within the year.
 */
function irsHolidaySet(year) {
    let s = irsHolidayCache.get(year);
    if (!s) {
        s = new Set();
        for (const y of [year - 1, year, year + 1]) {
            for (const o of irsLegalHolidays(y).holidays) {
                if (o.date.startsWith(`${year}-`))
                    s.add(o.date);
            }
        }
        irsHolidayCache.set(year, s);
    }
    return s;
}
/**
 * @description Whether a date is an IRS business day for deposit purposes.
 * @param date - YYYY-MM-DD.
 * @returns True on a weekday that is not an IRS legal holiday.
 */
function isIrsBusinessDay(date) {
    if (isWeekend(date))
        return false;
    return !irsHolidaySet(Number(date.slice(0, 4))).has(date);
}
/** The first IRS business day on or after a date, chaining through consecutive closures. */
function nextIrsBusinessDay(date) {
    let d = date;
    for (let i = 0; i < 30; i += 1) {
        if (isIrsBusinessDay(d))
            return d;
        d = addDays(d, 1);
    }
    return d;
}
/**
 * @description Resolve a pay date to one on which employees actually get paid.
 *
 * Employers overwhelmingly want people paid EARLY rather than late, so the
 * default moves a blocked pay date BACKWARD to the preceding banking day. That
 * is a choice about the pay date, not about ACH: per Operating Circular 4
 * App. B §3.2 an ACH file whose settlement date is a Reserve Bank holiday
 * settles on the NEXT banking day — settlement never moves earlier — so paying
 * early means choosing an earlier date here, not asking the network to hurry.
 * @param date - The intended pay date, YYYY-MM-DD.
 * @param direction - 'earlier' (default, the payroll convention) or 'later'.
 * @returns The funding date with an explanation when it moved.
 */
function resolvePayDate(date, direction = 'earlier') {
    if (isFedBankingDay(date)) {
        return { payDate: date, requested: date, shifted: false, reason: '' };
    }
    const payDate = direction === 'earlier' ? previousFedBankingDay(date) : nextFedBankingDay(date);
    const closure = fedBankingClosures(Number(date.slice(0, 4))).find((o) => o.date === date);
    const why = closure
        ? `${closure.name} — Federal Reserve Banks are closed`
        : 'a weekend — ACH does not settle';
    return {
        payDate,
        requested: date,
        shifted: true,
        reason: `${date} falls on ${why}, so payroll would not fund. Moved to ${payDate}.`,
    };
}
/** $100,000 of liability on one payday is due the next business day, whatever the status. */
exports.NEXT_DAY_THRESHOLD_CENTS = 10_000_000;
/**
 * @description The federal employment-tax deposit due date for one payday.
 *
 * Three rules, in the order they override each other:
 *
 * 1. $100,000 accumulated on a single payday → the NEXT BUSINESS DAY, whatever
 *    the depositor status says.
 * 2. Semiweekly → Wed/Thu/Fri paydays deposit by the following Wednesday;
 *    Sat/Sun/Mon/Tue by the following Friday. Then Pub 15's allowance:
 *    "If any of the 3 weekdays after the end of a semiweekly period is a legal
 *    holiday, you'll have an additional day for each day that is a legal
 *    holiday". That is NOT a roll-forward — it is one extra day per holiday in
 *    the window, so the answer can land later than the next business day.
 * 3. Monthly → the 15th of the following month.
 *
 * Every result is finally rolled off a Saturday, Sunday or legal holiday.
 * @param payDate - The payday, YYYY-MM-DD.
 * @param depositorStatus - 'monthly' or 'semiweekly'.
 * @param liabilityCents - Liability accumulated on this payday.
 * @returns The due date, the rule applied, and whether the year is verified.
 */
function depositDueDate(payDate, depositorStatus, liabilityCents = 0) {
    const verified = irsLegalHolidays(Number(payDate.slice(0, 4))).verified;
    if (liabilityCents >= exports.NEXT_DAY_THRESHOLD_CENTS) {
        return {
            dueDate: nextIrsBusinessDay(addDays(payDate, 1)),
            rule: '$100,000 next-business-day rule — this overrides the depositor status.',
            extraDaysForHolidays: 0,
            verified,
        };
    }
    if (depositorStatus === 'semiweekly')
        return semiweeklyDue(payDate, verified);
    const d = utc(payDate);
    const fifteenth = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15)));
    return {
        dueDate: nextIrsBusinessDay(fifteenth),
        rule: 'Monthly depositor — due the 15th of the following month.',
        extraDaysForHolidays: 0,
        verified,
    };
}
/**
 * The semiweekly rule, including Pub 15's extra-day allowance.
 *
 * The allowance is counted over the three weekdays FOLLOWING the close of the
 * semiweekly period, which is what guarantees "at least 3 business days" — a
 * plain next-business-day roll can silently give fewer.
 */
function semiweeklyDue(payDate, verified) {
    const day = dow(payDate);
    // Wed(3)/Thu(4)/Fri(5) close Friday and deposit by Wednesday; the rest close
    // Tuesday and deposit by Friday.
    const wedToFri = day >= 3 && day <= 5;
    const target = wedToFri ? 3 : 5; // Wednesday or Friday
    let due = addDays(payDate, 1);
    for (let i = 0; i < 14 && dow(due) !== target; i += 1)
        due = addDays(due, 1);
    // Pub 15: one additional day for EACH of the 3 weekdays after the period
    // close that is a legal holiday.
    const periodClose = closeOfSemiweeklyPeriod(payDate, wedToFri);
    let extraDaysForHolidays = 0;
    let cursor = periodClose;
    for (let counted = 0; counted < 3;) {
        cursor = addDays(cursor, 1);
        if (isWeekend(cursor))
            continue;
        counted += 1;
        if (!isIrsBusinessDay(cursor))
            extraDaysForHolidays += 1;
    }
    for (let i = 0; i < extraDaysForHolidays; i += 1)
        due = addDays(due, 1);
    return {
        dueDate: nextIrsBusinessDay(due),
        rule: wedToFri
            ? 'Semiweekly depositor — Wednesday/Thursday/Friday payday, deposit by the following Wednesday.'
            : 'Semiweekly depositor — Saturday/Sunday/Monday/Tuesday payday, deposit by the following Friday.',
        extraDaysForHolidays,
        verified,
    };
}
/** The last day of the semiweekly deposit period containing a payday. */
function closeOfSemiweeklyPeriod(payDate, wedToFri) {
    let d = payDate;
    // Wed–Fri periods close on Friday(5); Sat–Tue periods close on Tuesday(2).
    const closeDow = wedToFri ? 5 : 2;
    for (let i = 0; i < 7 && dow(d) !== closeDow; i += 1)
        d = addDays(d, 1);
    return d;
}
/**
 * @description The FUTA (Form 940) quarterly deposit due date.
 *
 * Pub 15: "Deposit the FUTA tax by the last day of the first month that follows
 * the end of the quarter."
 * @param year - Tax year.
 * @param quarter - 1–4.
 * @returns The due date, rolled off weekends and legal holidays.
 */
function futaDepositDue(year, quarter) {
    const endMonth = Math.min(4, Math.max(1, quarter)) * 3; // 3, 6, 9, 12
    // Day 0 of the month after next = the last day of the following month.
    const lastDay = iso(new Date(Date.UTC(year, endMonth + 1, 0)));
    return nextIrsBusinessDay(lastDay);
}
//# sourceMappingURL=payroll-calendar.js.map