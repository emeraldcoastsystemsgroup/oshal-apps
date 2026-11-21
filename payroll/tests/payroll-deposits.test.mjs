/**
 * Federal deposit schedule suite — the compiled payroll-deposits module and the
 * two routes that answer it, asserted against the worked examples in IRS
 * Publication 15 (2026), section 11, and 26 CFR 31.6302-1 (eCFR, current to
 * 2026-11-18). Every expected date and amount is derived by hand in the
 * comment above its assertion.
 *
 * What these protect:
 *
 *  - The lookback period and the $50,000 line decide the depositor status, and a
 *    year whose rule is not held, or an amount that is not whole cents, is
 *    refused in words.
 *  - Due dates come from the IRS legal-holiday calendar. The report used to roll
 *    off weekends only, so a due date on Washington's Birthday or the Memorial
 *    Day extra day came out a day early.
 *  - The $100,000 One-Day test is made on taxes ACCUMULATED in the deposit
 *    period, restarts after the day it is met, and turns a monthly depositor
 *    semiweekly from the next day. The report used to test each payday alone.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 8: Pub 15 (2026) Table 1 and the Rose Co. lookback example, the $50,000 boundary, the Spruce Co., Green, Inc., Elm, Inc. and Fir Co. examples, the $95,000/$10,000 period-boundary example, the two-quarter split due 2026-10-07, holiday-aware due dates the weekend-only report got wrong, the $2,500 pay-with-return test, a void netting a period, a due date in a year the IRS calendar does not hold, and both routes (owner-scoped SQL, 422 in words, 401 before any query).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const here = path.dirname(fileURLToPath(import.meta.url));

const STUBS = {
  express: { Router: () => fakeRouter() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/features/personal-data': {
    isEncrypted: (v) => typeof v === 'string' && v.startsWith('enc:'),
    encryptField: async (_sub, v) => (v === null || v === undefined ? null : `enc:${v}`),
    decryptField: async (_sub, v) => (typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v),
  },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (b) => !!b && typeof b === 'object' && b.confirm === true,
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true.` }),
  },
};
function fakeRouter() {
  const routes = new Map();
  const reg = (m) => (p, h) => { routes.set(`${m} ${p}`, h); };
  return { routes, get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete') };
}
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};
const { createPayrollRoutes } = require('../routes/payroll-routes.js');
const {
  DE_MINIMIS_CENTS, LOOKBACK_THRESHOLD_CENTS, LookbackInputError,
  buildDepositSchedule, depositorStatusFromLookback, lookbackPeriod,
} = require('../routes/payroll-deposits.js');

const D = (dollars) => Math.round(dollars * 100); // test-side only: literal dollar figures from Pub 15
const pay = (payDate, dollars) => ({ payDate, liabilityCents: D(dollars) });
const LATE = '2027-06-30'; // every 2026 quarter has ended

/* ── the lookback period ─────────────────────────────────────────────────── */

test('Pub 15 (2026) Table 1: the 2026 lookback is July 1, 2024 through June 30, 2025; a Form 944 filer looks at 2024', () => {
  assert.deepEqual(lookbackPeriod(2026, false).map((q) => [q.year, q.quarter]), [[2024, 3], [2024, 4], [2025, 1], [2025, 2]]);
  assert.equal(lookbackPeriod(2026, false)[0].label, 'July 1 to September 30, 2024');
  // Table 1 footnote: "The lookback period for a 2026 Form 941 filer who filed
  // Form 944 in either 2024 or 2025 is calendar year 2024."
  assert.deepEqual(lookbackPeriod(2026, true).map((q) => [q.year, q.quarter]), [[2024, 1], [2024, 2], [2024, 3], [2024, 4]]);
});

