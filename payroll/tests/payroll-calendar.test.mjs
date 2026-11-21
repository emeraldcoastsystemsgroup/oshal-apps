/**
 * Banking-calendar suite — the two calendars, against the COMPILED module.
 *
 * Every expected value here is transcribed from a retrieved primary document,
 * NOT from what the implementation happens to produce:
 *
 *   - Federal Reserve Board K.8 / frbservices.org — the 2026, 2027 and 2028
 *     Reserve Bank closure sets, including which holidays fall on a weekend.
 *   - IRS Publication 15 (2026), section 11 — the twelve legal holidays, printed
 *     verbatim, and the two worked examples the IRS supplies for deposit timing.
 *
 * The case that matters most is the DIVERGENCE. Friday 2026-07-03 is a normal
 * Reserve Bank banking day (payroll funds) and simultaneously an IRS legal
 * holiday (the deposit deadline moves). A payroll system with one holiday list
 * gets one of those two wrong, silently.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 01:20:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — the three published Reserve Bank closure sets asserted exactly, the verbatim Pub 15 2026 legal-holiday list, the Fed/IRS divergence on 2026-07-03 and Emancipation Day, pay-date shifting that chains through consecutive closures, and both of Pub 15's own worked deposit examples (the Monday-holiday extra day, and the two-quarter pay dates both due 2026-10-07).
 * 2                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 14: the K.8 2026-2030 table cross-checked cell by cell against 5 U.S.C. 6103(a) and the weekday each footnote marker claims, the 2029 and 2030 closure sets, K.8's own named footnote dates, the 2027 IRS list from the early-release draft of Publication 15 (2027) returned unverified, both IRS lists cross-checked against the D.C. Code 28-2701 rule, the regulation's Memorial Day example, and the refusals: a year neither table holds is refused by name where it used to be computed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CalendarCoverageError, FED_K8_ROWS, FED_SCHEDULE_YEARS, IRS_HOLIDAY_YEARS, IRS_HOLIDAYS_VERIFIED_THROUGH,
  addDays, calendarCoverage, dcCodeHolidayRule, depositDueDate, fedBankingClosures, federalHolidayRule,
  futaDepositDue, irsLegalHolidays, isCalendarCoverageError,
  isFedBankingDay, isIrsBusinessDay, nextFedBankingDay, nextIrsBusinessDay, previousFedBankingDay, resolvePayDate,
} = require('../routes/payroll-calendar.js');

const dates = (list) => list.map((o) => o.date);

/* ── Federal Reserve closures, straight off K.8 ──────────────────────────── */

test('2026 Reserve Bank closures match the published schedule — July 4 is a SATURDAY and costs nothing', () => {
  assert.deepEqual(dates(fedBankingClosures(2026)), [
    '2026-01-01', // Thursday
    '2026-01-19', // MLK, Monday
    '2026-02-16', // Washington's Birthday, Monday
    '2026-05-25', // Memorial Day, Monday
    '2026-06-19', // Juneteenth, Friday
    '2026-09-07', // Labor Day, Monday
    '2026-10-12', // Columbus Day, Monday
    '2026-11-11', // Veterans Day, Wednesday
    '2026-11-26', // Thanksgiving, Thursday
    '2026-12-25', // Christmas, Friday
  ]);
  // Independence Day 2026 falls on Saturday. K.8: Reserve Banks are OPEN the
  // preceding Friday, so ZERO banking days are lost — the holiday is absent.
  assert.equal(isFedBankingDay('2026-07-03'), true, 'Friday July 3 2026 is a full banking day');
});

test('2027: a SUNDAY holiday closes the following Monday, two SATURDAY holidays close nothing', () => {
  assert.deepEqual(dates(fedBankingClosures(2027)), [
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31',
    '2027-07-05', // Independence Day falls Sunday July 4 → closed Monday July 5
    '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25',
  ]);
  // Juneteenth (Sat Jun 19) and Christmas (Sat Dec 25) produce no closure at all.
  assert.equal(isFedBankingDay('2027-06-18'), true, 'the Friday before a Saturday Juneteenth is open');
  assert.equal(isFedBankingDay('2027-12-24'), true, 'the Friday before a Saturday Christmas is open');
});

