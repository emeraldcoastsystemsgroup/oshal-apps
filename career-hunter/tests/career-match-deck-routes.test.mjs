/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.69.0 (career-hunter backlog, "The Discover swipe deck as the Job Board's phone layout"): what the phone deck of New matches asks of Career's real compiled routes, over a real SQLite corpus and a real store per made-up person (tests/helpers/career-match-deck-fixture.mjs). Pass and Save are the board's own writes (POST /jobs/:id/status) and each has a reversal on that same route that puts the job back exactly where it was; none of it reaches another person's store; a signed-out caller, an unknown job and a body that is not a move are refused; a job already applied to cannot be sent back to new; reading the first page again after acting gives the next jobs with none skipped, where page 2 skips them; and GET /mobile, still bound to app.open in the catalog, hands the browser to the board on New matches.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deckHarness, inventedJobs, packageRoot, PERSON, OTHER } from './helpers/career-match-deck-fixture.mjs';

let career;
before(async () => { career = await deckHarness({ jobs: inventedJobs(30) }); });
after(async () => { await career?.stop(); });
beforeEach(() => { career.seed(); });

const MATCHES = '/jobs?matches=1&sort=posted&per=25&page=';
const ids = (answer) => answer.body.jobs.map((job) => job.id);
const listed = async (route, who = PERSON) => ids(await career.call('GET', route, undefined, who));
const move = (id, body, who = PERSON) => career.call('POST', `/jobs/${id}/status`, body, who);
const untouched = () => { assert.deepEqual([...new Set(Object.values(career.signals(OTHER)))], ['new']); assert.deepEqual(career.favorites(OTHER), []); };

test('Pass is the board\'s Remove: the job leaves New matches for Removed, and its reversal puts it back as it was', async () => {
  const before = await career.call('GET', '/jobs/103');
  assert.equal(before.body.job.status, 'new'); assert.equal(before.body.job.favorite, false);
  const passed = await move(103, { status: 'dismissed' });
  assert.equal(passed.code, 200); assert.deepEqual(passed.body, { ok: true, status: 'dismissed', favorite: false });
  assert.equal(career.signals()[103], 'dismissed');
  assert.equal((await listed(MATCHES + 1)).includes(103), false, 'a passed job is not a new match');
  assert.deepEqual(await listed('/jobs?status=dismissed&per=25'), [103], 'it is in Removed');
  assert.equal((await career.call('GET', '/jobs/stats')).body.matches, 29);

  const undone = await move(103, { status: 'new' });
  assert.equal(undone.code, 200); assert.equal(undone.body.status, 'new'); assert.equal(undone.body.favorite, false);
  assert.equal(career.signals()[103], 'new');
  const after = await career.call('GET', '/jobs/103');
  assert.equal(after.body.job.status, 'new'); assert.equal(after.body.job.favorite, false);
  assert.equal((await listed(MATCHES + 1)).includes(103), true, 'the job is a new match again');
  assert.deepEqual(await listed('/jobs?status=dismissed&per=25'), []);
  assert.equal((await career.call('GET', '/jobs/stats')).body.matches, 30);
  untouched();
});

test('Save is the board\'s Save: the job leaves New matches for Saved, and its reversal unsaves it and nothing else', async () => {
  const saved = await move(104, { favorite: true });
  assert.equal(saved.code, 200); assert.equal(saved.body.favorite, true);
  assert.deepEqual(career.favorites(), [104]); assert.equal(career.signals()[104], 'new', 'saving does not start an application');
  assert.equal((await listed(MATCHES + 1)).includes(104), false, 'a saved job is not a new match');
  assert.deepEqual(await listed('/jobs?status=saved&per=25'), [104]);
  const read = await career.call('GET', '/jobs/104');
  assert.equal(read.body.job.favorite, true); assert.equal(read.body.job.status, 'new');

  const undone = await move(104, { favorite: false });
  assert.equal(undone.code, 200); assert.equal(undone.body.favorite, false);
  assert.deepEqual(career.favorites(), []); assert.equal(career.signals()[104], 'new');
  assert.equal((await listed(MATCHES + 1)).includes(104), true);
  assert.deepEqual(await listed('/jobs?status=saved&per=25'), []);
  untouched();
});

