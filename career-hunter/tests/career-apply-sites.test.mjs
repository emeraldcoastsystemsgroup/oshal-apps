/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.71.0 (lane APPLY-G, Roger 2026-11-21: "are you fixing all posts or just workday"): which form an assisted application fills, through Career's real routes on a made-up person's real store. Red on store main e0a9e4c9: every host but Workday, Greenhouse, Lever and Ashby was refused as site_unsupported. Proved: an employer site Career has no rules for is the generic site (lib/apply-profiles/generic.json), approved at its own address, with the approval screen saying Career stops before any button that sends the application; a company careers page that embeds Greenhouse, Lever, Ashby or SmartRecruiters is approved at that engine's own form address, from the company's engine and token and the posting's engine id (or the page's gh_jid or ashby_jid), with the page it came from named, and never at a guessed address when the id is not the engine's; each of SAP SuccessFactors, IBM Kenexa BrassRing, Amazon, Eightfold, SmartRecruiters, iCIMS, Oracle Recruiting Cloud and Oracle Taleo is recognised by its own host and gets its own rules (an iCIMS posting at its in_iframe address, an amazon.jobs posting at its application on account.amazon.jobs); every profile keeps the closed shape, names no submit word as a press, signs nothing for him and maps a State field only to the state.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyHarness } from './helpers/career-apply-fixture.mjs';

let h;
before(async () => { h = await applyHarness(); });
after(async () => { await h?.stop(); });
const PROFILES = new URL('../lib/apply-profiles/', import.meta.url);
const rules = (id) => JSON.parse(fs.readFileSync(new URL(`${id}.json`, PROFILES), 'utf8'));
const frozen = (person, id) => JSON.parse(fs.readFileSync(path.join(person.dir, `apply-${id}-1.json`), 'utf8'));
/** @description Review and approve one made-up person's job, returning the review and the frozen input. */
async function approve(name, options) {
  const person = h.person(name, options), review = await h.call('GET', '/apply-review/7', null, person.sub);
  assert.equal(review.code, 200, `${name}: ${JSON.stringify(review.body)}`);
  const approved = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: review.body.packetDigest, approved: true }, person.sub);
  assert.equal(approved.code, 200, JSON.stringify(approved.body));
  return { review: review.body, input: frozen(person, approved.body.run.id) };
}
const UUID_A = '0b6f2a6e-5d8a-4c55-9a1e-2f0e1c3d4b5a', UUID_B = '7c1d9e2f-3a4b-4c5d-8e6f-901a2b3c4d5e';

test('an employer site Career has no rules for is the generic site, approved at its own address, never refused', async () => {
  const { review, input } = await approve('dana-generic', { url: 'https://jobs.example.com/apply/7' });
  assert.deepEqual(review.site, { id: 'generic', name: 'This employer’s own site' });
  assert.equal(review.host, 'jobs.example.com');
  assert.equal(review.stop, 'Career stops before any button that sends the application. You press it.');
  assert.deepEqual(review.mode, ['Career has no rules for this site, so it types your record only into fields whose words say exactly what they are, asks you everything else, and moves pages only with Next or Continue.']);
  assert.deepEqual([input.origin, input.task.url], ['https://jobs.example.com', 'https://jobs.example.com/apply/7']);
  assert.deepEqual(input.task.rules, rules('generic'));
  assert.deepEqual(input.task.rules.steps, {}, 'no page kinds are guessed for a site Career does not know');
  assert.ok(['Next', 'Continue', 'Save and Continue'].every((word) => input.task.rules.press.continue.includes(word)), 'multi-page forms move with Next or Continue');
});

test('a company page that embeds an engine is approved at that engine’s own form, named as embedded', async () => {
  const greenhouse = await approve('dana-embed-gh', { url: 'https://careers.example-freight.com/jobs/listing/office-manager?gh_jid=4567',
    company: { atsType: 'greenhouse', atsToken: 'examplefreight' }, atsJobId: '4567' });
  assert.equal(greenhouse.review.url, 'https://boards.greenhouse.io/embed/job_app?for=examplefreight&token=4567');
  assert.deepEqual(greenhouse.review.site, { id: 'greenhouse', name: 'Greenhouse', embeddedOn: 'careers.example-freight.com' });
  assert.deepEqual(greenhouse.review.mode, ['careers.example-freight.com shows the Greenhouse form; Career opens that form at boards.greenhouse.io.']);
  assert.equal(greenhouse.review.stop, 'Career stops at the employer’s Review page. You press Submit.');
  assert.deepEqual([greenhouse.input.origin, greenhouse.input.task.rules.id], ['https://boards.greenhouse.io', 'greenhouse']);
  const ashby = await approve('dana-embed-ashby', { url: `https://www.example-freight.com/careers?ashby_jid=${UUID_A}`,
    company: { atsType: 'ashby', atsToken: 'example-freight' }, atsJobId: 'not-an-ashby-id' });
  assert.equal(ashby.review.url, `https://jobs.ashbyhq.com/example-freight/${UUID_A}/application`, 'the page’s ashby_jid when the record’s id is not Ashby’s');
  const lever = await approve('dana-embed-lever', { url: 'https://example-freight.com/jobs/office-manager',
    company: { atsType: 'lever', atsToken: 'examplefreight' }, atsJobId: UUID_B });
  assert.deepEqual([lever.review.url, lever.input.task.rules.id], [`https://jobs.lever.co/examplefreight/${UUID_B}/apply`, 'lever']);
  const smart = await approve('dana-embed-sr', { url: 'https://example-freight.com/careers/7',
    company: { atsType: 'smartrecruiters', atsToken: 'ExampleFreight' }, atsJobId: '744000012345678' });
  assert.equal(smart.review.url, 'https://jobs.smartrecruiters.com/ExampleFreight/744000012345678');
});

