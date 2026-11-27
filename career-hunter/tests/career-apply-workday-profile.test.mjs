/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane SITE-FIT, Workday (2026-11-26): the Workday rules against what two real Workday candidate sites show before the sign-in, read without signing in. A posting's Apply opens Start Your Application in a dialog, and the posting's own Apply stays listed behind it. The kernel presses the first of the rules' opening words that any button carries, so with Apply first it pressed the posting's Apply again on every read of the dialog until its presses ran out. The dialog's own words now come first: on the posting only Apply is there to press, on the dialog Autofill with Resume is. Also held here: the steps bar's real labels and their page kinds, the account pages' email box, and that no press word presses a button of the account pages (Create Account, Sign In, Reset Password), the cookie banner or Back to Job Posting.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.77.1 (Roger's Alteryx run, 2026-11-26): Workday's create-account consent box (createAccountCheckbox) is the terms box, so the sign-in step ticks it with his attest.terms.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.77.2 (Roger's Alteryx run, 2026-11-26): a posting where he has a saved application shows Continue Application instead of Apply, and that is the opening press.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { siteRules, siteFor } = createRequire(import.meta.url)('../lib/career-apply-sites.js');
const rules = siteRules('workday');
/** The kernel's sameness of two labels: marks folded, lower case, every character that is no letter or digit a space. */
const norm = (text) => String(text).normalize('NFKD').replace(/\p{M}+/gu, '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The button the kernel presses for a kind: the first of the rules' words for it, in their order, that any button's whole words are. */
const pressed = (kind, buttons) => rules.press[kind].map((word) => buttons.find((shown) => norm(shown) === norm(word))).find(Boolean) ?? null;
/** The slot a field takes, as the kernel matches a rule: its automation id, else its whole label. */
const slotFor = ({ auto, label }) => rules.fields.find((rule) => rule.match.auto.includes(auto) || rule.match.label.some((known) => norm(known) === norm(label)))?.slot ?? null;

/** The buttons each page lists, in reading order, as read on 2026-11-26 (the same on both sites but for the site's own menu). */
const BAR = ['Decline', 'Accept Cookies', 'Sign In', 'Search for Jobs'];
const POSTING = [...BAR, 'Apply', 'Read More', 'Read More'];
const START = [...POSTING, 'Close', 'Autofill with Resume', 'Apply Manually', 'Use My Last Application'];
const CREATE_ACCOUNT = [...BAR, 'Back to Job Posting', 'Read More', 'Create Account', 'Sign In', 'Forgot your password?'];
const SIGN_IN = [...BAR, 'Back to Job Posting', 'Sign In', 'Create Account', 'Forgot your password?'];
const FORGOT_PASSWORD = [...BAR, 'Back to Job Posting', 'Reset Password', 'Sign In', 'Create Account'];

test('the posting\'s Apply opens the application, and on Start Your Application the dialog\'s own button is pressed, not the Apply behind it', () => {
  assert.equal(pressed('open', POSTING), 'Apply');
  assert.equal(pressed('open', START), 'Autofill with Resume', 'the posting\'s Apply is still listed behind the dialog');
  assert.equal(pressed('open', START.filter((shown) => shown !== 'Autofill with Resume')), 'Apply Manually', 'a site that offers no résumé autofill');
  for (const kind of ['continue', 'back', 'add-entry', 'delete-entry']) assert.equal(pressed(kind, START), null, kind);
  // Roger's Alteryx run, 2026-11-26: once he has a saved application there, the posting offers Continue Application.
  const DRAFT = [...BAR, 'Continue Application', 'Read More', 'Read More'];
  assert.equal(pressed('open', DRAFT), 'Continue Application');
  for (const kind of ['continue', 'back', 'add-entry', 'delete-entry']) assert.equal(pressed(kind, DRAFT), null, `draft: ${kind}`);
});

test('no press word presses a button of the account pages, the cookie banner or Back to Job Posting', () => {
  for (const [page, buttons] of Object.entries({ CREATE_ACCOUNT, SIGN_IN, FORGOT_PASSWORD })) {
    for (const kind of Object.keys(rules.press)) assert.equal(pressed(kind, buttons), null, `${page}: ${kind}`);
  }
});

test('the steps bar\'s real labels take their page kinds; the account step and a numbered questions step are not named', () => {
  const kind = (label) => Object.entries(rules.steps).find(([step]) => norm(step) === norm(label))?.[1] ?? null;
  assert.deepEqual(['Autofill with Resume', 'My Information', 'My Experience', 'Application Questions', 'Voluntary Disclosures', 'Review'].map(kind),
    ['upload', 'contact', 'experience', 'questions', 'disclosures', 'review']);
  // The kernel reads a step the rules do not name as a page of questions, and hands a page with a password box back
  // to him before its kind is asked.
  assert.deepEqual(['Create Account/Sign In', 'Application Questions 1 of 2', 'Application Questions 2 of 2'].map(kind), [null, null, null]);
});

test('the account pages\' email box takes his email; the password boxes take nothing from his record; the consent box is the terms box', () => {
  assert.equal(slotFor({ auto: 'email', label: 'Email Address' }), 'email');
  for (const field of [{ auto: 'password', label: 'Password' }, { auto: 'verifyPassword', label: 'Verify New Password' }]) assert.equal(slotFor(field), null, field.label);
  // Roger's Alteryx run, 2026-11-26: the account's privacy box is a consent he gave in his Attestations (attest.terms),
  // so it is the terms box, by Workday's own id on any tenant and by Alteryx's words.
  assert.equal(slotFor({ auto: 'createAccountCheckbox', label: 'I have read the Privacy Policy, including the Candidate Privacy Policy.' }), 'attest.terms');
  assert.equal(slotFor({ auto: 'createAccountCheckbox', label: 'I agree to the data privacy statement' }), 'attest.terms', 'any tenant, by its id');
  assert.deepEqual(siteFor('https://acme.wd108.myworkdayjobs.com/en-US/Careers/job/Remote/Senior-Analyst_R1234/apply/applyManually'), { id: 'workday', name: 'Workday' });
});
