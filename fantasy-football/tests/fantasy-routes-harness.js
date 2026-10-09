/**
 * The compiled fantasy-football router, loaded for the plain-node route suites.
 *
 * WHAT IS REAL AND WHAT IS DOUBLED. The router factory, every handler, the scoring, the objective,
 * the store's own SQL statements and the ESPN client (the fantasy-leagues kernel skill, compiled from
 * the framework checkout by fantasy-leagues-fixture.js) are the shipped code. Doubled, because a
 * plain-node suite has no framework: the logger (quiet, but it records ERROR lines when asked),
 * express's Router (a recorder so a handler can be driven directly), the caller resolution, the
 * connector broker, and the database round trip.
 *
 * The database double is an in-memory reading of the statements the store actually sends — each
 * INSERT is decoded from the parameters the route passed and each SELECT answered under the same
 * owner/season/week bounds — so a route that never writes, never reads, or reads another owner's
 * key finds nothing here exactly as it would against PostgreSQL. It does NOT prove row-level
 * security: tests/fantasy-isolation.spec.ts proves that on a disposable PostgreSQL with FORCED
 * policies, a NOBYPASSRLS role, the real broker and the real routes over HTTP.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — one loader for the compiled router shared by the transport and history suites (moved from sports-edge, where each suite carried its own), plus an owner-keyed in-memory reading of the ff_* statements.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.2.0: the database double reads the hand-typed league, week-ledger and call-grading statements too (each by what it asks, owner first), refuses an unrecognised data statement instead of answering empty, and the broker double counts connection lookups so the manual-entry parity guard can prove the connector was never consulted.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The logger double records every ERROR line into `state.logs` when a suite passes that array, so a suite can prove a read that degrades instead of failing logs its error (the house rule every catch logs) rather than swallowing it.
 */

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { fantasyLeagues } = require('./fantasy-leagues-fixture.js');

const PACKAGE_DIR = path.resolve(__dirname, '..');

/** Collects the handlers a router registers, so one can be driven directly. */
function routerDouble() {
  const routes = new Map();
  const add = (method) => (route, ...handlers) => { routes.set(`${method} ${route}`, handlers[handlers.length - 1]); };
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use() {} };
}

/** Records the status and body a handler answered with. */
function responseDouble() {
  const out = { code: 200, body: null, headers: {} };
  out.status = (n) => { out.code = n; return out; };
  out.json = (b) => { out.body = b; return out; };
  out.setHeader = (k, v) => { out.headers[k] = v; };
  out.sendFile = (f) => { out.body = { file: f }; return out; };
  return out;
}

/**
 * @description Load one compiled module from routes/, resolving its sibling modules through the
 * same override table so every framework import in the whole graph is the doubled one.
 * @param file - Absolute path of the compiled module.
 * @param overrides - Specifier -> exports.
 * @param cache - Module cache for this load.
 * @returns The module's exports.
 */
function loadCompiled(file, overrides, cache) {
  if (cache.has(file)) return cache.get(file).exports;
  const target = { exports: {} };
  cache.set(file, target);
  const nativeRequire = createRequire(file);
  const localRequire = (name) => {
    if (overrides[name]) return overrides[name];
    if (name.startsWith('@/')) throw new Error(`route harness: undoubled framework import ${name}`);
    if (name.startsWith('./')) return loadCompiled(path.join(path.dirname(file), `${name.slice(2)}.js`), overrides, cache);
    return nativeRequire(name);
  };
  new vm.Script(`(function(require,module,exports,__filename,__dirname){${fs.readFileSync(file, 'utf8')}\n})`, { filename: file })
    .runInThisContext()(localRequire, target, target.exports, file, path.dirname(file));
  return target.exports;
}

/**
 * @description The router as the kernel would mount it, with only the framework seams doubled.
 * @param state - `{ sub, secret, shared, logs }`: the caller, their own stored secret (or null),
 *                whether an espn-fantasy connection shared by someone else is also reachable, and
 *                optionally an array that receives every ERROR line the package logs.
 * @param pool - The database double.
 * @returns `{ router, exports }`.
 */
