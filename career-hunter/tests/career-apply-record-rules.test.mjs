/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0 (design career-self-improving-applications-2026-11-27 part 3): every rule family of lib/career-apply-record-rules.js on two made-up people whose records answer each question the other way (Ada, whose record says yes, and Bram, whose says no), the whole-word option matcher ("No" never inside "Now"; long-worded options by what they mean), pay and years ranges, and what is never answered by rule (a check that a person is human, a start date, a notice period, time off, a non-compete, a consent without the Attestations switch, a question no rule settles).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The job-source rule answers only where the person found the job: essays that say "hear about" or "learn about" stay the person's (failed on the old rule).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rules = require('../lib/career-apply-record-rules.js');

/** Ada: authorized, no sponsorship, a U.S. citizen, an active clearance, standing self-identification, near the job. */
const ADA = {
  facts: { 'name.first': 'Ada', 'name.last': 'Example', 'name.full': 'Ada Q Example', 'links.linkedin': 'https://www.linkedin.com/in/ada-example',
    'links.website': 'https://ada.example.test', 'work.employer': 'Example Freight Co' },
  standing: { workAuthorization: 'Yes', sponsorship: 'No', citizenship: 'U.S. Citizen', veteranStatus: 'Yes', disabilityStatus: 'No', gender: 'Female',
    hispanicLatino: 'No', race: 'Asian', heard: 'LinkedIn' },
  saved: [{ text: 'Do you hold a security clearance?', value: 'Active Secret' }, { text: 'What are your salary expectations?', value: '$140,000' }],
  attest: { terms: true, selfIdSignature: false },
  roles: [{ title: 'Office Manager', org: 'Example Freight Co', start: '2019-04', end: null },
    { title: 'SAP ERP Consultant', org: 'Northwind Traders LLC', start: '2004-01', end: '2019-03' }],
  education: [], recordText: 'Office Manager Example Freight Co SAP ERP Consultant Northwind Traders scheduling payroll',
  currentTitle: 'Office Manager', home: { near: 'Springfield, IL', radiusMiles: 50, includeRemote: true },
  job: { company: 'Northwind Traders', title: 'Operations Lead', location: 'Springfield, IL', workplaceType: 'hybrid', distanceMiles: 12 },
  country: 'United States', state: 'Illinois', stateAbbrev: 'IL', city: 'Springfield', letter: 'I keep busy offices running on time.', today: '2026-11-27',
};
/** Bram: not authorized, needs sponsorship, not a citizen, no standing self-identification, far from the job, terms not attested. */
const BRAM = {
  facts: { 'name.first': 'Bram', 'name.last': 'Sample', 'name.full': 'Bram Sample' },
  standing: { workAuthorization: 'No', sponsorship: 'Yes', citizenship: 'Citizen of Canada', veteranStatus: 'No', disabilityStatus: '', gender: '', hispanicLatino: '', race: '' },
  saved: [{ text: 'Security clearance', value: 'None' }], attest: { terms: false, selfIdSignature: false },
  roles: [{ title: 'Analyst', org: 'Contoso Clinic', start: '2023-02', end: null }], education: [], recordText: 'Analyst Contoso Clinic spreadsheets',
  currentTitle: 'Analyst', home: { near: 'Portland, OR', radiusMiles: 25, includeRemote: false },
  job: { company: 'Northwind Traders', title: 'Operations Lead', location: 'Springfield, IL', workplaceType: 'onsite', distanceMiles: 1700 },
  country: 'Canada', state: 'Ontario', stateAbbrev: 'ON', city: 'Toronto', letter: '', today: '2026-11-27',
};
/** The option a settle() answer chose, the words it gives, or why it is left for the person. */
function said(question, options, person) {
  const got = rules.settle(question, options, person);
  if (!got) return null;
  if (got.none) return 'never:' + got.rule;
  return Number.isInteger(got.option) ? options[got.option] : got.answer;
}
const YES_NO = ['Yes', 'No'];

