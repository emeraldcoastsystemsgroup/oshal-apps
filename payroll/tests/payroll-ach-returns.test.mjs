/**
 * ACH return / NOC suite — against the COMPILED module.
 *
 * FIXTURES ARE BUILT FROM THE POSITION TABLE, never copied from a published
 * worked example. The decks that reproduce the Nacha tables transcribe their
 * own examples at 92 and 93 characters rather than 94, so a fixture copied from
 * one asserts a record a conforming parser would reject — the test would pass
 * while the parser was wrong. `record()` below composes fields by width and
 * asserts the total is exactly 94, so the fixture proves its own shape first.
 *
 * The case with the most money behind it is C03 vs C07. Both write a routing
 * number and an account number into the same 29-byte field, but C03 leaves
 * positions 10-12 BLANK while C07 packs contiguously. Reading C03 with C07's
 * geometry yields an account number three digits short — still numeric, still
 * plausible, and wrong. That is asserted explicitly.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 02:05:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — self-proving 94-character fixtures, return parsing with the R01 stop-initiating exception, NOC decoding for every live change code, the C03/C07 geometry collision, retired C04 refused, unknown codes surfaced rather than thrown, and a round trip proving a trace number written by buildAchFile is the key a return matches on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MAX_REINITIATIONS, RETURN_CODES, mustStopFutureEntries, outcomeFor, parseAchReturnFile,
} = require('../routes/payroll-ach-returns.js');
const { buildAchFile } = require('../routes/payroll-nacha.js');

/** Compose a fixed-width record from [value, width] pairs and prove it is 94. */
function record(...parts) {
  const out = parts.map(([v, w]) => String(v).slice(0, w).padEnd(w, ' ')).join('');
  assert.equal(out.length, 94, `fixture is ${out.length} characters, must be exactly 94`);
  return out;
}

const num = (v, w) => String(v).replace(/\D/g, '').slice(-w).padStart(w, '0');

/** A `6` entry-detail record. */
function detail({ routing = '021000021', account = '1234567890', amountCents = 125_000, id = 'EMP-1', name = 'REED DANA', trace = '021000210000001' } = {}) {
  return record(
    ['6', 1], ['22', 2],
    [routing.slice(0, 8), 8], [routing.slice(8, 9), 1],
    [account, 17], [num(amountCents, 10), 10],
    [id, 15], [name, 22], ['', 2], ['0', 1], [trace, 15],
  );
}

/** A `7` addenda-99 return record. */
function returnAddenda({ code = 'R01', originalTrace = '021000210000001', dateOfDeath = '', originalDfi = '02100002', info = '', trace = '021000210000066' } = {}) {
  return record(
    ['7', 1], ['99', 2], [code, 3], [originalTrace, 15],
    [dateOfDeath, 6], [originalDfi, 8], [info, 44], [trace, 15],
  );
}

/** A `7` addenda-98 notification-of-change record. */
function nocAddenda({ code = 'C01', originalTrace = '021000210000001', originalDfi = '02100002', corrected = '', trace = '021000210000088' } = {}) {
  return record(
    ['7', 1], ['98', 2], [code, 3], [originalTrace, 15],
    ['', 6], [originalDfi, 8], [corrected, 29], ['', 15], [trace, 15],
  );
}

const file = (...records) => `${records.join('\n')}\n`;

/* ── returns ─────────────────────────────────────────────────────────────── */

test('a return is parsed with its code, trace, amount and the person it concerns', () => {
  const parsed = parseAchReturnFile(file(detail(), returnAddenda({ code: 'R03' })));
  assert.equal(parsed.problems.length, 0, parsed.problems.join('; '));
  assert.equal(parsed.returnCount, 1);
  assert.equal(parsed.nocCount, 0);
  assert.equal(parsed.totalReturnedCents, 125_000);

  const [e] = parsed.events;
  assert.equal(e.kind, 'return');
  assert.equal(e.code, 'R03');
  assert.equal(e.originalTrace, '021000210000001', 'the join key back to our payment row');
  assert.equal(e.amountCents, 125_000);
  assert.equal(e.individualName, 'REED DANA');
  assert.equal(e.routingNumber, '021000021');
  assert.equal(e.accountNumber, '1234567890');
  assert.equal(e.reason.title, 'No Account / Unable to Locate Account');
});

test('a RETURN means the employee was NOT paid; an NOC means they WERE', () => {
  const returned = outcomeFor(parseAchReturnFile(file(detail(), returnAddenda({ code: 'R02' }))).events[0]);
  assert.equal(returned.status, 'returned');
  assert.equal(returned.unpaid, true);

  const corrected = outcomeFor(parseAchReturnFile(file(
    detail(), nocAddenda({ code: 'C01', corrected: '9876543210' }),
  )).events[0]);
  assert.equal(corrected.status, 'corrected');
  assert.equal(corrected.unpaid, false, 'an NOC is a correction, not a failure — the money arrived');
  assert.match(corrected.summary, /SUCCEEDED/);
});

