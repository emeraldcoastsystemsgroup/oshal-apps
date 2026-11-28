/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.77.6 (the owner, 2026-11-27: "for any aplication that doesnt submit correctly have a new tab that listas the failed aplications and what went wrong"): GET /didnt-go-through over Career's real routes (lib/career-apply-routes.js with the fill-in queue's and the new list's) on made-up people's real stores, the kernel's ticket port stood in at the harness boundary as a work record per ticket. Proved: each way an application on the person's Chrome ends is listed with Career's own words, the next step and its button (failed and paused: Go on; stopped: Approve again; not seen and left open at Review: open the job), newest first, one row per job with company, title, site and host; a job sent, one still going, one he applied to himself and one he removed are not listed; with time moved on, an approval that ended before Career started, a run never started on the computer, a run left waiting for him or at Review past its approval and the wall limit, and a paused run whose approval ended are listed, and the same runs earlier are not; Fill in several's ended jobs say the queue's words (left open, failed, skipped, approval ended) while a job in line or on the computer is not listed; the latest attempt wins (Go on from the job's page after the queue failed it, a newer approval, Generate again after an application, an application after Generate again); Generate again's failed job and one skipped because its posting closed are listed, one skipped for another reason is not; another person, a person with no store and a signed-out caller see nothing of anyone's, and a source that cannot be read leaves the others listed. Red before the change: GET /didnt-go-through answered 404.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.77.6, the apply-all run's Skip: a queued job that waited for the person (here a question card, and a sign-in) and was stopped through its ticket and skipped keeps what it waited for, "Skipped while it waited for you: Needs your answer: ... Nothing was submitted.", on the queue entry and on its run; an advance that finds the cancelled run before the Skip arrives keeps it as "Stopped while it waited for you: ..." and the late Skip is refused as not current; a job skipped while Career was still filling it in says what Skip always said. Didn't go through shows those words from the queue and, after the queue is cleared, from the runs. Red before: the entry and the tab said "You skipped it. Nothing was submitted." and "You stopped it. Nothing was submitted.".
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { applyHarness } from './helpers/career-apply-fixture.mjs';

const require = createRequire(import.meta.url);
const uuid = (head, n) => head + '-0000-0000-0000-' + String(n).padStart(12, '0');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const HOUR = 60 * 60 * 1000, WALL = 2 * HOUR;
const SIGN_IN = 'Sign in to this employer’s site in the Chrome window Career opened, or create your account there. Career goes on when you are in.';
const LEFT_OPEN = 'Left open in its Chrome window for you to check and submit. Press I applied on the job when you have.';
let h, lib, regen, store, Database;
const works = [], rows = new Map();
before(async () => {
  h = await applyHarness();
  // The modules the harness loaded through the real route module, so the list reads the stores they write.
  lib = require('../lib/career-didnt-go-through.js'); regen = require('../lib/career-regenerate.js'); store = require('../routes/career-user-store.js');
  Database = require(require.resolve('better-sqlite3', { paths: [path.join(import.meta.dirname, '..', '..', 'scripts', 'toolchain')] }));
  let tickets = 0;
  h.port.createTicket = async (input) => { h.port.created.push(input); return { ticketId: uuid('a5000000', ++tickets) }; };
  h.port.startTicket = async (ticketId, input) => {
    if (h.port.refuseStart) throw h.port.refuseStart;
    const id = uuid('b5000000', works.length + 1), task = JSON.parse(Buffer.from(input.files[0].bytes).toString('utf8'));
    works.push({ id, ticketId, task }); rows.set(id, { id, ticketId, state: 'queued', executor: 'orbit-apply-v1' });
    return { envelope: { id } };
  };
  h.port.getTicketWork = async (ticketId) => [...rows.values()].filter((row) => row.ticketId === ticketId).map(({ ticketId: _t, ...row }) => ({ ...row }));
});
after(async () => { await h?.stop(); });

