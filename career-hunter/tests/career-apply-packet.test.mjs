/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-LOCATION: a job's location, as Work history saves it on the record, reaches the employer's form in the packet's Word résumé (the parse résumé's Location line under the job's Company, which Workday's Autofill with Resume reads), and a job with none gets no Location line; the work-history rows Career types stay in the closed shape the kernel reads (its Role refuses an unknown key and a Roles group takes only title, employer, current, start, end and description), so no location is typed into one until the kernel takes it.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 1.76.3: a start the kernel refused for want of a Job Apply computer fails the run's ticket there; Go on binds a fresh ticket and starts the same approved bytes on it, once.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0: the packet's Word résumé (resume-docx) is the parse résumé: the packet's own Resume_Parse.docx byte for byte, else the real docx_resume.py export-packet --kind parse render with the same digest every time; an executive Resume_ATS.docx beside it is not what is uploaded. Every site's rules upload it (document docx), so Workday's Autofill with Resume and the other sites' résumé fields get the résumé laid out for their parser, the PDF only where a field refuses Word. Red before: the packet carried Resume_ATS.docx and Greenhouse, Lever and Ashby uploaded the PDF.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.71.0 (lane APPLY-G): a site Career names no engine for is no longer refused; it is the generic site (proved in career-apply-sites.test.mjs), so the refusal case for it and the installation-host case's unnamed host and unknown engine move to that.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: the kernel finds the terms box only through a site rule naming slot attest.terms (lane C1): the Workday profile names it on Voluntary Disclosures' terms check box (agreementCheckbox), each one-page site on its terms box; no packet fact is an attest key, since the kernel refuses one and task.attest is the only source.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (the owner's answer to design question 1, "its configuration"): the packet carries task.attest {terms, selfIdSignature} from the person's two Attestations switches, false unless he switched one on; it is under the approval digest, so a switch changed after approval leaves that run's input as approved and the old digest no longer approves.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: a record that holds the address in profile.application_contact (address1, city, state, state_abbrev, postal_code, country) gives every contact slot: address.line1, address.city, address.state (the full name) and address.state_abbrev, address.postal, address.country, phone, the phone type standing answer as phone.type, and posting.employer, which the kernel reads for Previously worked for this employer. Red before: no street, no postal code, the state from the location line only.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (Fill it in on my Chrome): the approval packet of an assisted application, through Career's real routes over HTTP on a made-up person's real store. Red on store main 75fa525e (no /apply-review or /apply-runs route; career-submission-native review refuses anything but two PDFs). It carries this job's Word résumé rendered by the real docx_resume.py with the same digest on every render (or the packet's own Resume_ATS.docx byte for byte), the PDF résumé and cover letter, only the roles on this job's résumé with their recorded dates (a year stays a year), education, the facts and the site's rules; approval publishes the frozen browser-task version 2 before any kernel call; bind, start, a lost acknowledgement and Go on send exactly the approved bytes; another person, no person, a changed packet and a site Career has no rules for are refused.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { applyHarness, ROLES } from './helpers/career-apply-fixture.mjs';

const require = createRequire(import.meta.url);
const docx = require('../lib/career-docx-export'), queue = require('../lib/career-submission-queue');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
let h;
before(async () => { h = await applyHarness(); });
after(async () => { await h?.stop(); });
const frozen = (person, id, n = 1) => JSON.parse(fs.readFileSync(path.join(person.dir, `apply-${id}-${n}.json`), 'utf8'));

test('the packet carries this job’s parse résumé from the real docx_resume.py with the same digest every time, and approval freezes it', async () => {
  const dana = h.person('dana-render', { word: null });
  const first = await h.call('GET', '/apply-review/7', null, dana.sub);
  assert.equal(first.code, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.documents.map((d) => [d.id, d.name, d.type]), [
    ['resume-docx', 'Example Freight Co - Office Manager - Job 7 - Resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['resume-pdf', 'Example Freight Co - Office Manager - Job 7 - Resume.pdf', 'application/pdf'],
    ['cover-pdf', 'Example Freight Co - Office Manager - Job 7 - Cover Letter.pdf', 'application/pdf']]);
  assert.equal(first.body.uploads, 'docx', 'Workday gets the Word résumé');
  assert.equal(first.body.stop, 'Career stops at the employer’s Review page. You press Submit.');
  const again = await h.call('GET', '/apply-review/7', null, dana.sub);
  assert.equal(again.body.packetDigest, first.body.packetDigest, 'a second render is the same packet');
  const direct = await docx.renderPacketArtifact({ packetJsonPath: path.join(dana.folder, 'application.json'), kind: 'parse', format: 'docx' });
  assert.equal(first.body.documents[0].sha256, sha(direct.bytes), 'the digest is the real parse résumé render’s');
  const xml = execFileSync(process.env.JOBHUNTER_PYTHON || 'python3', ['-c', 'import io,sys,zipfile; print(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read("word/document.xml").decode())'], { input: direct.bytes, encoding: 'utf8' });
  assert.match(xml, /Job Title: <\/w:t>.*Office Manager/s, 'the parse résumé, its roles on labelled lines');
  const approved = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: first.body.packetDigest, approved: true }, dana.sub);
  assert.equal(approved.code, 200, JSON.stringify(approved.body));
  assert.equal(h.port.created.length + h.port.started.length, 0, 'approval publishes the input and calls nothing in the kernel');
  const input = frozen(dana, approved.body.run.id), { requestDigest, ...bound } = input;
  assert.equal(requestDigest, queue.jsonDigest(bound));
  assert.deepEqual([input.version, input.intentId, input.attempt, input.mode, input.origin], [2, approved.body.run.id, 1, 'assist', 'https://example.wd1.myworkdayjobs.com']);
  assert.deepEqual(input.bounds, { advancing: 16, entries: 20, edits: 400, activeMs: 1800000, waitMs: 1800000 });
  assert.deepEqual(Object.keys(input.task).sort(), ['answers', 'attest', 'documents', 'education', 'facts', 'flags', 'postingId', 'roles', 'rules', 'submissionId', 'url']);
  assert.deepEqual(input.task.attest, { terms: false, selfIdSignature: false }, 'with the switches off, the packet says false');
  const word = Buffer.from(input.task.documents[0].base64, 'base64');
  assert.deepEqual([...word.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'a Word file, not a PDF');
  assert.equal(sha(word), input.task.documents[0].sha256);
  assert.equal(sha(word), sha(direct.bytes));
  assert.equal(Buffer.from(input.task.documents[1].base64, 'base64').subarray(0, 5).toString(), '%PDF-');
  assert.deepEqual(input.task.rules, JSON.parse(fs.readFileSync(new URL('../lib/apply-profiles/workday.json', import.meta.url), 'utf8')));
  assert.ok(Date.parse(approved.body.run.expiresAt) - Date.now() > 23.9 * 3600 * 1000, 'the approval lasts 24 hours');
});

test('the parse résumé already beside the packet is the one uploaded, byte for byte, never the executive Word résumé', async () => {
  const own = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('another made-up word file of this job')]);
  const executive = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('the made-up executive Word résumé of this job')]);
  const dana = h.person('dana-own-word', { word: own, executive });
  const review = await h.call('GET', '/apply-review/7', null, dana.sub);
  assert.equal(review.body.documents[0].sha256, sha(own));
  const older = h.person('dana-executive-only', { word: null, executive });
  const rendered = await h.call('GET', '/apply-review/7', null, older.sub);
  assert.notEqual(rendered.body.documents[0].sha256, sha(executive), 'a packet made before the parse résumé renders one; its executive Word résumé is not uploaded');
});

