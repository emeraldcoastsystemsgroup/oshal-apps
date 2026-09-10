/**
 * Guards for the ensemble and the context adjustments.
 *
 * The first test in this file is the most important one in the package. Strength models are three
 * ESTIMATES OF ONE QUANTITY and must be AVERAGED; context adjustments are SEPARATE EFFECTS and must
 * be ADDED. Collapsing that distinction — in either direction — produces lines that are wrong by a
 * factor of three while still looking like plausible football numbers, which is exactly the kind of
 * error nobody notices until a season of picks has been graded.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the averaged-strength/added-context invariant, home advantage and neutral sites, availability and rest reaching the line at full weight, shadow models excluded from the line, and the edge evaluator's de-vig and positive-EV requirements.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLine, evaluateEdges, STRENGTH_WEIGHTS } = require('../routes/sports-ensemble.js');
const { availabilityImpact, computeUnitRatings, matchupEdge, restImpact } = require('../routes/sports-adjustments.js');
const { LEAGUE_CONSTANTS } = require('../routes/sports-ratings.js');

/** A game where all three strength models see the same +N edge for the home side. */
function inputs(over) {
  const base = {
    league: 'nfl', homeTeam: 'H', awayTeam: 'A', neutralSite: false,
    elo: { H: { team: 'H', elo: 1500, games: 10 }, A: { team: 'A', elo: 1500, games: 10 } },
    power: { H: { team: 'H', rating: 0, rawMargin: 0, games: 10 }, A: { team: 'A', rating: 0, rawMargin: 0, games: 10 } },
    units: { H: { team: 'H', offense: 0, defense: 0, games: 10 }, A: { team: 'A', offense: 0, defense: 0, games: 10 } },
    homeInjuries: [], awayInjuries: [],
    homeRest: { restDays: 7 }, awayRest: { restDays: 7 },
  };
  return Object.assign(base, over || {});
}

test('STRENGTH MODELS ARE AVERAGED, NOT ADDED — the single most corrupting possible bug', () => {
  // Set every strength model to see the same ~10-point home edge, on a neutral site so no home
  // advantage is layered on. Averaged, the line is ~10. Added, it would be ~30.
  const c = LEAGUE_CONSTANTS.nfl;
  const line = buildLine(inputs({
    neutralSite: true,
    elo: { H: { team: 'H', elo: 1500 + 10 * c.eloPerPoint, games: 10 }, A: { team: 'A', elo: 1500, games: 10 } },
    power: { H: { team: 'H', rating: 10, rawMargin: 10, games: 10 }, A: { team: 'A', rating: 0, rawMargin: 0, games: 10 } },
    // A unit rating is HALF the margin per side: +5 offence and +5 defence is a ten-point team,
    // because the margin is (their scoring edge) plus (their scoring-prevention edge).
    units: { H: { team: 'H', offense: 5, defense: 5, games: 10 }, A: { team: 'A', offense: 0, defense: 0, games: 10 } },
  }));
  for (const s of line.signals) {
    assert.ok(Math.abs(s.points - 10) < 0.6, `${s.model} should see ~10, saw ${s.points}`);
  }
  assert.ok(Math.abs(line.projectedMargin - 10) < 0.7,
    `three models each seeing +10 must average to ~10, not sum to ~30 — got ${line.projectedMargin}`);
});

