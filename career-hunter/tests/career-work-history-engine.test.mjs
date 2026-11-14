/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0 (Roger, 2026-11-13: "we are missing the page to put in my experience and ... the concierge should be able to make the changes"): a job's title, employer, start and end month, a new job, a removed or moved job and moved bullets go through the launcher's real Python programs as one revision-checked patch on a made-up person's disposable profile, and Undo puts back the exact earlier profile only while nothing changed after it.
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
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-work-history-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const filename = path.join(packageRoot, 'bin/oshal-jobhunter.js');
const cli = new Module(filename);
cli.filename = filename;
cli.paths = Module._nodeModulePaths(path.dirname(filename));
cli._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.mapping=engineRuns;', filename);
const fixture = {
  profile: { name: 'Olive Testperson', headline: 'Systems engineer', experience_summary: 'Made-up summary.', clearance: 'None' },
  roles: [
    { id: 'r1', title: 'Principal Engineer', org: 'Example Freight Co', start: '2019-03', end: null, skills: ['Rust'],
      deliverables: ['Shipped the routing service', 'Cut deploy time 40%'],
      stories: [{ title: 'Outage', story: 'Restored service in nine minutes.', bullet: 'Shipped the routing service' }] },
    { id: 'r2', title: 'Software Engineer', org: 'Sample Bank', start: '2014-06', end: '2019-02',
      deliverables: ['Built the payments ledger', 'Wrote the on-call runbook'] },
  ],
  skills: { Core: { items: ['Rust', 'PostgreSQL'] } },
  education: ['BS Computer Science, Fixture University, 2014'],
};
function store(name, value = fixture) {
  const dir = path.join(root, name); fs.mkdirSync(dir);
  const file = path.join(dir, 'career_db.json'); fs.writeFileSync(file, JSON.stringify(value, null, 2));
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
  return JSON.parse(result.stdout.trim());
}
const revision = s => createHash('sha256').update(fs.readFileSync(s.file)).digest('hex');
const saved = s => JSON.parse(fs.readFileSync(s.file, 'utf8'));
const patch = (s, edits) => invoke(s, 'base-patch', { revision: revision(s), edits });
const anchor = (roleIndex, roleTitle) => ({ roleIndex, roleTitle });

test('the main résumé document names its exact revision and each job\'s start and end month', () => {
  const s = store('document');
  const doc = invoke(s, 'base', {});
  assert.equal(doc.revision, revision(s));
  assert.deepEqual(doc.resume.experience.map(role => [role.title, role.org, role.start, role.end, role.span]), [
    ['Principal Engineer', 'Example Freight Co', '2019-03', '', '2019-03–present'],
    ['Software Engineer', 'Sample Bank', '2014-06', '2019-02', '2014-06–2019-02'],
  ]);
  const overview = invoke(s, 'base-section', { field: 'overview', index: 0, offset: 0 });
  assert.deepEqual(overview.items.map(item => [item.value.start, item.value.end]), [['2019-03', ''], ['2014-06', '2019-02']]);
  const role = invoke(s, 'base-section', { field: 'experience', index: 1, offset: 0 });
  assert.deepEqual([role.role.start, role.role.end], ['2014-06', '2019-02']);
});

test('a job\'s title, employer and dates change in one revision-checked patch with an exact backup', () => {
  const s = store('anchors'), preimage = fs.readFileSync(s.file, 'utf8');
  const result = patch(s, [
    { op: 'set', field: 'role', ...anchor(1, 'Software Engineer'), key: 'start', before: '2014-06', value: '2013-09', summary: 'Start of Software Engineer at Sample Bank: Jun 2014 to Sep 2013' },
    { op: 'set', field: 'role', ...anchor(1, 'Software Engineer'), key: 'org', before: 'Sample Bank', value: 'Sample Bank N.A.' },
    { op: 'set', field: 'role', ...anchor(1, 'Software Engineer'), key: 'title', before: 'Software Engineer', value: 'Senior Software Engineer' },
    { op: 'set', field: 'role', ...anchor(0, 'Principal Engineer'), key: 'end', before: '', value: '2026-10' },
  ]);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.changed, true);
  const current = saved(s);
  assert.deepEqual([current.roles[1].title, current.roles[1].org, current.roles[1].start, current.roles[1].end], ['Senior Software Engineer', 'Sample Bank N.A.', '2013-09', '2019-02']);
  assert.equal(current.roles[0].end, '2026-10');
  assert.deepEqual(current.roles[0].stories, fixture.roles[0].stories);
  assert.deepEqual(current.roles[1].deliverables, fixture.roles[1].deliverables);
  const present = patch(s, [{ op: 'set', field: 'role', ...anchor(0, 'Principal Engineer'), key: 'end', before: '2026-10', value: '' }]);
  assert.equal(present.ok, true, JSON.stringify(present));
  assert.equal(saved(s).roles[0].end, null, 'present is stored as no end, as an upload stores it');
  const backups = fs.readdirSync(path.join(s.dir, 'backups')).sort();
  assert.equal(fs.readFileSync(path.join(s.dir, 'backups', backups[0]), 'utf8'), preimage);
  assert.equal(result.changelog.some(line => /role 2 .*start/.test(line)), true, JSON.stringify(result.changelog));
});