test('every site’s rules upload the Word résumé, which is the parse résumé', () => {
  const folder = new URL('../lib/apply-profiles/', import.meta.url), sites = fs.readdirSync(folder).filter((name) => name.endsWith('.json'));
  assert.ok(['workday', 'greenhouse', 'lever', 'ashby'].every((site) => sites.includes(site + '.json')), 'the four sites are among them');
  for (const site of sites) {
    const rules = JSON.parse(fs.readFileSync(new URL(site, folder), 'utf8'));
    assert.equal(rules.document, 'docx', site + ': its résumé field takes the parse résumé (the kernel falls back to the PDF only where a field refuses Word)');
  }
});

test('only the roles on this job’s résumé are in it, with recorded dates (a year stays a year), and its facts and education', async () => {
  const dana = h.person('dana-roles');
  fs.writeFileSync(path.join(dana.dir, 'apply_profile.json'), JSON.stringify({ phone_type: 'Mobile' }));
  const { body } = await h.call('GET', '/apply-review/7', null, dana.sub);
  assert.deepEqual(body.roles, [
    { title: 'Office Manager', employer: 'Example Freight Co', start: '2019-04', end: null, deliverables: ROLES[0].deliverables },
    { title: 'Operations Coordinator', employer: 'Sample Logistics LLC', start: '2015-06', end: '2019-03', deliverables: ROLES[1].deliverables },
    { title: 'Administrative Assistant', employer: 'Northwind Traders', start: '2012', end: '2015', deliverables: ROLES[2].deliverables }]);
  assert.equal(JSON.stringify(body).includes('Contoso Clinic'), false, 'a recorded role the résumé leaves out is not offered');
  assert.deepEqual(Object.fromEntries(body.facts.map((f) => [f.slot, f.value])), {
    'name.first': 'Dana', 'name.middle': 'Q', 'name.last': 'Example', 'name.full': 'Dana Q Example', email: 'dana@example.test', phone: '555-0100', 'phone.type': 'Mobile',
    'address.line1': '1 Example Way', 'address.city': 'Springfield', 'address.state': 'Illinois', 'address.state_abbrev': 'IL', 'address.postal': '62701', 'address.country': 'United States',
    'links.linkedin': 'https://www.linkedin.com/in/dana-example', 'posting.employer': 'Example Freight Co' }, 'every contact slot from profile.application_contact and profile.phone, the phone type he gave, and the posting’s employer');
  assert.deepEqual(body.facts.filter((f) => f.slot.startsWith('address.') || f.slot.startsWith('phone')).map((f) => f.label),
    ['Phone', 'Phone type', 'Address', 'City', 'State', 'State abbreviation', 'Postal code', 'Country']);
  assert.deepEqual(body.education, [
    { school: 'Example State University', degree: 'MBA', field: null, start: null, end: '2011' },
    { school: 'Sample College', degree: 'BS', field: 'Accounting', start: '2001', end: '2005' }]);
  assert.deepEqual(body.answers, [], 'nothing saved yet, nothing offered');
});

