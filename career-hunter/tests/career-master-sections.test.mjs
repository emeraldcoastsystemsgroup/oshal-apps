/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise bounded master reads and exact revision edits through the launcher's actual Python programs on disposable large profiles.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-master-sections-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const filename = path.join(packageRoot, 'bin/oshal-jobhunter.js');
const cli = new Module(filename);
cli.filename = filename;
cli.paths = Module._nodeModulePaths(path.dirname(filename));
cli._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.mapping=engineRuns;', filename);
const fixture = {
  profile: { name: 'Synthetic Candidate', headline: 'Platform engineer', experience_summary: 'Recorded work only.', clearance: 'None' },
  roles: [{ title: 'Engineer', org: 'Fixture Co', start: '2010', end: null,
    deliverables: Array.from({ length: 39 }, (_, n) => 'Recorded bullet ' + n) }],
  skills: { Core: { note: 'preserve group metadata', items: Array.from({ length: 257 }, (_, n) => 'Skill ' + n) } },
  competencies: [' Delivery ', 'Reliability'], education: ['Master of Science, Fixture University, 2011'],
  certifications: ['Credential — expired 2020'], licenses: [], metrics_bank: ['Do not change'],
};
function store(name, value = fixture) {
  const dir = path.join(root, name); fs.mkdirSync(dir);
  const file = path.join(dir, 'career_db.json'); fs.writeFileSync(file, JSON.stringify(value));
  return { dir, file };
}
function invoke(s, verb, input) {
  const run = cli.exports.mapping('resume', [verb])[0];
  const result = spawnSync(process.env.CAREER_TEST_PYTHON || 'python3', run, {
    cwd: packageRoot, timeout: 20000, encoding: 'utf8', env: { ...process.env,
      JOBHUNTER_DATA: s.dir, JOBHUNTER_CAREER_DB: s.file, PYTHONPATH: path.join(packageRoot, 'engine'),
      CH_RESUME_DOC: JSON.stringify(input) },
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.ok(result.stdout.trim(), result.stderr);
  const value = JSON.parse(result.stdout.trim());
  assert.equal(result.status, value.ok === false ? 1 : 0, result.stderr);
  return value;
}
const revision = s => createHash('sha256').update(fs.readFileSync(s.file)).digest('hex');
const saved = s => JSON.parse(fs.readFileSync(s.file, 'utf8'));
const read = (s, field, index = 0, offset = 0) => invoke(s, 'base-section', { field, index, offset });

test('all 257 skills and 39 bullets are reachable with explicit bounded pages from the same revision', () => {
  const s = store('large');
  for (const [field, expected] of [['skills', fixture.skills.Core.items], ['experience', fixture.roles[0].deliverables]]) {
    const found = []; let offset = 0;
    do {
      const page = read(s, field, 0, offset);
      assert.equal(page.ok, true, JSON.stringify(page));
      assert.equal(page.revision, revision(s));
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 12288);
      found.push(...page.items.map(item => item.value));
      offset = page.nextOffset;
      assert.equal(page.complete, offset === null);
    } while (offset !== null);
    assert.deepEqual(found, expected);
  }
  assert.deepEqual(read(s, 'certifications').items.map(i => i.value), fixture.certifications);
  const overview = read(s, 'overview');
  assert.equal(overview.fields.find(f => f.field === 'education').editable, false);
  assert.equal(overview.items[0].value.title, 'Engineer');
});

test('small edits preserve role anchors, untouched whitespace, skill groups, qualifications and exact backup', () => {
  const s = store('edit'), preimage = fs.readFileSync(s.file, 'utf8');
  const result = invoke(s, 'base-patch', { revision: revision(s), edits: [
    { op: 'set', field: 'experience', roleIndex: 0, roleTitle: 'Engineer', index: 38, before: 'Recorded bullet 38', value: 'Clarified recorded bullet 38' },
    { op: 'set', field: 'skills', index: 256, before: 'Skill 256', value: 'Clarified skill' },
    { op: 'add', field: 'competencies', index: 2, before: '', value: 'Planning' },
  ] });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.changed, true);
  const current = saved(s);
  assert.equal(current.roles[0].deliverables[38], 'Clarified recorded bullet 38');
  assert.equal(current.roles[0].deliverables[0], fixture.roles[0].deliverables[0]);
  assert.deepEqual(current.competencies, [' Delivery ', 'Reliability', 'Planning']);
  assert.equal(current.skills.Core.note, fixture.skills.Core.note);
  assert.equal(current.skills.Core.items[256], 'Clarified skill');
  assert.deepEqual(current.education, fixture.education);
  assert.deepEqual(current.metrics_bank, fixture.metrics_bank);
  for (const key of ['title', 'org', 'start', 'end']) assert.equal(current.roles[0][key], fixture.roles[0][key]);
  const backups = fs.readdirSync(path.join(s.dir, 'backups'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(s.dir, 'backups', backups[0]), 'utf8'), preimage);
  assert.match(fs.readFileSync(path.join(s.dir, 'enrichment_log.jsonl'), 'utf8'), /bounded master edit/);
  assert.equal(result.revision, revision(s));
});