/** A made-up person with prepared jobs 7 (Example Freight Co) and each of `more`. */
function person(sub, more = []) {
  const someone = h.person(sub);
  for (const id of more) h.job(sub, id, { company: 'Sample Freight ' + id });
  return someone;
}
const list = (sub) => h.call('GET', '/didnt-go-through', null, sub);
const workOf = (runId) => works.filter((work) => work.task.intentId === runId).at(-1);
const set = (work, patch) => rows.set(work.id, { ...rows.get(work.id), ...patch });
const sync = (sub, runId) => h.call('POST', '/apply-runs/' + runId + '/sync', {}, sub);
const advance = (sub) => h.call('POST', '/apply-batch/advance', {}, sub);
const runOf = (dir, postingId) => Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'apply-runs.json'), 'utf8')).runs).filter((run) => run.postingId === postingId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
/** Approve one job's exact packet as its page does; with `start`, bind its ticket and start it on the computer. */
async function approve(sub, id, { start = true } = {}) {
  const review = await h.call('GET', '/apply-review/' + id, null, sub);
  assert.equal(review.code, 200, JSON.stringify(review.body));
  const approved = await h.call('POST', '/apply-runs', { postingId: id, packetDigest: review.body.packetDigest, approved: true }, sub);
  assert.equal(approved.code, 200, JSON.stringify(approved.body));
  const runId = approved.body.run.id;
  if (!start) return runId;
  assert.equal((await h.call('POST', '/apply-runs/' + runId + '/bind', {}, sub)).code, 200);
  const started = await h.call('POST', '/apply-runs/' + runId + '/start', {}, sub);
  if (!h.port.refuseStart) assert.equal(started.code, 200, JSON.stringify(started.body));
  return runId;
}
/** The kernel ended this attempt with an accepted answer (and, for a Submit, the employer's confirmation picture). */
function ended(work, outcome, data = {}) {
  set(work, { state: 'completed' });
  if (['submitted_by_you', 'submitted_by_career'].includes(outcome)) {
    const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('thank you ' + work.id)]);
    h.port.artifacts.set(work.id + '/confirmation.png', { name: 'confirmation.png', sha256: sha(bytes), byteLength: bytes.length, base64: bytes.toString('base64') });
    data = { ...data, confirmation: { artifact: 'confirmation.png', sha256: sha(bytes), text: 'Thank you for applying' } };
  }
  h.port.accepted.set(work.id, { version: 2, intentId: work.task.intentId, attempt: work.task.attempt, requestDigest: work.task.requestDigest, outcome, data });
}
/** Each listed job as [postingId, what went wrong, button, what to do next]. */
const shape = (items) => items.map((item) => [item.postingId, item.what, item.action, item.next]);
/** The list as it reads at `now`, through the module's own reader and the person's own job rows. */
const at = (sub, dir, now) => lib.listFor(dir, (ids) => lib.jobRows(sub, ids), { now, wallMs: WALL });

