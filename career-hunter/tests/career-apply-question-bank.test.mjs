/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0 (design career-self-improving-applications-2026-11-27 part 3): lib/career-apply-question-bank.js on a made-up person's real store folder. Proved: the questions the job on the computer waits on are recovered from the kernel's work record as Career keeps it (the waiting words and the open card ids), each under the exact question id whose card id the kernel derives from that run, a question whose words hold " / " included, and nothing a card id does not confirm; questions are kept once each with their longest options and the jobs they stopped; the answers the record gives them skip what Saved answers already answer, give an option's exact words, and leave a bot check and an unsettled question out; the cards a page reads are answered only when they are this run's.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCompiledModules } from './helpers/career-route-harness.mjs';

let root, bank, ids, sync;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-question-bank-'));
  ({ modules: { bank, ids, sync } } = loadCompiledModules({ bank: 'lib/career-apply-question-bank.js', ids: 'lib/career-apply-answers.js', sync: 'lib/career-apply-sync.js' }));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const RUN = '11111111-2222-4333-8444-555555555555', OTHER_RUN = '99999999-2222-4333-8444-555555555555';
const AUTHORIZED = 'Are you legally authorized to work in the United States?', SHIFT = 'Which shift can you work: day / night?';
/** A made-up person whose record says yes to authorization and lives near the job. */
const PERSON = { facts: { 'name.first': 'Cleo' }, standing: { workAuthorization: 'Yes', sponsorship: 'No' }, saved: [], attest: {}, roles: [], education: [],
  recordText: '', home: { radiusMiles: 30 }, job: { company: 'Example Co', distanceMiles: 8 }, country: 'United States', today: '2026-11-27' };
const card = (run, text, kind) => sync.cardId(run, ids.questionId(text, kind));
const dir = (name) => { const folder = path.join(root, name); fs.mkdirSync(folder, { recursive: true }); return folder; };

test('the questions the job on the computer waits on are learned from the kernel\'s work record, each under the id its open card confirms', () => {
  const run = { id: RUN, postingId: 7, live: { reason: { kind: 'question', text: `Example Co asks you in Approvals: ${AUTHORIZED} / ${SHIFT}. Career types your answer in for you.` },
    cards: [card(RUN, AUTHORIZED, 'select'), card(RUN, SHIFT, 'radio')] } };
  assert.deepEqual(bank.waiting(run), [
    { id: ids.questionId(AUTHORIZED, 'select'), text: AUTHORIZED, type: 'select' },
    { id: ids.questionId(SHIFT, 'radio'), text: SHIFT, type: 'radio' }], 'both questions, the one whose words hold " / " whole');
  assert.deepEqual(bank.waiting({ ...run, live: { ...run.live, cards: [card(OTHER_RUN, AUTHORIZED, 'select')] } }), [], 'a card of another run confirms nothing');
  assert.deepEqual(bank.waiting({ ...run, live: { ...run.live, cards: [] } }), [], 'no open card: nothing is guessed');
  assert.deepEqual(bank.waiting({ ...run, live: { reason: { kind: 'sign-in', text: 'Waiting for you to sign in' }, cards: run.live.cards } }), []);
});

test('each question is kept once, with the longest options any card listed and the jobs it stopped', () => {
  const folder = dir('remember'), id = ids.questionId(AUTHORIZED, 'select');
  assert.equal(bank.remember(folder, [{ id, text: AUTHORIZED, type: 'select' }], 7), 1);
  assert.equal(bank.remember(folder, [{ id, text: AUTHORIZED, options: ['Yes', 'No'] }], 8), 1, 'options learned later, and another job');
  assert.equal(bank.remember(folder, [{ id, text: AUTHORIZED, options: ['Yes'] }], 8), 0, 'a shorter list and the same job change nothing');
  assert.equal(bank.remember(folder, [{ id: 'question:not-an-id', text: 'x' }, { id, text: '' }], 9), 0, 'a malformed entry is never kept');
  const [kept] = bank.read(folder).questions;
  assert.deepEqual({ id: kept.id, text: kept.text, type: kept.type, options: kept.options, jobs: kept.jobs }, { id, text: AUTHORIZED, type: 'select', options: ['Yes', 'No'], jobs: [7, 8] });
  assert.equal(bank.remember(folder, [{ id: ids.questionId(SHIFT, 'radio'), text: SHIFT }]), 1);
  assert.equal(bank.read(folder).questions[1].type, 'radio', 'a type not given is recovered from the id');
  assert.equal(fs.statSync(path.join(folder, bank.FILE)).mode & 0o777, 0o600, 'kept for the person only');
});

test('the record answers the kept questions for the next approval: an option\'s exact words, never what Saved answers already answer', () => {
  const folder = dir('answers'), authorized = ids.questionId(AUTHORIZED, 'select'), relocate = ids.questionId('Are you willing to relocate?', 'radio');
  const human = ids.questionId('What is 6 + 1?', 'text'), essay = ids.questionId('Tell us about yourself', 'textarea'), saved = ids.questionId('Will you require sponsorship?', 'select');
  bank.remember(folder, [{ id: authorized, text: AUTHORIZED, options: ['Yes, I am authorized', 'No, I am not authorized'] }, { id: relocate, text: 'Are you willing to relocate?' },
    { id: human, text: 'What is 6 + 1?' }, { id: essay, text: 'Tell us about yourself' }, { id: saved, text: 'Will you require sponsorship?', options: ['Yes', 'No'] }], 7);
  const out = bank.answersFor(folder, PERSON, new Set([saved]));
  assert.deepEqual(out.map(({ id, value, rule }) => [id, value, rule]), [
    [authorized, 'Yes, I am authorized', 'eligibility-authorized'],
    [relocate, 'Yes', 'location-relocation']], 'the bot check, the essay and the saved answer are left out');
  assert.deepEqual(bank.answersFor(folder, { ...PERSON, standing: { workAuthorization: 'No' } }, new Set()).find((item) => item.id === authorized)?.value, 'No, I am not authorized', 'another person\'s record answers the same question their way');
  assert.deepEqual(bank.answersFor(dir('none'), PERSON, new Set()), [], 'no kept questions, no answers');
});

test('the cards a page reads are kept and answered only when they are this run\'s', () => {
  const folder = dir('cards'), questionId = ids.questionId(AUTHORIZED, 'select'), mine = sync.cardId(RUN, questionId);
  const cards = [{ id: mine, questionId, question: AUTHORIZED, options: ['Yes', 'No'] },
    { id: sync.cardId(OTHER_RUN, questionId), questionId, question: AUTHORIZED, options: ['Yes', 'No'] },
    { id: sync.cardId(RUN, ids.questionId('What is 2 + 2?', 'text')), questionId: ids.questionId('What is 2 + 2?', 'text'), question: 'What is 2 + 2?', options: [] }];
  const out = bank.cardAnswers(folder, { id: RUN, postingId: 7 }, cards, PERSON);
  assert.deepEqual(out, [{ card: mine, option: 0, rule: 'eligibility-authorized' }], 'the other run\'s card and the bot check get nothing');
  assert.deepEqual(bank.read(folder).questions.map((item) => item.text).sort(), [AUTHORIZED, 'What is 2 + 2?'].sort(), 'this run\'s two questions are kept; the other run\'s card is not');
});
