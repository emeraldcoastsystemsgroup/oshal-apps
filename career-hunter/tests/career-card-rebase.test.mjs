/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: a card on Work history answered "Change My Résumé or Work History: could not run - Your main résumé changed"). A card carries the revision the concierge read. Two cards written from one reading, or a card written before the My résumé document saved, met a main résumé that had moved, and the second one was refused whole. A card whose revision has moved is now checked against what it read (the earlier version, kept as Undo keeps it) and applied on the main résumé as it is now when every job and bullet it names is still exactly what the person read on it; otherwise it is refused naming the change and the job, and nothing changes. Made-up people only.
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
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-card-rebase-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const filename = path.join(packageRoot, 'bin/oshal-jobhunter.js');
const cli = new Module(filename);
cli.filename = filename;
cli.paths = Module._nodeModulePaths(path.dirname(filename));
cli._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.mapping=engineRuns;', filename);

const SHIP = 'Shipped the routing service used by every dispatcher in the company', CUT = 'Cut deploy time 40%';
// A made-up person. No job carries an id: the résumé upload stores none.
const fixture = {
  profile: { name: 'Pat Example', headline: 'Engineer and founder', experience_summary: 'Made-up summary.', clearance: 'None' },
  roles: [
    { title: 'Founder', org: 'Gulf Coast Test Works', start: '2024-01', end: null, deliverables: [] },
    { title: 'Principal Engineer', org: 'Example Freight Co', start: '2019-03', end: '2023-12', deliverables: [SHIP, CUT] },
    { title: 'Contract Developer', org: 'Placeholder Studio', start: '2018-01', end: '2019-02', deliverables: ['Built three client sites'] },
    { title: 'Software Engineer', org: 'Sample Bank', start: '2014-06', end: '2017-12', deliverables: ['Built the payments ledger', 'Wrote the on-call runbook'] },
  ],
  skills: { Core: { items: ['Rust', 'PostgreSQL'] } },
  competencies: ['Delivery', 'Reliability'],
};
let stores = 0;
function store(value = fixture) {
  const dir = path.join(root, 'store-' + ++stores); fs.mkdirSync(dir);
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
const card = (s, read, edits) => invoke(s, 'base-patch', { revision: read, edits });
const job = (roleIndex, roleTitle, roleOrg) => ({ roleIndex, roleTitle, ...(roleOrg ? { roleOrg } : {}) });
const PRINCIPAL = job(1, 'Principal Engineer', 'Example Freight Co'), FOUNDER = job(0, 'Founder', 'Gulf Coast Test Works');
const addBullet = (at, index, value, summary = 'Add a bullet') => ({ op: 'add', field: 'experience', ...at, index, before: '', value, summary });
const setBullet = (at, index, before, value, summary = 'Change a bullet') => ({ op: 'set', field: 'experience', ...at, index, before, value, summary });
const newJob = (title, org, start, bullets = []) => [
  { op: 'add', field: 'role', index: 0, before: '', value: title, summary: `Add ${title} at ${org}` },
  { op: 'set', field: 'role', ...job(0, title), key: 'org', before: '', value: org, summary: `Employer of ${title}: ${org}` },
  { op: 'set', field: 'role', ...job(0, title), key: 'start', before: '', value: start, summary: `Start of ${title}: ${start}` },
  ...bullets.map((text, n) => addBullet(job(0, title), n, text, `Add a bullet under ${title}`)),
];

/** The first card applies on the revision both cards read; returns that revision. */
function first(s, edits) {
  const read = revision(s), result = card(s, read, edits);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.notEqual(revision(s), read, 'the first card moved the revision');
  return read;
}
/** The second card, written from the same reading, applied on the revision the first one left. */
function applies(s, read, edits) {
  const before = fs.readdirSync(path.join(s.dir, 'backups')).length, result = card(s, read, edits);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.changed, true);
  assert.equal(result.revision, revision(s));
  assert.equal(result.rebased, true, 'the answer says the card was applied on a later revision');
  assert.match(result.note, /as it is now/, 'the card says so in a line the person reads');
  assert.ok(result.note.length <= 240, 'the kernel shows at most 240 characters of a note');
  assert.equal(fs.readdirSync(path.join(s.dir, 'backups')).length, before + 1, 'one card is one change with one backup');
  return saved(s).roles;
}
/** The second card is refused in words (409 at the route), and the main résumé is exactly as the first card left it. */
function refused(s, read, edits, ...patterns) {
  const text = fs.readFileSync(s.file, 'utf8'), result = card(s, read, edits);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error, 'master_changed');
  for (const pattern of patterns) assert.match(result.message, pattern);
  assert.match(result.message, /Nothing was changed/);
  assert.match(result.message, /Ask again/);
  assert.ok(result.message.length <= 500, 'the route shows at most 500 characters');
  assert.equal(fs.readFileSync(s.file, 'utf8'), text, 'nothing changed');
  return result.message;
}

