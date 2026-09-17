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
 * Run from the package root: node --test "tests/*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — a throwing fetch produces a transport message (with and without a stored credential) while a real 401 still produces the credential message, and a failed schedule read renders different page copy from a bye.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const ROUTES = path.resolve(__dirname, '..', 'routes', 'sports-fantasy-routes.js');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'sports-edge.html'), 'utf8');

const SEASON = 2025;
const WEEK = 3;
const LEAGUE = '4321';
const SECRET = '{SWID-MINE}:espn-s2-cookie-value';

/**
 * @description Load the compiled fantasy routes, replacing ONLY the framework modules the package
 * imports. `./sports-refresh` reaches the World service and is used here for one season default, so
 * it is replaced too; every ESPN-facing module is the real compiled one.
 * @param state - Caller subject and stored secret for this run.
 * @returns The module's exports.
 */
function loadFantasyRoutes(state) {
  const nativeRequire = createRequire(ROUTES);
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };
  const overrides = {
    '@/shared/logger': { createChildLogger: () => quiet },
    '@/app/routes/trading-routes-helpers': { callerSub: () => state.sub },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => state.secret },
    './sports-refresh': { currentSeason: () => SEASON },
  };
  const target = { exports: {} };
  const wrapper = new vm.Script(
    `(function(require,module,exports){${fs.readFileSync(ROUTES, 'utf8')}\n})`, { filename: ROUTES },
  );
  wrapper.runInThisContext()((name) => overrides[name] || nativeRequire(name), target, target.exports);
  return target.exports;
}

/** Collects the handlers the router registers, so one can be driven directly. */
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

/** The only two tables this path touches; every other statement is DDL and answers empty. */
function poolDouble() {
  const projections = new Map();
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(typeof sql === 'string' ? sql : sql.text);
      const p = typeof sql === 'string' ? params : sql.values;
      if (/INSERT INTO sports_fantasy_projections/.test(text)) {
        projections.set(`${p[0]}:${p[1]}`, { payload: JSON.parse(p[2]), players: p[3], generated_at: new Date().toISOString() });
        return { rows: [], rowCount: 1 };
      }
      if (/FROM sports_fantasy_projections/.test(text)) {
        const row = projections.get(`${p[0]}:${p[1]}`);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (/INSERT INTO sports_fantasy_calls/.test(text)) { calls.push(p); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    },
  };
}

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

/**
 * @description Build a fetch stub from ordered [url fragment, answer] rules. An answer that is a
 * function is called — which is how a rule throws, the shape a dead resolver produces; anything
 * else is served as a 200 JSON body. An unmatched URL is a fixture failure, never a silent empty
 * read, so a renamed endpoint cannot pass as "ESPN returned nothing".
 * @param rules - Ordered match rules.
 * @returns A fetch implementation.
 */
function espnFetch(rules) {
  return async (url) => {
    const target = String(url);
    for (const [fragment, answer] of rules) {
      if (!target.includes(fragment)) continue;
      if (typeof answer === 'function') return answer(target);
      return { ok: true, status: 200, json: async () => answer };
    }
    throw new assert.AssertionError({ message: `unstubbed ESPN url: ${target}` });
  };
}

/** The transport failing outright: no HTTP response is ever produced. */
const DEAD_NETWORK = () => { throw new TypeError('fetch failed'); };
/** ESPN answering, and refusing. */
const REFUSED = () => ({ ok: false, status: 401, json: async () => ({}) });

/**
 * @description Drive GET /fantasy/lineup through the real registered handler.
 * @param options - `{ secret, fetch, query }`.
 * @returns The recorded response.
 */
async function lineup({ secret, fetch: fetchImpl, query = {} }) {
  const state = { sub: 'sub-transport-test', secret };
  const mod = loadFantasyRoutes(state);
  const router = routerDouble();
  mod.registerFantasyRoutes(router, poolDouble());
  const handler = router.routes.get('GET /fantasy/lineup');
  assert.ok(handler, 'the package must register GET /fantasy/lineup');
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const res = responseDouble();
    await handler(
      { query: { season: SEASON, leagueId: LEAGUE, week: WEEK, ...query }, params: {}, body: {}, headers: {} },
      res,
    );
    return res;
  } finally {
    globalThis.fetch = previous;
  }
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
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'sports-edge.html' });
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
