/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.4 (Roger, 2026-11-16 20:45Z: "i can not find where to see my expanded experience.. it doesnt show anywhere ... it covers like 20 different companies over a 4 year span when i was consulting in the field"). The client engagements (`project_ledger`) and client accounts (`named_accounts`) a person's main résumé holds, through the launcher's real Python programs on a made-up consultant's disposable profile: `resume base` lists every one whole and in saved order at every count and size (0, 1, 20 and 300 engagements, 128 bullets of 4,096 characters, a group of 500 names) with the job each was done under; one revision-checked patch adds, changes, places, moves and removes an engagement, its bullets and an account group, and Undo puts back the exact earlier profile; a wrong name or place, a bad month, a moved revision and a change past what job scoring reads change nothing; Download my data and the generation prompt carry what Work history saved.
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
import { CLIENTS, consultantProfile, ledgerEntry } from './helpers/career-engagements-fixture.mjs';

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const python = process.env.CAREER_TEST_PYTHON || 'python3';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-engagements-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const filename = path.join(packageRoot, 'bin/oshal-jobhunter.js');
const cli = new Module(filename);
cli.filename = filename;
cli.paths = Module._nodeModulePaths(path.dirname(filename));
cli._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.mapping=engineRuns;', filename);
const originalLoad = Module._load;
Module._load = function noSqlite(request, ...rest) {
  // The record reads no owner database here (the made-up person has none); its driver is never opened.
  if (request === 'better-sqlite3') return class { constructor() { throw new Error('no owner database in this fixture'); } };
  return originalLoad.call(this, request, ...rest);
};
let record;
try { record = require('../lib/career-master-record.js'); } finally { Module._load = originalLoad; }

let made = 0;
function store(value = consultantProfile()) {
  const dir = path.join(root, `person-${made += 1}`); fs.mkdirSync(dir);
  const file = path.join(dir, 'career_db.json'); fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return { dir, file };
}
const env = (s, extra = {}) => ({ ...process.env, JOBHUNTER_DATA: s.dir, JOBHUNTER_CAREER_DB: s.file, PYTHONPATH: path.join(packageRoot, 'engine'), ...extra });
function invoke(s, verb, input = {}) {
  const run = cli.exports.mapping('resume', [verb])[0];
  const result = spawnSync(python, run, { cwd: packageRoot, timeout: 60000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: env(s, { CH_RESUME_DOC: JSON.stringify(input) }) });
  assert.equal(result.error, undefined, String(result.error));
  assert.ok(result.stdout.trim(), result.stderr);
  return { answer: JSON.parse(result.stdout.trim()), bytes: result.stdout.length };
}
const base = (s) => invoke(s, 'base').answer;
const revision = (s) => createHash('sha256').update(fs.readFileSync(s.file)).digest('hex');
const saved = (s) => JSON.parse(fs.readFileSync(s.file, 'utf8'));
const patch = (s, edits) => invoke(s, 'base-patch', { revision: revision(s), edits }).answer;
const named = (s, n) => saved(s).project_ledger[n].project;

test('Work history reads every client engagement and account group whole, in saved order, with the job each was done under', () => {
  const s = store(), fixture = consultantProfile();
  const doc = base(s);
  assert.equal(doc.revision, revision(s));
  const { engagements, accounts, addendum } = doc.expanded;
  assert.equal(engagements.length, 20, 'all 20 engagements of the four-year field job');
  assert.deepEqual(engagements.map((e) => e.project), fixture.project_ledger.map((e) => e.project));
  assert.deepEqual(engagements.map((e) => [e.role, e.industry, e.months, e.tech]),
    fixture.project_ledger.map((e) => [e.role, e.industry, e.duration_months, e.tech]));
  assert.deepEqual([engagements[0].start, engagements[0].end, engagements[0].bullets], ['2018-02', '2018-04', fixture.project_ledger[0].bullets]);
  assert.deepEqual(engagements.filter((e) => !e.public).map((e) => e.index), [7], 'marked not public is shown as recorded');
  assert.deepEqual(engagements[9].other, [['Notes', 'Weekend cutover crew']], 'a detail the page has no field for is still shown');
  assert.ok(engagements.every((e) => e.job === null), 'none is tied to a job yet');
  assert.deepEqual(accounts.map((g) => [g.key, g.label, g.items.length]),
    [['field_clients', 'Field clients', 12], ['federal_agencies', 'Federal agencies', 3], ['channel_partners', 'Channel partners', 2]]);
  assert.deepEqual(accounts[0].items, CLIENTS.slice(0, 12).map(([client]) => client));
  assert.equal(addendum, 'https://example.test/casey-detailed-work-addendum.pdf');
  assert.deepEqual(doc.resume.experience.map((role) => role.title), fixture.roles.map((role) => role.title), 'the jobs read as before');
});

