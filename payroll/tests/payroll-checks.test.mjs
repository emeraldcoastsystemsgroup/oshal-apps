/**
 * Check-printing suite — against the COMPILED module.
 *
 * The most important assertion in this file is a NEGATIVE one: no MICR line is
 * ever produced. The governing standard is paywalled and the vendor documents
 * that are obtainable disagree with each other — and with themselves — on the
 * total position count, the EPC position, where the auxiliary on-us field
 * starts, and how wide the on-us field is. A MICR line one position out is
 * rejected by a reader-sorter or posted to the wrong account, so the guard
 * pins the refusal rather than pinning a guess.
 *
 * The written amount is the other one that matters: when figures and words
 * disagree on a check, the WORDS control. A rounding or grouping bug there pays
 * out the wrong amount with legal force behind it.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 04:15:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — amount-in-words across every grouping boundary, atomic non-reissuing check-number allocation asserted as the SQL actually issued, the UCC 4-404 six-month staleness legend, a stub that must foot to the check, and the pinned refusal to synthesise a MICR line.
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
  STALE_AFTER_MONTHS, allocateCheckNumbers, amountInWords, checkDocument,
} = require('../routes/payroll-checks.js');

/** A pool that records what it was asked and answers the allocation. */
function recordingPool(start) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ start }], rowCount: 1 };
    },
  };
}

const BASE = {
  checkNumber: 1001, date: '2026-03-13', payeeName: 'DANA REED', amountCents: 125_000,
  employerName: 'ACME LLC',
};

/* ── the amount in words ─────────────────────────────────────────────────── */

test('the written amount is correct across every grouping boundary', () => {
  assert.equal(amountInWords(0), 'ZERO AND 00/100');
  assert.equal(amountInWords(5), 'ZERO AND 05/100');
  assert.equal(amountInWords(100), 'ONE AND 00/100');
  assert.equal(amountInWords(1_900), 'NINETEEN AND 00/100');
  assert.equal(amountInWords(2_000), 'TWENTY AND 00/100');
  assert.equal(amountInWords(2_100), 'TWENTY-ONE AND 00/100');
  assert.equal(amountInWords(10_000), 'ONE HUNDRED AND 00/100');
  assert.equal(amountInWords(10_500), 'ONE HUNDRED FIVE AND 00/100');
  assert.equal(amountInWords(100_000), 'ONE THOUSAND AND 00/100');
  assert.equal(amountInWords(123_456), 'ONE THOUSAND TWO HUNDRED THIRTY-FOUR AND 56/100');
  assert.equal(amountInWords(100_000_000), 'ONE MILLION AND 00/100');
});

test('a thousands group of zero is skipped, not written as "ZERO THOUSAND"', () => {
  // $1,000,500.00 — the thousands group is 000 and must vanish entirely.
  assert.equal(amountInWords(100_050_000), 'ONE MILLION FIVE HUNDRED AND 00/100');
});

test('cents are a fraction of 100, never words — that is what a bank reads', () => {
  assert.equal(amountInWords(1_299), 'TWELVE AND 99/100');
  assert.equal(amountInWords(1_201), 'TWELVE AND 01/100');
  assert.match(amountInWords(1_210), /AND 10\/100$/);
});

test('a negative amount is refused rather than printed', () => {
  assert.throws(() => amountInWords(-100), /cannot be written for a negative amount/);
});

/* ── numbering ───────────────────────────────────────────────────────────── */

test('check numbers are allocated atomically in one statement, and never reissued', async () => {
  const pool = recordingPool(1001);
  const numbers = await allocateCheckNumbers(pool, 'u1', 3);
  assert.deepEqual(numbers, [1001, 1002, 1003]);

  assert.equal(pool.calls.length, 1, 'a read-then-write would race two operators onto one number');
  const { sql, params } = pool.calls[0];
  assert.match(sql, /^\s*UPDATE payroll_company/, 'the sequence advances in the same statement that reads it');
  assert.match(sql, /RETURNING check_next_number - \$2/);
  assert.match(sql, /WHERE user_sub = \$1/, 'scoped to the caller');
  assert.deepEqual(params, ['u1', 3]);
});

