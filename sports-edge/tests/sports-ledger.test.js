/**
 * Guards for the ledger — grading and the staking gate.
 *
 * This is the file that decides whether the package is ever allowed to bet, so its failure modes
 * are the expensive ones: a spread graded against the CLOSING number instead of the one we took
 * would silently rewrite history in our favour, and a gate that lets a strategy through on one bar
 * instead of two would authorise stakes on a model that only got lucky.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — moneyline/spread/push grading against the price taken, Brier against both us and the market, and the UNPROVEN/FAILING/PROVEN gate incl. its refusal to promote a strategy with no measurable closing-line value.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ENSEMBLE_STRATEGY, MIN_GRADED, classify, gradeOne, predictionsFrom, rollup, spreadProbability,
} = require('../routes/sports-ledger.js');

function row(over) {
  return Object.assign({
    id: 1, league: 'nfl', market: 'moneyline', side: 'home',
    modelProb: 0.6, marketProb: 0.55, priceAtPick: -110, spreadAtPick: null, stakeFraction: 0,
  }, over || {});
}

test('a moneyline is graded by who actually won', () => {
  assert.equal(gradeOne(row({ side: 'home' }), { homeScore: 24, awayScore: 20 }).won, true);
  assert.equal(gradeOne(row({ side: 'home' }), { homeScore: 20, awayScore: 24 }).won, false);
  assert.equal(gradeOne(row({ side: 'away' }), { homeScore: 20, awayScore: 24 }).won, true);
});

test('A SPREAD IS GRADED AGAINST THE NUMBER WE TOOK, NOT THE ONE IT CLOSED AT', () => {
  // We took home -3.5. The game finished home by 6, so we covered — regardless of the close.
  const r = row({ market: 'spread', side: 'home', spreadAtPick: -3.5 });
  const g = gradeOne(r, { homeScore: 27, awayScore: 21, closingSpread: -10 });
  assert.equal(g.won, true, 'grading against a -10 close would wrongly mark this a loss');
});

test('a spread the team failed to cover is a loss even though it won the game', () => {
  const r = row({ market: 'spread', side: 'home', spreadAtPick: -7 });
  assert.equal(gradeOne(r, { homeScore: 24, awayScore: 20 }).won, false, 'won by 4, laid 7');
});

test('the away side of a spread is the mirror image', () => {
  const r = row({ market: 'spread', side: 'away', spreadAtPick: -7 });
  assert.equal(gradeOne(r, { homeScore: 24, awayScore: 20 }).won, true, '+7 dog losing by 4 covers');
});

test('a push on an integer spread is graded as NOT won — conservative, in our disfavour', () => {
  const r = row({ market: 'spread', side: 'home', spreadAtPick: -4 });
  const g = gradeOne(r, { homeScore: 24, awayScore: 20 });
  assert.equal(g.won, false, 'exactly on the number must not be scored as a win');
});

test('Brier is scored against BOTH us and the market, on the same outcome', () => {
  const g = gradeOne(row({ modelProb: 0.7, marketProb: 0.6 }), { homeScore: 30, awayScore: 10 });
  assert.ok(Math.abs(g.brier - 0.09) < 1e-9, '(0.7-1)^2');
  assert.ok(Math.abs(g.marketBrier - 0.16) < 1e-9, '(0.6-1)^2');
  assert.ok(g.brier < g.marketBrier, 'we were closer on this one');
});

test('profit is computed at the price actually taken', () => {
  const win = gradeOne(row({ priceAtPick: +150 }), { homeScore: 24, awayScore: 20 });
  assert.ok(Math.abs(win.pnlUnits - 1.5) < 1e-9);
  const loss = gradeOne(row({ priceAtPick: +150 }), { homeScore: 20, awayScore: 24 });
  assert.equal(loss.pnlUnits, -1);
});

test('closing-line value is null, not zero, when no close was recorded', () => {
  const g = gradeOne(row(), { homeScore: 24, awayScore: 20 });
  assert.equal(g.clv, null, 'a missing measurement must not read as a neutral one');
});

test('spread probability mirrors correctly between the two sides', () => {
  const home = spreadProbability(6, -3.5, 'home', 'nfl');
  const away = spreadProbability(6, -3.5, 'away', 'nfl');
  assert.ok(Math.abs(home + away - 1) < 1e-9);
  assert.ok(home > 0.5, 'projected +6 laying 3.5 should be favoured to cover');
});

/** Builds n graded rows with the given per-row properties. */
function rows(n, over) {
  return Array.from({ length: n }, () => Object.assign(
    { won: true, brier: 0.15, marketBrier: 0.20, clv: 0.01, pnlUnits: 0.9 }, over || {},
  ));
}

test('a strategy with too little evidence is UNPROVEN and may not stake', () => {
  const v = classify(rollup('x', rows(MIN_GRADED - 1)));
  assert.equal(v.verdict, 'UNPROVEN');
  assert.equal(v.mayStake, false);
});

