/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane SITE-FIT, Lever (2026-11-26): the Lever rules against the labels a public Lever application form gives once Orbit reads each question under its own words (the form writes them in a plain div beside the field, and marks a required one with a star that is no part of the label). The kernel takes a rule only for a field whose whole label is the rule's (the same words after normalising), so the two work eligibility questions are listed as the form writes them; before, only a few of their words were listed and neither question took his standing answer. Portfolio URL takes his website and Other website, on the same form, takes nothing, so one address is not typed into two boxes. The survey's own decline wording, Prefer not to disclose, is a decline word beside the disability question's I Don't Wish To Answer. A salary question, the current company, the pronoun boxes and the survey's questions take no rule: the kernel answers the survey from his standing answers by its own closed wordings, and the rest are his. The opening words hold the posting's Apply for this job and none of the words the form's own page shows on a button or link. Red before the rules were fitted: the two eligibility questions took no slot, Other website took his website, and Prefer not to disclose was not a decline word.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { siteRules, siteFor } = createRequire(import.meta.url)('../lib/career-apply-sites.js');
const rules = siteRules('lever');
/** The kernel's sameness of two labels: marks folded, lower case, every character that is no letter or digit a space. */
const norm = (text) => String(text).normalize('NFKD').replace(/\p{M}+/gu, '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The slot the rules give a field with this label, as the kernel matches a rule: the whole label, never a part of it. */
const slotFor = (label) => rules.fields.find((rule) => rule.match.label.some((known) => norm(known) === norm(label)))?.slot ?? null;
/** Whether a word list names these words, as the kernel reads a file field's: whole words. */
const says = (list, words) => list.some((word) => ` ${norm(words)} `.includes(` ${norm(word)} `));

const AUTHORIZED = 'Are you legally authorized to work in the United States for our Company?';
const SPONSORSHIP = 'Do you now, or will you in the future, require sponsorship for employment visa status (e.g., H-1B visa status, etc.) to work legally for our Company in the United States?';
/** The form's fields, as read on 2026-11-26, and the slot each takes (null: not from his record by rule). */
const FORM = [['Full name', 'name.full'], ['Email', 'email'], ['Phone', 'phone'], ['Current location', 'address.city'], ['Current company', 'work.employer'],
  ['LinkedIn URL', 'links.linkedin'], ['Portfolio URL', 'links.website'], ['Other website', null], [AUTHORIZED, 'eligibility.authorized'],
  [SPONSORSHIP, 'eligibility.sponsorship'], ['What is your minimum yearly base salary expectation (not including total rewards)?', null],
  ['ADDITIONAL INFORMATION', null], ['He/him', null], ['Use name only', null]];
/** The voluntary survey's questions: the kernel answers them from his standing answers by its own wordings, never by a rule. */
const SURVEY = ['Gender Identity', 'Do you identify as a member of the LGBTQ+ Community?', 'Race/Ethnicity', 'Veteran Status', 'Disability'];

test('each label the Lever form uses takes its slot, by the whole label as the kernel matches it', () => {
  for (const [label, slot] of FORM) assert.equal(slotFor(label), slot, label);
  for (const label of SURVEY) assert.equal(slotFor(label), null, label);
});

test('the survey\'s own decline wordings are decline words', () => {
  for (const option of ['Prefer not to disclose', 'I Don’t Wish To Answer']) assert.ok(rules.decline.some((word) => norm(word) === norm(option)), option);
  for (const option of ['Yes', 'No', 'Not Listed', 'I am not a veteran']) assert.ok(!rules.decline.some((word) => norm(word) === norm(option)), option);
});

test('the résumé goes to Resume/CV, and the form is one page with no Continue word', () => {
  assert.ok(says(rules.upload.resume, 'Resume/CV') && !says(rules.upload.cover, 'Resume/CV'));
  assert.deepEqual([rules.steps, rules.press.continue, rules.document], [{}, [], 'docx']);
  assert.deepEqual(siteFor('https://jobs.lever.co/acme/0b6f2a6e-5d8a-4c55-9a1e-2f0e1c3d4b5a/apply'), { id: 'lever', name: 'Lever' });
});

test('the posting\'s Apply for this job opens the form, and no opening word is on a button or link the form\'s own page shows', () => {
  // The kernel presses the first button or link whose whole words are an opening word, on every read of a page whose
  // kind the rules do not name: Apply with LinkedIn must never be one.
  const opens = rules.press.open.map(norm);
  assert.ok(opens.includes(norm('Apply for this job')), 'the posting page\'s own button');
  for (const shown of ['Apply with LinkedIn', 'Learn more', 'ATTACH RESUME/CV', 'SUBMIT APPLICATION', 'Jobs powered by', 'RETURN TO THE MAIN PAGE']) assert.ok(!opens.includes(norm(shown)), shown);
});