test('R01 is the documented EXCEPTION: it does not stop future entries, and may be reinitiated', () => {
  assert.equal(mustStopFutureEntries('R01'), false, 'insufficient funds may be retried');
  assert.equal(RETURN_CODES.R01.reinitiable, true);
  assert.equal(MAX_REINITIATIONS, 2, 'at most twice after the return — three presentments total');

  // Every other code in the two-banking-day stop family does stop entries.
  for (const code of ['R02', 'R03', 'R04', 'R08', 'R29']) {
    assert.equal(mustStopFutureEntries(code), true, `${code} must stop future entries`);
  }
  // As does the 60-calendar-day family.
  for (const code of ['R05', 'R07', 'R10', 'R11', 'R37']) {
    assert.equal(mustStopFutureEntries(code), true, `${code} must stop future entries`);
  }
});

test('date of death is read only for the codes that carry it', () => {
  const dead = parseAchReturnFile(file(detail(), returnAddenda({ code: 'R15', dateOfDeath: '260715' })));
  assert.equal(dead.events[0].dateOfDeath, '260715');
  assert.equal(dead.events[0].reason.category, 'deceased');

  const plain = parseAchReturnFile(file(detail(), returnAddenda({ code: 'R01' })));
  assert.equal(plain.events[0].dateOfDeath, '', 'blank on every other code');
});

test('R17 carries the QUESTIONABLE literal in its addenda information', () => {
  const parsed = parseAchReturnFile(file(detail(), returnAddenda({ code: 'R17', info: 'QUESTIONABLE ORIGIN' })));
  assert.match(parsed.events[0].addendaInformation, /^QUESTIONABLE/);
});

/* ── notifications of change ─────────────────────────────────────────────── */

test('C01 corrects the account number, C02 the routing number, C05 the transaction code', () => {
  const c01 = parseAchReturnFile(file(detail(), nocAddenda({ code: 'C01', corrected: '00099988877' })));
  assert.equal(c01.events[0].correction.accountNumber, '00099988877');
  assert.equal(c01.events[0].correction.autoApplicable, true);

  const c02 = parseAchReturnFile(file(detail(), nocAddenda({ code: 'C02', corrected: '111000025' })));
  assert.equal(c02.events[0].correction.routingNumber, '111000025');
  assert.equal(c02.events[0].correction.accountNumber, undefined, 'C02 changes only the routing number');

  const c05 = parseAchReturnFile(file(detail(), nocAddenda({ code: 'C05', corrected: '32' })));
  assert.equal(c05.events[0].correction.transactionCode, '32');
});

test('THE COLLISION: C03 leaves positions 10-12 blank, C07 packs contiguously', () => {
  // C03: routing 1-9, THREE BLANKS at 10-12, account 13-29 (17 characters).
  const c03Payload = `${'021000021'}${'   '}${'12345678901234567'}`;
  assert.equal(c03Payload.length, 29);
  const c03 = parseAchReturnFile(file(detail(), nocAddenda({ code: 'C03', corrected: c03Payload })));
  assert.equal(c03.events[0].correction.routingNumber, '021000021');
  assert.equal(c03.events[0].correction.accountNumber, '12345678901234567',
    'all seventeen digits — reading this with C07 geometry loses three of them');
  assert.match(c03.events[0].correction.note, /10-12 are deliberately blank/);

  // C07: routing 1-9, account 10-26, transaction code 27-28 — no gap.
  const c07Payload = `${'021000021'}${'98765432109876543'}${'22'}`.padEnd(29, ' ');
  const c07 = parseAchReturnFile(file(detail(), nocAddenda({ code: 'C07', corrected: c07Payload })));
  assert.equal(c07.events[0].correction.routingNumber, '021000021');
  assert.equal(c07.events[0].correction.accountNumber, '98765432109876543');
  assert.equal(c07.events[0].correction.transactionCode, '22');

  // Prove the geometries genuinely differ: the same bytes decode differently.
  const shared = parseAchReturnFile(file(detail(), nocAddenda({ code: 'C07', corrected: c03Payload })));
  assert.notEqual(shared.events[0].correction.accountNumber, '12345678901234567',
    'if C03 and C07 decoded alike, the collision guard would be vacuous');
});

test('C06 puts the transaction code after a three-position gap', () => {
  const payload = `${'55566677788899900'}${'   '}${'32'}`.padEnd(29, ' ');
  const c06 = parseAchReturnFile(file(detail(), nocAddenda({ code: 'C06', corrected: payload })));
  assert.equal(c06.events[0].correction.accountNumber, '55566677788899900');
  assert.equal(c06.events[0].correction.transactionCode, '32');
});

