/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-BATCH (Roger, 2026-11-21: "i really need to be able to post 200 resumes by monday"): Fill in several on my Chrome over Career's real routes (lib/career-apply-routes.js with lib/career-apply-batch-routes.js) on a made-up person's real store, with the kernel's ticket port stood in at the harness boundary as a work record per ticket. Proved: each job is approved with its own packet and digest; the queue starts one job, never a second while one is on his computer (also under concurrent advances and while a run from a job's own page is on it); a job ready at Review waits until Next job, refused while its run is still on the computer and, once the page stopped it through the kernel's cancel, left open with the next job started; a submitted job is recorded with the employer's confirmation and the next starts; a failed job is reported and the next starts; Pause, Go on and Stop; a start whose acknowledgement was lost is sent again, not a second job; a kernel restart's paused attempt is reported and the queue goes on from his store; an expired approval asks again instead of running and is approved again in place; a job already sent, already queued, applied while waiting, past the 50, or whose packet changed is refused; another person sees and changes nothing. Red on store main 6ffd5378: POST /apply-batch answers 404.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyHarness } from './helpers/career-apply-fixture.mjs';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const png = (label) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(label)]);
const uuid = (head, n) => head + '-0000-0000-0000-' + String(n).padStart(12, '0');
const LEFT_OPEN = 'Left open in its Chrome window for you to check and submit. Press I applied on the job when you have.';
let h;
const works = [], rows = new Map();
before(async () => {
  h = await applyHarness();
  let tickets = 0;
  // The kernel's ticket port, one work record per ticket: what Career started, and what each attempt says now.
  // Each kernel call takes a moment, as over the real socket, so presses and advances that overlap really interleave.
  const moment = () => new Promise((resolve) => setTimeout(resolve, 25));
  h.port.createTicket = async (input) => { await moment(); h.port.created.push(input); return { ticketId: uuid('a3000000', ++tickets) }; };
  h.port.startTicket = async (ticketId, input) => {
    await moment();
    if (h.port.refuseStart) throw h.port.refuseStart;
    if (h.port.lostAck) { h.port.lostAck = false; return { envelope: {} }; }
    const id = uuid('b3000000', works.length + 1), task = JSON.parse(Buffer.from(input.files[0].bytes).toString('utf8'));
    works.push({ id, ticketId, input, task }); rows.set(id, { id, ticketId, state: 'queued', executor: 'orbit-apply-v1' });
    return { envelope: { id } };
  };
  h.port.getTicketWork = async (ticketId) => [...rows.values()].filter((row) => row.ticketId === ticketId).map(({ ticketId: _t, ...row }) => ({ ...row }));
});
after(async () => { await h?.stop(); });

/** A made-up person with jobs 7 (and more), each reviewed as his page reads it: its exact packet digest. */
async function person(sub, more = []) {
  const dana = h.person(sub);
  for (const [id, company] of more) h.job(sub, id, { company });
  const jobs = [];
  for (const id of [7, ...more.map(([id]) => id)]) {
    const review = await h.call('GET', '/apply-review/' + id, null, sub);
    assert.equal(review.code, 200, JSON.stringify(review.body));
    jobs.push({ postingId: id, packetDigest: review.body.packetDigest });
  }
  return { ...dana, jobs };
}
const runsOf = (dana) => JSON.parse(fs.readFileSync(path.join(dana.dir, 'apply-runs.json'), 'utf8')).runs;
const mine = (dana) => { const own = runsOf(dana); return works.filter((work) => own[work.task.intentId]); };
const workOf = (dana, postingId) => mine(dana).filter((work) => work.task.task.postingId === postingId).at(-1);
const started = (dana) => mine(dana).map((work) => work.task.task.postingId);
const set = (work, patch) => rows.set(work.id, { ...rows.get(work.id), ...patch });
const advance = (dana) => h.call('POST', '/apply-batch/advance', {}, dana.sub);
const states = (queue) => queue.entries.map((entry) => [entry.postingId, entry.state, entry.active]);
/** The kernel ended this attempt with an accepted answer (and, for a Submit, the employer's confirmation picture). */
function ended(work, outcome, data = {}) {
  set(work, { state: 'completed' });
  if (['submitted_by_you', 'submitted_by_career'].includes(outcome)) {
    const bytes = png('thank you ' + work.id);
    h.port.artifacts.set(work.id + '/confirmation.png', { name: 'confirmation.png', sha256: sha(bytes), byteLength: bytes.length, base64: bytes.toString('base64') });
    data = { ...data, confirmation: { artifact: 'confirmation.png', sha256: sha(bytes), text: 'Thank you for applying' } };
  }
  h.port.accepted.set(work.id, { version: 2, intentId: work.task.intentId, attempt: work.task.attempt, requestDigest: work.task.requestDigest, outcome, data });
}