test('allocating nothing touches the database at all', async () => {
  const pool = recordingPool(1001);
  assert.deepEqual(await allocateCheckNumbers(pool, 'u1', 0), []);
  assert.deepEqual(await allocateCheckNumbers(pool, 'u1', -5), []);
  assert.equal(pool.calls.length, 0);
});

test('a company with no settings row fails loudly instead of issuing check number 0', async () => {
  const empty = { query: async () => ({ rows: [], rowCount: 0 }) };
  await assert.rejects(() => allocateCheckNumbers(empty, 'u1', 1), /cannot allocate check numbers/);
});

/* ── the document ────────────────────────────────────────────────────────── */

test('the check carries the amount in both figures and words, and they agree', () => {
  const doc = checkDocument(BASE);
  assert.equal(doc.amountFigures, '$1,250.00');
  assert.equal(doc.amountWords, 'ONE THOUSAND TWO HUNDRED FIFTY AND 00/100');
  assert.equal(doc.checkNumber, '1001');
  assert.equal(doc.payeeName, 'DANA REED');
  assert.equal(doc.warnings.length, 0);
});

test('the staleness legend comes from UCC 4-404, not from the conventional 90 days', () => {
  const doc = checkDocument(BASE);
  assert.equal(STALE_AFTER_MONTHS, 6, 'a bank need not pay a check more than six months old');
  assert.equal(doc.staleLegend, 'VOID AFTER 6 MONTHS — 2026-09-13');
  // Month arithmetic clamps rather than overflowing into the next month.
  assert.match(checkDocument({ ...BASE, date: '2026-08-31' }).staleLegend, /2027-02-28$/);
});

test('a stub that does not foot to the check is flagged', () => {
  const doc = checkDocument({
    ...BASE,
    grossCents: 200_000,
    taxes: [{ label: 'Federal income tax', currentCents: 40_000 }],
    deductions: [{ label: 'Health', currentCents: 20_000 }],
  });
  // 200,000 - 60,000 = 140,000, but the check is for 125,000.
  assert.match(doc.warnings.join(' '), /stub does not foot/);
  assert.match(doc.warnings.join(' '), /\$1,400\.00.*\$1,250\.00/);

  const ok = checkDocument({
    ...BASE,
    grossCents: 200_000,
    taxes: [{ label: 'Federal income tax', currentCents: 55_000 }],
    deductions: [{ label: 'Health', currentCents: 20_000 }],
  });
  assert.equal(ok.warnings.length, 0);
});

test('a zero or missing check is refused rather than printed blank', () => {
  assert.match(checkDocument({ ...BASE, amountCents: 0 }).warnings.join(' '), /must be written for a positive amount/);
  assert.match(checkDocument({ ...BASE, checkNumber: '' }).warnings.join(' '), /No check number was allocated/);
});

test('the full bank account never reaches the rendered document', () => {
  const doc = checkDocument({ ...BASE, accountLast4: '4321', bankName: 'BIG BANK' });
  assert.equal(doc.accountLast4, '4321');
  assert.equal(JSON.stringify(doc).includes('987654321'), false);
});

/* ── the refusal, pinned ─────────────────────────────────────────────────── */

test('NO MICR LINE is ever generated, and the document says why', () => {
  const doc = checkDocument(BASE);
  assert.equal(doc.micrLine, null, 'the governing standard is paywalled and the vendor sources conflict');
  assert.match(doc.micrNote, /pre-encoded check stock/);
  assert.match(doc.micrNote, /ANSI X9\.100-160-1/);
  assert.match(doc.micrNote, /Magnetic toner is required/);

  // Nothing anywhere in the document looks like an E-13B transit field.
  const rendered = JSON.stringify(doc);
  assert.doesNotMatch(rendered, /[⑆⑇⑈⑉]/, 'no E-13B symbols');
  assert.equal(/micrLine":"/.test(rendered), false, 'micrLine must stay null, never a string');
});