test('each way an application on his Chrome ends is listed in Career’s words, newest first; a sent job, one going, one applied by hand and one removed are not', async () => {
  const sub = 'avery-quinn', avery = person(sub, [8, 9, 10, 11, 12, 13, 14, 15]);
  const failed = await approve(sub, 7); set(workOf(failed), { state: 'failed' }); assert.equal((await sync(sub, failed)).body.run.status, 'failed');
  const paused = await approve(sub, 8); ended(workOf(paused), 'paused', { reason: 'Timed out waiting for you at the employer’s sign-in page.' }); assert.equal((await sync(sub, paused)).body.run.status, 'paused');
  const stopped = await approve(sub, 9); set(workOf(stopped), { state: 'cancelled' }); assert.equal((await sync(sub, stopped)).body.run.status, 'stopped');
  const unseen = await approve(sub, 10); ended(workOf(unseen), 'submit_not_seen', { reason: 'Career pressed Submit once; the employer’s confirmation was not seen. Check the employer’s site before anything else.' });
  assert.equal((await sync(sub, unseen)).body.run.status, 'not_seen');
  const open = await approve(sub, 11);
  set(workOf(open), { state: 'running', apply: { attempt: 1, state: 'ready', ready: 'Career filled it but held Submit at Review: the form asks for a signature.' } });
  assert.equal((await sync(sub, open)).body.run.status, 'ready');
  set(workOf(open), { state: 'cancelled' }); assert.equal((await sync(sub, open)).body.run.status, 'stopped');
  const sent = await approve(sub, 12); ended(workOf(sent), 'submitted_by_you'); assert.equal((await sync(sub, sent)).body.run.status, 'submitted');
  const going = await approve(sub, 13); set(workOf(going), { state: 'running', apply: { attempt: 1, state: 'filling', page: { label: 'My Information' } } }); await sync(sub, going);
  const byHand = await approve(sub, 14); set(workOf(byHand), { state: 'failed' }); await sync(sub, byHand); avery.mark(14, 'applied');
  const removed = await approve(sub, 15); set(workOf(removed), { state: 'failed' }); await sync(sub, removed); avery.mark(15, 'dismissed');

  const answer = await list(sub);
  assert.equal(answer.code, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.count, 5);
  assert.deepEqual(answer.body.unread, []);
  assert.deepEqual(answer.body.onComputer, [{ postingId: 13, company: 'Sample Freight 13', title: 'Office Manager' }], 'what Career’s records say is being filled in on his computer now');
  assert.deepEqual(shape(answer.body.items), [
    [11, lib.WHAT.leftOpen, 'open', lib.NEXT.leftOpen],
    [10, 'Career pressed Submit once; the employer’s confirmation was not seen. Check the employer’s site before anything else.', 'open', lib.NEXT.check],
    [9, 'You stopped it. Nothing was submitted.', 'approve-again', lib.NEXT.again],
    [8, 'Timed out waiting for you at the employer’s sign-in page.', 'go-on', lib.NEXT.goOn],
    [7, 'Your computer stopped before the form reached Review. Nothing was submitted.', 'go-on', lib.NEXT.goOn],
  ], 'newest first; 12 was sent, 13 is still going, 14 he applied to himself and 15 he removed');
  const [left, , , pausedItem, first] = answer.body.items;
  assert.deepEqual([first.company, first.title, first.site, first.host, first.from], ['Example Freight Co', 'Office Manager', 'Workday', 'example.wd1.myworkdayjobs.com', 'run']);
  assert.deepEqual([left.company, left.host], ['Sample Freight 11', 'example11.wd1.myworkdayjobs.com']);
  assert.equal(pausedItem.runId, paused, 'Go on names the run it goes on with');
  assert.deepEqual(pausedItem.job, { status: 'generated', has_resume: true, has_cover: true });
  const times = answer.body.items.map((item) => Date.parse(item.endedAt));
  assert.ok(times.every((value, i) => Number.isFinite(value) && (i === 0 || times[i - 1] >= value)), 'each says when it ended, newest first');
  assert.equal((await h.raw('GET', '/didnt-go-through', null, sub)).headers.get('cache-control'), 'private, no-store');
});