test('a new job with its bullets lands in one patch, then bullets and jobs move and a job is removed', () => {
  const s = store('add');
  const added = patch(s, [
    { op: 'add', field: 'role', index: 0, before: '', value: 'Staff Engineer', summary: 'Add Staff Engineer at Northwind Labs' },
    { op: 'set', field: 'role', ...anchor(0, 'Staff Engineer'), key: 'org', before: '', value: 'Northwind Labs' },
    { op: 'set', field: 'role', ...anchor(0, 'Staff Engineer'), key: 'start', before: '', value: '2026-11' },
    { op: 'add', field: 'experience', ...anchor(0, 'Staff Engineer'), index: 0, before: '', value: 'Leads the platform group' },
    { op: 'add', field: 'experience', ...anchor(0, 'Staff Engineer'), index: 1, before: '', value: 'Owns the reliability budget' },
  ]);
  assert.equal(added.ok, true, JSON.stringify(added));
  let roles = saved(s).roles;
  assert.deepEqual(roles.map(role => role.title), ['Staff Engineer', 'Principal Engineer', 'Software Engineer']);
  assert.deepEqual([roles[0].org, roles[0].start, roles[0].end, roles[0].deliverables], ['Northwind Labs', '2026-11', null, ['Leads the platform group', 'Owns the reliability budget']]);
  assert.ok(roles[0].id && !['r1', 'r2'].includes(roles[0].id), 'a new job gets its own id');
  const moved = patch(s, [
    { op: 'move', field: 'experience', ...anchor(0, 'Staff Engineer'), index: 1, to: 0, before: 'Owns the reliability budget' },
    { op: 'move', field: 'role', ...anchor(0, 'Staff Engineer'), before: 'Staff Engineer', to: 2 },
  ]);
  assert.equal(moved.ok, true, JSON.stringify(moved));
  roles = saved(s).roles;
  assert.deepEqual(roles.map(role => role.title), ['Principal Engineer', 'Software Engineer', 'Staff Engineer']);
  assert.deepEqual(roles[2].deliverables, ['Owns the reliability budget', 'Leads the platform group']);
  const removed = patch(s, [{ op: 'remove', field: 'role', ...anchor(2, 'Staff Engineer'), before: 'Staff Engineer' }]);
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.deepEqual(saved(s).roles.map(role => role.id), ['r1', 'r2']);
});

test('bad months, an end before its start, an empty title or employer, a wrong job and a stale revision change nothing', () => {
  const s = store('refusals'), old = fs.readFileSync(s.file, 'utf8');
  const set = (key, before, value, roleIndex = 1, roleTitle = 'Software Engineer') => ({ op: 'set', field: 'role', ...anchor(roleIndex, roleTitle), key, before, value });
  for (const edits of [
    [set('start', '2014-06', '2014-13')],
    [set('start', '2014-06', 'June 2014')],
    [set('end', '2019-02', '2012-01')],
    [set('title', 'Software Engineer', '   ')],
    [set('org', 'Sample Bank', '')],
    [set('start', '2014-05', '2013-01')],
    [set('start', '2014-06', '2013-01', 1, 'Principal Engineer')],
    [set('id', 'r2', 'r9')],
    [{ op: 'add', field: 'role', index: 0, before: '', value: 'Half-made job' }],
    [{ op: 'add', field: 'role', index: 9, before: '', value: 'Past the end' }],
    [{ op: 'remove', field: 'role', ...anchor(0, 'Principal Engineer'), before: 'Another title' }],
    [{ op: 'move', field: 'experience', ...anchor(0, 'Principal Engineer'), index: 0, to: 5, before: 'Shipped the routing service' }],
    [set('start', '2014-06', '2013-01'), { op: 'set', field: 'summary', before: 'Made-up summary.', value: 'Changed', summary: 7 }],
  ]) {
    const outcome = patch(s, edits);
    assert.equal(outcome.ok, false, JSON.stringify(edits));
    assert.equal(fs.readFileSync(s.file, 'utf8'), old, JSON.stringify(edits));
  }
  assert.equal(invoke(s, 'base-patch', { revision: '0'.repeat(64), edits: [set('start', '2014-06', '2013-01')] }).error, 'master_changed');
  assert.equal(fs.existsSync(path.join(s.dir, 'backups')), false);
});

test('Undo puts back the exact earlier profile, and only while nothing changed after the change it undoes', () => {
  const s = store('undo'), before = revision(s), preimage = saved(s);
  const change = patch(s, [{ op: 'remove', field: 'role', ...anchor(0, 'Principal Engineer'), before: 'Principal Engineer' }]);
  assert.equal(change.ok, true, JSON.stringify(change));
  assert.equal(saved(s).roles.length, 1);
  const undone = invoke(s, 'base-undo', { revision: change.revision, restore: before });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.deepEqual(saved(s), preimage, 'the removed job comes back with its bullets, stories and skills');
  assert.equal(undone.revision, revision(s));
  assert.equal(invoke(s, 'base-undo', { revision: change.revision, restore: before }).error, 'master_changed');
  const again = patch(s, [{ op: 'set', field: 'role', ...anchor(1, 'Software Engineer'), key: 'end', before: '2019-02', value: '2019-04' }]);
  assert.equal(invoke(s, 'base-undo', { revision: again.revision, restore: 'f'.repeat(64) }).error, 'undo_unavailable');
  for (const input of [{ revision: 'x', restore: before }, { revision: again.revision }, { revision: again.revision, restore: before, extra: 1 }])
    assert.equal(invoke(s, 'base-undo', input).ok, false);
  assert.equal(saved(s).roles[1].end, '2019-04');
});