test('the option matcher takes whole words: "No" is never found inside "Now", and long-worded options are read by what they mean', () => {
  assert.equal(rules.pick(['Now', 'No'], 'no'), 1, 'the exact option, never the one that only starts with its letters');
  assert.equal(rules.pick(['Now hiring', 'Nowhere'], 'no'), null, 'no option is "no" as a word');
  assert.equal(rules.pick(['No, I will not', 'Yes'], 'no'), 0, 'an option that begins with the word');
  assert.equal(rules.pick(['Opt out of recording', 'Opt in'], 'opt out'), 0);
  assert.equal(rules.pick(['United States of America', 'Canada'], 'United States'), 0);
  assert.equal(rules.pick(['Not applicable', 'No'], 'no'), 1, '"Not applicable" is not "no"');
  assert.equal(rules.polarity('I am not a protected veteran'), 'no');
  assert.equal(rules.polarity('I identify as one or more of the classifications of protected veteran'), 'yes');
  assert.equal(rules.polarity('No, I do not have a disability and have not had one in the past'), 'no');
  assert.equal(rules.polarity('Yes, I have a disability (or previously had a disability)'), 'yes');
  assert.equal(rules.polarity('I do not wish to answer'), 'decline');
  assert.equal(rules.polarity('Now hiring'), null);
  assert.equal(said('Will you now or in the future require visa sponsorship?', ['Now', 'No', 'Yes'], ADA), 'No');
});

test('ranges: a pay answer falls inside its option, years take the option that holds them, open ends included', () => {
  const pay = ['$80,000 - $100,000', '$100,001 - $130,000', '$130,001 - $150,000', '$150,001+'];
  assert.equal(said('What are your salary expectations?', pay, ADA), '$130,001 - $150,000');
  assert.equal(said('What are your salary expectations?', [], ADA), '$140,000', 'a box takes the saved words');
  assert.equal(said('What are your salary expectations?', pay, BRAM), null, 'no saved pay answer: the person gives it');
  assert.equal(rules.within(['Less than 2 years', '2-5 years', '6-10', '10+ years'], 22), 3);
  assert.equal(rules.within(['Less than 2 years', '2-5 years'], 1), 0);
  assert.equal(said('How many years of professional experience do you have?', ['0-5', '6-10', '11-15', '16+'], ADA), '16+', 'Ada\'s roles run from 2004');
  assert.equal(said('How many years of professional experience do you have?', ['0-2', '3-5', '6+'], BRAM), '3-5', 'Bram\'s one role runs from 2023');
  assert.equal(said('How many years of experience do you have?', [], ADA), '22');
});

test('eligibility and identity: authorization, sponsorship, citizenship, 18 or older and a clearance, from each person\'s own answers', () => {
  const authorized = 'Are you legally authorized to work in the United States?';
  assert.equal(said(authorized, YES_NO, ADA), 'Yes');
  assert.equal(said(authorized, YES_NO, BRAM), null, 'Bram lives in Canada: a question about another country is his');
  assert.equal(said('Are you legally authorized to work in Canada?', YES_NO, BRAM), 'No');
  assert.equal(said('Will you now or in the future require sponsorship for employment visa status?', YES_NO, ADA), 'No');
  assert.equal(said('Will you now or in the future require sponsorship for employment visa status?', YES_NO, BRAM), 'Yes');
  assert.equal(said('Are you authorized to work in the US and will you require sponsorship?', YES_NO, ADA), null, 'two questions in one stay his');
  assert.equal(said('Are you a U.S. citizen?', YES_NO, ADA), 'Yes');
  assert.equal(said('Are you a U.S. citizen?', YES_NO, BRAM), 'No');
  assert.equal(said('What is your citizenship status?', ['U.S. Citizen', 'Permanent Resident', 'Visa holder'], ADA), 'U.S. Citizen');
  assert.equal(said('Are you 18 years of age or older?', YES_NO, ADA), 'Yes', 'a role dated 2004 proves 18 or older');
  assert.equal(said('Are you 18 years of age or older?', YES_NO, BRAM), null, 'a role from 2023 proves nothing: the person answers');
  assert.equal(said('Do you currently hold an active security clearance?', YES_NO, ADA), 'Yes');
  assert.equal(said('Do you currently hold an active security clearance?', YES_NO, BRAM), 'No');
  assert.equal(said('What is your clearance level?', ['Confidential', 'Secret', 'Top Secret', 'None'], ADA), 'Secret');
  assert.equal(said('What is your clearance level?', ['Confidential', 'Secret'], { ...ADA, saved: [] }), null, 'no saved clearance answer: never guessed');
});

