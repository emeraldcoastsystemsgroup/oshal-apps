/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The smart build (design apply-smart-design-2026-11-26, section 2.0): What Career does by itself on an employer's site, as rules. The five switches are on unless kept off, and Create an account is off whenever Sign in is; a change takes only the five, each true or false, switches Create an account off with Sign in, and refuses it on without Sign in. What a run carries (task.assist) is the switches as the kernel takes them: nothing at all with every switch off; both sign-in switches off behind his other windows; mail codes as this application's own route and the only senders a code may come from (the approved site's own domain, then the job site's sending domains, plain host names, ten at most). The approval screen says each switch in one sentence and always that a check is his.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A run carries only the switches the kernel acts on: Remember each employer site and Look at the page before moving on are not available yet (NOT_YET), so they are off whatever is kept, a change that names one is refused, they are never kept, never in task.assist, and the approval screen says Career does neither. Red before: both started on and rode in every packet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const help = require('../lib/career-apply-help');
const FRONT = { window: 'foreground' }, BEHIND = { window: 'background' };
const WORKDAY = 'https://example.wd1.myworkdayjobs.com';

test('the switches the kernel acts on are on unless kept off, the two not available yet are always off, and Create an account is off whenever Sign in is', () => {
  const all = { siteMemory: false, screen: false, signIn: true, createAccount: true, mailCodes: true };
  assert.deepEqual(Object.keys(help.NOT_YET), ['siteMemory', 'screen'], 'site memory (lane A) and the screen loop (lane B) are not in the kernel yet');
  for (const raw of [undefined, null, {}, { apply_help: null }, { apply_help: [] }, { apply_help: { signIn: 'no', other: false } }]) assert.deepEqual(help.read(raw), all, JSON.stringify(raw));
  assert.deepEqual(help.read({ apply_help: { siteMemory: true, screen: true } }), all, 'a switch not available yet is off whatever is kept');
  assert.deepEqual(help.read({ apply_help: { mailCodes: false } }), { ...all, mailCodes: false });
  assert.deepEqual(help.read({ apply_help: { signIn: false } }), { ...all, signIn: false, createAccount: false }, 'no account is made where Career does not sign in');
  assert.deepEqual(help.KEYS, Object.keys(all));
});

test('a change takes only the five switches, none not available yet, switches Create an account off with Sign in, and refuses it on without Sign in', () => {
  const now = help.read({}), kept = { signIn: true, createAccount: true, mailCodes: true };
  assert.deepEqual(help.change(now, { mailCodes: false }), { ...kept, mailCodes: false }, 'a switch not available yet is never kept');
  assert.deepEqual(help.change(now, { signIn: false }), { ...kept, signIn: false, createAccount: false });
  const off = help.change(now, { signIn: false });
  assert.throws(() => help.change(off, { createAccount: true }), /Creating an account needs “Sign in with the login Chrome saved” switched on/);
  assert.throws(() => help.change(now, { signIn: false, createAccount: true }), /Creating an account needs/);
  assert.deepEqual(help.change(help.read({ apply_help: off }), { signIn: true, createAccount: true }), kept);
  for (const [values, name] of [[{ siteMemory: true }, 'Remember each employer site'], [{ screen: true }, 'Look at the page before moving on'], [{ screen: false, mailCodes: false }, 'Look at the page before moving on']]) {
    assert.throws(() => help.change(now, values), new RegExp(`“${name}” is not available yet, so it stays off\.$`), JSON.stringify(values));
  }
  for (const values of [undefined, null, [], {}, { submit: true }, { screen: 'yes' }, { screen: 1 }, { mailCodes: { route: '/api/x' } }]) {
    assert.throws(() => help.change(now, values), /Switch only the five things this page lists, on or off\./, JSON.stringify(values));
  }
});

test('a code may come only from the approved site’s own domain and the job site’s sending domains', () => {
  for (const [host, domain] of [['job-boards.greenhouse.io', 'greenhouse.io'], ['example.wd1.myworkdayjobs.com', 'myworkdayjobs.com'], ['careers.example.co.uk', 'example.co.uk'],
    ['example.com', 'example.com'], ['JOBS.Example.COM.', 'example.com'], ['jobs.example.com.au', 'example.com.au'], ['localhost', ''], ['10.0.0.7', ''], ['', '']]) {
    assert.equal(help.siteDomain(host), domain, host);
  }
  assert.deepEqual(help.senders(WORKDAY), ['myworkdayjobs.com']);
  assert.deepEqual(help.senders('https://job-boards.greenhouse.io', ['Mail.Example-Sender.io', 'greenhouse.io', 'not a host', '', 7, 'x'.repeat(70) + '.io']), ['greenhouse.io', 'mail.example-sender.io'],
    'named sending domains follow, lower case, each a plain host name, once');
  assert.deepEqual(help.senders('not an address', ['a.example']), ['a.example']);
  assert.equal(help.senders(WORKDAY, Array.from({ length: 30 }, (_, n) => `m${n}.example`)).length, 10, 'ten at most, as the kernel takes');
});

