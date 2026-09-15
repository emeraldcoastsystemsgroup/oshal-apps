/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the compiled refresh and ESPN client with fixture-only World, HTTP and durable-ledger boundaries.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const espn = require('../routes/sports-espn.js');

/** @description Model only the existing ledger statements; unexpected SQL is a fixture failure. */
function fixturePool(state) {
  return { query: async (sql, values = []) => {
    if (sql.includes('SELECT DISTINCT league, team')) {
      assert.match(sql, /team_id/);
      return { rows: state.teams.map(({ league, team, team_id, display_name }) => ({ league, team, team_id, display_name })) };
    }
    if (sql.includes('FROM sports_followed_teams') && sql.includes('WHERE user_sub = $1')) {
      return { rows: state.teams.filter(row => row.user_sub === values[0]) };
    }
    if (sql.includes('SELECT entity, last_pulled')) return { rows: [...state.pulls].map(([entity, last_pulled]) => ({ entity, last_pulled })) };
    if (sql.includes('FROM sports_previews')) return { rows: [] };
    if (sql.includes('INSERT INTO sports_world_pulls')) {
      state.pulls.set(values[0], new Date().toISOString()); state.saved.push(values); return { rows: [], rowCount: 1 };
    }
    throw new Error('Unexpected fixture SQL');
  } };
}

/** @description Replace only external boundaries, retaining the actual compiled provider and refresh orchestration. */
function loadRefresh(state) {
  const file = path.resolve(__dirname, '../routes/sports-refresh.js');
  const nativeRequire = createRequire(file);
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const overrides = {
    '@/shared/logger': { createChildLogger: () => logger },
    '@/features/world-data': {
      createWorldIntelligenceService: () => state.enabled ? state.service : null,
      ingestFeeds: async (service, query, entity, label, sources, options) => {
        assert.equal(service, state.service);
        state.ingested.push({ query, entity, label, sources, options });
        return { perSource: [{ fetched: 2, newItems: 1 }] };
      },
    },
    './sports-espn': { ...espn, teamHeadCoach: (league, id, team, options) => espn.teamHeadCoach(league, id, team, { ...options, fetchImpl: state.fetch }) },
  };
  const target = { exports: {} };
  const wrapper = new vm.Script(`(function(require,module,exports){${fs.readFileSync(file, 'utf8')}\n})`, { filename: file });
  wrapper.runInThisContext()(name => overrides[name] || nativeRequire(name), target, target.exports);
  return target.exports;
}

/** @description Each fixture has a distinct deployment ledger, followed ownership and provider transcript. */
function coachFixture(teams = []) {
  const state = { teams, pulls: new Map(), saved: [], ingested: [], reads: [], payloads: new Map(), enabled: true, service: {} };
  state.fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://site.api.espn.com');
    assert.match(url.pathname, /^\/apis\/site\/v2\/sports\/(football\/(nfl|college-football)|basketball\/nba)\/teams\/[0-9]+\/roster$/);
    assert.equal(init.headers, undefined, 'public team discovery must not receive Fantasy cookies or another credential');
    assert.equal(init.method, undefined, 'existing client uses the default GET');
    state.reads.push(url.href);
    return { ok: true, status: 200, json: async () => state.payloads.get(url.pathname.split('/').at(-2)) || {} };
  };
  const pool = fixturePool(state);
  let refresh = loadRefresh(state);
  return { state, pool, refresh: () => refresh.refreshWorld(pool), restart: () => { refresh = loadRefresh(state); },
    age: () => { for (const entity of state.pulls.keys()) state.pulls.set(entity, '2000-01-01T00:00:00Z'); } };
}

module.exports = { coachFixture };
