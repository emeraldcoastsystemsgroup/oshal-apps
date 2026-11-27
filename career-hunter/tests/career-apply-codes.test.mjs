/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The smart build (design apply-smart-design-2026-11-26, section 2.4 and guard I3): the lookup of one verification code in the person's own mailbox, POST /apply-code, over a made-up person's real store and Career's real routes, against a stand-in Gmail behind the injected fetcher (never a real mailbox). Proved: it makes only the listed Gmail GETs (profile, one list, at most three messages in full) and requires nothing that could ask a model; the list query is bounded by the moment the code was asked for and by the approved senders, and Career checks each message's time and sender domain again itself (a subdomain is the sender, a name that only ends the same is not, a message from before is not used, and a request cannot name senders or reach before the approval); the code is taken by the two closed patterns and an ordinary word is never one; two different codes are ambiguous; a mailbox that is not the application's email, a refused or unreachable mailbox are unavailable; with the switch off, for a run that is not his, not being filled in or of another attempt, nothing is read; the code is in no log line; and the route answers only the kernel's own run, never a browser.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { applyHarness } from './helpers/career-apply-fixture.mjs';

const require = createRequire(import.meta.url);
const codes = require('../lib/career-apply-codes'), runs = require('../lib/career-apply-runs');
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const SITE = 'no-reply@myworkdayjobs.com', CODE = '482913';
let h;
before(async () => { h = await applyHarness(); });
after(async () => { await h?.stop(); });

const b64 = (text) => Buffer.from(text).toString('base64url');
/** One message as Gmail's full format gives it: plain text, or HTML when the text begins with a tag. */
function message(id, at, from, subject, text) {
  const html = /^\s*</.test(text);
  return { id, threadId: 't' + id, internalDate: String(at), snippet: '', payload: { mimeType: 'multipart/alternative',
    headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }],
    parts: [{ mimeType: html ? 'text/html' : 'text/plain', body: { data: b64(text) } }] } };
}
/**
 * A stand-in Gmail behind the fetcher: the mailbox's address, its messages, and every request it was sent. Its search
 * is as loose as a mailbox search is (a sender matches when its address holds one of the words), so the checks proved
 * here are Career's own.
 */
function gmail(address, messages, fail = {}) {
  const requests = [];
  const fetcher = async (url, init = {}) => {
    requests.push({ method: init.method, url: String(url) });
    if (fail.throws) throw Error('gmail is not connected: connect your own gmail account on Utilities');
    if (fail.status) return new Response('{}', { status: fail.status });
    const path = String(url).slice(GMAIL.length), json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (!String(url).startsWith(GMAIL)) return new Response('', { status: 404 });
    if (path === 'profile') return json({ emailAddress: address });
    if (path.startsWith('messages?')) {
      const asked = new URLSearchParams(path.slice(9)), q = asked.get('q'), after = Number(/after:(\d+)/.exec(q)[1]), words = /from:\(([^)]*)\)/.exec(q)[1].split(' OR ');
      const found = messages.filter((m) => Number(m.internalDate) / 1000 >= after && words.some((word) => m.payload.headers[0].value.toLowerCase().includes(word)))
        .sort((a, b) => Number(b.internalDate) - Number(a.internalDate)).slice(0, Number(asked.get('maxResults')));
      return json({ messages: found.map((m) => ({ id: m.id, threadId: m.threadId })) });
    }
    const one = /^messages\/([^?]+)\?format=full$/.exec(path), held = one && messages.find((m) => m.id === decodeURIComponent(one[1]));
    return held ? json(held) : new Response('{}', { status: 404 });
  };
  return { fetcher, requests };
}
/** A made-up person with one approved, started run of job 7 on the Workday stand-in address; its switches as given. */
async function started(sub, help) {
  const dana = h.person(sub);
  if (help) {
    const read = (await h.call('GET', '/saved-answers', null, sub)).body;
    assert.equal((await h.call('POST', '/saved-answers', { revision: read.revision, help }, sub)).code, 200);
  }
  const review = await h.call('GET', '/apply-review/7', null, sub);
  const approved = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: review.body.packetDigest, approved: true }, sub);
  assert.equal(approved.code, 200, JSON.stringify(approved.body));
  const id = approved.body.run.id;
  assert.equal((await h.call('POST', `/apply-runs/${id}/bind`, {}, sub)).code, 200);
  assert.equal((await h.call('POST', `/apply-runs/${id}/start`, {}, sub)).code, 200);
  return { ...dana, sub, id, approvedAt: Date.parse(runs.get(dana.dir, id).approvedAt) };
}
const ask = (run, since, extra = {}) => ({ intentId: run.id, attempt: 1, since, ...extra });

