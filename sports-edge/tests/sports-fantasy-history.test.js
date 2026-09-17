/**
 * Guards for the scoring history — the input that makes one player's spread differ from another's.
 *
 * THE BUG THIS EXISTS TO PREVENT IS A SILENT ONE, and it already shipped once. The win-probability
 * objective trades projected points for variance, and every spread was a positional prior times a
 * projection, so two running backs projected at 13.2 and 13.1 came out at 7.26 and 7.21. The
 * objective was arithmetically correct over inputs that could not differ: the first live run against
 * a real league (2026-09-09, posture underdog, 40.4% to win) made ZERO variance swaps and returned
 * exactly the highest-projected lineup. Nothing was thrown, nothing was logged, and the feature
 * looked like it worked.
 *
 * So every test below is written so that it FAILS IF THE HISTORY STOPS REACHING THE OPTIMISER, not
 * merely if a function throws. The two that matter are a MATCHED PAIR, each with a companion run in
 * which the history is withheld and the same roster must fall back to the highest-projected lineup:
 *
 *   - a big UNDERDOG must move to the volatile player, and only a real scoring history can tell the
 *     optimiser which one that is;
 *   - a big FAVOURITE must move to the steady one — because a test that only proves "variance goes
 *     up" is satisfied by a bug that always maximises variance, which would hand a winning team a
 *     coin flip every week.
 *
 * Both run the real chain the route runs: an ESPN-shaped feed -> distilProjections/distilPlayerWeeks
 * -> historyFor under the league's own scoring -> joinRoster -> optimiseForWin. The only thing
 * doubled is the database round trip, which is why the two store tests below assert the statements'
 * scope rather than claiming the table is proved.
 *
 * The feed fixture is shaped from the live response of 2026-09-16 (one credential-free request for
 * scoringPeriodId=3 returned 11,617 players, 1,740 week-1 rows with statSourceId 0 / statSplitTypeId
 * 1, and 69,653 rows from the PRIOR season).
 *
 * Run from the package root: node --test "tests/*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — completed-week extraction (prior season, projections and season totals all excluded), per-league scoring of the history, the roster join attaching it, the underdog/favourite matched pair each with a history-withheld companion, and the store statements' season/week/player scope.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Drive the REAL compiled GET /fantasy/lineup, because the route is what broke. Every case above exercises the chain one level below the defect: the shipped bug was a handler that never read a history, and reverting registerLineupRoute's three lines — or writePlayerWeeks from the refresh — left all twenty package tests green. The matched pair now runs through the registered handler, the real ESPN client, the real store statements and the real objective, with only the database round trip doubled; withholding the completed weeks from the feed must bring the highest-projected lineup back.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  distilPlayerWeeks, distilProjections,
} = require('../routes/sports-fantasy-espn.js');
const { historyFor, joinRoster } = require('../routes/sports-fantasy-roster.js');
const { optimiseForWin } = require('../routes/sports-fantasy-winprob.js');
const {
  PLAYER_WEEK_CHUNK, readPlayerWeeks, writePlayerWeeks,
} = require('../routes/sports-fantasy-store.js');

const SEASON = 2026;
/** The week being set. Its own actuals are partial, so history is everything strictly before it. */
const WEEK = 5;
/** One stat worth one point, so a stat line reads as its own point total. */
const SIMPLE = [{ statId: 0, points: 1 }];
/** One running-back slot, so exactly one of the two candidates can start. */
const SLOTS = [{ slotId: 2, count: 1 }];

/**
 * An ESPN-shaped player carrying every row type the live feed mixes together: this season's weekly
 * projections (statSourceId 1), this season's completed weeks (statSourceId 0, statSplitTypeId 1),
 * the season TOTAL (statSplitTypeId 0, scoringPeriodId 0) and last season's weeks.
 */