function loadRouter(state, pool) {
  const error = (fields, msg) => { if (state.logs) state.logs.push({ msg, fields }); };
  const quiet = { debug() {}, info() {}, warn() {}, error };
  const own = { connection_id: 'own-1', tenant_id: null, user_sub: state.sub };
  const shared = { connection_id: 'shared-1', tenant_id: '00000000-0000-0000-0000-00000000aaaa', user_sub: 'someone-else' };
  const broker = { calls: [], lookups: 0 };
  const overrides = {
    '@/shared/logger': { createChildLogger: () => quiet },
    '@/app/routes/trading-routes-helpers': { callerSub: () => state.sub, servePage: () => () => {} },
    '@/app/routes/connectors-routes': {
      getValidAccessToken: async (_pool, sub, provider, opts) => {
        broker.calls.push({ sub, provider, opts });
        if (opts && opts.connectionId === 'shared-1') return state.sharedSecret || null;
        return state.secret;
      },
    },
    '@/app/routes/connector-tenancy': {
      accessibleConnections: async () => { broker.lookups += 1; return [...(state.shared ? [shared] : []), ...(state.secret ? [own] : [])]; },
    },
    // The real kernel skill, from the framework source — not a double. It is the ESPN client.
    '@/features/fantasy-leagues': fantasyLeagues(),
    express: { Router: () => routerDouble() },
  };
  const mod = loadCompiled(path.join(PACKAGE_DIR, 'routes', 'fantasy-routes.js'), overrides, new Map());
  const router = mod.createFantasyFootballRoutes({ pool, appPackageDir: PACKAGE_DIR });
  return { router, exports: mod, broker };
}

/**
 * @description Drive one registered handler with a fetch stub in place of the network.
 * @param router - The recorded router.
 * @param key - `METHOD /path` as registered.
 * @param req - Partial request.
 * @param fetchImpl - The fetch stub for the duration of the call.
 * @returns The recorded response.
 */
async function drive(router, key, req, fetchImpl) {
  const handler = router.routes.get(key);
  assert.ok(handler, `the package must register ${key}`);
  const previous = globalThis.fetch;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try {
    const res = responseDouble();
    await handler({ query: {}, params: {}, body: {}, headers: {}, ...req }, res);
    return res;
  } finally {
    globalThis.fetch = previous;
  }
}

/**
 * @description Serve ESPN from ordered [url fragment, answer] rules. An answer that is a function is
 * called (which is how a rule throws, the shape a dead resolver produces); anything else is a 200
 * JSON body. An unmatched URL is a fixture failure, never a silent empty read.
 * @param rules - Ordered match rules.
 * @param seen - Optional array that records every URL and Cookie header sent.
 * @returns A fetch implementation.
 */
function espnFetch(rules, seen) {
  return async (url, init) => {
    const target = String(url);
    if (seen) seen.push({ url: target, cookie: String((init && init.headers && init.headers.Cookie) || '') });
    for (const [fragment, answer] of rules) {
      if (!target.includes(fragment)) continue;
      if (typeof answer === 'function') return answer(target, init);
      return { ok: true, status: 200, json: async () => answer };
    }
    throw new assert.AssertionError({ message: `unstubbed ESPN url: ${target}` });
  };
}

/** The ff_calls statements, read by what each one asks. */
function callHandlers(t) {
  const shape = (c) => ({ ...c, start_player_id: c.startId, sit_player_id: c.sitId, start_player_name: c.startName, sit_player_name: c.sitName });
  return [
    [/INSERT INTO ff_calls/, (p) => {
      const key = `${p[0]}:${p[1]}:${p[2]}:${p[3]}:${p[4]}:${p[6]}`;
      const found = t.calls.find((c) => c.key === key);
      if (found && found.settled) return { rows: [], rowCount: 0 };
      const row = { key, id: found ? found.id : t.calls.length + 1, user_sub: p[0], season: p[1], league_id: p[2], week: p[3],
        startId: p[4], startName: p[5], sitId: p[6], sitName: p[7], projected_gain: p[11], settled: false, actual_gain: null };
      if (found) Object.assign(found, row); else t.calls.push(row);
      return { rows: [], rowCount: 1 };
    }],
    [/FROM ff_calls\s+WHERE user_sub = \$1 AND settled = FALSE AND season = \$2 AND league_id = \$3 AND week = \$4/, (p) => ({
      rows: t.calls.filter((c) => c.user_sub === p[0] && !c.settled && c.season === p[1] && c.league_id === p[2] && c.week === p[3]).map(shape),
    })],
    [/FROM ff_calls\s+WHERE user_sub = \$1 AND settled = FALSE AND season = \$2 AND week < \$3/, (p) => ({
      rows: t.calls.filter((c) => c.user_sub === p[0] && !c.settled && c.season === p[1] && c.week < p[2]).map(shape),
    })],
    [/UPDATE ff_calls/, (p) => {
      const c = t.calls.find((x) => x.user_sub === p[0] && x.id === p[1] && !x.settled);
      if (c) Object.assign(c, { settled: true, actual_start: p[2], actual_sit: p[3], actual_gain: p[2] - p[3] });
      return { rows: [], rowCount: c ? 1 : 0 };
    }],
    [/count\(\*\) AS graded/, (p) => {
      const mine = t.calls.filter((c) => c.user_sub === p[0] && c.settled);
      return { rows: [{ graded: mine.length, right_calls: mine.filter((c) => c.actual_gain > 0).length,
        actual_points: mine.reduce((s, c) => s + c.actual_gain, 0), projected_points: mine.reduce((s, c) => s + c.projected_gain, 0) }] };
    }],
    [/FROM ff_calls WHERE user_sub = \$1 ORDER BY/, (p) => ({ rows: t.calls.filter((c) => c.user_sub === p[0]).map(shape) })],
  ];
}

