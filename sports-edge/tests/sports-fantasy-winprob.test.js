/**
 * Guards for the win-probability objective.
 *
 * THE FIRST TWO TESTS ARE THE POINT OF THE WHOLE MODULE, and they are written as a matched pair
 * because either one alone can pass for the wrong reason. A week is head-to-head, so
 * P(win) = Φ((μ_you − μ_opp)/√(σ²_you + σ²_opp)), and differentiating that says an UNDERDOG's win
 * probability rises with his own variance while a FAVOURITE's falls. Both fixtures below hold the
 * projected points essentially constant and change only the spread, so the swap the optimiser makes
 * is attributable to the objective and to nothing else:
 *
 *   - a big underdog must move to the VOLATILE player, and the recommended lineup's σ must go UP
 *   - a big favourite must move to the STEADY player, and its σ must go DOWN
 *
 * A single-direction test would be satisfied by a bug that simply always maximises variance, which
 * is the most likely way to get this wrong and the most expensive: it would hand a winning team a
 * coin flip every week. The third test is the one that protects everyone who is neither — with no
 * opponent known, the recommendation must be exactly the old highest-projected lineup, unchanged.
 *
 * Run from the package root: node --test "tests/*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the underdog/favourite variance pair, the no-opponent fallback, normal-CDF accuracy, spread priors with sample shrinkage and the zero-projection floor, win-probability monotonicity, posture banding, every swap carrying its cost, and the schedule read plus opponent resolution.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SPREAD_PRIOR, MIN_SPREAD_POINTS, POSITION_SPREAD_PRIORS,
  lineupMoments, normalCdf, optimiseForWin, postureOf, spreadFor, winProbability,
} = require('../routes/sports-fantasy-winprob.js');
const { opponentTeamFor, readMatchups } = require('../routes/sports-fantasy-espn.js');

/** One stat worth one point, so a projection reads as its own point total. */
const SCORING = [{ statId: 0, points: 1 }];
/** One flex-ish slot, so exactly one of the two candidates can start. */
const SLOTS = [{ slotId: 2, count: 1 }];

/** A running back with a projection and a scoring history that decides his spread. */
function rb(playerId, name, points, pointsHistory) {
  return {
    playerId,
    name,
    eligibleSlots: [2],
    defaultPositionId: 2,
    projectedStats: { 0: points },
    pointsHistory,
  };
}

/** Weeks that hardly vary — the steady starter. */
const STEADY_WEEKS = [12, 12, 13, 12, 12, 12];
/** Weeks that are either nothing or a blow-up — the boom/bust player. */
const BOOM_WEEKS = [0, 26, 1, 25, 0, 24];

test('AN UNDERDOG PLAYS THE VOLATILE PLAYER — variance is what buys the tail', () => {
  // Steady projects a hair higher, so the points-maximising lineup starts him and the swap the
  // optimiser makes can only be explained by the objective.
  const roster = [rb(1, 'Steady', 12.1, STEADY_WEEKS), rb(2, 'Boom', 12.0, BOOM_WEEKS)];
  const opponent = { mean: 40, sd: 6 };

  const out = optimiseForWin(roster, SLOTS, SCORING, opponent);

  assert.equal(out.posture, 'underdog');
  assert.equal(out.meanLineup.starters[0].player.name, 'Steady', 'the mean objective starts Steady');
  assert.equal(out.lineup.starters[0].player.name, 'Boom', 'the win objective must move to the volatile player');
  assert.ok(out.moments.sd > out.meanMoments.sd, 'the recommended lineup must carry MORE variance');
  assert.ok(out.winProbability > out.meanWinProbability,
    'and it must actually raise the chance of winning, or the swap was not worth making');
  assert.equal(out.meanFallback, false);
});