function feedPlayer(id, name, projection, weeklyActuals) {
  const stats = [
    { seasonId: SEASON, statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: WEEK, stats: { 0: projection } },
    { seasonId: SEASON, statSourceId: 0, statSplitTypeId: 0, scoringPeriodId: 0, stats: { 0: 999 } },
    { seasonId: SEASON - 1, statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: 1, stats: { 0: 111 } },
    { seasonId: SEASON, statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: WEEK, stats: {} },
  ];
  weeklyActuals.forEach((points, i) => stats.push({
    seasonId: SEASON, statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: i + 1, stats: { 0: points },
  }));
  return { player: { id, fullName: name, defaultPositionId: 2, eligibleSlots: [2, 20], stats } };
}

/** Weeks that hardly vary — the steady starter. */
const STEADY_WEEKS = [12, 13, 12, 12];
/** Weeks that are either nothing or a blow-up — the boom/bust player. */
const BOOM_WEEKS = [0, 26, 1, 25];

/** Roster entries as the league read returns them: both candidates on the bench-eligible roster. */
const ENTRIES = [{ playerId: 1, lineupSlotId: 2, player: {} }, { playerId: 2, lineupSlotId: 20, player: {} }];

/**
 * The whole chain the route runs, from one feed to one recommendation.
 * @param steadyProjection points projected for the steady player this week
 * @param boomProjection points projected for the boom/bust player this week
 * @param opponent the opposing lineup's moments
 * @param withHistory false to withhold the accumulated weeks, as the package behaved before it had any
 */
function recommend(steadyProjection, boomProjection, opponent, withHistory = true) {
  const feed = [
    feedPlayer(1, 'Steady', steadyProjection, STEADY_WEEKS),
    feedPlayer(2, 'Boom', boomProjection, BOOM_WEEKS),
  ];
  const projections = distilProjections(feed, SEASON, WEEK);
  // The store bounds this in SQL (`week < $2`); the fixture applies the same bound so the current
  // week's partial line cannot enter the sample here either.
  const rows = distilPlayerWeeks(feed, SEASON).filter((r) => r.week < WEEK);
  const history = withHistory ? historyFor(rows, SIMPLE) : undefined;
  const roster = joinRoster(ENTRIES, projections, history);
  return { roster, win: optimiseForWin(roster, SLOTS, SIMPLE, opponent) };
}

/** Who a lineup actually starts. */
function starter(lineup) {
  return lineup.starters[0].player.name;
}

test('A BIG UNDERDOG MOVES TO THE VOLATILE PLAYER — and only the history knows which one that is', () => {
  // Steady projects a hair higher, so the points-maximising lineup starts him. The swap can only be
  // explained by the spreads, and the spreads can only differ because real weeks were accumulated.
  const opponent = { mean: 25, sd: 8 };
  const withHistory = recommend(13.2, 13.1, opponent);
  assert.equal(starter(withHistory.win.meanLineup), 'Steady', 'the highest-projected lineup starts Steady');
  assert.equal(withHistory.win.posture, 'underdog');
  assert.equal(starter(withHistory.win.lineup), 'Boom', 'the underdog needs the tail, not the average');
  assert.ok(withHistory.win.moments.sd > withHistory.win.meanMoments.sd, 'the recommended lineup is the more volatile one');
  assert.ok(withHistory.win.winProbability > withHistory.win.meanWinProbability, 'and it is likelier to win');
  assert.equal(withHistory.win.swaps.length, 1);
  assert.ok(withHistory.win.swaps[0].winGain > 0, 'the swap reports what it bought');
  assert.ok(withHistory.win.swaps[0].meanCost > 0, 'and admits the projected points it cost');

  // THE COMPANION RUN. Same roster, same opponent, history withheld: both spreads collapse to the
  // positional prior times a projection, they are within a rounding error of each other, and the
  // recommendation is the highest-projected lineup. This is what the package did before it
  // accumulated anything, and it is what a broken wiring would silently return again.
  const without = recommend(13.2, 13.1, opponent, false);
  assert.equal(starter(without.win.lineup), 'Steady', 'with no history there is nothing to trade');
  assert.equal(without.win.swaps.length, 0);
});