/** The paragraphs of a Word file as a plain reader sees them (tests/helpers/resume_line_parser.py). */
function wordLines(bytes, dir) {
  const file = path.join(dir, 'packet-word.docx'); fs.writeFileSync(file, bytes);
  const helpers = fileURLToPath(new URL('./helpers', import.meta.url));
  return JSON.parse(execFileSync(process.env.JOBHUNTER_PYTHON || 'python3', ['-c',
    'import json,sys; sys.path.insert(0,sys.argv[1]); import resume_line_parser as r; print(json.dumps([l for l in r.docx_lines(sys.argv[2]) if l]))', helpers, file], { encoding: 'utf8' }));
}
/** The closed shape the kernel reads a typed work-history row in (crates/oshald/src/node_work/apply_input.rs: Role is
 * deny_unknown_fields; group_keys names a Roles group's keys). A key outside it refuses the whole approved input. */
const KERNEL_ROLE = ['current', 'deliverables', 'employer', 'end', 'start', 'title'];
const KERNEL_ROLE_GROUP = ['current', 'description', 'employer', 'end', 'start', 'title'];

test('a job’s location reaches the form in the packet’s Word résumé, from the record; the rows Career types stay in the kernel’s shape', async () => {
  // Work history saved where two of her jobs were before this job's documents were made, so its profile snapshot holds them.
  // (A save after that makes the documents out of date: Fill it in refuses until they are made again.)
  const dana = h.person('dana-location', { word: null, locations: { r1: 'Springfield, IL', r2: 'Peoria, IL' } });
  const review = await h.call('GET', '/apply-review/7', null, dana.sub);
  assert.equal(review.code, 200, JSON.stringify(review.body));
  const approved = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: review.body.packetDigest, approved: true }, dana.sub);
  const input = frozen(dana, approved.body.run.id), lines = wordLines(Buffer.from(input.task.documents[0].base64, 'base64'), dana.dir);
  const head = (title) => { const n = lines.indexOf('Job Title: ' + title); return lines.slice(n, lines.findIndex((line, i) => i > n && line.startsWith('• '))); };
  assert.deepEqual(head('Office Manager'), ['Job Title: Office Manager', 'Company: Example Freight Co', 'Location: Springfield, IL', 'Start Date: 04/2019', 'End Date: Present'],
    'Workday’s Autofill with Resume reads each job’s location from the uploaded résumé');
  assert.deepEqual(head('Operations Coordinator').slice(2, 3), ['Location: Peoria, IL']);
  assert.deepEqual(head('Administrative Assistant'), ['Job Title: Administrative Assistant', 'Company: Northwind Traders', 'Start Date: 2012', 'End Date: 2015'], 'a job with none recorded gets no location');
  for (const role of input.task.roles) assert.ok(Object.keys(role).every((key) => KERNEL_ROLE.includes(key)), 'a typed row holds only the keys the kernel reads: ' + Object.keys(role));
  assert.equal(JSON.stringify(input.task.roles).includes('Springfield'), false, 'the location is not typed into a work-history row the kernel would refuse');
  for (const site of fs.readdirSync(new URL('../lib/apply-profiles/', import.meta.url)).filter((name) => name.endsWith('.json'))) {
    const rules = JSON.parse(fs.readFileSync(new URL('../lib/apply-profiles/' + site, import.meta.url), 'utf8'));
    for (const group of (rules.groups || []).filter((item) => item.facts === 'roles'))
      assert.deepEqual(Object.values(group.fields).filter((key) => !KERNEL_ROLE_GROUP.includes(key)), [], site + ': a work-history field maps only keys the kernel accepts');
  }
  const later = h.person('dana-location-later', { word: null });
  const saved = JSON.parse(fs.readFileSync(path.join(later.dir, 'career_db.json'), 'utf8'));
  saved.roles[0].location = 'Springfield, IL';   // saved on Work history after this job's documents were made
  fs.writeFileSync(path.join(later.dir, 'career_db.json'), JSON.stringify(saved, null, 2));
  const outdated = await h.call('GET', '/apply-review/7', null, later.sub);
  assert.deepEqual([outdated.code, outdated.body.code], [409, 'documents_outdated'], 'documents made before the location was saved are made again before any form is filled');
});

