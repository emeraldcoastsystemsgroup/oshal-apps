/**
 * The weekly lineup optimiser against brute force.
 *
 * WHY THIS EXISTS. Every number this package produces rests on L(R, w) — the best legal starting
 * lineup a roster can field in a week. The start/sit advice is its diff against the lineup as set,
 * the opponent's moments are THEIR L, and the rest-of-season value is a sum of L over the weeks that
 * remain. The optimiser moved here from sports-edge was greedy-by-scarcity plus bench swaps and was
 * documented as "reaches the true optimum in practice". Against brute force it did not: over 3,000
 * random rosters it fielded a lower total on 6, by up to 21 points, whenever a dual-position player
 * met two flexible slots. So the guard is not "the optimiser returns a lineup", it is "the optimiser
 * returns the SAME total an exhaustive search does", on rosters shaped to hit the hard cases.
 *
 * The objective both sides use: fill as many openings as the roster legally can, then maximise
 * points. The brute force enumerates every assignment (including leaving an opening empty) and
 * keeps the best (filled, points) pair, so it cannot share a bug with the optimiser it judges.
 *
 * Run from the package root: node --test "tests/*-*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — optimiser exactness against exhaustive search over 3,000 seeded random rosters (dual-position players, RB/WR, FLEX and superflex slots, random slot counts), the smallest regression roster the moved greedy optimiser lost 10.9 points on (a dual RB/WR player taken at RB), unfillable openings left empty, and unavailable players never started.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { optimiseLineup } = require('../routes/fantasy-scoring.js');

/** One stat worth one point, so a player's stat line is his projection. */
const SCORING = [{ statId: 1, points: 1 }];

/** ESPN slot ids by position, as eligibleSlots carries them: 0 QB, 2 RB, 3 RB/WR, 4 WR, 6 TE, 7 OP, 16 D/ST, 17 K, 23 FLEX. */
const ELIGIBLE = {
  QB: [0, 7], RB: [2, 3, 23, 7], WR: [4, 3, 23, 7], TE: [6, 23, 7], K: [17], D: [16], RBWR: [2, 4, 3, 23, 7],
};
const KINDS = Object.keys(ELIGIBLE);
const SLOT_IDS = [0, 2, 3, 4, 6, 7, 16, 17, 23];

/** A small deterministic generator, so a failure names a reproducible case number. */
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/** A player with a one-stat projection. */
function player(id, kind, points) {
  return { playerId: id, name: `${kind}${id}`, eligibleSlots: ELIGIBLE[kind], projectedStats: { 1: points } };
}

/**
 * @description Exhaustive search: every assignment of players to openings, each opening either
 * filled by an eligible unused player or left empty. Keeps the best (filled count, points).
 * @param players - Roster.
 * @param slots - League slots.
 * @returns The best total among the lineups that fill the most openings.
 */
function bruteForce(players, slots) {
  const openings = [];
  for (const s of slots) for (let i = 0; i < s.count; i += 1) openings.push(s.slotId);
  // Every assignment, memoised on (opening, players already used): the value of the rest depends
  // on nothing else, so this visits each state once instead of re-walking shared suffixes.
  // Value = filled openings dominate (x 10,000), then points; rosters here stay under 1,000 points.
  const memo = new Map();
  const best = (i, used) => {
    if (i === openings.length) return 0;
    const key = i * 4096 + used;
    if (memo.has(key)) return memo.get(key);
    let value = best(i + 1, used);
    players.forEach((p, j) => {
      if (used & (1 << j) || !p.eligibleSlots.includes(openings[i])) return;
      value = Math.max(value, 10000 + p.projectedStats[1] + best(i + 1, used | (1 << j)));
    });
    memo.set(key, value);
    return value;
  };
  return Math.round((best(0, 0) % 10000) * 100) / 100;
}

/** A random roster and slot set for case `n`. */
function randomCase(n) {
  const r = seeded(n + 1);
  const size = 8 + Math.floor(r() * 4);
  const players = [];
  for (let i = 0; i < size; i += 1) {
    players.push(player(i + 1, KINDS[Math.floor(r() * KINDS.length)], Math.round(r() * 3000) / 100));
  }
  const slots = SLOT_IDS.filter(() => r() < 0.7).map((slotId) => ({ slotId, count: 1 + Math.floor(r() * 2) }));
  return { players, slots };
}

test('THE OPTIMISER IS EXACT — it matches exhaustive search on 3,000 hard random rosters', () => {
  const misses = [];
  for (let n = 0; n < 3000; n += 1) {
    const { players, slots } = randomCase(n);
    const got = optimiseLineup(players, slots, SCORING).total;
    const want = bruteForce(players, slots);
    if (Math.abs(got - want) > 0.011) misses.push(`case ${n}: optimiser ${got}, exhaustive ${want}`);
  }
  assert.deepEqual(misses, [], 'every weekly optimum the season value sums must be the true one');
});

test('A DUAL RB/WR PLAYER BELONGS AT WR WHEN THE RB SLOT HAS ITS OWN STAR — the case greedy lost 10.9 on', () => {
  // The smallest roster the brute-force search shrank a greedy failure to. Greedy filled the RB slot
  // first with the best RB-eligible player (the dual one), which left the WR slot to a 12.7 receiver
  // and the 23.6 running back on the bench: 37.1 where 48.0 was available.
  const players = [player(1, 'WR', 12.7), player(2, 'RB', 23.6), player(3, 'RBWR', 24.4)];
  const slots = [{ slotId: 2, count: 1 }, { slotId: 4, count: 1 }];
  const lineup = optimiseLineup(players, slots, SCORING);
  assert.equal(lineup.total, 48, 'the RB starts at RB and the dual player at WR');
  assert.equal(lineup.starters.find((s) => s.slotId === 4).player.playerId, 3);
  assert.equal(lineup.total, bruteForce(players, slots));
});

test('an opening nobody can legally fill is left empty, and nobody is started out of position', () => {
  const players = [player(1, 'RB', 20), player(2, 'RB', 10)];
  const lineup = optimiseLineup(players, [{ slotId: 2, count: 1 }, { slotId: 17, count: 1 }], SCORING);
  assert.equal(lineup.starters.length, 1);
  assert.equal(lineup.starters[0].slotId, 2);
  assert.equal(lineup.starters[0].player.playerId, 1);
  for (const s of lineup.starters) assert.ok(s.player.eligibleSlots.includes(s.slotId));
});

test('an unavailable player is never started, even when the exact search would want him', () => {
  const out = { ...player(1, 'RB', 40), injuryStatus: 'OUT' };
  const lineup = optimiseLineup([out, player(2, 'RB', 5)], [{ slotId: 2, count: 1 }], SCORING);
  assert.equal(lineup.starters[0].player.playerId, 2);
  assert.equal(lineup.bench.some((b) => b.player.playerId === 1), false, 'an OUT player is excluded, not benched');
});

test('every opening a roster CAN fill is filled before points are compared', () => {
  // The kicker is worth little, but an empty K slot scores nothing at all.
  const players = [player(1, 'K', 1), player(2, 'RB', 20)];
  const lineup = optimiseLineup(players, [{ slotId: 2, count: 1 }, { slotId: 17, count: 1 }], SCORING);
  assert.equal(lineup.starters.length, 2);
  assert.equal(lineup.total, 21);
});
