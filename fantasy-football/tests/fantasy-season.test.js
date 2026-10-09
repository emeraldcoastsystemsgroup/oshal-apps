/**
 * Guards for rest-of-season value — SV(R, W) and MV(c | R), the function waivers, trades and
 * drafting all rest on — and for the season plan that feeds it.
 *
 * The failure this module can have is quiet: a season value that is a plausible number built on the
 * wrong weekly lineups. So the first guard compares SV with the weighted sum of EXHAUSTIVE weekly
 * optima on random rosters, and the rest pin the things the operator's roster actually depends on —
 * a bye collision costs exactly the week it empties, a third running back is worth only the weeks he
 * would start, the league's scoring rules change the answer, and replacement level is the league's
 * own shape rather than a rank.
 *
 * Run from the package root: node --test "tests/*-*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — SV equals the weighted sum of exhaustive weekly optima on 400 seeded rosters and plans; bye collisions, the third running back, two-rule scoring, the least-costly drop, replacement level by league shape; and the plan's provenance, bye table, lasting and non-lasting injuries, and the rate for a player on a bye this week.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Weeks sharing a signature are solved once with the same season value (4 solves for 15 weeks with two byes), and an idle player is a zero-cost drop, the least projected first, found without another solve.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dropCandidate, marginalValue, replacementLevel, seasonValue, swapValue, weeksStarted } = require('../routes/fantasy-season.js');
const { buildSeasonPlan } = require('../routes/fantasy-plan.js');

/** One stat worth one point. */
const ONE = [{ statId: 1, points: 1 }];
const E = { QB: [0, 7], RB: [2, 3, 23, 7], WR: [4, 3, 23, 7], TE: [6, 23, 7] };

/** A player with a one-stat projection. */
function p(id, kind, points, extra = {}) {
  return { playerId: id, name: `${kind}${id}`, eligibleSlots: E[kind], projectedStats: { 1: points }, defaultPositionId: { QB: 1, RB: 2, WR: 3, TE: 4 }[kind], ...extra };
}

/** A plan from a per-week table: weeks[w][id] = player or undefined (not playing). */
function planOf(weeks, slots, scoring = ONE) {
  const list = Object.keys(weeks).map(Number).sort((a, b) => a - b);
  return {
    weeks: list.map((week) => ({ week, weight: 1 })), slots, scoring,
    playerFor: (id, week) => (weeks[week] || {})[id] || null,
  };
}

/** Exhaustive best weekly lineup (fill first, then points), memoised on (opening, used). */
function exhaustive(players, slots) {
  const openings = [];
  for (const s of slots) for (let i = 0; i < s.count; i += 1) openings.push(s.slotId);
  const memo = new Map();
  const best = (i, used) => {
    if (i === openings.length) return 0;
    const key = i * 4096 + used;
    if (memo.has(key)) return memo.get(key);
    let v = best(i + 1, used);
    players.forEach((pl, j) => {
      if (used & (1 << j) || !pl.eligibleSlots.includes(openings[i])) return;
      v = Math.max(v, 10000 + pl.projectedStats[1] + best(i + 1, used | (1 << j)));
    });
    memo.set(key, v);
    return v;
  };
  return best(0, 0) % 10000;
}

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

test('SV IS THE WEIGHTED SUM OF EXHAUSTIVE WEEKLY OPTIMA — 400 seeded rosters over 1-5 weeks', () => {
  const kinds = Object.keys(E);
  const misses = [];
  for (let n = 0; n < 400; n += 1) {
    const r = seeded(n + 7);
    const ids = Array.from({ length: 6 + Math.floor(r() * 5) }, (_, i) => i + 1);
    const base = ids.map((id) => p(id, kinds[Math.floor(r() * kinds.length)], 1));
    const slots = [0, 2, 3, 4, 6, 7, 23].filter(() => r() < 0.6).map((slotId) => ({ slotId, count: 1 + Math.floor(r() * 2) }));
    const weeks = {};
    const weights = {};
    for (let w = 1; w <= 1 + Math.floor(r() * 5); w += 1) {
      weeks[w] = {};
      weights[w] = r() < 0.3 ? 1.5 : 1;
      for (const b of base) if (r() > 0.2) weeks[w][b.playerId] = { ...b, projectedStats: { 1: Math.round(r() * 3000) / 100 } };
    }
    const plan = planOf(weeks, slots);
    plan.weeks = plan.weeks.map((w) => ({ ...w, weight: weights[w.week] }));
    const want = Math.round(plan.weeks.reduce((s, w) => s + w.weight * exhaustive(Object.values(weeks[w.week]), slots), 0) * 100) / 100;
    const got = seasonValue(ids, plan).total;
    if (Math.abs(got - want) > 0.02) misses.push(`case ${n}: SV ${got}, exhaustive ${want}`);
  }
  assert.deepEqual(misses, []);
});