test('another person, no person, a changed packet and extra fields are refused', async () => {
  const dana = h.person('dana-refusals'), other = h.person('other-refusals');
  fs.writeFileSync(path.join(other.dir, 'apply_profile.json'), JSON.stringify({ email: 'other@example.test' }));
  const { body } = await h.call('GET', '/apply-review/7', null, dana.sub);
  assert.equal((await h.call('GET', '/apply-review/7', null, null)).code, 401);
  assert.equal((await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest, approved: true }, null)).code, 401);
  const theirs = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest, approved: true }, other.sub);
  assert.equal(theirs.code, 428, 'one person’s reviewed digest never approves another person’s packet');
  assert.equal((await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest, approved: true, url: 'https://elsewhere.example.com' }, dana.sub)).code, 400);
  assert.equal((await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest }, dana.sub)).code, 428);
  fs.writeFileSync(path.join(dana.folder, 'CoverLetter.pdf'), '%PDF-1.7\nchanged after review\n%%EOF');
  const changed = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest, approved: true }, dana.sub);
  assert.equal(changed.code, 428, 'documents that changed after review need a new review');
  assert.equal(fs.readdirSync(dana.dir).some((name) => name.startsWith('apply-')), false, 'nothing was approved');
});

test('bind, start, a lost acknowledgement and Go on send exactly the approved bytes, never a second start of one attempt', async () => {
  const dana = h.person('dana-start'), started = h.port.started.length;
  const { body } = await h.call('GET', '/apply-review/7', null, dana.sub);
  const { body: { run } } = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest, approved: true }, dana.sub);
  assert.equal((await h.call('POST', `/apply-runs/${run.id}/start`, {}, dana.sub)).body.code, 'ticket_not_bound');
  assert.equal((await h.call('POST', `/apply-runs/${run.id}/bind`, {}, 'other-refusals')).code, 404, 'another person cannot bind it');
  const bound = await h.call('POST', `/apply-runs/${run.id}/bind`, {}, dana.sub);
  assert.deepEqual(h.port.created.at(-1), { ticketType: 'career-apply', ownerSub: dana.sub });
  h.port.refuseStart = Object.assign(Error('lost acknowledgement'), {});
  assert.equal((await h.call('POST', `/apply-runs/${run.id}/start`, {}, dana.sub)).code, 503);
  h.port.refuseStart = null;
  const ok = await h.call('POST', `/apply-runs/${run.id}/start`, {}, dana.sub);
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.run.status, 'queued');
  const sent = h.port.started.at(-1);
  assert.equal(sent.ticketId, bound.body.run.nativeTicketId);
  assert.equal(sent.input.executor, 'orbit-apply-v1');
  assert.deepEqual(sent.input.limits, { wall_ms: 7200000, output_tokens: 16000, artifact_bytes: 12582912 });
  assert.equal(sent.input.files.length, 1);
  assert.equal(sent.input.files[0].path, 'browser-task.json');
  const bytes = Buffer.from(sent.input.files[0].bytes);
  assert.deepEqual(JSON.parse(bytes.toString()), frozen(dana, run.id), 'the frozen input, unchanged');
  assert.equal(Buffer.from(sent.input.files[0].digest).toString('hex'), sha(bytes));
  await h.call('POST', `/apply-runs/${run.id}/start`, {}, dana.sub);
  assert.equal(h.port.started.length, started + 1, 'a started attempt is never started again');
  assert.equal((await h.call('POST', `/apply-runs/${run.id}/go-on`, {}, dana.sub)).body.code, 'run_not_paused');
  const workId = 'b2000000-0000-0000-0000-00000000000' + h.port.started.length, input = frozen(dana, run.id);
  h.port.rows = [{ id: workId, state: 'completed', executor: 'orbit-apply-v1' }];
  h.port.accepted.set(workId, { version: 2, intentId: run.id, attempt: 1, requestDigest: input.requestDigest, outcome: 'paused', data: { reason: 'Waited 30 minutes for you to sign in.' } });
  const paused = await h.call('POST', `/apply-runs/${run.id}/sync`, {}, dana.sub);
  assert.equal(paused.body.run.status, 'paused', JSON.stringify(paused.body));
  const resumed = await h.call('POST', `/apply-runs/${run.id}/go-on`, {}, dana.sub);
  assert.equal(resumed.code, 200, JSON.stringify(resumed.body));
  const second = frozen(dana, run.id, 2), next = JSON.parse(Buffer.from(h.port.started.at(-1).input.files[0].bytes).toString());
  assert.deepEqual(next, second);
  assert.equal(second.attempt, 2);
  assert.deepEqual(second.task, input.task, 'the same approved task');
  assert.notEqual(second.requestDigest, input.requestDigest, 'its own request digest');
});

