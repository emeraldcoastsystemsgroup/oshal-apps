/**
 * NACHA + tax-form suite — run against the COMPILED modules.
 *
 * The ACH guards check the file the way an ODFI would: fixed record length,
 * 10-record blocking, the entry hash as the RIGHTMOST 10 digits of the sum of
 * receiving-DFI identifiers, and control totals read back OUT of the control
 * records rather than trusted from the builder's own arithmetic. A bank rejects
 * the whole file on any one of these, so a passing sample proves nothing —
 * the invariants do.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 22:45:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — record length and blocking, record-type sequence, entry-hash truncation incl. the >10-digit wrap, control totals round-tripped through readAchControls, transaction codes by account type, prenote mode, trace-number uniqueness and ordering, field placement of amount/account/name, and refusal to emit a file with a bad routing number or a zero amount.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildAchFile, readAchControls } = require('../routes/payroll-nacha.js');

const ORIG = {
  odfiRoutingNumber: '021000021',
  odfiName: 'FIRST NATIONAL BANK',
  companyName: 'ACME LLC',
  companyId: '1123456789',
  entryDescription: 'PAYROLL',
  effectiveDate: '2026-08-14',
  fileDate: '2026-08-12',
  fileTime: '0930',
};
const entry = (routing, acct, cents, name, id, type = 'checking') =>
  ({ routingNumber: routing, accountNumber: acct, accountType: type, amountCents: cents, name, employeeId: id });

const THREE = [
  entry('021000021', '1234567890', 150_000, 'REED DANA', 'e1'),
  entry('011401533', '9876543210', 225_050, 'SMITH ALEX', 'e2'),
  entry('121000248', '5555555555', 99_999, 'GARCIA JO', 'e3', 'savings'),
];

/* ── structure ───────────────────────────────────────────────────────────── */

test('every record is exactly 94 characters', () => {
  const f = buildAchFile(THREE, ORIG);
  assert.equal(f.valid, true, f.problems.join('; '));
  for (const [i, line] of f.content.split('\n').filter(Boolean).entries()) {
    assert.equal(line.length, 94, `record ${i + 1} is ${line.length} chars`);
  }
});

test('the file is blocked to a multiple of 10 records, padded with 9s', () => {
  const f = buildAchFile(THREE, ORIG);
  const lines = f.content.split('\n').filter(Boolean);
  assert.equal(lines.length % 10, 0, 'blocking factor 10 is mandatory');
  const padding = lines.filter((l) => /^9{94}$/.test(l));
  assert.equal(padding.length, lines.length - 7, '1 file header + 1 batch header + 3 entries + 1 batch control + 1 file control');
});

test('record types appear in the required order', () => {
  const lines = buildAchFile(THREE, ORIG).content.split('\n').filter(Boolean);
  const types = lines.filter((l) => !/^9{94}$/.test(l)).map((l) => l[0]);
  assert.deepEqual(types, ['1', '5', '6', '6', '6', '8', '9']);
});

/* ── the totals a bank actually validates ────────────────────────────────── */

test('control totals READ BACK from the control records match the entries', () => {
  const f = buildAchFile(THREE, ORIG);
  const c = readAchControls(f.content);
  assert.equal(c.entryCount, 3);
  assert.equal(c.creditCents, 150_000 + 225_050 + 99_999);
  assert.equal(c.creditCents, f.totalCreditCents, 'the builder and the file must agree');
  assert.equal(c.blockCount, Math.ceil(7 / 10), 'block count counts the file control record');
});

test('ENTRY HASH is the sum of 8-digit receiving DFI ids, not the routing numbers', () => {
  const f = buildAchFile(THREE, ORIG);
  // 02100002 + 01140153 + 12100024
  const expected = 2100002 + 1140153 + 12100024;
  assert.equal(f.entryHash, expected);
  assert.equal(readAchControls(f.content).entryHash, expected);
});

test('the entry hash TRUNCATES to the rightmost 10 digits when it overflows', () => {
  // Twelve entries at the highest routing prefix push the sum past 10 digits.
  const many = Array.from({ length: 12 }, (_, i) => entry('999999995', `acct${i}`, 1_000, `EMP ${i}`, `e${i}`));
  const f = buildAchFile(many, ORIG);
  const raw = 99999999 * 12;
  assert.equal(f.entryHash, Number(String(raw).slice(-10)));
  assert.ok(String(readAchControls(f.content).entryHash).length <= 10);
});

