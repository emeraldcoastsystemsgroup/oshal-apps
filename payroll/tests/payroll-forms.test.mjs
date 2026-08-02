/**
 * Tax-form worksheet suite — 941, 940 and the W-2, against the COMPILED modules
 * with a stubbed pool.
 *
 * The point of these guards is that a form line is not a rename of a total. Line
 * 5a wants Social Security WAGES times the COMBINED 12.4% — computing it from
 * the tax actually withheld would hide an under-withholding error instead of
 * surfacing it, so the tests assert the rate is applied to the wage base and that
 * the reconciliation notices when the two disagree.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 23:15:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — 941 lines 1/2/3/5a-5e/6 at statutory combined rates with the reconciliation catching a deliberate mismatch, 940 per-EMPLOYEE wage-base exclusion (the company-wide shortcut under-states it), and W-2 issuability computed from identity with box 3 capped at the wage base.
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
const { form941, form940, w2Document } = require('../routes/payroll-forms.js');

const pool = (rows) => ({ query: async () => ({ rows: Array.isArray(rows) ? rows : [rows], rowCount: 1 }) });
const line = (w, n) => w.lines.find((l) => l.line === n);

/* ── Form 941 ────────────────────────────────────────────────────────────── */

test('941 line 5a applies the COMBINED 12.4% to SS WAGES, not to the tax withheld', async () => {
  const ssWages = 10_000_000; // $100,000
  const w = await form941(pool({
    employees: 4, wages: 12_000_000, fit: 1_500_000, ss_wages: ssWages, tips: 0,
    medicare_wages: 12_000_000, addl_withheld: 0,
    fica_actual: Math.round(ssWages * 0.124) + Math.round(12_000_000 * 0.029),
  }), 'u1', 2026, 3);
  assert.equal(line(w, '5a').valueCents, Math.round(ssWages * 0.124));
  assert.equal(line(w, '5c').valueCents, Math.round(12_000_000 * 0.029), 'Medicare is 2.9% combined');
  assert.equal(line(w, '6').valueCents, 1_500_000 + line(w, '5e').valueCents, 'line 6 = line 3 + line 5e');
  assert.equal(w.reconciles, true, w.reconciliation);
});

test('941 line 5d is the additional Medicare wages at 0.9%, employee-only', async () => {
  const addlWithheld = 4_500; // 0.9% of $5,000 of excess wages
  const w = await form941(pool({
    employees: 1, wages: 25_000_000, fit: 5_000_000, ss_wages: 18_450_000, tips: 0,
    medicare_wages: 25_000_000, addl_withheld: addlWithheld,
    fica_actual: Math.round(18_450_000 * 0.124) + Math.round(25_000_000 * 0.029) + addlWithheld,
  }), 'u1', 2026, 4);
  assert.equal(line(w, '5d').valueCents, addlWithheld, 'the 0.9% has no employer share to double');
  assert.match(line(w, '5d').note, /no employer share/i);
});

test('941 RECONCILIATION catches a mismatch instead of reporting a confident total', async () => {
  // FICA actually withheld is far below what the wages imply — a wage base or
  // threshold was applied inconsistently, and the worksheet must say so.
  const w = await form941(pool({
    employees: 2, wages: 10_000_000, fit: 1_000_000, ss_wages: 10_000_000, tips: 0,
    medicare_wages: 10_000_000, addl_withheld: 0, fica_actual: 100,
  }), 'u1', 2026, 1);
  assert.equal(w.reconciles, false);
  assert.match(w.reconciliation, /differs/);
});

test('941 line 1 is an employee COUNT, and the worksheet says it is not a filing', async () => {
  const w = await form941(pool({
    employees: 7, wages: 1, fit: 0, ss_wages: 0, tips: 0, medicare_wages: 0,
    addl_withheld: 0, fica_actual: 0,
  }), 'u1', 2026, 2);
  assert.equal(line(w, '1').valueCents, 7);
  assert.match(line(w, '1').note, /COUNT/);
  assert.match(w.caveat, /not a filed return/i);
  assert.equal(w.period, '2026 Q2 (2026-04-01 to 2026-06-30)');
});

/* ── Form 940 ────────────────────────────────────────────────────────────── */

