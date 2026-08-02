/**
 * EFW2 suite — against the COMPILED module.
 *
 * Two things carry the weight here.
 *
 * FIRST, the totals are read back OUT of the finished file rather than compared
 * to the builder's own arithmetic — the pattern the NACHA guards use, because a
 * builder that is wrong the same way twice proves nothing.
 *
 * SECOND, the RW/RT ordering divergence. The RT total fields are not in the
 * same order as the RW money fields they sum: RW runs …Q, C, V, Y, AA, BB, DD,
 * FF while RT runs …Q, DD, C, sick-pay, V, Y, AA, BB, FF. A positional loop
 * swaps DD and C and mis-aligns everything after. The guard gives one employee
 * a DD amount and no C amount and asserts they land in the right places.
 *
 * Layout verified against SSA Publication No. 42-007, EFW2 Tax Year 2025.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 03:40:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — 512-byte record widths and sequence, implied-decimal money encoding, RT totals read back out of the file, the DD/C ordering divergence asserted with distinguishable amounts, reserved ranges proven blank rather than zero-filled, invalid SSNs filed as zeros with a named problem, and the refusal of an unverified tax year naming the document that would unblock it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  EFW2_FIELD_MAPS, EFW2_RECORD_LEN, EFW2_VERIFIED_TAX_YEARS, buildEfw2, efw2UnavailableReason, readEfw2Totals,
} = require('../routes/payroll-efw2.js');

const SUBMITTER = {
  ein: '123456789', userId: 'ABCD1234', name: 'ACME LLC', deliveryAddress: '1 MAIN ST',
  city: 'MIAMI', stateCode: 'FL', zip: '33101', contactName: 'DANA REED',
  contactPhone: '3055550101', contactEmail: 'payroll@example.com',
};
const EMPLOYER = {
  ein: '987654321', name: 'ACME LLC', deliveryAddress: '1 MAIN ST', city: 'MIAMI',
  stateCode: 'FL', zip: '33101', contactName: 'DANA REED',
  contactPhone: '3055550101', contactEmail: 'payroll@example.com',
};
const worker = (over = {}) => ({
  ssn: '123456789', firstName: 'DANA', lastName: 'REED',
  amounts: { wages: 8_000_000, fit: 900_000, ssWages: 8_000_000, ssTax: 496_000, medicareWages: 8_000_000, medicareTax: 116_000 },
  ...over,
});
const build = (employees, year = 2025) => buildEfw2(year, SUBMITTER, EMPLOYER, employees);
const records = (f) => f.content.split('\r\n').filter((l) => l.length > 0);

/* ── structure ───────────────────────────────────────────────────────────── */

test('every record is exactly 512 characters, in the required RA/RE/RW/RT/RF sequence', () => {
  const f = build([worker(), worker({ ssn: '234567891', firstName: 'SAM', lastName: 'PARK' })]);
  assert.equal(f.valid, true, f.problems.join('; '));
  const rows = records(f);
  assert.deepEqual(rows.map((r) => r.slice(0, 2)), ['RA', 'RE', 'RW', 'RW', 'RT', 'RF']);
  for (const [i, r] of rows.entries()) {
    assert.equal(r.length, EFW2_RECORD_LEN, `record ${i + 1} (${r.slice(0, 2)}) is ${r.length} characters`);
  }
  assert.equal(f.employeeCount, 2);
  assert.equal(f.recordCount, 6);
});

test('records are CRLF delimited with no delimiter before the first record', () => {
  const f = build([worker()]);
  assert.equal(f.content.startsWith('RA'), true, 'no leading delimiter');
  assert.equal(f.content.endsWith('\r\n'), true);
  assert.equal(f.content.split('\r\n').filter((l) => l).length, 5);
});

test('money is written in CENTS with the decimal implied, right justified and zero filled', () => {
  const f = build([worker({ amounts: { wages: 5_960 } })]); // $59.60
  const rw = records(f).find((r) => r.startsWith('RW'));
  assert.equal(rw.slice(187, 198), '00000005960', 'RW 188-198 — $59.60 with no punctuation');
  // A money field with nothing to report is zeros, not blanks.
  assert.equal(rw.slice(198, 209), '00000000000', 'RW 199-209 federal income tax withheld');
});

test('reserved ranges are BLANK, not zero filled — the specification distinguishes them', () => {
  const rw = records(build([worker()])).find((r) => r.startsWith('RW'));
  assert.equal(rw.slice(264, 275), ' '.repeat(11), 'RW 265-275 is reserved');
  assert.equal(rw.slice(341, 352), ' '.repeat(11), 'RW 342-352 is reserved');
  assert.equal(rw.slice(396, 407), ' '.repeat(11), 'RW 397-407 is reserved');

  const rt = records(build([worker()])).find((r) => r.startsWith('RT'));
  assert.equal(rt.slice(114, 129), ' '.repeat(15), 'RT 115-129 is reserved');
  assert.equal(rt.slice(219, 234), ' '.repeat(15), 'RT 220-234 is reserved');
});

test('the RE tax jurisdiction code stays BLANK, which is what makes it a plain W-2', () => {
  const re = records(build([worker()])).find((r) => r.startsWith('RE'));
  assert.equal(re.slice(219, 220), ' ',
    'RE 220 blank = W-2; P/V/G/S/N would move wages into the RO record and out of the IRS feed');
  assert.equal(re.slice(2, 6), '2025', 'RE 3-6 tax year');
  assert.equal(re.slice(218, 219), 'R', 'RE 219 employment code — regular 941');
});

/* ── totals, read back out of the file ───────────────────────────────────── */

