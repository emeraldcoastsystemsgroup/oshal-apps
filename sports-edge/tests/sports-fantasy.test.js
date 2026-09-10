/**
 * Guards for the fantasy half of Sports Edge.
 *
 * The expensive failure here is not a crash — it is a confidently wrong lineup. Three specific ways
 * that happens, and each has guards below:
 *   1. SCORING IS HARDCODED. ESPN's projections are raw stats; points only exist relative to a
 *      league's rules. A hardcoded stat table silently mis-scores every player in any league that
 *      is not standard, and looks completely normal while doing it.
 *   2. AN UNAVAILABLE PLAYER IS STARTED. A projection is not conditioned on availability, so a
 *      ruled-out starter can carry a great projection right up to kickoff.
 *   3. THE OPTIMISER STRANDS A PLAYER. Filling a flexible slot before a restrictive one can leave
 *      the only eligible kicker on the bench.
 *
 * Run from the package root: node --test "tests/*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — league-defined scoring (proved by scoring the same stat line under two different rule sets), slot-scarcity lineup optimisation, unavailable players excluded, start/sit diffing, credential split/normalisation, both cookies sent, and projection distillation keeping only the right season/week/source rows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyScoring, isAvailable, optimiseLineup, startSitCalls, UNAVAILABLE_STATUSES,
} = require('../routes/sports-fantasy-scoring.js');
const {
  NON_STARTING_SLOTS, PLAYER_FEED_FILTER, cookieHeader, distilProjections, fetchProjections,
  findOwnTeam, parseCredential,
} = require('../routes/sports-fantasy-espn.js');

/** A stat line: 90 rushing yards, 1 rushing TD, 4 receptions, 30 receiving yards. */
const STATS = { 24: 90, 25: 1, 53: 4, 42: 30 };

/** Full PPR: 0.1/rush yd, 6/rush TD, 1/reception, 0.1/rec yd. */
const PPR = [{ statId: 24, points: 0.1 }, { statId: 25, points: 6 }, { statId: 53, points: 1 }, { statId: 42, points: 0.1 }];
/** Same league minus receptions — the half that proves scoring is not hardcoded. */
const STANDARD = [{ statId: 24, points: 0.1 }, { statId: 25, points: 6 }, { statId: 42, points: 0.1 }];

test('SCORING COMES FROM THE LEAGUE, NOT A HARDCODED TABLE', () => {
  // Identical stats, two rule sets. If any stat meaning were baked in, these would not differ by
  // exactly the four receptions.
  const ppr = applyScoring(STATS, PPR);
  const std = applyScoring(STATS, STANDARD);
  assert.equal(ppr, 22, '9 + 6 + 4 + 3');
  assert.equal(std, 18, 'same line, no reception points');
  assert.equal(Math.round((ppr - std) * 100) / 100, 4, 'the difference is exactly the receptions');
});

test('a stat the league does not score contributes nothing, and that is not an error', () => {
  assert.equal(applyScoring({ 999: 100 }, PPR), 0, 'an unscored category is simply worth zero');
  assert.equal(applyScoring({}, PPR), 0);
  assert.equal(applyScoring(undefined, PPR), 0);
});

test('negative rules subtract — an interception must cost points', () => {
  const withPicks = [...PPR, { statId: 20, points: -2 }];
  assert.equal(applyScoring({ ...STATS, 20: 2 }, withPicks), 18, '22 minus two interceptions');
});

test('a rule for a stat the player did not accrue is skipped, not treated as zero-times-NaN', () => {
  assert.equal(applyScoring({ 24: 100 }, PPR), 10);
  assert.ok(Number.isFinite(applyScoring({ 24: 100 }, [...PPR, { statId: 77, points: 5 }])));
});

/** Builds a player with a projection expressed directly in the stat the tests score. */
function player(id, name, slots, points, status) {
  return { playerId: id, name, eligibleSlots: slots, projectedStats: { 24: points * 10 }, injuryStatus: status };
}
/** One point per 10 rushing yards, so a player's "points" argument reads literally. */
const SIMPLE = [{ statId: 24, points: 0.1 }];

test('the optimiser respects slot eligibility', () => {
  const roster = [player(1, 'QB1', [0], 20), player(2, 'RB1', [2], 15), player(3, 'RB2', [2], 10)];
  const lineup = optimiseLineup(roster, [{ slotId: 0, count: 1 }, { slotId: 2, count: 1 }], SIMPLE);
  assert.equal(lineup.starters.length, 2);
  const qb = lineup.starters.find((a) => a.slotId === 0);
  assert.equal(qb.player.name, 'QB1', 'only the QB is eligible at slot 0');
  assert.equal(lineup.starters.find((a) => a.slotId === 2).player.name, 'RB1', 'the better RB starts');
  assert.equal(lineup.bench[0].player.name, 'RB2');
});