test('one person\'s Pass, Save and Undo never reach another person\'s jobs', async () => {
  await move(105, { status: 'dismissed' }); await move(106, { favorite: true });
  untouched();
  assert.equal((await listed(MATCHES + 1, OTHER)).includes(105), true, 'the other person still has the job the first one passed');
  assert.equal((await career.call('GET', '/jobs/106', undefined, OTHER)).body.job.favorite, false);
  // The other person undoes what they never did: their own store answers, and the first person's is as it was.
  const theirs = await move(105, { status: 'new' }, OTHER);
  assert.equal(theirs.code, 200);
  assert.equal(career.signals()[105], 'dismissed', 'the first person\'s passed job stays passed');
  assert.equal((await move(106, { favorite: false }, OTHER)).code, 200);
  assert.deepEqual(career.favorites(), [106], 'the first person\'s saved job stays saved');
});

test('a signed-out caller, an unknown job and a body that is not a move are refused, and nothing is written', async () => {
  for (const [method, route, body] of [['GET', MATCHES + 1], ['GET', '/jobs/103'], ['GET', '/jobs/stats'], ['POST', '/jobs/103/status', { status: 'dismissed' }], ['POST', '/jobs/103/status', { status: 'new' }], ['POST', '/jobs/103/status', { favorite: false }]]) {
    const refused = await career.call(method, route, body, null);
    assert.equal(refused.code, 401, `${method} ${route}`); assert.deepEqual(refused.body, { error: 'unauthorized' });
  }
  assert.equal((await move(999999, { status: 'new' })).code, 404, 'a job Career does not hold');
  for (const body of [{ status: 'undone' }, { status: 'new', favorite: 'no' }, {}, { status: 'new', correction: 'undo-manual-submission' }]) {
    assert.equal((await move(103, body)).code, 400, JSON.stringify(body));
  }
  assert.equal(career.signals()[103], 'new'); assert.deepEqual(career.favorites(), []);
});

test('a job already applied to is not sent back to new by an Undo that arrives late', async () => {
  for (const status of ['applied', 'interview', 'offer', 'rejected']) {
    career.mark(107, status);
    const refused = await move(107, { status: 'new' });
    assert.equal(refused.code, 409, status); assert.equal(refused.body.error, 'A submitted application cannot return to document preparation.');
    assert.equal(career.signals()[107], status);
  }
});

test('reading the first page again after acting gives the next jobs with none skipped; page 2 would skip them', async () => {
  const first = await career.call('GET', MATCHES + 1);
  assert.equal(first.body.jobs.length, 25); assert.equal(first.body.exhausted, false);
  const everything = new Set(inventedJobs(30).map((job) => job.id)), seen = ids(first), acted = seen.slice(0, 24), held = seen[24];
  for (const [index, id] of acted.entries()) assert.equal((await move(id, index % 2 ? { favorite: true } : { status: 'dismissed' })).code, 200);
  const again = await career.call('GET', MATCHES + 1);
  const unseen = [...everything].filter((id) => !seen.includes(id));
  assert.deepEqual(new Set(ids(again)), new Set([held, ...unseen]), 'the card still held and the five jobs not yet seen');
  assert.equal(again.body.exhausted, true);
  assert.deepEqual(ids(await career.call('GET', MATCHES + 2)), [], 'page 2 of what is left holds none of them');
});

test('GET /mobile hands the browser to the Job Board on New matches, and the catalog still gates it', async () => {
  const answer = await career.call('GET', '/mobile');
  assert.equal(answer.code, 200); assert.match(answer.type, /^text\/html/);
  assert.match(answer.text, /<meta http-equiv="refresh" content="0; url=\/api\/career-hunter\/board-native\?view=matches">/);
  assert.match(answer.text, /<a href="\/api\/career-hunter\/board-native\?view=matches">Open New matches<\/a>/);
  assert.doesNotMatch(answer.text, /<script/i, 'the hand-off carries one address and no script');
  const catalog = readFileSync(path.join(packageRoot, 'authorization.yaml'), 'utf8');
  assert.match(catalog, /- \{ id: mobile-ui, method: GET, path: \/mobile, allOf: \[app\.open\] \}/);
  assert.match(catalog, /- \{ id: board-native, method: GET, path: \/board-native, allOf: \[app\.open\] \}/);
  const board = await career.call('GET', '/board-native?view=matches');
  assert.equal(board.code, 200); assert.match(board.text, /<title>My jobs<\/title>/);
  assert.match(board.text, /static\/career-match-deck\.js"><\/script><script src="\/api\/career-hunter\/static\/career-job-lists\.js">/, 'the deck is loaded before the page script');
  const script = await career.call('GET', '/static/career-match-deck.js');
  assert.equal(script.code, 200); assert.match(script.type, /javascript/);
});
