/**
 * Guards for the World Intelligence bridge.
 *
 * The premise of routing through World is that the archive is SHARED. That makes entity naming the
 * load-bearing part and the only thing here that can fail silently: a subject spelled two ways is
 * two half-empty archives, every sentiment series computed over either one is a lie of omission,
 * and nothing anywhere errors. So the ids are pinned by test rather than trusted to be stable.
 *
 * The second failure is money. A re-pull is free of correctness risk — World dedupes by content
 * hash — but it is not free of cost: every unseen item is classified by a model. A cool-down that
 * silently stops working therefore produces a correct archive and a growing bill, which is exactly
 * the kind of defect nobody notices until it is large.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — stable, league-qualified entity ids, the team/injury split, disambiguated queries, matchup keying by event id, dedup, the restart-proof cool-down, and an ingest that reports a failure instead of throwing into a pass that is also capturing lines.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SPORTS_FEED_IDS, coachEntityId, coachSubject, dedupeSubjects, dueSubjects, ingestSubject,
  matchupEntityId, matchupSubject, teamEntityId, teamSubjects,
} = require('../routes/sports-world.js');

const HOGS = { league: 'ncaaf', team: 'ARK', displayName: 'Arkansas Razorbacks' };

test('an entity id is STABLE and league-qualified — the same team is the same archive forever', () => {
  assert.equal(teamEntityId('ncaaf', 'ARK'), 'world:team:ncaaf-ark');
  assert.equal(teamEntityId('ncaaf', 'Arkansas Razorbacks'), 'world:team:ncaaf-arkansas-razorbacks');
  // The NFL and the college Cardinals are different teams. Collapsing them would merge two archives
  // into one that describes neither, and every read over it would be quietly wrong.
  assert.notEqual(teamEntityId('nfl', 'ARI'), teamEntityId('ncaaf', 'ARI'));
});

test('slugging is idempotent and punctuation-proof, whatever the display name looks like', () => {
  assert.equal(teamEntityId('ncaaf', 'Texas A&M Aggies'), 'world:team:ncaaf-texas-a-m-aggies');
  assert.equal(teamEntityId('ncaaf', '  Ole Miss  '), 'world:team:ncaaf-ole-miss');
  assert.equal(teamEntityId('nba', 'San José'), teamEntityId('nba', 'San Jose'), 'accents must not fork the archive');
  const once = teamEntityId('ncaaf', 'Arkansas Razorbacks');
  assert.equal(teamEntityId('ncaaf', once.replace('world:team:ncaaf-', '')), once, 'slugging a slug changes nothing');
});

test('a coach keeps ONE id across the teams they coach — they are a person, not a role', () => {
  assert.equal(coachEntityId('Sam Pittman'), 'world:person:sam-pittman');
  assert.equal(coachSubject('Sam Pittman', 'Arkansas', 'ncaaf').entity, 'world:person:sam-pittman');
});

test('a matchup is keyed by EVENT ID, because the same fixture is played again next year', () => {
  assert.equal(matchupEntityId('ncaaf', '401628421'), 'world:matchup:ncaaf-401628421');
  const a = matchupSubject('ncaaf', '401628421', 'Arkansas', 'LSU');
  const b = matchupSubject('ncaaf', '401700000', 'Arkansas', 'LSU');
  assert.notEqual(a.entity, b.entity, 'this season and next must not share coverage');
  assert.match(a.label, /LSU at Arkansas/);
});

test('THE INJURY WIRE IS ITS OWN SUBJECT — averaging it into team news destroys the signal', () => {
  // A scratched starter is a step change that moves a line for hours. Filed under general team
  // coverage it becomes one item in a week of press-conference filler and disappears.
  const subs = teamSubjects(HOGS);
  assert.equal(subs.length, 2);
  const [team, injuries] = subs;
  assert.equal(team.kind, 'team');
  assert.equal(injuries.kind, 'injuries');
  assert.notEqual(team.entity, injuries.entity);
  assert.ok(injuries.entity.startsWith(team.entity), 'but it stays a sub-entity of the same team');
  assert.match(injuries.query, /injury/i);
});

test('the query DISAMBIGUATES the sport — "Arkansas" alone is a state, a river and a legislature', () => {
  // A query that pulls the wrong subject does not fail. It fills the archive with off-topic items
  // that are then classified at cost and weighted into a sentiment series.
  assert.match(teamSubjects(HOGS)[0].query, /Arkansas Razorbacks college football/);
  assert.match(teamSubjects({ league: 'nfl', team: 'NE', displayName: 'New England Patriots' })[0].query, /NFL/);
  assert.match(teamSubjects({ league: 'nba', team: 'BOS', displayName: 'Boston Celtics' })[0].query, /NBA/);
});

test('a team with no display name still gets a usable subject rather than an empty query', () => {
  const [team] = teamSubjects({ league: 'ncaaf', team: 'ARK', displayName: null });
  assert.equal(team.label, 'ARK');
  assert.match(team.query, /^ARK college football/);
});

test('only news and social feeds are pulled — the Federal Register has nothing to say about football', () => {
  assert.deepEqual([...SPORTS_FEED_IDS].sort(), ['bing-news', 'google-news', 'reddit']);
});

test('subjects dedupe by entity, so two followed teams playing each other pay once', () => {
  const a = matchupSubject('ncaaf', '4016', 'Arkansas', 'LSU');
  const b = matchupSubject('ncaaf', '4016', 'Arkansas', 'LSU');
  assert.equal(dedupeSubjects([a, b, ...teamSubjects(HOGS)]).length, 3);
});

/** Builds a subject list of n distinct entities. */
function subjects(n) {
  return Array.from({ length: n }, (_, i) => ({ entity: `world:team:t${i}`, label: `T${i}`, query: 'q', kind: 'team' }));
}