test('the strength weights are a normalised average, so they need not sum to one', () => {
  const total = Object.values(STRENGTH_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(total > 0);
  const line = buildLine(inputs({ neutralSite: true }));
  assert.ok(Math.abs(line.strengthMargin) < 1e-9, 'identical teams project to a pick-em');
});

test('home advantage is applied once, not once per model', () => {
  const line = buildLine(inputs());
  assert.ok(Math.abs(line.projectedMargin - LEAGUE_CONSTANTS.nfl.homeAdvantagePoints) < 0.5,
    `two equal teams should project to about one home advantage, got ${line.projectedMargin}`);
});

test('a neutral site removes home advantage from the line entirely', () => {
  assert.equal(buildLine(inputs({ neutralSite: true })).homeAdvantage, 0);
  assert.ok(Math.abs(buildLine(inputs({ neutralSite: true })).projectedMargin) < 1e-9);
});

test('CONTEXT IS ADDED AT FULL WEIGHT — a missing quarterback moves the line ~6.5, not ~1.3', () => {
  const clean = buildLine(inputs({ neutralSite: true }));
  const qbOut = buildLine(inputs({
    neutralSite: true,
    homeInjuries: [{ player: 'Starter', position: 'QB', status: 'Out', productionShare: 0.15 }],
  }));
  const swing = clean.projectedMargin - qbOut.projectedMargin;
  assert.ok(swing > 5.5 && swing < 7.5,
    `a starting QB out must move the line about a touchdown, moved ${swing.toFixed(2)}`);
});

test('injury cost scales with what the player actually produces', () => {
  const wr1 = availabilityImpact([{ player: 'WR1', position: 'WR', status: 'Out', productionShare: 0.30 }], 'nfl');
  const wr5 = availabilityImpact([{ player: 'WR5', position: 'WR', status: 'Out', productionShare: 0.03 }], 'nfl');
  assert.ok(Math.abs(wr1.points) > Math.abs(wr5.points) * 5,
    'a team leader and a backup must not cost the same');
  assert.ok(wr1.points < 0 && wr5.points < 0, 'availability cost is always a debit');
});

test('report status scales the cost — questionable costs far less than out', () => {
  const out = availabilityImpact([{ player: 'X', position: 'QB', status: 'Out' }], 'nfl').points;
  const quest = availabilityImpact([{ player: 'X', position: 'QB', status: 'Questionable' }], 'nfl').points;
  assert.ok(Math.abs(quest) < Math.abs(out) * 0.5);
  assert.equal(availabilityImpact([{ player: 'X', position: 'QB', status: 'Active' }], 'nfl').points, 0);
});

test('an unknown status is ignored rather than guessed at', () => {
  const r = availabilityImpact([{ player: 'X', position: 'QB', status: 'Flu-like symptoms' }], 'nfl');
  assert.equal(r.points, 0);
  assert.equal(r.keyLosses.length, 0);
});

test('rest effects differ by league, and a back-to-back is the biggest one in the NBA', () => {
  assert.ok(restImpact({ restDays: 1 }, 'nba') < -1, 'a back-to-back must hurt');
  assert.ok(restImpact({ restDays: 4 }, 'nba') > 0, 'genuine rest helps');
  assert.ok(restImpact({ restDays: 4 }, 'nfl') < 0, 'four days is a SHORT week in the NFL');
  assert.ok(restImpact({ restDays: 14 }, 'nfl') > 0, 'off a bye helps');
});

test('unit ratings separate a good offence from a good defence', () => {
  const games = [
    // H scores a lot and concedes a lot; D concedes little.
    { date: '2025-09-01', homeTeam: 'H', awayTeam: 'X', homeScore: 38, awayScore: 31, neutralSite: true },
    { date: '2025-09-08', homeTeam: 'H', awayTeam: 'Y', homeScore: 35, awayScore: 28, neutralSite: true },
    { date: '2025-09-01', homeTeam: 'D', awayTeam: 'Y', homeScore: 13, awayScore: 6, neutralSite: true },
    { date: '2025-09-08', homeTeam: 'D', awayTeam: 'X', homeScore: 16, awayScore: 9, neutralSite: true },
  ];
  const u = computeUnitRatings(games, 'nfl');
  assert.ok(u.H.offense > u.D.offense, 'H is the better offence');
  assert.ok(u.D.defense > u.H.defense, 'D is the better defence');
});

test('the unit matchup is symmetric — swapping the teams flips its sign', () => {
  const h = { team: 'H', offense: 6, defense: 2, games: 10 };
  const a = { team: 'A', offense: -3, defense: -1, games: 10 };
  const forward = matchupEdge(h, a).netHomeMargin;
  const reversed = matchupEdge(a, h).netHomeMargin;
  assert.ok(Math.abs(forward + reversed) < 1e-9, 'an asymmetric matchup would favour whoever is listed first');
});

test('shadow models are computed but contribute NOTHING to the line', () => {
  const withMarket = buildLine(inputs({ neutralSite: true, marketHomeSpread: -14, espnHomeWinPct: 88 }));
  const without = buildLine(inputs({ neutralSite: true }));
  assert.ok(withMarket.shadow.length > 0, 'the shadows must actually be recorded');
  assert.equal(withMarket.projectedMargin, without.projectedMargin,
    'a market spread of -14 must not drag our line — that would be circular');
});

test('the edge evaluator refuses a bet the price does not pay for', () => {
  const line = buildLine(inputs({ neutralSite: true }));   // a true 50/50
  // A 50/50 priced at -110 on both sides has no edge for anyone.
  const none = evaluateEdges(line, { homeMoneyline: -110, awayMoneyline: -110 }, 'nfl');
  assert.equal(none.length, 0, 'a fairly priced coin flip is not a bet');
});

test('the edge evaluator finds a genuinely mispriced side and sizes it', () => {
  const c = LEAGUE_CONSTANTS.nfl;
  const line = buildLine(inputs({
    neutralSite: true,
    elo: { H: { team: 'H', elo: 1500 + 10 * c.eloPerPoint, games: 10 }, A: { team: 'A', elo: 1500, games: 10 } },
    power: { H: { team: 'H', rating: 10, rawMargin: 10, games: 10 }, A: { team: 'A', rating: 0, rawMargin: 0, games: 10 } },
    units: { H: { team: 'H', offense: 10, defense: 10, games: 10 }, A: { team: 'A', offense: 0, defense: 0, games: 10 } },
  }));
  // We make H a heavy favourite; the book has it near a coin flip.
  const edges = evaluateEdges(line, { homeMoneyline: -110, awayMoneyline: -110 }, 'nfl');
  assert.ok(edges.length > 0, 'a ten-point disagreement must surface');
  const top = edges[0];
  assert.equal(top.side, 'home');
  assert.ok(top.edge > 0.1, 'the edge should be large');
  assert.ok(top.kelly > 0 && top.kelly <= 0.02, 'sized, and capped');
  assert.ok(top.marketProbability > 0.49 && top.marketProbability < 0.51, 'the market side must be de-vigged to ~0.5');
});

test('edges are returned largest first, so the surface never has to sort', () => {
  const c = LEAGUE_CONSTANTS.nfl;
  const line = buildLine(inputs({
    neutralSite: true,
    elo: { H: { team: 'H', elo: 1500 + 8 * c.eloPerPoint, games: 10 }, A: { team: 'A', elo: 1500, games: 10 } },
    power: { H: { team: 'H', rating: 8, rawMargin: 8, games: 10 }, A: { team: 'A', rating: 0, rawMargin: 0, games: 10 } },
    units: { H: { team: 'H', offense: 8, defense: 8, games: 10 }, A: { team: 'A', offense: 0, defense: 0, games: 10 } },
  }));
  const edges = evaluateEdges(line, { homeMoneyline: -110, awayMoneyline: -110, homeSpread: 0 }, 'nfl');
  for (let i = 1; i < edges.length; i += 1) {
    assert.ok(edges[i - 1].edge >= edges[i].edge, 'edges must be sorted descending');
  }
});

test('A MODEL WITH NO DATA ABSTAINS — it must not vote a zero that reads as "these teams are even"', () => {
  // Found live on 2026-09-06 in NFL Week 1: power and units had no games, returned 0, and averaged
  // a real Elo signal 55% of the way to nothing. The preview looked confident and was pure home
  // field. Elo here says the home side is ten points better; the line must reflect that.
  const c = LEAGUE_CONSTANTS.nfl;
  const line = buildLine(inputs({
    neutralSite: true,
    elo: { H: { team: 'H', elo: 1500 + 10 * c.eloPerPoint, games: 0 }, A: { team: 'A', elo: 1500, games: 0 } },
    power: {},   // no games played yet
    units: {},
  }));
  assert.equal(line.signals.find((s) => s.model === 'elo').available, true);
  assert.equal(line.signals.find((s) => s.model === 'power').available, false);
  assert.equal(line.signals.find((s) => s.model === 'units').available, false);
  assert.ok(Math.abs(line.projectedMargin - 10) < 0.6,
    `Elo alone must carry the line at full strength, got ${line.projectedMargin}`);
});

test('an abstaining model still appears on the card, saying why', () => {
  const line = buildLine(inputs({ power: {}, units: {} }));
  const power = line.signals.find((s) => s.model === 'power');
  assert.equal(power.available, false);
  assert.match(power.basis, /abstaining/, 'the card must explain the absence, not hide it');
  assert.equal(line.signals.length, 3, 'all three models are always shown');
});

test('weights renormalise over the models that voted, not over all three', () => {
  const c = LEAGUE_CONSTANTS.nfl;
  // Elo says +10, power says +20, units abstains. The answer must be the elo/power weighted
  // average (~13.4), NOT that average diluted by a phantom zero from units (~10.7).
  const line = buildLine(inputs({
    neutralSite: true,
    elo: { H: { team: 'H', elo: 1500 + 10 * c.eloPerPoint, games: 5 }, A: { team: 'A', elo: 1500, games: 5 } },
    power: { H: { team: 'H', rating: 20, rawMargin: 20, games: 5 }, A: { team: 'A', rating: 0, rawMargin: 0, games: 5 } },
    units: {},
  }));
  const expected = (10 * STRENGTH_WEIGHTS.elo + 20 * STRENGTH_WEIGHTS.power) / (STRENGTH_WEIGHTS.elo + STRENGTH_WEIGHTS.power);
  assert.ok(Math.abs(line.projectedMargin - expected) < 0.6,
    `expected ~${expected.toFixed(2)}, got ${line.projectedMargin}`);
});