test('A BYE COLLISION PRICES ITSELF — the week both quarterbacks are off costs exactly that week', () => {
  const slots = [{ slotId: 0, count: 1 }];
  const qb1 = p(1, 'QB', 20);
  const sameBye = p(2, 'QB', 12);
  const otherBye = p(3, 'QB', 12);
  // Week 2 is qb1's bye. Backup 2 shares it; backup 3 is off in week 3 instead.
  const weeks = { 1: { 1: qb1, 2: sameBye, 3: otherBye }, 2: { 3: otherBye }, 3: { 1: qb1, 2: sameBye } };
  const plan = planOf(weeks, slots);
  assert.equal(marginalValue(2, [1], plan), 0, 'a backup on the same bye never plays a down for you');
  assert.equal(marginalValue(3, [1], plan), 12, 'a backup on another bye is worth exactly the week he covers');
});

test('A THIRD RUNNING BACK IS WORTH ONLY THE WEEKS HE WOULD START', () => {
  const slots = [{ slotId: 2, count: 2 }];
  const rb1 = p(1, 'RB', 18);
  const rb2 = p(2, 'RB', 15);
  const rb3 = p(3, 'RB', 9);
  // rb1 is out in week 2, rb2 in week 4: the third back starts in exactly those two weeks.
  const weeks = { 1: { 1: rb1, 2: rb2, 3: rb3 }, 2: { 2: rb2, 3: rb3 }, 3: { 1: rb1, 2: rb2, 3: rb3 }, 4: { 1: rb1, 3: rb3 } };
  const plan = planOf(weeks, slots);
  assert.equal(marginalValue(3, [1, 2], plan), 18, '9 + 9: weeks 2 and 4, and nothing for the weeks he sits');
  assert.deepEqual(weeksStarted(3, seasonValue([1, 2, 3], plan)), [2, 4]);
});

test('THE LEAGUE\'S SCORING CHANGES THE SEASON VALUE — no rule is assumed', () => {
  const slots = [{ slotId: 4, count: 1 }];
  const wr = { ...p(1, 'WR', 0), projectedStats: { 42: 80, 53: 6 } };
  const plan = (scoring) => planOf({ 1: { 1: wr }, 2: { 1: wr } }, slots, scoring);
  const ppr = seasonValue([1], plan([{ statId: 42, points: 0.1 }, { statId: 53, points: 1 }])).total;
  const standard = seasonValue([1], plan([{ statId: 42, points: 0.1 }])).total;
  assert.equal(ppr, 28);
  assert.equal(standard, 16);
});

test('the drop candidate is the player whose removal costs least; a swap is priced as one', () => {
  const slots = [{ slotId: 2, count: 1 }, { slotId: 4, count: 1 }];
  const players = { 1: p(1, 'RB', 15), 2: p(2, 'WR', 12), 3: p(3, 'WR', 4), 4: p(4, 'RB', 20) };
  const plan = planOf({ 1: players, 2: players }, slots);
  assert.deepEqual(dropCandidate([1, 2, 3], plan), { playerId: 3, cost: 0 }, 'the bench receiver starts nowhere');
  assert.equal(swapValue(4, 3, [1, 2, 3], plan), 10, 'adding a 20-point back for the idle receiver gains 5 a week');
  assert.equal(swapValue(4, 2, [1, 2, 3], plan), -6, 'dropping the starting receiver instead loses 8 at WR to gain 5 at RB, each week');
});

test('REPLACEMENT LEVEL IS THE LEAGUE\'S OWN SHAPE — more teams, deeper baseline', () => {
  const pool = [];
  for (let i = 0; i < 40; i += 1) pool.push(p(100 + i, 'RB', 40 - i));
  for (let i = 0; i < 40; i += 1) pool.push(p(200 + i, 'WR', 30 - i / 2));
  const slots = [{ slotId: 2, count: 2 }, { slotId: 4, count: 2 }, { slotId: 23, count: 1 }];
  const ten = replacementLevel(pool, slots, ONE, 10);
  const twelve = replacementLevel(pool, slots, ONE, 12);
  assert.ok(twelve.byPosition[2] < ten.byPosition[2], 'a 12-team league reaches further down the running backs');
  assert.equal(ten.starters[2] + ten.starters[3], 10 * 5, 'every opening of every team is filled');
  assert.ok(ten.starters[2] >= 20 && ten.starters[3] >= 20, 'the flex goes to whichever position is better, on top of the dedicated slots');
});