test("Rose Co.: $12,000 + $12,000 + $12,000 + $15,000 = $51,000 is more than $50,000 → semiweekly for 2026", () => {
  const r = depositorStatusFromLookback(2026, [D(12000), D(12000), D(12000), D(15000)]);
  assert.equal(r.totalCents, 5_100_000);
  assert.equal(r.status, 'semiweekly');
  assert.match(r.reason, /\$51,000\.00 was reported for the lookback period \(July 1, 2024 to June 30, 2025\)/);
  assert.match(r.reason, /more than \$50,000/);
  // Rose Co.'s 2025 figures, four quarters of $12,000 = $48,000, applied to 2026
  // under the same rule: $48,000 is "$50,000 or less" → monthly.
  assert.equal(depositorStatusFromLookback(2026, [D(12000), D(12000), D(12000), D(12000)]).status, 'monthly');
});

test('the $50,000 line: exactly $50,000.00 is monthly, one cent more is semiweekly', () => {
  assert.equal(LOOKBACK_THRESHOLD_CENTS, 5_000_000);
  // 1,250,000 × 4 = 5,000,000 cents = $50,000.00 → "$50,000 or less" → monthly.
  assert.equal(depositorStatusFromLookback(2026, [1_250_000, 1_250_000, 1_250_000, 1_250_000]).status, 'monthly');
  // 5,000,001 cents → "exceeds $50,000" → semiweekly.
  assert.equal(depositorStatusFromLookback(2026, [1_250_000, 1_250_000, 1_250_000, 1_250_001]).status, 'semiweekly');
});

test('a new employer enters zero for quarters before it started, and is monthly for its first year', () => {
  const r = depositorStatusFromLookback(2026, [0, 0, 0, 0]);
  assert.equal(r.status, 'monthly');
  assert.equal(r.totalCents, 0);
});

test('refusals: a year whose rule is not held, missing quarters, and amounts that are not whole cents', () => {
  for (const year of [2025, 2028]) {
    assert.throws(() => depositorStatusFromLookback(year, [0, 0, 0, 0]), (err) => {
      assert.ok(err instanceof LookbackInputError);
      assert.match(err.message, new RegExp(`A depositor status for ${year} is not worked out here`));
      assert.match(err.message, /Nothing was assumed from another year/);
      return true;
    });
  }
  assert.throws(() => depositorStatusFromLookback(2026, [0, 0, 0]), /Four amounts are needed/);
  assert.throws(() => depositorStatusFromLookback(2026, [0, -1, 0, 0]), /October 1 to December 31, 2024 must be whole cents/);
  assert.throws(() => depositorStatusFromLookback(2026, [0, 0, 10.5, 0]), /January 1 to March 31, 2025 must be whole cents/);
  assert.throws(() => depositorStatusFromLookback(2026, ['ten', 0, 0, 0]), LookbackInputError);
});

/* ── the schedule ────────────────────────────────────────────────────────── */

test('Spruce Co.: Friday paydays in March, none in April → ONE deposit by April 15 and nothing for April', () => {
  // Pub 15: "Spruce Co. must deposit the combined tax liabilities for the March
  // paydays by April 15 ... doesn't have a deposit requirement for April".
  // 2026-04-15 is a Wednesday and not a legal holiday.
  const s = buildDepositSchedule(
    ['2026-03-06', '2026-03-13', '2026-03-20', '2026-03-27'].map((d) => pay(d, 1000)), 'monthly', 2026, LATE);
  assert.equal(s.obligations.length, 1);
  assert.equal(s.obligations[0].period, 'March 2026');
  assert.equal(s.obligations[0].amountDueCents, 400_000); // 4 × $1,000.00
  assert.equal(s.obligations[0].dueDate, '2026-04-15');
  assert.equal(s.obligations[0].kind, 'monthly');
});

test('Green, Inc.: a semiweekly depositor paying Friday May 29, 2026 deposits by Wednesday June 3, 2026', () => {
  const s = buildDepositSchedule([pay('2026-05-29', 5000)], 'semiweekly', 2026, LATE);
  assert.equal(s.obligations[0].dueDate, '2026-06-03');
  assert.equal(s.obligations[0].period, '2026-05-27 to 2026-05-29');
});

