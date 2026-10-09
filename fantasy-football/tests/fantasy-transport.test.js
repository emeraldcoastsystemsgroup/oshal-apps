/**
 * Guards for the ONE thing the fantasy half could not say: whether ESPN was unreachable, or the
 * caller simply has no ESPN connection.
 *
 * WHY THIS IS ITS OWN SUITE. On 2026-09-09 the box's resolver stopped answering and every
 * ESPN-facing read failed at once. Nothing crashed — the app told the operator to connect ESPN
 * Fantasy and paste his cookies, which could not have helped, because the cookies were already
 * there and the network was the fault. The read returned null for "never reached ESPN" exactly as
 * it does for "no credential stored", and the route could only guess from the credential.
 *
 * So these guards drive the real compiled route with the REAL transport boundary replaced by a
 * fetch stub that throws — the same shape a dead resolver produces — and assert the message names
 * the transport. Only the framework surfaces the package imports (`@/…`) are doubled; the ESPN
 * client, its retry, the classification and the route body are the shipped code.
 *
 * The second half is the same failure one layer up: a schedule read that fails and a genuine bye
 * both leave the lineup with no opponent, and the page said "No opponent could be read" for both.
 * The two matchup objects here are taken from two real route responses and rendered by the page's
 * own `matchupCard`, so the copy is proven different rather than asserted to exist.
 *
 * The two lineup reads that DEGRADE instead of failing — the schedule and the stored player-week
 * history — each keep their fallback, and each logs the error it degraded on. Both catches came over
 * from sports-edge swallowing the error, so a thrown schedule read and a failed history read left no
 * trace at all.
 *
 * The season-long boards (waivers, season value, trades) price from the league's SHAPE: whether it
 * bids, its budget, how many weeks remain. That is read in a fourth request after the settings,
 * rosters and schedule. When that read failed every retry, the null body used to be read as "this
 * league does not bid, and its season ends in week 17", and a FAAB league's waiver board said it
 * claims by waiver priority. These guards fail only that read and assert the board refuses rather
 * than guess.
 *
 * Run from the package root: node --test "tests/*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — a throwing fetch produces a transport message (with and without a stored credential) while a real 401 still produces the credential message, and a failed schedule read renders different page copy from a bye.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The ESPN client these cases exercise is now the fantasy-leagues kernel skill (ADR-146 D2): it is loaded from the framework checkout through tests/fantasy-leagues-fixture.js instead of the deleted routes/sports-fantasy-espn.js, and every assertion is unchanged. The compiled route now requires @/features/fantasy-leagues, so the loader maps that specifier to the same real module; only the logger, caller, broker and season default stay doubled.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Moved from sports-edge (sports-fantasy-transport.test.js) with the route it guards (ADR-146 D1). The compiled router is now loaded through tests/fantasy-routes-harness.js (the fantasy-football router factory with express's Router, the logger, caller, connector lookup and broker doubled, the kernel skill real) and the page under test is tools/fantasy-football.html; every assertion is unchanged.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | A schedule read that throws and a player-week history read that fails each still serve the lineup with the same fallback (no opponent; projections alone), and each is now logged at ERROR with its error — the suite reads the logger double's ERROR lines, so a catch that swallows again goes red.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | An unread league shape: a FAAB league whose mSettings+mTeam read fails every retry (429 or 503) gets a 503 naming ESPN from the waiver board, the season value and the trade finder (never mode "rolling", never a row priced on an assumed budget or season length) while settings, rosters and schedule succeed; a dead transport names the transport and a refusal names the unread shape (502). The same league with its shape read bids on every row, the control that shows the guard can see "rolling".
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { drive, espnFetch, loadRouter, memPool } = require('./fantasy-routes-harness.js');
const { PLAYERS, SEASON: MANUAL_SEASON, publicFeed } = require('./fantasy-manual-fixture.js');

const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'fantasy-football.html'), 'utf8');

const SEASON = 2025;
const WEEK = 3;
const LEAGUE = '4321';
const SECRET = '{SWID-MINE}:espn-s2-cookie-value';

/** A league whose rules are one QB, one RB and a bench. */
const SETTINGS = {
  scoringPeriodId: WEEK,
  settings: {
    name: 'Transport Test League',
    scoringSettings: { scoringItems: [{ statId: 24, points: 0.1 }] },
    rosterSettings: { lineupSlotCounts: { 0: 1, 2: 1, 20: 4 } },
  },
};