test('retired C04 and IAT-only C08/C14 are surfaced but never auto-applied', () => {
  const c04 = parseAchReturnFile(file(detail(), nocAddenda({ code: 'C04', corrected: 'SMITH JOHN' })));
  assert.equal(c04.events[0].correction.autoApplicable, false);
  assert.match(c04.events[0].correction.note, /2015/);

  for (const code of ['C08', 'C13', 'C14']) {
    const p = parseAchReturnFile(file(detail(), nocAddenda({ code, corrected: 'IAT' })));
    assert.equal(p.events[0].correction.autoApplicable, false, `${code} must not auto-apply`);
  }
});

/* ── the file, and the things that go wrong with it ──────────────────────── */

test('an unknown code is reported, not thrown, and never silently applied', () => {
  const parsed = parseAchReturnFile(file(detail(), returnAddenda({ code: 'R99' })));
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].reason, undefined);
  assert.match(parsed.events[0].problems.join(' '), /Unrecognised return reason code R99/);
  // An unknown return still counts as unpaid — failing safe.
  assert.equal(outcomeFor(parsed.events[0]).unpaid, true);
  assert.equal(outcomeFor(parsed.events[0]).stopFutureEntries, true);

  const noc = parseAchReturnFile(file(detail(), nocAddenda({ code: 'C99' })));
  assert.equal(noc.events[0].correction, undefined);
  assert.match(noc.events[0].problems.join(' '), /Do not apply it blind/);
});

test('a short record and a stray addenda are reported instead of mangling the read', () => {
  const short = parseAchReturnFile(`${detail().slice(0, 80)}\n${returnAddenda()}`);
  assert.match(short.problems.join(' '), /is 80 characters/);

  const orphan = parseAchReturnFile(file(returnAddenda({ code: 'R01' })));
  assert.match(orphan.events[0].problems.join(' '), /No entry-detail record precedes/);
});

test('9-fill block padding and blank lines are ignored, not parsed as records', () => {
  const padded = file(detail(), returnAddenda(), '9'.repeat(94), '9'.repeat(94));
  const parsed = parseAchReturnFile(padded);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.problems.length, 0);
  assert.equal(parseAchReturnFile('').valid, false);
});

test('several people in one file are each matched to their own trace', () => {
  const parsed = parseAchReturnFile(file(
    detail({ trace: '021000210000001', name: 'REED DANA', amountCents: 100_000 }),
    returnAddenda({ code: 'R01', originalTrace: '021000210000001' }),
    detail({ trace: '021000210000002', name: 'PARK SAM', amountCents: 250_000 }),
    returnAddenda({ code: 'R02', originalTrace: '021000210000002' }),
    detail({ trace: '021000210000003', name: 'LI WEN', amountCents: 300_000 }),
    nocAddenda({ code: 'C01', originalTrace: '021000210000003', corrected: '5550001111' }),
  ));
  assert.equal(parsed.returnCount, 2);
  assert.equal(parsed.nocCount, 1);
  assert.equal(parsed.totalReturnedCents, 350_000, 'the NOC amount is NOT returned money');
  assert.deepEqual(parsed.events.map((e) => e.originalTrace),
    ['021000210000001', '021000210000002', '021000210000003']);
});

/* ── the round trip that makes matching possible at all ──────────────────── */

test('ROUND TRIP: a trace written by buildAchFile is the key a return matches on', () => {
  const built = buildAchFile([
    { routingNumber: '021000021', accountNumber: '1234567890', accountType: 'checking', amountCents: 125_000, name: 'REED DANA', employeeId: 'emp-1' },
    { routingNumber: '111000025', accountNumber: '9876543210', accountType: 'checking', amountCents: 250_000, name: 'PARK SAM', employeeId: 'emp-2' },
  ], {
    odfiRoutingNumber: '021000021', odfiName: 'BIG BANK', companyName: 'ACME LLC',
    companyId: '1123456789', entryDescription: 'PAYROLL', effectiveDate: '2026-03-13',
    fileDate: '2026-03-11', fileTime: '0930',
  });
  assert.equal(built.valid, true, built.problems.join('; '));

  // The builder now hands back the traces — without these, nothing below works.
  assert.equal(built.traces.length, 2);
  assert.deepEqual(built.traces.map((t) => t.employeeId), ['emp-1', 'emp-2']);
  const second = built.traces[1];
  assert.equal(second.trace.length, 15);

  // The trace really is the one written into the file's entry detail record.
  const entryLine = built.content.split('\n').filter((l) => l.startsWith('6'))[1];
  assert.equal(entryLine.slice(79, 94), second.trace);

  // The bank returns that entry; we match it straight back to the employee.
  const parsed = parseAchReturnFile(file(
    detail({ trace: '999999990000001', amountCents: second.amountCents }),
    returnAddenda({ code: 'R02', originalTrace: second.trace }),
  ));
  assert.equal(parsed.events[0].originalTrace, second.trace);
  const matched = built.traces.find((t) => t.trace === parsed.events[0].originalTrace);
  assert.equal(matched.employeeId, 'emp-2', 'the return resolves to the right person');
  assert.equal(outcomeFor(parsed.events[0]).unpaid, true);
});