test('Elm, Inc.: $40,000 Wednesday + $60,000 Friday accumulate to $100,000 → due Monday May 11; semiweekly from May 9', () => {
  // Pub 15 (2026): "On Wednesday, May 6, ... $40,000. On Friday, May 8, ...
  // $60,000, bringing its total accumulated tax liability to $100,000 ... it
  // became a semiweekly schedule depositor on May 9 ... required to deposit the
  // $100,000 by Monday, May 11, the next business day."
  const s = buildDepositSchedule([pay('2026-05-06', 40000), pay('2026-05-08', 60000), pay('2026-05-20', 10000)],
    'monthly', 2026, LATE);
  const [nextDay, after] = s.obligations;
  assert.equal(nextDay.kind, 'next-day');
  assert.deepEqual(nextDay.paydays, ['2026-05-06', '2026-05-08']);
  assert.equal(nextDay.amountDueCents, 10_000_000);
  assert.equal(nextDay.dueDate, '2026-05-11');
  assert.deepEqual([s.statusChange.from, s.statusChange.to, s.statusChange.effective], ['monthly', 'semiweekly', '2026-05-09']);
  assert.match(s.statusChange.reason, /the rest of 2026 and all of 2027/);
  // The rest of May is semiweekly. Wednesday May 20 closes Friday May 22; the
  // three weekdays after are Mon 25 (Memorial Day), Tue 26, Wed 27 → one extra
  // day → Thursday May 28, the regulation's own Memorial Day example.
  assert.equal(after.kind, 'semiweekly');
  assert.equal(after.dueDate, '2026-05-28');
  assert.equal(after.extraDaysForHolidays, 1);
});

test('Fir Co.: $110,000 Monday is due Tuesday; the $30,000 Tuesday starts anew and is due Friday', () => {
  // Pub 15: "On Monday, Fir Co. accumulates taxes of $110,000 and must deposit
  // this amount on Tuesday ... the $30,000 isn't added to the previous $110,000
  // ... Fir Co. must deposit the $30,000 by Friday". Dated here as the week of
  // Monday 2026-03-09, which holds no legal holiday.
  const s = buildDepositSchedule([pay('2026-03-09', 110000), pay('2026-03-10', 30000)], 'semiweekly', 2026, LATE);
  assert.deepEqual(s.obligations.map((o) => [o.kind, o.amountDueCents, o.dueDate]), [
    ['next-day', 11_000_000, '2026-03-10'],
    ['semiweekly', 3_000_000, '2026-03-13'],
  ]);
  assert.equal(s.statusChange, null, 'already semiweekly: nothing changes');
});

test('$95,000 Tuesday and $10,000 Wednesday are in DIFFERENT periods: no next-day deposit, Friday and Wednesday', () => {
  // Pub 15: "$95,000 must be deposited by Friday and $10,000 must be deposited
  // by the following Wednesday." Tuesday 2026-03-03 → Fri 03-06; Wed 03-04 → Wed 03-11.
  const s = buildDepositSchedule([pay('2026-03-03', 95000), pay('2026-03-04', 10000)], 'semiweekly', 2026, LATE);
  assert.deepEqual(s.obligations.map((o) => [o.kind, o.amountDueCents, o.dueDate]), [
    ['semiweekly', 9_500_000, '2026-03-06'],
    ['semiweekly', 1_000_000, '2026-03-11'],
  ]);
});

test('the One-Day line: $99,999.99 accumulated is not a next-day deposit; $100,000.00 is', () => {
  const under = buildDepositSchedule([{ payDate: '2026-03-02', liabilityCents: 9_999_999 }], 'semiweekly', 2026, LATE);
  assert.equal(under.obligations[0].kind, 'semiweekly');
  const at = buildDepositSchedule([{ payDate: '2026-03-02', liabilityCents: 10_000_000 }], 'semiweekly', 2026, LATE);
  assert.equal(at.obligations[0].kind, 'next-day');
  assert.equal(at.obligations[0].dueDate, '2026-03-03');
});

