/**
 * Where the runtime cannot carry ESPN's sign-in cookies, no answer tells a person to connect ESPN.
 *
 * On the native kernel the fantasy-leagues skill has no connection lookup and its egress refuses a
 * package Cookie, so a private league answers ESPN's 401 and no team can be matched to an account.
 * The skill says so: `credentialSupport` is `{supported: false, reason}` and a refused league read is
 * classified `credential-unsupported` with that reason. These cases drive the compiled routes with
 * that skill contract and assert the person reads the runtime's limit and the hand-typed league,
 * never "Connect ESPN Fantasy first" (a step that cannot help there). A skill that does not report
 * the limit keeps the connection advice.
 *
 * WHAT IS REAL AND WHAT IS DOUBLED. The compiled routes and fantasy-context.js are the shipped code.
 * The skill is the native client when OSHAL_KERNEL_BRIDGE names the kernel's
 * crates/host-process/bridge directory (its fantasy_leagues.js, the real ESPN client, reading a fetch
 * stub that answers 401); otherwise a double that returns exactly what that client returns for a
 * cookie-less 401 (its guard: the kernel's fantasy_leagues.test.js, through the real runner).
 * Logger, router, caller resolution, connector broker and database are doubled.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — /link of a private league, /status and a board for a league whose team cannot be matched answer the runtime's limit (403, no "connect") when the skill reports credentialSupport.supported false; unchanged advice when it does not. Red on the previous routes ("That league is private. Connect ESPN Fantasy first", "no team in that league belongs to this ESPN account", a connect hint).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | /status claims no credential support the skill did not report: credentialSupported is absent there, present only as false.
 */

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const REASON = 'This installation cannot send your ESPN sign-in cookies (SWID and espn_s2) to ESPN, so it cannot read a '
  + 'private ESPN league or find your own team in one. Type your league in by hand to use every board.';
const PUBLIC_LEAGUE = '777';

/** Load one compiled module, resolving siblings through the same override table. */
function loadCompiled(file, overrides, cache) {
  if (cache.has(file)) return cache.get(file).exports;
  const target = { exports: {} };
  cache.set(file, target);
  const nativeRequire = createRequire(file);
  const localRequire = (name) => {
    if (overrides[name]) return overrides[name];
    if (name.startsWith('@/')) throw new Error(`credential test: undoubled framework import ${name}`);
    if (name.startsWith('./')) return loadCompiled(path.join(path.dirname(file), `${name.slice(2)}.js`), overrides, cache);
    return nativeRequire(name);
  };
  new vm.Script(`(function(require,module,exports,__filename,__dirname){${fs.readFileSync(file, 'utf8')}\n})`, { filename: file })
    .runInThisContext()(localRequire, target, target.exports, file, path.dirname(file));
  return target.exports;
}

/** What the native client returns for a cookie-less read: a public league reads, a private one is refused. */
function nativeSkillDouble() {
  const failure = { kind: 'credential-unsupported', reason: REASON, status: 401 };
  const settings = { leagueId: PUBLIC_LEAGUE, season: 2026, name: 'Public League', scoringPeriodId: 5, scoring: [], slots: [] };
  return {
    credentialSupport: { supported: false, reason: REASON },
    classifyFailure: () => failure,
    parseCredential: () => null,
    findOwnTeam: () => null,
    readLeagueSettingsOutcome: async (_s, id) => (id === PUBLIC_LEAGUE ? { settings, failure: null } : { settings: null, failure }),
    readTeams: async () => [{ teamId: 1, name: 'Somebody', owners: ['{OTHER}'], entries: [], rosterPlayerIds: [], startingPlayerIds: [] }],
    readCurrentScoringPeriod: async () => 5,
  };
}

/** The real native client from the kernel checkout, reading ESPN through a fetch stub. */
function kernelSkill() {
  const dir = process.env.OSHAL_KERNEL_BRIDGE;
  return dir ? require(path.join(dir, 'fantasy_leagues.js')).fantasyLeagues : null;
}

