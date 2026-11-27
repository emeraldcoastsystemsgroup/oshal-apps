/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career banks what the person kept on a question card by itself (the owner, 2026-11-26: "are you building a bank of my answers"; kept answers stayed in the kernel because only the job page's Keep wrote them). Through Career's real routes on made-up people's real stores, with only the kernel's ticket port stood in (its accepted answer shaped as oshald node_work/apply_evidence.rs writes it): when a run's attempt ends, POST /apply-runs/:id/sync puts every card answered with Keep into Saved answers under the question id the kernel computed for the page's words and the field's kind (Career's own questionId, and the kernel's own test vector), with no page open, and the next job's packet and approved input carry it. A card not kept, answered on the page, of another run, or for a month is not banked; another person reads and writes nothing; a result for other input banks nothing. Once per card: a second sync, the job page's Keep for the same card and the same answer kept again write nothing. A newer answer replaces the older with Undo; one given earlier never replaces a newer. Standing self-identification answers and the Attestations stay as they were; a full Saved answers list keeps the run's end and leaves the card for the job page. An attempt that ended before this version is read once at the next sync of any of his runs, and one the kernel no longer answers is asked once. Red before on store main 2c81c6a4: nothing was banked without the page.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { applyHarness } from './helpers/career-apply-fixture.mjs';

const require = createRequire(import.meta.url);
const answers = require('../lib/career-apply-answers');
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const uuid = (head, n) => `${head}-0000-0000-0000-${String(n).padStart(12, '0')}`;
const REASON = 'Career did not see the employer’s confirmation. Mark it applied when you have.';
let h;
before(async () => {
  h = await applyHarness();
  // The scripted port names its tickets and work with one digit; this suite starts more than nine runs.
  const create = h.port.createTicket, startTicket = h.port.startTicket;
  h.port.createTicket = async (input) => { await create(input); return { ticketId: uuid('a2000000', h.port.created.length) }; };
  h.port.startTicket = async (ticketId, input) => { await startTicket(ticketId, input); return { envelope: { id: uuid('b2000000', h.port.started.length) } }; };
});
after(async () => { await h?.stop(); });

/** Rust's char::is_whitespace, the Unicode White_Space characters the kernel trims and splits on. */
const WHITE = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const TRIM = new RegExp(`^[${WHITE}]+|[${WHITE}]+$`, 'gu'), SPLIT = new RegExp(`[${WHITE}\\ufeff]+`, 'u');
/**
 * The kernel's question id (oshald node_work/apply_compare.rs question_id), written again here from its source: the
 * words trimmed, cut to 500 UTF-16 units, NFKC, lower case, split on whitespace and joined with one space, and the
 * SHA-256 of the canonical JSON {"text","type"} with the field's kind word as the type.
 */
function kernelQuestionId(text, kind) {
  let units = 0, cut = '';
  for (const c of text.replace(TRIM, '')) { units += c.length; if (units > 500) break; cut += c; }
  const words = cut.normalize('NFKC').toLowerCase().split(SPLIT).filter(Boolean);
  return 'question:' + sha(JSON.stringify({ text: words.join(' '), type: kind }));
}
/** The kernel's card id for one question of one run (crates/api/src/apply_cards.rs card_id), written again from its source. */
const kernelCardId = (run, questionId) => 'apply-' + sha(`apply-card\u001f${run}\u001f${questionId}`).slice(0, 32);

/** One attempt's frozen input, as approval published it. */
const input = (person, id, n = 1) => JSON.parse(fs.readFileSync(path.join(person.dir, `apply-${id}-${n}.json`), 'utf8'));
/** Approve, bind and start one job's run for a person, as the job page does. @returns {Promise<object>} the run, its work and input. */
async function start(person, postingId = 7) {
  const { body } = await h.call('GET', `/apply-review/${postingId}`, null, person.sub);
  assert.ok(body?.packetDigest, JSON.stringify(body));
  const run = (await h.call('POST', '/apply-runs', { postingId, packetDigest: body.packetDigest, approved: true }, person.sub)).body.run;
  assert.equal((await h.call('POST', `/apply-runs/${run.id}/bind`, {}, person.sub)).code, 200);
  assert.equal((await h.call('POST', `/apply-runs/${run.id}/start`, {}, person.sub)).code, 200);
  const workId = JSON.parse(fs.readFileSync(path.join(person.dir, 'apply-runs.json'), 'utf8')).runs[run.id].attempts[0].workId;
  return { person, run, workId, input: input(person, run.id) };
}
const sync = (s, sub = s.person.sub) => h.call('POST', `/apply-runs/${s.run.id}/sync`, {}, sub);
const saved = async (person) => (await h.call('GET', '/saved-answers', null, person.sub)).body;
/** The kernel's verified answer of the run's attempt. */
const accepted = (s, outcome, data, requestDigest = s.input.requestDigest) =>
  h.port.accepted.set(s.workId, { version: 2, intentId: s.run.id, attempt: 1, requestDigest, outcome, data });
/** The kernel's record: the run's attempt completed with this answer. */
function ended(s, data, outcome = 'not_seen') {
  h.port.rows = [{ id: s.workId, state: 'completed', executor: 'orbit-apply-v1' }];
  accepted(s, outcome, data);
}
/** An attempt that ended before Career banked by itself: its end recorded as Career 1.77.3 recorded it, its answer never read for kept cards. */
function endedBefore(s, data) {
  accepted(s, 'not_seen', data);
  const file = path.join(s.person.dir, 'apply-runs.json'), state = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(state.runs[s.run.id], { status: 'not_seen', live: null, reason: REASON });
  delete state.runs[s.run.id].bankedAttempts;
  fs.writeFileSync(file, JSON.stringify(state) + '\n');
}
/**
 * One question the kernel's run asked on a card and the value it entered from his answer, as its answer reports them
 * (apply_evidence.rs question and change): the card's id comes from the run and the question id the kernel computed
 * from the page's words and the field's kind.
 */
function card(s, text, kind, answer, { keep = true, at = '2026-11-21T10:05:00.000Z' } = {}) {
  const questionId = kernelQuestionId(text, kind), id = kernelCardId(s.run.id, questionId);
  return { questionId, card: id, question: { text, answer, from: 'card:' + id, keep, card: id, page: 'application questions' },
    change: { page: 'Application Questions', label: text, group: '', before: '', after: answer, from: 'card:' + questionId, at } };
}
const data = (cards, extra = {}) => ({ reason: REASON, questions: cards.map((c) => c.question), changes: cards.map((c) => c.change), ...extra });
/** Count the kernel reads of accepted work, and refuse the ones named, as the kernel does for a stopped run's work. */
function watchAccepted(refused = new Set()) {
  const calls = new Map(), original = h.port.getAcceptedWork;
  h.port.getAcceptedWork = async (ticket, work) => {
    calls.set(work, (calls.get(work) || 0) + 1);
    if (refused.has(work)) throw Object.assign(Error('completed ticket work is unavailable'), { code: 'not_found' });
    return original(ticket, work);
  };
  return { calls, restore: () => { h.port.getAcceptedWork = original; } };
}

test('Career’s question id is the kernel’s for the same words and kind', () => {
  // oshald node_work/apply_rules_tests.rs the_question_id_is_careers_own
  const vector = 'question:' + sha('{"text":"are you legally authorized?","type":"listbox"}');
  assert.equal(kernelQuestionId('  Are   you LEGALLY\nauthorized? ', 'listbox'), vector);
  assert.equal(answers.questionId('  Are   you LEGALLY\nauthorized? ', 'listbox'), vector);
  const words = 'Will you now or in the future require sponsorship?';
  assert.equal(answers.questionId(words, 'listbox'), kernelQuestionId(words, 'listbox'));
  assert.notEqual(answers.questionId(words, 'listbox'), answers.questionId(words, 'radio'), 'the kind is part of the id');
});

test('an answer kept on a card is banked when its run ends, with no page open, and the next packet carries it under the kernel’s id', async () => {
  const dana = h.person('dana-bank'), s = await start(dana), words = 'Will you now or in the future require sponsorship?';
  const kept = card(s, words, 'listbox', 'No'), once = card(s, 'What is your desired salary?', 'text', '90000', { keep: false });
  const onPage = { text: 'Your pronouns', answer: null, from: 'card:on-page', keep: false, card: kernelCardId(s.run.id, kernelQuestionId('Your pronouns', 'text')), page: 'application questions' };
  ended(s, { ...data([kept, once]), questions: [kept.question, once.question, onPage] });
  const synced = await sync(s);
  assert.equal(synced.code, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.run.status, 'not_seen', 'the run’s end is kept as before');
  assert.deepEqual((await saved(dana)).answers.map((a) => [a.id, a.text, a.value, a.source]), [[kept.questionId, words, 'No', 'card']],
    'only the answer he kept, by the question id the kernel computed');
  assert.deepEqual(synced.body.run.keptCards.map((c) => [c.card, c.kind, c.result]), [[kept.card, 'answer', 'kept']]);
  // The next application: another job's packet carries it, and approving freezes it into the input the kernel gets.
  h.job(dana.sub, 8);
  const review = (await h.call('GET', '/apply-review/8', null, dana.sub)).body;
  assert.deepEqual(review.answers, [{ id: kernelQuestionId(words, 'listbox'), text: words, value: 'No' }]);
  const next = await h.call('POST', '/apply-runs', { postingId: 8, packetDigest: review.packetDigest, approved: true }, dana.sub);
  assert.equal(next.code, 200, JSON.stringify(next.body));
  assert.deepEqual(input(dana, next.body.run.id).task.answers, review.answers, 'the approved input carries it under that id');
});

test('banking is once per card: a second sync, the job page’s Keep for the same card and the same answer kept again write nothing', async () => {
  const erin = h.person('erin-bank'), s = await start(erin), words = 'How did you hear about us?', kept = card(s, words, 'prompt', 'LinkedIn');
  ended(s, data([kept]));
  assert.equal((await sync(s)).code, 200);
  const file = path.join(erin.dir, 'apply_profile.json'), folder = path.join(erin.dir, 'apply-profile-backups');
  const bytes = fs.readFileSync(file, 'utf8'), backups = fs.readdirSync(folder).sort();
  assert.equal((await sync(s)).code, 200);
  // The job page reads the kernel's card route and hands Career the same card (GET /api/apply/cards `kept`).
  const listed = [{ id: kept.card, run: s.run.id, questionId: kept.questionId, question: words, value: 'LinkedIn', option: null, slot: null, answeredAt: '2026-11-21T10:04:00.000Z' }];
  const page = await h.call('POST', `/apply-runs/${s.run.id}/kept`, { kept: listed }, erin.sub);
  assert.equal(page.code, 200, JSON.stringify(page.body));
  assert.equal(page.body.run.keptCards.length, 1, 'the card is handled once');
  // The same question kept again with the same answer on the next application's card.
  h.job(erin.sub, 8);
  const t = await start(erin, 8);
  ended(t, data([card(t, words, 'prompt', 'LinkedIn', { at: '2026-11-22T09:00:00.000Z' })]));
  assert.deepEqual((await sync(t)).body.run.keptCards.map((c) => c.result), ['skipped']);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'Saved answers are byte for byte as the first bank left them');
  assert.deepEqual(fs.readdirSync(folder).sort(), backups, 'and no save was made');
});