/** The ff_weeks statements. */
function weekHandlers(t) {
  return [
    [/INSERT INTO ff_weeks/, (p) => {
      const key = `${p[0]}:${p[1]}:${p[2]}:${p[3]}`;
      const found = t.weeks.get(key);
      if (found && found.graded) return { rows: [], rowCount: 0 };
      t.weeks.set(key, { user_sub: p[0], season: p[1], league_key: p[2], week: p[3], source: p[4], advised: JSON.parse(p[5]),
        mean_lineup: JSON.parse(p[6]), started: JSON.parse(p[7]), swaps: JSON.parse(p[8]), win_probability: p[9],
        mean_win_probability: p[10], projected_advised: p[11], projected_started: p[12], graded: false });
      return { rows: [], rowCount: 1 };
    }],
    [/FROM ff_weeks\s+WHERE user_sub = \$1 AND season = \$2 AND week < \$3 AND graded = FALSE/, (p) => ({
      rows: [...t.weeks.values()].filter((w) => w.user_sub === p[0] && w.season === p[1] && w.week < p[2] && !w.graded).sort((a, b) => a.week - b.week),
    })],
    [/UPDATE ff_weeks SET graded = TRUE/, (p) => {
      const w = t.weeks.get(`${p[0]}:${p[1]}:${p[2]}:${p[3]}`);
      if (w && !w.graded) Object.assign(w, { graded: true, started: JSON.parse(p[4]), actual_advised: p[5], actual_started: p[6], actual_gain: p[5] - p[6] });
      return { rows: [], rowCount: w ? 1 : 0 };
    }],
    [/FROM ff_weeks WHERE user_sub = \$1 ORDER BY/, (p) => ({
      rows: [...t.weeks.values()].filter((w) => w.user_sub === p[0]).sort((a, b) => b.week - a.week),
    })],
  ];
}

/** The ff_manual_leagues statements. */
function manualHandlers(t) {
  const row = (m) => ({ id: m.id, name: m.name, season: m.season, doc: m.doc, updated_at: m.updated_at });
  return [
    [/INSERT INTO ff_manual_leagues/, (p) => {
      const m = { id: t.manual.length + 1, user_sub: p[0], name: p[1], season: p[2], doc: JSON.parse(p[3]), updated_at: new Date().toISOString() };
      t.manual.push(m);
      return { rows: [{ id: m.id }], rowCount: 1 };
    }],
    [/UPDATE ff_manual_leagues/, (p) => {
      const m = t.manual.find((x) => x.user_sub === p[0] && x.id === p[1]);
      if (m) Object.assign(m, { name: p[2], season: p[3], doc: JSON.parse(p[4]), updated_at: new Date().toISOString() });
      return { rows: m ? [{ id: m.id }] : [], rowCount: m ? 1 : 0 };
    }],
    [/^SELECT[\s\S]*FROM ff_manual_leagues WHERE user_sub = \$1 AND id = \$2/, (p) => ({ rows: t.manual.filter((x) => x.user_sub === p[0] && x.id === p[1]).map(row) })],
    [/FROM ff_manual_leagues WHERE user_sub = \$1 ORDER BY/, (p) => ({ rows: t.manual.filter((x) => x.user_sub === p[0]).map(row) })],
    [/DELETE FROM ff_manual_leagues/, (p) => {
      const before = t.manual.length;
      t.manual = t.manual.filter((x) => !(x.user_sub === p[0] && x.id === p[1]));
      return { rows: [], rowCount: before - t.manual.length };
    }],
  ];
}