test('an installation can name exact hosts that use a site’s form (CAREER_APPLY_SITE_HOSTS); a malformed setting refuses loudly', async () => {
  const previous = process.env.CAREER_APPLY_SITE_HOSTS;
  try {
    const own = h.person('dana-own-host', { url: 'https://apply-standin.example.com/careers/job/7' });
    assert.equal((await h.call('GET', '/apply-review/7', null, own.sub)).body.site.id, 'generic', 'unnamed, the host is filled in the careful general rules');
    process.env.CAREER_APPLY_SITE_HOSTS = JSON.stringify({ workday: ['apply-standin.example.com'] });
    const review = await h.call('GET', '/apply-review/7', null, own.sub);
    assert.equal(review.code, 200, JSON.stringify(review.body));
    assert.deepEqual([review.body.site, review.body.uploads, review.body.host], [{ id: 'workday', name: 'Workday' }, 'docx', 'apply-standin.example.com']);
    process.env.CAREER_APPLY_SITE_HOSTS = JSON.stringify({ workday: ['https://apply-standin.example.com'] });
    assert.equal((await h.call('GET', '/apply-review/7', null, own.sub)).code, 503, 'a host written as an address is not a host');
    process.env.CAREER_APPLY_SITE_HOSTS = JSON.stringify({ jobvite: ['apply-standin.example.com'] });
    assert.equal((await h.call('GET', '/apply-review/7', null, own.sub)).code, 503, 'a site Career has no rules for');
  } finally { if (previous === undefined) delete process.env.CAREER_APPLY_SITE_HOSTS; else process.env.CAREER_APPLY_SITE_HOSTS = previous; }
});