test('a newer answer to the same question replaces the older one with Undo; an answer given earlier never replaces a newer one', async () => {
  const finn = h.person('finn-bank'), words = 'Are you willing to relocate?';
  h.job(finn.sub, 8); h.job(finn.sub, 9);
  const first = await start(finn, 7);
  ended(first, data([card(first, words, 'radio', 'No', { at: '2026-11-21T10:00:00.000Z' })]));
  await sync(first);
  // A run that ended before this version, whose card was answered before both: read at the next sync, after that sync's own run.
  const earlier = await start(finn, 9);
  endedBefore(earlier, data([card(earlier, words, 'radio', 'Only within my state', { at: '2026-11-20T10:00:00.000Z' })]));
  const second = await start(finn, 8);
  ended(second, data([card(second, words, 'radio', 'Yes', { at: '2026-11-22T10:00:00.000Z' })]));
  assert.equal((await sync(second)).code, 200);
  const now = await saved(finn);
  assert.deepEqual(now.answers.map((a) => [a.id, a.value]), [[kernelQuestionId(words, 'radio'), 'Yes']], 'the newer answer replaced the older, and the earlier one did not');
  assert.ok(now.undo, 'with Undo');
  const runs = JSON.parse(fs.readFileSync(path.join(finn.dir, 'apply-runs.json'), 'utf8')).runs;
  assert.deepEqual(runs[earlier.run.id].keptCards.map((c) => c.result), ['skipped'], 'the earlier attempt was read');
  const undone = await h.call('POST', '/saved-answers', { revision: now.revision, undo: now.undo }, finn.sub);
  assert.equal(undone.code, 200, JSON.stringify(undone.body));
  assert.deepEqual(undone.body.answers.map((a) => a.value), ['No'], 'Undo puts the older answer back');
});

