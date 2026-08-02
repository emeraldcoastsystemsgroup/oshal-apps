/**
 * Florida RT-6 suite — against the COMPILED module with a routing pool stub.
 *
 * The load-bearing assertion is the per-employee wage base. Florida's $7,000 is
 * per person per CALENDAR YEAR, so a quarterly return has to carry each
 * person's year-to-date forward: someone paid $4,000 a quarter is fully taxable
 * in Q1, partly taxable in Q2 and entirely excess afterwards. Computing excess
 * wages company-wide understates the base by roughly the headcount, which is
 * the same trap Form 940 has and the reason both are tested the same way.
 *
 * Figures verified against: FL DOR Reemployment Tax Rate Information (2026
 * minimum 0.1%, maximum 5.4%, initial 2.7%, $7,000 base), RT-6N (line
 * definitions, $25-per-30-days penalty, $5 installment fee, due/penalty-after
 * dates, installment chart), TIP #26ADM-02 (11% for 2026, daily factor
 * 0.000301370), and the import-file specification (SSN validity rules).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 02:55:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — per-employee year-to-date excess wages across the base crossing, rate-bound checking, the reconciliation against SUTA accrued going red on drift, due/penalty-after dates, $25-per-30-days-or-fraction penalty and daily-factor interest, Florida's own SSN validity rules, the e-file threshold, and the refusal to generate an OCR scanline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const STUBS = {
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
};
const origLoad = Module._load;
Module._load = function (r, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, r)) return STUBS[r];
  return origLoad.call(this, r, ...rest);
};
const {
  FL_INITIAL_RATE_PCT, FL_WAGE_BASE_CENTS, formRt6, isValidFloridaSsn, rt6Dates, rt6InstallmentDates,
} = require('../routes/payroll-rt6.js');

/** A pool that answers the wage-detail query and the SUTA-accrual query differently. */
function pool(employees, sutaCents) {
  return {
    query: async (sql) => (/suta_cents/.test(sql)
      ? { rows: [{ suta: sutaCents }], rowCount: 1 }
      : { rows: employees, rowCount: employees.length }),
  };
}

const FL = { state_code: 'FL', suta_rate_pct: 2.7, suta_wage_base_cents: FL_WAGE_BASE_CENTS };
const emp = (id, last, quarter_gross, prior_gross, ssn_last4 = '6789') =>
  ({ employee_id: id, first_name: 'A', last_name: last, ssn_last4, quarter_gross, prior_gross });
const line = (w, n) => w.lines.find((l) => l.line === n);

/* ── the wage base ───────────────────────────────────────────────────────── */

test('the $7,000 base is applied PER EMPLOYEE against year-to-date, not company-wide', async () => {
  // Three people each paid $4,000 this quarter, at different points in their year.
  const rows = [
    emp('a', 'ANDERS', 400_000, 0),        // base untouched  → all taxable
    emp('b', 'BROOKS', 400_000, 400_000),  // $3,000 of base left → $1,000 excess
    emp('c', 'CHEN', 400_000, 900_000),    // base exhausted  → all excess
  ];
  const w = await formRt6(pool(rows, 18_900), 'u1', FL, 2026, 3);

  assert.equal(line(w, '2').valueCents, 1_200_000, 'gross is every dollar paid');
  assert.equal(line(w, '3').valueCents, 500_000, 'excess = 0 + 1,000 + 4,000');
  assert.equal(line(w, '4').valueCents, 700_000, 'taxable = 4,000 + 3,000 + 0');
  assert.equal(line(w, '4').valueCents, line(w, '2').valueCents - line(w, '3').valueCents,
    'line 4 must equal line 2 less line 3');
  // The company-wide shortcut would give 1,200,000 - 700,000 = 500,000 taxable,
  // which happens to collide here; the per-person split is what the rows prove.
  assert.deepEqual(w.employees.map((e) => e.excessWagesCents), [0, 100_000, 400_000]);
});

test('tax due is taxable wages at the rate on file, and reconciles against SUTA accrued', async () => {
  const rows = [emp('a', 'ANDERS', 700_000, 0)];
  const w = await formRt6(pool(rows, 18_900), 'u1', FL, 2026, 1);
  assert.equal(line(w, '5').valueCents, 18_900, '700,000 × 2.7%');
  assert.equal(w.reconciles, true, w.reconciliation);
});

