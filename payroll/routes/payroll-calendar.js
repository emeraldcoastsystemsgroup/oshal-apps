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
 * SOURCES, each retrieved and quoted in the constant it justifies. The tables
 * below were re-read from the documents on 2026-11-20:
 *   - Federal Reserve Board, "K.8 - Holidays Observed by the Federal Reserve
 *     System 2026-2030", last update July 8, 2026,
 *     https://www.federalreserve.gov/aboutthefed/k8.htm
 *   - 5 U.S.C. § 6103(a) (United States Code, 2024 Edition, govinfo.gov) — the
 *     eleven legal public holidays. Used ONLY to cross-check the K.8 table.
 *   - IRS Publication 15 (2026) (Circular E), section 11 "Depositing Taxes":
 *     "Deposits Due on Business Days Only", "Legal holiday" (the 2026 list) and
 *     Table 2, https://www.irs.gov/pub/irs-pdf/p15.pdf
 *   - IRS Publication 15 (2027), EARLY-RELEASE DRAFT dated October 15, 2026
 *     (the date its PDF carries; the cover sheet reads "Caution: DRAFT—NOT FOR
 *     FILING"), section 11 "Legal holiday" (the 2027 list),
 *     https://www.irs.gov/pub/irs-dft/p15--dft.pdf — a draft, so the 2027 list
 *     is returned UNVERIFIED until the final publication is read.
 *   - 26 U.S.C. § 7503 (2024 Edition, govinfo.gov): "the term 'legal holiday'
 *     means a legal holiday in the District of Columbia".
 *   - 26 CFR 301.7503-1(b) (eCFR, current to 2026-11-18): "the legal holidays
 *     in the District of Columbia as found in D.C. Code Ann. 28-2701".
 *   - D.C. Code § 28-2701 (code.dccouncil.gov) — the holiday list and the
 *     observance rule. Used ONLY to cross-check the transcribed IRS lists.
 *   - 26 CFR 31.6302-1(c) (eCFR, current to 2026-11-18) — the monthly,
 *     semi-weekly and One-Day deposit rules and the three-business-day rule.
 *   - Federal Reserve Operating Circular No. 4 (eff. 2024-10-28), Appendix B
 *     §3.2 — settlement moves FORWARD to the next banking day, never backward.
 *
 * COVERAGE IS EXPLICIT. Each calendar is a transcribed table with the years it
 * holds. A date in a year neither table holds is REFUSED with words naming the
 * table and the year (CalendarCoverageError) — never answered from a nearby
 * year or from a rule nobody has checked against that year's publication.
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
 * 2                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 14: both calendars are now transcribed tables with explicit years. The Federal Reserve calendar is the K.8 2026-2030 schedule row for row; the IRS calendar is the Publication 15 (2026) list plus the 2027 list from the IRS early-release draft of Publication 15 (2027), returned unverified because a draft is not the publication. A date in a year a table does not hold is refused by name (CalendarCoverageError) where it used to be computed from the observance rules and merely flagged; the rules remain only as cross-checks the tests run against the tables. A deposit due date now reports unverified when EITHER the payday's year or the due date's year is unverified (a December 2026 payday is due in January 2027).
 *
 * @module payroll-calendar
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NEXT_DAY_THRESHOLD_CENTS = exports.IRS_HOLIDAY_YEARS = exports.FED_SCHEDULE_SOURCE = exports.FED_K8_ROWS = exports.FED_SCHEDULE_YEARS = exports.CalendarCoverageError = exports.IRS_HOLIDAYS_VERIFIED_THROUGH = void 0;
exports.addDays = addDays;
exports.isCalendarCoverageError = isCalendarCoverageError;
exports.fedBankingClosures = fedBankingClosures;
exports.isFedBankingDay = isFedBankingDay;
exports.nextFedBankingDay = nextFedBankingDay;
exports.previousFedBankingDay = previousFedBankingDay;
exports.irsLegalHolidays = irsLegalHolidays;
exports.isIrsBusinessDay = isIrsBusinessDay;
exports.nextIrsBusinessDay = nextIrsBusinessDay;
exports.calendarCoverage = calendarCoverage;
exports.federalHolidayRule = federalHolidayRule;
exports.dcCodeHolidayRule = dcCodeHolidayRule;
exports.resolvePayDate = resolvePayDate;
exports.depositDueDate = depositDueDate;
exports.nextDayDue = nextDayDue;
exports.monthlyDue = monthlyDue;
exports.semiweeklyDue = semiweeklyDue;
exports.closeOfSemiweeklyPeriod = closeOfSemiweeklyPeriod;
exports.futaDepositDue = futaDepositDue;
/** The last tax year whose IRS legal-holiday list was read from that year's FINAL Pub 15. */
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
 * @description Thrown when a date falls in a year the named calendar table does
 * not hold. The message is written for the person running payroll: it names the
 * table, the year asked for and the years held, and says nothing was assumed.
 */
class CalendarCoverageError extends Error {
    table;
    year;
    covered;
    code = 'calendar_year_not_covered';
    /**
     * @param table - The calendar that could not answer.
     * @param year - The year asked for.
     * @param covered - The years that table holds.
     */
    constructor(table, year, covered) {
        super(table === 'federal-reserve'
            ? `The Federal Reserve holiday schedule held here (K.8, ${covered[0]} to ${covered[covered.length - 1]}) has no year `
                + `${year}, so a banking day in ${year} cannot be confirmed. Nothing was assumed from another year.`
            : `The IRS legal-holiday lists held here cover ${covered.join(' and ')} (Publication 15, section 11). There is no `
                + `list for ${year}, so a deposit due date in ${year} cannot be confirmed. Nothing was assumed from another year.`);
        this.table = table;
        this.year = year;
        this.covered = covered;
        this.name = 'CalendarCoverageError';
    }
}
exports.CalendarCoverageError = CalendarCoverageError;
/**
 * @description Whether an error is a calendar-coverage refusal. Checked on the
 * code rather than with instanceof so a route can tell even across module copies.
 * @param err - Anything caught.
 * @returns True for a CalendarCoverageError.
 */
function isCalendarCoverageError(err) {
    return Boolean(err) && err.code === 'calendar_year_not_covered';
}
/* ── calendar 1: the Federal Reserve (does money move?) ───────────────────── */
/** The years printed on K.8, left to right. */
exports.FED_SCHEDULE_YEARS = Object.freeze([2026, 2027, 2028, 2029, 2030]);
/**
 * "K.8 - Holidays Observed by the Federal Reserve System 2026-2030" (Federal
 * Reserve Board, last update July 8, 2026), transcribed row for row, one column
 * per year in FED_SCHEDULE_YEARS order. The markers are K.8's own footnotes:
 *
 *   "*"  Saturday — "the Federal Reserve Banks are open, but the Board of
 *        Governors is closed on July 3, 2026, June 18, 2027, December 24, 2027,
 *        December 31, 2027, and November 10, 2028."
 *   "**" Sunday — "the Federal Reserve Banks and the Board of Governors are
 *        closed on July 5, 2027, and November 12, 2029."
 *
 * and its headnote, verbatim: "For holidays falling on Saturday, Federal
 * Reserve Banks and Branches will be open the preceding Friday; however, the
 * Board of Governors will be closed. For holidays falling on Sunday, all
 * Federal Reserve offices will be closed the following Monday."
 *
 * So a "*" cell produces NO Reserve Bank closure at all and a "**" cell closes
 * the following Monday. That is the opposite of the federal-employee rule in
 * 5 U.S.C. § 6103(b), and mixing the two up is why payroll systems mispredict
 * funding.
 */
exports.FED_K8_ROWS = Object.freeze([
    ["New Year's Day", '01-01', '01-01', '01-01*', '01-01', '01-01'],
    ['Birthday of Martin Luther King, Jr.', '01-19', '01-18', '01-17', '01-15', '01-21'],
    ["Washington's Birthday", '02-16', '02-15', '02-21', '02-19', '02-18'],
    ['Memorial Day', '05-25', '05-31', '05-29', '05-28', '05-27'],
    ['Juneteenth National Independence Day', '06-19', '06-19*', '06-19', '06-19', '06-19'],
    ['Independence Day', '07-04*', '07-04**', '07-04', '07-04', '07-04'],
    ['Labor Day', '09-07', '09-06', '09-04', '09-03', '09-02'],
    ['Columbus Day', '10-12', '10-11', '10-09', '10-08', '10-14'],
    ['Veterans Day', '11-11', '11-11', '11-11*', '11-11**', '11-11'],
    ['Thanksgiving Day', '11-26', '11-25', '11-23', '11-22', '11-28'],
    ['Christmas Day', '12-25', '12-25*', '12-25', '12-25', '12-25'],
]);
/** Where the Federal Reserve table came from, for the screen. */
exports.FED_SCHEDULE_SOURCE = 'Federal Reserve Board, K.8 - Holidays Observed by the Federal Reserve System '
    + '2026-2030 (last update July 8, 2026)';
/** Refuse a year K.8 does not print. */
function requireFedYear(year) {
    const column = exports.FED_SCHEDULE_YEARS.indexOf(year);
    if (column < 0)
        throw new CalendarCoverageError('federal-reserve', year, [...exports.FED_SCHEDULE_YEARS]);
    return column;
}
/**
 * @description Reserve Bank closures for a year, read from the K.8 table.
 * @param year - Calendar year; must be one K.8 prints.
 * @returns Observed closures, ascending. A Saturday-falling holiday is absent.
 * @throws CalendarCoverageError when K.8 does not print that year.
 */
function fedBankingClosures(year) {
    const column = requireFedYear(year);
    const out = [];
    for (const row of exports.FED_K8_ROWS) {
        const cell = row[column + 1];
        const statutoryDate = `${year}-${cell.slice(0, 5)}`;
        const marker = cell.slice(5);
        if (marker === '*')
            continue; // Saturday — Banks open the preceding Friday
        const date = marker === '**' ? addDays(statutoryDate, 1) : statutoryDate; // Sunday — closed Monday
        out.push({ date, name: row[0], statutoryDate });
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
 * @throws CalendarCoverageError when the date's year is not on K.8.
 */
function isFedBankingDay(date) {
    const closures = fedClosureSet(Number(date.slice(0, 4)));
    if (isWeekend(date))
        return false;
    return !closures.has(date);
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
/**
 * The IRS legal-holiday lists, transcribed line for line. A name carries the
 * publication's wording without its "(observed)" suffix; the statutory date in
 * the third column is what says the day was moved.
 *
 * 2026 — IRS Publication 15 (2026), section 11, "Legal holiday": "Legal
 * holidays for 2026 are listed next." Twelve lines, including "April 16—
 * District of Columbia Emancipation Day" and "July 3—Independence Day
 * (observed)".
 *
 * 2027 — the IRS EARLY-RELEASE DRAFT of Publication 15 (2027), dated October
 * 15, 2026 and marked "DRAFT—NOT FOR FILING": "Legal holidays for 2027 are
 * listed next." Thirteen lines, including "June 18—Juneteenth National
 * Independence Day (observed)", "July 5—Independence Day (observed)",
 * "December 24—Christmas Day (observed)" and "December 31—New Year's Day 2028
 * (observed)". It agrees with the D.C. Code § 28-2701 rule (see
 * dcCodeHolidayRule, which the tests run against both lists), but a draft is
 * not the publication: this list is returned UNVERIFIED until the final
 * Publication 15 (2027) is read and IRS_HOLIDAYS_VERIFIED_THROUGH moves.
 */
const IRS_LEGAL_HOLIDAY_LISTS = Object.freeze({
    2026: {
        basis: 'publication',
        source: 'IRS Publication 15 (2026), section 11, "Legal holiday"',
        rows: [
            ['2026-01-01', "New Year's Day", '2026-01-01'],
            ['2026-01-19', 'Birthday of Martin Luther King, Jr.', '2026-01-19'],
            ['2026-02-16', "Washington's Birthday", '2026-02-16'],
            ['2026-04-16', 'District of Columbia Emancipation Day', '2026-04-16'],
            ['2026-05-25', 'Memorial Day', '2026-05-25'],
            ['2026-06-19', 'Juneteenth National Independence Day', '2026-06-19'],
            ['2026-07-03', 'Independence Day', '2026-07-04'],
            ['2026-09-07', 'Labor Day', '2026-09-07'],
            ['2026-10-12', "Indigenous Peoples' Day (Columbus Day)", '2026-10-12'],
            ['2026-11-11', 'Veterans Day', '2026-11-11'],
            ['2026-11-26', 'Thanksgiving Day', '2026-11-26'],
            ['2026-12-25', 'Christmas Day', '2026-12-25'],
        ],
    },
    2027: {
        basis: 'draft',
        source: 'IRS Publication 15 (2027), early-release draft dated October 15, 2026, section 11, "Legal holiday"',
        rows: [
            ['2027-01-01', "New Year's Day", '2027-01-01'],
            ['2027-01-18', 'Birthday of Martin Luther King, Jr.', '2027-01-18'],
            ['2027-02-15', "Washington's Birthday", '2027-02-15'],
            ['2027-04-16', 'District of Columbia Emancipation Day', '2027-04-16'],
            ['2027-05-31', 'Memorial Day', '2027-05-31'],
            ['2027-06-18', 'Juneteenth National Independence Day', '2027-06-19'],
            ['2027-07-05', 'Independence Day', '2027-07-04'],
            ['2027-09-06', 'Labor Day', '2027-09-06'],
            ['2027-10-11', "Indigenous Peoples' Day (Columbus Day)", '2027-10-11'],
            ['2027-11-11', 'Veterans Day', '2027-11-11'],
            ['2027-11-25', 'Thanksgiving Day', '2027-11-25'],
            ['2027-12-24', 'Christmas Day', '2027-12-25'],
            ['2027-12-31', "New Year's Day 2028", '2028-01-01'],
        ],
    },
});
/** The years an IRS list is held for, ascending. */
exports.IRS_HOLIDAY_YEARS = Object.freeze(Object.keys(IRS_LEGAL_HOLIDAY_LISTS).map(Number).sort((a, b) => a - b));
/** Refuse a year no IRS list is held for. */
function requireIrsList(year) {
    const list = IRS_LEGAL_HOLIDAY_LISTS[year];
    if (!list)
        throw new CalendarCoverageError('irs', year, [...exports.IRS_HOLIDAY_YEARS]);
    return list;
}
/**
 * @description IRS legal holidays for deposit purposes, from the transcribed list.
 *
 * Pub 15 (2026) §11, verbatim: "The term 'legal holiday' means any legal
 * holiday in the District of Columbia. For purposes of the deposit rules, the
 * term 'legal holiday' doesn't include other statewide legal holidays."
 *
 * Each list holds the holidays OBSERVED within that calendar year, which is how
 * Pub 15 prints them: the 2027 list ends "December 31—New Year's Day 2028
 * (observed)", so a lookup for 31 December 2027 needs no neighbouring year.
 * @param year - Calendar year; must be one a list is held for.
 * @returns The observed legal holidays with the list's basis and source.
 * @throws CalendarCoverageError when no list is held for that year.
 */
function irsLegalHolidays(year) {
    const list = requireIrsList(year);
    const verified = list.basis === 'publication' && year <= exports.IRS_HOLIDAYS_VERIFIED_THROUGH;
    return {
        holidays: list.rows.map(([date, name, statutoryDate]) => ({ date, name, statutoryDate })),
        verified,
        basis: list.basis,
        source: list.source,
        note: verified
            ? `Matched against the legal-holiday list printed in IRS Publication 15 (${year}), section 11.`
            : `The ${year} list is from the IRS early-release draft of Publication 15 (${year}), which is marked not for `
                + 'filing. It has not been read from the final publication, so confirm a deposit due date in this year '
                + 'against the final Publication 15 before relying on it.',
    };
}
const irsHolidayCache = new Map();
/** Memoised set of every IRS legal holiday observed within a calendar year. */
function irsHolidaySet(year) {
    let s = irsHolidayCache.get(year);
    if (!s) {
        s = new Set(requireIrsList(year).rows.map((row) => row[0]));
        irsHolidayCache.set(year, s);
    }
    return s;
}
/**
 * @description Whether a date is an IRS business day for deposit purposes.
 *
 * 26 CFR 31.6302-1(c)(4): "Business days include every calendar day other than
 * Saturdays, Sundays, or legal holidays."
 * @param date - YYYY-MM-DD.
 * @returns True on a weekday that is not an IRS legal holiday.
 * @throws CalendarCoverageError when no list is held for the date's year.
 */
function isIrsBusinessDay(date) {
    const holidays = irsHolidaySet(Number(date.slice(0, 4)));
    if (isWeekend(date))
        return false;
    return !holidays.has(date);
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
 * @description What each calendar holds, for a screen to state plainly.
 * @returns The Federal Reserve years and source, and each IRS year with its basis.
 */
function calendarCoverage() {
    return {
        federalReserve: { years: [...exports.FED_SCHEDULE_YEARS], source: exports.FED_SCHEDULE_SOURCE },
        irs: exports.IRS_HOLIDAY_YEARS.map((year) => {
            const y = irsLegalHolidays(year);
            return { year, basis: y.basis, verified: y.verified, source: y.source };
        }),
    };
}
/**
 * 5 U.S.C. § 6103(a), in the statute's order: "New Year's Day, January 1.
 * Birthday of Martin Luther King, Jr., the third Monday in January.
 * Washington's Birthday, the third Monday in February. Memorial Day, the last
 * Monday in May. Juneteenth National Independence Day, June 19. Independence
 * Day, July 4. Labor Day, the first Monday in September. Columbus Day, the
 * second Monday in October. Veterans Day, November 11. Thanksgiving Day, the
 * fourth Thursday in November. Christmas Day, December 25."
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
/** The statutory (unobserved) date of one rule in a year. */
function ruleDate(h, year) {
    return h.fixed
        ? `${year}-${String(h.fixed[0]).padStart(2, '0')}-${String(h.fixed[1]).padStart(2, '0')}`
        : nthWeekday(year, h.nth.month, h.nth.weekday, h.nth.n);
}
/**
 * @description The statutory date of each 5 U.S.C. § 6103(a) holiday in a year.
 * A cross-check for the K.8 table; never the source of a banking-day answer.
 * @param year - Calendar year.
 * @returns Name and statutory date, in the statute's order.
 */
function federalHolidayRule(year) {
    return FEDERAL_HOLIDAYS.map((h) => ({ name: h.name, date: ruleDate(h, year) }));
}
/**
 * @description The legal holidays the D.C. Code rule puts in a calendar year.
 * A cross-check for the transcribed IRS lists; never the source of a due date.
 *
 * D.C. Code § 28-2701 names the same eleven days as 5 U.S.C. § 6103(a) plus
 * "District of Columbia Emancipation Day, April 16" and "the day of the
 * inauguration of the President, in every fourth year", then: "When a day set
 * apart as a legal holiday, other than the day of the inauguration of the
 * President, falls on a Saturday, the next preceding day is a holiday. When a
 * day set apart as a legal holiday falls on a Sunday, the next succeeding day
 * is a holiday." The Saturday rule can move New Year's Day into the PREVIOUS
 * calendar year, so the following year's 1 January is examined too.
 * @param year - Calendar year.
 * @returns Observed date and statutory date for each holiday observed in that year, ascending.
 */
function dcCodeHolidayRule(year) {
    const out = [];
    const observe = (statutoryDate, movesOffSaturday) => {
        const day = dow(statutoryDate);
        const date = day === 6 && movesOffSaturday ? addDays(statutoryDate, -1)
            : day === 0 ? addDays(statutoryDate, 1) : statutoryDate;
        if (date.startsWith(`${year}-`))
            out.push({ date, statutoryDate });
    };
    for (const y of [year, year + 1]) {
        for (const h of FEDERAL_HOLIDAYS)
            observe(ruleDate(h, y), true);
        observe(`${y}-04-16`, true);
        // 5 U.S.C. § 6103(c): "January 20 of each fourth year after 1965".
        if ((y - 1965) % 4 === 0)
            observe(`${y}-01-20`, false);
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
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
/** Finish a due date: stamp whether every year it touches is verified, and say so when not. */
function stamped(payDate, due) {
    const years = [...new Set([payDate, due.dueDate].map((d) => Number(d.slice(0, 4))))];
    const unverified = years.map((y) => irsLegalHolidays(y)).filter((y) => !y.verified);
    return { ...due, verified: unverified.length === 0, calendarNote: unverified.length ? unverified[0].note : '' };
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
    if (liabilityCents >= exports.NEXT_DAY_THRESHOLD_CENTS)
        return nextDayDue(payDate);
    if (depositorStatus === 'semiweekly')
        return semiweeklyDue(payDate);
    return monthlyDue(payDate);
}
/**
 * @description The One-Day rule's due date for taxes accumulated on a day.
 *
 * 26 CFR 31.6302-1(c)(3): "those taxes must be deposited ... by the close of
 * the next day. If the next day is a Saturday, Sunday, or legal holiday ... the
 * taxes will be treated as timely deposited if deposited on the next succeeding
 * day which is not a Saturday, Sunday, or legal holiday."
 * @param day - The day the $100,000 was reached, YYYY-MM-DD.
 * @returns The next business day.
 */
function nextDayDue(day) {
    return stamped(day, {
        dueDate: nextIrsBusinessDay(addDays(day, 1)),
        rule: '$100,000 next-business-day rule — this overrides the depositor status.',
        extraDaysForHolidays: 0,
    });
}
/**
 * @description A monthly depositor's due date for a payday.
 *
 * 26 CFR 31.6302-1(c)(1): "by the 15th day of the following month", rolled off
 * a Saturday, Sunday or legal holiday.
 * @param payDate - The payday, YYYY-MM-DD.
 * @returns The due date and the rule.
 */
function monthlyDue(payDate) {
    const d = utc(payDate);
    const fifteenth = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15)));
    return stamped(payDate, {
        dueDate: nextIrsBusinessDay(fifteenth),
        rule: 'Monthly depositor — due the 15th of the following month.',
        extraDaysForHolidays: 0,
    });
}
/**
 * @description A semiweekly depositor's due date for a payday, including the
 * extra-day allowance.
 *
 * 26 CFR 31.6302-1(c)(2)(iii): "Semi-weekly depositors have at least three
 * business days following the close of the semi-weekly period ... If any of the
 * three weekdays following the close of a semi-weekly period is a legal
 * holiday, the employer has an additional day for each day that is a legal
 * holiday". The allowance is counted over those three weekdays, which is what
 * guarantees three business days — a plain next-business-day roll can silently
 * give fewer.
 * @param payDate - The payday, YYYY-MM-DD.
 * @returns The due date, the rule, and the extra days granted.
 */
function semiweeklyDue(payDate) {
    const day = dow(payDate);
    // Wed(3)/Thu(4)/Fri(5) close Friday and deposit by Wednesday; the rest close
    // Tuesday and deposit by Friday.
    const wedToFri = day >= 3 && day <= 5;
    const target = wedToFri ? 3 : 5; // Wednesday or Friday
    let due = addDays(payDate, 1);
    for (let i = 0; i < 14 && dow(due) !== target; i += 1)
        due = addDays(due, 1);
    // One additional day for EACH of the 3 weekdays after the period close that
    // is a legal holiday.
    const periodClose = closeOfSemiweeklyPeriod(payDate);
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
    return stamped(payDate, {
        dueDate: nextIrsBusinessDay(due),
        rule: wedToFri
            ? 'Semiweekly depositor — Wednesday/Thursday/Friday payday, deposit by the following Wednesday.'
            : 'Semiweekly depositor — Saturday/Sunday/Monday/Tuesday payday, deposit by the following Friday.',
        extraDaysForHolidays,
    });
}
/**
 * @description The last day of the semiweekly deposit period containing a day.
 *
 * Pub 15 (2026) §11, "Deposit period": "The deposit periods for semiweekly
 * schedule depositors are Wednesday through Friday and Saturday through
 * Tuesday."
 * @param day - Any day, YYYY-MM-DD.
 * @returns The Friday or Tuesday that closes its period.
 */
function closeOfSemiweeklyPeriod(day) {
    const weekday = dow(day);
    const closeDow = weekday >= 3 && weekday <= 5 ? 5 : 2; // Wed–Fri close Friday; Sat–Tue close Tuesday
    let d = day;
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