test('two cards written from one reading both apply: the second on the revision the first left', () => {
  const s = store();
  const read = first(s, [{ op: 'set', field: 'role', ...job(3, 'Software Engineer'), key: 'start', before: '2014-06', value: '2013-09', summary: 'Start of Software Engineer at Sample Bank: Jun 2014 to Sep 2013' }]);
  const roles = applies(s, read, [addBullet(FOUNDER, 0, 'Built the first client portal'), addBullet(FOUNDER, 1, 'Hired and led a team of four')]);
  assert.deepEqual(roles[0].deliverables, ['Built the first client portal', 'Hired and led a team of four']);
  assert.equal(roles[3].start, '2013-09', 'the first card stays applied');
});

test('a card for another bullet of the same job applies after the first card added a bullet to that job', () => {
  const s = store();
  const read = first(s, [addBullet(PRINCIPAL, 2, 'Mentored four engineers')]);
  const roles = applies(s, read, [setBullet(PRINCIPAL, 1, CUT, 'Cut deploy time 40% across 12 services'), addBullet(PRINCIPAL, 2, 'Led the on-call rota')]);
  assert.deepEqual(roles[1].deliverables, [SHIP, 'Cut deploy time 40% across 12 services', 'Mentored four engineers', 'Led the on-call rota']);
});