test('three jobs in a row: one ready and left open by Next job, one submitted after his approval, one failed with the next started', async () => {
  const dana = await person('dana-batch', [[8, 'Sample Freight Two'], [9, 'Sample Freight Three'], [10, 'Sample Freight Four']]);
  const approved = await h.call('POST', '/apply-batch', { jobs: dana.jobs, approved: true }, dana.sub);
  assert.equal(approved.code, 200, JSON.stringify(approved.body));
  assert.deepEqual(approved.body.refused, []);
  assert.deepEqual(states(approved.body.queue), [[7, 'waiting', false], [8, 'waiting', false], [9, 'waiting', false], [10, 'waiting', false]]);
  assert.equal(started(dana).length, 0, 'approving starts nothing');
  assert.deepEqual(Object.values(runsOf(dana)).map((run) => [run.postingId, run.packetDigest]).sort((a, b) => a[0] - b[0]), dana.jobs.map((job) => [job.postingId, job.packetDigest]), 'one approval and digest per job');

  const overlapping = await Promise.all([advance(dana), advance(dana), advance(dana)]);
  assert.deepEqual(overlapping.map((answer) => answer.code), [200, 200, 200], 'an advance that overlaps one in flight reads the queue instead of acting on it');
  assert.deepEqual(started(dana), [7], 'three advances at once start one job');
  assert.deepEqual(states((await h.call('GET', '/apply-batch', null, dana.sub)).body.queue).slice(0, 2), [[7, 'filling', true], [8, 'waiting', false]], 'and none of them failed it');
  assert.equal(workOf(dana, 7).input.executor, 'orbit-apply-v1');
  set(workOf(dana, 7), { state: 'running', apply: { attempt: 1, state: 'ready', ready: 'Ready: check it and press Submit in the Chrome window.' } });
  let queue = (await advance(dana)).body.queue;
  assert.deepEqual(states(queue).slice(0, 2), [[7, 'ready', true], [8, 'waiting', false]], 'ready at Review waits for him');
  assert.equal(queue.counts.ready, 1);
  assert.deepEqual(started(dana), [7], 'nothing else starts while it waits');
  const early = await h.call('POST', '/apply-batch/next', { postingId: 7 }, dana.sub);
  assert.deepEqual([early.code, early.body.code], [409, 'run_still_live'], 'Next job is refused while its run is still on his computer');
  set(workOf(dana, 7), { state: 'cancelled' });
  queue = (await h.call('POST', '/apply-batch/next', { postingId: 7 }, dana.sub)).body.queue;
  assert.deepEqual(states(queue).slice(0, 2), [[7, 'ready', false], [8, 'filling', true]]);
  assert.equal(queue.entries[0].reason, LEFT_OPEN);
  assert.deepEqual(started(dana), [7, 8], 'the next job starts once the ready one was left open');

  ended(workOf(dana, 8), 'submitted_by_you');
  queue = (await advance(dana)).body.queue;
  assert.deepEqual(states(queue).slice(1, 3), [[8, 'submitted', false], [9, 'filling', true]]);
  assert.equal(queue.entries[1].reason, 'Submitted by you; the employer’s confirmation was seen.');
  const sent = (await h.call('GET', '/apply-runs?postingId=8', null, dana.sub)).body.runs[0];
  assert.deepEqual([sent.status, sent.submittedBy, Boolean(sent.confirmationFile)], ['submitted', 'you', true], 'recorded with the employer’s confirmation');
  set(workOf(dana, 9), { state: 'failed' });
  queue = (await advance(dana)).body.queue;
  assert.deepEqual(states(queue), [[7, 'ready', false], [8, 'submitted', false], [9, 'failed', false], [10, 'filling', true]]);
  assert.equal(queue.entries[2].reason, 'Your computer stopped before the form reached Review. Nothing was submitted.');
  assert.deepEqual(started(dana), [7, 8, 9, 10]);
  assert.deepEqual([queue.counts.submitted, queue.counts.ready, queue.counts.needsYou, queue.counts.failed, queue.counts.filling], [1, 1, 0, 1, 1]);
  assert.equal(queue.current.postingId, 10);
  assert.equal((await h.call('GET', '/apply-batch', null, 'somebody-else')).body.queue, null, 'another person has no queue');
  assert.equal((await h.call('POST', '/apply-batch/skip', { postingId: 10 }, 'somebody-else')).code, 404, 'and changes nothing');
  assert.deepEqual(states((await h.call('GET', '/apply-batch', null, dana.sub)).body.queue).at(-1), [10, 'filling', true]);
});