test('THE PLAN SAYS WHERE EACH WEEK CAME FROM — a cached week is priced from itself, the rest from the rate', () => {
  const current = { 1: p(1, 'RB', 10, { proTeamId: 7 }), 2: p(2, 'RB', 8, { proTeamId: 9 }) };
  const week6 = { 2: p(2, 'RB', 30, { proTeamId: 9 }) };
  const { plan, fromFeed, fromRate } = buildSeasonPlan({
    currentWeek: 4, lastWeek: 7, playoffStart: 7, playoffWeight: 2, feeds: new Map([[4, current], [6, week6]]),
    byes: { 7: 5 }, slots: [{ slotId: 2, count: 1 }], scoring: ONE,
  });
  assert.deepEqual(fromFeed, [4, 6]);
  assert.deepEqual(fromRate, [5, 7]);
  assert.deepEqual(plan.weeks.map((w) => w.weight), [1, 1, 1, 2], 'the playoff week counts double here');
  assert.equal(plan.playerFor(1, 5), null, 'the bye table empties week 5 for pro team 7');
  assert.equal(plan.playerFor(1, 6), null, 'week 6 was read, and player 1 is not in it');
  assert.equal(plan.playerFor(2, 6).projectedStats[1], 30, 'a read week is its own projection, not the rate');
  assert.equal(plan.playerFor(1, 7).projectedStats[1], 10, 'an unread week is the current rate');
});

test('OUT this week is not out for the season; injured reserve and suspension carry forward', () => {
  const current = { 1: p(1, 'RB', 10, { injuryStatus: 'OUT' }), 2: p(2, 'RB', 9, { injuryStatus: 'INJURY_RESERVE' }), 3: p(3, 'RB', 8, { injuryStatus: 'SUSPENSION' }) };
  const { plan } = buildSeasonPlan({ currentWeek: 3, lastWeek: 5, playoffStart: null, feeds: new Map([[3, current]]), byes: {}, slots: [{ slotId: 2, count: 1 }], scoring: ONE });
  assert.equal(plan.playerFor(1, 3).injuryStatus, 'OUT', 'this week he is out');
  assert.equal(plan.playerFor(1, 4).injuryStatus, undefined, 'next week he is priced at his rate');
  assert.equal(plan.playerFor(2, 4).injuryStatus, 'INJURY_RESERVE');
  assert.equal(plan.playerFor(3, 5).injuryStatus, 'SUSPENSION');
  assert.equal(seasonValue([1, 2, 3], plan).total, 20, 'week 3 nobody available plays; weeks 4-5 the OUT back returns');
});

test('a player on a bye THIS week takes his rate from the nearest week that was read', () => {
  const lastWeek = { 5: p(5, 'WR', 14) };
  const { plan } = buildSeasonPlan({
    currentWeek: 6, lastWeek: 8, playoffStart: null, feeds: new Map([[6, {}], [5, lastWeek]]), byes: {}, slots: [{ slotId: 4, count: 1 }], scoring: ONE,
  });
  assert.equal(plan.playerFor(5, 6), null, 'week 6 was read and he is not in it: his bye');
  assert.equal(plan.playerFor(5, 7).projectedStats[1], 14, 'week 7 prices him from week 5, not as a player who never plays');
  assert.deepEqual(plan.weeks.map((w) => w.week), [6, 7, 8], 'week 5 supplies a rate but is not part of the plan');
});

test('WEEKS WITH THE SAME SIGNATURE ARE SOLVED ONCE — and the season value does not change', () => {
  const current = {};
  const kinds = ['RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'QB'];
  kinds.forEach((k, i) => { current[i + 1] = p(i + 1, k, 5 + i * 2, { proTeamId: (i % 3) + 1 }); });
  const built = buildSeasonPlan({
    currentWeek: 3, lastWeek: 17, playoffStart: 15, feeds: new Map([[3, current]]), byes: { 1: 6, 2: 9 },
    slots: [{ slotId: 0, count: 1 }, { slotId: 2, count: 2 }, { slotId: 4, count: 2 }, { slotId: 23, count: 1 }], scoring: ONE,
  });
  let solves = 0;
  const counted = { ...built.plan, playerFor: (id, w) => { solves += id === 1 ? 1 : 0; return built.plan.playerFor(id, w); } };
  const fast = seasonValue(Object.keys(current).map(Number), counted);
  const fastSolves = solves;
  solves = 0;
  const slow = seasonValue(Object.keys(current).map(Number), { ...counted, signature: undefined });
  assert.equal(fast.total, slow.total);
  assert.deepEqual(fast.weeks.map((w) => w.value), slow.weeks.map((w) => w.value));
  assert.equal(slow.weeks.length, 15);
  assert.equal(fastSolves, 4, 'the read week, the two bye weeks, and one for every other rate week');
});

test('A PLAYER WHO STARTS NOWHERE IS A ZERO-COST DROP — the least projected of them goes first', () => {
  const slots = [{ slotId: 2, count: 1 }];
  const players = { 1: p(1, 'RB', 20), 2: p(2, 'RB', 9), 3: p(3, 'RB', 3) };
  const plan = planOf({ 1: players, 2: players }, slots);
  assert.deepEqual(dropCandidate([1, 2, 3], plan), { playerId: 3, cost: 0 });
  assert.deepEqual(dropCandidate([1, 2, 3], plan, undefined, [3]), { playerId: 2, cost: 0 });
  assert.deepEqual(dropCandidate([1], plan), { playerId: 1, cost: 40 }, 'with nobody idle, each removal is priced in full');
});