/** The ff_projections, ff_player_weeks and ff_leagues statements. */
function feedHandlers(t) {
  return [
    [/INSERT INTO ff_projections/, (p) => {
      t.projections.set(`${p[0]}:${p[1]}:${p[2]}`, { scoring_period: p[2], payload: JSON.parse(p[3]), players: p[4], generated_at: new Date().toISOString() });
      return { rows: [], rowCount: 1 };
    }],
    [/scoring_period BETWEEN \$3 AND \$4/, (p) => ({
      rows: [...t.projections.entries()].filter(([k]) => { const [sub, season, week] = k.split(':'); return sub === p[0] && Number(season) === p[1] && Number(week) >= p[2] && Number(week) <= p[3]; })
        .map(([, v]) => v),
    })],
    [/FROM ff_projections/, (p) => { const r = t.projections.get(`${p[0]}:${p[1]}:${p[2]}`); return { rows: r ? [r] : [] }; }],
    [/INSERT INTO ff_player_weeks/, (p) => {
      for (let i = 2; i < p.length; i += 3) {
        t.playerWeeks.set(`${p[0]}:${p[1]}:${p[i]}:${p[i + 1]}`, { sub: p[0], season: p[1], week: p[i], player_id: p[i + 1], stats: JSON.parse(p[i + 2]) });
      }
      return { rows: [], rowCount: (p.length - 2) / 3 };
    }],
    [/FROM ff_player_weeks\s+WHERE user_sub = \$1 AND season = \$2 AND week = \$3/, (p) => ({
      rows: [...t.playerWeeks.values()].filter((r) => r.sub === p[0] && r.season === p[1] && r.week === p[2]).map((r) => ({ player_id: r.player_id, stats: r.stats })),
    })],
    [/FROM ff_player_weeks/, (p) => ({
      rows: [...t.playerWeeks.values()]
        .filter((r) => r.sub === p[0] && r.season === p[1] && r.week < p[2] && p[3].includes(r.player_id))
        .sort((a, b) => a.week - b.week).map((r) => ({ week: r.week, player_id: r.player_id, stats: r.stats })),
    })],
    [/INSERT INTO ff_leagues/, (p) => {
      t.leagues.set(`${p[0]}:${p[1]}:${p[2]}`, { user_sub: p[0], season: p[1], league_id: p[2], league_name: p[3], team_id: p[4], team_name: p[5] });
      return { rows: [], rowCount: 1 };
    }],
    [/DELETE FROM ff_leagues/, (p) => {
      const key = `${p[0]}:${p[1]}:${p[2]}`;
      const had = t.leagues.delete(key);
      return { rows: [], rowCount: had ? 1 : 0 };
    }],
    [/FROM ff_leagues/, (p) => ({ rows: [...t.leagues.values()].filter((l) => l.user_sub === p[0]) })],
  ];
}

/**
 * @description An owner-keyed, in-memory reading of the ff_* statements the store sends. Every
 * read filters on the owner parameter the statement carries, exactly as the SQL does; an unknown
 * data statement is a fixture failure, never a silent empty answer.
 * @returns The pool double, its tables and every statement it was asked.
 */
function memPool() {
  const t = { leagues: new Map(), projections: new Map(), playerWeeks: new Map(), calls: [], weeks: new Map(), manual: [] };
  const statements = [];
  const handlers = [...callHandlers(t), ...weekHandlers(t), ...manualHandlers(t), ...feedHandlers(t)];
  return {
    tables: t,
    statements,
    async query(sql, params = []) {
      const text = String(typeof sql === 'string' ? sql : sql.text);
      const p = typeof sql === 'string' ? params : sql.values;
      statements.push({ text, params: p });
      const hit = handlers.find(([re]) => re.test(text));
      if (hit) { const out = hit[1](p); return { rows: out.rows, rowCount: out.rowCount ?? out.rows.length }; }
      if (/^\s*(CREATE|ALTER|DO \$\$)/.test(text)) return { rows: [], rowCount: 0 };
      throw new Error(`memPool: unrecognised statement ${text.slice(0, 80)}`);
    },
  };
}

module.exports = { drive, espnFetch, loadRouter, memPool, responseDouble, routerDouble };
