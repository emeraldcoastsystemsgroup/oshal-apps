/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove current ESPN coach discovery, missing/stale staff refusal, shared cooldown and followed-owner isolation through actual compiled refresh code.
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
  assert.deepEqual(await f.refresh(), { subjects: 2, newItems: 2 });
  assert.equal(f.state.ingested.some(subject => subject.entity.startsWith('world:person:')), false);
});

test('the actual refresh reads its stored team ID and ingests coach through the same World service and feed set', async () => {
  const f = coachFixture([team()]); f.state.payloads.set('501', coach());
  assert.deepEqual(await f.refresh(), { subjects: 3, newItems: 3 });
  assert.equal(f.state.reads.length, 1); assert.match(f.state.reads[0], /\/football\/nfl\/teams\/501\/roster$/);
  const person = f.state.ingested.find(subject => subject.entity === 'world:person:morgan-example');
  assert.equal(person.label, 'Morgan Example'); assert.match(person.query, /Morgan Example Fixture Alpine NFL/);
  assert.deepEqual(person.sources, ['google-news', 'bing-news', 'reddit']); assert.deepEqual(person.options, { limit: 15 });
  assert.equal(f.state.saved.find(row => row[0] === person.entity)[2], 'coach');
});

test('a changed head coach replaces future subjects only on the persistent team cooldown, including after reload', async () => {
  const f = coachFixture([team()]); f.state.payloads.set('501', coach()); await f.refresh();
  f.state.payloads.set('501', coach('501', 'Jordan Example')); f.restart();
  assert.deepEqual(await f.refresh(), { subjects: 0, newItems: 0 }); assert.equal(f.state.reads.length, 1);
  f.age(); f.state.ingested.length = 0;
  assert.deepEqual(await f.refresh(), { subjects: 3, newItems: 3 });
  assert.equal(f.state.reads.length, 2);
  assert.deepEqual(f.state.ingested.filter(subject => subject.entity.startsWith('world:person:')).map(subject => subject.entity), ['world:person:jordan-example']);
  assert.ok(f.state.pulls.has('world:person:morgan-example'), 'historical coach archive is preserved');
});

test('a missing coach can be discovered on the next team cycle without creating placeholder history', async () => {
  const f = coachFixture([team()]); await f.refresh();
  f.state.payloads.set('501', coach()); assert.equal((await f.refresh()).subjects, 0);
  f.age(); assert.equal((await f.refresh()).subjects, 3);
  assert.equal(f.state.pulls.has('world:person:'), false); assert.equal(f.state.pulls.has('world:person:undefined'), false);
});

test('team identity mismatch and caller-shaped paths are refused before any coach is attributed', async () => {
  let requests = 0;
  const options = { fetchImpl: async () => { requests++; return { ok: true, json: async () => coach('999') }; } };
  assert.equal(await teamHeadCoach('nfl', '501', 'ALP', options), null);
  for (const id of ['../501', 'https://other.test', '501?token=private', '', 'undefined']) assert.equal(await teamHeadCoach('nfl', id, 'ALP', options), null);
  assert.equal(requests, 1);
});

test('shared team discovery deduplicates owners while each person retains only their own follows', async () => {
  const f = coachFixture([team(), team('owner-b'), team('owner-b', '502', 'BET')]);
  f.state.payloads.set('501', coach()); f.state.payloads.set('502', coach('502', 'Taylor Example', 'BET'));
  assert.equal((await listFollowed(f.pool, 'owner-a')).length, 1);
  assert.equal((await listFollowed(f.pool, 'owner-b')).length, 2);
  assert.deepEqual(await listFollowed(f.pool, 'unrelated-owner'), []);
  await f.refresh(); assert.equal(f.state.reads.length, 2);
  const separate = coachFixture([]); await separate.refresh();
  assert.equal(separate.state.reads.length, 0); assert.equal(separate.state.ingested.length, 0);
  assert.equal(f.state.teams.length, 3, 'ingestion never creates, changes or borrows followed ownership');
});

test('disabled World makes no provider request and the pass budget retains complete team-coach groups', async () => {
  const f = coachFixture(Array.from({ length: 10 }, (_, index) => team('owner-a', String(501 + index), 'TEAM' + index)));
  for (const row of f.state.teams) f.state.payloads.set(row.team_id, coach(row.team_id, `Coach ${String.fromCharCode(65 + Number(row.team_id) - 501)} Example`, row.team));
  f.state.enabled = false; assert.deepEqual(await f.refresh(), { subjects: 0, newItems: 0 }); assert.equal(f.state.reads.length, 0);
  f.state.enabled = true; assert.equal((await f.refresh()).subjects, 12); assert.equal(f.state.reads.length, 4);
  assert.equal(f.state.ingested.filter(subject => subject.entity.startsWith('world:person:')).length, 4);
  assert.equal((await f.refresh()).subjects, 12, 'next pass can serve the teams left outside the previous budget');
});

test('new coach attribution verifies the provider abbreviation and uses its team label instead of caller text', async () => {
  const f = coachFixture([{ ...team(), display_name: 'Untrusted caller label' }]);
  f.state.payloads.set('501', coach('501', 'Morgan Example', 'OTHER'));
  assert.equal((await f.refresh()).subjects, 2);
  f.age(); f.state.payloads.set('501', coach()); await f.refresh();
  const person = f.state.ingested.find(subject => subject.entity === 'world:person:morgan-example');
  assert.match(person.query, /Fixture Alpine/); assert.doesNotMatch(person.query, /Untrusted caller label/);
});

test('conflicting IDs for one shared team never choose an arbitrary owner row for coach attribution', async () => {
  for (const rows of [[team(), team('owner-b', '999')], [team('owner-b', '999'), team()]]) {
    const f = coachFixture(rows); f.state.payloads.set('501', coach()); f.state.payloads.set('999', coach('999', 'Wrong Example'));
    assert.equal((await f.refresh()).subjects, 2);
    assert.equal(f.state.reads.length, 0); assert.equal(f.state.ingested.some(subject => subject.entity.startsWith('world:person:')), false);
  }
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