test('the RT totals are the sums of the RW records, verified by reading the file back', () => {
  const f = build([
    worker({ amounts: { wages: 5_000_000, fit: 600_000, ssWages: 5_000_000, medicareWages: 5_000_000 } }),
    worker({ ssn: '234567891', firstName: 'SAM', lastName: 'PARK',
      amounts: { wages: 3_000_000, fit: 300_000, ssWages: 3_000_000, medicareWages: 3_000_000 } }),
  ]);
  const read = readEfw2Totals(f.content);
  assert.equal(read.rwRecords, 2);
  assert.equal(read.employeeCountRt, 2, 'RT 3-9 counts RW records since the last RE');
  assert.equal(read.employeeCountRf, 2, 'RF 8-16 counts RW records on the whole file');
  assert.equal(read.totals.wages, 8_000_000);
  assert.equal(read.totals.fit, 900_000);
  assert.equal(read.totals.ssWages, 8_000_000);
  assert.equal(read.totals.medicareWages, 8_000_000);
});

test('THE ORDERING DIVERGENCE: DD precedes C in RT but follows it in RW', () => {
  // Distinguishable amounts so a swap cannot pass by coincidence.
  const f = build([worker({
    amounts: {
      wages: 1_000_000, ssWages: 1_000_000, medicareWages: 1_000_000,
      ddHealthCoverage: 1_111_100,
      cGroupTermLife: 2_222_200,
    },
  })]);
  const read = readEfw2Totals(f.content);
  assert.equal(read.totals.ddHealthCoverage, 1_111_100, 'DD must not pick up C\'s amount');
  assert.equal(read.totals.cGroupTermLife, 2_222_200, 'C must not pick up DD\'s amount');

  // And the orders really do diverge — if they did not, this guard is vacuous.
  const { RW_MONEY, RT_TOTALS } = EFW2_FIELD_MAPS;
  assert.ok(RW_MONEY.cGroupTermLife[0] < RW_MONEY.ddHealthCoverage[0], 'in RW, C comes before DD');
  assert.ok(RT_TOTALS.ddHealthCoverage[0] < RT_TOTALS.cGroupTermLife[0], 'in RT, DD comes before C');
});

test('every RW money field has an RT total, keyed identically so neither can drift', () => {
  const { RW_MONEY, RT_TOTALS } = EFW2_FIELD_MAPS;
  assert.deepEqual(Object.keys(RW_MONEY).sort(), Object.keys(RT_TOTALS).sort(),
    'a key in one map and not the other means an amount is collected but never totalled');
  for (const [key, span] of Object.entries(RW_MONEY)) {
    assert.equal(span[1] - span[0] + 1, 11, `RW ${key} must be 11 characters`);
  }
  for (const [key, span] of Object.entries(RT_TOTALS)) {
    assert.equal(span[1] - span[0] + 1, 15, `RT ${key} must be 15 characters`);
  }
});

/* ── what it refuses ─────────────────────────────────────────────────────── */

test('an unverified tax year produces NO FILE and names the document that would unblock it', () => {
  const f = build([worker()], 2026);
  assert.equal(f.valid, false);
  assert.equal(f.content, '', 'nothing is emitted — a guessed layout is worse than none');
  const why = f.problems.join(' ');
  assert.match(why, /tax year 2026/i);
  assert.match(why, /TT \(qualified overtime compensation\) and TP \(cash tips\)/);
  assert.match(why, /26efw2\.pdf/);
  assert.deepEqual(EFW2_VERIFIED_TAX_YEARS, [2025]);
});

test('the refusal explains itself for any unread year, not just 2026', () => {
  assert.match(efw2UnavailableReason(2031), /Publication 42-007 for tax year 2031/);
  assert.match(efw2UnavailableReason(2031), /Verified years: 2025/);
  assert.equal(build([worker()], 2024).valid, false);
});

test('an SSN the SSA cannot accept is filed as zeros and named as a problem', () => {
  const f = build([
    worker({ ssn: '666123456', lastName: 'SIXES' }),
    worker({ ssn: '912345678', lastName: 'NINES' }),
    worker({ ssn: '', lastName: 'MISSING' }),
  ]);
  assert.equal(f.valid, false);
  const rws = records(f).filter((r) => r.startsWith('RW'));
  for (const rw of rws) assert.equal(rw.slice(2, 11), '000000000');
  const why = f.problems.join(' ');
  assert.match(why, /SIXES.*666/);
  assert.match(why, /NINES.*beginning 9/);
  assert.match(why, /MISSING.*no valid SSN/);
});

test('submitter and employer identity are validated before anything is uploaded', () => {
  assert.match(buildEfw2(2025, { ...SUBMITTER, userId: 'SHORT' }, EMPLOYER, [worker()]).problems.join(' '),
    /BSO User ID must be exactly 8 characters/);
  assert.match(buildEfw2(2025, { ...SUBMITTER, contactEmail: '' }, EMPLOYER, [worker()]).problems.join(' '),
    /contact e-mail must not be blank/);
  assert.match(buildEfw2(2025, SUBMITTER, { ...EMPLOYER, ein: '001234567' }, [worker()]).problems.join(' '),
    /may not begin with 00/);
  assert.match(build([]).problems.join(' '), /nothing to file/);
});

test('Medicare wages below Social Security wages plus tips is caught, not uploaded', () => {
  const f = build([worker({
    amounts: { wages: 5_000_000, ssWages: 5_000_000, ssTips: 100_000, medicareWages: 4_000_000 },
  })]);
  assert.equal(f.valid, false);
  assert.match(f.problems.join(' '), /Medicare wages are less than Social Security wages plus tips/);
});

test('the file says plainly that it has not been submitted', () => {
  assert.match(build([worker()]).caveat, /has NOT been submitted/);
  assert.match(build([worker()]).caveat, /AccuWage/);
});