/** Builds one roster entry in ESPN's shape. */
function entry(playerId, name, slot, position) {
  return {
    playerId,
    lineupSlotId: slot,
    playerPoolEntry: { player: { id: playerId, fullName: name, eligibleSlots: [slot], defaultPositionId: position } },
  };
}

const TEAMS = {
  teams: [
    { id: 1, name: 'Mine', abbrev: 'ME', owners: ['{SWID-MINE}'], roster: { entries: [entry(11, 'QB One', 0, 1), entry(12, 'RB One', 2, 2)] } },
    { id: 2, name: 'Theirs', abbrev: 'TH', owners: ['{SWID-OTHER}'], roster: { entries: [entry(21, 'QB Two', 0, 1), entry(22, 'RB Two', 2, 2)] } },
  ],
};

/** Builds a projection row in the public feed's shape. */
function projected(playerId, name, slot, position, yards) {
  return {
    id: playerId,
    fullName: name,
    eligibleSlots: [slot],
    defaultPositionId: position,
    proTeamId: 1,
    stats: [{ seasonId: SEASON, scoringPeriodId: WEEK, statSourceId: 1, statSplitTypeId: 1, stats: { 24: yards } }],
  };
}

const FEED = [
  projected(11, 'QB One', 0, 1, 250), projected(12, 'RB One', 2, 2, 90),
  projected(21, 'QB Two', 0, 1, 240), projected(22, 'RB Two', 2, 2, 85),
];

/** A week 3 fixture in which team 1 has nobody to play — a genuine bye. */
const BYE_SCHEDULE = { schedule: [{ matchupPeriodId: WEEK, home: { teamId: 1 } }] };

/** The transport failing outright: no HTTP response is ever produced. */
const DEAD_NETWORK = () => { throw new TypeError('fetch failed'); };
/** ESPN answering, and refusing. */
const REFUSED = () => ({ ok: false, status: 401, json: async () => ({}) });

/**
 * @description Drive GET /lineup through the real registered handler.
 * @param options - `{ secret, fetch, query, logs, pool }`: `logs` receives the ERROR lines logged,
 *                  `pool` replaces the fresh owner-keyed database double.
 * @returns The recorded response.
 */
async function lineup({ secret, fetch: fetchImpl, query = {}, logs, pool = memPool() }) {
  const { router } = loadRouter({ sub: 'sub-transport-test', secret, logs }, pool);
  return drive(router, 'GET /lineup', { query: { season: SEASON, leagueId: LEAGUE, week: WEEK, ...query } }, fetchImpl);
}

test('A DEAD TRANSPORT NAMES THE TRANSPORT — not the credential, even with none stored', async () => {
  // This is the 2026-09-09 failure exactly: no HTTP response is ever produced, and the caller has
  // no ESPN connection stored. Telling them to paste cookies is advice that cannot work.
  const res = await lineup({ secret: null, fetch: espnFetch([['fantasy.espn.com', DEAD_NETWORK]]) });
  assert.equal(res.code, 503, 'an unreachable ESPN is not the caller making a bad request');
  assert.match(res.body.error, /reach ESPN/i, 'the message must name the read that failed');
  assert.doesNotMatch(res.body.error, /Connect ESPN Fantasy/i, 'it must NOT send them to the connectors page');
  assert.equal(res.body.reason, 'transport');
});