test('A BIG FAVOURITE MOVES TO THE STEADY PLAYER — the same input must point the other way', () => {
  // Boom projects a hair higher this time, so the points-maximising lineup starts HIM and the
  // objective has to give up projected points to refuse the coin flip.
  const opponent = { mean: 5, sd: 3 };
  const withHistory = recommend(13.1, 13.2, opponent);
  assert.equal(starter(withHistory.win.meanLineup), 'Boom', 'the highest-projected lineup starts Boom');
  assert.equal(withHistory.win.posture, 'favourite');
  assert.equal(starter(withHistory.win.lineup), 'Steady', 'a favourite refuses the variance');
  assert.ok(withHistory.win.moments.sd < withHistory.win.meanMoments.sd, 'the recommended lineup is the steadier one');
  assert.ok(withHistory.win.winProbability > withHistory.win.meanWinProbability);

  const without = recommend(13.1, 13.2, opponent, false);
  assert.equal(starter(without.win.lineup), 'Boom', 'with no history the favourite keeps the coin flip');
  assert.equal(without.win.swaps.length, 0);
});

test('the completed weeks come out of the feed the refresh already fetched', () => {
  const feed = [feedPlayer(1, 'Steady', 13.2, STEADY_WEEKS)];
  const rows = distilPlayerWeeks(feed, SEASON);
  assert.deepEqual(rows.map((r) => r.week), [1, 2, 3, 4], 'one row per completed week, and nothing else');
  assert.deepEqual(rows.map((r) => r.stats[0]), STEADY_WEEKS);
  assert.ok(rows.every((r) => r.playerId === 1));
});

test('LAST SEASON IS NOT THIS SEASON — the prior year is the biggest block of rows in the response', () => {
  const feed = [feedPlayer(1, 'Steady', 13.2, STEADY_WEEKS)];
  assert.equal(distilPlayerWeeks(feed, SEASON).some((r) => r.stats[0] === 111), false,
    "the 2025 week-1 row must not enter 2026's history");
  const priorOnly = distilPlayerWeeks(feed, SEASON - 1);
  assert.deepEqual(priorOnly.map((r) => r.stats[0]), [111], 'it is kept for its own season, not discarded blindly');
});

test('a projection is not an observation, and a season total is not a week', () => {
  const feed = [feedPlayer(1, 'Steady', 13.2, STEADY_WEEKS)];
  const rows = distilPlayerWeeks(feed, SEASON);
  assert.equal(rows.some((r) => r.stats[0] === 13.2), false, 'statSourceId 1 is ESPN modelling itself');
  assert.equal(rows.some((r) => r.stats[0] === 999), false, 'the season total would enter as one enormous week');
  assert.equal(rows.some((r) => r.week === 0), false);
  assert.equal(rows.some((r) => !Object.keys(r.stats).length), false, 'an empty line is not a zero-point week');
});

test('the history is scored under THE LEAGUE\'S rules, like everything else in this package', () => {
  const rows = [
    { playerId: 7, week: 2, stats: { 24: 100, 53: 4 } },
    { playerId: 7, week: 1, stats: { 24: 50, 53: 8 } },
  ];
  const ppr = historyFor(rows, [{ statId: 24, points: 0.1 }, { statId: 53, points: 1 }]);
  const standard = historyFor(rows, [{ statId: 24, points: 0.1 }]);
  assert.deepEqual(ppr.get(7), [13, 14], 'oldest week first, receptions counted');
  assert.deepEqual(standard.get(7), [5, 10], 'the same two weeks are different numbers in a different league');
});