test('self-identification: the standing answers, else the form\'s prefer-not option; questions no standing answer covers are declined', () => {
  const veteran = ['I identify as one or more of the classifications of protected veteran', 'I am not a protected veteran', 'I do not wish to answer'];
  assert.equal(said('Veteran Status', veteran, ADA), veteran[0]);
  assert.equal(said('Veteran Status', veteran, BRAM), veteran[1]);
  const disability = ['Yes, I have a disability', 'No, I do not have a disability', 'I do not want to answer'];
  assert.equal(said('Disability status', disability, ADA), disability[1]);
  assert.equal(said('Disability status', disability, BRAM), 'I do not want to answer', 'a blank standing answer declines');
  assert.equal(said('Gender', ['Male', 'Female', 'Decline to self-identify'], ADA), 'Female');
  assert.equal(said('Gender', ['Male', 'Female', 'Decline to self-identify'], BRAM), 'Decline to self-identify');
  const race = ['White (Not Hispanic or Latino)', 'Asian (Not Hispanic or Latino)', 'Hispanic or Latino', 'I prefer not to say'];
  assert.equal(said('Race/Ethnicity', race, ADA), 'Asian (Not Hispanic or Latino)');
  assert.equal(said('Race/Ethnicity', race, BRAM), 'I prefer not to say');
  assert.equal(said('Are you Hispanic or Latino?', YES_NO, ADA), 'No');
  assert.equal(said('What is your sexual orientation?', ['Heterosexual', 'Gay or lesbian', 'I prefer not to say'], ADA), 'I prefer not to say');
  assert.equal(said('Do you identify as transgender?', ['Yes', 'No', 'Decline to answer'], ADA), 'Decline to answer');
  assert.equal(said('Do you identify as transgender?', YES_NO, ADA), null, 'no prefer-not option: the person answers');
});

test('location and work pattern: the Matching area and the job\'s distance answer relocation, office days and "within N miles"', () => {
  assert.equal(said('Are you willing to relocate?', YES_NO, ADA), 'Yes', 'the job is within her 50 miles');
  assert.equal(said('Are you willing to relocate?', YES_NO, BRAM), 'No', 'the job is far outside his 25 miles');
  assert.equal(said('Are you able to work in the office 3 days a week?', YES_NO, ADA), 'Yes');
  assert.equal(said('Are you able to work in the office 3 days a week?', YES_NO, BRAM), 'No');
  assert.equal(said('Do you live within 30 miles of one of our hubs?', YES_NO, ADA), 'Yes');
  assert.equal(said('Do you live within 30 miles of one of our hubs?', YES_NO, BRAM), 'No');
  assert.equal(said('Are you willing to relocate?', YES_NO, { ...ADA, job: { ...ADA.job, distanceMiles: null } }), null, 'no distance known: the person answers');
  assert.equal(said('Which country do you currently reside in?', ['Canada', 'United States of America', 'Mexico'], ADA), 'United States of America');
  assert.equal(said('Which country do you currently reside in?', ['Canada', 'United States of America'], BRAM), 'Canada');
  assert.equal(said('Which state do you live in?', [], ADA), 'Illinois');
  assert.equal(said('What time zone are you in?', ['Eastern Time (ET)', 'Central Time (CT)', 'Pacific Time (PT)'], ADA), 'Central Time (CT)');
  assert.equal(said('What time zone are you in?', ['Eastern', 'Central'], { ...ADA, stateAbbrev: 'FL', state: 'Florida' }), null, 'a state split between two zones is the person\'s to say');
  assert.equal(said('Do you reside in any of the following states: CA, IL, NY?', YES_NO, ADA), 'Yes');
  assert.equal(said('Do you reside in any of the following states: CA, NY, TX?', YES_NO, ADA), 'No');
  assert.equal(said('Are you a citizen or resident of any of the following countries: Cuba, Iran, North Korea, Syria?', YES_NO, ADA), 'No');
  assert.equal(said('Where are you currently located?', [], ADA), 'Springfield, Illinois, United States');
});