test('and the same dead transport with a credential stored says the same thing', async () => {
  const res = await lineup({ secret: SECRET, fetch: espnFetch([['fantasy.espn.com', DEAD_NETWORK]]) });
  assert.equal(res.code, 503);
  assert.match(res.body.error, /reach ESPN/i);
  assert.equal(res.body.reason, 'transport');
});

test('ESPN ANSWERING AND REFUSING is still a credential message — the distinction cuts both ways', async () => {
  // A private league read with no cookies really is a connection problem, and must keep saying so.
  const res = await lineup({ secret: null, fetch: espnFetch([['fantasy.espn.com', REFUSED]]) });
  assert.equal(res.code, 403);
  assert.match(res.body.error, /Connect ESPN Fantasy/i);
});

test('ESPN refusing a connected caller names the league, not the network', async () => {
  const res = await lineup({ secret: SECRET, fetch: espnFetch([['fantasy.espn.com', REFUSED]]) });
  assert.equal(res.code, 404);
  assert.doesNotMatch(res.body.error, /reach ESPN/i);
});

/** Runs the page's own inline script so its real render functions can be called. */
function surface() {
  const src = [...HTML.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const node = () => ({
    addEventListener() {}, setAttribute() {}, getAttribute: () => null,
    innerHTML: '', textContent: '', value: '', hidden: false, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
  });
  const sandbox = {
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    // The page boots by fetching; a promise that never settles keeps that out of the way.
    fetch: () => new Promise(() => {}),
    console: { log() {}, warn() {}, error() {} },
  };
  // The page runs in a browser, where `window` is the global: the head block and the start gate read window.AppView (ADR-164 D6).
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'fantasy-football.html' });
  return sandbox;
}

test('A BYE AND A FAILED SCHEDULE READ ARE DIFFERENT, on the route and on the page', async () => {
  const ok = [['view=mSettings', SETTINGS], ['view=mRoster', TEAMS], ['/players?', FEED]];
  const bye = await lineup({ secret: SECRET, fetch: espnFetch([...ok, ['view=mMatchup', BYE_SCHEDULE]]) });
  const broken = await lineup({ secret: SECRET, fetch: espnFetch([...ok, ['view=mMatchup', DEAD_NETWORK]]) });

  assert.equal(bye.code, 200, bye.body && bye.body.error);
  assert.equal(broken.code, 200, broken.body && broken.body.error);
  assert.equal(bye.body.matchup.opponentTeamId, null, 'a bye has no opponent');
  assert.equal(broken.body.matchup.opponentTeamId, null, 'an unread schedule has no opponent either');

  assert.equal(bye.body.matchup.opponentReason, 'bye');
  assert.equal(bye.body.matchup.scheduleError, null);
  assert.equal(broken.body.matchup.opponentReason, 'unreadable');
  assert.ok(broken.body.matchup.scheduleError, 'the failed schedule read must carry its reason');

  // The page's own renderer, on the two real responses.
  const page = surface();
  const byeCard = page.matchupCard(bye.body.matchup);
  const brokenCard = page.matchupCard(broken.body.matchup);
  assert.notEqual(byeCard, brokenCard, 'a bye and a read failure must not produce the same sentence');
  assert.match(byeCard, /bye/i);
  assert.match(brokenCard, /schedule/i);
  assert.doesNotMatch(brokenCard, /\bbye\b/i, 'a schedule outage must never be reported as a bye');
});

test('A SCHEDULE READ THAT THROWS IS LOGGED — and the lineup still degrades to no opponent', async () => {
  // A schedule body the skill cannot walk (an object where the fixture list belongs) makes the read
  // THROW rather than fail; that is the only way into this catch.
  const logs = [];
  const ok = [['view=mSettings', SETTINGS], ['view=mRoster', TEAMS], ['/players?', FEED]];
  const res = await lineup({ secret: SECRET, logs, fetch: espnFetch([...ok, ['view=mMatchup', { schedule: {} }]]) });
  assert.equal(res.code, 200, res.body && res.body.error);
  assert.equal(res.body.matchup.opponentTeamId, null, 'the fallback is unchanged: no schedule, no opponent');
  const line = logs.find((l) => /schedule read threw/.test(l.msg));
  assert.ok(line, `the thrown schedule read must be logged at ERROR; logged: ${JSON.stringify(logs.map((l) => l.msg))}`);
  assert.ok(line.fields.err instanceof Error, 'the log carries the error itself');
});

