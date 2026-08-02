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
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  addDays, depositDueDate, fedBankingClosures, futaDepositDue, irsLegalHolidays,
  isFedBankingDay, isIrsBusinessDay, nextFedBankingDay, nextIrsBusinessDay, resolvePayDate,
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

test('a Saturday New Year is observed on 31 DECEMBER of the previous year, and counts there', () => {
  // 2028-01-01 is a Saturday, so the IRS observes New Year's Day on Friday
  // 2027-12-31. Bucketing that observance under its statutory year (2028) means
  // isIrsBusinessDay('2027-12-31') consults the 2027 set, misses it, and lets a
  // deposit due date land on a day the IRS treats as a holiday.
  assert.equal(irsLegalHolidays(2028).holidays.some((h) => h.date === '2027-12-31'), true,
    'the observance itself moves back a year');
  assert.equal(isIrsBusinessDay('2027-12-31'), false,
    'and the lookup for 2027 must see it — this is the cross-year bucketing bug');

  // The Federal Reserve has no equivalent hazard: its Saturday rule produces no
  // closure at all, so that same Friday is a full banking day.
  assert.equal(isFedBankingDay('2027-12-31'), true, 'banks are open; only the deposit deadline moves');

  // A deposit that would otherwise fall there rolls forward off it.
  assert.equal(nextIrsBusinessDay('2027-12-31'), '2028-01-03');
});

test('a year whose Pub 15 has not been read is returned UNVERIFIED rather than silently trusted', () => {
  const later = irsLegalHolidays(2030);
  assert.equal(later.verified, false);
  assert.match(later.note, /has not been read/i);
  assert.ok(later.holidays.length > 0, 'still computed — it degrades to a warning, not to nothing');
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

test('FUTA is due the last day of the month after the quarter, rolled forward', () => {
  assert.equal(futaDepositDue(2026, 1), '2026-04-30');
  assert.equal(futaDepositDue(2026, 2), '2026-07-31');
  // Q4 2026 → 2027-01-31 is a Sunday → Monday February 1.
  assert.equal(futaDepositDue(2026, 4), '2027-02-01');
});