test('the roster join carries the history, and says nothing when there is none', () => {
  const feed = [feedPlayer(1, 'Steady', 13.2, STEADY_WEEKS), feedPlayer(2, 'Boom', 13.1, [])];
  const projections = distilProjections(feed, SEASON, WEEK);
  const history = historyFor(distilPlayerWeeks(feed, SEASON), SIMPLE);
  const roster = joinRoster(ENTRIES, projections, history);
  assert.deepEqual(roster[0].pointsHistory, STEADY_WEEKS);
  assert.equal(roster[1].pointsHistory, undefined,
    'absent, not an empty array: "have not measured" is not "measured nothing"');
  assert.equal(roster[0].defaultPositionId, 2, 'the position prior still arrives');
  assert.equal(joinRoster(ENTRIES, projections)[0].pointsHistory, undefined, 'and no history means no history');
});

/** A pool that records what it was asked, so a statement's scope can be asserted without a server. */
function recordingPool(rows = []) {
  const calls = [];
  return { calls, query: async (text, params) => { calls.push({ text, params }); return { rows, rowCount: rows.length }; } };
}

test('the history read is bounded to the season, the weeks already played, and the roster', async () => {
  const pool = recordingPool([{ week: 1, player_id: 3, stats: { 0: 12 } }]);
  const out = await readPlayerWeeks(pool, SEASON, WEEK, [3, 3, 4, Number.NaN]);
  assert.deepEqual(out, [{ playerId: 3, week: 1, stats: { 0: 12 } }]);
  const { text, params } = pool.calls[0];
  assert.match(text, /week < \$2/, 'the week being set is in progress and must stay out of its own history');
  assert.match(text, /player_id = ANY\(\$3::int\[\]\)/, 'a roster, never the universe');
  assert.deepEqual(params, [SEASON, WEEK, [3, 4]], 'ids de-duplicated, non-numbers dropped');
  assert.equal((await readPlayerWeeks(recordingPool(), SEASON, WEEK, [])).length, 0);
  assert.equal(pool.calls.length, 1, 'an empty roster asks the database nothing');
});

test('a season of player-weeks is written in bounded chunks, each row carrying its own four parameters', async () => {
  const pool = recordingPool();
  const rows = Array.from({ length: PLAYER_WEEK_CHUNK * 2 + 1 }, (_, i) => ({
    playerId: i, week: (i % 4) + 1, stats: { 0: i },
  }));
  await writePlayerWeeks(pool, SEASON, rows);
  assert.equal(pool.calls.length, 3, 'two full chunks and the remainder');
  assert.equal(pool.calls[0].params.length, PLAYER_WEEK_CHUNK * 4);
  assert.equal(pool.calls[2].params.length, 4);
  assert.match(pool.calls[0].text, /ON CONFLICT \(season, week, player_id\) DO UPDATE/,
    're-reading a completed week must not duplicate it');
  // The last row's placeholders must point at the last row's values — an off-by-one in the
  // placeholder base would write every row under a neighbour's key and look entirely normal.
  const last = pool.calls[2];
  assert.equal(last.text.includes('($1,$2,$3,$4)'), true);
  assert.deepEqual(last.params, [SEASON, rows[rows.length - 1].week, rows[rows.length - 1].playerId,
    JSON.stringify(rows[rows.length - 1].stats)]);
  assert.equal(pool.calls.every((c) => !/\d{4,}/.test(c.text.split('VALUES')[0])), true,
    'nothing is interpolated into the statement itself');
});

