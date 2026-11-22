/**
 * Guards for BACKLOG Item C (0.12.4): per-league expected line-open windows, tighter in-window
 * capture cadence (15m inside vs 180m outside), per-row open-window persistence, and the third
 * `openerConfidence` level (`confirmed-open`).
 *
 * Plain node, no network, no live Postgres: drives the real compiled open-windows, line-history,
 * line-store, refresh, and route modules over deterministic clocks and an in-memory SQL store.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Item C (0.12.4): unit tests for NFL/NCAAF/NBA open windows (EDT + EST boundaries), adaptive 15m vs 180m cadence, strict 4-case openerConfidence truth table, end-to-end multi-poll capture loop (absent -> confirmed-open vs already-priced -> observed-early vs cross-book isolation vs change-only), and HTTP/manifest/migration contracts.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const {
  LEAGUE_OPEN_WINDOWS,
  SLOW_CADENCE_MINUTES,
  TIGHT_CADENCE_MINUTES,
  activeOpenWindowLeagues,
  isInOpenWindow,
  nextCaptureCadenceMinutes,
  nextLinePollDueAt,
  shouldPollLinesNow,
} = require('../routes/open-windows.js');
const { summariseMovement } = require('../routes/sports-line-history.js');
const { ANY_BOOK, captureQuote, observationsFor } = require('../routes/sports-line-store.js');

function fakeRouter() {
  const routes = [];
  const add = (method) => (route, ...handlers) => {
    routes.push({ method, route, handler: handlers[handlers.length - 1] });
  };
  return { routes, get: add('get'), post: add('post'), put: add('put'), patch: add('patch'), delete: add('delete'), use: add('use') };
}

const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const STUBS = {
  '@/shared/logger': { createChildLogger: () => quiet },
  '@/features/world-data': { createWorldIntelligenceService: () => null, ingestFeeds: async () => ({ newItems: 0 }) },
  '@/app/routes/trading-routes-helpers': {
    callerSub: (req) => (req.oidc && req.oidc.user && req.oidc.user.sub) || null,
    servePage: () => () => {},
  },
  '@/shared/middleware/authz': { isOperator: (req) => Boolean(req && req.operator) },
  express: { Router: fakeRouter },
};

const origLoad = Module._load;
Module._load = function stubbed(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};
const refresh = require('../routes/sports-refresh.js');
const routes = require('../routes/sports-routes.js');

/** In-memory SQL store implementing sports_line_history, sports_line_poll_state, and sports_settings. */
function memoryLinePool() {
  let nextId = 1;
  const history = [];
  const pollState = new Map();
  const settings = new Map();
  const queries = [];

  async function query(rawSql, params = []) {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim();
    queries.push({ sql, params });

    if (/^SELECT settings FROM sports_settings/i.test(sql)) {
      return { rows: settings.has(params[0]) ? [{ settings: settings.get(params[0]) }] : [], rowCount: 0 };
    }
    if (/^INSERT INTO sports_settings/i.test(sql)) {
      const merged = { ...(settings.get(params[0]) || {}), ...JSON.parse(params[1]) };
      settings.set(params[0], merged);
      return { rows: [{ settings: merged }], rowCount: 1 };
    }
    if (/^INSERT INTO sports_line_poll_state/i.test(sql)) {
      const [eventId, book, league, gameDate, hadPrice, polledAt] = params;
      const key = `${eventId}::${book}`;
      const prev = pollState.get(key);
      pollState.set(key, {
        event_id: eventId, book, league,
        game_date: gameDate ?? prev?.game_date ?? null,
        had_price: Boolean(hadPrice),
        polled_at: polledAt,
      });
      return { rows: [], rowCount: 1 };
    }
    if (/^SELECT had_price, polled_at FROM sports_line_poll_state/i.test(sql)) {
      const [eventId, book, anyBook, capturedIso] = params;
      const capMs = Date.parse(capturedIso);
      const matches = [...pollState.values()]
        .filter((r) => r.event_id === eventId && (r.book === book || r.book === anyBook) && Date.parse(r.polled_at) < capMs)
        .sort((a, b) => Date.parse(b.polled_at) - Date.parse(a.polled_at));
      return { rows: matches.slice(0, 1), rowCount: matches.length ? 1 : 0 };
    }
    if (/^SELECT DISTINCT league, game_date FROM sports_line_poll_state/i.test(sql)) {
      const cutoffMs = Date.parse(params[0]);
      const seen = new Set();
      const rows = [];
      for (const r of pollState.values()) {
        if (!r.game_date || Date.parse(r.game_date) < cutoffMs) continue;
        const k = `${r.league}::${r.game_date}`;
        if (seen.has(k)) continue;
        seen.add(k);
        rows.push({ league: r.league, game_date: r.game_date });
      }
      rows.sort((a, b) => Date.parse(a.game_date) - Date.parse(b.game_date));
      return { rows, rowCount: rows.length };
    }
    if (/^SELECT \* FROM sports_line_history WHERE event_id = \$1 AND book = \$2 ORDER BY first_seen DESC LIMIT 1/i.test(sql)) {
      const rows = history
        .filter((r) => r.event_id === params[0] && r.book === params[1])
        .sort((a, b) => Date.parse(b.first_seen) - Date.parse(a.first_seen));
      return { rows: rows.slice(0, 1), rowCount: rows.length ? 1 : 0 };
    }
    if (/^SELECT \* FROM sports_line_history WHERE event_id = \$1 AND book = \$2 ORDER BY first_seen ASC/i.test(sql)) {
      const rows = history
        .filter((r) => r.event_id === params[0] && r.book === params[1])
        .sort((a, b) => Date.parse(a.first_seen) - Date.parse(b.first_seen));
      return { rows, rowCount: rows.length };
    }
    if (/^SELECT \* FROM sports_line_history WHERE event_id = \$1 ORDER BY first_seen ASC/i.test(sql)) {
      const rows = history
        .filter((r) => r.event_id === params[0])
        .sort((a, b) => Date.parse(a.first_seen) - Date.parse(b.first_seen));
      return { rows, rowCount: rows.length };
    }
    if (/^UPDATE sports_line_history SET last_seen = \$2, observations = observations \+ 1 WHERE id = \$1/i.test(sql)) {
      const row = history.find((r) => r.id === params[0]);
      if (row) { row.last_seen = params[1]; row.observations += 1; }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (/^INSERT INTO sports_line_history/i.test(sql)) {
      const row = {
        id: nextId++,
        league: params[0], event_id: params[1], game_date: params[2],
        home_team: params[3], away_team: params[4], book: params[5],
        home_spread: params[6], home_spread_odds: params[7], away_spread_odds: params[8],
        home_moneyline: params[9], away_moneyline: params[10], total: params[11],
        first_seen: params[12], last_seen: params[12], observations: 1,
        in_open_window: Boolean(params[13]), prior_poll_absent: Boolean(params[14]),
      };
      history.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/^SELECT count\(\*\)::int AS rows/i.test(sql)) {
      const books = [...new Set(history.map((r) => r.book))];
      const games = new Set(history.map((r) => r.event_id)).size;
      const since = history.length ? [...history].sort((a, b) => Date.parse(a.first_seen) - Date.parse(b.first_seen))[0].first_seen : null;
      return {
        rows: [{
          rows: history.length, games, since, books,
          in_window_rows: history.filter((r) => r.in_open_window).length,
          confirmed_openers: history.filter((r) => r.in_open_window && r.prior_poll_absent).length,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  }

  return { history, pollState, settings, queries, query };
}

function answer() {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// ---- 1. Per-league open window unit tests -----------------------------------

test('per-league open windows are explicitly declared for every supported league (NFL, NCAAF, NBA)', () => {
  for (const league of ['nfl', 'ncaaf', 'nba']) {
    assert.ok(LEAGUE_OPEN_WINDOWS[league], `open window declared for ${league}`);
    assert.equal(LEAGUE_OPEN_WINDOWS[league].tightCadenceMinutes, TIGHT_CADENCE_MINUTES);
    assert.equal(LEAGUE_OPEN_WINDOWS[league].slowCadenceMinutes, SLOW_CADENCE_MINUTES);
  }
  assert.ok(TIGHT_CADENCE_MINUTES < 60, 'tight cadence is in minutes, not hours');
  assert.equal(SLOW_CADENCE_MINUTES, 180);
});

test('NCAAF open window: Sunday 12:00-22:00 ET (EDT + EST DST boundaries) for next-week slate', () => {
  // October 2026 is EDT (UTC-4): Sun 2026-10-11 12:00 EDT = 16:00Z, 22:00 EDT = 2026-10-12 02:00Z.
  const satKickoff = '2026-10-17T19:30:00.000Z';
  assert.equal(isInOpenWindow('ncaaf', '2026-10-11T15:59:00.000Z', satKickoff).inWindow, false, '11:59 EDT is before window');
  const openStart = isInOpenWindow('ncaaf', '2026-10-11T16:00:00.000Z', satKickoff);
  assert.equal(openStart.inWindow, true, '12:00 EDT starts NCAAF window');
  assert.equal(openStart.cadenceMinutes, TIGHT_CADENCE_MINUTES);
  assert.equal(isInOpenWindow('ncaaf', '2026-10-12T01:59:00.000Z', satKickoff).inWindow, true, '21:59 EDT is still inside window');
  assert.equal(isInOpenWindow('ncaaf', '2026-10-12T02:00:00.000Z', satKickoff).inWindow, false, '22:00 EDT closes NCAAF window');
  assert.equal(isInOpenWindow('ncaaf', '2026-10-14T18:00:00.000Z', satKickoff).inWindow, false, 'Wednesday afternoon is outside window');
  assert.equal(isInOpenWindow('ncaaf', '2026-10-11T18:00:00.000Z', '2026-10-24T19:30:00.000Z').inWindow, false, '2 weeks out is not this Sunday open');

  // November 2026 after DST fallback is EST (UTC-5): Sun 2026-11-15 12:00 EST = 17:00Z.
  const novKickoff = '2026-11-21T20:00:00.000Z';
  assert.equal(isInOpenWindow('ncaaf', '2026-11-15T16:59:00.000Z', novKickoff).inWindow, false, '11:59 EST is outside window');
  assert.equal(isInOpenWindow('ncaaf', '2026-11-15T17:00:00.000Z', novKickoff).inWindow, true, '12:00 EST starts NCAAF window');
  assert.equal(isInOpenWindow('ncaaf', '2026-11-16T03:00:00.000Z', novKickoff).inWindow, false, '22:00 EST closes NCAAF window');
});

test('NFL open window: Sunday 19:00 ET through Monday 18:00 ET for next week, excluding same-night games', () => {
  // Oct 11-12 2026 (EDT = UTC-4): Sun 19:00 EDT = 23:00Z, Mon 18:00 EDT = 22:00Z.
  const nextSunKickoff = '2026-10-18T17:00:00.000Z';
  const sameNightKickoff = '2026-10-12T00:20:00.000Z';
  assert.equal(isInOpenWindow('nfl', '2026-10-11T22:59:00.000Z', nextSunKickoff).inWindow, false, 'Sun 18:59 EDT is before NFL open');
  assert.equal(isInOpenWindow('nfl', '2026-10-11T23:00:00.000Z', nextSunKickoff).inWindow, true, 'Sun 19:00 EDT opens NFL window');
  assert.equal(isInOpenWindow('nfl', '2026-10-12T15:00:00.000Z', nextSunKickoff).inWindow, true, 'Mon 11:00 EDT is inside NFL window');
  assert.equal(isInOpenWindow('nfl', '2026-10-12T21:59:00.000Z', nextSunKickoff).inWindow, true, 'Mon 17:59 EDT is still inside NFL window');
  assert.equal(isInOpenWindow('nfl', '2026-10-12T22:00:00.000Z', nextSunKickoff).inWindow, false, 'Mon 18:00 EDT closes NFL window');
  assert.equal(isInOpenWindow('nfl', '2026-10-11T23:15:00.000Z', sameNightKickoff).inWindow, false, 'SNF game kicking off in 1h is NOT in its open window');
  assert.equal(isInOpenWindow('nfl', '2026-10-11T23:15:00.000Z', null).inWindow, false, 'missing kickoff fails closed');
});

test('NBA open window: prior evening (17:00-24:00 ET) and game-day morning (08:00-13:00 ET) only', () => {
  // Dec 2026 is EST (UTC-5): Tue 2026-12-08 19:30 EST tipoff = 2026-12-09 00:30Z.
  const tipoff = '2026-12-09T00:30:00.000Z';
  assert.equal(isInOpenWindow('nba', '2026-12-07T21:59:00.000Z', tipoff).inWindow, false, 'Mon 16:59 EST is before prior-evening open');
  assert.equal(isInOpenWindow('nba', '2026-12-07T22:00:00.000Z', tipoff).inWindow, true, 'Mon 17:00 EST (26.5h out) is inside NBA evening open');
  assert.equal(isInOpenWindow('nba', '2026-12-08T08:00:00.000Z', tipoff).inWindow, false, 'Tue 03:00 EST overnight is outside window');
  assert.equal(isInOpenWindow('nba', '2026-12-08T13:00:00.000Z', tipoff).inWindow, true, 'Tue 08:00 EST (11.5h out) is inside NBA morning open');
  assert.equal(isInOpenWindow('nba', '2026-12-08T17:59:00.000Z', tipoff).inWindow, true, 'Tue 12:59 EST is inside NBA morning open');
  assert.equal(isInOpenWindow('nba', '2026-12-08T18:00:00.000Z', tipoff).inWindow, false, 'Tue 13:00 EST closes NBA morning open');
  assert.equal(isInOpenWindow('nba', '2026-12-08T23:30:00.000Z', tipoff).inWindow, false, '1h before tipoff is outside open window');
});

// ---- 2. Adaptive cadence unit tests -----------------------------------------

test('adaptive cadence: 15m inside any active open window, 180m outside with zero premature polls', () => {
  const slate = [
    { league: 'ncaaf', gameDate: '2026-10-17T19:30:00.000Z' },
    { league: 'nfl', gameDate: '2026-10-18T17:00:00.000Z' },
  ];
  // Sunday 13:00 EDT (17:00Z): NCAAF open, NFL not yet open.
  const sunAfternoon = '2026-10-11T17:00:00.000Z';
  assert.deepEqual(activeOpenWindowLeagues(sunAfternoon, slate), ['ncaaf']);
  assert.equal(nextCaptureCadenceMinutes(sunAfternoon, slate), TIGHT_CADENCE_MINUTES);
  assert.equal(shouldPollLinesNow(sunAfternoon, '2026-10-11T16:55:00.000Z', slate), false, '5m ago is too soon even in tight window');
  assert.equal(shouldPollLinesNow(sunAfternoon, '2026-10-11T16:45:00.000Z', slate), true, '15m ago is due in tight window');

  // Wednesday 15:00 EDT (19:00Z): NO league in open window.
  const wedAfternoon = '2026-10-14T19:00:00.000Z';
  assert.deepEqual(activeOpenWindowLeagues(wedAfternoon, slate), []);
  assert.equal(nextCaptureCadenceMinutes(wedAfternoon, slate), SLOW_CADENCE_MINUTES);
  assert.equal(shouldPollLinesNow(wedAfternoon, '2026-10-14T18:45:00.000Z', slate), false, '15m elapsed stays quiet outside open window');
  assert.equal(shouldPollLinesNow(wedAfternoon, '2026-10-14T17:00:00.000Z', slate), false, '120m elapsed stays quiet outside open window');
  assert.equal(shouldPollLinesNow(wedAfternoon, '2026-10-14T16:00:00.000Z', slate), true, '180m elapsed polls on slow cadence');
  assert.ok(nextLinePollDueAt(wedAfternoon, '2026-10-14T18:45:00.000Z', slate));
});

// ---- 3. Strict 4-case openerConfidence truth table --------------------------

test('openerConfidence strict 4-case truth table: confirmed-open requires BOTH inOpenWindow AND priorPollAbsent', () => {
  const kickoffEarly = '2026-10-17T19:30:00.000Z'; // > 72h after firstSeen
  const kickoffShort = '2026-10-12T19:30:00.000Z'; // 27h after firstSeen (e.g. NBA)
  const makeRow = (inOpenWindow, priorPollAbsent, firstSeen = '2026-10-11T16:30:00.000Z') => ({
    eventId: 'E-TRUTH', book: 'DraftKings',
    homeSpread: -3.5, homeSpreadOdds: -110, awaySpreadOdds: -110,
    homeMoneyline: -175, awayMoneyline: 150, total: 51.5,
    firstSeen, lastSeen: firstSeen, observations: 1,
    inOpenWindow, priorPollAbsent,
  });

  // Case 1: inOpenWindow=true AND priorPollAbsent=true -> confirmed-open (both long and short lead)
  const c1Long = summariseMovement([makeRow(true, true)], kickoffEarly);
  assert.equal(c1Long.openerConfidence, 'confirmed-open');
  assert.equal(c1Long.firstInOpenWindow, true);
  assert.equal(c1Long.firstPriorPollAbsent, true);
  const c1Short = summariseMovement([makeRow(true, true)], kickoffShort);
  assert.equal(c1Short.openerConfidence, 'confirmed-open', 'NBA openers inside window (<72h lead) are still confirmed-open');

  // Case 2: inOpenWindow=true AND priorPollAbsent=false -> MUST NOT be confirmed-open
  assert.equal(summariseMovement([makeRow(true, false)], kickoffEarly).openerConfidence, 'observed-early');
  assert.equal(summariseMovement([makeRow(true, false)], kickoffShort).openerConfidence, 'late-pickup');

  // Case 3: inOpenWindow=false AND priorPollAbsent=true -> MUST NOT be confirmed-open
  assert.equal(summariseMovement([makeRow(false, true)], kickoffEarly).openerConfidence, 'observed-early');
  assert.equal(summariseMovement([makeRow(false, true)], kickoffShort).openerConfidence, 'late-pickup');

  // Case 4: inOpenWindow=false AND priorPollAbsent=false -> MUST NOT be confirmed-open
  assert.equal(summariseMovement([makeRow(false, false)], kickoffEarly).openerConfidence, 'observed-early');
  assert.equal(summariseMovement([makeRow(false, false)], kickoffShort).openerConfidence, 'late-pickup');

  // Later row cannot retroactively upgrade an unconfirmed first row
  const upgraded = summariseMovement([
    makeRow(false, false, '2026-10-11T15:00:00.000Z'),
    makeRow(true, true, '2026-10-11T16:30:00.000Z'),
  ], kickoffEarly);
  assert.equal(upgraded.openerConfidence, 'observed-early', 'only the earliest row governs openerConfidence');
});

// ---- 4. End-to-end capture-loop sequence + route integration ----------------

test('end-to-end capture sequence: absent poll -> in-window price = confirmed-open; already priced = observed-early; cross-book isolated; unchanged stays change-only', async () => {
  const pool = memoryLinePool();
  const satKickoff = '2026-10-17T19:30:00.000Z';
  const gameX = { league: 'ncaaf', eventId: 'E-X', gameDate: satKickoff, homeTeam: 'ALA', awayTeam: 'UGA' };
  const gameY = { league: 'ncaaf', eventId: 'E-Y', gameDate: satKickoff, homeTeam: 'TEX', awayTeam: 'OU' };
  const gameZ = { league: 'ncaaf', eventId: 'E-Z', gameDate: satKickoff, homeTeam: 'OSU', awayTeam: 'MICH' };
  const gameW = { league: 'ncaaf', eventId: 'E-W', gameDate: satKickoff, homeTeam: 'LSU', awayTeam: 'FLA' };

  const poll1 = '2026-10-11T16:30:00.000Z'; // Sun 12:30 EDT (inside NCAAF window)
  const poll2 = '2026-10-11T16:45:00.000Z'; // Sun 12:45 EDT (15m later, inside NCAAF window)
  const poll3 = '2026-10-11T17:00:00.000Z'; // Sun 13:00 EDT (15m later, unchanged)
  const poll4 = '2026-10-11T17:15:00.000Z'; // Sun 13:15 EDT (15m later, moved)

  // Poll 1: Game X has no DraftKings price; Game Y already priced; Game Z empty odds {}; Game W only FanDuel absent.
  assert.equal(await captureQuote(pool, gameX, { book: 'DraftKings' }, { capturedAt: poll1 }), 'no-price');
  assert.equal(await captureQuote(pool, gameY, { book: 'DraftKings', homeSpread: -7.0, homeSpreadOdds: -110, awaySpreadOdds: -110 }, { capturedAt: poll1 }), 'first-capture');
  assert.equal(await captureQuote(pool, gameZ, {}, { capturedAt: poll1 }), 'no-price');
  assert.equal(await captureQuote(pool, gameW, { book: 'FanDuel' }, { capturedAt: poll1 }), 'no-price');
  assert.equal(pool.pollState.get(`E-Z::${ANY_BOOK}`).had_price, false);

  // Poll 2 (15m later): Game X, Game Z, and Game W now post DraftKings lines; Game Y unchanged.
  assert.equal(await captureQuote(pool, gameX, { book: 'DraftKings', homeSpread: -3.5, homeSpreadOdds: -110, awaySpreadOdds: -110 }, { capturedAt: poll2 }), 'first-capture');
  assert.equal(await captureQuote(pool, gameY, { book: 'DraftKings', homeSpread: -7.0, homeSpreadOdds: -110, awaySpreadOdds: -110 }, { capturedAt: poll2 }), 'unchanged');
  assert.equal(await captureQuote(pool, gameZ, { book: 'DraftKings', homeSpread: -2.5, homeSpreadOdds: -110, awaySpreadOdds: -110 }, { capturedAt: poll2 }), 'first-capture');
  assert.equal(await captureQuote(pool, gameW, { book: 'DraftKings', homeSpread: -4.5, homeSpreadOdds: -110, awaySpreadOdds: -110 }, { capturedAt: poll2 }), 'first-capture');

  // Poll 3 (15m later): Game X unchanged -> must stay change-only (1 row, observations = 2)
  assert.equal(await captureQuote(pool, gameX, { book: 'DraftKings', homeSpread: -3.5, homeSpreadOdds: -110, awaySpreadOdds: -110 }, { capturedAt: poll3 }), 'unchanged');

  // Verify Game X -> confirmed-open, change-only
  const obsX = await observationsFor(pool, 'E-X', 'DraftKings');
  assert.equal(obsX.length, 1, 'unchanged poll does not append a duplicate row');
  assert.equal(obsX[0].observations, 2);
  assert.equal(obsX[0].inOpenWindow, true);
  assert.equal(obsX[0].priorPollAbsent, true);
  assert.equal(summariseMovement(obsX, satKickoff).openerConfidence, 'confirmed-open');

  // Verify Game Y -> observed-early (NOT confirmed-open, because already priced on poll 1)
  const obsY = await observationsFor(pool, 'E-Y', 'DraftKings');
  assert.equal(obsY.length, 1);
  assert.equal(obsY[0].observations, 2);
  assert.equal(obsY[0].inOpenWindow, true);
  assert.equal(obsY[0].priorPollAbsent, false);
  assert.equal(summariseMovement(obsY, satKickoff).openerConfidence, 'observed-early');

  // Verify Game Z -> confirmed-open (empty odds {} on poll 1 proved no book had posted)
  const obsZ = await observationsFor(pool, 'E-Z', 'DraftKings');
  assert.equal(obsZ[0].inOpenWindow, true);
  assert.equal(obsZ[0].priorPollAbsent, true);
  assert.equal(summariseMovement(obsZ, satKickoff).openerConfidence, 'confirmed-open');

  // Verify Game W -> observed-early (FanDuel absent poll does NOT confirm DraftKings opener)
  const obsW = await observationsFor(pool, 'E-W', 'DraftKings');
  assert.equal(obsW[0].inOpenWindow, true);
  assert.equal(obsW[0].priorPollAbsent, false);
  assert.equal(summariseMovement(obsW, satKickoff).openerConfidence, 'observed-early');

  // Poll 4: Game X moves from -3.5 to -4.0 -> 2 rows, net move +0.5, opener stays confirmed-open
  assert.equal(await captureQuote(pool, gameX, { book: 'DraftKings', homeSpread: -4.0, homeSpreadOdds: -110, awaySpreadOdds: -110 }, { capturedAt: poll4 }), 'moved');
  const movedX = await observationsFor(pool, 'E-X', 'DraftKings');
  assert.equal(movedX.length, 2);
  assert.equal(movedX[1].priorPollAbsent, false, 'subsequent move row is not marked priorPollAbsent');
  const sumX = summariseMovement(movedX, satKickoff);
  assert.equal(sumX.openerConfidence, 'confirmed-open');
  assert.equal(sumX.netSpreadMove, 0.5);

  // Verify HTTP routes surface confirmed-open, inWindowRows, openWindows, and cadence
  const router = routes.createSportsEdgeRoutes({ pool, appPackageDir: path.join(__dirname, '..') });
  const getLine = router.routes.find((r) => r.method === 'get' && r.route === '/lines/:eventId').handler;
  const getLineStatus = router.routes.find((r) => r.method === 'get' && r.route === '/lines/status').handler;
  const lineRes = answer();
  await getLine({ oidc: { user: { sub: 'u1' } }, params: { eventId: 'E-X' }, query: {} }, lineRes);
  assert.equal(lineRes.code, 200);
  assert.equal(lineRes.body.movement.openerConfidence, 'confirmed-open');
  assert.equal(lineRes.body.movement.firstInOpenWindow, true);
  assert.equal(lineRes.body.movement.firstPriorPollAbsent, true);

  const statusRes = answer();
  await getLineStatus({ oidc: { user: { sub: 'u1' } } }, statusRes);
  assert.equal(statusRes.code, 200);
  assert.equal(statusRes.body.confirmedOpeners, 2, 'Game X and Game Z are confirmed openers');
  assert.ok(statusRes.body.openWindows.ncaaf && statusRes.body.openWindows.nfl && statusRes.body.openWindows.nba);
  assert.equal(statusRes.body.cadence.tightMinutes, TIGHT_CADENCE_MINUTES);
});

// ---- 5. Adaptive runRefreshPass cadence integration -------------------------

test('runRefreshPass polls active-window leagues every 15m and skips outside open windows with zero ESPN reads', async () => {
  const pool = memoryLinePool();
  const satKickoff = '2026-10-17T19:30:00.000Z';
  const fetchedUrls = [];
  let publishSpread = false;

  const fetchImpl = async (url) => {
    fetchedUrls.push(String(url));
    if (/college-football\/scoreboard/.test(url)) {
      return {
        ok: true, status: 200,
        json: async () => ({
          events: [{
            id: 'CF-101', date: satKickoff, name: 'UGA @ ALA',
            competitions: [{
              competitors: [
                { homeAway: 'home', team: { id: '333', abbreviation: 'ALA' } },
                { homeAway: 'away', team: { id: '61', abbreviation: 'UGA' } },
              ],
              odds: publishSpread ? [{
                provider: { name: 'DraftKings', priority: 1 },
                spread: -3.5, overUnder: 52.5,
                homeTeamOdds: { teamId: '333', spreadOdds: -110 },
                awayTeamOdds: { teamId: '61', spreadOdds: -110 },
              }] : [],
            }],
          }],
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ events: [] }) };
  };
  const espnOpts = { fetchImpl, attempts: 1 };

  // T0: Sunday 12:30 EDT (inside NCAAF open window). First pass runs full pass, sees CF-101 with NO price.
  const t0 = new Date('2026-10-11T16:30:00.000Z');
  const r0 = await refresh.runRefreshPass(pool, 'person-c', { now: t0, espnOpts });
  assert.equal(r0.ran, true);
  assert.equal(r0.mode, 'full');
  assert.equal(r0.result.lines['no-price'], 1);

  // T1: 5 minutes later (12:35 EDT): still inside tight interval -> skipped with ZERO ESPN reads.
  fetchedUrls.length = 0;
  const t1 = new Date('2026-10-11T16:35:00.000Z');
  const r1 = await refresh.runRefreshPass(pool, 'person-c', { now: t1, espnOpts });
  assert.equal(r1.ran, false);
  assert.equal(r1.skipped, 'not_due');
  assert.equal(r1.cadenceMinutes, TIGHT_CADENCE_MINUTES);
  assert.deepEqual(r1.activeWindowLeagues, ['ncaaf']);
  assert.equal(fetchedUrls.length, 0, 'no ESPN read 5m after last poll');

  // T2: 15 minutes after T0 (12:45 EDT): NCAAF open window is active -> tight line-capture pass runs for NCAAF ONLY!
  publishSpread = true;
  fetchedUrls.length = 0;
  const t2 = new Date('2026-10-11T16:45:00.000Z');
  const r2 = await refresh.runRefreshPass(pool, 'person-c', { now: t2, espnOpts });
  assert.equal(r2.ran, true);
  assert.equal(r2.mode, 'line-capture');
  assert.equal(r2.cadenceMinutes, TIGHT_CADENCE_MINUTES);
  assert.deepEqual(r2.activeWindowLeagues, ['ncaaf']);
  assert.equal(r2.result.lines['first-capture'], 1);
  assert.ok(fetchedUrls.length >= 1 && fetchedUrls.every((u) => /college-football\/scoreboard/.test(u)),
    `in-window poll touches only active-window league (saw ${fetchedUrls.join(', ')})`);

  // Confirmed-open was recorded for CF-101!
  const obs = await observationsFor(pool, 'CF-101', 'DraftKings');
  assert.equal(obs.length, 1);
  assert.equal(summariseMovement(obs, satKickoff).openerConfidence, 'confirmed-open');

  // T3: Wednesday 15:00 EDT (outside ALL open windows), 15 minutes after a Wednesday 14:45 full pass.
  const tWed0 = new Date('2026-10-14T18:45:00.000Z');
  const rWed0 = await refresh.runRefreshPass(pool, 'person-c', { now: tWed0, espnOpts });
  assert.equal(rWed0.ran, true);
  assert.equal(rWed0.mode, 'full');

  fetchedUrls.length = 0;
  const tWed1 = new Date('2026-10-14T19:00:00.000Z'); // 15m later outside open window
  const rWed1 = await refresh.runRefreshPass(pool, 'person-c', { now: tWed1, espnOpts });
  assert.equal(rWed1.ran, false);
  assert.equal(rWed1.skipped, 'not_due');
  assert.equal(rWed1.cadenceMinutes, SLOW_CADENCE_MINUTES);
  assert.deepEqual(rWed1.activeWindowLeagues, []);
  assert.equal(fetchedUrls.length, 0, 'zero wasted ESPN reads outside open windows on 15m ticks');
});

// ---- 6. Manifest & migration contract ---------------------------------------

test('manifest schedules refresh-pass on 15-minute ticks and registers migration 006', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /cron:\s*"\*\/15 \* \* \* \*"/, 'scheduler ticks every 15 minutes so open-window polling runs in minutes');
  assert.match(manifest, /migrations\/006-sports-line-open-windows\.sql/);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '006-sports-line-open-windows.sql'), 'utf8');
  assert.match(sql, /in_open_window\s+BOOLEAN\s+NOT NULL\s+DEFAULT FALSE/i);
  assert.match(sql, /prior_poll_absent\s+BOOLEAN\s+NOT NULL\s+DEFAULT FALSE/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS sports_line_poll_state/i);
});