test('with time moved on: an approval that ended before it started, a run never started, a run left waiting or at Review past its approval, and a paused run whose approval ended', async () => {
  const sub = 'casey-morgan', casey = person(sub, [8, 9, 10, 11, 12]);
  const unstarted = await approve(sub, 7, { start: false });
  h.port.refuseStart = Object.assign(Error('Your chosen Job Apply device is unavailable.'), { code: 'apply_device_unavailable' });
  const refused = await approve(sub, 8);
  h.port.refuseStart = null;
  assert.equal(runOf(casey.dir, 8).status, 'approved', 'its start was refused, so it was never on the computer');
  const waiting = await approve(sub, 9);
  set(workOf(waiting), { state: 'running', apply: { attempt: 1, state: 'waiting_for_you', reason: { kind: 'sign-in', text: SIGN_IN } } });
  assert.equal((await sync(sub, waiting)).body.run.status, 'waiting');
  const ready = await approve(sub, 10);
  set(workOf(ready), { state: 'running', apply: { attempt: 1, state: 'ready', ready: 'Career filled it but held Submit at Review: the form asks for a signature.' } }); await sync(sub, ready);
  const paused = await approve(sub, 11); ended(workOf(paused), 'paused', { reason: 'Timed out waiting for you at the employer’s sign-in page.' }); await sync(sub, paused);
  const asked = await approve(sub, 12);
  set(workOf(asked), { state: 'running', apply: { attempt: 1, state: 'waiting_for_you', reason: { kind: 'question', text: 'What is your desired salary?' } } }); await sync(sub, asked);
  const now = Date.now();

  assert.deepEqual(shape(at(sub, casey.dir, now + 60000).items), [[11, 'Timed out waiting for you at the employer’s sign-in page.', 'go-on', lib.NEXT.goOn]],
    'a minute later only the paused run is listed: the others are still going or have just been approved');
  assert.deepEqual(shape(at(sub, casey.dir, now + 11 * 60000).items).map((item) => item.slice(0, 3)), [[11, 'Timed out waiting for you at the employer’s sign-in page.', 'go-on'], [8, lib.WHAT.idle, 'go-on']],
    'ten minutes after its start was refused, the run never started is listed with Go on');
  const later = at(sub, casey.dir, now + 24 * HOUR + WALL + 60000);
  assert.deepEqual(shape(later.items).sort((a, b) => a[0] - b[0]), [
    [7, lib.WHAT.neverStarted, 'approve-again', lib.NEXT.again],
    [8, lib.WHAT.neverStarted, 'approve-again', lib.NEXT.again],
    [9, `Waiting for you to sign in: ${SIGN_IN} ${lib.WHAT.ended}`, 'approve-again', lib.NEXT.again],
    [10, `Career filled it but held Submit at Review: the form asks for a signature. ${lib.WHAT.readyEnded}`, 'open', lib.NEXT.leftOpen],
    [11, 'Timed out waiting for you at the employer’s sign-in page.', 'approve-again', lib.NEXT.again],
    [12, `Needs your answer: What is your desired salary? ${lib.WHAT.ended}`, 'approve-again', lib.NEXT.again],
  ], 'past the approval and the wall limit none of them is on the computer; Go on is no longer offered once the approval ended');
  assert.deepEqual(shape(at(sub, casey.dir, now + 24 * HOUR + 60000).items).map((item) => item[0]).sort((a, b) => a - b), [7, 8, 11],
    'between the end of the approval and the wall limit a started run may still be on the computer, so it is not listed yet');
  assert.ok(refused && unstarted);
});