test('career facts: names, current employer, past employment here, an area the record names, links; never a fact it does not hold', () => {
  assert.equal(said('First Name', [], ADA), 'Ada');
  assert.equal(said('Last Name', [], BRAM), 'Sample');
  assert.equal(said('Full legal name', [], ADA), 'Ada Q Example');
  assert.equal(said('Current employer', [], ADA), 'Example Freight Co');
  assert.equal(said('Have you ever worked for Northwind Traders?', YES_NO, ADA), 'Yes', 'Northwind Traders LLC is on her record');
  assert.equal(said('Have you ever worked for Northwind Traders?', YES_NO, BRAM), 'No');
  assert.equal(said('Do you have experience with ERP systems?', YES_NO, ADA), 'Yes');
  assert.equal(said('Do you have experience with ERP systems?', YES_NO, BRAM), null, 'absence from a record is not a no');
  assert.equal(said('Do you have 5+ years of experience with SAP?', YES_NO, ADA), null, 'years with one skill are the person\'s to state');
  assert.equal(said('LinkedIn Profile', [], ADA), 'https://www.linkedin.com/in/ada-example');
  assert.equal(said('LinkedIn Profile', [], BRAM), null);
  assert.equal(said('Website', [], ADA), 'https://ada.example.test');
  assert.equal(said('Other website', [], ADA), null);
  assert.equal(said('Preferred name', [], ADA), 'never:never-not-in-record');
});

test('consents: terms only under the Attestations switch; marketing, text messages and recordings are a no; "why us" is the job\'s letter', () => {
  assert.equal(said('I acknowledge that I have read the privacy notice', ['I acknowledge'], ADA), 'I acknowledge');
  assert.equal(said('I acknowledge that I have read the privacy notice', ['I acknowledge'], BRAM), 'never:consent-needs-attestation');
  assert.equal(said('By checking this box I agree to the terms and conditions', [], ADA), 'Yes');
  assert.equal(said('I agree to receive text messages about my application', YES_NO, ADA), 'No', 'even with terms attested');
  assert.equal(said('Would you like to join our talent community for future opportunities?', YES_NO, ADA), 'No');
  assert.equal(said('Do you consent to this interview being recorded?', ['Opt in to recording', 'Opt out of recording'], ADA), 'Opt out of recording');
  assert.equal(said('Why do you want to work at Northwind Traders?', [], ADA), 'I keep busy offices running on time.');
  assert.equal(said('Why do you want to work at Northwind Traders?', [], BRAM), null, 'no letter: the person writes it');
  assert.equal(said('How did you hear about this job?', ['LinkedIn', 'Company website', 'Referral'], ADA), 'LinkedIn', 'her standing answer');
  assert.equal(said('How did you hear about this job?', ['Indeed', 'Company website', 'Referral'], BRAM), 'Company website');
});

test('the job-source rule answers only where the person found the job, never an essay that says "hear about" or "learn about"', () => {
  for (const question of ['How did you first learn about Northwind as an employer?', 'Where did you find this job posting?', 'Referral source',
    'How did you find out about this role?', 'How Did You Hear About Us?']) {
    assert.equal(said(question, [], BRAM), 'Company careers website', question);
  }
  for (const question of ['We\u2019d love to hear about something you built and operated in production. What problem did it solve?',
    'Tell us what you would like to learn about our platform in your first month', 'We want to hear about a time you disagreed with your manager']) {
    assert.equal(rules.settle(question, [], BRAM), null, question + ' stays the person\'s');
  }
});

test('never by rule: a check that a person is human and the facts no record holds stay the person\'s', () => {
  for (const question of ['What is 7 + 4?', 'Please solve: 3 x 5', 'Verify you are human', 'What is your earliest start date?', 'When can you start?',
    'What is your notice period?', 'Do you have any planned time off?', 'Are you bound by a non-compete agreement?']) {
    const got = rules.settle(question, [], ADA);
    assert.ok(got?.none && /^never-/.test(got.rule), question + ' is never answered by rule: ' + JSON.stringify(got));
    assert.equal(rules.answered(got), false);
  }
  assert.equal(rules.settle('Tell us about a project you are proud of', [], ADA), null, 'no rule settles it: the card stays the person\'s');
  assert.equal(rules.settle('', ['Yes'], ADA), null);
});

test('nothing names one person: the same question takes each person\'s own answer, and an empty record answers nothing', () => {
  const empty = { facts: {}, standing: {}, saved: [], attest: {}, roles: [], education: [], recordText: '', today: '2026-11-27' };
  for (const [question, options] of [['Are you legally authorized to work in the United States?', YES_NO], ['Will you require sponsorship?', YES_NO],
    ['Are you 18 or older?', YES_NO], ['Are you willing to relocate?', YES_NO], ['First name', []], ['What is your salary expectation?', []],
    ['Have you ever worked for Example Co?', YES_NO], ['Why do you want to join us?', []], ['What time zone are you in?', []]]) {
    const got = rules.settle(question, options, empty);
    assert.ok(!rules.answered(got), question + ' answers nothing from an empty record: ' + JSON.stringify(got));
  }
});