test('Pause, Go on and Stop: a paused queue starts nothing new, Go on starts the next, Stop waits for the job on the computer and ends the rest', async () => {
  const dana = await person('dana-batch-pause', [[8, 'Sample Freight Two'], [9, 'Sample Freight Three']]);
  await h.call('POST', '/apply-batch', { jobs: dana.jobs, approved: true }, dana.sub);
  await advance(dana);
  let queue = (await h.call('POST', '/apply-batch/pause', {}, dana.sub)).body.queue;
  assert.deepEqual([queue.state, queue.reason], ['paused', 'Paused by you. Career finishes the job on your computer and starts no other until you press Go on.']);
  set(workOf(dana, 7), { state: 'running', apply: { attempt: 1, state: 'filling', page: { label: 'My Information' } } });
  queue = (await advance(dana)).body.queue;
  assert.deepEqual(states(queue)[0], [7, 'filling', true], 'the job on the computer goes on while paused');
  assert.equal(queue.entries[0].reason, 'My Information');
  ended(workOf(dana, 7), 'submitted_by_career');
  queue = (await advance(dana)).body.queue;
  assert.deepEqual(states(queue), [[7, 'submitted', false], [8, 'waiting', false], [9, 'waiting', false]]);
  assert.equal(queue.entries[0].reason, 'Submitted by Career after your approval; the employer’s confirmation was seen.');
  assert.deepEqual(started(dana), [7], 'paused: nothing new starts');
  queue = (await h.call('POST', '/apply-batch/go-on', {}, dana.sub)).body.queue;
  assert.deepEqual([queue.state, started(dana)], ['running', [7, 8]], 'Go on starts the next');
  const early = await h.call('POST', '/apply-batch/stop', {}, dana.sub);
  assert.deepEqual([early.code, early.body.code], [409, 'run_still_live'], 'Stop waits until the page stopped the job on his computer');
  set(workOf(dana, 8), { state: 'cancelled' });
  queue = (await h.call('POST', '/apply-batch/stop', {}, dana.sub)).body.queue;
  assert.deepEqual([queue.state, queue.reason], ['stopped', 'You stopped the queue.']);
  assert.deepEqual(queue.entries.map((entry) => [entry.postingId, entry.state, entry.reason]), [[7, 'submitted', 'Submitted by Career after your approval; the employer’s confirmation was seen.'],
    [8, 'skipped', 'Stopped with the queue. Nothing was submitted.'], [9, 'skipped', 'The queue was stopped before this job. Nothing was submitted.']]);
  await advance(dana);
  assert.deepEqual(started(dana), [7, 8], 'a stopped queue starts nothing');
  assert.equal((await h.call('POST', '/apply-batch/go-on', {}, dana.sub)).body.code, 'batch_ended');
  assert.equal((await h.call('POST', '/apply-batch/clear', {}, dana.sub)).body.queue, null);
  assert.equal((await h.call('GET', '/apply-batch', null, dana.sub)).body.queue, null);
});