test('Fill in several: each ended job says the queue’s words, one in line or on the computer is not listed, and Go on from the job’s page after the queue failed it wins', async () => {
  const sub = 'drew-parker', drew = person(sub, [8, 9, 10, 11]), jobs = [];
  for (const id of [7, 8, 9, 10, 11]) jobs.push({ postingId: id, packetDigest: (await h.call('GET', '/apply-review/' + id, null, sub)).body.packetDigest });
  assert.equal((await h.call('POST', '/apply-batch', { jobs, approved: true }, sub)).code, 200);
  assert.equal((await list(sub)).body.count, 0, 'jobs in line are not listed');
  await advance(sub);
  const runFor = (id) => runOf(drew.dir, id).id;
  set(workOf(runFor(7)), { state: 'running', apply: { attempt: 1, state: 'ready', ready: 'Ready: check it and press Submit in the Chrome window.' } });
  await advance(sub);
  const onReview = (await list(sub)).body;
  assert.deepEqual([onReview.count, onReview.onComputer.map((job) => job.postingId)], [0, [7]], 'the job ready at Review on his computer is not listed; it is the one on the computer');
  set(workOf(runFor(7)), { state: 'cancelled' });
  assert.equal((await h.call('POST', '/apply-batch/next', { postingId: 7 }, sub)).code, 200);
  set(workOf(runFor(8)), { state: 'failed' }); await advance(sub);
  set(workOf(runFor(9)), { state: 'cancelled' });
  assert.equal((await h.call('POST', '/apply-batch/skip', { postingId: 9 }, sub)).code, 200);
  const file = path.join(drew.dir, 'apply-runs.json'), stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.values(stored.runs).find((run) => run.postingId === 11).expiresAt = new Date(Date.now() - 60000).toISOString();
  fs.writeFileSync(file, JSON.stringify(stored) + '\n', { mode: 0o600 });
  ended(workOf(runFor(10)), 'submitted_by_you');
  const queue = (await advance(sub)).body.queue;
  assert.deepEqual(queue.entries.map((entry) => [entry.postingId, entry.state]), [[7, 'ready'], [8, 'failed'], [9, 'skipped'], [10, 'submitted'], [11, 'needs-you']]);

  let answer = (await list(sub)).body;
  assert.deepEqual(shape(answer.items), [
    [11, 'Your approval of this job ended (an approval lasts 24 hours). Approve it again to fill it in.', 'approve-again', lib.NEXT.again],
    [9, 'You skipped it. Nothing was submitted.', 'approve-again', lib.NEXT.again],
    [8, 'Your computer stopped before the form reached Review. Nothing was submitted.', 'go-on', lib.NEXT.goOn],
    [7, LEFT_OPEN, 'open', lib.NEXT.leftOpen],
  ], 'the queue’s words, newest first; the job sent is not listed');
  assert.ok(answer.items.every((item) => item.from === 'queue'));

  const eight = runFor(8);
  assert.equal((await h.call('POST', '/apply-runs/' + eight + '/go-on', {}, sub)).code, 200, 'Go on from the job’s page');
  answer = (await list(sub)).body;
  assert.ok(!answer.items.some((item) => item.postingId === 8), 'going on again, it is not listed');
  ended(workOf(eight), 'paused', { reason: 'Timed out at the employer’s Voluntary Disclosures page.' }); await sync(sub, eight);
  const again = (await list(sub)).body.items.find((item) => item.postingId === 8);
  assert.deepEqual([again.what, again.from, again.action], ['Timed out at the employer’s Voluntary Disclosures page.', 'run', 'go-on'], 'its latest attempt, not the queue’s word for the first');
  assert.equal(drew.signal().status, 'generated');
});

