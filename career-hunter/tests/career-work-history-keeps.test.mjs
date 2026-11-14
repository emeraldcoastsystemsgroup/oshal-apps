/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2 (Roger, 2026-11-13 ~22:16Z: the concierge saw an employer other than the one he asked for, and wording an earlier approved card had added was no longer there). Applied cards keep what they wrote, checked on a made-up person's disposable profile through the launcher's real Python programs and Career's Word-document mapping (tools/career-resume-office.js) over a fake AI Office: a second card keeps the first card's employers, months and bullets; a Word document that is behind only on job headings or dates is brought up to date after a change, so the save before the next concierge turn on My résumé does not write older bullets back; and a document made before a card removed two jobs and added two never puts the removed jobs' bullets into the new ones.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const office = createRequire(import.meta.url)('../tools/career-resume-office.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-work-history-keeps-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const filename = path.join(packageRoot, 'bin/oshal-jobhunter.js');
const cli = new Module(filename);
cli.filename = filename;
cli.paths = Module._nodeModulePaths(path.dirname(filename));
cli._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.mapping=engineRuns;', filename);

const fixture = {
  profile: { name: 'Pat Example', headline: 'Engineer', experience_summary: 'Made-up summary.', clearance: 'None' },
  roles: [
    { title: 'Principal Engineer', org: 'Example Freight Co', start: '2019-03', end: null, deliverables: ['Shipped the routing service', 'Cut deploy time 40%'] },
    { title: 'Contract Developer', org: 'Placeholder Studio', start: '2018-01', end: '2019-02', deliverables: ['Built three client sites'] },
    { title: 'Software Engineer', org: 'Sample Bank', start: '2014-06', end: '2017-12', deliverables: ['Built the payments ledger'] },
    { title: 'Lab Assistant', org: 'Demo University Lab', start: '2012-09', end: '2014-05', deliverables: ['Kept the lab running'] },
  ],
  skills: { Core: { items: ['Rust'] } },
};
let stores = 0;
function store(value = fixture) {
  const dir = path.join(root, 'store-' + ++stores); fs.mkdirSync(dir);
  const file = path.join(dir, 'career_db.json'); fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return { dir, file };
}
function invoke(s, verb, input = {}) {
  const run = cli.exports.mapping('resume', [verb])[0];
  const result = spawnSync(process.env.CAREER_TEST_PYTHON || 'python3', run, {
    cwd: packageRoot, timeout: 20000, encoding: 'utf8', env: { ...process.env,
      JOBHUNTER_DATA: s.dir, JOBHUNTER_CAREER_DB: s.file, PYTHONPATH: path.join(packageRoot, 'engine'), CH_RESUME_DOC: JSON.stringify(input) },
  });
  assert.ok(result.stdout.trim(), result.stderr);
  return JSON.parse(result.stdout.trim());
}
const revision = s => createHash('sha256').update(fs.readFileSync(s.file)).digest('hex');
const patch = (s, edits) => { const answer = invoke(s, 'base-patch', { revision: revision(s), edits }); assert.equal(answer.ok, true, JSON.stringify(answer)); return answer; };
const at = (roleIndex, roleTitle) => ({ roleIndex, roleTitle });
const newJob = (index, title, org, start, end, bullet) => [
  { op: 'add', field: 'role', index, before: '', value: title, summary: `Add ${title} at ${org}` },
  { op: 'set', field: 'role', ...at(index, title), key: 'org', before: '', value: org },
  { op: 'set', field: 'role', ...at(index, title), key: 'start', before: '', value: start },
  ...(end ? [{ op: 'set', field: 'role', ...at(index, title), key: 'end', before: '', value: end }] : []),
  { op: 'add', field: 'experience', ...at(index, title), index: 0, before: '', value: bullet },
];
// The first card of Roger's thread: end a job's date and add three jobs, each with its employer and a bullet.
const FIRST_CARD = [
  { op: 'set', field: 'role', ...at(0, 'Principal Engineer'), key: 'end', before: '', value: '2023-12', summary: 'End Principal Engineer at Dec 2023' },
  ...newJob(0, 'Founder', 'Gulf Coast Test Works', '2024-01', '', 'Runs a three-person software studio'),
  ...newJob(1, 'Advisor', 'Harbor Robotics', '2024-03', '', 'Advises on fleet software'),
  ...newJob(2, 'Volunteer Mentor', 'Code Coast', '2022-01', '2023-06', 'Mentored ten new developers'),
];
const FIRST_WRITES = [['Founder', 'Gulf Coast Test Works', null, ['Runs a three-person software studio']],
  ['Advisor', 'Harbor Robotics', null, ['Advises on fleet software']], ['Volunteer Mentor', 'Code Coast', '2023-06', ['Mentored ten new developers']],
  ['Principal Engineer', 'Example Freight Co', '2023-12', fixture.roles[0].deliverables]];
const jobs = doc => doc.resume.experience.map(role => [role.title, role.org, role.end || null, role.bullets]);