test('the reconciliation goes RED when the ledger disagrees, and says by how much', async () => {
  const rows = [emp('a', 'ANDERS', 700_000, 0)];
  const w = await formRt6(pool(rows, 12_000), 'u1', FL, 2026, 1);
  assert.equal(w.reconciles, false);
  assert.match(w.reconciliation, /difference of 69\.00/);
  assert.match(w.reconciliation, /Reconcile before filing/);
});

/* ── the rate ────────────────────────────────────────────────────────────── */

test("a rate outside Florida's published 2026 range is flagged, not silently used", async () => {
  const rows = [emp('a', 'ANDERS', 100_000, 0)];
  const high = await formRt6(pool(rows, 0), 'u1', { ...FL, suta_rate_pct: 6.0 }, 2026, 1);
  assert.equal(high.rateWithinBounds, false);
  assert.match(high.warnings.join(' '), /outside Florida's 2026 range of 0.1% to 5.4%/);
  // It still computes at the rate on file rather than substituting one.
  assert.equal(line(high, '5').valueCents, 6_000);

  const ok = await formRt6(pool(rows, 2_700), 'u1', FL, 2026, 1);
  assert.equal(ok.rateWithinBounds, true);
  assert.equal(FL_INITIAL_RATE_PCT, 2.7, 'a new Florida employer starts at 2.7%');
});

test('a non-Florida company is warned that the RT-6 does not describe its obligation', async () => {
  const w = await formRt6(pool([emp('a', 'ANDERS', 100_000, 0)], 2_700), 'u1',
    { ...FL, state_code: 'GA' }, 2026, 1);
  assert.match(w.warnings.join(' '), /work state is GA, not FL/);
});

/* ── dates, penalty and interest ─────────────────────────────────────────── */

test('the return is due the 1st of the month after the quarter, late after the last day', () => {
  assert.deepEqual(rt6Dates(2026, 1), { dueDate: '2026-04-01', penaltyAfter: '2026-04-30' });
  assert.deepEqual(rt6Dates(2026, 2), { dueDate: '2026-07-01', penaltyAfter: '2026-07-31' });
  assert.deepEqual(rt6Dates(2026, 3), { dueDate: '2026-10-01', penaltyAfter: '2026-10-31' });
  assert.deepEqual(rt6Dates(2026, 4), { dueDate: '2027-01-01', penaltyAfter: '2027-01-31' });
});

test('a penalty-after date on a weekend is reported AS THE STATUTE READS, with a caveat', async () => {
  // 2026-10-31 is a Saturday. Florida's weekend treatment of a postmark
  // deadline is not in any retrieved document, and the IRS calendar is the
  // wrong authority for a state date — so the date is not silently moved.
  const w = await formRt6(pool([emp('a', 'ANDERS', 100_000, 0)], 2_700), 'u1', FL, 2026, 3);
  assert.equal(w.penaltyAfter, '2026-10-31');
  assert.match(w.warnings.join(' '), /falls on a weekend/);
  assert.match(w.warnings.join(' '), /File by the preceding business day/);

  // A weekday deadline gets no such warning.
  const q2 = await formRt6(pool([emp('a', 'ANDERS', 100_000, 0)], 2_700), 'u1', FL, 2026, 2);
  assert.equal(q2.penaltyAfter, '2026-07-31');
  assert.doesNotMatch(q2.warnings.join(' '), /falls on a weekend/);
});

test('the late penalty is $25 for each 30 days OR FRACTION — one day late costs the full $25', async () => {
  const rows = [emp('a', 'ANDERS', 700_000, 0)];
  const oneDay = await formRt6(pool(rows, 18_900), 'u1', FL, 2026, 1, { filedOn: '2026-05-01' });
  assert.equal(line(oneDay, '6').valueCents, 2_500, 'a fraction of 30 days is a whole block');

  const thirtyOne = await formRt6(pool(rows, 18_900), 'u1', FL, 2026, 1, { filedOn: '2026-05-31' });
  assert.equal(line(thirtyOne, '6').valueCents, 5_000, 'day 31 starts the second block');

  const onTime = await formRt6(pool(rows, 18_900), 'u1', FL, 2026, 1, { filedOn: '2026-04-30' });
  assert.equal(line(onTime, '6').valueCents, 0, 'filed by the penalty-after date is not late');
  assert.equal(line(onTime, '7').valueCents, 0, 'and accrues no interest');
});

test('interest is the 2026 daily factor applied to the tax due, per day late', async () => {
  const rows = [emp('a', 'ANDERS', 700_000, 0)];
  const w = await formRt6(pool(rows, 18_900), 'u1', FL, 2026, 1, { filedOn: '2026-05-31' });
  // 18,900 cents × 0.000301370 × 31 days.
  assert.equal(line(w, '7').valueCents, Math.round(18_900 * 0.000301370 * 31));
});

test('line 9a totals lines 5 + 6 + 7 + 8, and the $5 fee only applies on an installment election', async () => {
  const rows = [emp('a', 'ANDERS', 700_000, 0)];
  const plain = await formRt6(pool(rows, 18_900), 'u1', FL, 2026, 1);
  assert.equal(line(plain, '8').valueCents, 0);
  assert.equal(line(plain, '9a').valueCents, 18_900);

  const inst = await formRt6(pool(rows, 18_900), 'u1', FL, 2026, 1, { installment: true });
  assert.equal(line(inst, '8').valueCents, 500);
  assert.equal(line(inst, '9a').valueCents, 19_400);
  assert.equal(line(inst, '9b').valueCents, line(inst, '9a').valueCents);
  assert.equal(
    line(inst, '9a').valueCents,
    ['5', '6', '7', '8'].reduce((a, n) => a + line(inst, n).valueCents, 0),
  );
});

test('the installment schedule shrinks with the quarter, and Q4 has none', () => {
  assert.equal(rt6InstallmentDates(2026, 1).length, 4);
  assert.equal(rt6InstallmentDates(2026, 2).length, 3);
  assert.equal(rt6InstallmentDates(2026, 3).length, 2);
  assert.deepEqual(rt6InstallmentDates(2026, 4), []);
  assert.equal(rt6InstallmentDates(2026, 3)[0], '2026-10-31');
});

/* ── employee detail and its penalties ───────────────────────────────────── */

test("Florida's SSN rules are stricter than nine digits", () => {
  assert.equal(isValidFloridaSsn('123456789'), true);
  assert.equal(isValidFloridaSsn('000123456'), false, 'may not begin 000');
  assert.equal(isValidFloridaSsn('666123456'), false, 'may not begin 666');
  assert.equal(isValidFloridaSsn('900123456'), false, 'may not begin 9');
  assert.equal(isValidFloridaSsn('123004567'), false, 'middle pair may not be 00');
  assert.equal(isValidFloridaSsn('123450000'), false, 'may not end 0000');
  assert.equal(isValidFloridaSsn('000000000'), false);
  assert.equal(isValidFloridaSsn('12345678'), false, 'must be nine digits');
});

test('a missing SSN is flagged WITH the 30-day abatement window, not as an unconditional penalty', async () => {
  const rows = [emp('a', 'ANDERS', 100_000, 0, ''), emp('b', 'BROOKS', 100_000, 0)];
  const w = await formRt6(pool(rows, 5_400), 'u1', FL, 2026, 1);
  const warned = w.warnings.join(' ');
  assert.match(warned, /1 employee record\(s\) have a missing or structurally invalid/);
  assert.match(warned, /waived if a complete report is filed within 30 days/);
  assert.match(warned, /not more than once in any twelve-month period/);
});

test('ten or more employees triggers the mandatory electronic-filing warning', async () => {
  const nine = Array.from({ length: 9 }, (_, i) => emp(`e${i}`, `N${i}`, 100_000, 0));
  assert.equal((await formRt6(pool(nine, 24_300), 'u1', FL, 2026, 1)).mustFileElectronically, false);

  const ten = [...nine, emp('e9', 'N9', 100_000, 0)];
  const w = await formRt6(pool(ten, 27_000), 'u1', FL, 2026, 1);
  assert.equal(w.mustFileElectronically, true);
  assert.equal(w.employeeCount, 10);
  assert.match(w.warnings.join(' '), /must be filed and paid electronically/);
});

/* ── what it deliberately refuses to do ──────────────────────────────────── */

test('the worksheet says it is not a filed return and does NOT invent an OCR scanline', async () => {
  const w = await formRt6(pool([emp('a', 'ANDERS', 100_000, 0)], 2_700), 'u1', FL, 2026, 1);
  assert.match(w.caveat, /not a filed return/i);
  assert.match(w.caveat, /does NOT generate the payment coupon's OCR scanline/);
  assert.equal(w.period, '2026 Q1 (2026-01-01 to 2026-03-31)');
  assert.match(w.form, /RT-6/);
});
