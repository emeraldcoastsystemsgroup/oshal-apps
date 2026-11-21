/**
 * Hours by the day and the FLSA payroll record — the compiled workweek module,
 * the overtime engine for a workweek two checks share, the earnings route, and
 * the 29 CFR 516.2 record read back from stored rows. Every expected number is
 * worked by hand in the comment above it, from 29 CFR 516.2, 516.5, 516.6 and
 * 778.104 (eCFR, current to 2026-11-18, read on 2026-11-20).
 *
 * What these protect:
 *
 *  - A dated row's workweek is the date's, counted from the employer's fixed
 *    workweek start; a date outside the period, or an undated hour beside dated
 *    ones, is refused in words.
 *  - Overtime in a workweek split across two checks is computed over the whole
 *    workweek (the defect: each check saw only its own share, so 18 + 32 hours
 *    owed no overtime anywhere).
 *  - The record answers each 516.2(a) item from stored rows and names what is
 *    not on file; it reads only, and only the caller's employee.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 3: workweek placement for Sunday and Monday starts and its refusals; the split-workweek premium at one rate, at two rates and after premium already paid; the earlier-check read (owner-scoped, voided and current runs left out); the earnings route storing work dates and refusing in words; the record set from a dated line and an hours-only line with its gaps; the record route (404 for another's employee, reads only); the employee form's record fields.
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
const ww = require('../routes/payroll-workweek.js');
const payrun = require('../routes/payroll-payrun.js');
const { flsaRecords } = require('../routes/payroll-flsa-records.js');

const reg = (workDate, hours, rateCents = 2_000) => ({ code: 'REG', hours, rateCents, amountCents: 0, workweek: 1, workDate });

/* ── the fixed workweek ──────────────────────────────────────────────────── */

test('dated rows take the workweek their date falls in, counted from the workweek start day', () => {
  // Period Monday 2026-06-01 to Sunday 2026-06-14, workweek from Sunday: the first workweek
  // begins Sunday 2026-05-31, so Jun 1-6 → 1, Jun 7-13 → 2, Jun 14 → 3. The typed index is ignored.
  const sunday = ww.assignWorkweeks([reg('2026-06-01', 8), reg('2026-06-08', 8), { ...reg('2026-06-14', 4), workweek: 9 }], '2026-06-01', '2026-06-14', 0);
  assert.deepEqual(sunday.rows.map((r) => r.workweek), [1, 2, 3]);
  assert.deepEqual(sunday.weekStarts, { 1: '2026-05-31', 2: '2026-06-07', 3: '2026-06-14' });
  // From Monday the same dates are weeks 1, 2 and 2.
  const monday = ww.assignWorkweeks([reg('2026-06-01', 8), reg('2026-06-08', 8), reg('2026-06-14', 4)], '2026-06-01', '2026-06-14', 1);
  assert.deepEqual(monday.rows.map((r) => r.workweek), [1, 2, 2]);
  assert.equal(ww.workweekStart('2026-06-14', 1), '2026-06-08');
});

test('a date outside the period, or an undated hour beside dated ones, is refused in words', () => {
  assert.match(ww.assignWorkweeks([reg('2026-06-15', 8)], '2026-06-01', '2026-06-14', 0).refusal,
    /2026-06-15 is not a day of this pay period \(2026-06-01 to 2026-06-14\)/);
  assert.match(ww.assignWorkweeks([reg('2026-06-02', 8), { code: 'REG', hours: 8, rateCents: 2_000, amountCents: 0, workweek: 1 }], '2026-06-01', '2026-06-14', 0).refusal,
    /Give every row of hours the day it was worked/);
  // An amount row (a bonus) may stay undated beside dated hours.
  const ok = ww.assignWorkweeks([reg('2026-06-02', 8), { code: 'BONUS_ND', hours: 0, rateCents: 0, amountCents: 5_000, workweek: 1 }], '2026-06-01', '2026-06-14', 0);
  assert.equal(ok.refusal, '');
});

/* ── overtime in a workweek two checks share (29 CFR 778.104) ────────────── */