test('A HISTORY READ THAT FAILS IS LOGGED — and the lineup still weighs the projections alone', async () => {
  const logs = [];
  const pool = memPool();
  const query = pool.query.bind(pool);
  pool.query = async (sql, params) => {
    const text = String(typeof sql === 'string' ? sql : sql.text);
    if (/FROM ff_player_weeks\s+WHERE user_sub = \$1 AND season = \$2 AND week < \$3/.test(text)) throw new Error('history read refused');
    return query(sql, params);
  };
  const ok = [['view=mSettings', SETTINGS], ['view=mRoster', TEAMS], ['/players?', FEED], ['view=mMatchup', BYE_SCHEDULE]];
  const res = await lineup({ secret: SECRET, logs, pool, fetch: espnFetch(ok) });
  assert.equal(res.code, 200, res.body && res.body.error);
  assert.ok(res.body.optimal.starters.length > 0, 'the fallback is unchanged: the lineup is served from the projections');
  const line = logs.find((l) => /player-week history read failed/.test(l.msg));
  assert.ok(line, `the failed history read must be logged at ERROR; logged: ${JSON.stringify(logs.map((l) => l.msg))}`);
  assert.equal(line.fields.err.message, 'history read refused', 'the log carries the error itself');
});

/**
 * @description A FAAB league the caller's team is in, served through ESPN: three teams of the
 * hand-typed fixture's players, week 4 of a season whose last week is 6. The league-shape read
 * (mSettings+mTeam: the budget, the last week, the first playoff week) is answered by `shape`, and
 * every other read succeeds, so a failure here is ONLY the fourth read of the request.
 * @param shape - The answer to the shape read: a body, or a function (a failing or throwing read).
 * @param seen - Records every URL requested.
 * @returns A fetch implementation.
 */
function faabLeague(shape, seen) {
  const starters = [11, 12, 14, 21, 22, 24, 31, 32, 33];
  const entry = (id) => ({
    playerId: id, lineupSlotId: starters.includes(id) ? (PLAYERS[id][1] === 2 ? 2 : 4) : 20,
    playerPoolEntry: { player: { id, fullName: PLAYERS[id][0] } },
  });
  const team = (id, name, owner, ids) => ({ id, name, owners: [owner], roster: { entries: ids.map(entry) } });
  return espnFetch([
    [`/seasons/${MANUAL_SEASON}/players?`, publicFeed(4)],
    ['view=mSettings&view=mTeam', shape],
    ['view=mSettings', { scoringPeriodId: 4, settings: { name: 'FAAB League', scoringSettings: { scoringItems: [{ statId: 1, points: 1 }] },
      rosterSettings: { lineupSlotCounts: { 2: 2, 4: 1, 20: 4 } } } }],
    ['view=mMatchup', { schedule: [{ matchupPeriodId: 4, home: { teamId: 1 }, away: { teamId: 2 } }] }],
    ['view=mRoster', { teams: [
      team(1, 'Mine', '{SWID-MINE}', [11, 12, 13, 14]), team(2, 'Theirs', '{SWID-OTHER}', [21, 22, 23, 24]),
      team(3, 'Third', '{SWID-THIRD}', [31, 32, 33, 34]),
    ] }],
  ], seen);
}

/** The league's own shape: it bids, $100 with $10 spent, five regular weeks, the season ends in week 6. */
const FAAB_SHAPE = {
  settings: { acquisitionSettings: { isUsingAcquisitionBudget: true, acquisitionBudget: 100 }, scheduleSettings: { matchupPeriodCount: 5 } },
  status: { finalScoringPeriod: 6 },
  teams: [{ id: 1, transactionCounter: { acquisitionBudgetSpent: 10 } }],
};