test('the latest attempt wins: a newer approval, Generate again after an application, and an application after Generate again', async () => {
  const sub = 'emery-lane', emery = person(sub, [8, 9, 10, 11]);
  const first = await approve(sub, 7); set(workOf(first), { state: 'failed' }); await sync(sub, first);
  const second = await approve(sub, 7);
  assert.notEqual(second, first, 'a failed run does not hold the job, so this is a new approval');
  assert.ok(!(await list(sub)).body.items.some((item) => item.postingId === 7), 'the newer approval is on the computer, so the job is not listed');
  set(workOf(second), { state: 'cancelled' }); await sync(sub, second);
  assert.deepEqual(shape((await list(sub)).body.items.filter((item) => item.postingId === 7)), [[7, 'You stopped it. Nothing was submitted.', 'approve-again', lib.NEXT.again]]);

  const eight = await approve(sub, 8); set(workOf(eight), { state: 'failed' }); await sync(sub, eight);
  const corpus = new Database(store.userPaths(sub).corpusDb);
  try { corpus.prepare('UPDATE postings_corpus SET active=0 WHERE id IN (9)').run(); } finally { corpus.close(); }
  const ten = await approve(sub, 10); set(workOf(ten), { state: 'failed' }); await sync(sub, ten);
  const now = Date.now(), entry = (id, title) => ({ postingId: id, title, company: 'Sample Freight ' + id, state: 'queued', attempts: 1, requestIds: [], reason: '', note: '', queuedAt: new Date(now - 3 * HOUR).toISOString(), claimedAt: null, startedAt: null, endedAt: null });
  const queue = { version: 1, id: crypto.randomUUID(), state: 'done', reason: '', createdAt: new Date(now - 3 * HOUR).toISOString(), entries: [entry(8, 'Office Manager'), entry(9, 'Office Manager'), entry(10, 'Office Manager'), entry(11, 'Office Manager')] };
  regen.end(queue.entries[0], 'failed', 'Career could not check this job’s fit, so it made no documents.', now + 1000);
  regen.end(queue.entries[1], 'skipped', 'The employer’s posting is no longer open.', now - HOUR);
  regen.end(queue.entries[2], 'failed', 'Career could not make the documents.', now - 2 * HOUR);
  regen.end(queue.entries[3], 'skipped', 'You generated this job’s documents yourself after Generate again took it, so Career left them as you made them.', now - HOUR);
  regen.write(emery.dir, queue);

  const items = (await list(sub)).body.items, by = Object.fromEntries(items.map((item) => [item.postingId, item]));
  assert.deepEqual([by[8].what, by[8].from, by[8].action, by[8].next], ['Career could not check this job’s fit, so it made no documents.', 'documents', 'open', lib.NEXT.documents],
    'Generate again failed after the application did, so its words are the latest');
  assert.deepEqual([by[9].what, by[9].action, by[9].next], ['The employer’s posting is no longer open.', 'none', lib.NEXT.closed], 'skipped because the posting closed');
  assert.equal(by[9].host, 'example9.wd1.myworkdayjobs.com', 'a job no run filled in is named by its posting’s host');
  assert.deepEqual([by[10].what, by[10].from], ['Your computer stopped before the form reached Review. Nothing was submitted.', 'run'], 'the application failed after Generate again did');
  assert.equal(by[11], undefined, 'skipped because he made the documents himself: nothing went wrong');
});

test('another person, a person with no store and a signed-out caller see nothing of anyone’s, and a source that cannot be read leaves the rest listed', async () => {
  const sub = 'finley-shore', finley = person(sub, [8]);
  const failed = await approve(sub, 7); set(workOf(failed), { state: 'failed' }); await sync(sub, failed);
  const stopped = await approve(sub, 8); set(workOf(stopped), { state: 'cancelled' }); await sync(sub, stopped);
  assert.equal((await list(sub)).body.count, 2);
  person('blake-rivera');
  assert.deepEqual((await list('blake-rivera')).body, { count: 0, items: [], onComputer: [], unread: [] }, 'another person with a store of their own sees none of these');
  assert.deepEqual((await list('nobody-yet')).body, { count: 0, items: [], onComputer: [], unread: [] }, 'a person with no Career store has nothing listed');
  assert.equal((await list(null)).code, 401, 'nobody signed in is answered 401');
  fs.writeFileSync(path.join(finley.dir, 'apply-batch.json'), '{"version":7}\n', { mode: 0o600 });
  const answer = (await list(sub)).body;
  assert.deepEqual([answer.count, answer.unread], [2, ['queue']], 'a queue that cannot be read is named, and the runs are still listed');
  fs.writeFileSync(path.join(finley.dir, 'apply-runs.json'), 'not json', { mode: 0o600 });
  assert.deepEqual((await list(sub)).body, { count: 0, items: [], onComputer: [], unread: ['runs', 'queue'] });
});