test('a strategy that beats BOTH bars is PROVEN and may stake', () => {
  const v = classify(rollup('x', rows(MIN_GRADED)));
  assert.equal(v.verdict, 'PROVEN');
  assert.equal(v.mayStake, true);
});

test('losing to the market Brier is FAILING even with positive closing-line value', () => {
  const v = classify(rollup('x', rows(MIN_GRADED, { brier: 0.25, marketBrier: 0.20, clv: 0.05 })));
  assert.equal(v.verdict, 'FAILING');
  assert.equal(v.mayStake, false);
  assert.match(v.reason, /does not beat the market/);
});

test('losing to the CLOSE is FAILING even with a better Brier — luck is not edge', () => {
  const v = classify(rollup('x', rows(MIN_GRADED, { brier: 0.15, marketBrier: 0.20, clv: -0.02 })));
  assert.equal(v.verdict, 'FAILING');
  assert.equal(v.mayStake, false);
  assert.match(v.reason, /loses to the close/);
});

test('a strategy with NO closing prices can never be PROVEN — unmeasurable is not proven', () => {
  const v = classify(rollup('x', rows(MIN_GRADED, { clv: null })));
  assert.equal(v.verdict, 'FAILING');
  assert.equal(v.mayStake, false);
  assert.match(v.reason, /cannot be measured/);
});

test('a profitable but unproven strategy still may not stake', () => {
  // Won every bet, made money, but the market was better calibrated and it lost to the close.
  const v = classify(rollup('x', rows(MIN_GRADED, { brier: 0.30, marketBrier: 0.20, clv: -0.03, pnlUnits: 5 })));
  assert.equal(v.mayStake, false, 'a hot streak must not unlock staking');
  assert.ok(v.rollup.pnlUnits > 0, 'and the profit is still reported honestly');
});

/** A minimal preview shaped the way buildLine + buildPreview produce one. */
function preview(over) {
  return Object.assign({
    eventId: 'E1', league: 'nfl', date: '2026-09-13T17:00Z', name: 'A at H',
    homeTeam: 'H', awayTeam: 'A', neutralSite: false,
    line: {
      projectedMargin: 6, homeWinProbability: 0.67, homeAdvantage: 2.2, strengthMargin: 6,
      signals: [], adjustments: [],
      shadow: [{ model: 'market-blend', points: 4, basis: 'b' }, { model: 'market-only', points: 2, basis: 'b' }],
      availability: { home: { points: 0, keyLosses: [] }, away: { points: 0, keyLosses: [] } },
    },
    quote: { homeMoneyline: -150, awayMoneyline: +130, homeSpread: -3.5 },
    edges: [{
      market: 'moneyline', side: 'home', selection: 'H moneyline',
      modelProbability: 0.67, marketProbability: 0.58, edge: 0.09, price: -150,
      expectedValue: 0.12, kelly: 0.015,
    }],
    context: { ats: {}, form: {}, news: [], restDays: { home: 7, away: 7 }, espnHomeWinPct: 61.1 },
    ratings: {}, carriedOver: false, generatedAt: '2026-09-06T00:00Z',
  }, over || {});
}

test('SHADOW ROWS ALWAYS CARRY ZERO STAKE, whatever the gate says', () => {
  const written = predictionsFrom(preview(), true);
  const shadows = written.filter((r) => r.strategy !== ENSEMBLE_STRATEGY);
  assert.ok(shadows.length >= 2, 'the shadows must actually be registered');
  for (const s of shadows) assert.equal(s.stakeFraction, 0, `${s.strategy} must never stake`);
});

test('the ensemble stakes zero until the gate allows it, but the call is still recorded', () => {
  const blocked = predictionsFrom(preview(), false).find((r) => r.strategy === ENSEMBLE_STRATEGY);
  assert.equal(blocked.stakeFraction, 0, 'gate closed means no stake');
  assert.ok(blocked.edge > 0, 'but the call is registered so it can be graded');
  const allowed = predictionsFrom(preview(), true).find((r) => r.strategy === ENSEMBLE_STRATEGY);
  assert.ok(allowed.stakeFraction > 0, 'gate open lets the Kelly size through');
});

test('the ESPN predictor is recorded as its own strategy, so we can prove we beat a free number', () => {
  const espn = predictionsFrom(preview(), false).find((r) => r.strategy === 'espn-predictor');
  assert.ok(espn, 'the free baseline must be in the ledger');
  assert.ok(Math.abs(espn.modelProb - 0.611) < 1e-9, "recorded at ESPN's own number");
});

test('the price we took is recorded on every row — without it there is no closing-line value', () => {
  for (const r of predictionsFrom(preview(), false)) {
    assert.ok(r.priceAtPick !== null && r.priceAtPick !== undefined, `${r.strategy} lost its price`);
  }
});