test('A FAVOURITE PLAYS THE STEADY ONE — the mirror, so "always maximise variance" cannot pass', () => {
  // Same two players, means swapped so the points-maximising lineup starts Boom this time.
  const roster = [rb(1, 'Steady', 12.0, STEADY_WEEKS), rb(2, 'Boom', 12.1, BOOM_WEEKS)];
  const opponent = { mean: 5, sd: 2 };

  const out = optimiseForWin(roster, SLOTS, SCORING, opponent);

  assert.equal(out.posture, 'favourite');
  assert.equal(out.meanLineup.starters[0].player.name, 'Boom', 'the mean objective starts Boom');
  assert.equal(out.lineup.starters[0].player.name, 'Steady', 'the win objective must move to the steady player');
  assert.ok(out.moments.sd < out.meanMoments.sd, 'the recommended lineup must carry LESS variance');
  assert.ok(out.winProbability > out.meanWinProbability);
});

test('with no opponent the recommendation is the old highest-projected lineup, untouched', () => {
  const roster = [rb(1, 'Steady', 12.0, STEADY_WEEKS), rb(2, 'Boom', 12.1, BOOM_WEEKS)];

  const out = optimiseForWin(roster, SLOTS, SCORING, null);

  assert.equal(out.meanFallback, true);
  assert.equal(out.swaps.length, 0);
  assert.deepEqual(
    out.lineup.starters.map((a) => a.player.playerId),
    out.meanLineup.starters.map((a) => a.player.playerId),
    'a bye week, an unread schedule or a league with no fixture must never change the lineup',
  );
});

test('every swap reports what it cost in points and what it bought in win probability', () => {
  const roster = [rb(1, 'Steady', 12.1, STEADY_WEEKS), rb(2, 'Boom', 12.0, BOOM_WEEKS)];
  const out = optimiseForWin(roster, SLOTS, SCORING, { mean: 40, sd: 6 });

  assert.ok(out.swaps.length >= 1);
  for (const s of out.swaps) {
    assert.ok(s.winGain > 0, 'a swap that does not raise P(win) must not be taken');
    assert.equal(typeof s.meanCost, 'number', 'the projected points given up must be stated, not hidden');
    assert.ok(s.start.playerId && s.sit.playerId);
    assert.ok(s.start.sd > 0 && s.sit.sd > 0);
  }
  assert.ok(out.swaps[0].meanCost > 0, 'this fixture gives up projected points on purpose');
});

test('an unavailable player is never swapped in, however volatile he looks', () => {
  const out = optimiseForWin(
    [rb(1, 'Steady', 12.1, STEADY_WEEKS), { ...rb(2, 'Boom', 12.0, BOOM_WEEKS), injuryStatus: 'OUT' }],
    SLOTS, SCORING, { mean: 40, sd: 6 },
  );
  assert.equal(out.lineup.starters[0].player.name, 'Steady');
  assert.equal(out.swaps.length, 0);
});

test('the normal CDF is accurate enough to trust at the tails', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-3);
  assert.ok(Math.abs(normalCdf(-3) - 0.00135) < 1e-4);
  assert.ok(normalCdf(-40) >= 0 && normalCdf(40) <= 1);
});

test('win probability is 50% between identical lineups and monotone in the mean', () => {
  const me = { mean: 100, sd: 20 };
  assert.ok(Math.abs(winProbability(me, { mean: 100, sd: 20 }) - 0.5) < 1e-6);
  assert.ok(winProbability({ mean: 110, sd: 20 }, me) > 0.5);
  assert.ok(winProbability({ mean: 90, sd: 20 }, me) < 0.5);
});

test('spreads come from a positional prior, and receivers are streakier than quarterbacks', () => {
  // The magnitudes are stated beliefs; the ORDER is the only thing a recommendation leans on.
  assert.ok(POSITION_SPREAD_PRIORS[3] > POSITION_SPREAD_PRIORS[1], 'WR must be less predictable than QB');
  assert.ok(POSITION_SPREAD_PRIORS[16] > POSITION_SPREAD_PRIORS[1], 'a defence must be less predictable than a QB');
  assert.ok(Math.abs(spreadFor(100, 1) - 100 * POSITION_SPREAD_PRIORS[1]) < 1e-9);
  assert.ok(Math.abs(spreadFor(100, 999) - 100 * DEFAULT_SPREAD_PRIOR) < 1e-9, 'an unknown position falls back');
});