/* ---------------------------------------------------------------------------------------------
 * THE ROUTE IS THE THING THAT BROKE, SO THE ROUTE IS WHAT THESE LAST CASES DRIVE.
 *
 * Everything above proves the chain works when it is handed the right inputs. That is one level
 * BELOW the defect: the bug behind the 2026-09-09 live run — posture underdog, 40.4% to win, zero
 * variance swaps — was not a wrong calculation, it was a route that never fetched a history to
 * calculate over. Deleting `readPlayerWeeks` -> `historyFor` -> `joinRoster(..., history)` from the
 * handler, or `writePlayerWeeks` from the refresh, leaves every case above green.
 *
 * So these two drive the real compiled `GET /fantasy/lineup` end to end: the handler the package
 * registers, the real ESPN client, the real distillation, the real store statements, the real join
 * and the real objective. The ONE doubled boundary is the database round trip — a table keyed by
 * (season, week, player_id) whose rows the route writes on the refresh and reads back on the
 * lineup — so the write and the read are both exercised through the statements the store issues.
 * That double, and the real companion it still owes, are recorded in the core repository's
 * docs/governance/real-boundary-regression-audit.md.
 *
 * The pair is matched the same way as above: the SECOND run changes exactly one thing about the
 * world — the feed carries no completed weeks, so there is nothing for the route to accumulate —
 * and the same roster must come back with the highest-projected lineup and no swaps. A wiring that
 * silently drops the history returns THAT answer to the first run too, which is the failure this
 * whole change exists to prevent.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const ROUTES = path.resolve(__dirname, '..', 'routes', 'sports-fantasy-routes.js');
const ROUTE_SEASON = 2026;
const ROUTE_WEEK = 5;
const LEAGUE = '778899';
const SECRET = '{SWID-MINE}:espn-s2-cookie-value';

/**
 * @description Load the compiled fantasy routes with ONLY the framework modules the package imports
 * replaced. `./sports-refresh` reaches the World service for one season default and is replaced too;
 * every ESPN-facing and store-facing module is the shipped compiled code.
 * @param sub - The caller subject the route should see.
 * @returns The module's exports.
 */
function loadFantasyRoutes(sub) {
  const nativeRequire = createRequire(ROUTES);
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };
  const overrides = {
    '@/shared/logger': { createChildLogger: () => quiet },
    '@/app/routes/trading-routes-helpers': { callerSub: () => sub },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => SECRET },
    './sports-refresh': { currentSeason: () => ROUTE_SEASON },
  };
  const target = { exports: {} };
  const wrapper = new vm.Script(
    `(function(require,module,exports){${fs.readFileSync(ROUTES, 'utf8')}\n})`, { filename: ROUTES },
  );
  wrapper.runInThisContext()((name) => overrides[name] || nativeRequire(name), target, target.exports);
  return target.exports;
}

/** Collects the handlers the router registers so one can be driven directly. */
function routerDouble() {
  const routes = new Map();
  const add = (method) => (route, handler) => { routes.set(`${method} ${route}`, handler); };
  return { routes, get: add('GET'), post: add('POST'), delete: add('DELETE') };
}

/** Records the status and body the handler answered with. */
function responseDouble() {
  const out = { code: 200, body: null };
  out.status = (n) => { out.code = n; return out; };
  out.json = (b) => { out.body = b; return out; };
  return out;
}

/**
 * @description The two tables this path touches, served from memory: the projection cache and
 * `sports_fantasy_player_weeks`. The player-week half is a real round trip through the store's own
 * statements — the INSERT is decoded from the parameters the route actually sent, and the SELECT is
 * answered under the same season/week/roster bounds — so a route that never writes, or never reads,
 * finds nothing here exactly as it would against PostgreSQL.
 * @returns A pool double, the rows it is holding, and every statement it was asked.
 */
