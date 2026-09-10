/**
 * Guards for the odds math. Every number this package publishes passes through these functions, so
 * a silent error here is a silent error everywhere — and most of it is the kind of arithmetic that
 * looks right while being wrong by exactly the vig.
 *
 * Run from the package root: node --test "tests/*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — American-odds conversions, the de-vig invariant, normal CDF accuracy, margin-to-probability symmetry, the Kelly refusal on negative-EV prices, and closing-line value sign.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MARGIN_SIGMA, MAX_STAKE_FRACTION, closingLineValue, coverProbability, decimalOdds, devigTwoWay,
  expectedValue, impliedProbability, kellyFraction, normalCdf, winProbabilityFromMargin,
} = require('../routes/sports-odds.js');

test('American odds convert to the probabilities a book quotes', () => {
  assert.ok(Math.abs(impliedProbability(-150) - 0.6) < 1e-9);
  assert.ok(Math.abs(impliedProbability(+150) - 0.4) < 1e-9);
  assert.ok(Math.abs(impliedProbability(-110) - 0.5238095) < 1e-6);
  assert.ok(Number.isNaN(impliedProbability(0)), 'zero is not a quote');
});

test('decimal odds pay the stake back', () => {
  assert.ok(Math.abs(decimalOdds(+100) - 2) < 1e-9);
  assert.ok(Math.abs(decimalOdds(-200) - 1.5) < 1e-9);
});

test('de-vig always yields a pair summing to exactly one', () => {
  for (const [a, b] of [[-110, -110], [-150, +130], [+250, -300], [-1000, +650]]) {
    const fair = devigTwoWay(a, b);
    assert.ok(Math.abs(fair.home + fair.away - 1) < 1e-12, `${a}/${b} did not normalise`);
    assert.ok(fair.overround > 1, 'a real two-way market always has an overround');
  }
});

test('de-vig REDUCES the favourite below its raw quote — the whole point of removing the margin', () => {
  const raw = impliedProbability(-150);
  const fair = devigTwoWay(-150, +130).home;
  assert.ok(fair < raw, 'the vig must come out, not stay in');
});

test('normal CDF is accurate at the landmarks', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normalCdf(1) - 0.8413447) < 1e-6);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-4);
});

test('a pick-em projects to a coin flip and the model is symmetric around it', () => {
  assert.ok(Math.abs(winProbabilityFromMargin(0, 'nfl') - 0.5) < 1e-9);
  const up = winProbabilityFromMargin(7, 'nba');
  const down = winProbabilityFromMargin(-7, 'nba');
  assert.ok(Math.abs(up + down - 1) < 1e-9, 'flipping the margin must flip the probability');
});

test('NBA margins are tighter than NFL margins, so the same edge is worth more', () => {
  assert.ok(MARGIN_SIGMA.nba < MARGIN_SIGMA.nfl);
  assert.ok(winProbabilityFromMargin(7, 'nba') > winProbabilityFromMargin(7, 'nfl'));
});

test('a team laying its own projected margin is a 50/50 to cover', () => {
  // Projected to win by 6, laying 6: the cover probability is exactly a coin flip.
  assert.ok(Math.abs(coverProbability(6, -6, 'nfl') - 0.5) < 1e-9);
  // Laying less than the projection is favourable; laying more is not.
  assert.ok(coverProbability(6, -3, 'nfl') > 0.5);
  assert.ok(coverProbability(6, -10, 'nfl') < 0.5);
});

test('Kelly refuses a bet the price does not pay for', () => {
  // 52% at -110 is negative EV; the arithmetic must return zero rather than a small positive stake.
  assert.equal(kellyFraction(0.52, -110), 0);
  assert.ok(expectedValue(0.52, -110) < 0);
  // 60% at -110 is genuinely positive.
  assert.ok(kellyFraction(0.60, -110) > 0);
  assert.ok(expectedValue(0.60, -110) > 0);
});

test('Kelly is quartered and then capped, so no single call can be oversized', () => {
  const huge = kellyFraction(0.99, +200);
  assert.ok(huge <= MAX_STAKE_FRACTION, 'the cap is the last word');
  // Quarter-Kelly on a modest edge must be well under full Kelly.
  const p = 0.58;
  const full = (p * 1 - (1 - p)) / 1;   // decimal 2.0 → b = 1
  assert.ok(kellyFraction(p, +100) < full / 2, 'quartering must actually quarter');
});

test('closing-line value is positive when we beat the close and negative when we do not', () => {
  // Took +150, closed at +120 (the market moved toward our side): we beat the close.
  assert.ok(closingLineValue(150, 120, -140) > 0);
  // Took +120, closed at +150 (the market moved away): we did not.
  assert.ok(closingLineValue(120, 150, -170) < 0);
});

test('closing-line value is zero when the price never moved', () => {
  const clv = closingLineValue(-110, -110, -110);
  assert.ok(Math.abs(clv) < 1e-12, 'an unmoved line has no value either way');
});
