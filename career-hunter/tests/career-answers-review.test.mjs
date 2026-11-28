/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.79.0, Answers to review (design career-self-improving-applications-2026-11-27 part 4) over Career's real routes on made-up people's real stores, the kernel's ticket port stood in as a work record per ticket and the engine's background start running the real drafting module (jobhunter.written_answers) with fixture inference. Proved: a run waiting on a written question card and a run that paused on it (its receipt's card id) list one question with both jobs; Career asks its specialist for a draft only of a written question, never a check or a fact no record holds, never twice at once and never while another run holds the store; the draft says the role it drew on; Approve keeps the answer in Saved answers under the exact id and the other ids its words take, puts the paused job back in Fill in several approved again with that answer in its packet, and says back the card still waiting for the page to answer; the same question at another employer goes back with the saved answer by itself; a plain question and a check take the person's answer (a check is never kept); Skip and Review again; another person's questions never appear and cannot be answered; Answer written questions without my review, off by default, uses ready drafts straight away when on (answered automatically, still listed, with Undo on Saved answers).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { applyHarness, packageRoot } from './helpers/career-apply-fixture.mjs';

const require = createRequire(import.meta.url);
const uuid = (head, n) => head + '-0000-0000-0000-' + String(n).padStart(12, '0');
const python = process.env.JOBHUNTER_PYTHON || 'python3';
const WRITTEN = 'Tell us about your experience running an office for a growing team.';
const START_Q = 'When can you start?';
const ASKS = (...questions) => `Career asks you in Approvals: ${questions.join(' / ')}. Career types your answer in for you.`;
const DRAFT = 'As Office Manager at Example Freight Co I ran the front office for 40 people. I kept the office running for the whole team every day.';
/** The real drafting module with its one model call answered by a fixture, in the person's store, as the background run would. */
const DRAFT_PY = 'import json,os\nfrom unittest.mock import patch\nfrom jobhunter import enrich, written_answers\n'
  + 'with patch.object(enrich,"complete",return_value=os.environ["FIXTURE_ANSWER"]) as complete:\n'
  + ' result=written_answers.run(os.environ["CH_ANSWER_DRAFTS"])\nprint(json.dumps({**result,"calls":complete.call_count}))';
let h, sync0, kinds, answersLib;
const works = [], rows = new Map(), drafted = [];
let fixture = { answer: DRAFT, evidence: ['R1'] };
before(async () => {
  h = await applyHarness();
  ({ cardId: sync0 } = require('../lib/career-apply-sync.js')); kinds = require('../lib/career-answers-kinds.js'); answersLib = require('../lib/career-apply-answers.js');
  let tickets = 0;
  h.port.createTicket = async (input) => { h.port.created.push(input); return { ticketId: uuid('a7000000', ++tickets) }; };
  h.port.startTicket = async (ticketId, input) => {
    const id = uuid('b7000000', works.length + 1), task = JSON.parse(Buffer.from(input.files[0].bytes).toString('utf8'));
    works.push({ id, ticketId, task }); rows.set(id, { id, ticketId, state: 'queued', executor: 'orbit-apply-v1' });
    return { envelope: { id } };
  };
  h.port.getTicketWork = async (ticketId) => [...rows.values()].filter((row) => row.ticketId === ticketId).map(({ ticketId: _t, ...row }) => ({ ...row }));
  h.engineAsync = ({ sub, dir, paths, extra, args }) => {
    assert.deepEqual(args, ['answers-draft']);
    const out = spawnSync(python, ['-c', DRAFT_PY], { cwd: packageRoot, encoding: 'utf8', timeout: 60000,
      // The launcher's own engine environment (bin/oshal-jobhunter.js buildEngineEnv): the person's store, multi-user mode.
      env: { ...process.env, PYTHONPATH: path.join(packageRoot, 'engine'), JOBHUNTER_MULTIUSER: '1', OSHAL_USER_SUB: sub, JOBHUNTER_DATA: dir, JOBHUNTER_CORPUS_DB: paths.corpusDb,
        JOBHUNTER_USER_DB: paths.userDb, JOBHUNTER_CAREER_DB: path.join(dir, 'career_db.json'), ...extra, FIXTURE_ANSWER: JSON.stringify(fixture) } });
    assert.equal(out.status, 0, out.stderr);
    drafted.push({ request: JSON.parse(extra.CH_ANSWER_DRAFTS), result: JSON.parse(out.stdout.trim().split('\n').at(-1)) });
    return { started: true };
  };
});
after(async () => { await h?.stop(); });

const workOf = (runId) => works.filter((work) => work.task.intentId === runId).at(-1);
const set = (work, patch) => rows.set(work.id, { ...rows.get(work.id), ...patch });
const sync = (sub, runId) => h.call('POST', '/apply-runs/' + runId + '/sync', {}, sub);
const list = (sub) => h.call('GET', '/answers-to-review', null, sub);
const refresh = (sub, cards) => h.call('POST', '/answers-to-review/refresh', cards ? { cards } : {}, sub);
const id = (text, kind) => answersLib.questionId(text, kind);
async function approveRun(sub, postingId) {
  const review = await h.call('GET', '/apply-review/' + postingId, null, sub);
  assert.equal(review.code, 200, JSON.stringify(review.body));
  const runId = (await h.call('POST', '/apply-runs', { postingId, packetDigest: review.body.packetDigest, approved: true }, sub)).body.run.id;
  assert.equal((await h.call('POST', '/apply-runs/' + runId + '/bind', {}, sub)).code, 200);
  assert.equal((await h.call('POST', '/apply-runs/' + runId + '/start', {}, sub)).code, 200);
  return runId;
}
/** A run waiting on its question cards now: the kernel's waiting words. */
async function waiting(sub, postingId, ...questions) {
  const runId = await approveRun(sub, postingId);
  set(workOf(runId), { state: 'running', apply: { attempt: 1, state: 'waiting_for_you', reason: { kind: 'question', text: ASKS(...questions) } } });
  assert.equal((await sync(sub, runId)).body.run.status, 'waiting');
  return runId;
}
/** A run that paused on a question nobody answered: the kernel's accepted answer names the card. */
async function paused(sub, postingId, text, kind = 'textarea') {
  const runId = await approveRun(sub, postingId), work = workOf(runId);
  set(work, { state: 'completed' });
  h.port.accepted.set(work.id, { version: 2, intentId: runId, attempt: 1, requestDigest: work.task.requestDigest, outcome: 'paused',
    data: { reason: 'Paused: Career waited 30 minutes for you to answer its question. Nothing was submitted. Press Go on to start again.',
      questions: [{ text, answer: null, from: '', keep: false, card: sync0(runId, id(text, kind)) }], changes: [], pictures: [], uploads: [], handBacks: [] } });
  assert.equal((await sync(sub, runId)).body.run.status, 'paused');
  return runId;
}
const card = (runId, text, kind = 'textarea', options = []) => ({ id: sync0(runId, id(text, kind)), run: runId, ask: { question: text, questionId: id(text, kind), options, slot: null } });
const savedAnswers = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'apply_profile.json'), 'utf8')).answers;
const queued = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'apply-batch.json'), 'utf8')).entries;
const latestRun = (dir, postingId) => Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'apply-runs.json'), 'utf8')).runs).filter((run) => run.postingId === postingId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
const input = (dir, run) => JSON.parse(fs.readFileSync(path.join(dir, `apply-${run.id}-1.json`), 'utf8'));

test('one written question waits on two jobs; Career drafts it from the record, and Approve saves it and puts every job back', async () => {
  const dana = h.person('dana-review'); h.job(dana.sub, 8, { company: 'Sample Freight 8' });
  const live = await waiting(dana.sub, 7, WRITTEN), stopped = await paused(dana.sub, 8, WRITTEN);
  const before = (await list(dana.sub)).body;
  assert.deepEqual([before.count, before.jobs, before.auto], [1, 2, false]);
  assert.equal(before.written.length, 1); assert.deepEqual(before.plain, []);
  const question = before.written[0];
  assert.equal(question.text, WRITTEN);
  assert.deepEqual(question.jobs.map((job) => [job.postingId, job.live]).sort(), [[7, true], [8, false]]);
  assert.equal(question.draft.state, 'pending', 'no draft yet');
  assert.equal(h.asyncCalls.length, 0, 'a read asks for nothing');

  const asked = await refresh(dana.sub, [card(live, WRITTEN)]);
  assert.equal(asked.code, 200, JSON.stringify(asked.body));
  assert.equal(drafted.length, 1, 'one background run');
  assert.deepEqual(drafted[0].request.questions.map((item) => item.text), [WRITTEN], 'only the written question is drafted');
  assert.equal(drafted[0].result.calls, 1, 'one model call');
  const shown = asked.body.written[0];
  assert.deepEqual([shown.draft.state, shown.draft.text], ['ready', DRAFT]);
  assert.deepEqual(shown.draft.roles, [{ title: 'Office Manager', org: 'Example Freight Co' }], 'what it was drawn from');
  assert.equal(shown.jobs.find((job) => job.postingId === 7).card, card(live, WRITTEN).id, 'the waiting card is known');
  await refresh(dana.sub);
  assert.equal(drafted.length, 1, 'a ready draft is not asked for again');

  const approved = await h.call('POST', '/answers-to-review/approve', { key: shown.key, value: DRAFT, how: 'approved' }, dana.sub);
  assert.equal(approved.code, 200, JSON.stringify(approved.body));
  assert.deepEqual(approved.body.back, [8], 'the paused job goes back in Fill in several');
  assert.deepEqual(approved.body.answerCards, [{ card: card(live, WRITTEN).id, value: DRAFT, postingId: 7 }], 'the card still waiting is the page’s to answer');
  assert.deepEqual([approved.body.count, approved.body.written.length], [0, 0]);
  const saved = savedAnswers(dana.dir).find((item) => item.key === shown.key);
  assert.equal(saved.value, DRAFT); assert.equal(saved.text, WRITTEN); assert.equal(saved.source, 'review');
  assert.ok([saved.id, ...saved.also].includes(id(WRITTEN, 'textarea')) && [saved.id, ...saved.also].includes(id(WRITTEN, 'text')), 'under the exact id and the other kinds its words take');
  assert.equal(latestRun(dana.dir, 8).id !== stopped, true, 'job 8 holds a new approval');
  assert.deepEqual(Object.values(JSON.parse(fs.readFileSync(path.join(dana.dir, 'apply-runs.json'), 'utf8')).runs).find((run) => run.id === stopped).status, 'stopped');
  assert.deepEqual(queued(dana.dir).map((entry) => [entry.postingId, entry.state]), [[8, 'waiting']]);
  const carried = input(dana.dir, latestRun(dana.dir, 8)).task.answers.find((item) => item.id === id(WRITTEN, 'textarea'));
  assert.deepEqual([carried?.text, carried?.value], [WRITTEN, DRAFT], 'the new approval’s packet carries the answer under the id the run looks up');
  const page = (await h.call('GET', '/saved-answers', null, dana.sub)).body;
  assert.equal(page.answers.find((item) => item.key === shown.key).source, 'review');
  assert.ok(page.undo, 'Undo puts Saved answers back');
});

test('the same question at another employer goes back with the saved answer by itself, and twice at most', async () => {
  const sam = h.person('sam-reuse'); h.job(sam.sub, 8, { company: 'Sample Freight 8' }); h.job(sam.sub, 9, { company: 'Other Employer 9' });
  await paused(sam.sub, 8, WRITTEN);
  const key = (await refresh(sam.sub)).body.written[0].key;
  assert.equal((await h.call('POST', '/answers-to-review/approve', { key, value: 'I ran the office at Example Freight Co.', how: 'own' }, sam.sub)).code, 200);
  const other = WRITTEN.replace('.', ' ?').toUpperCase();
  await paused(sam.sub, 9, other, 'text');
  const again = await refresh(sam.sub);
  assert.equal(again.code, 200, JSON.stringify(again.body));
  assert.deepEqual(again.body.back, [9], 'the job at the other employer is put back');
  assert.equal(again.body.count, 0, 'nothing for him to type again');
  const carried = input(sam.dir, latestRun(sam.dir, 9)).task.answers.find((item) => item.id === id(other, 'text'));
  assert.equal(carried?.value, 'I ran the office at Example Freight Co.', 'under that employer’s own id');
  for (let n = 0; n < 2; n += 1) { await paused(sam.sub, 9, other, 'text'); await refresh(sam.sub); }
  const reopened = (await list(sam.sub)).body;
  assert.equal(reopened.plain.length + reopened.written.length, 1, 'after twice the form still asks: the question is his again');
});

test('a plain question and a check wait for the person: never drafted, the check never kept', async () => {
  const lee = h.person('lee-plain'); h.job(lee.sub, 8, { company: 'Sample Freight 8' });
  const runId = await paused(lee.sub, 8, 'When can you start?', 'text');
  await waiting(lee.sub, 7, 'What is 3 + 4?', 'Please describe your approach to vendor negotiations.');
  const calls = drafted.length;
  const shown = (await refresh(lee.sub)).body;
  assert.deepEqual(shown.plain.map((item) => [item.text, item.kind]).sort(), [['What is 3 + 4?', 'check'], ['When can you start?', 'plain']]);
  assert.deepEqual(drafted.slice(calls).flatMap((run) => run.request.questions.map((item) => item.text)), ['Please describe your approach to vendor negotiations.'], 'only prose is drafted');
  const start = shown.plain.find((item) => item.kind === 'plain'), check = shown.plain.find((item) => item.kind === 'check');
  assert.equal(start.draft, undefined, 'a plain question has no draft');
  const kept = await h.call('POST', '/answers-to-review/approve', { key: start.key, value: 'Two weeks after an offer.', how: 'own' }, lee.sub);
  assert.deepEqual([kept.code, kept.body.kept, kept.body.back], [200, true, [8]]);
  assert.equal(savedAnswers(lee.dir).find((item) => item.key === start.key).value, 'Two weeks after an offer.');
  assert.notEqual(latestRun(lee.dir, 8).id, runId);
  const sum = await h.call('POST', '/answers-to-review/approve', { key: check.key, value: '7', how: 'own' }, lee.sub);
  assert.deepEqual([sum.code, sum.body.kept], [200, false]);
  assert.equal(savedAnswers(lee.dir).some((item) => item.key === check.key), false, 'a check is never kept for another form');
  assert.equal((await h.call('POST', '/answers-to-review/approve', { key: start.key, value: 'x'.repeat(2001), how: 'own' }, lee.sub)).code, 400);
});

test('Skip sets a question aside and Review again puts it back; another person never sees or answers it', async () => {
  const kim = h.person('kim-skip'), ana = h.person('ana-other');
  const kimRun = await waiting(kim.sub, 7, WRITTEN);
  const key = (await list(kim.sub)).body.written[0].key;
  const skipped = await h.call('POST', '/answers-to-review/skip', { key }, kim.sub);
  assert.deepEqual([skipped.code, skipped.body.count, skipped.body.skipped.map((item) => item.key)], [200, 0, [key]]);
  const back = await h.call('POST', '/answers-to-review/reopen', { key }, kim.sub);
  assert.deepEqual([back.body.count, back.body.written[0].key], [1, key]);
  const theirs = await list(ana.sub);
  assert.deepEqual([theirs.code, theirs.body.count, theirs.body.written, theirs.body.plain], [200, 0, [], []]);
  assert.equal((await h.call('POST', '/answers-to-review/approve', { key, value: 'Not mine.', how: 'own' }, ana.sub)).code, 404);
  assert.equal((await h.call('POST', '/answers-to-review/skip', { key }, ana.sub)).code, 404);
  assert.equal((await refresh(ana.sub, [card(kimRun, WRITTEN)])).body.count, 0, 'a card of another person’s run is not taken');
  assert.equal(fs.existsSync(path.join(ana.dir, 'answers-review.json')), false, 'nothing of his is kept in her store');
  assert.equal((await h.raw('GET', '/answers-to-review', null, null)).status, 401);
  assert.equal(fs.existsSync(path.join(kim.dir, 'answers-review.json')), true);
  assert.equal((await h.call('POST', '/answers-to-review/refresh', { cards: 'no' }, kim.sub)).code, 400);
});

test('Answer written questions without my review: off by default; on, a ready draft is used straight away and still listed', async () => {
  const max = h.person('max-auto'); h.job(max.sub, 8, { company: 'Sample Freight 8' });
  await paused(max.sub, 8, WRITTEN);
  const off = (await refresh(max.sub)).body;
  assert.deepEqual([off.auto, off.written[0].draft.state, off.automatic.length], [false, 'ready', 0], 'off: the draft waits for him');
  assert.ok(!fs.existsSync(path.join(max.dir, 'apply_profile.json')) || !(savedAnswers(max.dir) || []).length, 'nothing saved while it waits');
  const page = (await h.call('GET', '/saved-answers', null, max.sub)).body;
  assert.deepEqual(page.written, { auto: false });
  assert.equal((await h.call('POST', '/saved-answers', { revision: page.revision, written: { auto: 'yes' } }, max.sub)).code, 400);
  const on = await h.call('POST', '/saved-answers', { revision: page.revision, written: { auto: true } }, max.sub);
  assert.deepEqual([on.code, on.body.written], [200, { auto: true }]);
  const used = (await refresh(max.sub)).body;
  assert.deepEqual([used.auto, used.count, used.written.length, used.back], [true, 0, 0, [8]]);
  assert.equal(used.automatic.length, 1); assert.deepEqual([used.automatic[0].answer.how, used.automatic[0].answer.value], ['automatic', DRAFT]);
  assert.deepEqual(used.automatic[0].answer.roles, [{ title: 'Office Manager', org: 'Example Freight Co' }]);
  assert.equal(savedAnswers(max.dir).find((item) => item.key === used.automatic[0].key).source, 'automatic');
  const edited = await h.call('POST', '/answers-to-review/approve', { key: used.automatic[0].key, value: 'I ran the front office at Example Freight Co.', how: 'edited' }, max.sub);
  assert.equal(edited.code, 200, JSON.stringify(edited.body));
  assert.equal(savedAnswers(max.dir).find((item) => item.key === used.automatic[0].key).value, 'I ran the front office at Example Freight Co.', 'a later edit replaces it');
  assert.equal(edited.body.automatic.length, 0, 'once he changed it, it is his answer');
});

test('a draft the record does not support is not kept, and is asked for at most three times', async () => {
  const joe = h.person('joe-unsupported'); h.job(joe.sub, 8, { company: 'Sample Freight 8' });
  await paused(joe.sub, 8, 'Describe how you led a Kubernetes migration.');
  fixture = { answer: 'At Example Freight Co I led our Kubernetes migration for 40 people. It went well for everyone.', evidence: ['R1'] };
  try {
    const first = (await refresh(joe.sub)).body.written[0];
    assert.equal(first.draft.state, 'pending', 'refused once: Career asks again');
    await refresh(joe.sub); await refresh(joe.sub);
    const last = (await refresh(joe.sub)).body.written[0];
    assert.deepEqual([last.draft.state, last.draft.why], ['failed', 'Career’s draft said more than your record supports, so it was not kept.']);
    const runs = drafted.filter((run) => run.request.questions.some((item) => item.text.startsWith('Describe how you led')));
    assert.equal(runs.length, 3, 'three tries, then it is his to write');
  } finally { fixture = { answer: DRAFT, evidence: ['R1'] }; }
});

test('no draft is asked for while another Career run holds the person’s store; the next refresh asks', async () => {
  const pat = h.person('pat-busy'); h.job(pat.sub, 8, { company: 'Sample Freight 8' });
  await paused(pat.sub, 8, 'Why do you want to work here?');
  const runner = require('../routes/career-engine-runner.js'), lease = runner.tryAcquireRun(pat.sub, 'user-store');
  assert.equal(lease.status, 'ok');
  const calls = h.asyncCalls.length;
  try {
    const busy = (await refresh(pat.sub)).body;
    assert.deepEqual([busy.drafting, busy.written[0].draft.state, h.asyncCalls.length], [false, 'pending', calls], 'nothing started beside the other run');
  } finally { runner.releaseRun(lease); }
  const free = (await refresh(pat.sub)).body;
  assert.deepEqual([free.drafting, h.asyncCalls.length], [true, calls + 1]);
});

test('a written question is one that asks for prose; a check, a month card and a fact no record holds are not', () => {
  const written = ['What platform have you built from scratch?',
    'Have you personally owned the architecture or service-boundary decisions for an API that other teams depended on?',
    'Tell us about your experience working in an async/remote environment',
    'Have you helped build a marketplace or self-serve partner integration experience? If so, what part did you own?',
    'When working on a feature, do you proactively seek to understand the business context?', 'Why do you want to work here?', 'Describe a time you resolved a conflict.'];
  for (const text of written) assert.equal(kinds.kindOf(text, []), 'written', text);
  for (const text of ['What is 3 + 4?', 'Please complete the captcha below', 'Type the characters you see']) assert.equal(kinds.kindOf(text, []), 'check', text);
  for (const text of ['When can you start?', 'What is your notice period?', 'What are your salary expectations?', 'Are you legally authorized to work in the United States?',
    'How did you hear about us?', 'LinkedIn Profile', 'Are you willing to relocate?']) assert.equal(kinds.kindOf(text, []), 'plain', text);
  assert.equal(kinds.kindOf('Tell us about your experience running an office.', ['Yes', 'No']), 'plain', 'a question with listed choices is the person’s to choose');
  assert.equal(kinds.kindOf('In which month of 2012 did you start as Administrative Assistant at Northwind Traders?', []), 'month', 'a month card fills the record');
  assert.equal(kinds.key('What platform have you built from scratch?'), kinds.key('WHAT PLATFORM have you built from scratch ?*'), 'the same question at another employer');
  assert.notEqual(kinds.key('What platform have you built from scratch?'), kinds.key('What platform have you used?'));
  assert.deepEqual(kinds.waiting(ASKS('What is 3 + 4?', 'Please describe your approach.')), ['What is 3 + 4?', 'Please describe your approach.']);
  assert.deepEqual(kinds.waiting('Waiting for you to sign in'), []);
});

test('an answer removed from Saved answers is not given again: the question is the person’s again', async () => {
  const eve = h.person('eve-removed'); h.job(eve.sub, 8, { company: 'Sample Freight 8' }); h.job(eve.sub, 9, { company: 'Other Employer 9' });
  await paused(eve.sub, 8, START_Q);
  const key = (await refresh(eve.sub)).body.plain[0].key;
  assert.equal((await h.call('POST', '/answers-to-review/approve', { key, value: 'In two weeks.', how: 'own' }, eve.sub)).code, 200);
  const page = (await h.call('GET', '/saved-answers', null, eve.sub)).body, saved = page.answers.find((item) => item.key === key);
  assert.equal((await h.call('POST', '/saved-answers', { revision: page.revision, remove: saved.id }, eve.sub)).code, 200, 'he removes it');
  await paused(eve.sub, 9, START_Q);
  const again = (await refresh(eve.sub)).body;
  assert.deepEqual([again.back, again.plain.map((item) => item.key)], [[], [key]], 'not put back with the removed answer; his to answer again');
  assert.equal(savedAnswers(eve.dir).some((item) => item.key === key), false, 'and not saved again');
});