test('2028: New Year and Veterans Day both fall on Saturday, so neither closes a banking day', () => {
  assert.deepEqual(dates(fedBankingClosures(2028)), [
    '2028-01-17', '2028-02-21', '2028-05-29', '2028-06-19',
    '2028-07-04', '2028-09-04', '2028-10-09', '2028-11-23', '2028-12-25',
  ]);
  assert.equal(isFedBankingDay('2027-12-31'), true, 'Reserve Banks open Fri Dec 31 2027 for a Saturday New Year');
});

/* ── IRS legal holidays, verbatim from Pub 15 (2026) ─────────────────────── */

test('the 2026 IRS legal-holiday list matches Publication 15 exactly — twelve dates, not the Fed eleven', () => {
  const year = irsLegalHolidays(2026);
  assert.equal(year.verified, true);
  assert.deepEqual(dates(year.holidays), [
    '2026-01-01', '2026-01-19', '2026-02-16',
    '2026-04-16', // District of Columbia Emancipation Day — NOT a Fed closure
    '2026-05-25', '2026-06-19',
    '2026-07-03', // "July 3—Independence Day (observed)" — the Fed does NOT shift it
    '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
  ]);
});

test('THE DIVERGENCE: money moves on 2026-07-03 and on Emancipation Day, but deposit deadlines do not fall', () => {
  for (const date of ['2026-07-03', '2026-04-16']) {
    assert.equal(isFedBankingDay(date), true, `${date}: Reserve Banks are open, so payroll funds`);
    assert.equal(isIrsBusinessDay(date), false, `${date}: an IRS legal holiday, so a deposit due here moves`);
  }
});

test('the 2027 list is the IRS early-release draft: thirteen dates, returned UNVERIFIED', () => {
  // Publication 15 (2027), early-release draft dated October 15, 2026, section 11:
  // "Legal holidays for 2027 are listed next." — thirteen lines, ending
  // "December 24—Christmas Day (observed)" and "December 31—New Year's Day 2028 (observed)".
  const year = irsLegalHolidays(2027);
  assert.deepEqual(dates(year.holidays), [
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-04-16', '2027-05-31',
    '2027-06-18', // Juneteenth (Saturday June 19) observed Friday
    '2027-07-05', // Independence Day (Sunday July 4) observed Monday
    '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25',
    '2027-12-24', // Christmas (Saturday December 25) observed Friday
    '2027-12-31', // New Year's Day 2028 (Saturday January 1) observed Friday
  ]);
  assert.equal(year.basis, 'draft');
  assert.equal(year.verified, false, 'a draft is not the publication');
  assert.match(year.note, /early-release draft/);
  assert.match(year.source, /draft dated October 15, 2026/);
  assert.equal(IRS_HOLIDAYS_VERIFIED_THROUGH, 2026, 'only the final 2026 publication has been read');
});

test('a Saturday New Year is observed on 31 DECEMBER of the previous year, and counts there', () => {
  // 2028-01-01 is a Saturday, so the IRS observes New Year's Day on Friday
  // 2027-12-31 and prints it in the 2027 list. A lookup for 2027 must see it,
  // or a deposit due date lands on a day the IRS treats as a holiday.
  const moved = irsLegalHolidays(2027).holidays.find((h) => h.date === '2027-12-31');
  assert.equal(moved.statutoryDate, '2028-01-01', 'the observance itself moves back a year');
  assert.equal(isIrsBusinessDay('2027-12-31'), false);

  // The Federal Reserve has no equivalent: K.8 marks January 1, 2028 "*" and
  // names December 31, 2027 as a day the Reserve Banks are open.
  assert.equal(isFedBankingDay('2027-12-31'), true, 'banks are open; only the deposit deadline moves');

  // Rolling off it runs into 2028, which no IRS list covers: refused by name.
  assert.throws(() => nextIrsBusinessDay('2027-12-31'), (err) => {
    assert.ok(err instanceof CalendarCoverageError);
    assert.equal(err.year, 2028);
    assert.match(err.message, /no list for 2028/);
    return true;
  });
});