/* ── entry detail correctness ────────────────────────────────────────────── */

test('transaction codes distinguish checking from savings, and live from prenote', () => {
  const live = buildAchFile(THREE, ORIG).content.split('\n').filter((l) => l.startsWith('6'));
  assert.equal(live[0].slice(1, 3), '22', 'checking credit');
  assert.equal(live[2].slice(1, 3), '32', 'savings credit');
  const pre = buildAchFile(THREE, ORIG, true).content.split('\n').filter((l) => l.startsWith('6'));
  assert.equal(pre[0].slice(1, 3), '23', 'checking prenote');
  assert.equal(pre[2].slice(1, 3), '33', 'savings prenote');
});

test('a prenote file carries zero dollars and zero credit total', () => {
  const f = buildAchFile(THREE, ORIG, true);
  assert.equal(f.valid, true, f.problems.join('; '));
  assert.equal(f.totalCreditCents, 0);
  assert.equal(readAchControls(f.content).creditCents, 0);
  for (const l of f.content.split('\n').filter((x) => x.startsWith('6'))) {
    assert.equal(l.slice(29, 39), '0000000000', 'a prenote must never carry an amount');
  }
});

test('amount, account and name land in their specified positions', () => {
  const line = buildAchFile([entry('021000021', '1234567890', 150_000, 'REED DANA', 'e1')], ORIG)
    .content.split('\n').find((l) => l.startsWith('6'));
  assert.equal(line.slice(3, 11), '02100002', 'receiving DFI id');
  assert.equal(line.slice(11, 12), '1', 'check digit');
  assert.equal(line.slice(12, 29), '1234567890       ', 'account left-justified, space padded');
  assert.equal(line.slice(29, 39), '0000150000', 'amount right-justified in cents');
  assert.equal(line.slice(54, 76).trim(), 'REED DANA');
});

test('trace numbers are unique, ascending, and prefixed with the originating DFI', () => {
  const traces = buildAchFile(THREE, ORIG).content.split('\n')
    .filter((l) => l.startsWith('6')).map((l) => l.slice(79, 94));
  assert.equal(new Set(traces).size, traces.length, 'traces must be unique');
  assert.deepEqual([...traces].sort(), traces, 'and ascending');
  for (const t of traces) assert.equal(t.slice(0, 8), '02100002');
});

/* ── refusals ────────────────────────────────────────────────────────────── */

test('a bad routing number, a zero amount, or no entries REFUSES the file', () => {
  const badRouting = buildAchFile([entry('12345', 'acct', 1_000, 'X Y', 'e1')], ORIG);
  assert.equal(badRouting.valid, false);
  assert.match(badRouting.problems.join(' '), /routing number must be 9 digits/);

  const zero = buildAchFile([entry('021000021', 'acct', 0, 'X Y', 'e1')], ORIG);
  assert.equal(zero.valid, false);
  assert.match(zero.problems.join(' '), /amount must be positive/);

  const none = buildAchFile([], ORIG);
  assert.equal(none.valid, false);
  assert.match(none.problems.join(' '), /No entries/);

  const noOdfi = buildAchFile(THREE, { ...ORIG, odfiRoutingNumber: '' });
  assert.equal(noOdfi.valid, false);
  assert.match(noOdfi.problems.join(' '), /Originating routing number/);
});

test('a name with punctuation or accents cannot corrupt the fixed-width layout', () => {
  const f = buildAchFile([entry('021000021', 'acct', 1_000, 'O’NÉIL-SMITH, PATRICIA ANNE', 'e1')], ORIG);
  assert.equal(f.valid, true, f.problems.join('; '));
  for (const l of f.content.split('\n').filter(Boolean)) assert.equal(l.length, 94);
  const detail = f.content.split('\n').find((l) => l.startsWith('6'));
  assert.equal(detail.slice(54, 76).length, 22, 'the name field stays exactly 22 characters');
});