test('only the person’s own run, and only the cards of this run he said Keep on', async () => {
  const gail = h.person('gail-bank'), other = h.person('hal-bank'), s = await start(gail);
  const mine = card(s, 'Do you have a valid driver’s license?', 'radio', 'Yes');
  const elsewhere = card(s, 'Can you work weekends?', 'radio', 'Yes'), foreign = kernelCardId('c3000000-0000-0000-0000-000000000001', elsewhere.questionId);
  const monthWords = 'In which month of 2012 did you start as Administrative Assistant at Northwind Traders?';
  const month = { text: monthWords, answer: 'May', keep: true, card: kernelCardId(s.run.id, kernelQuestionId(monthWords, 'listbox')), page: 'my experience' };
  ended(s, { reason: REASON,
    questions: [mine.question, { ...elsewhere.question, card: foreign, from: 'card:' + foreign }, { ...month, from: 'card:' + month.card }],
    changes: [mine.change, elsewhere.change, { page: 'My Experience', label: 'From', group: 'Work Experience 3', before: '', after: '05/2012', from: 'card:role.3.start', at: '2026-11-21T10:06:00.000Z' }] });
  const record = fs.readFileSync(path.join(gail.dir, 'career_db.json'), 'utf8');
  assert.equal((await sync(s, other.sub)).code, 404, 'another person cannot read his run');
  assert.deepEqual((await saved(other)).answers, [], 'and banks nothing into his own answers');
  assert.equal(fs.existsSync(path.join(gail.dir, 'apply_profile.json')), false, 'nor into the person’s');
  const synced = await sync(s);
  assert.equal(synced.code, 200, JSON.stringify(synced.body));
  assert.deepEqual((await saved(gail)).answers.map((a) => [a.id, a.value]), [[mine.questionId, 'Yes']], 'only this run’s card, not another run’s, not a month');
  assert.deepEqual(synced.body.run.keptCards.map((c) => c.card), [mine.card]);
  assert.equal(fs.readFileSync(path.join(gail.dir, 'career_db.json'), 'utf8'), record, 'a month card changes no role here');
  assert.equal(h.engineCalls.filter((c) => c.sub === gail.sub).length, 0, 'no main-résumé edit');
  // A result for other input than the approved one banks nothing.
  h.job(gail.sub, 8);
  const t = await start(gail, 8);
  ended(t, data([card(t, 'Are you over 18?', 'radio', 'Yes')]));
  accepted(t, 'not_seen', data([card(t, 'Are you over 18?', 'radio', 'Yes')]), '0'.repeat(64));
  assert.equal((await sync(t)).body.code, 'result_mismatch');
  assert.deepEqual((await saved(gail)).answers.map((a) => a.id), [mine.questionId]);
});