test('a semiweekly period spanning two quarters is two deposits, both due Wednesday October 7, 2026', () => {
  // Pub 15's own example: "a pay date on Wednesday, September 30, 2026 ... and
  // another pay date on Friday, October 2, 2026 ... two separate deposits ...
  // Both deposits would be due on Wednesday, October 7, 2026."
  const s = buildDepositSchedule([pay('2026-09-30', 3000), pay('2026-10-02', 4000)], 'semiweekly', 2026, LATE);
  assert.deepEqual(s.obligations.map((o) => [o.quarter, o.amountDueCents, o.dueDate]), [
    [3, 300_000, '2026-10-07'], [4, 400_000, '2026-10-07'],
  ]);
});

test('holiday-aware due dates the weekend-only report got wrong', () => {
  // January 2026 liabilities are due the 15th of February: Sunday the 15th rolls
  // to Monday the 16th, which is Washington's Birthday, so Tuesday the 17th.
  // The old report stopped at Monday.
  const monthly = buildDepositSchedule([pay('2026-01-30', 2000)], 'monthly', 2026, LATE);
  assert.equal(monthly.obligations[0].dueDate, '2026-02-17');
  // Friday May 22, 2026 → normally Wednesday May 27; Memorial Day on Monday the
  // 25th adds a day → Thursday May 28. The old report said Wednesday.
  const semi = buildDepositSchedule([pay('2026-05-22', 2000)], 'semiweekly', 2026, LATE);
  assert.equal(semi.obligations[0].dueDate, '2026-05-28');
  // December 2026 → Friday 2027-01-15, read from the DRAFT 2027 list: flagged.
  const dec = buildDepositSchedule([pay('2026-12-18', 2000)], 'monthly', 2026, LATE);
  assert.equal(dec.obligations[0].dueDate, '2027-01-15');
  assert.equal(dec.obligations[0].verified, false);
  assert.match(dec.obligations[0].calendarNote, /early-release draft/);
});

test('a due date in a year the IRS calendar does not hold is refused on its row, in words', () => {
  // Wednesday 2027-12-29 → the Wednesday after, in 2028: no IRS list for 2028.
  const s = buildDepositSchedule([pay('2027-12-29', 2000)], 'semiweekly', 2027, LATE);
  assert.equal(s.obligations[0].dueDate, null);
  assert.match(s.obligations[0].refusal, /There is no list for 2028/);
  assert.equal(s.obligations[0].amountDueCents, 200_000, 'the amount owed is still stated');
});

test('a void that reverses more than its period paid leaves nothing to deposit, and says how that is settled', () => {
  const s = buildDepositSchedule([pay('2026-04-03', 500), pay('2026-04-24', -1500)], 'monthly', 2026, LATE);
  assert.equal(s.obligations[0].liabilityCents, -100_000); // $500.00 − $1,500.00
  assert.equal(s.obligations[0].amountDueCents, 0);
  assert.match(s.obligations[0].note, /How to claim credit for overpayments/);
});

/* ── the $2,500 test ─────────────────────────────────────────────────────── */