test('a zero projection still carries risk — the spread floor', () => {
  // Without the floor a benched zero looks like a CERTAINTY of zero, which makes starting anyone
  // else look like the risky choice.
  assert.equal(spreadFor(0, 2), MIN_SPREAD_POINTS);
  assert.ok(spreadFor(1, 2) >= MIN_SPREAD_POINTS);
});

test('a small sample is shrunk toward the prior, a large one is trusted', () => {
  const prior = spreadFor(12, 2);
  const twoTightWeeks = spreadFor(12, 2, [12, 12.2]);
  const manyTightWeeks = spreadFor(12, 2, [12, 12.2, 11.9, 12.1, 12, 11.8, 12.1, 12, 11.9, 12.05, 12, 12.1]);
  assert.ok(twoTightWeeks < prior, 'evidence moves the estimate');
  assert.ok(manyTightWeeks < twoTightWeeks, 'more evidence moves it further');
  assert.ok(twoTightWeeks > manyTightWeeks, 'two weeks is not proof a player is steady');
});

test('lineup variances add across starters', () => {
  const m = lineupMoments([rb(1, 'A', 10), rb(2, 'B', 10)], SCORING);
  const one = spreadFor(10, 2);
  assert.ok(Math.abs(m.mean - 20) < 1e-9);
  assert.ok(Math.abs(m.sd - Math.sqrt(2 * one * one)) < 0.01);
});

test('an unavailable starter contributes zero points, not his projection', () => {
  const m = lineupMoments([{ ...rb(1, 'Hurt', 20), injuryStatus: 'OUT' }], SCORING);
  assert.equal(m.mean, 0);
});

test('posture is a band, so a coin-flip week is not called a favourite', () => {
  assert.equal(postureOf({ mean: 100, sd: 20 }, { mean: 100.5, sd: 20 }), 'even');
  assert.equal(postureOf({ mean: 100, sd: 20 }, { mean: 130, sd: 20 }), 'underdog');
  assert.equal(postureOf({ mean: 130, sd: 20 }, { mean: 100, sd: 20 }), 'favourite');
});

test('the schedule read parses fixtures and skips malformed ones', async () => {
  const stubFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      schedule: [
        { matchupPeriodId: 1, home: { teamId: 3 }, away: { teamId: 7 } },
        { matchupPeriodId: 1, home: { teamId: 5 } },
        { matchupPeriodId: 2, home: { teamId: 3 }, away: { teamId: 5 } },
        { away: { teamId: 9 } },
      ],
    }),
  });
  const out = await readMatchups(2026, '1234', null, { fetchImpl: stubFetch });
  assert.equal(out.length, 3, 'a fixture with no home team is not a fixture');
  assert.deepEqual(out[0], { matchupPeriodId: 1, homeTeamId: 3, awayTeamId: 7 });
  assert.equal(out[1].awayTeamId, null, 'an odd-team league gives somebody a bye');
});

test('an opponent resolves from either side, and a bye resolves to nobody', () => {
  const schedule = [
    { matchupPeriodId: 1, homeTeamId: 3, awayTeamId: 7 },
    { matchupPeriodId: 1, homeTeamId: 5, awayTeamId: null },
    { matchupPeriodId: 2, homeTeamId: 3, awayTeamId: 5 },
  ];
  assert.equal(opponentTeamFor(schedule, 3, 1), 7, 'resolves from the home side');
  assert.equal(opponentTeamFor(schedule, 7, 1), 3, 'and from the away side');
  assert.equal(opponentTeamFor(schedule, 5, 1), null, 'a bye is nobody');
  assert.equal(opponentTeamFor(schedule, 3, 2), 5, 'the week is honoured');
  assert.equal(opponentTeamFor(schedule, 3, 9), null, 'an unplayed week is nobody');
  assert.equal(opponentTeamFor([], 3, 1), null, 'an unreadable schedule is nobody');
});
