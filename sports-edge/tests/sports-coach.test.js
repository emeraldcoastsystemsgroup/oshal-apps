/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove current ESPN coach discovery, missing/stale staff refusal, shared cooldown and followed-owner isolation through actual compiled refresh code.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Item A (0.12.3): keep all ESPN coach parser, team-identity verification, malformed-name refusal, and follow-ownership isolation guards intact while verifying refreshWorld is retired and makes zero World ingest or roster calls.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHeadCoach, teamHeadCoach } = require('../routes/sports-espn.js');
const { coachSubject, coachEntityId } = require('../routes/sports-world.js');
const { listFollowed } = require('../routes/sports-store.js');
const { coachFixture } = require('./sports-coach-fixture.js');

const team = (owner = 'owner-a', id = '501', abbreviation = 'ALP') => ({
  user_sub: owner, league: 'nfl', team: abbreviation, team_id: id, display_name: 'Fixture Alpine',
});
const coach = (id = '501', name = 'Morgan Example', abbreviation = 'ALP') => ({
  team: { id, abbreviation, displayName: 'Fixture Alpine' },
  coach: [{ firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' ') }],
});

test('normalizes explicit heads and the single unlabelled ESPN coach without choosing the first assistant', () => {
  assert.equal(parseHeadCoach({ coach: [{ firstName: 'Mara', lastName: 'Example' }] }), 'Mara Example');
  assert.equal(parseHeadCoach({ coach: [{ title: 'Assistant Coach', fullName: 'Assistant Example' },
    { position: { name: 'Interim Head Coach' }, displayName: ' Interim  Example ' }] }), 'Interim Example');
  for (const coaches of [[], [{ title: 'Assistant Coach', fullName: 'Assistant Example' }],
    [{ fullName: 'First Example' }, { fullName: 'Second Example' }],
    [{ title: 'Head Coach', fullName: 'First Example' }, { title: 'Head Coach', fullName: 'Second Example' }]]) {
    assert.equal(parseHeadCoach({ coach: coaches }), null);
  }
});

test('missing and malformed coach names never produce an empty or undefined person subject', async () => {
  for (const name of [undefined, null, '', ' ', 'undefined', 'null', 'Unknown', 'TBD', '---', { fullName: 'Invented' }]) {
    assert.equal(coachSubject(name, 'Fixture Alpine', 'nfl'), null);
    assert.throws(() => coachEntityId(name), /named coach/);
    assert.equal(parseHeadCoach({ coach: [{ fullName: name }] }), null);
  }
  const f = coachFixture([team()]);
  f.state.payloads.set('501', { team: { id: '501', abbreviation: 'ALP' }, coach: [{ firstName: 'Missing' }] });
  assert.deepEqual(await f.refresh(), { subjects: 0, newItems: 0 });
  assert.equal(f.state.ingested.length, 0);
});

test('retired refreshWorld spends zero ESPN roster reads, zero World ingests, and zero pull writes', async () => {
  const f = coachFixture([team(), team('owner-b', '502', 'BET')]);
  f.state.payloads.set('501', coach());
  f.state.payloads.set('502', coach('502', 'Taylor Example', 'BET'));
  assert.deepEqual(await f.refresh(), { subjects: 0, newItems: 0 });
  assert.equal(f.state.reads.length, 0, 'retired wire ingest makes no roster fetch');
  assert.equal(f.state.ingested.length, 0, 'retired wire ingest pushes nothing to World');
  assert.equal(f.state.saved.length, 0, 'retired wire ingest writes no sports_world_pulls rows');
});

test('team identity mismatch and caller-shaped paths are refused before any coach is attributed', async () => {
  let requests = 0;
  const options = { fetchImpl: async () => { requests++; return { ok: true, json: async () => coach('999') }; } };
  assert.equal(await teamHeadCoach('nfl', '501', 'ALP', options), null);
  for (const id of ['../501', 'https://other.test', '501?token=private', '', 'undefined']) assert.equal(await teamHeadCoach('nfl', id, 'ALP', options), null);
  assert.equal(requests, 1);
});

test('followed-team ownership remains isolated per owner and untouched by refreshWorld', async () => {
  const f = coachFixture([team(), team('owner-b'), team('owner-b', '502', 'BET')]);
  assert.equal((await listFollowed(f.pool, 'owner-a')).length, 1);
  assert.equal((await listFollowed(f.pool, 'owner-b')).length, 2);
  assert.deepEqual(await listFollowed(f.pool, 'unrelated-owner'), []);
  await f.refresh();
  assert.equal(f.state.teams.length, 3, 'refreshWorld never creates, changes or borrows followed ownership');
});

test('provider abbreviation verification rejects mismatched teams and uses provider team label', async () => {
  const mismatched = { fetchImpl: async () => ({ ok: true, json: async () => coach('501', 'Morgan Example', 'OTHER') }) };
  assert.equal(await teamHeadCoach('nfl', '501', 'ALP', mismatched), null);
  const matched = { fetchImpl: async () => ({ ok: true, json: async () => coach('501', 'Morgan Example', 'ALP') }) };
  assert.deepEqual(await teamHeadCoach('nfl', '501', 'ALP', matched), { name: 'Morgan Example', teamName: 'Fixture Alpine' });
});

test('all supported leagues read the observed roster envelope and ignore the old nested-team assumption', async () => {
  for (const [league, segment] of [['nfl', 'football/nfl'], ['nba', 'basketball/nba'], ['ncaaf', 'football/college-football']]) {
    const reads = [];
    let payload = coach();
    const opts = { fetchImpl: async url => { reads.push(url); return { ok: true, json: async () => payload }; } };
    assert.deepEqual(await teamHeadCoach(league, '501', 'ALP', opts), { name: 'Morgan Example', teamName: 'Fixture Alpine' });
    assert.equal(reads[0], `https://site.api.espn.com/apis/site/v2/sports/${segment}/teams/501/roster`);
    payload = { team: { ...payload.team, coaches: [{ fullName: 'Old Assumption' }] } };
    assert.equal(await teamHeadCoach(league, '501', 'ALP', opts), null);
    payload = { ...coach(), team: { ...coach().team, abbreviation: { malformed: true } } };
    assert.equal(await teamHeadCoach(league, '501', 'ALP', opts), null);
  }
});