test('an embed Career cannot place exactly is the generic site at the company page, never a guessed engine address', async () => {
  for (const [name, options] of [
    ['dana-embed-no-token', { url: 'https://example-freight.com/jobs?gh_jid=4567', company: { atsType: 'greenhouse' }, atsJobId: '4567' }],
    ['dana-embed-bad-id', { url: 'https://example-freight.com/jobs/office-manager', company: { atsType: 'lever', atsToken: 'examplefreight' }, atsJobId: '4567' }],
    ['dana-embed-unknown', { url: 'https://example-freight.com/jobs/7', company: { atsType: 'workable', atsToken: 'examplefreight' }, atsJobId: 'AB12CD' }]]) {
    const { review } = await approve(name, options);
    assert.deepEqual([review.site.id, review.url], ['generic', options.url], name);
  }
});

test('each named engine is recognised by its own host and filled in its own rules', async () => {
  const engines = [
    ['successfactors', 'https://career8.successfactors.com/career?career_ns=job_listing&company=ExampleCo&career_job_req_id=1234', null],
    ['brassring', 'https://sjobs.brassring.com/TGnewUI/Search/home/HomeWithPreLoad?partnerid=1&siteid=2&PageType=JobDetails&jobid=345', null],
    ['amazon', 'https://www.amazon.jobs/en/jobs/2712345/operations-manager', 'https://account.amazon.jobs/jobs/2712345/apply'],
    ['eightfold', 'https://examplefreight.eightfold.ai/careers/job/5600123', null],
    ['smartrecruiters', 'https://jobs.smartrecruiters.com/ExampleFreight/744000012345678-office-manager', null],
    ['icims', 'https://careers-examplefreight.icims.com/jobs/1234/office-manager/job', 'https://careers-examplefreight.icims.com/jobs/1234/office-manager/job?in_iframe=1'],
    ['oracle', 'https://eexample.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1234', null],
    ['taleo', 'https://examplefreight.taleo.net/careersection/2/jobdetail.ftl?job=1234', null]];
  for (const [id, url, opens] of engines) {
    const { review, input } = await approve(`dana-engine-${id}`, { url });
    assert.equal(review.site.id, id, url);
    assert.equal(review.url, opens || url, `${id} opens at its own form`);
    assert.equal(input.origin, new URL(opens || url).origin);
    assert.deepEqual(input.task.rules, rules(id), `${id} rules`);
  }
});

test('an installation may name a host for any named engine; an engine Career does not name is refused loudly', async () => {
  const previous = process.env.CAREER_APPLY_SITE_HOSTS;
  try {
    process.env.CAREER_APPLY_SITE_HOSTS = JSON.stringify({ taleo: ['careers.example-freight.com'] });
    const { review } = await approve('dana-own-taleo', { url: 'https://careers.example-freight.com/job/7' });
    assert.equal(review.site.id, 'taleo');
    process.env.CAREER_APPLY_SITE_HOSTS = JSON.stringify({ amazon: ['careers.example-freight.com'] });
    const named = await approve('dana-own-amazon', { url: 'https://careers.example-freight.com/jobs/2712345/operations-manager' });
    assert.deepEqual([named.review.site.id, named.review.url], ['amazon', 'https://careers.example-freight.com/jobs/2712345/operations-manager'], 'a named host is never moved to Amazon’s own');
    process.env.CAREER_APPLY_SITE_HOSTS = JSON.stringify({ jobvite: ['careers.example-freight.com'] });
    const refused = h.person('dana-own-jobvite', { url: 'https://careers.example-freight.com/job/7' });
    assert.equal((await h.call('GET', '/apply-review/7', null, refused.sub)).code, 503);
  } finally { if (previous === undefined) delete process.env.CAREER_APPLY_SITE_HOSTS; else process.env.CAREER_APPLY_SITE_HOSTS = previous; }
});

test('every profile keeps the closed shape, never presses a submit word, signs nothing and maps State only to the state', () => {
  const submit = /submit|send application|complete application|finish/i;
  for (const file of fs.readdirSync(PROFILES).filter((name) => name.endsWith('.json'))) {
    const profile = rules(file.replace(/\.json$/, ''));
    assert.deepEqual(Object.keys(profile).sort(), ['decline', 'document', 'equivalents', 'fields', 'groups', 'id', 'press', 'signature', 'steps', 'upload', 'version']);
    for (const [kind, words] of Object.entries(profile.press)) assert.ok(words.every((w) => !submit.test(w)), `${file} ${kind}`);
    assert.ok(profile.fields.every((rule) => rule.match.label.length + rule.match.auto.length > 0), file);
    const states = profile.fields.filter((rule) => rule.match.label.some((label) => /^state$/i.test(label.trim())));
    assert.ok(states.every((rule) => rule.slot === 'address.state'), `${file}: a field labelled State takes only the state`);
    if (['workday', 'greenhouse', 'lever', 'ashby'].includes(profile.id)) continue;
    assert.deepEqual([profile.steps, profile.groups], [{}, []], `${file}: no page kinds or entry groups guessed`);
    assert.deepEqual(profile.signature, { page: 'questions', name: [], date: [] }, `${file}: no signature line is signed`);
    assert.ok(!profile.fields.some((rule) => rule.match.label.some((label) => /^(name|full name|signature|date)$/i.test(label.trim()))), `${file}: no bare Name, Full Name, Signature or Date, which can be a signature line`);
    assert.deepEqual(profile.equivalents.Florida, ['Florida', 'FL'], `${file}: a state list of abbreviations takes his state`);
  }
});
