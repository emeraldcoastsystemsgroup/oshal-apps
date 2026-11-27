/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane SITE-FIT, Eightfold (2026-11-26): the Eightfold rules against the labels a real Eightfold application form gives (read without an account, read-only): one page with no steps, whose lists name their options only once opened, behind a welcome message that covers a first visit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { siteRules, siteFor } = createRequire(import.meta.url)('../lib/career-apply-sites.js');
const rules = siteRules('eightfold');
/** The kernel's sameness of two labels: marks folded, lower case, every character that is no letter or digit a space. */
const norm = (text) => String(text).normalize('NFKD').replace(/\p{M}+/gu, '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The slot the rules give a field with this label, as the kernel matches a rule: the whole label, never a part of it. */
const slotFor = (label) => rules.fields.find((rule) => rule.match.label.some((known) => norm(known) === norm(label)))?.slot ?? null;
/** Whether a word list names these words, as the kernel reads a file field's: whole words. */
const says = (list, words) => list.some((word) => ` ${norm(words)} `.includes(` ${norm(word)} `));
const listed = (list, words) => list.some((word) => norm(word) === norm(words));

const AUTHORIZED = 'Are you legally authorized to work in the country of the job for which you are applying?';
const SPONSORSHIP = 'Will you require sponsorship for an employment Visa?';
const AGREE = 'I have read and understand and I agree to the above';
const SIGN = 'Please sign by typing your full legal name';
/** The form's fields, as read on 2026-11-26, and the slot each takes (null: not from his record by rule). */
const FORM = [['First Name', 'name.first'], ['Last Name', 'name.last'], ['Email', 'email'], ['Country code', null], ['Phone number', 'phone'],
  ['Preferred Name', null], ['Preferred Pronoun', null], ['How did you hear about this position?', 'source.heard'], ['Details', null],
  ['Are you 16 years or older?', null], [AUTHORIZED, 'eligibility.authorized'], [SPONSORSHIP, 'eligibility.sponsorship'],
  ['If yes, please indicate Visa status', null], ['Please indicate if you belong to one of the categories above:', null],
  ['Military Branch', null], ['Security Clearance - Active', null], ['Date Granted', null], [AGREE, null], [SIGN, null],
  ['Save my answers for future applications', null]];
/** Its self-identification questions: the kernel answers them from his standing answers by its own wordings, never by a rule. */
const SELF_ID = ['Sex', 'Please indicate the ethnic group with which you identify. (A definition of each ethnic group is provided above.)',
  'Please select your Protected Veteran Status. (A definition of each group is provided above.)'];
/** Every button and link the form's own page shows. */
const SHOWN = ['Sign In', 'Jobs', 'Dashboard', 'Profile', 'Join Talent Network', 'Select file - Upload resume', 'Read more', 'Cancel', 'Clear form',
  'Submit application', 'Close welcome message'];

test('each label the Eightfold form uses takes its slot, by the whole label as the kernel matches it', () => {
  for (const [label, slot] of FORM) assert.equal(slotFor(label), slot, label);
  for (const label of SELF_ID) assert.equal(slotFor(label), null, label);
});

test('its statement of agreement is his: the Yes it asks for is no terms box rule and its signature line is no signature rule', () => {
  // A terms rule ticks a check box only; this agreement is a list, and its line is the application's signature, not
  // the self-identification form's that his Attestations switch speaks of.
  assert.equal(slotFor(AGREE), null);
  assert.ok(![...(rules.signature?.name || []), ...(rules.signature?.date || [])].some((label) => norm(label) === norm(SIGN)));
});

test('the form\'s own decline wordings are decline words, and an answer is not', () => {
  for (const option of ['I do not wish to self-identify', 'I am not a protected Veteran / I prefer not to answer']) assert.ok(listed(rules.decline, option), option);
  for (const option of ['Male', 'Female', 'Hispanic or Latino', 'White (Not Hispanic/Latino)', 'Yes', 'No',
    'I identify as one or more of the Classifications of Protected Veteran Listed above']) assert.ok(!listed(rules.decline, option), option);
});

test('the résumé goes to Resume/CV as a Word file, and the form is one page: none of its buttons is a Continue word', () => {
  assert.ok(says(rules.upload.resume, 'Resume/CV') && !says(rules.upload.cover, 'Resume/CV'));
  assert.deepEqual([rules.steps, rules.document], [{}, 'docx']);
  for (const shown of [...SHOWN, 'I Agree', 'Replace']) assert.ok(!listed(rules.press.continue, shown), shown);
  assert.deepEqual(siteFor('https://acme.eightfold.ai/careers/apply?pid=1&domain=acme.com'), { id: 'eightfold', name: 'Eightfold' });
});

test('Apply Now opens the form from the posting, and on the form\'s own page the one opening word closes the welcome message', () => {
  // The kernel presses the first button or link whose whole words are an opening word, on every read of a page whose
  // kind the rules do not name. The welcome message covers the form on a first visit, so it is closed first; the
  // privacy notice's I Agree is his consent and is never an opening or a Continue word.
  assert.ok(listed(rules.press.open, 'Apply Now'), 'the posting page\'s own link');
  assert.deepEqual(SHOWN.filter((shown) => listed(rules.press.open, shown)), ['Close welcome message']);
  for (const never of ['I Agree', 'Submit application', 'Clear form', 'Cancel']) assert.ok(!listed(rules.press.open, never) && !listed(rules.press.continue, never), never);
});