test('SCARCITY FIRST — a flex slot must not strand the only eligible kicker', () => {
  // The flex (slot 23) accepts the RBs; slot 17 accepts only the kicker. Filling flex first with a
  // naive "best available" pass is fine here, but filling slot 17 with anything would break it.
  const roster = [
    player(1, 'RB1', [2, 23], 30), player(2, 'RB2', [2, 23], 25), player(3, 'K1', [17], 8),
  ];
  const lineup = optimiseLineup(roster, [{ slotId: 2, count: 1 }, { slotId: 23, count: 1 }, { slotId: 17, count: 1 }], SIMPLE);
  assert.equal(lineup.starters.length, 3, 'every slot filled');
  assert.equal(lineup.starters.find((a) => a.slotId === 17).player.name, 'K1', 'the kicker must be started');
  assert.equal(lineup.total, 63, '30 + 25 + 8');
});

test('AN UNAVAILABLE PLAYER IS NEVER STARTED, however good his projection', () => {
  // The single most costly thing a start/sit tool gets wrong: a projection does not know the player
  // has been ruled out.
  const roster = [player(1, 'Star', [2], 40, 'OUT'), player(2, 'Backup', [2], 5, 'ACTIVE')];
  const lineup = optimiseLineup(roster, [{ slotId: 2, count: 1 }], SIMPLE);
  assert.equal(lineup.starters[0].player.name, 'Backup');
  assert.equal(lineup.total, 5);
  assert.ok(!lineup.bench.some((b) => b.player.name === 'Star'), 'and he is not even benched — he is excluded');
});

test('every unavailable status is honoured, and questionable is NOT one of them', () => {
  for (const s of ['OUT', 'INJURY_RESERVE', 'SUSPENSION', 'BYE']) {
    assert.equal(isAvailable({ injuryStatus: s }), false, `${s} must not start`);
    assert.ok(UNAVAILABLE_STATUSES.has(s));
  }
  assert.equal(isAvailable({ injuryStatus: 'QUESTIONABLE' }), true, 'questionable players usually play');
  assert.equal(isAvailable({ injuryStatus: 'ACTIVE' }), true);
  assert.equal(isAvailable({}), true, 'no status means no reason to bench');
});

test('a slot with nobody eligible is left empty rather than filled illegally', () => {
  const roster = [player(1, 'RB1', [2], 20)];
  const lineup = optimiseLineup(roster, [{ slotId: 2, count: 1 }, { slotId: 17, count: 1 }], SIMPLE);
  assert.equal(lineup.starters.length, 1, 'the kicker slot stays empty — there is no kicker');
});

test('start/sit is EMPTY when the lineup is already optimal — advising is not fidgeting', () => {
  const roster = [player(1, 'RB1', [2], 30), player(2, 'RB2', [2], 10)];
  const optimal = optimiseLineup(roster, [{ slotId: 2, count: 1 }], SIMPLE);
  assert.deepEqual(startSitCalls([1], optimal, SIMPLE, roster), []);
});

test('start/sit names the swap and the points it gains', () => {
  const roster = [player(1, 'RB1', [2], 30), player(2, 'RB2', [2], 10)];
  const optimal = optimiseLineup(roster, [{ slotId: 2, count: 1 }], SIMPLE);
  const calls = startSitCalls([2], optimal, SIMPLE, roster);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].start.name, 'RB1');
  assert.equal(calls[0].sit.name, 'RB2');
  assert.equal(calls[0].gain, 20);
});

test('start/sit calls out a benched-for-an-OUT-player swap by name', () => {
  const roster = [player(1, 'Star', [2], 40, 'OUT'), player(2, 'Backup', [2], 5, 'ACTIVE')];
  const optimal = optimiseLineup(roster, [{ slotId: 2, count: 1 }], SIMPLE);
  const calls = startSitCalls([1], optimal, SIMPLE, roster);
  assert.equal(calls.length, 1);
  assert.match(calls[0].reason, /is OUT and will not score/);
});

test('a swap below the threshold is not recommended — noise is not advice', () => {
  const roster = [player(1, 'RB1', [2], 10.2), player(2, 'RB2', [2], 10)];
  const optimal = optimiseLineup(roster, [{ slotId: 2, count: 1 }], SIMPLE);
  assert.deepEqual(startSitCalls([2], optimal, SIMPLE, roster, 0.5), [], 'a 0.2-point gain is not worth a move');
});