test('the queue is in his store: after a kernel restart the paused job is reported and the next starts; a reload reads the same queue', async () => {
  const dana = await person('dana-batch-restart', [[8, 'Sample Freight Two']]);
  await h.call('POST', '/apply-batch', { jobs: dana.jobs, approved: true }, dana.sub);
  await advance(dana);
  const kept = JSON.parse(fs.readFileSync(path.join(dana.dir, 'apply-batch.json'), 'utf8'));
  assert.deepEqual(kept.entries.map((entry) => [entry.postingId, entry.state, entry.active]), [[7, 'filling', true], [8, 'waiting', false]], 'kept in his own store');
  const words = 'Career’s run stopped unexpectedly while filling in the application. Nothing was submitted. Press Go on to start again.';
  ended(workOf(dana, 7), 'paused', { reason: words });
  const queue = (await advance(dana)).body.queue;
  assert.deepEqual(states(queue), [[7, 'failed', false], [8, 'filling', true]]);
  assert.equal(queue.entries[0].reason, 'Paused: ' + words + ' Open the job and press Go on to try it again.');
  assert.deepEqual((await h.call('GET', '/apply-batch', null, dana.sub)).body.queue.entries, queue.entries, 'a reload reads what the queue holds');
});

test('an expired approval asks again instead of running, and approving it again puts it back in the queue', async () => {
  const dana = await person('dana-batch-expired', [[8, 'Sample Freight Two']]);
  await h.call('POST', '/apply-batch', { jobs: dana.jobs, approved: true }, dana.sub);
  const file = path.join(dana.dir, 'apply-runs.json'), stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  const first = Object.values(stored.runs).find((run) => run.postingId === 7);
  first.expiresAt = new Date(Date.now() - 60000).toISOString();
  fs.writeFileSync(file, JSON.stringify(stored) + '\n', { mode: 0o600 });
  let queue = (await advance(dana)).body.queue;
  assert.deepEqual(states(queue), [[7, 'needs-you', false], [8, 'filling', true]]);
  assert.equal(queue.entries[0].expired, true);
  assert.equal(queue.entries[0].reason, 'Your approval of this job ended (an approval lasts 24 hours). Approve it again to fill it in.');
  assert.deepEqual(started(dana), [8], 'the expired job never starts');
  const again = await h.call('GET', '/apply-review/7', null, dana.sub);
  const approved = (await h.call('POST', '/apply-batch', { jobs: [{ postingId: 7, packetDigest: again.body.packetDigest }], approved: true }, dana.sub)).body;
  assert.deepEqual(approved.refused, []);
  queue = approved.queue;
  assert.deepEqual(states(queue), [[8, 'filling', true], [7, 'waiting', false]], 'approved again, it waits behind the job on the computer');
  assert.notEqual(queue.entries[1].runId, first.id, 'a new approval');
  set(workOf(dana, 8), { state: 'cancelled' });
  await advance(dana);
  assert.deepEqual(started(dana), [8, 7]);
});

test('a job already sent, already queued, applied while waiting, past the 50, or changed since review is refused; the rest go in', async () => {
  const dana = await person('dana-batch-refused', [[8, 'Sample Freight Two'], [9, 'Sample Freight Three']]);
  await h.call('POST', '/apply-batch', { jobs: [dana.jobs[0]], approved: true }, dana.sub);
  await advance(dana);
  ended(workOf(dana, 7), 'submitted_by_you');
  await advance(dana);
  assert.equal(dana.signal().status, 'applied');
  const answer = (await h.call('POST', '/apply-batch', { jobs: [dana.jobs[0], { ...dana.jobs[1], packetDigest: 'f'.repeat(64) }, dana.jobs[2]], approved: true }, dana.sub)).body;
  assert.deepEqual(answer.refused.map((item) => [item.postingId, item.code]), [[7, 'already_submitted'], [8, 'packet_review_required']]);
  assert.equal(answer.refused[0].why, 'Career already sent this application. A job is filled in only once.');
  assert.deepEqual(states(answer.queue), [[9, 'waiting', false]], 'a finished queue is replaced by the new batch');
  const twice = (await h.call('POST', '/apply-batch', { jobs: [dana.jobs[2]], approved: true }, dana.sub)).body;
  assert.deepEqual(twice.refused.map((item) => [item.postingId, item.code]), [[9, 'already_queued']]);
  const many = Array.from({ length: 51 }, (_, i) => ({ postingId: 100 + i, packetDigest: 'a'.repeat(64) }));
  const bound = await h.call('POST', '/apply-batch', { jobs: many, approved: true }, dana.sub);
  assert.deepEqual([bound.code, bound.body.error], [400, 'Approve from 1 to 50 jobs, each the exact packet you reviewed.']);
  assert.equal((await h.call('POST', '/apply-batch', { jobs: [dana.jobs[2]] }, dana.sub)).code, 400, 'approval must be said');
  const later = await person('dana-batch-applied-later', [[8, 'Sample Freight Two']]);
  await h.call('POST', '/apply-batch', { jobs: later.jobs, approved: true }, later.sub);
  later.mark(7, 'applied');
  const queue = (await advance(later)).body.queue;
  assert.deepEqual(states(queue), [[7, 'skipped', false], [8, 'filling', true]], 'a job he applied to while it waited is never started');
  assert.equal(queue.entries[0].reason, 'Already applied. Career fills in a job only once.');
  assert.deepEqual(started(later), [8]);
});

