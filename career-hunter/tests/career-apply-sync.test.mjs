/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (Fill it in on my Chrome): what Career does with the kernel's record of an assisted application, through the real routes on a made-up person's real store. A run in progress reads as one line (Waiting for your computer, My Experience: 2 fixed, 1 added, Waiting for you to sign in, Ready for you to submit). What the person kept on a question card (the kernel card route's kept entries, as his page hands them to POST /apply-runs/:id/kept) is written back by Career's own writers: an answer into Saved answers by its question id, a month (May, 02/2016) into that role through the real engine's revision-checked main-résumé edit and only where the record held that year alone; another run's entries and another person write nothing. An ended attempt keeps its pictures only when each matches the kernel's digest, writes apply-receipt.json in the job's folder with every change and its source, and records Submitted by you only with the verified confirmation; a mismatched result, changed pictures, Not seen and Stop record nothing; another person reads nothing.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { applyHarness } from './helpers/career-apply-fixture.mjs';

const require = createRequire(import.meta.url);
const answers = require('../lib/career-apply-answers'), packet = require('../lib/career-apply-packet');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const png = (label) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(label)]);
const card = () => 'apply-' + crypto.randomBytes(16).toString('hex');
let h;
before(async () => { h = await applyHarness(); });
after(async () => { await h?.stop(); });

/** Approve, bind and start one run for a person; answers what the kernel would be holding. */
async function started(name) {
  const person = h.person(name), { body } = await h.call('GET', '/apply-review/7', null, person.sub);
  const run = (await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest, approved: true }, person.sub)).body.run;
  await h.call('POST', `/apply-runs/${run.id}/bind`, {}, person.sub);
  await h.call('POST', `/apply-runs/${run.id}/start`, {}, person.sub);
  const workId = 'b2000000-0000-0000-0000-00000000000' + h.port.started.length;
  const input = JSON.parse(fs.readFileSync(path.join(person.dir, `apply-${run.id}-1.json`), 'utf8'));
  const sync = () => h.call('POST', `/apply-runs/${run.id}/sync`, {}, person.sub);
  const live = (state, apply) => { h.port.rows = [{ id: workId, state, executor: 'orbit-apply-v1', apply }]; return sync(); };
  return { person, run, workId, input, sync, live };
}
function end(s, outcome, data) {
  h.port.rows = [{ id: s.workId, state: 'completed', executor: 'orbit-apply-v1' }];
  h.port.accepted.set(s.workId, { version: 2, intentId: s.run.id, attempt: 1, requestDigest: s.input.requestDigest, outcome, data });
}
function picture(s, name, bytes) { h.port.artifacts.set(s.workId + '/' + name, { name, sha256: sha(bytes), byteLength: bytes.length, base64: bytes.toString('base64') }); return { artifact: name, sha256: sha(bytes) }; }

test('a run in progress reads as one line the job page shows', async () => {
  const s = await started('dana-live');
  assert.equal((await s.live('queued', {})).body.run.live.line, 'Waiting for your computer');
  const filling = (await s.live('running', { attempt: 1, state: 'filling', page: { kind: 'experience', label: 'My Experience' },
    pages: [{ label: 'My Information', fixed: 3 }, { label: 'My Experience', fixed: 2, added: 1 }] })).body.run;
  assert.deepEqual([filling.status, filling.live.line, filling.live.pages], ['running', 'My Experience', ['My Information: 3 fixed', 'My Experience: 2 fixed, 1 added']]);
  const words = 'Sign in to this employer’s site in the Chrome window Career opened, or create your account there. Career goes on when you are in.';
  const waiting = (await s.live('running', { attempt: 1, state: 'waiting_for_you', reason: { kind: 'sign-in', text: words } })).body.run;
  assert.deepEqual([waiting.status, waiting.live.line, waiting.live.reason], ['waiting', 'Waiting for you to sign in', { kind: 'sign-in', text: words }]);
  assert.equal((await s.live('running', { attempt: 1, state: 'ready' })).body.run.live.line, 'Ready for you to submit');
});