test('940 excludes wages over $7,000 PER EMPLOYEE — the company-wide shortcut under-states it', async () => {
  // Three employees at $20,000 each. Taxable is 3 x $7,000 = $21,000, NOT
  // $60,000 - $7,000. Getting this wrong understates FUTA by a factor of ~4.
  const rows = [
    { employee_id: 'a', wages: 2_000_000, futa: 4_200 },
    { employee_id: 'b', wages: 2_000_000, futa: 4_200 },
    { employee_id: 'c', wages: 2_000_000, futa: 4_200 },
  ];
  const w = await form940(pool(rows), 'u1', 2026);
  assert.equal(line(w, '3').valueCents, 6_000_000);
  assert.equal(line(w, '5').valueCents, 3 * (2_000_000 - 700_000), 'excess computed per person');
  assert.equal(line(w, '7').valueCents, 2_100_000, 'three full wage bases');
  assert.equal(line(w, '8').valueCents, Math.round(2_100_000 * 0.006));
  assert.equal(w.reconciles, true, w.reconciliation);
});

test('940 taxes an employee under the base on their full wages', async () => {
  const w = await form940(pool([{ employee_id: 'a', wages: 300_000, futa: 1_800 }]), 'u1', 2026);
  assert.equal(line(w, '5').valueCents, 0, 'nothing to exclude below the base');
  assert.equal(line(w, '7').valueCents, 300_000);
  assert.equal(line(w, '8').valueCents, 1_800);
});

test('940 notes that 0.006 assumes the full state credit', async () => {
  const w = await form940(pool([{ employee_id: 'a', wages: 700_000, futa: 4_200 }]), 'u1', 2026);
  assert.match(line(w, '8').note, /credit-reduction state owes more/i);
});

/* ── W-2 ─────────────────────────────────────────────────────────────────── */

const TOTALS = {
  b1: 8_000_000, b2: 900_000, b3: 8_000_000, b4: 496_000, b5: 8_000_000,
  b6: 116_000, b7: 0, b17: 0, d: 400_000, tt: 25_000,
};
const COMPANY = { legal_name: 'Acme LLC', company_name: 'Acme', address_line1: '1 Main', city: 'Miami', state_code: 'FL', postal_code: '33101' };
const EMP = { employee_id: 'e1', first_name: 'Dana', last_name: 'Reed', address_line1: '2 Oak', city: 'Miami', state_code: 'FL', postal_code: '33101' };

test('a W-2 is ISSUABLE only when the identity the form requires is on file', async () => {
  const missing = await w2Document(pool(TOTALS), 'u1', EMP, COMPANY, 2026, { ssn: null, ein: null });
  assert.equal(missing.issuable, false);
  assert.deepEqual(missing.missing.sort(), ['employee SSN', 'employer EIN']);

  const ready = await w2Document(pool(TOTALS), 'u1', EMP, COMPANY, 2026, { ssn: '123456789', ein: '987654321' });
  assert.equal(ready.issuable, true, `still missing: ${ready.missing.join(', ')}`);
  assert.equal(ready.employee.ssn, '123-45-6789', 'formatted for the form');
  assert.equal(ready.employer.ein, '98-7654321');
});

test('W-2 box 3 is capped at the Social Security wage base', async () => {
  const over = await w2Document(pool({ ...TOTALS, b3: 30_000_000 }), 'u1', EMP, COMPANY, 2026,
    { ssn: '123456789', ein: '987654321' });
  assert.equal(over.boxes[3], 18_450_000, 'box 3 can never exceed the 2026 wage base');
  assert.equal(over.boxes[5], 8_000_000, 'box 5 has no cap');
});

test('W-2 box 12 carries only the codes with a value, and TT is the OT premium', async () => {
  const doc = await w2Document(pool(TOTALS), 'u1', EMP, COMPANY, 2026, { ssn: '123456789', ein: '987654321' });
  const codes = doc.box12.map((c) => c.code).sort();
  assert.deepEqual(codes, ['D', 'TT'], 'TP is absent because tips were zero');
  assert.equal(doc.box12.find((c) => c.code === 'TT').amountCents, 25_000);
  assert.match(doc.box12.find((c) => c.code === 'TT').label, /premium only/i);
});

test('a mid-year switch W-2 says prior-provider wages are EXCLUDED', async () => {
  const doc = await w2Document(pool(TOTALS), 'u1', { ...EMP, prior_ytd_year: 2026 }, COMPANY, 2026,
    { ssn: '123456789', ein: '987654321' });
  assert.match(doc.caveat, /previous provider issues its own W-2/i);
});