/** ESPN as the native egress sees it: a public league reads, a private one answers 401. */
async function espnStub(url) {
  const json = (status, body) => ({ ok: status === 200, status, json: async () => body });
  if (!String(url).includes(`/leagues/${PUBLIC_LEAGUE}`)) return json(401, {});
  if (String(url).includes('mRoster')) return json(200, { teams: [{ id: 1, name: 'Somebody', owners: ['{OTHER}'], roster: { entries: [] } }] });
  return json(200, { scoringPeriodId: 5, settings: { name: 'Public League', scoringSettings: { scoringItems: [] }, rosterSettings: { lineupSlotCounts: {} } } });
}

function loadRouter(skill) {
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };
  const routes = new Map();
  const add = (method) => (route, ...handlers) => { routes.set(`${method} ${route}`, handlers[handlers.length - 1]); };
  const overrides = {
    '@/shared/logger': { createChildLogger: () => quiet },
    '@/app/routes/trading-routes-helpers': { callerSub: () => 'person-1', servePage: () => () => {} },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/connector-tenancy': { accessibleConnections: async () => [] },
    '@/features/fantasy-leagues': skill,
    express: { Router: () => ({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use() {} }) },
  };
  const mod = loadCompiled(path.join(PACKAGE_DIR, 'routes', 'fantasy-routes.js'), overrides, new Map());
  mod.createFantasyFootballRoutes({ pool: { query: async () => ({ rows: [], rowCount: 0 }) }, appPackageDir: PACKAGE_DIR });
  return routes;
}

async function drive(routes, key, req) {
  const out = { code: 200, body: null };
  const res = { status(n) { out.code = n; return res; }, json(b) { out.body = b; return res; }, setHeader() {}, sendFile() {} };
  const previous = globalThis.fetch;
  globalThis.fetch = espnStub;
  try { await routes.get(key)({ query: {}, params: {}, body: {}, headers: {}, ...req }, res); }
  finally { globalThis.fetch = previous; }
  return out;
}

const skills = [['native skill contract', nativeSkillDouble()], ...(kernelSkill() ? [['kernel fantasy_leagues.js', kernelSkill()]] : [])];

for (const [label, skill] of skills) {
  test(`${label}: linking a private league names the runtime's limit, not "connect ESPN"`, async () => {
    const answer = await drive(loadRouter(skill), 'POST /link', { body: { leagueId: '12345', season: 2026 } });
    assert.equal(answer.code, 403, JSON.stringify(answer.body));
    assert.equal(answer.body.error, REASON);
    assert.doesNotMatch(answer.body.error, /connect/i);
  });

  test(`${label}: /status says the runtime cannot carry the cookies instead of a connect hint`, async () => {
    const answer = await drive(loadRouter(skill), 'GET /status', {});
    assert.equal(answer.code, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.connected, false);
    assert.equal(answer.body.credentialSupported, false);
    assert.equal(answer.body.connectHint, REASON);
  });

  test(`${label}: a readable league whose team cannot be matched says why, not "no team belongs to this account"`, async () => {
    const answer = await drive(loadRouter(skill), 'GET /lineup', { query: { leagueId: PUBLIC_LEAGUE, season: '2026' } });
    assert.equal(answer.code, 403, JSON.stringify(answer.body));
    assert.equal(answer.body.error, REASON);
    assert.doesNotMatch(answer.body.error, /connect|belongs to this ESPN account/i);
  });

  test(`${label}: a public league links and the reply says why no team is shown`, async () => {
    const answer = await drive(loadRouter(skill), 'POST /link', { body: { leagueId: PUBLIC_LEAGUE, season: 2026 } });
    assert.equal(answer.code, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.teamName, null);
    assert.equal(answer.body.teamNote, REASON);
  });
}

test('where the skill does not report the limit, a private league keeps the connection advice', async () => {
  const platform = { ...nativeSkillDouble(), credentialSupport: undefined,
    readLeagueSettingsOutcome: async () => ({ settings: null, failure: { kind: 'refused', reason: 'HTTP 401', status: 401 } }) };
  const answer = await drive(loadRouter(platform), 'POST /link', { body: { leagueId: '12345', season: 2026 } });
  assert.equal(answer.code, 403);
  assert.match(answer.body.error, /^That league is private\. Connect ESPN Fantasy first/);
  const status = await drive(loadRouter(platform), 'GET /status', {});
  assert.equal('credentialSupported' in status.body, false, 'no support is claimed that the skill did not report');
  assert.match(status.body.connectHint, /^Connect ESPN Fantasy/);
});