test('Skip of a job that waited for him keeps what it waited for, on the queue and its run, and Didn’t go through shows it after the queue is gone', async () => {
  const sub = 'gray-holloway', gray = person(sub, [8, 9]), jobs = [];
  for (const id of [7, 8, 9]) jobs.push({ postingId: id, packetDigest: (await h.call('GET', '/apply-review/' + id, null, sub)).body.packetDigest });
  assert.equal((await h.call('POST', '/apply-batch', { jobs, approved: true }, sub)).code, 200);
  await advance(sub);
  const runFor = (id) => runOf(gray.dir, id).id, entry = (queue, id) => queue.entries.find((item) => item.postingId === id);
  set(workOf(runFor(7)), { state: 'running', apply: { attempt: 1, state: 'waiting_for_you', reason: { kind: 'question', text: 'Do you hold a clearance?' } } });
  let queue = (await advance(sub)).body.queue;
  assert.deepEqual([entry(queue, 7).state, entry(queue, 7).reason], ['needs-you', 'Needs your answer: Do you hold a clearance?']);
  // The apply-all run stops it through the kernel's confirmed ticket cancel, then presses Skip.
  set(workOf(runFor(7)), { state: 'cancelled' });
  queue = (await h.call('POST', '/apply-batch/skip', { postingId: 7 }, sub)).body.queue;
  const SKIPPED = 'Skipped while it waited for you: Needs your answer: Do you hold a clearance? Nothing was submitted.';
  assert.deepEqual([entry(queue, 7).state, entry(queue, 7).reason], ['skipped', SKIPPED]);
  assert.deepEqual([runOf(gray.dir, 7).status, runOf(gray.dir, 7).reason], ['stopped', SKIPPED], 'its run says the same, so the words outlast the queue');
  assert.equal(queue.current.postingId, 8, 'and the next job started');

  set(workOf(runFor(8)), { state: 'running', apply: { attempt: 1, state: 'waiting_for_you', reason: { kind: 'sign-in', text: SIGN_IN } } });
  assert.equal(entry((await advance(sub)).body.queue, 8).state, 'needs-you');
  set(workOf(runFor(8)), { state: 'cancelled' });
  queue = (await advance(sub)).body.queue;
  const STOPPED = `Stopped while it waited for you: Waiting for you to sign in: ${SIGN_IN} Nothing was submitted.`;
  assert.deepEqual([entry(queue, 8).state, entry(queue, 8).reason], ['skipped', STOPPED], 'an advance that finds the run stopped before the Skip arrives keeps the words too');
  assert.equal(runOf(gray.dir, 8).reason, STOPPED);
  const late = await h.call('POST', '/apply-batch/skip', { postingId: 8 }, sub);
  assert.deepEqual([late.code, late.body.code], [409, 'batch_job_not_current'], 'the Skip that arrives after it finds it ended');

  set(workOf(runFor(9)), { state: 'cancelled' });
  queue = (await h.call('POST', '/apply-batch/skip', { postingId: 9 }, sub)).body.queue;
  assert.deepEqual([entry(queue, 9).reason, queue.state], ['You skipped it. Nothing was submitted.', 'done'], 'a job skipped while Career was still filling it in says what Skip always said');

  const fromQueue = (await list(sub)).body.items;
  assert.deepEqual(shape(fromQueue), [
    [9, 'You skipped it. Nothing was submitted.', 'approve-again', lib.NEXT.again],
    [8, STOPPED, 'approve-again', lib.NEXT.again],
    [7, SKIPPED, 'approve-again', lib.NEXT.again],
  ], 'Didn’t go through shows what each waited for, not the run’s stop words');
  assert.ok(fromQueue.every((item) => item.from === 'queue'));
  assert.equal((await h.call('POST', '/apply-batch/clear', {}, sub)).code, 200);
  const fromRuns = (await list(sub)).body.items;
  assert.deepEqual(fromRuns.filter((item) => item.postingId !== 9).map((item) => [item.postingId, item.what, item.from]), [[8, STOPPED, 'run'], [7, SKIPPED, 'run']],
    'with the queue cleared, the runs still say what each waited for');
});