test('a card whose bullet an earlier card rewrote is refused, naming the change, the job and the bullet', () => {
  const s = store();
  // The first card fleshes the bullet out; it still opens with the same words, which is all the second card quotes.
  const read = first(s, [setBullet(PRINCIPAL, 0, SHIP, SHIP + ', cutting missed pickups by a third')]);
  const message = refused(s, read, [addBullet(FOUNDER, 0, 'Built the first client portal'),
    setBullet(PRINCIPAL, 0, SHIP.slice(0, 40), 'Shipped the routing service', 'Shorten the first bullet under Principal Engineer')],
    /^Change 2 of 2 \(Shorten the first bullet under Principal Engineer\) no longer fits/, /Principal Engineer at Example Freight Co/,
    /"Shipped the routing service used by every dispatcher/, /changed or removed after this card was written/);
  assert.ok(message.indexOf('Principal Engineer at Example Freight Co') < 200, 'the card shows the first 200 characters: the job is in them');
  assert.deepEqual(saved(s).roles[0].deliverables, [], 'all or nothing: the first edit of the refused card is not applied either');
});

test('a job is removed only as the person read it: one that gained a bullet since is refused, an untouched one goes', () => {
  const s = store();
  const read = first(s, [addBullet(job(2, 'Contract Developer'), 1, 'Trained two junior developers')]);
  const remove = (index, title) => ({ op: 'remove', field: 'role', ...job(index, title), before: title, summary: `Remove ${title}` });
  refused(s, read, [remove(2, 'Contract Developer')], /^Change 1 of 1 \(Remove Contract Developer\) no longer fits/,
    /Contract Developer at Placeholder Studio changed after this card was written/);
  assert.deepEqual(applies(s, read, [remove(3, 'Software Engineer')]).map(role => role.title), ['Founder', 'Principal Engineer', 'Contract Developer']);
});

test('a second card that adds a job puts it first, with its own employer, month and bullets', () => {
  const s = store();
  const read = first(s, newJob('Platform Lead', 'Harbor Sample Systems', '2025-02', ['Runs the platform group']));
  const roles = applies(s, read, newJob('IL6 Engineer', 'Demo Defense Cloud', '2025-06', ['Stood up the IL6 enclave', 'Wrote the accreditation package']));
  assert.deepEqual(roles.slice(0, 3).map(role => [role.title, role.org, role.start, role.deliverables]), [
    ['IL6 Engineer', 'Demo Defense Cloud', '2025-06', ['Stood up the IL6 enclave', 'Wrote the accreditation package']],
    ['Platform Lead', 'Harbor Sample Systems', '2025-02', ['Runs the platform group']],
    ['Founder', 'Gulf Coast Test Works', '2024-01', []]]);
  assert.equal(roles.length, 6);
});

test('a card names its job where it read it: after a job was added above, it still changes that job', () => {
  const s = store();
  const read = first(s, newJob('Platform Lead', 'Harbor Sample Systems', '2025-02'));
  const roles = applies(s, read, [
    { op: 'set', field: 'role', ...job(3, 'Software Engineer'), key: 'end', before: '2017-12', value: '2018-01', summary: 'End of Software Engineer: Dec 2017 to Jan 2018' },
    setBullet(job(3, 'Software Engineer'), 0, 'Built the payments ledger', 'Built the payments ledger for 2M accounts')]);
  assert.deepEqual([roles[4].title, roles[4].end, roles[4].deliverables[0]], ['Software Engineer', '2018-01', 'Built the payments ledger for 2M accounts']);
  assert.deepEqual(roles[3], fixture.roles[2], 'the job now at the place the card names is untouched');
});

test('two jobs with one title: the card changes the one it read, never the one now at that place', () => {
  const twins = { ...fixture, roles: [
    { title: 'Engineer', org: 'First Sample Co', start: '2020-01', end: null, deliverables: ['Ran the build farm'] },
    { title: 'Engineer', org: 'Second Sample Co', start: '2016-01', end: '2019-12', deliverables: ['Wrote the billing service'] }] };
  const s = store(twins);
  const read = first(s, newJob('Platform Lead', 'Harbor Sample Systems', '2025-02'));
  // Written without the employer: at the card's reading place 1 was the job at Second Sample Co; now it is First Sample Co's.
  const roles = applies(s, read, [addBullet(job(1, 'Engineer'), 1, 'Cut invoice errors by half')]);
  assert.deepEqual(roles.map(role => [role.org, role.deliverables.length]), [['Harbor Sample Systems', 0], ['First Sample Co', 1], ['Second Sample Co', 2]]);
});

test('a job is moved only in the order the person read: refused once jobs were added, applied when only a bullet changed', () => {
  const move = { op: 'move', field: 'role', ...job(3, 'Software Engineer'), before: 'Software Engineer', to: 1, summary: 'Move Software Engineer to second' };
  const a = store(), readA = first(a, newJob('Platform Lead', 'Harbor Sample Systems', '2025-02'));
  refused(a, readA, [move], /^Change 1 of 1 \(Move Software Engineer to second\) no longer fits/, /order of your jobs changed after this card was written/);
  const b = store(), readB = first(b, [addBullet(FOUNDER, 0, 'Built the first client portal')]);
  assert.deepEqual(applies(b, readB, [move]).map(role => role.title), ['Founder', 'Software Engineer', 'Principal Engineer', 'Contract Developer']);
});

test('a bullet is moved only in the list the person read', () => {
  const move = { op: 'move', field: 'experience', ...PRINCIPAL, index: 1, to: 0, before: CUT, summary: 'Move the deploy bullet first' };
  const a = store(), readA = first(a, [addBullet(PRINCIPAL, 2, 'Mentored four engineers')]);
  refused(a, readA, [move], /no longer fits/, /bullets of Principal Engineer at Example Freight Co changed after this card was written/);
  const b = store(), readB = first(b, [addBullet(FOUNDER, 0, 'Built the first client portal')]);
  assert.deepEqual(applies(b, readB, [move])[1].deliverables, [CUT, SHIP]);
});

test('a card older than the versions Career keeps is refused in words that ask for it again', () => {
  const s = store();
  first(s, [addBullet(FOUNDER, 0, 'Built the first client portal')]);
  refused(s, 'a'.repeat(64), [addBullet(FOUNDER, 1, 'Hired and led a team of four')], /changed after this card was written/, /no longer kept/);
});

test('a save from the My résumé document in between does not stop a card', () => {
  const s = store(), read = revision(s);
  const base = invoke(s, 'base', {});
  const save = invoke(s, 'base-save', { resume: { ...base.resume, summary: 'Made-up summary, typed in the document.' } });
  assert.equal(save.ok, true, JSON.stringify(save));
  assert.notEqual(revision(s), read);
  const roles = applies(s, read, [setBullet(PRINCIPAL, 1, CUT, 'Cut deploy time 40% across 12 services')]);
  assert.equal(roles[1].deliverables[1], 'Cut deploy time 40% across 12 services');
  assert.equal(saved(s).profile.experience_summary, 'Made-up summary, typed in the document.', 'what was typed stays');
});

test('the same addition is not made twice', () => {
  const s = store(), add = [addBullet(FOUNDER, 0, 'Built the first client portal', 'Add the portal bullet to Founder')];
  const read = first(s, add);
  refused(s, read, add, /^Change 1 of 1 \(Add the portal bullet to Founder\) no longer fits/, /is already under Founder at Gulf Coast Test Works/);
});

test('a text the card replaces must still read as the card quotes it', () => {
  const s = store(), summary = value => [{ op: 'set', field: 'summary', before: 'Made-up summary.', value, summary: 'Rewrite the summary' }];
  const read = first(s, summary('First rewrite.'));
  refused(s, read, summary('Second rewrite.'), /^Change 1 of 1 \(Rewrite the summary\) no longer fits/, /the summary reads differently now/);
  assert.equal(saved(s).profile.experience_summary, 'First rewrite.');
});

test('a skill or competency card follows the same rule', () => {
  const s = store();
  const read = first(s, [{ op: 'add', field: 'skills', index: 2, before: '', value: 'Kubernetes', summary: 'Add Kubernetes' }]);
  const result = card(s, read, [{ op: 'add', field: 'skills', index: 2, before: '', value: 'Terraform', summary: 'Add Terraform' },
    { op: 'set', field: 'competencies', index: 1, before: 'Reliability', value: 'Site reliability', summary: 'Reword Reliability' }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.rebased, true);
  const value = saved(s);
  assert.deepEqual(Object.values(value.skills).flatMap(group => group.items), ['Rust', 'PostgreSQL', 'Kubernetes', 'Terraform']);
  assert.deepEqual(value.competencies, ['Delivery', 'Site reliability']);
});

test('a card on the revision it read is unchanged: no note, and a wrong place is still refused as before', () => {
  const s = store(), result = card(s, revision(s), [addBullet(FOUNDER, 0, 'Built the first client portal')]);
  assert.equal(result.ok, true);
  assert.equal(result.rebased, undefined);
  assert.equal(result.note, undefined);
});