test('Go on whose start is refused can be pressed again: the published attempt starts, an ended one is not read again', async () => {
  const dana = h.person('dana-go-on-again'), { body } = await h.call('GET', '/apply-review/7', null, dana.sub);
  const { body: { run } } = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest, approved: true }, dana.sub);
  await h.call('POST', `/apply-runs/${run.id}/bind`, {}, dana.sub); await h.call('POST', `/apply-runs/${run.id}/start`, {}, dana.sub);
  const workId = 'b2000000-0000-0000-0000-00000000000' + h.port.started.length, input = frozen(dana, run.id);
  h.port.rows = [{ id: workId, state: 'completed', executor: 'orbit-apply-v1' }];
  h.port.accepted.set(workId, { version: 2, intentId: run.id, attempt: 1, requestDigest: input.requestDigest, outcome: 'paused', data: { reason: 'Waited 30 minutes.' } });
  assert.equal((await h.call('POST', `/apply-runs/${run.id}/sync`, {}, dana.sub)).body.run.status, 'paused');
  h.port.refuseStart = Object.assign(Error('Your chosen Job Apply device is not connected.'), { code: 'apply_device_unavailable' });
  const refused = await h.call('POST', `/apply-runs/${run.id}/go-on`, {}, dana.sub);
  assert.deepEqual([refused.code, refused.body.code], [409, 'apply_device_unavailable']);
  const waiting = (await h.call('POST', `/apply-runs/${run.id}/sync`, {}, dana.sub)).body.run;
  assert.deepEqual([waiting.status, waiting.attempt, waiting.attemptsStarted], ['approved', 2, 1], 'the unstarted attempt is not undone by reading the ended one');
  h.port.refuseStart = null;
  const again = await h.call('POST', `/apply-runs/${run.id}/go-on`, {}, dana.sub);
  assert.equal(again.code, 200, JSON.stringify(again.body));
  assert.deepEqual([again.body.run.status, again.body.run.attempt, again.body.run.attemptsStarted], ['queued', 2, 2]);
  assert.deepEqual(JSON.parse(Buffer.from(h.port.started.at(-1).input.files[0].bytes).toString()), frozen(dana, run.id, 2), 'the same published attempt, not a third');
});

test('the Attestations switches ride in the packet under the approval digest; a switch changed after approval does not reach that run', async () => {
  const dana = h.person('dana-attest'), read = () => h.call('GET', '/saved-answers', null, dana.sub);
  const off = (await h.call('GET', '/apply-review/7', null, dana.sub)).body;
  assert.deepEqual(off.attest, { terms: false, selfIdSignature: false });
  assert.deepEqual(off.attestLines, ['You tick the employer’s terms box yourself. Career hands it back to you there.',
    'You sign the self-identification form yourself. Career hands it back to you there.']);
  await h.call('POST', '/saved-answers', { revision: (await read()).body.revision, attest: { terms: true } }, dana.sub);
  const on = (await h.call('GET', '/apply-review/7', null, dana.sub)).body;
  assert.deepEqual(on.attest, { terms: true, selfIdSignature: false });
  assert.equal(on.attestLines[0], 'Career ticks the employer’s terms box for you, in your name.');
  assert.notEqual(on.packetDigest, off.packetDigest, 'the switches are under the approval digest');
  const { body: { run } } = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: on.packetDigest, approved: true }, dana.sub);
  assert.deepEqual(frozen(dana, run.id).task.attest, { terms: true, selfIdSignature: false }, 'the packet carries them');
  await h.call('POST', '/saved-answers', { revision: (await read()).body.revision, attest: { terms: false, selfIdSignature: true } }, dana.sub);
  assert.deepEqual(frozen(dana, run.id).task.attest, { terms: true, selfIdSignature: false }, 'the approved run keeps what was approved');
  assert.equal((await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: on.packetDigest, approved: true }, dana.sub)).code, 428, 'the digest he approved no longer approves the changed packet');
  const changed = (await h.call('GET', '/apply-review/7', null, dana.sub)).body;
  assert.deepEqual(changed.attest, { terms: false, selfIdSignature: true });
  assert.notEqual(changed.packetDigest, on.packetDigest, 'a changed switch is a different packet to approve');
});