test('both IRS lists agree with the D.C. Code 28-2701 rule, date for date', () => {
  // The rule is a cross-check, never the source: a transcription slip in a list
  // or a wrong reading of the statute shows up here as a disagreement.
  for (const year of IRS_HOLIDAY_YEARS) {
    const list = irsLegalHolidays(year).holidays.map((h) => ({ date: h.date, statutoryDate: h.statutoryDate }));
    assert.deepEqual(list, dcCodeHolidayRule(year), `${year} list and the D.C. Code rule disagree`);
  }
});

test('the K.8 table agrees with 5 U.S.C. 6103(a), and each footnote marker with its weekday', () => {
  for (const [column, year] of FED_SCHEDULE_YEARS.entries()) {
    const rule = federalHolidayRule(year);
    assert.equal(FED_K8_ROWS.length, 11, 'eleven holidays');
    for (const [i, row] of FED_K8_ROWS.entries()) {
      const cell = row[column + 1];
      assert.equal(row[0], rule[i].name);
      assert.equal(`${year}-${cell.slice(0, 5)}`, rule[i].date, `${year} ${row[0]}`);
      const weekday = new Date(`${rule[i].date}T00:00:00Z`).getUTCDay();
      const expectedMarker = weekday === 6 ? '*' : weekday === 0 ? '**' : '';
      assert.equal(cell.slice(5), expectedMarker, `${year} ${row[0]} marker`);
    }
  }
});

test("K.8's own footnote dates: Banks OPEN on the five Fridays, CLOSED on the two Mondays", () => {
  // "* Saturday - the Federal Reserve Banks are open, but the Board of Governors
  //  is closed on July 3, 2026, June 18, 2027, December 24, 2027, December 31,
  //  2027, and November 10, 2028."
  for (const friday of ['2026-07-03', '2027-06-18', '2027-12-24', '2027-12-31', '2028-11-10']) {
    assert.equal(isFedBankingDay(friday), true, `${friday} is a Reserve Bank banking day`);
  }
  // "** Sunday - the Federal Reserve Banks and the Board of Governors are closed
  //  on July 5, 2027, and November 12, 2029."
  for (const monday of ['2027-07-05', '2029-11-12']) {
    assert.equal(isFedBankingDay(monday), false, `${monday} is closed`);
  }
});

test('2029 and 2030 Reserve Bank closures, the last two K.8 columns', () => {
  assert.deepEqual(dates(fedBankingClosures(2029)), [
    '2029-01-01', '2029-01-15', '2029-02-19', '2029-05-28', '2029-06-19', '2029-07-04',
    '2029-09-03', '2029-10-08',
    '2029-11-12', // Veterans Day falls Sunday November 11 → closed Monday
    '2029-11-22', '2029-12-25',
  ]);
  assert.deepEqual(dates(fedBankingClosures(2030)), [
    '2030-01-01', '2030-01-21', '2030-02-18', '2030-05-27', '2030-06-19', '2030-07-04',
    '2030-09-02', '2030-10-14', '2030-11-11', '2030-11-28', '2030-12-25',
  ]);
});

/* ── refusals: a year a table does not hold ──────────────────────────────── */

test('a year K.8 does not print is REFUSED by name, in both directions', () => {
  for (const year of [2025, 2031]) {
    assert.throws(() => fedBankingClosures(year), (err) => {
      assert.ok(isCalendarCoverageError(err));
      assert.equal(err.table, 'federal-reserve');
      assert.equal(err.year, year);
      assert.match(err.message, new RegExp(`K\\.8, 2026 to 2030\\) has no year ${year}`));
      assert.match(err.message, /Nothing was assumed from another year/);
      return true;
    });
  }
  // A weekend in an uncovered year is refused too: the table is consulted
  // before the weekday, so "Saturday, obviously closed" never hides the gap.
  assert.throws(() => isFedBankingDay('2031-01-04'), CalendarCoverageError);
  // Paying early across New Year would need 2025, which K.8 2026-2030 lacks.
  assert.throws(() => previousFedBankingDay('2026-01-01'), /has no year 2025/);
});