test('THE COOL-DOWN SURVIVES A RESTART — it reads storage, not process memory', () => {
  // A process-local timer resets on every deploy, and this package deploys often. Each restart
  // would then re-classify the whole subject set: the archive stays correct (content-hash dedup),
  // so nothing looks wrong, and only the model bill shows it.
  const now = new Date('2026-09-09T12:00:00Z');
  const [s] = subjects(1);
  assert.deepEqual(dueSubjects([s], new Map(), 6, now), [s], 'never pulled = due');
  assert.deepEqual(dueSubjects([s], new Map([[s.entity, '2026-09-09T11:00:00Z']]), 6, now), [], 'an hour ago is not due');
  assert.deepEqual(dueSubjects([s], new Map([[s.entity, '2026-09-09T05:00:00Z']]), 6, now), [s], 'seven hours ago is');
  assert.deepEqual(dueSubjects([s], new Map([[s.entity, 'not a date']]), 6, now), [s],
    'an unreadable timestamp must not pin a subject as never-due');
});

test('a failed ingest is REPORTED, not thrown — the same pass is also capturing lines', () => {
  // A line capture cannot be recovered later and a settled call is evidence owed. Neither may be
  // lost because a news feed timed out.
  const throwing = async () => { throw new Error('feed timeout'); };
  return ingestSubject(throwing, subjects(1)[0], 15).then((r) => {
    assert.equal(r.error, 'feed timeout');
    assert.equal(r.fetched, 0);
    assert.equal(r.newItems, 0);
  });
});

test('the ingest passes the sports feed set through and totals what came back', async () => {
  let seen = null;
  const ingest = async (query, entity, label, sources, opts) => {
    seen = { query, entity, label, sources, opts };
    return { perSource: [{ fetched: 10, newItems: 3 }, { fetched: 5, newItems: 0 }] };
  };
  const [team] = teamSubjects(HOGS);
  const r = await ingestSubject(ingest, team, 15);
  assert.equal(r.fetched, 15);
  assert.equal(r.newItems, 3);
  assert.deepEqual(seen.sources, [...SPORTS_FEED_IDS]);
  assert.equal(seen.entity, 'world:team:ncaaf-ark');
  assert.equal(seen.opts.limit, 15);
});

test('a malformed answer totals to zero rather than NaN', async () => {
  const r = await ingestSubject(async () => ({ perSource: [{}, { fetched: 'x' }] }), subjects(1)[0], 15);
  assert.equal(r.fetched, 0);
  assert.equal(r.newItems, 0);
});