test('the credential splits on the FIRST colon and normalises the SWID', () => {
  assert.deepEqual(parseCredential('{ABC-123}:s2value'), { swid: '{ABC-123}', espnS2: 's2value' });
  assert.deepEqual(parseCredential('ABC-123:s2value'), { swid: '{ABC-123}', espnS2: 's2value' },
    'an unbraced paste still works');
  assert.deepEqual(parseCredential('{ABC}:aa:bb:cc'), { swid: '{ABC}', espnS2: 'aa:bb:cc' },
    'an espn_s2 containing colons survives intact');
});

test('a malformed or absent credential is NOT CONNECTED, not an error', () => {
  for (const bad of [null, undefined, '', '{ABC-123}', '{ABC-123}:', ':s2value', '   :   ']) {
    assert.equal(parseCredential(bad), null, `${JSON.stringify(bad)} must be treated as not connected`);
  }
});

test('BOTH cookies go on the request — one alone authenticates nothing', () => {
  const h = cookieHeader({ swid: '{ABC}', espnS2: 's2' });
  assert.match(h.Cookie, /SWID=\{ABC\}/);
  assert.match(h.Cookie, /espn_s2=s2/);
});

test('bench and IR are not starting slots', () => {
  assert.ok(NON_STARTING_SLOTS.has(20), 'bench');
  assert.ok(NON_STARTING_SLOTS.has(21), 'IR');
  assert.ok(!NON_STARTING_SLOTS.has(2), 'RB is');
});

test('the caller\'s own team is found by SWID, case-insensitively', () => {
  const teams = [
    { teamId: 1, owners: ['{OTHER}'] },
    { teamId: 2, owners: ['{abc-123}'] },
  ];
  assert.equal(findOwnTeam(teams, '{ABC-123}').teamId, 2);
  assert.equal(findOwnTeam(teams, '{NOBODY}'), null, 'a league they were removed from returns null');
});

test('distillation keeps ONLY the requested season/week weekly rows', () => {
  const feed = [{
    player: {
      id: 42, fullName: 'Test Back', eligibleSlots: [2, 23], proTeamId: 12,
      defaultPositionId: 2, injuryStatus: 'ACTIVE', ownership: { percentOwned: 91.4 },
      stats: [
        { seasonId: 2026, scoringPeriodId: 1, statSourceId: 1, statSplitTypeId: 1, stats: { 24: 80 } },
        { seasonId: 2026, scoringPeriodId: 1, statSourceId: 0, statSplitTypeId: 1, stats: { 24: 71 } },
        { seasonId: 2026, scoringPeriodId: 2, statSourceId: 1, statSplitTypeId: 1, stats: { 24: 999 } },
        { seasonId: 2025, scoringPeriodId: 1, statSourceId: 1, statSplitTypeId: 1, stats: { 24: 111 } },
        { seasonId: 2026, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, stats: { 24: 1700 } },
      ],
    },
  }];
  const out = distilProjections(feed, 2026, 1);
  assert.equal(out[42].projectedStats['24'], 80, 'the right week, the right source');
  assert.equal(out[42].actualStats['24'], 71, 'and the actual, for grading');
  assert.equal(out[42].percentOwned, 91.4);
  assert.deepEqual(out[42].eligibleSlots, [2, 23]);
});

test('distillation drops players with nothing for the week rather than inventing empty projections', () => {
  const feed = [{ player: { id: 7, fullName: 'Nobody', stats: [] } }, { player: { id: 8 } }, null, 'junk'];
  assert.deepEqual(distilProjections(feed, 2026, 1), {});
});

test('THE PLAYER FEED SENDS x-fantasy-filter — without it ESPN returns a 50-player page', async () => {
  // Measured live 2026-09-08: no header -> 50 players (alphabetically early), with it -> 11,617.
  // The bug this guards shipped once: a roster came back almost entirely unprojected, which reads
  // as missing data rather than as a truncated request.
  const seen = [];
  const stubFetch = async (url, init) => {
    seen.push({ url: String(url), headers: init && init.headers });
    return { ok: true, status: 200, json: async () => [] };
  };
  await fetchProjections(2026, 1, { fetchImpl: stubFetch });
  assert.equal(seen.length, 1);
  const h = seen[0].headers || {};
  assert.ok(h['x-fantasy-filter'], 'the filter header must be sent');
  const parsed = JSON.parse(h['x-fantasy-filter']);
  assert.ok(parsed.players, 'it must be a players filter');
  assert.ok(parsed.players.limit >= 11617,
    'the limit is ignored today, but must exceed the real player count so a future ESPN honouring it cannot truncate us');
  assert.match(seen[0].url, /view=kona_player_info/);
});

test('the exported filter constant is the one actually sent', () => {
  const parsed = JSON.parse(PLAYER_FEED_FILTER);
  assert.ok(parsed.players.limit >= 11617);
});