test('the terms box is reached only through the site rules’ attest.terms slot; no fact is an attest key', async () => {
  const rules = (name) => JSON.parse(fs.readFileSync(new URL(`../lib/apply-profiles/${name}.json`, import.meta.url), 'utf8'));
  const terms = rules('workday').fields.filter((field) => field.slot === 'attest.terms');
  assert.equal(terms.length, 1, 'the Workday profile names attest.terms once');
  assert.deepEqual(terms[0].match.auto, ['agreementCheckbox'], 'on Voluntary Disclosures’ terms check box');
  assert.ok(terms[0].match.label.includes('I have read and consent to the terms and conditions'));
  assert.deepEqual(rules('workday').signature, { page: 'self-id', name: ['Name'], date: ['Date'] }, 'the signature uses the name and date of the self-id page');
  for (const site of ['workday', 'greenhouse', 'lever', 'ashby']) {
    const slots = rules(site).fields.map((field) => field.slot).filter((slot) => slot.startsWith('attest.'));
    assert.deepEqual(slots, ['attest.terms'], site + ': its terms box is the one attest slot');
  }
  const dana = h.person('dana-attest-slots'), { body } = await h.call('GET', '/apply-review/7', null, dana.sub);
  assert.equal(body.facts.some((fact) => fact.slot.startsWith('attest.')), false, 'the kernel refuses an attest fact; task.attest is the only source');
});

test('a start refused for want of a Job Apply computer fails the ticket; Go on then binds a fresh ticket and starts the same bytes once', async () => {
  const dana = h.person('dana-refused-device');
  const { body } = await h.call('GET', '/apply-review/7', null, dana.sub);
  const { body: { run } } = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest, approved: true }, dana.sub);
  const first = (await h.call('POST', `/apply-runs/${run.id}/bind`, {}, dana.sub)).body.run.nativeTicketId;
  h.port.refuseStart = Object.assign(Error('Choose your Job Apply computer in Career first.'), { code: 'apply_device_unavailable' });
  const refused = await h.call('POST', `/apply-runs/${run.id}/start`, {}, dana.sub);
  h.port.refuseStart = null;
  assert.equal(refused.body.code, 'apply_device_unavailable');
  h.port.ticketStatus.set(first, 'failed');
  const created = h.port.created.length, startedBefore = h.port.started.length;
  const goOn = await h.call('POST', `/apply-runs/${run.id}/go-on`, {}, dana.sub);
  assert.equal(goOn.code, 200, JSON.stringify(goOn.body));
  assert.equal(goOn.body.run.status, 'queued');
  assert.equal(h.port.created.length, created + 1, 'one fresh ticket');
  assert.notEqual(goOn.body.run.nativeTicketId, first, 'the run is bound to the fresh ticket');
  assert.equal(h.port.started.length, startedBefore + 1, 'started once');
  assert.equal(h.port.started.at(-1).ticketId, goOn.body.run.nativeTicketId);
  assert.deepEqual(JSON.parse(Buffer.from(h.port.started.at(-1).input.files[0].bytes).toString()), frozen(dana, run.id), 'the same approved input');
  const again = await h.call('POST', `/apply-runs/${run.id}/go-on`, {}, dana.sub);
  assert.equal(h.port.started.length, startedBefore + 1, 'a second Go on starts nothing more');
  assert.notEqual(again.code, 500);
});