test('banking writes only the kept answers list: standing self-identification answers and the Attestations stay; a full list keeps the run’s end', async () => {
  const ivy = h.person('ivy-bank'), s = await start(ivy);
  const gender = card(s, 'Gender', 'listbox', 'Decline to self-identify'), consent = card(s, 'I certify that the information I have provided is accurate', 'checkbox', 'Yes');
  ended(s, data([gender, consent]));
  assert.equal((await sync(s)).code, 200);
  const now = await saved(ivy);
  assert.deepEqual(now.answers.map((a) => [a.id, a.value]), [[gender.questionId, 'Decline to self-identify'], [consent.questionId, 'Yes']]);
  assert.deepEqual([now.standing.gender, now.standing.hispanicLatino, now.standing.race, now.standing.veteranStatus, now.standing.disabilityStatus], ['', '', '', '', ''],
    'no standing self-identification answer is set from a card');
  assert.deepEqual(now.attest, { terms: false, selfIdSignature: false }, 'and no attestation is switched on');
  h.job(ivy.sub, 8);
  const review = (await h.call('GET', '/apply-review/8', null, ivy.sub)).body;
  assert.equal(review.facts.some((f) => f.slot.startsWith('selfid.')), false, 'the next packet gains no self-identification fact');
  assert.deepEqual(review.attest, { terms: false, selfIdSignature: false });
  // Saved answers hold 200 answers: the run's end is still kept, nothing more is saved, and the card is left for the job page.
  const jo = h.person('jo-bank'), f = await start(jo);
  answers.keep(jo.dir, Array.from({ length: 200 }, (_, i) => ({ questionId: answers.questionId('Question ' + i, 'text'), question: 'Question ' + i, value: 'Answer ' + i, answeredAt: '2026-11-20T00:00:00.000Z' })));
  ended(f, data([card(f, 'One more question?', 'text', 'Yes')]));
  const synced = await sync(f);
  assert.equal(synced.code, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.run.status, 'not_seen', 'the run’s end is kept');
  assert.equal(answers.read(jo.dir).answers.length, 200, 'nothing more is saved');
  assert.deepEqual(synced.body.run.keptCards, [], 'the card is left for the job page');
});