test('THE DEFECT: 18 hours on the last check and 32 on this one owe 10 hours of premium in this one', () => {
  // Workweek Sun 2026-06-14 to Sat 06-20. The earlier check paid Jun 14-15: 18 h at $20.00 (straight $360.00).
  // This check, Jun 16-19: 4 × 8 = 32 h at $20.00. Week total 50 h → 10 h over 40 × ($20.00 / 2) = $100.00.
  const rows = [16, 17, 18, 19].map((d) => ({ ...reg(`2026-06-${d}`, 8), workweek: 1 }));
  const alone = payrun.deriveFlsaOvertime(rows);
  assert.deepEqual(alone.premiumRows, [], 'on its own share, 32 hours owe nothing — the old answer');
  const shared = payrun.deriveFlsaOvertime(rows, { 1: { hours: 18, straightCents: 36_000, premiumCents: 0 } }, { 1: '2026-06-14' });
  assert.equal(shared.premiumRows.length, 1);
  assert.equal(shared.premiumRows[0].amountCents, 10_000);
  assert.equal(shared.premiumRows[0].workDate, '2026-06-14', 'the premium carries the workweek, so a later check can see it');
  assert.match(shared.warnings[0], /50 hours worked in the workweek, 18 of them paid on an earlier check/);
});

test('two rates: the regular rate is weighted over the WHOLE workweek', () => {
  // Earlier: 18 h at $20.00 = $360.00. This check: 32 h at $25.00 = $800.00.
  // Regular rate $1,160.00 / 50 h = $23.20; premium 10 h × $11.60 = $116.00.
  const rows = [16, 17, 18, 19].map((d) => ({ ...reg(`2026-06-${d}`, 8, 2_500), workweek: 1 }));
  const r = payrun.deriveFlsaOvertime(rows, { 1: { hours: 18, straightCents: 36_000, premiumCents: 0 } });
  assert.equal(r.premiumRows[0].amountCents, 11_600);
});

test('premium an earlier check already paid for the workweek is not paid twice', () => {
  // Earlier: 45 h at $20.00 ($900.00 straight) and 5 h of premium already paid ($50.00).
  // This check: 10 h at $20.00. Week 55 h → 15 h × $10.00 = $150.00, less $50.00 paid → $100.00.
  const r = payrun.deriveFlsaOvertime([{ ...reg('2026-06-19', 10), workweek: 1 }], { 1: { hours: 45, straightCents: 90_000, premiumCents: 5_000 } });
  assert.equal(r.premiumRows[0].amountCents, 10_000);
  // At 40 hours or fewer in the week nothing is owed.
  assert.deepEqual(payrun.deriveFlsaOvertime([{ ...reg('2026-06-19', 2), workweek: 1 }], { 1: { hours: 38, straightCents: 76_000, premiumCents: 0 } }).premiumRows, []);
});

test('the engine pays the shared-workweek premium on the check', () => {
  const W4 = { filingStatus: 'single', step2: false, dependentsCreditCents: 0, otherIncomeCents: 0, deductionsCents: 0, extraWithholdingCents: 0, exempt: false };
  const OPTS = { periodsPerYear: 24, age: 40, state: { code: 'FL', manualRatePct: 0, allowances: 0 }, ytd: {}, employerTax: { sutaRatePct: 2.7, sutaWageBaseCents: 700_000, futaCreditReductionPct: 0 } };
  const rows = [16, 17, 18, 19].map((d) => ({ ...reg(`2026-06-${d}`, 8), workweek: 1 }));
  const c = payrun.computeCheck(rows, [], W4, { ...OPTS, carriedWorkweeks: { 1: { hours: 18, straightCents: 36_000, premiumCents: 0 } }, weekStarts: { 1: '2026-06-14' } });
  // 32 h × $20.00 = $640.00 straight + $100.00 premium.
  assert.equal(c.grossCents, 74_000);
});

function makePool(impl) {
  const pool = { calls: [] };
  pool.query = async (sql, params) => {
    pool.calls.push({ sql: String(sql), params });
    return impl ? impl(String(sql), params) : { rows: [], rowCount: 0 };
  };
  return pool;
}