test('what the person kept on a card is written back by Career’s own writers: an answer by its id, a month only over a year alone', async () => {
  const s = await started('dana-kept'), question = 'Will you now or in the future require sponsorship?', id = answers.questionId(question, 'listbox');
  const entry = (extra) => ({ id: card(), run: s.run.id, answeredAt: '2026-11-21T10:05:00Z', option: null, ...extra });
  const kept = [
    entry({ questionId: id, question, value: 'No', option: 1 }),
    entry({ questionId: 'question:' + 'a'.repeat(64), question: 'From (Work Experience 3)', value: 'May', slot: 'role.3.start' }),
    entry({ questionId: 'question:' + 'b'.repeat(64), question: 'From (Work Experience 1)', value: 'July', slot: 'role.1.start' }),
    entry({ questionId: 'question:' + 'c'.repeat(64), question: 'To (Work Experience 3)', value: '02/2016', slot: 'role.3.end' }),
    entry({ questionId: 'not-an-id', question: 'Desired salary', value: '1' }),
    { ...entry({ questionId: 'question:' + 'd'.repeat(64), question: 'Another run', value: 'Yes' }), run: 'c3000000-0000-0000-0000-000000000001' },
  ];
  const before = JSON.parse(fs.readFileSync(path.join(s.person.dir, 'career_db.json'), 'utf8'));
  assert.equal((await h.call('POST', `/apply-runs/${s.run.id}/kept`, { kept }, 'nobody-else')).code, 404, 'another person writes nothing');
  assert.equal((await h.call('POST', `/apply-runs/${s.run.id}/kept`, { kept, extra: 1 }, s.person.sub)).code, 400);
  const done = await h.call('POST', `/apply-runs/${s.run.id}/kept`, { kept }, s.person.sub);
  assert.equal(done.code, 200, JSON.stringify(done.body));
  const saved = (await h.call('GET', '/saved-answers', null, s.person.sub)).body;
  assert.deepEqual(saved.answers.map((a) => [a.id, a.text, a.value, a.source]), [[id, question, 'No', 'card']], 'only this run’s kept answer, by its question id');
  const after = JSON.parse(fs.readFileSync(path.join(s.person.dir, 'career_db.json'), 'utf8'));
  assert.equal(after.roles[2].start, '2012-05', 'the year-only start took the month he gave (May)');
  assert.equal(after.roles[2].end, '2015', 'a month in another year is not written');
  assert.equal(after.roles[0].start, before.roles[0].start, 'a recorded month is never replaced');
  assert.deepEqual(after.roles.filter((_, i) => i !== 2), before.roles.filter((_, i) => i !== 2));
  assert.ok(fs.readdirSync(path.join(s.person.dir, 'backups')).length >= 1, 'the engine kept a backup, so Undo works');
  assert.equal(h.engineCalls.filter((c) => c.sub === s.person.sub).length, 1, 'one main-résumé edit, the engine’s own');
  assert.deepEqual(done.body.run.keptCards.map((c) => [c.kind, c.result]), [['answer', 'kept'], ['month', 'kept'], ['month', 'skipped'], ['month', 'skipped'], ['answer', 'skipped']]);
  await h.call('POST', `/apply-runs/${s.run.id}/kept`, { kept }, s.person.sub);
  assert.equal(h.engineCalls.filter((c) => c.sub === s.person.sub).length, 1, 'a card listed again is handled once');
  const next = packet.packetRoles(JSON.parse(fs.readFileSync(path.join(s.person.folder, 'application.json'), 'utf8')).generated.resume, after);
  assert.equal(next.roles[2].start, '2012-05', 'the next packet carries the kept month');
  assert.deepEqual(packet.answers(saved.answers).map((a) => a.value), ['No'], 'and the kept answer');
});

