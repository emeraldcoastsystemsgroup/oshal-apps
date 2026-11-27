/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane SITE-FIT, BrassRing (2026-11-26): the BrassRing rules against the words a real BrassRing Talent Gateway shows before its account (read-only: its posting, its sign-in page, its create-account page; the application itself is behind the account and was not read). The posting's own address shows the sign-in page first; Back shows the posting, whose Apply to job returns to sign-in. The rules already fit every one of those words, so this file changes no rule: it keeps them fitting. The kernel takes a rule only for a field whose whole label is the rule's, and presses only a button or link whose whole words are a press word.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.77.3 (Roger's BAE Systems run, 2026-11-26, the first page behind his account): Start Your Application offers Let's get started and Save and finish later; Let's get started is its opening press, and Save and finish later is no press of any kind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { siteRules, siteFor, formFor } = createRequire(import.meta.url)('../lib/career-apply-sites.js');
const rules = siteRules('brassring');
/** The kernel's sameness of two labels: marks folded, lower case, every character that is no letter or digit a space. */
const norm = (text) => String(text).normalize('NFKD').replace(/\p{M}+/gu, '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The slot the rules give a field with this label, as the kernel matches a rule: the whole label, never a part of it. */
const slotFor = (label) => rules.fields.find((rule) => rule.match.label.some((known) => norm(known) === norm(label)))?.slot ?? null;
/** Whether a press list holds these whole words. */
const presses = (kind, words) => rules.press[kind].map(norm).includes(norm(words));

/** What each page shows, as Orbit read it on 2026-11-26: its buttons and links, and its fields with the slot each takes. */
const POSTING = { buttons: ['Share URL', 'Apply to job', 'Save'], links: ['Skip to main content', '.', 'Careers Site', 'Sign In', 'Privacy'] };
const SIGN_IN = { buttons: ['Sign in with LinkedIn', 'Sign in with Facebook', 'Sign in with Twitter', 'Show password', 'Sign in'],
  links: ['Skip to main content', '.', 'Careers Site', 'Back', 'Forgot Username or Password?', 'Don\'t have an account yet?', 'Privacy'],
  fields: [['Email address', 'email']] };
const CREATE = { buttons: ['Show passwordpassword', 'Show re-enter password', 'Continue', 'Cancel'],
  links: ['Skip to main content', '.', 'Careers Site', 'Sign In', 'Back', 'Social network', 'Create new account', 'Privacy'],
  fields: [['Email address', 'email'], ['Question 1', null], ['Question 1 Answer', null], ['Question 2', null], ['Question 2 Answer', null], ['Question 3', null], ['Question 3 Answer', null]] };

/** Start Your Application, the first page behind his account (Roger's BAE Systems run, 2026-11-26). */
const START = { buttons: ['Let\'s get started', 'Save and finish later'], links: ['Skip to main content', '.', 'Careers Site', 'Back', 'HERE', 'Privacy'] };

test('Start Your Application is begun with Let\'s get started; Save and finish later is never pressed', () => {
  assert.deepEqual(START.buttons.filter((words) => presses('open', words)), ['Let\'s get started']);
  for (const kind of ['continue', 'add-entry', 'delete-entry']) assert.deepEqual([...START.buttons, ...START.links].filter((words) => presses(kind, words)), [], kind);
});

test('a BrassRing posting is filled in at its own address, by the BrassRing rules', () => {
  const url = 'https://sjobs.brassring.com/TGnewUI/Search/home/HomeWithPreLoad?PageType=JobDetails&partnerid=1&siteid=1&jobid=1';
  assert.deepEqual(siteFor(url), { id: 'brassring', name: 'IBM Kenexa BrassRing' });
  assert.deepEqual(formFor({ url }), { url, site: { id: 'brassring', name: 'IBM Kenexa BrassRing' } });
});

test('the posting\'s Apply to job is its one opening press; Save keeps the job and moves no page', () => {
  assert.deepEqual(POSTING.buttons.filter((words) => presses('open', words)), ['Apply to job']);
  for (const words of [...POSTING.buttons, ...POSTING.links]) for (const kind of ['continue', 'back']) assert.equal(presses(kind, words), false, `${kind}: ${words}`);
});

test('no press word is on the sign-in page but its own Back: signing in, a social sign-in and creating an account are his', () => {
  const shown = [...SIGN_IN.buttons, ...SIGN_IN.links];
  for (const kind of ['open', 'continue', 'add-entry', 'delete-entry']) assert.deepEqual(shown.filter((words) => presses(kind, words)), [], kind);
  assert.deepEqual(shown.filter((words) => presses('back', words)), ['Back'], 'Back shows the posting again');
});

test('on the create-account page Continue, which makes the account, is the only forward press word: the password boxes beside it are what stops a run', () => {
  const shown = [...CREATE.buttons, ...CREATE.links];
  assert.deepEqual(shown.filter((words) => presses('continue', words)), ['Continue']);
  assert.deepEqual(shown.filter((words) => presses('open', words)), []);
});

test('the email address takes his email; a security question and its answer take nothing from his record', () => {
  for (const [label, slot] of [...SIGN_IN.fields, ...CREATE.fields]) assert.equal(slotFor(label), slot, label);
});