test("the earlier checks' share is read owner-scoped, leaving out this run and voided ones", async () => {
  const pool = makePool((sql) => (/FROM payroll_line_earnings e/.test(sql)
    ? { rows: [{ code: 'REG', hours: '8', rate_cents: '2000', amount_cents: '0' }, { code: 'REG', hours: '10', rate_cents: '2000', amount_cents: '0' }], rowCount: 2 }
    : { rows: [], rowCount: 0 }));
  const carried = await ww.carriedWorkweeks(pool, 'user-1', 'emp-1', 'run-2', { 1: '2026-06-14', 2: '2026-06-21' }, '2026-06-16');
  assert.deepEqual(carried, { 1: { hours: 18, straightCents: 36_000, premiumCents: 0 } });
  assert.equal(pool.calls.length, 1, 'only the workweek that began before the period is read');
  const q = pool.calls[0];
  assert.deepEqual(q.params, ['user-1', 'emp-1', 'run-2', '2026-06-14', '2026-06-16']);
  assert.match(q.sql, /e\.user_sub = \$1/);
  assert.match(q.sql, /e\.run_id <> \$3/);
  assert.match(q.sql, /r\.status = 'paid' AND r\.kind <> 'void'/);
  assert.match(q.sql, /NOT EXISTS \(SELECT 1 FROM payroll_runs v/);
});

/* ── through the routes ──────────────────────────────────────────────────── */

function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.type = () => r; r.set = () => r; r.send = () => r; r.sendFile = () => r;
  return r;
}
const AUTHED = { oidc: { user: { sub: 'user-1' } } };
const EMP = 'c3a1f0d2-4b5e-4f6a-8b7c-9d0e1f2a3b4c';
async function call(pool, method, route, req) {
  const h = createPayrollRoutes({ pool, appPackageDir: path.join(here, '..') }).routes.get(`${method} ${route}`);
  assert.ok(h, `route ${method} ${route} must be registered`);
  const res = makeRes();
  await h({ body: {}, params: {}, query: {}, ...req }, res);
  return res;
}
const writes = (pool) => pool.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql));
const RUN = { run_id: 'run-2', user_sub: 'user-1', status: 'draft', kind: 'regular', period_start: '2026-06-16', period_end: '2026-06-30', pay_date: '2026-07-03', pay_frequency: 'semimonthly' };