test('a second card keeps every employer, month and bullet the first card wrote', () => {
  const s = store();
  patch(s, FIRST_CARD);
  assert.deepEqual(jobs(invoke(s, 'base')).slice(0, 4), FIRST_WRITES);
  patch(s, [
    { op: 'add', field: 'experience', ...at(0, 'Founder'), index: 1, before: '', value: 'Hired and led a team of four engineers' },
    { op: 'remove', field: 'role', ...at(6, 'Lab Assistant'), before: 'Lab Assistant', index: 6 },
    { op: 'remove', field: 'role', ...at(4, 'Contract Developer'), before: 'Contract Developer', index: 4 },
  ]);
  const after = jobs(invoke(s, 'base'));
  assert.deepEqual(after.map(row => row[0]), ['Founder', 'Advisor', 'Volunteer Mentor', 'Principal Engineer', 'Software Engineer']);
  assert.deepEqual(after[0], ['Founder', 'Gulf Coast Test Works', null, ['Runs a three-person software studio', 'Hired and led a team of four engineers']]);
  assert.deepEqual(after.slice(1, 4), FIRST_WRITES.slice(1, 4));
});

/** AI Office's document routes as Career calls them: list, read and add a revision, over in-memory documents. */
function fakeOffice(documents) {
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  return async (url, init = {}) => {
    const method = init.method || 'GET', one = url.match(/^\/api\/presentations\/editor\/documents\/([^/]+)(\/revisions)?$/);
    if (url === '/api/presentations/editor/documents' && method === 'GET')
      return reply(200, { documents: [...documents.values()].map(({ id, kind, title }) => ({ id, kind, title })) });
    if (one && !one[2] && method === 'GET' && documents.has(one[1])) return reply(200, { document: documents.get(one[1]) });
    if (one && one[2] && method === 'POST' && documents.has(one[1])) {
      const doc = documents.get(one[1]), body = JSON.parse(init.body);
      assert.equal(body.baseRevision, doc.revision, 'a revision is written on the revision it read');
      documents.set(one[1], { ...doc, revision: doc.revision + 1, model: body.model });
      return reply(201, { document: documents.get(one[1]) });
    }
    return reply(404, { error: `not in fixture: ${method} ${url}` });
  };
}
async function withOffice(model, work) {
  const documents = new Map([['doc-1', { id: 'doc-1', kind: 'docx', title: office.TITLE, revision: 1, model }]]);
  const prior = globalThis.fetch; globalThis.fetch = fakeOffice(documents);
  try { return await work(documents); } finally { globalThis.fetch = prior; }
}

test('a Word document behind only on a job\'s dates is brought up to date after the next change, so My résumé\'s save keeps the change', async () => {
  const s = store(), first = invoke(s, 'base');
  const model = office.resumeToModel(first.resume, first.meta);
  // A date changed where no Word document was in view (the Word document is now behind on that dates line only).
  patch(s, [{ op: 'set', field: 'role', ...at(2, 'Software Engineer'), key: 'end', before: '2017-12', value: '2018-02' }]);
  const before = invoke(s, 'base');
  assert.equal(office.documentState(model, before.resume), 'headings', 'nothing typed in it; only a dates line is behind');
  // On Work history: an approved card adds a bullet, and the page brings the Word document along (followInWord).
  patch(s, [{ op: 'add', field: 'experience', ...at(0, 'Principal Engineer'), index: 2, before: '', value: 'Led the move to event sourcing' }]);
  const later = invoke(s, 'base');
  await withOffice(model, async (documents) => {
    assert.equal(await office.syncDocument(before, later), 'updated');
    // The save My résumé makes before the next concierge turn: the document now says what the main résumé says.
    const mapped = office.modelToResume(documents.get('doc-1').model, later.resume);
    assert.equal(mapped.error, undefined, mapped.error);
    assert.equal(office.sameResume(mapped.resume, later.resume), true, 'the save changes nothing');
    assert.deepEqual(mapped.resume.experience[0].bullets, ['Shipped the routing service', 'Cut deploy time 40%', 'Led the move to event sourcing']);
  });
});

test('a document made before a card removed two jobs and added two never puts the removed jobs\' bullets into the new ones', () => {
  const s = store(), first = invoke(s, 'base'), model = office.resumeToModel(first.resume, first.meta);
  patch(s, [
    // Numbered as each earlier edit leaves the list, which 1.61.1 also applies, so this case isolates the document.
    { op: 'remove', field: 'role', ...at(1, 'Contract Developer'), before: 'Contract Developer' },
    { op: 'remove', field: 'role', ...at(2, 'Lab Assistant'), before: 'Lab Assistant' },
    ...newJob(0, 'Founder', 'Gulf Coast Test Works', '2024-01', '', 'Runs a three-person software studio'),
    ...newJob(1, 'Advisor', 'Harbor Robotics', '2024-03', '', 'Advises on fleet software'),
  ]);
  const now = invoke(s, 'base');
  assert.equal(now.resume.experience.length, first.resume.experience.length, 'the same number of jobs, different jobs');
  const mapped = office.modelToResume(model, now.resume);
  assert.equal(mapped.resume, undefined, 'nothing is saved from a document whose jobs are other jobs');
  assert.match(mapped.error, /Job 1 in this document is "Principal Engineer — Example Freight Co" and job 1 in your Work history is "Founder — Gulf Coast Test Works"\. Press Use my work history/);
  assert.equal(office.documentState(model, now.resume), 'jobs');
  // A heading typed in the document is still the same job (its dates line and bullets agree): its bullets save there.
  const typed = office.resumeToModel(first.resume, first.meta);
  const heading = typed.pages[0].blocks.find(block => block.runs[0].text === 'Lab Assistant — Demo University Lab');
  heading.runs = [{ ...heading.runs[0], text: 'Lab Lead — Demo University Lab' }];
  const kept = office.modelToResume(typed, first.resume);
  assert.equal(kept.error, undefined);
  assert.deepEqual(kept.resume.experience[3].bullets, ['Kept the lab running']);
});