test('a year with no IRS list is REFUSED by name rather than computed from the rules', () => {
  for (const year of [2025, 2028, 2030]) {
    assert.throws(() => irsLegalHolidays(year), (err) => {
      assert.ok(isCalendarCoverageError(err));
      assert.equal(err.table, 'irs');
      assert.match(err.message, /cover 2026 and 2027/);
      assert.match(err.message, new RegExp(`no list for ${year}`));
      return true;
    });
  }
  assert.throws(() => isIrsBusinessDay('2028-03-01'), CalendarCoverageError);
  // A late-December 2027 payday is due in January 2028: refused, not guessed.
  assert.throws(() => depositDueDate('2027-12-29', 'semiweekly'), /no list for 2028/);
});

test('coverage is stated: five Federal Reserve years, one final and one draft IRS year', () => {
  const c = calendarCoverage();
  assert.deepEqual(c.federalReserve.years, [2026, 2027, 2028, 2029, 2030]);
  assert.match(c.federalReserve.source, /K\.8/);
  assert.deepEqual(c.irs.map((y) => [y.year, y.basis, y.verified]),
    [[2026, 'publication', true], [2027, 'draft', false]]);
});

/* ── pay dates ───────────────────────────────────────────────────────────── */

test('a pay date on a closure moves EARLIER, and chains through a holiday into the weekend', () => {
  // Christmas 2026 is Friday. Moving earlier lands on Thursday Dec 24.
  const xmas = resolvePayDate('2026-12-25');
  assert.equal(xmas.payDate, '2026-12-24');
  assert.equal(xmas.shifted, true);
  assert.match(xmas.reason, /Christmas Day/);

  // A Saturday pay date walks back past Friday only if Friday is also closed.
  assert.equal(resolvePayDate('2026-12-26').payDate, '2026-12-24', 'Sat → skips closed Fri → Thu');
  assert.equal(resolvePayDate('2026-11-28').payDate, '2026-11-27', 'Sat after Thanksgiving → Friday is open');
});

test('an unshifted pay date reports no change, and the later direction is available', () => {
  const fine = resolvePayDate('2026-07-03');
  assert.equal(fine.shifted, false);
  assert.equal(fine.reason, '');
  assert.equal(resolvePayDate('2026-12-25', 'later').payDate, '2026-12-28');
});

test('nextFedBankingDay chains through consecutive closures', () => {
  assert.equal(nextFedBankingDay('2026-12-25'), '2026-12-28');
  assert.equal(addDays('2026-12-25', 3), '2026-12-28');
});

/* ── deposit due dates: the IRS's own worked examples ────────────────────── */

test("Pub 15's worked example: a Friday payday with a Monday legal holiday moves Wednesday → Thursday", () => {
  // "if a semiweekly schedule depositor accumulated taxes for payments made on
  //  Friday and the following Monday is a legal holiday, the deposit normally
  //  due on Wednesday may be made on Thursday (this allows 3 business days)."
  // Friday 2026-01-16; the following Monday 2026-01-19 is MLK Day.
  const due = depositDueDate('2026-01-16', 'semiweekly');
  assert.equal(due.extraDaysForHolidays, 1, 'one extra day for the one legal holiday in the window');
  assert.equal(due.dueDate, '2026-01-22', 'Wednesday the 21st + 1 = Thursday the 22nd');
});

test("Pub 15's worked example: pay dates in different quarters are both due 2026-10-07", () => {
  // "If you have a pay date on Wednesday, September 30, 2026 (third quarter),
  //  and another pay date on Friday, October 2, 2026 (fourth quarter) ...
  //  Both deposits would be due on Wednesday, October 7, 2026."
  assert.equal(depositDueDate('2026-09-30', 'semiweekly').dueDate, '2026-10-07');
  assert.equal(depositDueDate('2026-10-02', 'semiweekly').dueDate, '2026-10-07');
});

test('the semiweekly split: Wed/Thu/Fri deposit Wednesday, Sat/Sun/Mon/Tue deposit Friday', () => {
  assert.equal(depositDueDate('2026-03-04', 'semiweekly').dueDate, '2026-03-11', 'Wed → following Wed');
  assert.equal(depositDueDate('2026-03-09', 'semiweekly').dueDate, '2026-03-13', 'Mon → following Fri');
  assert.match(depositDueDate('2026-03-09', 'semiweekly').rule, /Saturday\/Sunday\/Monday\/Tuesday/);
});