test('nothing is cut at any count or size: 0, 1, 20 and 300 engagements, 128 bullets of 4,096 characters, 500 names in a group', () => {
  const long = (n) => `Bullet ${n} ` + 'x'.repeat(4096 - `Bullet ${n} `.length);
  for (const count of [0, 1, 20, 300]) {
    const ledger = Array.from({ length: count }, (_, n) => ({ ...ledgerEntry(n), project: `Engagement ${n + 1} ${ledgerEntry(n).project}` }));
    if (count) ledger[count - 1].bullets = Array.from({ length: 128 }, (_, n) => long(n));
    const names = Array.from({ length: 500 }, (_, n) => `Client account ${n + 1}`);
    const s = store({ ...consultantProfile(), project_ledger: ledger, named_accounts: { all_clients: names } });
    const { engagements, accounts } = base(s).expanded;
    assert.equal(engagements.length, count, `${count} engagements listed`);
    assert.deepEqual(engagements.map((e) => e.project), ledger.map((e) => e.project));
    if (count) {
      assert.equal(engagements[count - 1].bullets.length, 128);
      assert.ok(engagements[count - 1].bullets.every((b, n) => b === long(n) && b.length === 4096), 'every bullet whole');
    }
    assert.deepEqual(accounts[0].items, names);
    const r = record.readMasterRecord({ userDir: s.dir });
    assert.equal(r.evidence.projects.length, count, 'Download my data lists them all too');
    if (count) assert.ok(r.markdown.includes(long(127)), 'and the last bullet whole');
  }
});

test('an engagement is added under a job with its months, length, technology and bullets, then changed, placed, moved and removed; Undo puts the exact profile back', () => {
  const s = store(), preimage = fs.readFileSync(s.file, 'utf8'), before = revision(s);
  const job = { index: 1, title: 'Field Implementation Consultant' };
  const added = patch(s, [
    { op: 'add', field: 'engagement', index: 20, before: '', value: { project: 'Sample Rail signalling upgrade', role: 'Lead consultant', industry: 'Rail',
      start: '2021-03', end: '2021-06', months: 3, tech: ['SQL', 'Kafka'], job, public: true }, summary: 'Add Sample Rail signalling upgrade' },
    { op: 'add', field: 'engagement-bullet', engagementIndex: 20, engagementName: 'Sample Rail signalling upgrade', index: 0, before: '', value: 'Cut signal faults by 30%' },
    { op: 'add', field: 'engagement-bullet', engagementIndex: 20, engagementName: 'Sample Rail signalling upgrade', index: 1, before: '', value: 'Ran the night cutover' },
  ]);
  assert.equal(added.ok, true, JSON.stringify(added));
  const entry = saved(s).project_ledger[20];
  assert.deepEqual(entry, { project: 'Sample Rail signalling upgrade', role: 'Lead consultant', industry: 'Rail', start: '2021-03', end: '2021-06',
    duration_months: 3, tech: ['SQL', 'Kafka'], job: 'r2', bullets: ['Cut signal faults by 30%', 'Ran the night cutover'] });
  assert.deepEqual(base(s).expanded.engagements[20].job, { index: 1, title: 'Field Implementation Consultant', org: 'Example Systems Group' });
  // Place three of the old ones under the field job, change one's details, then move and remove.
  const placed = patch(s, [0, 1, 2].map((n) => ({ op: 'set', field: 'engagement', index: n, before: named(s, n), value: { job } })));
  assert.equal(placed.ok, true, JSON.stringify(placed));
  assert.deepEqual(saved(s).project_ledger.slice(0, 3).map((e) => e.job), ['r2', 'r2', 'r2']);
  const changed = patch(s, [{ op: 'set', field: 'engagement', index: 2, before: named(s, 2),
    value: { project: 'Tailspin Air crew scheduling', role: 'Solution architect', industry: 'Aviation', start: '2018-09', end: '', months: null, tech: [], job: null, public: false } }]);
  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.deepEqual(saved(s).project_ledger[2], { project: 'Tailspin Air crew scheduling', role: 'Solution architect', industry: 'Aviation', start: '2018-09', public: false },
    'an emptied length, technology and job take their keys away; marked not public is kept as false');
  const moved = patch(s, [{ op: 'move', field: 'engagement', index: 20, before: 'Sample Rail signalling upgrade', to: 0 }]);
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(named(s, 0), 'Sample Rail signalling upgrade');
  const removed = patch(s, [{ op: 'remove', field: 'engagement', index: 0, before: 'Sample Rail signalling upgrade' }]);
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.equal(saved(s).project_ledger.length, 20);
  assert.deepEqual(saved(s).roles, consultantProfile().roles, 'the jobs are untouched (the field job already had its id)');
  const undone = invoke(s, 'base-undo', { revision: removed.revision, restore: moved.revision }).answer;
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(named(s, 0), 'Sample Rail signalling upgrade', 'Undo brings the removed engagement back');
  const backups = fs.readdirSync(path.join(s.dir, 'backups')).sort();
  assert.equal(fs.readFileSync(path.join(s.dir, 'backups', backups[0]), 'utf8'), preimage, 'the first change kept the exact earlier profile');
  assert.notEqual(before, revision(s));
});

