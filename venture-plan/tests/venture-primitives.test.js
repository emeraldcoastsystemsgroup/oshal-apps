/**
 * Guards for the money, rate, time and allocation primitives.
 *
 * These are the arithmetic every other engine module is built on, so a defect
 * here is a defect in every figure the app prints. The three that matter most:
 * half-up rounding must be symmetric around zero (JavaScript's `Math.round` is
 * not), a zero divisor must yield null rather than Infinity, and an allocation
 * must sum EXACTLY to its total for any weights — including negative totals,
 * zero weights, and more weights than there are micros to go round.
 *
 * Dependency-free `node --test` suite over the COMPILED module.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — symmetric half-up rounding, the applyBps/grossUpBps round trip, null-not-Infinity division, exact-sum allocation over adversarial weight sets with deterministic tie-breaking, the overflow throw, and calendar arithmetic across year boundaries.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { engine } = require('./fixture-venture');

const P = engine('venture-primitives');

test('half-up rounds AWAY FROM ZERO on both sides — Math.round(-0.5) is -0 and that would break every signed waterfall', () => {
  assert.equal(P.roundHalfUp(0.5), 1);
  assert.equal(P.roundHalfUp(-0.5), -1);
  assert.equal(P.roundHalfUp(1.5), 2);
  assert.equal(P.roundHalfUp(-1.5), -2);
  assert.equal(P.roundHalfUp(2.4999), 2);
  assert.equal(P.roundHalfUp(-2.4999), -2);
  // The symmetry is the point: a -$0.005 fee and a +$0.005 fee must round to the
  // same magnitude or the deductions stop summing to the total.
  assert.equal(P.roundHalfUp(-0.5) + P.roundHalfUp(0.5), 0);
});

test('dollars and cents convert to micros exactly at the sub-cent scale a BOM needs', () => {
  assert.equal(P.dollarsToMicros(1), 1_000_000);
  assert.equal(P.dollarsToMicros(0.0034), 3400); // the fastener that rounds to $0.00 in cents
  assert.equal(P.centsToMicros(1), 10_000);
  assert.equal(P.microsToCents(3400), 0); // and that is exactly why the engine does not use cents
  assert.equal(P.microsToCents(15_873_650), 1587);
});

test('applyBps is the only route from a contractual rate to money, and grossUpBps inverts it', () => {
  assert.equal(P.applyBps(1_000_000, 1500), 150_000); // 15% of $1.00
  assert.equal(P.applyBps(49_990_000, 290), 1_449_710); // hand: 49,990,000 x 290 / 10,000
  // grossUpBps(m, bps) answers "what base leaves m after bps comes off".
  const base = P.grossUpBps(850_000, 1500);
  assert.equal(base, 1_000_000);
  assert.equal(P.subMicros(base, P.applyBps(base, 1500)), 850_000);
  assert.throws(() => P.grossUpBps(1_000_000, 10_000), P.VentureOverflowError);
});

test('divMicros returns null at a zero divisor — never Infinity, never NaN, never a silent zero', () => {
  assert.equal(P.divMicros(1_000_000, 0), null);
  assert.equal(P.divMicros(1_000_000, Number.NaN), null);
  assert.equal(P.divMicros(1_000_000, 3), 333_333);
  assert.equal(P.bpsOf(1, 0), null);
  assert.equal(P.bpsOf(250_000, 1_000_000), 2500);
});

test('allocateMicros sums EXACTLY to the total over adversarial weight sets', () => {
  const cases = [
    { total: 1_000_000, weights: [1, 1, 1] },
    { total: 1_000_001, weights: [1, 1, 1] },
    { total: -1_000_001, weights: [1, 1, 1] },
    { total: 7, weights: [0.15, 0.3, 0.35, 0.2] },
    { total: 5, weights: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { total: -5, weights: [3, 0, 1] },
    { total: 3, weights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }, // more weights than micros
    { total: 0, weights: [5, 5] },
    { total: 999_999_999, weights: [7, 11, 13, 17, 19] },
  ];
  for (const c of cases) {
    const out = P.allocateMicros(c.total, c.weights);
    assert.equal(out.length, c.weights.length, `length for ${JSON.stringify(c)}`);
    assert.equal(out.reduce((a, b) => a + b, 0), c.total, `exact sum for ${JSON.stringify(c)}`);
    assert.ok(out.every(Number.isInteger), `integers for ${JSON.stringify(c)}`);
  }
  assert.deepEqual(P.allocateMicros(100, []), []);
});

test('allocateMicros breaks remainder ties by ascending index, so the result is identical across runs', () => {
  const a = P.allocateMicros(10, [1, 1, 1, 1]);
  const b = P.allocateMicros(10, [1, 1, 1, 1]);
  assert.deepEqual(a, b);
  // Four equal weights, 10 micros: the first two carry the extra micro each.
  assert.deepEqual(a, [3, 3, 2, 2]);
});

test('overflow throws loudly rather than silently losing precision', () => {
  assert.throws(() => P.addMicros(P.MAX_SAFE_MICROS, P.MAX_SAFE_MICROS), P.VentureOverflowError);
  assert.throws(() => P.scaleMicros(P.MAX_SAFE_MICROS, 2), P.VentureOverflowError);
  assert.throws(() => P.assertRepresentable(Infinity, 'test'), P.VentureOverflowError);
});

test('a 50,000-unit roll-up does not drift: integer micros multiply back exactly', () => {
  // The float failure this guards: 0.0034 * 50000 in floating point is
  // 169.99999999999997, and a plan built on that does not tie.
  const unit = P.dollarsToMicros(0.0034);
  const extended = P.scaleMicros(unit, 50_000);
  assert.equal(extended, 170_000_000); // exactly $170.00
  assert.equal(P.divMicros(extended, 50_000), unit);
  // And the same over a 15-line bill of materials summed 50,000 times.
  const lines = [3400, 4_000_000, 125_000, 87_500, 1_250_000, 900, 45_000];
  const perUnit = P.addMicros(...lines);
  assert.equal(P.divMicros(P.scaleMicros(perUnit, 50_000), 50_000), perUnit);
});

test('calendar arithmetic crosses year boundaries and rejects a malformed month', () => {
  assert.equal(P.ymAdd('2026-10', 3), '2027-01');
  assert.equal(P.ymAdd('2026-02', -3), '2025-11');
  assert.equal(P.ymDiff('2027-01', '2026-10'), 3);
  assert.equal(P.ymDiff('2026-10', '2027-01'), -3);
  assert.equal(P.ymCompare('2026-10', '2026-10'), 0);
  assert.deepEqual(P.ymRange('2026-11', 3), ['2026-11', '2026-12', '2027-01']);
  assert.throws(() => P.ymParts('2026-13'), RangeError);
  assert.throws(() => P.ymParts('202610'), RangeError);
});

test('lead time ceils to months and net terms round to nearest — one stated policy each', () => {
  // 21 weeks is 4.85 months. Flooring it would let a schedule claim a window it misses.
  assert.equal(P.ymAddWeeksCeil('2026-03', 21), '2026-08');
  assert.equal(P.ymAddWeeks('2026-03', 21), '2026-07');
  assert.equal(P.monthsForDays(30), 1);
  assert.equal(P.monthsForDays(60), 2);
  assert.equal(P.monthsForDays(0), 0);
  assert.equal(P.monthsForDays(2), 0);
});

test('formatUsd is presentation only and parenthesises negatives the way accounting does', () => {
  assert.equal(P.formatUsd(15_873_650), '$15.87');
  assert.equal(P.formatUsd(-23_808_547_800), '($23,808.55)');
  assert.equal(P.formatUsd(1_234_567_890, { cents: false }), '$1,235');
});

test('safeNumber keeps NaN, Infinity and out-of-range values out of the arithmetic', () => {
  assert.equal(P.safeNumber('abc', 7), 7);
  assert.equal(P.safeNumber(Infinity, 7), 7);
  assert.equal(P.safeNumber(-5, 0, 0, 10), 0);
  assert.equal(P.safeNumber(50, 0, 0, 10), 10);
  assert.equal(P.safeNumber('3.5', 0), 3.5);
});