function earningsPool() {
  return makePool((sql) => {
    if (/FROM payroll_runs WHERE run_id/.test(sql)) return { rows: [RUN], rowCount: 1 };
    if (/FROM payroll_employees WHERE employee_id/.test(sql)) return { rows: [{ employee_id: EMP, user_sub: 'user-1', comp_type: 'hourly', hourly_rate_cents: 2_000, filing_status: 'single' }], rowCount: 1 };
    if (/FROM payroll_company/.test(sql)) return { rows: [{ user_sub: 'user-1', workweek_start_day: 0, state_code: 'FL' }], rowCount: 1 };
    if (/FROM payroll_line_earnings e/.test(sql)) return { rows: [{ code: 'REG', hours: '18', rate_cents: '2000', amount_cents: '0' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
}

test('the earnings route stores each row with its workday, and pays the shared workweek', async () => {
  const pool = earningsPool();
  const rows = [16, 17, 18, 19].map((d) => reg(`2026-06-${d}`, 8));
  const res = await call(pool, 'put', '/runs/:id/lines/:employeeId/earnings', { ...AUTHED, params: { id: 'run-2', employeeId: EMP }, body: { earnings: rows } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const inserts = pool.calls.filter((c) => /INSERT INTO payroll_line_earnings/.test(c.sql));
  assert.ok(inserts.some((c) => c.params.includes('2026-06-16')), 'the workday is stored with the row');
  // 18 h carried + 32 h here → $100.00 premium, stored as a derived row dated to the workweek's Sunday.
  const premium = inserts.find((c) => /derived/.test(c.sql) || c.params.includes('OTP'));
  assert.ok(premium, 'the derived premium row is stored');
  assert.ok(premium.params.includes(10_000) && premium.params.includes('2026-06-14'));
  assert.equal(res.body.check.grossCents, 74_000);
});

test('the earnings route refuses a workday outside the period with 422 and writes nothing', async () => {
  const pool = earningsPool();
  const res = await call(pool, 'put', '/runs/:id/lines/:employeeId/earnings', { ...AUTHED, params: { id: 'run-2', employeeId: EMP }, body: { earnings: [reg('2026-07-01', 8)] } });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error, 'bad_work_date');
  assert.match(res.body.message, /2026-07-01 is not a day of this pay period/);
  assert.deepEqual(writes(pool), []);
});

/* ── the record ───────────────────────────────────────────────────────────── */

const EMP_ROW = { employee_id: EMP, user_sub: 'user-1', first_name: 'Rowan', last_name: 'Sample', name_prefix: 'Ms.', occupation: 'Line cook',
  address_line1: '100 Sample Street', city: 'Sampletown', postal_code: '00000', birth_date: '2008-09-01', comp_type: 'hourly', hourly_rate_cents: 2_000 };
function recordPool(lines, earnings, deductions, emp = EMP_ROW) {
  return makePool((sql, params) => {
    if (/FROM payroll_employees WHERE employee_id/.test(sql)) return { rows: params[0] === EMP ? [emp] : [], rowCount: params[0] === EMP ? 1 : 0 };
    if (/FROM payroll_company/.test(sql)) return { rows: [{ user_sub: 'user-1', workweek_start_day: 0, workweek_start_time: '07:00' }], rowCount: 1 };
    if (/FROM payroll_run_lines l JOIN payroll_runs r/.test(sql)) return { rows: lines, rowCount: lines.length };
    if (/FROM payroll_line_earnings/.test(sql)) return { rows: earnings[params[1]] || [], rowCount: 1 };
    if (/FROM payroll_line_deductions/.test(sql)) return { rows: deductions[params[1]] || [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
}

test('the 516.2 record from a dated line: hours each workday and workweek, rate in the overtime week, pay, deductions', async () => {
  // Paid 2026-06-19 for Jun 1-14: Jun 1-5 9 h a day (45 h, workweek of May 31) and Jun 8-9 8 h (16 h).
  // Week of May 31: 45 h × $20.00 = $900.00 straight, derived premium 5 h × $10.00 = $50.00, regular rate $20.00.
  // Week of Jun 7: 16 h, $320.00, no overtime → no regular rate is recorded for it ((6)(i) only asks in an OT week).
  const day = (d, h) => ({ code: 'REG', hours: String(h), rate_cents: '2000', amount_cents: '0', workweek: 1, work_date: `2026-06-0${d}` });
  const earnings = { 'run-1': [day(1, 9), day(2, 9), day(3, 9), day(4, 9), day(5, 9), day(8, 8), day(9, 8),
    { code: 'OTP', hours: '0', rate_cents: '0', amount_cents: '5000', workweek: 1, work_date: '2026-05-31' }] };
  const line = { run_id: 'run-1', kind: 'regular', pay_date: '2026-06-19', period_start: '2026-06-01', period_end: '2026-06-14', uses_earning_rows: true,
    gross_cents: '127000', net_cents: '100000', fit_cents: '15000', ss_cents: '7874', medicare_cents: '1842', addl_medicare_cents: '0',
    state_cents: '0', reimbursement_cents: '0', pretax_cents: '0', posttax_cents: '2284' };
  const pool = recordPool([line], earnings, { 'run-1': [{ code: 'GARN_SUPPORT', applied_cents: '2000' }] });
  const r = await flsaRecords(pool, 'user-1', EMP, '2026-01-01', '2026-12-31');
  assert.equal(r.employee.name, 'Ms. Rowan Sample');
  assert.equal(r.employee.workweekBegins, 'Sunday at 07:00');
  assert.equal(r.employee.dateOfBirthIfUnder19, '2008-09-01', 'aged 17 on the pay date');
  assert.deepEqual(r.employee.gaps, []);
  const p = r.periods[0];
  assert.deepEqual(p.daily.map((d) => [d.date, d.hours]), [['2026-06-01', 9], ['2026-06-02', 9], ['2026-06-03', 9], ['2026-06-04', 9], ['2026-06-05', 9], ['2026-06-08', 8], ['2026-06-09', 8]]);
  assert.deepEqual(p.workweeks, [
    { start: '2026-05-31', hours: 45, straightTimeCents: 90_000, premiumCents: 5_000, regularRateCents: 2_000 },
    { start: '2026-06-07', hours: 16, straightTimeCents: 32_000, premiumCents: 0, regularRateCents: null },
  ]);
  assert.equal(p.straightTimeCents, 122_000);
  assert.equal(p.premiumCents, 5_000);
  // Itemized support $20.00, and the $2.84 the line deducted that no row itemizes.
  assert.deepEqual(p.additionsAndDeductions.slice(-2), [
    { nature: 'Child / spousal support', amountCents: -2_000 },
    { nature: 'Other deductions on this check (401(k), health, other post-tax)', amountCents: -284 },
  ]);
  assert.equal(p.keepUntil, '2029-06-19', '29 CFR 516.5(a): at least 3 years');
  assert.deepEqual(p.gaps, []);
  assert.deepEqual(writes(pool), [], 'the record reads only');
});

test('an hours-only line and a sparse employee record name what is not on file', async () => {
  const line = { run_id: 'run-9', kind: 'regular', pay_date: '2026-03-06', period_start: '2026-02-16', period_end: '2026-03-01', uses_earning_rows: false,
    hours: '80', ot_hours: '0', gross_cents: '160000', net_cents: '130000', computed: JSON.stringify({ regularCents: 160000, overtimeCents: 0 }), pretax_cents: '0', posttax_cents: '0' };
  const bare = { employee_id: EMP, user_sub: 'user-1', first_name: 'Rowan', last_name: 'Sample', comp_type: 'hourly', hourly_rate_cents: 2_000 };
  const r = await flsaRecords(recordPool([line], {}, {}, bare), 'user-1', EMP, '2026-01-01', '2026-12-31');
  assert.equal(r.periods[0].daily, null);
  assert.match(r.periods[0].gaps[0], /hours were recorded for the pay period, not by workday/);
  assert.equal(r.periods[0].straightTimeCents, 160_000);
  for (const item of ['(2) home address', '(4) occupation', '(4) the title', '(3) date of birth']) {
    assert.ok(r.employee.gaps.some((g) => g.startsWith(item)), `${item} is named`);
  }
});

test("the record route answers only the caller's employee, owner-scoped, and reads only", async () => {
  const pool = recordPool([], {}, {});
  const mine = await call(pool, 'get', '/reports/flsa-records/:employeeId', { ...AUTHED, params: { employeeId: EMP }, query: { from: '2026-01-01', to: '2026-12-31' } });
  assert.equal(mine.statusCode, 200);
  assert.ok(pool.calls.filter((c) => /payroll_/.test(c.sql)).every((c) => /user_sub = \$|user_sub=\$/.test(c.sql)), 'every read carries the owner');
  const other = await call(pool, 'get', '/reports/flsa-records/:employeeId', { ...AUTHED, params: { employeeId: 'someone-else' } });
  assert.equal(other.statusCode, 404);
  assert.deepEqual(writes(pool), []);
});

test("the employee form's record fields are stored, and a title outside the regulation's list is not", async () => {
  const pool = makePool((sql, params) => (/INSERT INTO payroll_employees/.test(sql) ? { rows: [{ employee_id: params[0] }], rowCount: 1 } : { rows: [], rowCount: 0 }));
  const res = await call(pool, 'post', '/employees', { ...AUTHED, body: { firstName: 'Rowan', lastName: 'Sample', namePrefix: 'Dr.', occupation: 'Line cook', addressLine1: '100 Sample Street', city: 'Sampletown', postalCode: '00000' } });
  assert.equal(res.statusCode, 200);
  const insert = pool.calls.find((c) => /INSERT INTO payroll_employees/.test(c.sql));
  const cols = insert.sql.match(/\(([^)]*)\)/)[1].split(',').map((x) => x.trim());
  const value = (col) => insert.params[cols.indexOf(col)];
  assert.equal(value('occupation'), 'Line cook');
  assert.equal(value('name_prefix'), '', '29 CFR 516.2(a)(4) names Mr., Mrs., Miss and Ms. only');
  assert.equal(value('address_line1'), '100 Sample Street');
});
