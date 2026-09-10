/**
 * Guards for the ESPN read layer.
 *
 * The parsers here are the seam between an undocumented external payload and every number this
 * package publishes, and the dangerous failure is not a crash — it is a quiet mis-attribution.
 * ESPN's odds block does not guarantee that its `homeTeamOdds` field belongs to the home team of
 * the competition we are looking at, so a naive read flips the moneyline on some games and produces
 * a package that is confidently backing the wrong side.
 *
 * Network-touching functions are exercised against a stubbed fetch, so these run offline.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — odds attribution incl. the swapped-block case, provider priority, statistics flattening with formatted numbers, production-stat mapping, and the degrade-not-throw contract on a failing endpoint.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LEAGUE_PATHS, flattenStats, listTeams, parseQuote, productionStatFor, scoreboard, teamSchedule,
} = require('../routes/sports-espn.js');

/** Builds a fetch stub that answers every request with one payload. */
function stub(payload, ok) {
  return async () => ({ ok: ok === undefined ? true : ok, status: ok === false ? 500 : 200, json: async () => payload });
}

test('both leagues resolve to real ESPN path segments', () => {
  assert.deepEqual(LEAGUE_PATHS.nfl, { sport: 'football', league: 'nfl' });
  assert.deepEqual(LEAGUE_PATHS.nba, { sport: 'basketball', league: 'nba' });
});

test('a quote is attributed to the actual home team of the competition', () => {
  const odds = [{
    provider: { name: 'DraftKings', priority: 1 },
    spread: -3.5, overUnder: 44.5,
    homeTeamOdds: { teamId: '26', moneyLine: -180, spreadOdds: -115 },
    awayTeamOdds: { teamId: '17', moneyLine: +150, spreadOdds: -105 },
  }];
  const q = parseQuote(odds, '26');
  assert.equal(q.homeMoneyline, -180);
  assert.equal(q.awayMoneyline, 150);
  assert.equal(q.homeSpread, -3.5);
  assert.equal(q.book, 'DraftKings');
});

test('A SWAPPED ODDS BLOCK IS RE-ATTRIBUTED, NOT TRUSTED — otherwise we back the wrong side', () => {
  // ESPN's `homeTeamOdds` here belongs to team 17, but the competition's home team is 26.
  const odds = [{
    provider: { name: 'DraftKings', priority: 1 },
    spread: -3.5,
    homeTeamOdds: { teamId: '17', moneyLine: +150, spreadOdds: -105 },
    awayTeamOdds: { teamId: '26', moneyLine: -180, spreadOdds: -115 },
  }];
  const q = parseQuote(odds, '26');
  assert.equal(q.homeMoneyline, -180, 'the real home team is the favourite here');
  assert.equal(q.awayMoneyline, 150);
});

test('the highest-priority provider wins when several books are quoted', () => {
  const odds = [
    { provider: { name: 'Other', priority: 5 }, spread: -7, homeTeamOdds: { teamId: '1', moneyLine: -400 }, awayTeamOdds: { teamId: '2', moneyLine: +300 } },
    { provider: { name: 'DraftKings', priority: 1 }, spread: -3.5, homeTeamOdds: { teamId: '1', moneyLine: -180 }, awayTeamOdds: { teamId: '2', moneyLine: +150 } },
  ];
  assert.equal(parseQuote(odds, '1').book, 'DraftKings');
  assert.equal(parseQuote(odds, '1').homeSpread, -3.5);
});

test('an absent field stays undefined rather than defaulting to a number', () => {
  const q = parseQuote([{ provider: { name: 'B', priority: 1 }, homeTeamOdds: { teamId: '1' }, awayTeamOdds: { teamId: '2' } }], '1');
  assert.equal(q.homeMoneyline, undefined, 'a missing price must not become 0');
  assert.equal(q.homeSpread, undefined);
  assert.deepEqual(parseQuote(undefined, '1'), {});
  assert.deepEqual(parseQuote([], '1'), {});
});

test('statistics flatten to numbers, including ESPN comma formatting', () => {
  const flat = flattenStats({
    splits: { categories: [
      { name: 'passing', stats: [{ name: 'passingYards', displayValue: '3,927' }, { name: 'completionPct', value: 62.7 }] },
      { name: 'rushing', stats: [{ name: 'rushingYards', displayValue: '1,812' }] },
    ] },
  });
  assert.equal(flat.passingYards, 3927, 'a thousands separator must not become NaN');
  assert.equal(flat.rushingYards, 1812);
  assert.equal(flat.completionPct, 62.7);
});

test('a malformed statistics payload yields an empty map instead of throwing', () => {
  assert.deepEqual(flattenStats(null), {});
  assert.deepEqual(flattenStats({}), {});
  assert.deepEqual(flattenStats({ splits: { categories: [{ stats: [{ name: 'x', displayValue: 'n/a' }] }] } }), {});
});

test('production stats map to the category a position actually shows up in', () => {
  assert.equal(productionStatFor('nfl', 'QB').athleteStat, 'passingYards');
  assert.equal(productionStatFor('nfl', 'rb').athleteStat, 'rushingYards');
  assert.equal(productionStatFor('nfl', 'WR').athleteStat, 'receivingYards');
  assert.equal(productionStatFor('nba', 'PG').athleteStat, 'points');
});