/**
 * @description Drive one management board for the FAAB league.
 * @param key - `GET /waivers`, `GET /season` or `GET /trades`.
 * @param shape - The shape read's answer.
 * @param seen - Records every URL requested.
 * @returns The recorded response.
 */
async function faabBoard(key, shape, seen = []) {
  const { router } = loadRouter({ sub: 'sub-shape-test', secret: '{SWID-MINE}:my-s2' }, memPool());
  return drive(router, key, { query: { leagueId: '5150', season: String(MANUAL_SEASON), week: '4' } }, faabLeague(shape, seen));
}

test('the FAAB league\'s waiver board bids when its shape is read (the control for the guards below)', async () => {
  const res = await faabBoard('GET /waivers', FAAB_SHAPE);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.mode, 'faab');
  assert.equal(res.body.budget, 90, '$100 less the $10 spent');
  assert.equal(res.body.weeks.lastWeek, 6, 'the season ends where the league says');
  assert.ok(res.body.rows.length > 0, 'the wire back improves the starting lineup');
  for (const r of res.body.rows) {
    assert.equal(Number.isInteger(r.bid), true, `${r.add.name} carries a whole-dollar bid`);
    assert.ok(r.drop && Number.isInteger(r.drop.playerId), `${r.add.name} carries a drop`);
  }
});

test('A SHAPE READ THAT FAILS EVERY RETRY IS NOT "THE LEAGUE DOES NOT BID": the board answers 503 naming ESPN, never "rolling"', async () => {
  for (const status of [429, 503]) {
    const seen = [];
    let attempts = 0;
    const failing = () => { attempts += 1; return { ok: false, status, json: async () => ({}) }; };
    const res = await faabBoard('GET /waivers', failing, seen);
    assert.equal(res.code, 503, `HTTP ${status} on the shape read: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.reason, 'unavailable');
    assert.equal(res.body.espnStatus, status);
    assert.match(res.body.error, /reach ESPN/i, 'the answer names the read that failed');
    assert.equal(res.body.mode, undefined, 'no waiver mode is claimed for a league whose shape was never read');
    assert.equal(res.body.rows, undefined, 'and no row is priced on an assumed budget or season length');
    assert.doesNotMatch(JSON.stringify(res.body), /rolling|priority/i);
    assert.equal(attempts, 3, 'the shape read failed on every retry');
    assert.ok(seen.some((x) => x.url.includes('view=mRoster')) && seen.some((x) => x.url.endsWith('view=mSettings')),
      'settings and rosters were read first: only the fourth read failed');
  }
});

test('and the same holds for the season value and the trade finder, which price from the same shape', async () => {
  for (const key of ['GET /season', 'GET /trades']) {
    const res = await faabBoard(key, () => ({ ok: false, status: 429, json: async () => ({}) }));
    assert.equal(res.code, 503, `${key}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.reason, 'unavailable');
    assert.equal(res.body.total, undefined, `${key} prices nothing over an assumed season length`);
    assert.equal(res.body.proposals, undefined);
  }
});

test('a shape read that never reaches ESPN names the transport; one ESPN refuses names the unread shape', async () => {
  const dead = await faabBoard('GET /waivers', DEAD_NETWORK);
  assert.equal(dead.code, 503);
  assert.equal(dead.body.reason, 'transport');
  assert.equal(dead.body.mode, undefined);
  const refused = await faabBoard('GET /waivers', REFUSED);
  assert.equal(refused.code, 502, JSON.stringify(refused.body));
  assert.match(refused.body.error, /budget and season shape/);
  assert.equal(refused.body.espnStatus, 401);
  assert.equal(refused.body.mode, undefined);
  assert.doesNotMatch(refused.body.error, /Connect ESPN Fantasy/i, 'the settings and rosters came back with this credential');
});