test('stale revision, wrong old text, role mismatch, credential edits and late invalid operations leave no partial writes', () => {
  const s = store('refusals'), old = fs.readFileSync(s.file, 'utf8');
  const good = { op: 'set', field: 'summary', before: fixture.profile.experience_summary, value: 'Changed summary.' };
  for (const edits of [
    [{ ...good, before: 'Not the current text' }],
    [good, { op: 'set', field: 'experience', roleIndex: 0, roleTitle: 'Other role', index: 0, before: 'Recorded bullet 0', value: 'No' }],
    [good, { op: 'add', field: 'certifications', index: 0, before: '', value: 'Invented credential' }],
    [good, { ...good, org: 'Invented employer' }],
    [good, { op: 'remove', field: 'skills', index: 9999, before: '' }],
  ]) {
    assert.equal(invoke(s, 'base-patch', { revision: revision(s), edits }).ok, false);
    assert.equal(fs.readFileSync(s.file, 'utf8'), old);
  }
  assert.equal(invoke(s, 'base-patch', { revision: '0'.repeat(64), edits: [good] }).error, 'master_changed');
  assert.equal(fs.existsSync(path.join(s.dir, 'backups')), false);
});

test('no-op edits create no backup and independent owner stores reject another revision', () => {
  const s = store('noop'), other = store('other', { ...fixture, profile: { ...fixture.profile, headline: 'Other owner' } });
  const result = invoke(s, 'base-patch', { revision: revision(s), edits: [
    { op: 'set', field: 'summary', before: fixture.profile.experience_summary, value: fixture.profile.experience_summary },
  ] });
  assert.equal(result.changed, false); assert.equal(fs.existsSync(path.join(s.dir, 'backups')), false);
  assert.equal(invoke(other, 'base-patch', { revision: revision(s), edits: [
    { op: 'set', field: 'headline', before: 'Other owner', value: 'Changed' },
  ] }).error, 'master_changed');
  assert.equal(saved(other).profile.headline, 'Other owner');
});

test('UTF-8 text pages preserve every character and explicit size/shape refusals never truncate', () => {
  const s = store('unicode', { ...fixture, profile: { ...fixture.profile, experience_summary: '漢😀'.repeat(5000) } });
  let offset = 0, combined = '';
  do { const page = read(s, 'summary', 0, offset); assert.equal(page.ok, true); combined += page.value; offset = page.nextOffset; } while (offset !== null);
  assert.equal(combined, '漢😀'.repeat(5000));
  for (const input of [{ field: 'skills', offset: true }, { field: 'summary', index: 1 }, { field: 'skills', offset: 1000 }, { field: 'unknown' }])
    assert.equal(invoke(s, 'base-section', input).ok, false);
  const tooBig = invoke(s, 'base-patch', { revision: revision(s), edits: [
    { op: 'set', field: 'summary', before: '漢😀'.repeat(5000), value: 'Short' },
  ] });
  assert.equal(tooBig.error, 'master_patch_too_large');
  assert.equal(saved(s).profile.experience_summary, '漢😀'.repeat(5000));
});

test('a full Studio save accepts an existing 257-skill and 39-bullet master', () => {
  const s = store('studio');
  const doc = invoke(s, 'base', {});
  doc.resume.summary = 'Clarified existing experience.';
  const outcome = invoke(s, 'base-save', { resume: doc.resume });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(saved(s).roles[0].deliverables.length, 39);
  assert.equal(saved(s).skills.Core.items.length, 257);
  assert.equal(saved(s).profile.experience_summary, 'Clarified existing experience.');
});

test('missing or corrupt profiles return a bounded refusal without exposing file paths', () => {
  const s = store('missing'); fs.unlinkSync(s.file);
  const missing = read(s, 'overview'); assert.equal(missing.ok, false);
  assert.ok(!JSON.stringify(missing).includes(s.dir));
  fs.writeFileSync(s.file, '{invalid');
  assert.equal(read(s, 'overview').ok, false);
});