test('a position with no box-score footprint returns null rather than a plausible guess', () => {
  assert.equal(productionStatFor('nfl', 'OT'), null, 'an offensive lineman has no counting stat');
  assert.equal(productionStatFor('nfl', 'CB'), null);
  assert.equal(productionStatFor('nfl', ''), null);
});

test('a failing endpoint DEGRADES to an empty result — one bad read must not take down a slate', async () => {
  assert.deepEqual(await listTeams('nfl', { fetchImpl: stub({}, false) }), []);
  assert.deepEqual(await scoreboard('nfl', { fetchImpl: stub({}, false) }), []);
  const sched = await teamSchedule('nfl', '12', 2025, { fetchImpl: stub({}, false) });
  assert.deepEqual(sched, { results: [], upcoming: [] });
});

test('a schedule splits finished games from fixtures, and drops rows with no usable score', async () => {
  const payload = { events: [
    { id: '1', date: '2025-09-07T17:00Z', competitions: [{ status: { type: { completed: true } }, neutralSite: false, competitors: [
      { homeAway: 'home', team: { abbreviation: 'KC' }, score: { value: 21 } },
      { homeAway: 'away', team: { abbreviation: 'LAC' }, score: { value: 27 } }] }] },
    { id: '2', date: '2025-09-14T17:00Z', competitions: [{ status: { type: { completed: false } }, competitors: [
      { homeAway: 'home', team: { abbreviation: 'PHI' } }, { homeAway: 'away', team: { abbreviation: 'KC' } }] }] },
    { id: '3', date: '2025-09-21T17:00Z', competitions: [{ status: { type: { completed: true } }, competitors: [
      { homeAway: 'home', team: { abbreviation: 'KC' } }, { homeAway: 'away', team: { abbreviation: 'NYG' } }] }] },
  ] };
  const { results, upcoming } = await teamSchedule('nfl', '12', 2025, { fetchImpl: stub(payload) });
  assert.equal(results.length, 1, 'the completed game with no score is dropped, not defaulted to 0-0');
  assert.deepEqual(
    { h: results[0].homeTeam, a: results[0].awayTeam, hs: results[0].homeScore, as: results[0].awayScore },
    { h: 'KC', a: 'LAC', hs: 21, as: 27 },
  );
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].eventId, '2');
});

test('A TRANSIENT FAILURE IS RETRIED — one attempt from a busy event loop is not a reliable read', async () => {
  // Found on the live box 2026-09-07: eight consecutive reads from a fresh process in the same
  // container all succeeded under 1.6s, while the long-running api intermittently failed the
  // identical read — and the failure rendered as "your team has no games this week".
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) throw new Error('socket hang up');
    return { ok: true, status: 200, json: async () => ({ sports: [{ leagues: [{ teams: [{ team: { id: '26', abbreviation: 'SEA', displayName: 'Seattle', location: 'Seattle' } }] }] }] }) };
  };
  const teams = await listTeams('nfl', { fetchImpl: flaky, attempts: 3 });
  assert.equal(calls, 3, 'it must actually retry, not fail on the first attempt');
  assert.equal(teams.length, 1, 'and return the data the retry fetched');
});

test('a 4xx is NOT retried — it is a statement about the request, not a transient blip', async () => {
  let calls = 0;
  const notFound = async () => { calls += 1; return { ok: false, status: 404, json: async () => ({}) }; };
  await listTeams('nfl', { fetchImpl: notFound, attempts: 4 });
  assert.equal(calls, 1, 'retrying a 404 four times just wastes four times as long');
});

test('a 5xx and a 429 ARE retried', async () => {
  for (const status of [500, 503, 429]) {
    let calls = 0;
    const flaky = async () => { calls += 1; return { ok: false, status, json: async () => ({}) }; };
    await listTeams('nfl', { fetchImpl: flaky, attempts: 3 });
    assert.equal(calls, 3, `HTTP ${status} should be retried`);
  }
});

test('ONCE EVERY ATTEMPT FAILS, onError FIRES — this is what stops "unreachable" reading as "no games"', async () => {
  const failures = [];
  const dead = async () => { throw new Error('ENOTFOUND'); };
  const games = await scoreboard('nfl', {
    fetchImpl: dead, attempts: 2,
    onError: (url, reason) => failures.push({ url, reason }),
  });
  assert.deepEqual(games, [], 'the call still degrades to empty rather than throwing');
  assert.equal(failures.length, 1, 'but the caller is TOLD, so it can say "unreachable" not "none"');
  assert.match(failures[0].reason, /ENOTFOUND/);
  assert.match(failures[0].url, /scoreboard/);
});

test('onError does NOT fire on a successful read, so a good read is never reported as degraded', async () => {
  const failures = [];
  await scoreboard('nfl', { fetchImpl: stub({ events: [] }), onError: () => failures.push(1) });
  assert.equal(failures.length, 0, 'an empty-but-successful scoreboard is an ANSWER, not a failure');
});