test('an engagement\'s bullets are added, changed, moved and removed, and a pasted block becomes one bullet per line', () => {
  const s = store(), name = named(s, 0), at = { engagementIndex: 0, engagementName: name };
  const result = patch(s, [
    { op: 'set', field: 'engagement-bullet', ...at, index: 0, before: 'Moved 14 warehouses onto one picking system', value: 'Moved 14 warehouses onto one picking system in 9 weeks' },
    { op: 'move', field: 'engagement-bullet', ...at, index: 1, before: 'Trained 60 floor leads', to: 0 },
    { op: 'add', field: 'engagement-bullet', ...at, index: 2, before: '', value: '• Wrote the cutover runbook\n• Stayed on site for go-live' },
  ]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(saved(s).project_ledger[0].bullets, ['Trained 60 floor leads', 'Moved 14 warehouses onto one picking system in 9 weeks',
    'Wrote the cutover runbook', 'Stayed on site for go-live']);
  const cleared = patch(s, saved(s).project_ledger[0].bullets.map((text) => ({ op: 'remove', field: 'engagement-bullet', ...at, index: 0, before: text })));
  assert.equal(cleared.ok, true, JSON.stringify(cleared));
  assert.equal('bullets' in saved(s).project_ledger[0], false, 'no bullets left takes the key away');
});

test('client account groups are added, changed and removed, each named by its exact names', () => {
  const s = store(), fixture = consultantProfile();
  const result = patch(s, [
    { op: 'set', field: 'accounts', key: 'channel_partners', before: ['Partner One', 'Partner Two'], value: ['Partner One', 'Partner Three'] },
    { op: 'add', field: 'accounts', key: 'Rail clients', before: [], value: ['Sample Rail', 'Example Transit'] },
    { op: 'remove', field: 'accounts', key: 'federal_agencies', before: fixture.named_accounts.federal_agencies },
  ]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(saved(s).named_accounts, { field_clients: fixture.named_accounts.field_clients, channel_partners: ['Partner One', 'Partner Three'],
    'Rail clients': ['Sample Rail', 'Example Transit'] });
  assert.deepEqual(base(s).expanded.accounts.map((g) => g.label), ['Field clients', 'Channel partners', 'Rail clients']);
});

test('a wrong name or place, a bad month, an unknown detail, a job that moved, a moved revision and a change past what scoring reads change nothing', () => {
  const s = store(), old = fs.readFileSync(s.file, 'utf8'), name0 = named(s, 0);
  const set = (value, index = 0, before = name0) => ({ op: 'set', field: 'engagement', index, before, value });
  for (const edits of [
    [set({ role: 'Lead' }, 0, 'Some other client')],
    [set({ role: 'Lead' }, 25)],
    [set({ start: '2018-13' })],
    [set({ start: 'March 2018' })],
    [set({ start: '2019-01', end: '2018-06' })],
    [set({ months: 0 })],
    [set({ months: '3' })],
    [set({ salary: '100' })],
    [set({ project: '   ' })],
    [set({ job: { index: 1, title: 'Business Analyst' } })],
    [set({ job: { index: 7, title: 'Field Implementation Consultant' } })],
    [{ op: 'add', field: 'engagement', index: 0, before: '', value: { role: 'No name' } }],
    [{ op: 'add', field: 'engagement', index: 99, before: '', value: { project: 'Past the end' } }],
    [{ op: 'split', field: 'engagement', index: 0, before: name0 }],
    [{ op: 'add', field: 'engagement-bullet', engagementIndex: 0, engagementName: name0, index: 0, before: 'not the first bullet', value: 'New' }],
    [{ op: 'set', field: 'engagement-bullet', engagementIndex: 0, engagementName: name0, index: 0, before: 'Moved 14 warehouses onto one picking system', value: 'y'.repeat(4097) }],
    [{ op: 'set', field: 'accounts', key: 'field_clients', before: ['Contoso Freight'], value: ['Changed'] }],
    [{ op: 'add', field: 'accounts', key: 'Field clients', before: [], value: ['Duplicate group name'] }],
    [set({ role: 'Lead' }), { op: 'set', field: 'role', roleIndex: 0, roleTitle: 'Principal Consultant', key: 'end', before: 'not empty', value: '2026-01' }],
  ]) {
    const outcome = patch(s, edits);
    assert.equal(outcome.ok, false, JSON.stringify(edits));
    assert.equal(fs.readFileSync(s.file, 'utf8'), old, JSON.stringify(edits));
  }
  const moved = invoke(s, 'base-patch', { revision: '0'.repeat(64), edits: [set({ role: 'Lead' })] }).answer;
  assert.deepEqual([moved.ok, moved.error], [false, 'master_changed']);
  assert.match(moved.message, /changed while this page was open/);
  // Job scoring reads the whole main résumé and refuses one over 128 KiB: a change that would grow it past that is refused in words.
  const bulky = (n) => ({ op: 'add', field: 'engagement-bullet', engagementIndex: 1, engagementName: named(s, 1), index: n, before: '', value: `Detail ${n} ` + 'z'.repeat(4000) });
  let outcome;
  for (let round = 0; round < 24 && !(outcome && outcome.ok === false); round += 1) {
    const have = (saved(s).project_ledger[1].bullets || []).length;
    outcome = patch(s, [0, 1].map((k) => bulky(have + k)));
  }
  assert.equal(outcome.ok, false, 'the change past 128 KiB is refused');
  assert.match(outcome.error, /at most 128 KB; with this change it would be \d+ KB/);
  assert.ok(Buffer.byteLength(JSON.stringify(saved(s))) <= 128 * 1024, 'what was saved stays within what scoring reads');
  assert.equal(fs.existsSync(path.join(s.dir, 'backups')), true);
});

test('the largest main résumé this editor allows reads whole within the engine answer Career\'s routes keep (200,000 characters)', () => {
  const s = store(), bullets = (n) => Array.from({ length: 6 }, (_, k) => `Engagement ${n} detail ${k} ` + 'w'.repeat(900));
  const fixture = consultantProfile();
  fixture.project_ledger = fixture.project_ledger.map((entry, n) => ({ ...entry, bullets: bullets(n) }));
  fs.writeFileSync(s.file, JSON.stringify(fixture));
  assert.ok(fs.statSync(s.file).size > 100 * 1024 && fs.statSync(s.file).size < 128 * 1024, 'near the scoring limit');
  const { answer, bytes } = invoke(s, 'base');
  assert.ok(bytes < 200000, `the answer is ${bytes} characters`);
  assert.deepEqual(answer.expanded.engagements.map((e) => e.bullets), fixture.project_ledger.map((e) => e.bullets));
});

test('Download my data and the generation prompt carry an engagement saved on Work history: dates, length, technology, bullets and its job', () => {
  const s = store(), job = { index: 1, title: 'Field Implementation Consultant' };
  const result = patch(s, [
    { op: 'set', field: 'engagement', index: 2, before: named(s, 2), value: { start: '2018-08', end: '2018-11', job } },
    { op: 'add', field: 'engagement-bullet', engagementIndex: 2, engagementName: named(s, 2), index: 0, before: '', value: 'Rebuilt crew pairing for 400 pilots' },
  ]);
  assert.equal(result.ok, true, JSON.stringify(result));
  const line = record.readMasterRecord({ userDir: s.dir }).evidence.projects[2];
  assert.equal(line, 'Tailspin Air crew scheduling — Implementation consultant · Aviation · 2018-08–2018-11 · 3 months. '
    + 'Done under Field Implementation Consultant at Example Systems Group. Technology: SQL, Python, Tool 3. What was done: Rebuilt crew pairing for 400 pilots');
  const program = 'import json,sys\nfrom jobhunter import config, generate, profile\nprofile.load.cache_clear()\n'
    + 'print(generate.build_prompt(profile.load(), "Sample Airline", "Crew Systems Lead", "Remote", "Lead crew scheduling systems."))';
  const prompt = spawnSync(python, ['-c', program], { cwd: packageRoot, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, env: env(s) });
  assert.equal(prompt.status, 0, prompt.stderr);
  const sent = JSON.parse(prompt.stdout.slice(prompt.stdout.indexOf('{'), prompt.stdout.indexOf('\n\nTARGET JOB:')));
  assert.deepEqual(sent.project_ledger[2], { ...ledgerEntry(2), start: '2018-08', end: '2018-11', job: 'r2', bullets: ['Rebuilt crew pairing for 400 pilots'] });
  assert.equal(sent.project_ledger.length, 20, 'every engagement reaches the generator');
  assert.equal(sent.roles.find((role) => role.id === 'r2').title, 'Field Implementation Consultant', 'the job it names is in the same input');
});