test('$2,500 pay-with-return: on the quarter itself once ended, on the prior quarter, never with a next-day deposit', () => {
  assert.equal(DE_MINIMIS_CENTS, 250_000);
  const s = buildDepositSchedule([
    pay('2026-02-27', 2499.99), // Q1: $2,499.99, ended → qualifies on its own total
    pay('2026-05-29', 9000), // Q2: $9,000, but Q1 was under $2,500 → qualifies on the prior quarter
    pay('2026-08-28', 120000), // Q3: a next-day deposit arose → never
    pay('2026-11-27', 2500), // Q4: exactly $2,500.00 is not "less than", and Q3 was not under → deposit
  ], 'semiweekly', 2026, LATE);
  assert.deepEqual(s.quarters.map((q) => [q.quarter, q.payWithReturn]), [[1, true], [2, true], [3, false], [4, false]]);
  assert.match(s.quarters[0].note, /its own total is under \$2,500/);
  assert.match(s.quarters[1].note, /Q1's total in this schedule is under \$2,500/);
  assert.match(s.quarters[2].note, /next-day deposit arose in Q3/);
});

test('a quarter still running never qualifies on its own figure, and an unheld prior quarter is said, not assumed', () => {
  // Today 2026-02-10 is inside Q1; Q4 2025 is not in this schedule.
  const s = buildDepositSchedule([pay('2026-01-30', 100)], 'monthly', 2026, '2026-02-10');
  assert.equal(s.quarters[0].complete, false);
  assert.equal(s.quarters[0].payWithReturn, false);
  assert.match(s.quarters[0].note, /holds no Q4 2025 payroll/);
});

/* ── through the routes ──────────────────────────────────────────────────── */

function makePool(impl) {
  const pool = { calls: [] };
  pool.query = async (sql, params) => {
    pool.calls.push({ sql: String(sql), params });
    return impl ? impl(String(sql), params) : { rows: [], rowCount: 0 };
  };
  return pool;
}
function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.type = () => r; r.set = () => r; r.send = () => r; r.sendFile = () => r;
  return r;
}
const AUTHED = { oidc: { user: { sub: 'user-1' } } };
async function call(pool, method, route, req) {
  const h = createPayrollRoutes({ pool, appPackageDir: path.join(here, '..') }).routes.get(`${method} ${route}`);
  assert.ok(h, `route ${method} ${route} must be registered`);
  const res = makeRes();
  await h({ body: {}, params: {}, query: {}, ...req }, res);
  return res;
}

test('GET /reports/deposits groups the ledger by deposit period with holiday-aware dates, owner-scoped', async () => {
  const pool = makePool((sql) => {
    if (/FROM payroll_company/.test(sql)) return { rows: [{ user_sub: 'user-1', depositor_status: 'monthly' }], rowCount: 1 };
    if (/FROM payroll_run_lines/.test(sql)) {
      return { rows: [{ pay_date: '2026-01-16', liability: '150000' }, { pay_date: '2026-01-30', liability: '150000' }], rowCount: 2 };
    }
    return { rows: [], rowCount: 0 };
  });
  const res = await call(pool, 'get', '/reports/deposits', { ...AUTHED, query: { year: '2026' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.depositorStatus, 'monthly');
  // Two January paydays, one monthly deposit of $3,000.00 due Tuesday February 17.
  assert.deepEqual(res.body.obligations.map((o) => [o.period, o.amountDueCents, o.dueDate]), [['January 2026', 300_000, '2026-02-17']]);
  const ledger = pool.calls.find((c) => /FROM payroll_run_lines/.test(c.sql));
  assert.match(ledger.sql, /l\.user_sub = \$1/);
  assert.deepEqual(ledger.params, ['user-1', 2026]);
});

test('GET /deposits/lookback answers the status, names the quarters, refuses in words, and writes nothing', async () => {
  const pool = makePool();
  const ok = await call(pool, 'get', '/deposits/lookback', { ...AUTHED, query: { year: '2026', q1: '1200000', q2: '1200000', q3: '1200000', q4: '1500000' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.status, 'semiweekly');
  const ask = await call(pool, 'get', '/deposits/lookback', { ...AUTHED, query: { year: '2026' } });
  assert.deepEqual(ask.body.period.map((q) => q.label)[0], 'July 1 to September 30, 2024');
  const bad = await call(pool, 'get', '/deposits/lookback', { ...AUTHED, query: { year: '2026', q1: '1', q2: '2', q3: '-3', q4: '4' } });
  assert.equal(bad.statusCode, 422);
  assert.equal(bad.body.error, 'lookback_input');
  const year = await call(pool, 'get', '/deposits/lookback', { ...AUTHED, query: { year: '2031' } });
  assert.equal(year.statusCode, 422);
  assert.match(year.body.message, /2031 is not worked out here/);
  assert.deepEqual(pool.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql)), []);
});

test('no OIDC sub → 401 before any query, on both deposit routes', async () => {
  for (const route of ['/reports/deposits', '/deposits/lookback']) {
    const pool = makePool();
    const res = await call(pool, 'get', route, { query: { year: '2026' } });
    assert.equal(res.statusCode, 401, `${route} must 401 without a caller`);
    assert.equal(pool.calls.length, 0, `${route} must not touch the database without a caller`);
  }
});