test('an ended attempt keeps verified pictures, writes the receipt, and records Submitted by you only with the confirmation', async () => {
  const s = await started('dana-submitted'), page = picture(s, 'page-1.png', png('my information')), review = picture(s, 'review-1.png', png('review'));
  const confirmation = picture(s, 'confirmation.png', png('thank you'));
  const data = { reason: 'The employer’s confirmation was seen.',
    uploads: [{ document: 'resume-docx', field: 'Upload either DOC, DOCX, HTML, PDF, or TXT file types', page: 'Autofill with Resume', name: 'Example Freight Co - Office Manager - Job 7 - Resume.docx', size: 40, sha256: s.input.task.documents[0].sha256 }],
    changes: [{ page: 'My Experience', label: 'Job Title', group: 'Work Experience 1', before: 'Office Mgr', after: 'Office Manager', from: 'role:1.title' },
      { page: 'My Experience', label: 'From', group: 'Work Experience 3', before: '', after: '05/2012', from: 'card:month' },
      { page: 'Application Questions', label: 'Will you require sponsorship?', group: '', before: 'Select One', after: 'No', from: 'answer:saved' }],
    questions: [{ text: 'Will you require sponsorship?', answer: 'No', from: 'saved answer' }],
    handBacks: [{ reason: 'sign-in', text: 'Sign in to this employer’s site.', at: '2026-11-21T10:00:00Z', endedAt: '2026-11-21T10:02:00Z' }],
    pictures: [{ ...page, page: 'My Information', at: '2026-11-21T10:03:00Z' }, { ...review, page: 'Review', at: '2026-11-21T10:09:00Z' }],
    confirmation: { ...confirmation, text: 'Thank you for applying' }, kept: [] };
  end(s, 'submitted_by_you', data);
  const synced = await s.sync();
  assert.equal(synced.code, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.run.status, 'submitted');
  const job = s.person.signal();
  assert.deepEqual([job.status, job.application_source], ['applied', 'verified-submission']);
  assert.equal(sha(fs.readFileSync(job.confirmation_path)), confirmation.sha256);
  const receipt = JSON.parse(fs.readFileSync(path.join(s.person.folder, 'apply-receipt.json'), 'utf8'));
  assert.equal(receipt.runId, s.run.id);
  assert.deepEqual(receipt.attempts[0].documents.map((d) => [d.id, d.sha256]), s.input.task.documents.map((d) => [d.id, d.sha256]));
  assert.deepEqual(receipt.attempts[0].changes.map((c) => c.from), ['role:1.title', 'card:month', 'answer:saved']);
  assert.deepEqual(receipt.attempts[0].pictures.map((p) => p.sha256), [page.sha256, review.sha256]);
  assert.deepEqual((await h.call('GET', `/apply-runs/${s.run.id}/receipt`, null, s.person.sub)).body, receipt);
  const kept = await h.raw('GET', `/apply-runs/${s.run.id}/picture/1/2`, null, s.person.sub);
  assert.equal(kept.status, 200);
  assert.equal(sha(Buffer.from(await kept.arrayBuffer())), review.sha256);
  assert.equal((await h.raw('GET', `/apply-runs/${s.run.id}/confirmation`, null, s.person.sub)).status, 200);
  assert.equal((await h.raw('GET', `/apply-runs/${s.run.id}/picture/1/2`, null, 'nobody-else')).status, 404, 'another person reads nothing');
  fs.writeFileSync(path.join(s.person.dir, synced.body.run.pictures[1].file), png('changed'));
  assert.equal((await h.raw('GET', `/apply-runs/${s.run.id}/picture/1/2`, null, s.person.sub)).status, 409, 'a changed picture is refused');
});

test('a changed picture or a result for other input records nothing; Not seen and Stop record nothing', async () => {
  const s = await started('dana-mismatch'), good = picture(s, 'page-1.png', png('page'));
  end(s, 'submitted_by_you', { pictures: [{ ...good, sha256: sha(png('other')) }], confirmation: { ...picture(s, 'confirmation.png', png('ok')), text: 'Thank you' } });
  assert.equal((await s.sync()).body.code, 'evidence_invalid');
  assert.equal(s.person.signal().status, 'generated', 'nothing recorded');
  h.port.accepted.set(s.workId, { ...h.port.accepted.get(s.workId), requestDigest: '0'.repeat(64) });
  assert.equal((await s.sync()).body.code, 'result_mismatch');
  const n = await started('dana-not-seen');
  end(n, 'not_seen', { reason: 'Not seen yet; mark it applied when you have.' });
  const notSeen = (await n.sync()).body.run;
  assert.deepEqual([notSeen.status, notSeen.reason, n.person.signal().status], ['not_seen', 'Not seen yet; mark it applied when you have.', 'generated']);
  const stop = await started('dana-stop');
  h.port.rows = [{ id: stop.workId, state: 'cancelled', executor: 'orbit-apply-v1' }];
  const stopped = (await stop.sync()).body.run;
  assert.deepEqual([stopped.status, stopped.reason], ['stopped', 'You stopped it. Nothing was submitted.']);
  assert.equal((await h.call('POST', `/apply-runs/${stop.run.id}/go-on`, {}, stop.person.sub)).body.code, 'run_not_paused', 'a stopped run does not start again');
});
