/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane SITE-FIT, Ashby (2026-11-26): the Ashby rules against the labels two public Ashby application forms give once Orbit reads each question under its own words. The kernel takes a rule only for a field whose whole label is the rule's (the same words after normalising), so each label a form uses is listed as the form writes it: the name as one box or as first and last, Email Address, Phone Number, the three link boxes, the location list and the plain Yes/No question about work in the United States. A question whose options answer more than one fact (authorized and sponsorship in one list), salary, and any question that names the employer match no rule: he answers those himself. The opening words hold the posting's Apply for this Job and never Application, a link the application page itself shows. Red before the rules were fitted: Legal First Name, Legal Last Name, Email Address, Phone Number and five more labels matched nothing, and Application was an opening word.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { siteRules, siteFor } = createRequire(import.meta.url)('../lib/career-apply-sites.js');
const rules = siteRules('ashby');
/** The kernel's sameness of two labels: marks folded, lower case, every character that is no letter or digit a space. */
const norm = (text) => String(text).normalize('NFKD').replace(/\p{M}+/gu, '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The slot the rules give a field with this label, as the kernel matches a rule: the whole label, never a part of it. */
const slotFor = (label) => rules.fields.find((rule) => rule.match.label.some((known) => norm(known) === norm(label)))?.slot ?? null;
/** Whether a word list names these words, as the kernel reads a file field's or a button's: whole words. */
const says = (list, words) => list.some((word) => ` ${norm(words)} `.includes(` ${norm(word)} `));

/** The fields of the two forms, as read on 2026-11-26, and the slot each takes (null: not from his record by rule). */
const FORM_ONE = [['Preferred First & Last Name', 'name.full'], ['Legal First Name', 'name.first'], ['Legal Last Name', 'name.last'], ['Preferred Pronouns', null],
  ['Name Pronunciation', null], ['Email Address', 'email'], ['Phone Number', 'phone'], ['LinkedIn Profile', 'links.linkedin'], ['GitHub Profile', 'links.github'],
  ['Other Website / Portfolio', 'links.website'], ['What location do you intend to work from?', 'address.city'], ['Interview Recording Consent', null],
  ['What made you decide to apply?', null]];
const FORM_TWO = [['Legal First & Last Name', 'name.full'], ['Preferred First Name', null], ['Email', 'email'], ['Phone Number', 'phone'],
  ['Your Current/Most Recent Company', null], ['Location', 'address.city'], ['Are you legally authorized to work in the United States?', 'eligibility.authorized'],
  ['Linkedin Profile Link', 'links.linkedin']];

test('each label the two Ashby forms use takes its slot, by the whole label as the kernel matches it', () => {
  for (const [label, slot] of [...FORM_ONE, ...FORM_TWO]) assert.equal(slotFor(label), slot, label);
});

test('a question whose options answer two facts, a salary question and a question that names the employer take no rule', () => {
  // Its options are "Yes, and I will not require sponsorship ...", "Yes, but I will require sponsorship ..." and "No ...":
  // an answer from the authorized fact alone would also answer sponsorship, so the page's own options go to him.
  for (const label of ['Are you legally authorized to work in this location?', 'What is your desired salary?', 'How did you hear about Acme?',
    'Will you now or in the future require any immigration related support or sponsorship from Acme?', 'Are you located in or willing to relocate to the Acme Bay Area?']) {
    assert.equal(slotFor(label), null, label);
  }
});

test('the résumé goes to the form\'s Resume field and no press word opens an upload', () => {
  assert.ok(says(rules.upload.resume, 'Resume') && !says(rules.upload.cover, 'Resume'));
  for (const words of Object.values(rules.press)) assert.ok(!words.some((word) => ['upload file', 'submit application'].includes(norm(word))), words.join(', '));
  assert.equal(rules.document, 'docx');
  assert.deepEqual(siteFor('https://jobs.ashbyhq.com/acme/0b6f2a6e-5d8a-4c55-9a1e-2f0e1c3d4b5a/application'), { id: 'ashby', name: 'Ashby' });
});

test('the posting\'s Apply for this Job opens the form, and no opening word is a link the form\'s own page shows', () => {
  // The kernel presses the first button or link whose whole words are an opening word, on every read of a page whose
  // kind the rules do not name. The application page shows its own tabs as links, Overview and Application: with
  // Application an opening word the run pressed that tab until its presses ran out, before it filled anything in.
  const opens = rules.press.open.map(norm);
  assert.ok(opens.includes(norm('Apply for this Job')), 'the posting page\'s own button and link');
  for (const shown of ['Overview', 'Application', 'Upload file', 'Upload File', 'Recruiting Privacy Policy']) assert.ok(!opens.includes(norm(shown)), shown);
});