test('a monthly depositor owes the 15th of the following month, rolled off a weekend', () => {
  assert.equal(depositDueDate('2026-03-31', 'monthly').dueDate, '2026-04-15');
  // 2026-08-15 is a Saturday → rolls to Monday the 17th.
  assert.equal(depositDueDate('2026-07-31', 'monthly').dueDate, '2026-08-17');
});

test('the $100,000 rule overrides the depositor status entirely', () => {
  const big = depositDueDate('2026-03-09', 'monthly', 10_000_000);
  assert.equal(big.dueDate, '2026-03-10', 'next business day, not the 15th of April');
  assert.match(big.rule, /\$100,000 next-business-day rule/);
  // One cent below the threshold stays on the ordinary schedule.
  assert.equal(depositDueDate('2026-03-09', 'monthly', 9_999_999).dueDate, '2026-04-15');
});

test('a deposit due date is never left on a weekend or a legal holiday', () => {
  for (const payDate of ['2026-01-16', '2026-03-04', '2026-06-30', '2026-12-24']) {
    for (const status of ['monthly', 'semiweekly']) {
      const { dueDate } = depositDueDate(payDate, status);
      assert.equal(isIrsBusinessDay(dueDate), true, `${payDate}/${status} → ${dueDate} is not a business day`);
    }
  }
});

test("the regulation's example: Memorial Day on the Monday after a Wednesday-Friday period → Thursday", () => {
  // 26 CFR 31.6302-1(c)(2)(iii): "if the Monday following the close of a
  //  Wednesday to Friday semi-weekly period is Memorial Day, a legal holiday,
  //  the required deposit for the semi-weekly period is not due until the
  //  following Thursday rather than the following Wednesday."
  // Memorial Day 2026 is Monday May 25; the period before it closes Friday May 22.
  for (const payDate of ['2026-05-20', '2026-05-21', '2026-05-22']) {
    const due = depositDueDate(payDate, 'semiweekly');
    assert.equal(due.dueDate, '2026-05-28', `${payDate} → Thursday May 28`);
    assert.equal(due.extraDaysForHolidays, 1);
  }
});

test('Thanksgiving inside the Saturday-Tuesday window gives three business days: Wed, Fri, Mon', () => {
  // Payday Tuesday 2026-11-24. The period closes that Tuesday; the three
  // weekdays after it are Wed 25, Thu 26 (Thanksgiving), Fri 27 → one extra
  // day. Friday + 1 = Saturday, which rolls to Monday November 30.
  // Business days after the close: Wed 25 (1), Fri 27 (2), Mon 30 (3).
  const due = depositDueDate('2026-11-24', 'semiweekly');
  assert.equal(due.extraDaysForHolidays, 1);
  assert.equal(due.dueDate, '2026-11-30');
});

test('a 2026 payday due in 2027 is UNVERIFIED and says why; one due in 2026 is verified', () => {
  // Thursday 2026-12-31 → Wednesday 2027-01-06 (Mon 4, Tue 5, Wed 6 are all business days).
  const semi = depositDueDate('2026-12-31', 'semiweekly');
  assert.equal(semi.dueDate, '2027-01-06');
  assert.equal(semi.verified, false, 'the due date consults the 2027 list, which is a draft');
  assert.match(semi.calendarNote, /early-release draft of Publication 15 \(2027\)/);
  // December 2026 monthly liability → Friday 2027-01-15 (MLK Day is Monday the 18th).
  const monthly = depositDueDate('2026-12-18', 'monthly');
  assert.equal(monthly.dueDate, '2027-01-15');
  assert.equal(monthly.verified, false);
  const within = depositDueDate('2026-03-04', 'semiweekly');
  assert.equal(within.verified, true);
  assert.equal(within.calendarNote, '');
});

test('FUTA is due the last day of the month after the quarter, rolled forward', () => {
  assert.equal(futaDepositDue(2026, 1), '2026-04-30');
  assert.equal(futaDepositDue(2026, 2), '2026-07-31');
  // Q4 2026 → 2027-01-31 is a Sunday → Monday February 1.
  assert.equal(futaDepositDue(2026, 4), '2027-02-01');
});