function lineupPool() {
  const projections = new Map();
  const playerWeeks = new Map();
  const statements = [];
  return {
    playerWeeks,
    statements,
    async query(sql, params = []) {
      const text = String(typeof sql === 'string' ? sql : sql.text);
      const p = typeof sql === 'string' ? params : sql.values;
      statements.push(text);
      if (/INSERT INTO sports_fantasy_projections/.test(text)) {
        projections.set(`${p[0]}:${p[1]}`, {
          payload: JSON.parse(p[2]), players: p[3], generated_at: new Date().toISOString(),
        });
        return { rows: [], rowCount: 1 };
      }
      if (/FROM sports_fantasy_projections/.test(text)) {
        const row = projections.get(`${p[0]}:${p[1]}`);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (/INSERT INTO sports_fantasy_player_weeks/.test(text)) {
        // Four parameters per row, in the order the store builds them.
        for (let i = 0; i < p.length; i += 4) {
          playerWeeks.set(`${p[i]}:${p[i + 1]}:${p[i + 2]}`, {
            season: p[i], week: p[i + 1], player_id: p[i + 2], stats: JSON.parse(p[i + 3]),
          });
        }
        return { rows: [], rowCount: p.length / 4 };
      }
      if (/FROM sports_fantasy_player_weeks/.test(text)) {
        const [season, beforeWeek, ids] = p;
        const rows = [...playerWeeks.values()]
          .filter((r) => r.season === season && r.week < beforeWeek && ids.includes(r.player_id))
          .sort((a, b) => a.week - b.week)
          .map((r) => ({ week: r.week, player_id: r.player_id, stats: r.stats }));
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

/** One player in the public feed's shape, with or without completed weeks behind him. */
function feedEntry(id, name, slot, position, projection, weeklyActuals) {
  const stats = [{
    seasonId: ROUTE_SEASON, scoringPeriodId: ROUTE_WEEK, statSourceId: 1, statSplitTypeId: 1,
    stats: { 0: projection },
  }];
  weeklyActuals.forEach((points, i) => stats.push({
    seasonId: ROUTE_SEASON, scoringPeriodId: i + 1, statSourceId: 0, statSplitTypeId: 1,
    stats: { 0: points },
  }));
  return { id, fullName: name, eligibleSlots: [slot, 20], defaultPositionId: position, proTeamId: 1, stats };
}

/** One roster entry in the league read's shape. */
function rosterEntry(playerId, name, slot, position) {
  return {
    playerId,
    lineupSlotId: slot,
    playerPoolEntry: {
      player: { id: playerId, fullName: name, eligibleSlots: [2, 20], defaultPositionId: position },
    },
  };
}

/** One QB and one RB start; everything else is bench. */
const LEAGUE_SETTINGS = {
  scoringPeriodId: ROUTE_WEEK,
  settings: {
    name: 'History Route League',
    scoringSettings: { scoringItems: [{ statId: 0, points: 1 }] },
    rosterSettings: { lineupSlotCounts: { 0: 1, 2: 1, 20: 4 } },
  },
};

const ROUTE_TEAMS = {
  teams: [
    {
      id: 1,
      name: 'Mine',
      abbrev: 'ME',
      owners: ['{SWID-MINE}'],
      roster: {
        entries: [
          rosterEntry(11, 'QB One', 0, 1),
          rosterEntry(12, 'Steady', 2, 2),
          rosterEntry(13, 'Boom', 20, 2),
        ],
      },
    },
    {
      id: 2,
      name: 'Theirs',
      abbrev: 'TH',
      owners: ['{SWID-OTHER}'],
      roster: { entries: [rosterEntry(21, 'QB Two', 0, 1), rosterEntry(22, 'RB Two', 2, 2)] },
    },
  ],
};

/** Week 5 fixture: team 1 plays team 2, so there is a real opponent to be an underdog against. */
const ROUTE_SCHEDULE = {
  schedule: [{ matchupPeriodId: ROUTE_WEEK, home: { teamId: 1 }, away: { teamId: 2 } }],
};

/**
 * @description Build the public player feed. `withWeeks` is the ONLY difference between the two runs:
 * false means the response carries projections and no completed weeks, which is the world this
 * package lived in before it accumulated any.
 * @param withWeeks - Whether the completed weeks ride along in the response.
 * @returns The feed array.
 */
function routeFeed(withWeeks) {
  return [
    feedEntry(11, 'QB One', 0, 1, 20, []),
    feedEntry(12, 'Steady', 2, 2, 13.2, withWeeks ? STEADY_WEEKS : []),
    feedEntry(13, 'Boom', 2, 2, 13.1, withWeeks ? BOOM_WEEKS : []),
    // The opponent projects far higher, which is what makes this team a big underdog.
    feedEntry(21, 'QB Two', 0, 1, 34, []),
    feedEntry(22, 'RB Two', 2, 2, 34, []),
  ];
}

/** Serves the four ESPN reads this route makes; an unmatched url is a fixture failure. */
function routeFetch(feed) {
  const rules = [
    ['view=mSettings', LEAGUE_SETTINGS],
    ['view=mRoster', ROUTE_TEAMS],
    ['view=mMatchup', ROUTE_SCHEDULE],
    ['/players?', feed],
  ];
  return async (url) => {
    const target = String(url);
    for (const [fragment, answer] of rules) {
      if (target.includes(fragment)) return { ok: true, status: 200, json: async () => answer };
    }
    throw new assert.AssertionError({ message: `unstubbed ESPN url: ${target}` });
  };
}

/**
 * @description Drive the real GET /fantasy/lineup handler once, over a fresh pool.
 * @param withWeeks - Whether the feed carries the completed weeks.
 * @returns The recorded response and the pool it ran against.
 */
async function lineupRoute(withWeeks) {
  const mod = loadFantasyRoutes('sub-history-route-test');
  const router = routerDouble();
  const pool = lineupPool();
  mod.registerFantasyRoutes(router, pool);
  const handler = router.routes.get('GET /fantasy/lineup');
  assert.ok(handler, 'the package must register GET /fantasy/lineup');
  const previous = globalThis.fetch;
  globalThis.fetch = routeFetch(routeFeed(withWeeks));
  try {
    const res = responseDouble();
    await handler(
      { query: { season: ROUTE_SEASON, leagueId: LEAGUE, week: ROUTE_WEEK }, params: {}, body: {}, headers: {} },
      res,
    );
    return { res, pool };
  } finally {
    globalThis.fetch = previous;
  }
}

/** Who a served lineup actually starts in the RB slot. */
function routeStarter(lineup) {
  const rb = lineup.starters.find((s) => s.slotId === 2);
  assert.ok(rb, 'the served lineup must fill the RB slot');
  return rb.player.name;
}

test('THE ROUTE ITSELF ACCUMULATES THE WEEKS AND SPENDS THEM — not just the chain underneath it', async () => {
  const { res, pool } = await lineupRoute(true);
  assert.equal(res.code, 200, res.body && res.body.error);

  // THE SERVED ANSWER FIRST, because that is the thing an operator sees: the spread model got a
  // measurement, so the underdog takes the tail. This assertion alone fails on either revert.
  assert.equal(res.body.matchup.posture, 'underdog');
  assert.equal(routeStarter(res.body.meanOptimal), 'Steady', 'the highest-projected lineup starts Steady');
  assert.equal(routeStarter(res.body.optimal), 'Boom', 'the served recommendation moves to the volatile player');
  assert.equal(res.body.matchup.swaps.length, 1);
  assert.ok(res.body.matchup.winProbability > res.body.matchup.meanWinProbability,
    'and the swap is served with the win probability it bought');

  // Then the two halves of the wiring, named individually, so a revert says WHICH one went.
  assert.ok(pool.playerWeeks.size > 0, 'the refresh must persist the completed weeks it was handed');
  assert.ok(pool.statements.some((s) => /FROM sports_fantasy_player_weeks/.test(s)),
    'the lineup must READ the history back — a table nothing queries is not a feature');
});

test('and with no weeks to accumulate the SAME route returns the highest-projected lineup', async () => {
  // The companion run. One thing changes: the feed carries no completed weeks. This is what a route
  // that silently drops the history returns for BOTH runs, which is why the pair is the guard.
  const { res, pool } = await lineupRoute(false);
  assert.equal(res.code, 200, res.body && res.body.error);
  assert.equal(pool.playerWeeks.size, 0, 'nothing was played, so nothing may be stored');
  assert.equal(res.body.matchup.posture, 'underdog', 'the same big underdog, with nothing to trade');
  assert.equal(routeStarter(res.body.optimal), 'Steady');
  assert.equal(res.body.matchup.swaps.length, 0);
});