test('the lookup makes only the listed Gmail GETs, asks no model, and answers the code with its sender and time; the code is in no log line', async () => {
  const run = await started('dana-code-found'), since = run.approvedAt + 1000, at = since + 30000;
  const box = gmail('Dana@Example.test', [
    message('m-old', run.approvedAt - 600000, SITE, 'Your verification code', 'Your verification code is 111111.'),
    message('m-other', at + 5000, 'codes@elsewhere.example', 'Your code', 'Your code is 222222.'),
    message('m-fake', at + 4000, 'x@myworkdayjobs.com.evil.test', 'Your code', 'Your code is 333333.'),
    message('m-new', at, `Example Careers <${SITE}>`, 'Verify your email', `Hello Dana,\n\nYour verification code is ${CODE}.\nIt expires in 10 minutes.`)]);
  const log = [];
  const answer = await codes.lookup(run.dir, ask(run, since), { fetcher: box.fetcher, log: (note) => log.push(note) });
  assert.deepEqual(answer, { status: 'found', code: CODE, from: SITE, at, messageId: 'm-new' });
  // I3: only GETs to Gmail, and exactly these: the mailbox's address, one bounded list, then messages in full.
  assert.ok(box.requests.every((r) => r.method === 'GET' && r.url.startsWith(GMAIL)), JSON.stringify(box.requests));
  const [profile, list, ...reads] = box.requests.map((r) => r.url.slice(GMAIL.length));
  assert.equal(profile, 'profile');
  const asked = new URLSearchParams(list.replace(/^messages\?/, ''));
  assert.deepEqual([...asked.keys()], ['maxResults', 'q']);
  assert.deepEqual([asked.get('maxResults'), asked.get('q')], ['5', `after:${Math.floor(since / 1000)} from:(myworkdayjobs.com)`], 'bounded by the asked moment and the approved senders');
  assert.ok(reads.length >= 1 && reads.length <= 3 && reads.every((path) => /^messages\/[A-Za-z0-9_-]+\?format=full$/.test(path)), reads.join(' '));
  const required = [...fs.readFileSync(new URL('../lib/career-apply-codes.js', import.meta.url), 'utf8').matchAll(/require\('([^']+)'\)/g)].map((found) => found[1]);
  assert.deepEqual(required, ['./career-apply-runs', './career-apply-help'], 'it requires nothing that could ask a model');
  // What is noted is the run, the status, the sender's domain and the message's time. Never the code.
  assert.deepEqual(log, [{ run: run.id, attempt: 1, status: 'found', domain: 'myworkdayjobs.com', at: new Date(at).toISOString() }]);
  assert.equal(JSON.stringify(log).includes(CODE), false);
});

test('the code is taken by the two closed patterns, and an ordinary word is never a code', () => {
  const of = (subject, text) => codes.candidates(codes.wordsOf(message('m', 1, SITE, subject, text)));
  for (const [subject, text, wanted] of [
    ['Your verification code', 'Your verification code is 482913.', ['482913']],
    ['Verify your email', 'Enter this code to verify your email: K7Q2M9XD', ['K7Q2M9XD']],
    ['Your code: 904417', 'Thanks for applying.', ['904417']],
    ['Sign in', '<html><head><style>.code{font-size:14px;color:#333333}</style></head><body><p>Use this passcode:</p><h1>5512</h1><p>It expires soon.</p></body></html>', ['5512']],
    ['Sign in', '<p>Your PIN</p><div><b>220581</b></div>', ['220581']],
    ['Confirm it is you', 'Hello Dana,\n\n   731204   \n\nType it on the page you left open.', ['731204']],
    ['Confirm it is you', 'Hello Dana,\nQWERTYUP\nThanks', ['QWERTYUP']],
    ['Your code', 'Your code is 111222. This code expires in 10 minutes. Your code is 111222.', ['111222']],
    ['Your code', 'Your code is 111222. If the page asks again, use code 333444.', ['111222', '333444']],
    ['Thanks for applying', 'We will be in touch. Please read our code of conduct before your interview.', []],
    ['Your code', 'The code you asked for is in the message we sent you earlier this week, which also holds 482913.', []],
    ['Welcome', 'Hello Dana,\nWelcome\nThanks,\nExample', []],
    ['Your code', 'Your code is 123. Or 12345678901.', []],
  ]) assert.deepEqual(of(subject, text), wanted, `${subject} / ${text}`);
  for (const token of ['482913', 'K7Q2M9XD', 'a1b2', 'QWERTY']) assert.equal(codes.isCode(token), true, token);
  for (const token of ['123', '12345678901', 'verify', 'Welcome', 'ABCDE', '12 34', 'ab-12']) assert.equal(codes.isCode(token), false, token);
  const long = '<p>' + 'x'.repeat(30000) + ' Your code is 482913</p>';
  assert.deepEqual(of('Notice', long), [], 'only the first 24,000 characters are read');
});

test('Career checks each message’s time and sender itself; a request names neither senders nor a moment before the approval', async () => {
  const run = await started('dana-code-bounds'), since = run.approvedAt + 1000, text = `Your verification code is ${CODE}.`;
  const none = async (messages, body = ask(run, since)) => {
    const box = gmail('dana@example.test', messages), answer = await codes.lookup(run.dir, body, { fetcher: box.fetcher });
    return { answer, requests: box.requests };
  };
  assert.equal((await none([message('a', since - 1, SITE, 'Code', text)])).answer.status, 'none', 'a message from before the code was asked for');
  assert.equal((await none([message('b', since + 9, 'a@notmyworkdayjobs.com', 'Code', text)])).answer.status, 'none', 'a name that only ends the same');
  assert.equal((await none([message('c', since + 9, 'Example <a@myworkdayjobs.com.evil.test>', 'Code', text)])).answer.status, 'none');
  assert.equal((await none([message('d', since + 9, 'no address here', 'Code', text)])).answer.status, 'none');
  const sub = await none([message('e', since + 9, 'Example Careers <No-Reply@Mail.MyWorkdayJobs.com>', 'Code', text)]);
  assert.deepEqual([sub.answer.status, sub.answer.code, sub.answer.from], ['found', CODE, 'no-reply@mail.myworkdayjobs.com'], 'a subdomain of an approved sender is that sender');
  // A message that holds no code is passed over for an older one that does, still within the bounds.
  const two = await none([message('f', since + 20, SITE, 'Welcome', 'Thanks for starting your application.'), message('g', since + 10, SITE, 'Code', text)]);
  assert.deepEqual([two.answer.status, two.answer.messageId], ['found', 'g']);
  const both = await none([message('h', since + 10, SITE, 'Codes', 'Your code is 111222. Or use code 333444.')]);
  assert.deepEqual([both.answer.status, 'code' in both.answer], ['ambiguous', false]);
  // The moment is never before the approval, whatever the request says.
  const early = await none([message('i', run.approvedAt - 5000, SITE, 'Code', text)], ask(run, run.approvedAt - 86400000));
  assert.equal(early.answer.status, 'none');
  assert.match(decodeURIComponent(early.requests[1].url), new RegExp(`after:${Math.floor(run.approvedAt / 1000)} `));
  // The senders come from the approved input: a request that names any is refused, and nothing is read.
  for (const body of [ask(run, since, { senders: ['elsewhere.example'] }), ask(run, since, { q: 'from:anyone' }), { intentId: run.id, attempt: 1 }, { intentId: run.id, attempt: '1', since }, ask(run, 'now')]) {
    const refused = await none([message('j', since + 9, 'a@elsewhere.example', 'Code', text)], body);
    assert.deepEqual([refused.answer.status, refused.requests.length], ['off', 0], JSON.stringify(body));
  }
});

test('a mailbox that is not the application’s email, a refused one and an unreachable one are unavailable', async () => {
  const run = await started('dana-code-mailbox'), since = run.approvedAt + 1000, mail = [message('a', since + 9, SITE, 'Code', `Your code is ${CODE}.`)];
  const other = gmail('someone.else@example.test', mail);
  const wrong = await codes.lookup(run.dir, ask(run, since), { fetcher: other.fetcher });
  assert.deepEqual(wrong, { status: 'unavailable', why: 'The connected Gmail mailbox is not the email on this application, so Career did not read it.' });
  assert.deepEqual(other.requests.map((r) => r.url.slice(GMAIL.length)), ['profile'], 'nothing of that mailbox was read');
  for (const [fail, words] of [[{ status: 401 }, /^Connect the Gmail account you apply with, with mail read access, in Connections\.$/], [{ status: 403 }, /^Connect the Gmail account/],
    [{ status: 500 }, /^Your mailbox could not be read \(HTTP 500\)\.$/], [{ throws: true }, /^Your mailbox could not be read\. Connect the Gmail account/]]) {
    const answer = await codes.lookup(run.dir, ask(run, since), { fetcher: gmail('dana@example.test', mail, fail).fetcher });
    assert.equal(answer.status, 'unavailable', JSON.stringify(fail));
    assert.match(answer.why, words);
    assert.equal(/gmail is not connected|Utilities/.test(answer.why), false, 'the kernel’s own refusal words are not passed on');
  }
});

test('with the switch off, and for a run that is not his, not being filled in or of another attempt, nothing is read', async () => {
  const off = await started('dana-code-off', { mailCodes: false }), on = await started('dana-code-on'), since = on.approvedAt + 1000;
  const mail = [message('a', since + 9, SITE, 'Code', `Your code is ${CODE}.`)];
  const frozen = JSON.parse(fs.readFileSync(`${off.dir}/apply-${off.id}-1.json`, 'utf8'));
  assert.equal(frozen.task.assist.mailCodes, null, 'his approved input says no mail codes');
  for (const [dir, body, why] of [[off.dir, ask(off, since), /does not let Career read a code from your mail/], [on.dir, ask(off, since), /not being filled in now/],
    [on.dir, { intentId: '00000000-0000-4000-8000-000000000000', attempt: 1, since }, /not being filled in now/], [on.dir, { ...ask(on, since), attempt: 2 }, /not being filled in now/]]) {
    const box = gmail('dana@example.test', mail), answer = await codes.lookup(dir, body, { fetcher: box.fetcher });
    assert.deepEqual([answer.status, box.requests.length], ['off', 0], JSON.stringify(body));
    assert.match(answer.why, why);
  }
  // Once the run has ended or is paused, its approval reads no more mail; an approval past its day does not either.
  for (const status of ['paused', 'stopped']) {
    runs.update(on.dir, on.id, { status });
    const box = gmail('dana@example.test', mail);
    assert.deepEqual([(await codes.lookup(on.dir, ask(on, since), { fetcher: box.fetcher })).status, box.requests.length], ['off', 0], status);
  }
  const later = await started('dana-code-expired'), box = gmail('dana@example.test', mail);
  const expired = await codes.lookup(later.dir, ask(later, since), { fetcher: box.fetcher, now: later.approvedAt + 25 * 60 * 60 * 1000 });
  assert.deepEqual([expired.status, box.requests.length], ['off', 0]);
});

test('the route answers only the kernel’s own run: a browser is refused before anything is read, and no person is no one', async () => {
  const run = await started('dana-code-route'), since = run.approvedAt + 1000, at = since + 9;
  const box = gmail('dana@example.test', [message('a', at, SITE, 'Code', `Your verification code is ${CODE}.`)]), real = globalThis.fetch;
  const post = (headers, body = ask(run, since)) => real(h.origin + '/api/career-hunter/apply-code', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  globalThis.fetch = (url, init) => (String(url).startsWith(GMAIL) ? box.fetcher(url, init) : real(url, init));
  try {
    const browser = await post({ 'x-test-person': run.sub });
    assert.equal(browser.status, 403);
    assert.deepEqual(await browser.json(), { error: 'Only Career’s own run of an application you approved reads a code from your mail.', code: 'not_the_run' });
    assert.equal((await post({ 'x-test-person': run.sub, 'x-oshal-trigger': 'schedule' })).status, 403, 'another kind of kernel call is not the run');
    assert.equal(box.requests.length, 0, 'a browser’s request reads nothing');
    assert.equal((await post({ 'x-oshal-trigger': 'apply-run' })).status, 401, 'no person');
    const stranger = await post({ 'x-test-person': 'someone-else', 'x-oshal-trigger': 'apply-run' });
    assert.deepEqual([stranger.status, (await stranger.json()).status, box.requests.length], [200, 'off', 0], 'another person’s run is not his');
    const answered = await post({ 'x-test-person': run.sub, 'x-oshal-trigger': 'apply-run' });
    assert.equal(answered.status, 200);
    assert.equal(answered.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await answered.json(), { status: 'found', code: CODE, from: SITE, at, messageId: 'a' }, 'the closed answer the kernel checks');
  } finally { globalThis.fetch = real; }
});