test('a run carries only the switches the kernel acts on, and nothing at all with every one off', () => {
  const on = help.read({}), run = { flags: FRONT, origin: WORKDAY };
  assert.deepEqual(help.assist(on, run), { signIn: true, createAccount: true,
    mailCodes: { route: '/api/career-hunter/apply-code', senders: ['myworkdayjobs.com'] } });
  const none = { siteMemory: false, screen: false, signIn: false, createAccount: false, mailCodes: false }, sent = { signIn: false, createAccount: false };
  assert.equal(help.assist(none, run), null, 'every switch off: the input is the input before the switches');
  assert.deepEqual(help.assist({ ...none, mailCodes: true }, run), { ...sent, mailCodes: { route: help.ROUTE, senders: ['myworkdayjobs.com'] } });
  assert.equal(help.assist({ ...none, siteMemory: true, screen: true }, run), null, 'no run asks for what no kernel does yet');
  assert.deepEqual(Object.keys(help.assist({ ...on, siteMemory: true, screen: true }, run)), ['signIn', 'createAccount', 'mailCodes']);
  // Chrome fills a saved login only in a window in front: behind his other windows neither sign-in switch is sent.
  const behind = help.assist(on, { flags: BEHIND, origin: WORKDAY });
  assert.deepEqual(behind, { signIn: false, createAccount: false, mailCodes: { route: help.ROUTE, senders: ['myworkdayjobs.com'] } });
  assert.equal(help.assist({ ...none, signIn: true, createAccount: true }, { flags: BEHIND, origin: WORKDAY }), null);
  // A site with no domain of its own to take mail from gets no mail codes; the kernel refuses a part with no sender.
  assert.equal(help.assist(on, { flags: FRONT, origin: 'https://10.0.0.7' }).mailCodes, null);
  assert.equal(help.assist({ ...on, signIn: true, createAccount: false }, run).createAccount, false);
});

test('the approval screen says each switch in one sentence, and always that a check is his', () => {
  const on = help.read({}), carried = help.assist(on, { flags: FRONT, origin: 'https://job-boards.greenhouse.io', mail: ['mail.example-sender.io'] });
  const said = help.lines(carried, FRONT, on);
  assert.equal(said.length, 6);
  assert.deepEqual(said.slice(0, 2), ['Career remembers nothing about this employer’s site.', 'Career does not look at pictures of the page before moving on.'], 'neither is available yet');
  assert.match(said[2], /Chrome fills the login it saved and Career presses Sign in\. Career never sees, types or keeps a password\./);
  assert.match(said[3], /Career accepts the strong password Chrome suggests, and Chrome saves it\. Career never sees it\./);
  assert.match(said[4], /only mail that arrived after the code was asked for, from greenhouse\.io or mail\.example-sender\.io\) and types the code\. It reads nothing else\./);
  assert.equal(said[5], 'A “verify you are human” check is always yours. Career never solves or skips one.');
  const off = help.lines(null, FRONT, { ...on, signIn: false, createAccount: false, mailCodes: false, screen: false, siteMemory: false });
  assert.deepEqual(off.slice(0, 5), ['Career remembers nothing about this employer’s site.', 'Career does not look at pictures of the page before moving on.',
    'You sign in to the employer’s site yourself.', 'You create an account on the employer’s site yourself.', 'You type a verification code the site emails you yourself.']);
  assert.equal(off[5], said[5], 'the check line is always there');
  const several = help.lines(carried, FRONT, on, true);
  assert.match(several[4], /from the employer’s or the job site’s address\) and types the code\./, 'a sheet of several jobs names no one site’s senders');
  assert.deepEqual([...several.slice(0, 4), several[5]], [...said.slice(0, 4), said[5]]);
  const behind = help.lines(help.assist(on, { flags: BEHIND, origin: WORKDAY }), BEHIND, on);
  assert.match(behind[2], /^You sign in yourself: Chrome fills a saved login only in a window in front, and this run’s window is behind your other windows\.$/);
  for (const line of [...said, ...off, ...behind]) assert.doesNotMatch(line, /\bAI\b|\bLLM\b/, line);
});