test('an attempt that ended before Career banked by itself is read once at the next sync of any of his runs', async () => {
  const kim = h.person('kim-bank'), words = 'Have you worked for this company before?';
  h.job(kim.sub, 8); h.job(kim.sub, 9);
  const old = await start(kim, 7), kept = card(old, words, 'radio', 'No');
  endedBefore(old, data([kept]));
  const gone = await start(kim, 9);
  endedBefore(gone, data([]));
  const watch = watchAccepted(new Set([gone.workId]));
  try {
    const live = await start(kim, 8);
    h.port.rows = [{ id: live.workId, state: 'running', executor: 'orbit-apply-v1', apply: { attempt: 1, state: 'filling', page: { label: 'My Information' } } }];
    const synced = await sync(live);
    assert.equal(synced.code, 200, JSON.stringify(synced.body));
    assert.deepEqual([synced.body.run.status, synced.body.run.live.line], ['running', 'My Information'], 'the run being read reads as before');
    assert.deepEqual((await saved(kim)).answers.map((a) => [a.id, a.value]), [[kept.questionId, 'No']], 'the earlier attempt’s kept answer is banked');
    // He removes it on Saved answers: no later sync puts it back, and neither earlier attempt is asked for again.
    const now = await saved(kim);
    assert.equal((await h.call('POST', '/saved-answers', { revision: now.revision, remove: kept.questionId }, kim.sub)).code, 200);
    assert.equal((await sync(live)).code, 200); assert.equal((await sync(live)).code, 200);
    assert.deepEqual((await saved(kim)).answers, []);
    assert.deepEqual([watch.calls.get(old.workId), watch.calls.get(gone.workId)], [1, 1], 'each earlier attempt is read once, the one the kernel no longer answers too');
  } finally { watch.restore(); }
});
