/**
 * Guards for the rating models. These decide most of every line, and both of them have a failure
 * mode that produces plausible-looking nonsense rather than an error: Elo that is not zero-sum
 * inflates the whole league, and an SRS that does not converge ranks teams by schedule luck.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — Elo zero-sum and ordering, MOV damping, home advantage, season carry-over regression, SRS schedule adjustment, and the rating-to-points conversion.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BASE_ELO, LEAGUE_CONSTANTS, carryOverElo, computeElo, computePowerRatings, eloExpectation,
  eloToMargin, movMultiplier,
} = require('../routes/sports-ratings.js');
const { MARGIN_SIGMA, winProbabilityFromMargin } = require('../routes/sports-odds.js');

function game(home, away, hs, as, date, neutral) {
  return { date: date || '2025-09-10', homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as, neutralSite: !!neutral };
}

test('Elo expectation is a proper logistic centred on a tie', () => {
  assert.ok(Math.abs(eloExpectation(0) - 0.5) < 1e-12);
  assert.ok(Math.abs(eloExpectation(400) - 10 / 11) < 1e-9);
  assert.ok(eloExpectation(-400) < 0.1);
});

test('Elo is ZERO-SUM — what one team gains the other loses, exactly', () => {
  const table = computeElo([game('A', 'B', 30, 10)], 'nfl');
  const total = table.A.elo + table.B.elo;
  assert.ok(Math.abs(total - 2 * BASE_ELO) < 1e-9,
    'the league total must not drift; a non-zero-sum update inflates every rating forever');
});

test('a bigger win moves Elo further, but sub-linearly', () => {
  const close = computeElo([game('A', 'B', 21, 20)], 'nfl').A.elo - BASE_ELO;
  const blowout = computeElo([game('A', 'B', 45, 3)], 'nfl').A.elo - BASE_ELO;
  assert.ok(blowout > close, 'a blowout is stronger evidence');
  assert.ok(blowout < close * 6, 'but a 42-point win is not 42x the evidence of a 1-point win');
});

test('the MOV multiplier damps a strong favourite beating a weak opponent', () => {
  const evenMatch = movMultiplier(14, 0);
  const mismatch = movMultiplier(14, 400);
  assert.ok(mismatch < evenMatch, 'running up the score on a bad team must earn less');
});

test('home advantage makes the home side the expected winner between equal teams', () => {
  // Equal ratings: the home side is expected to win, so BEATING that expectation earns less than an
  // away win of the same margin would.
  const homeWin = computeElo([game('A', 'B', 24, 20)], 'nfl').A.elo - BASE_ELO;
  const awayWin = computeElo([game('B', 'A', 20, 24)], 'nfl').A.elo - BASE_ELO;
  assert.ok(awayWin > homeWin, 'winning on the road must be worth more than the same win at home');
});

test('a neutral site removes home advantage entirely', () => {
  const atHome = computeElo([game('A', 'B', 24, 20, '2025-09-10', false)], 'nfl').A.elo;
  const neutral = computeElo([game('A', 'B', 24, 20, '2025-09-10', true)], 'nfl').A.elo;
  assert.ok(neutral > atHome, 'the same win on neutral ground is stronger evidence');
});

test('games are ordered by date, so an out-of-order tape cannot change the answer', () => {
  const inOrder = [game('A', 'B', 30, 10, '2025-09-01'), game('A', 'C', 14, 21, '2025-09-08')];
  const shuffled = [inOrder[1], inOrder[0]];
  assert.ok(Math.abs(computeElo(inOrder, 'nfl').A.elo - computeElo(shuffled, 'nfl').A.elo) < 1e-9);
});

test('season carry-over regresses toward the mean by the league fraction', () => {
  const table = { A: { team: 'A', elo: 1700, games: 17 }, B: { team: 'B', elo: 1300, games: 17 } };
  const carried = carryOverElo(table, 'nfl');
  const r = LEAGUE_CONSTANTS.nfl.seasonRegression;
  assert.ok(Math.abs(carried.A - (1700 + (BASE_ELO - 1700) * r)) < 1e-9);
  assert.ok(carried.A < 1700 && carried.A > BASE_ELO, 'regressed toward average but not all the way');
  assert.ok(carried.B > 1300 && carried.B < BASE_ELO);
});

test('a seed is honoured, so a new season starts from last season carried over', () => {
  const played = computeElo([game('A', 'B', 20, 17)], 'nfl', { A: 1620 });
  assert.ok(played.A.elo > 1620, 'the seed is the starting point, not a cap');
  assert.ok(played.B.elo < 1500, 'an unseeded team still starts at the base and loses from there');
});

test('power ratings credit a team for the schedule it actually played', () => {
  // A and B both average +10. A did it against C (who is good); B did it against D (who is awful).
  const games = [
    game('A', 'C', 27, 17), game('C', 'A', 17, 27),
    game('B', 'D', 27, 17), game('D', 'B', 17, 27),
    game('C', 'D', 35, 3), game('D', 'C', 3, 35),
  ];
  const p = computePowerRatings(games, 'nfl');
  assert.ok(Math.abs(p.A.rawMargin - p.B.rawMargin) < 1e-6, 'raw margins are identical by construction');
  assert.ok(p.A.rating > p.B.rating, 'the harder schedule must rate higher after adjustment');
});

test('power ratings converge rather than diverging over iterations', () => {
  const games = [game('A', 'B', 30, 0), game('B', 'C', 30, 0), game('C', 'A', 30, 0)];
  const p = computePowerRatings(games, 'nfl');
  for (const t of ['A', 'B', 'C']) {
    assert.ok(Number.isFinite(p[t].rating), `${t} diverged`);
    assert.ok(Math.abs(p[t].rating) < 200, 'a cyclic tape must not blow up');
  }
});

test('an Elo gap converts to points at the league constant', () => {
  assert.ok(Math.abs(eloToMargin(250, 'nfl') - 10) < 1e-9);
  assert.ok(Math.abs(eloToMargin(280, 'nba') - 10) < 1e-9);
});

test('A SEED WITH NO GAMES STILL PRODUCES A RATING TABLE — the Week 1 carry-over bug', () => {
  // Found live on 2026-09-06: computeElo discovered teams from the GAMES, so a seeded call with an
  // empty tape returned {} and silently threw away every carried-over rating. The symptom was not
  // an error — it was a whole league sitting at 1500 and a line made of nothing but home field.
  const table = computeElo([], 'nfl', { SEA: 1706, NE: 1645 });
  assert.equal(Object.keys(table).length, 2, 'the seed must materialise even with no games played');
  assert.equal(table.SEA.elo, 1706);
  assert.equal(table.NE.elo, 1645);
  assert.equal(table.SEA.games, 0, 'and honestly report that no games back it');
});

test('a seeded team that later plays keeps building from its carried-over rating', () => {
  const table = computeElo([game('SEA', 'NE', 30, 10)], 'nfl', { SEA: 1706, NE: 1645, KC: 1620 });
  assert.ok(table.SEA.elo > 1706, 'a win moves it up from the seed');
  assert.ok(table.NE.elo < 1645);
  assert.equal(table.KC.elo, 1620, 'a seeded team that has not played keeps its exact carry-over');
  assert.equal(table.KC.games, 0);
});

test('NCAAF is wired with its own constants, not borrowed from the NFL', () => {
  const c = LEAGUE_CONSTANTS.ncaaf;
  assert.ok(c, 'college football must have its own row');
  // The sport genuinely differs, and each of these was validated by walk-forward rather than copied.
  assert.ok(c.marginCap > LEAGUE_CONSTANTS.nfl.marginCap, 'college blowouts are routine — a higher cap');
  assert.ok(c.seasonRegression > LEAGUE_CONSTANTS.nfl.seasonRegression, 'graduation + the portal turn rosters over harder');
  assert.ok(c.eloPerPoint < LEAGUE_CONSTANTS.nfl.eloPerPoint, 'wider margins mean fewer Elo buy a point');
  assert.ok(c.kFactor > LEAGUE_CONSTANTS.nfl.kFactor, 'a 12-game season must learn faster');
});

test('a wider college margin means the SAME edge is worth less win probability', () => {
  // Measured: NCAAF margins scatter ~16.5 pts vs the NFL's ~13.4, so ten points of projected edge
  // buys less certainty in college. Getting this backwards would overstate every college call.
  assert.ok(MARGIN_SIGMA.ncaaf > MARGIN_SIGMA.nfl);
  assert.ok(winProbabilityFromMargin(10, 'ncaaf') < winProbabilityFromMargin(10, 'nfl'));
});