test('never two at once: while a run started from a job’s own page is on his computer, the queue waits for it', async () => {
  const dana = await person('dana-batch-other', [[8, 'Sample Freight Two']]);
  const single = (await h.call('POST', '/apply-runs', { ...dana.jobs[1], approved: true }, dana.sub)).body.run;
  await h.call('POST', `/apply-runs/${single.id}/bind`, {}, dana.sub);
  await h.call('POST', `/apply-runs/${single.id}/start`, {}, dana.sub);
  set(workOf(dana, 8), { state: 'running', apply: { attempt: 1, state: 'filling' } });
  await h.call('POST', '/apply-batch', { jobs: [dana.jobs[0]], approved: true }, dana.sub);
  let queue = (await advance(dana)).body.queue;
  assert.deepEqual(states(queue), [[7, 'waiting', false]]);
  assert.equal(queue.reason, 'Waiting for the form Career is filling in for Sample Freight Two to end; the next job starts after it.');
  assert.deepEqual(started(dana), [8], 'nothing else starts while it is on his computer');
  set(workOf(dana, 8), { state: 'cancelled' });
  queue = (await advance(dana)).body.queue;
  assert.deepEqual([states(queue), queue.reason, started(dana)], [[[7, 'filling', true]], '', [8, 7]]);
});

test('a computer that is not connected pauses the queue with the reason; Go on starts the same job', async () => {
  const dana = await person('dana-batch-device', [[8, 'Sample Freight Two']]);
  await h.call('POST', '/apply-batch', { jobs: dana.jobs, approved: true }, dana.sub);
  h.port.refuseStart = Object.assign(Error('Your chosen Job Apply device is not connected.'), { code: 'apply_device_unavailable' });
  let queue;
  try { queue = (await advance(dana)).body.queue; } finally { h.port.refuseStart = null; }
  assert.deepEqual([queue.state, queue.reason], ['paused', 'Your chosen Job Apply device is not connected. Career paused the queue; press Go on when your computer is connected.']);
  assert.deepEqual(states(queue), [[7, 'waiting', false], [8, 'waiting', false]]);
  queue = (await h.call('POST', '/apply-batch/go-on', {}, dana.sub)).body.queue;
  assert.deepEqual([queue.state, states(queue)[0], started(dana)], ['running', [7, 'filling', true], [7]]);
});

test('a start whose acknowledgement was lost keeps the job claimed and sends the same start again, never a second job', async () => {
  const dana = await person('dana-batch-ack', [[8, 'Sample Freight Two']]);
  await h.call('POST', '/apply-batch', { jobs: dana.jobs, approved: true }, dana.sub);
  h.port.lostAck = true;
  let queue = (await advance(dana)).body.queue;
  assert.deepEqual([states(queue), queue.entries[0].reason, started(dana)], [[[7, 'filling', true], [8, 'waiting', false]], 'Starting on your computer', []]);
  queue = (await advance(dana)).body.queue;
  assert.deepEqual([states(queue), started(dana)], [[[7, 'filling', true], [8, 'waiting', false]], [7]], 'the same job started on the next advance');
  assert.equal((await h.call('POST', '/apply-batch', { jobs: [], approved: true }, dana.sub)).code, 400, 'an empty batch is refused');
});
