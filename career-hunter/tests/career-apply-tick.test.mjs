/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0, the coordinator's change: a job written today by an earlier Career (1.77.6, no documents revision recorded) goes into the queue as it is; only a letter dated an earlier day or an older documents revision is written again before approval.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0 (design career-self-improving-applications-2026-11-27 parts 1 and 3): the career-apply-queue schedule's step (POST /apply-batch/tick) over Career's real routes (lib/career-apply-routes.js with the queue's) on a made-up person's real store, with the kernel's ticket port stood in at the harness boundary as a work record per ticket. Proved: with no page open the tick starts the next approved job once the one before ended; each queue run is approved with the queue's five-minute wait for the person while a single approval keeps thirty; a job waiting on a question card has its question learned under the id its open card confirms, and when its run pauses at that wait the tick ends it with what it waited for and starts the next; the next approval answers that question from the person's own record before asking (the review's fromRecord); a tick that finds the queue's lock held changes nothing and the next one moves it on, and a start whose acknowledgement was lost is sent again; a job whose letter is dated an earlier day or whose documents were written under an older documents revision is refused before approval with that reason and put in Generate again, while one written today by an earlier Career goes in as it is; the page's cards are answered from the record only for the person's own run; another person's tick changes nothing.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { applyHarness } from './helpers/career-apply-fixture.mjs';

const require = createRequire(import.meta.url);
const uuid = (head, n) => head + '-0000-0000-0000-' + String(n).padStart(12, '0');
const AUTHORIZED = 'Are you legally authorized to work in the United States?';
let h, ids, sync;
const works = [], rows = new Map();
before(async () => {
  h = await applyHarness();
  ids = require('../lib/career-apply-answers.js');
  let tickets = 0;
  h.port.createTicket = async (input) => { h.port.created.push(input); return { ticketId: uuid('a4000000', ++tickets) }; };
  h.port.startTicket = async (ticketId, input) => {
    if (h.port.lostAck) { h.port.lostAck = false; return { envelope: {} }; }
    const id = uuid('b4000000', works.length + 1), task = JSON.parse(Buffer.from(input.files[0].bytes).toString('utf8'));
    works.push({ id, ticketId, task }); rows.set(id, { id, ticketId, state: 'queued', executor: 'orbit-apply-v1' });
    return { envelope: { id } };
  };
  h.port.getTicketWork = async (ticketId) => [...rows.values()].filter((row) => row.ticketId === ticketId).map(({ ticketId: _t, ...row }) => ({ ...row }));
});
after(async () => { await h?.stop(); });

/** The card id the kernel derives for one question of one run (crates/api/src/apply_cards.rs card_id). */
const cardOf = (run, text, kind) => require('node:crypto').createHash('sha256').update(`apply-card\u001f${run}\u001f${ids.questionId(text, kind)}`).digest('hex').slice(0, 32);
/** A made-up person with jobs 7 and more, each reviewed as the page reads it, whose record says she may work here. */
async function person(sub, more = []) {
  const one = h.person(sub);
  for (const id of more) h.job(sub, id, { company: 'Sample Company ' + id });
  fs.writeFileSync(path.join(one.dir, 'apply_profile.json'), JSON.stringify({ work_authorization: 'Yes', requires_sponsorship: 'No' }));
  return one;
}
async function reviewed(one, list) {
  const out = [];
  for (const id of list) { const review = await h.call('GET', '/apply-review/' + id, null, one.sub); assert.equal(review.code, 200, JSON.stringify(review.body)); out.push({ postingId: id, packetDigest: review.body.packetDigest }); }
  return out;
}
const tick = (one) => h.call('POST', '/apply-batch/tick', {}, one.sub);
const runsOf = (one) => JSON.parse(fs.readFileSync(path.join(one.dir, 'apply-runs.json'), 'utf8')).runs;
const mine = (one) => { const own = runsOf(one); return works.filter((work) => own[work.task.intentId]); };
const workOf = (one, postingId) => mine(one).filter((work) => work.task.task.postingId === postingId).at(-1);
const set = (work, patch) => rows.set(work.id, { ...rows.get(work.id), ...patch });
const states = (queue) => queue.entries.map((entry) => [entry.postingId, entry.state, entry.active]);
/** The kernel ended this attempt with its accepted answer. */
function ended(work, outcome, data = {}) {
  set(work, { state: 'completed' });
  h.port.accepted.set(work.id, { version: 2, intentId: work.task.intentId, attempt: work.task.attempt, requestDigest: work.task.requestDigest, outcome, data });
}
/** The run waits on a question card, as the kernel's work record says it (apply_evidence.rs project). */
function waitsOn(work, question) {
  set(work, { state: 'running', apply: { attempt: 1, state: 'waiting_for_you', page: { label: 'Application Questions' }, pages: [],
    reason: { kind: 'question', text: `Career asks you in Approvals: ${question}. Career types your answer in for you.` }, cards: ['apply-' + cardOf(work.task.intentId, question, 'select')] } });
}

test('with no page open the tick moves the queue on, learns the question a job waits on, steps past it at the queue\'s wait, and the next approval answers it from the record', async () => {
  const eve = await person('eve-tick', [8, 9]);
  const approved = await h.call('POST', '/apply-batch', { jobs: await reviewed(eve, [7, 8]), approved: true }, eve.sub);
  assert.equal(approved.code, 200, JSON.stringify(approved.body));
  assert.deepEqual(approved.body.refused, []);
  let answer = await tick(eve);
  assert.equal(answer.code, 200, JSON.stringify(answer.body));
  assert.deepEqual(states(answer.body.queue), [[7, 'filling', true], [8, 'waiting', false]], 'the schedule starts the first job with no page open');
  const seven = workOf(eve, 7);
  assert.equal(seven.task.bounds.waitMs, 5 * 60 * 1000, 'a queue run waits five minutes for the person');

  waitsOn(seven, AUTHORIZED);
  answer = await tick(eve);
  assert.deepEqual(states(answer.body.queue), [[7, 'needs-you', true], [8, 'waiting', false]], 'the queue waits while the job on the computer waits');
  assert.equal(answer.body.learned, 1, 'the question it waits on is learned');
  const kept = JSON.parse(fs.readFileSync(path.join(eve.dir, 'apply-questions.json'), 'utf8')).questions;
  assert.deepEqual(kept.map(({ id, text, type, jobs }) => ({ id, text, type, jobs })), [{ id: ids.questionId(AUTHORIZED, 'select'), text: AUTHORIZED, type: 'select', jobs: [7] }]);
  assert.equal((await tick(eve)).body.learned, 0, 'learned once');

  ended(seven, 'paused', { reason: 'Paused: Career waited 5 minutes for you to answer its question. Nothing was submitted. Press Go on to start again.' });
  answer = await tick(eve);
  assert.deepEqual(states(answer.body.queue), [[7, 'skipped', false], [8, 'filling', true]], 'the job it stepped past ends and the next starts');
  assert.equal(answer.body.queue.entries[0].reason, `Stepped past while it waited for you: Needs your answer: Career asks you in Approvals: ${AUTHORIZED}. Career types your answer in for you. Nothing was submitted.`);

  const nine = await h.call('GET', '/apply-review/9', null, eve.sub);
  assert.equal(nine.code, 200, JSON.stringify(nine.body));
  assert.deepEqual(nine.body.fromRecord, [{ id: ids.questionId(AUTHORIZED, 'select'), text: AUTHORIZED, value: 'Yes', rule: 'eligibility-authorized' }], 'the next approval answers it from her record before asking');
  assert.ok(nine.body.answers.some((item) => item.id === ids.questionId(AUTHORIZED, 'select') && item.value === 'Yes'), 'in the packet the run fills from');
  const single = await h.call('POST', '/apply-runs', { postingId: 9, packetDigest: nine.body.packetDigest, approved: true }, eve.sub);
  assert.equal(single.code, 200, JSON.stringify(single.body));
  for (const step of ['bind', 'start']) assert.equal((await h.call('POST', `/apply-runs/${single.body.run.id}/${step}`, {}, eve.sub)).code, 200);
  assert.equal(workOf(eve, 9).task.bounds.waitMs, 30 * 60 * 1000, 'a single approval keeps thirty minutes');
});

test('a tick that finds the queue busy changes nothing and the next moves it on; a start whose acknowledgement was lost is sent again', async () => {
  const finn = await person('finn-tick', [8]);
  await h.call('POST', '/apply-batch', { jobs: await reviewed(finn, [7, 8]), approved: true }, finn.sub);
  const lock = path.join(finn.dir, 'apply-batch.lock');
  fs.writeFileSync(lock, '');
  let answer = await tick(finn);
  assert.equal(answer.code, 200, JSON.stringify(answer.body));
  assert.deepEqual(states(answer.body.queue), [[7, 'waiting', false], [8, 'waiting', false]], 'another change holds the queue: this tick starts nothing');
  assert.equal(mine(finn).length, 0);
  fs.unlinkSync(lock);
  h.port.lostAck = true;
  answer = await tick(finn);
  assert.deepEqual(states(answer.body.queue), [[7, 'filling', true], [8, 'waiting', false]]);
  assert.equal(answer.body.queue.entries[0].reason, 'Starting on your computer', 'the start was not acknowledged');
  assert.equal(mine(finn).length, 0);
  answer = await tick(finn);
  assert.equal(mine(finn).length, 1, 'the next tick sends the same start again, once');
  assert.deepEqual(states(answer.body.queue).slice(0, 1), [[7, 'filling', true]]);
});

test('a plain Career version bump keeps today\'s documents; a letter dated an earlier day or an older documents revision is written again before approval', async () => {
  const gail = await person('gail-tick', [10, 11, 12]);
  const jobs = await reviewed(gail, [7, 10, 11, 12]);
  const folderOf = (id) => path.join(gail.dir, 'applications', fs.readdirSync(path.join(gail.dir, 'applications')).find((name) => name.endsWith('__' + id)));
  const rewrite = (id, change) => { const file = path.join(folderOf(id), 'application.json'), record = JSON.parse(fs.readFileSync(file, 'utf8')); fs.writeFileSync(file, JSON.stringify(change(record), null, 2)); };
  // Job 10: written today by Career 1.77.6, before revisions were recorded. Job 12: written under an older documents revision.
  rewrite(10, ({ documents_revision: _r, ...record }) => ({ ...record, career_version: '1.77.6' }));
  rewrite(12, (record) => ({ ...record, documents_revision: 0 }));
  const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString(), boardFile = path.join(gail.dir, 'job-board-state.json'), board = JSON.parse(fs.readFileSync(boardFile, 'utf8'));
  board.jobs[11] = { ...board.jobs[11], completedAt: yesterday }; fs.writeFileSync(boardFile, JSON.stringify(board));
  const answer = await h.call('POST', '/apply-batch', { jobs, approved: true }, gail.sub);
  assert.equal(answer.code, 200, JSON.stringify(answer.body));
  assert.deepEqual(answer.body.refused, [
    { postingId: 11, code: 'documents_stale', why: 'Its cover letter is dated an earlier day. Career is writing them again now; approve it once they are new.' },
    { postingId: 12, code: 'documents_stale', why: 'Its documents were written before Career changed how it writes them. Career is writing them again now; approve it once they are new.' }]);
  assert.deepEqual(states(answer.body.queue), [[7, 'waiting', false], [10, 'waiting', false]], 'documents made today by an earlier Career go in as they are');
  assert.equal(answer.body.regenerating.added, 2, 'both stale jobs are put in Generate again, his approval being its confirmation');
  const regen = JSON.parse(fs.readFileSync(path.join(gail.dir, 'regenerate-queue.json'), 'utf8'));
  assert.deepEqual(regen.entries.map((entry) => [entry.postingId, entry.state]), [[11, 'queued'], [12, 'queued']]);
});

test('the page\'s waiting cards are answered from the person\'s record only for her own run; another person\'s tick changes nothing', async () => {
  const hana = await person('hana-tick');
  await h.call('POST', '/apply-batch', { jobs: await reviewed(hana, [7]), approved: true }, hana.sub);
  const queue = (await tick(hana)).body.queue, runId = queue.current.runId, questionId = ids.questionId(AUTHORIZED, 'select');
  const own = 'apply-' + require('node:crypto').createHash('sha256').update(`apply-card\u001f${runId}\u001f${questionId}`).digest('hex').slice(0, 32);
  const cards = [{ id: own, questionId, question: AUTHORIZED, options: ['Yes', 'No'] },
    { id: 'apply-' + 'f'.repeat(32), questionId, question: AUTHORIZED, options: ['Yes', 'No'] },
    { id: 'apply-' + cardOf(runId, 'What is 3 + 4?', 'text'), questionId: ids.questionId('What is 3 + 4?', 'text'), question: 'What is 3 + 4?', options: [] }];
  const answered = await h.call('POST', `/apply-runs/${runId}/record-answers`, { cards }, hana.sub);
  assert.equal(answered.code, 200, JSON.stringify(answered.body));
  assert.deepEqual(answered.body.answers, [{ card: own, option: 0, rule: 'eligibility-authorized' }], 'a card of another run and a check that she is human get nothing');
  assert.equal((await h.call('POST', `/apply-runs/${runId}/record-answers`, { cards }, 'ivan-tick')).code, 404, 'another person cannot read her run');
  assert.equal((await h.call('POST', `/apply-runs/${runId}/record-answers`, { cards, extra: true }, hana.sub)).code, 400);
  h.person('ivan-tick');
  const other = await tick({ sub: 'ivan-tick' });
  assert.equal(other.code, 200, JSON.stringify(other.body));
  assert.deepEqual(other.body, { queue: null, learned: 0 }, 'a person with no queue: nothing happens');
  assert.equal((await h.call('POST', '/apply-batch/tick', { press: 'x' }, hana.sub)).code, 400, 'the tick takes no words');
});
