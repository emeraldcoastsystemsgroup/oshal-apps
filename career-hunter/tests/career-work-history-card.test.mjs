/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2 (Roger, 2026-11-13, the Work history concierge: "it wasnt able to perform the change i asked for"; his one card of four edits, two bullets under a job that had none and two other jobs removed, answered "Concierge did not do this: item index must be an integer from 0 to 0" and changed nothing). One card means what the person read on it, however the concierge numbered its edits: a job is the one whose exact title (and employer, when the edit names it) the edit names, at the position the concierge read it or the position the card's earlier edits left it; a bullet is the one whose exact text the edit names, and an add with no bullet named goes at the end, in the order written. Guarded through the launcher's real Python programs on a made-up person's disposable profile whose jobs carry no ids, as an uploaded résumé's do: the exact four-edit card as Career's concierge wrote it on blue (Sonnet, production's model, and Gemini), the same card with its bullets counted from one (Roger's refusal) and with every position as read, two removals in one card, an add and a move in one job, a removal before a change to a later job, and refusals that name the change and the job in words and change nothing.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2, Roger ~22:16Z (each new job held his whole pasted draft as one bullet; the concierge could not quote it; a card answered "the selected role does not match the current profile"): a pasted draft becomes one bullet per line when a card adds it, changes to it or splits it (op split), including the split card the concierge wrote on blue; a long bullet reads whole and an edit may name it by at least its first 30 characters or with other spacing; a job named with other spacing or case is the job with that title.
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
const require = createRequire(import.meta.url);
const yaml = require(require.resolve('js-yaml', { paths: [path.join(packageRoot, '../scripts/toolchain')] }));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-work-history-card-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const filename = path.join(packageRoot, 'bin/oshal-jobhunter.js');
const cli = new Module(filename);
cli.filename = filename;
cli.paths = Module._nodeModulePaths(path.dirname(filename));
cli._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.mapping=engineRuns;', filename);

const B1 = 'Built the first client portal and launched it in six weeks', B2 = 'Hired and led a team of four engineers';
// A made-up person. No job carries an id: the résumé upload stores none (profile.py's parse prompt).
const fixture = {
  profile: { name: 'Pat Example', headline: 'Engineer and founder', experience_summary: 'Made-up summary.', clearance: 'None' },
  roles: [
    { title: 'Founder', org: 'Gulf Coast Test Works', start: '2024-01', end: null, deliverables: [] },
    { title: 'Principal Engineer', org: 'Example Freight Co', start: '2019-03', end: '2023-12', deliverables: ['Shipped the routing service', 'Cut deploy time 40%'] },
    { title: 'Contract Developer', org: 'Placeholder Studio', start: '2018-01', end: '2019-02', deliverables: ['Built three client sites'] },
    { title: 'Software Engineer', org: 'Sample Bank', start: '2014-06', end: '2017-12', deliverables: ['Built the payments ledger', 'Wrote the on-call runbook'] },
    { title: 'Lab Assistant', org: 'Demo University Lab', start: '2012-09', end: '2014-05', deliverables: [] },
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
const patch = (s, edits) => invoke(s, 'base-patch', { revision: revision(s), edits });
const job = (roleIndex, roleTitle) => ({ roleIndex, roleTitle });
const addBullet = (roleIndex, index, value, summary) => ({ op: 'add', field: 'experience', ...job(roleIndex, 'Founder'), index, before: '', value, summary });
const removeJob = (roleIndex, title, extra = {}) => ({ op: 'remove', field: 'role', ...job(roleIndex, title), before: title, ...extra, summary: `Remove ${title}` });

/** The patch applied once, as one backed-up change, and left this work history. */
function applied(s, edits) {
  const result = patch(s, edits);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.changed, true);
  assert.equal(result.revision, revision(s));
  assert.doesNotMatch(JSON.stringify(result), /integer from/);
  assert.equal(fs.readdirSync(path.join(s.dir, 'backups')).length, 1, 'one card is one change with one backup');
  return saved(s).roles;
}
const FOUR_EDIT_RESULT = [
  ['Founder', [B1, B2]],
  ['Principal Engineer', fixture.roles[1].deliverables],
  ['Software Engineer', fixture.roles[3].deliverables],
];
const shape = roles => roles.map(role => [role.title, role.deliverables]);

test('the four-edit card applies as the person read it, however the concierge numbered it', () => {
  const cards = {
    // Recorded on blue 2026-11-13 from Career's concierge (Sonnet, production's model, and Gemini wrote the same card):
    // the bullets as their final places, the jobs where it read them, each removal carrying index as well.
    'as the concierge wrote it': [
      addBullet(0, 0, B1, 'Add first bullet to Founder at Gulf Coast Test Works'),
      addBullet(0, 1, B2, 'Add second bullet to Founder at Gulf Coast Test Works'),
      removeJob(4, 'Lab Assistant', { index: 4 }), removeJob(2, 'Contract Developer', { index: 2 })],
    // Roger's refusal: the first add counted from one against a job with no bullets.
    'the bullets counted from one': [addBullet(0, 1, B1), addBullet(0, 2, B2), removeJob(2, 'Contract Developer'), removeJob(4, 'Lab Assistant')],
    'every position as read': [addBullet(0, 0, B1), addBullet(0, 0, B2), removeJob(2, 'Contract Developer'), removeJob(4, 'Lab Assistant')],
    'the removals first, as read': [removeJob(2, 'Contract Developer'), removeJob(4, 'Lab Assistant'), addBullet(0, 0, B1), addBullet(0, 1, B2)],
    'the removals first, with the employer named': [
      removeJob(4, 'Lab Assistant', { roleOrg: 'Demo University Lab' }), removeJob(2, 'Contract Developer', { roleOrg: 'Placeholder Studio' }),
      { ...addBullet(0, 0, B1), roleOrg: 'Gulf Coast Test Works' }, { ...addBullet(0, 1, B2), roleOrg: 'Gulf Coast Test Works' }],
  };
  const outcomes = Object.entries(cards).map(([name, edits]) => { const s = store(); return [name, s, patch(s, edits)]; });
  const refused = outcomes.filter(([, , result]) => !result.ok).map(([name, , result]) => `${name}: ${result.error}`);
  assert.deepEqual(refused, [], 'every numbering of the card applies');
  for (const [name, s, result] of outcomes) {
    assert.equal(result.changed, true, name); assert.equal(result.revision, revision(s), name);
    assert.equal(fs.readdirSync(path.join(s.dir, 'backups')).length, 1, `${name}: one card is one change with one backup`);
    assert.deepEqual(shape(saved(s).roles), FOUR_EDIT_RESULT, name);
    assert.deepEqual(saved(s).roles[1], fixture.roles[1], `${name}: a job the card did not name is untouched`);
  }
});

test('two removals in one card take the two jobs the card names, in either order and either numbering', () => {
  const kept = ['Founder', 'Principal Engineer', 'Software Engineer'];
  for (const edits of [
    [removeJob(2, 'Contract Developer'), removeJob(4, 'Lab Assistant')],
    [removeJob(4, 'Lab Assistant'), removeJob(2, 'Contract Developer')],
    [removeJob(2, 'Contract Developer'), removeJob(3, 'Lab Assistant')],
    [removeJob(4, 'Lab Assistant', { index: 4 }), removeJob(2, 'Contract Developer', { index: 2 })],
  ]) assert.deepEqual(applied(store(), edits).map(role => role.title), kept, JSON.stringify(edits.map(edit => edit.roleIndex)));
});

test('an add and a move in one job land where the card says, in either order', () => {
  const at = job(1, 'Principal Engineer'), [ship, cut] = fixture.roles[1].deliverables, mentor = 'Mentored four engineers';
  for (const [edits, expected] of [
    [[{ op: 'add', field: 'experience', ...at, index: 2, before: '', value: mentor }, { op: 'move', field: 'experience', ...at, index: 1, to: 0, before: cut }], [cut, ship, mentor]],
    [[{ op: 'move', field: 'experience', ...at, index: 1, to: 0, before: cut }, { op: 'add', field: 'experience', ...at, index: 2, before: '', value: mentor }], [cut, ship, mentor]],
    // The new bullet goes before the one it names; the move names its bullet where the concierge read it.
    [[{ op: 'add', field: 'experience', ...at, index: 0, before: ship, value: mentor }, { op: 'move', field: 'experience', ...at, index: 1, to: 0, before: cut }], [cut, mentor, ship]],
  ]) assert.deepEqual(applied(store(), edits)[1].deliverables, expected, JSON.stringify(edits.map(edit => edit.op)));
});

test('a removal before a change to a later job changes the job the card names', () => {
  for (const [a, b] of [[4, 3], [3, 2]]) {
    const roles = applied(store(), [
      removeJob(2, 'Contract Developer'),
      { op: 'set', field: 'role', ...job(a, 'Lab Assistant'), key: 'end', before: '2014-05', value: '2014-08', summary: 'End of Lab Assistant: May 2014 to Aug 2014' },
      { op: 'set', field: 'role', ...job(b, 'Software Engineer'), key: 'start', before: '2014-06', value: '2014-03' },
      { op: 'set', field: 'experience', ...job(b, 'Software Engineer'), index: 1, before: 'Wrote the on-call runbook', value: 'Wrote the on-call runbook for 30 services' },
    ]);
    assert.deepEqual(roles.map(role => [role.title, role.start, role.end]), [
      ['Founder', '2024-01', null], ['Principal Engineer', '2019-03', '2023-12'], ['Software Engineer', '2014-03', '2017-12'], ['Lab Assistant', '2012-09', '2014-08']]);
    assert.deepEqual(roles[2].deliverables, ['Built the payments ledger', 'Wrote the on-call runbook for 30 services']);
  }
});

test('a new job and its bullets, and the page\'s own numbering, still apply', () => {
  const roles = applied(store(), [
    { op: 'add', field: 'role', index: 0, before: '', value: 'Software Engineer', summary: 'Add Software Engineer at Northwind Labs' },
    { op: 'set', field: 'role', ...job(0, 'Software Engineer'), key: 'org', before: '', value: 'Northwind Labs' },
    { op: 'set', field: 'role', ...job(0, 'Software Engineer'), key: 'start', before: '', value: '2026-11' },
    { op: 'add', field: 'experience', ...job(0, 'Software Engineer'), index: 0, before: '', value: 'Leads the platform group' },
    { op: 'add', field: 'experience', ...job(0, 'Software Engineer'), index: 1, before: '', value: 'Owns the reliability budget' },
  ]);
  assert.deepEqual(roles.map(role => [role.title, role.org]).slice(0, 2), [['Software Engineer', 'Northwind Labs'], ['Founder', 'Gulf Coast Test Works']]);
  assert.deepEqual(roles[0].deliverables, ['Leads the platform group', 'Owns the reliability budget']);
  assert.deepEqual(roles[4], fixture.roles[3], 'the older job with the same title is untouched');
});

test('a card that cannot apply says which change and which job in words, and changes nothing', () => {
  const twins = { ...fixture, roles: [...fixture.roles, { title: 'Software Engineer', org: 'Second Bank', start: '2010-01', end: '2012-08', deliverables: ['Ran the branch systems'] }] };
  for (const [edits, words, value = fixture] of [
    [[{ op: 'set', field: 'experience', ...job(1, 'Principal Engineer'), index: 0, before: 'No such bullet', value: 'x', summary: 'Sharpen the first bullet of Principal Engineer' }],
      /Change 1 of 1 \(Sharpen the first bullet of Principal Engineer\).*Principal Engineer at Example Freight Co.*"No such bullet"/],
    [[removeJob(4, 'Lab Assistant'), { op: 'set', field: 'role', ...job(4, 'Lab Assistant'), key: 'end', before: '2014-05', value: '2014-08' }],
      /Change 2 of 2.*Lab Assistant at Demo University Lab.*removed by an earlier change on this card/],
    [[{ op: 'add', field: 'experience', ...job(1, 'Principal Engineer'), index: 0, before: '', value: 'New top bullet' }],
      /Change 1 of 1.*Principal Engineer at Example Freight Co.*name the bullet it goes before/],
    [[{ op: 'set', field: 'role', ...job(7, 'Software Engineer'), key: 'end', before: '2017-12', value: '2018-01' }],
      /Change 1 of 1.*more than one job is titled Software Engineer.*employer/, twins],
    [[{ op: 'remove', field: 'role', ...job(0, 'Astronaut'), before: 'Astronaut' }], /Change 1 of 1.*no job titled Astronaut/],
    [[removeJob(2, 'Contract Developer', { roleOrg: 'Another Studio' })], /Change 1 of 1.*no job titled Contract Developer at Another Studio/],
    [[removeJob(2, 'Contract Developer', { index: 3 })], /Change 1 of 1.*Contract Developer.*two different places/],
    [[addBullet(0, 0, B1), { op: 'move', field: 'experience', ...job(0, 'Founder'), index: 0, to: 4, before: B1 }], /Change 2 of 2.*Founder at Gulf Coast Test Works.*1 bullet/],
    [[addBullet(0, 0, B1), { op: 'add', field: 'role', index: 9, before: '', value: 'Far job' }], /Change 2 of 2.*Far job.*place 10.*5 jobs/],
  ]) {
    const s = store(value), before = fs.readFileSync(s.file, 'utf8');
    const result = patch(s, edits);
    assert.equal(result.ok, false, JSON.stringify(edits));
    assert.match(result.error, words);
    assert.match(result.error, /Nothing was changed\./);
    assert.doesNotMatch(result.error, /integer from|item index|roleIndex|roleTitle|roleOrg|\bindex\b/, result.error);
    assert.ok(result.error.length <= 500, 'the route shows at most 500 characters');
    assert.equal(fs.readFileSync(s.file, 'utf8'), before);
    assert.equal(fs.existsSync(path.join(s.dir, 'backups')), false);
  }
  const s = store(twins);
  const named = applied(s, [{ op: 'set', field: 'role', ...job(7, 'Software Engineer'), roleOrg: 'Second Bank', key: 'end', before: '2012-08', value: '2012-09' }]);
  assert.deepEqual(named.map(role => [role.org, role.end]).slice(3), [['Sample Bank', '2017-12'], ['Demo University Lab', '2014-05'], ['Second Bank', '2012-09']],
    'with the employer named, the card changes the one of two same-titled jobs it names');
});

// Roger, 2026-11-13 ~22:16Z: each new job held ONE bullet, his whole pasted draft, line breaks and all.
const DRAFT = [
  '• Founded a three-person software studio that builds scheduling and billing tools for small',
  'clinics along the Gulf Coast, and grew it to eleven paying customers in the first year',
  '• Designed the multi-tenant PostgreSQL schema and the nightly reconciliation job that matches',
  'insurance remittances to open invoices, cutting manual billing review from two days to three hours',
  '• Hired and mentored two junior developers and set up code review, CI and a weekly release train',
  '• Negotiated the first enterprise contract with a regional hospital network worth $180,000 a year',
].join('\n');
const DRAFT_BULLETS = [
  'Founded a three-person software studio that builds scheduling and billing tools for small clinics along the Gulf Coast, and grew it to eleven paying customers in the first year',
  'Designed the multi-tenant PostgreSQL schema and the nightly reconciliation job that matches insurance remittances to open invoices, cutting manual billing review from two days to three hours',
  'Hired and mentored two junior developers and set up code review, CI and a weekly release train',
  'Negotiated the first enterprise contract with a regional hospital network worth $180,000 a year',
];
const LIST = 'Built marketing sites for six local businesses\nMigrated a legacy PHP inventory system to Rails\nWrote the runbooks the owners still use';
const pasted = { ...fixture, roles: fixture.roles.map((role, n) => n === 0 ? { ...role, deliverables: [DRAFT] } : n === 2 ? { ...role, deliverables: [LIST] } : role) };

test('a pasted draft becomes one bullet per line when a card adds it, changes to it or splits it', () => {
  let roles = applied(store(), [addBullet(0, 0, DRAFT, 'Add the pasted draft under Founder')]);
  assert.deepEqual(roles[0].deliverables, DRAFT_BULLETS, 'each mark starts a bullet and a wrapped line goes on the one before');
  roles = applied(store(), [{ op: 'set', field: 'experience', ...job(1, 'Principal Engineer'), index: 1, before: 'Cut deploy time 40%', value: 'Cut deploy time 40%\nRan the incident reviews\nWrote the on-call guide' }]);
  assert.deepEqual(roles[1].deliverables, ['Shipped the routing service', 'Cut deploy time 40%', 'Ran the incident reviews', 'Wrote the on-call guide']);
  // "Split each block into one bullet per line": one card, one split per job, each block named by its opening words.
  const s = store(pasted);
  roles = applied(s, [
    { op: 'split', field: 'experience', ...job(0, 'Founder'), index: 0, before: DRAFT.slice(0, 48), summary: 'Split the Founder block into one bullet per line' },
    { op: 'split', field: 'experience', ...job(2, 'Contract Developer'), index: 0, before: LIST, summary: 'Split the Contract Developer block' },
    { op: 'split', field: 'experience', ...job(1, 'Principal Engineer'), index: 0, before: 'Shipped the routing service' },
  ]);
  assert.deepEqual(roles[0].deliverables, DRAFT_BULLETS);
  assert.deepEqual(roles[2].deliverables, LIST.split('\n'));
  assert.deepEqual(roles[1].deliverables, fixture.roles[1].deliverables, 'a one-line bullet stays as it is');
  // The card Career's concierge wrote on blue for "Split each block into one bullet per line" (Gemini, 2026-11-13):
  // the block set to its first bullet, the rest added at their final places.
  const asWritten = (roleIndex, roleTitle, block, bullets) => [
    { op: 'set', field: 'experience', ...job(roleIndex, roleTitle), index: 0, before: block, value: bullets[0], summary: `Replace the block with the first bullet for ${roleTitle}` },
    ...bullets.slice(1).map((value, n) => ({ op: 'add', field: 'experience', ...job(roleIndex, roleTitle), index: n + 1, before: '', value, summary: `Add bullet ${n + 2} for ${roleTitle}` }))];
  roles = applied(store(pasted), [...asWritten(0, 'Founder', DRAFT, DRAFT_BULLETS), ...asWritten(2, 'Contract Developer', LIST, LIST.split('\n'))]);
  assert.deepEqual([roles[0].deliverables, roles[2].deliverables], [DRAFT_BULLETS, LIST.split('\n')]);
  const same = patch(store(), [{ op: 'split', field: 'experience', ...job(1, 'Principal Engineer'), before: 'Cut deploy time 40%' }]);
  assert.equal(same.ok, true, JSON.stringify(same)); assert.equal(same.changed, false);
  const refused = patch(store(), [{ op: 'split', field: 'experience', ...job(1, 'Principal Engineer'), before: 'Cut deploy time 40%', value: 'x' }]);
  assert.match(refused.error, /Change 1 of 1.*a removal, a move or a split carries no new text/);
});

test('a long pasted bullet reads whole, and an edit may name it by its opening words', () => {
  const s = store(pasted);
  const page = invoke(s, 'base-section', { field: 'experience', index: 0, offset: 0 });
  assert.equal(page.ok, true, JSON.stringify(page));
  assert.deepEqual(page.items.map(item => item.value), [DRAFT], 'the whole bullet, line breaks and all, in one read');
  assert.equal(page.complete, true);
  const roles = applied(s, [{ op: 'set', field: 'experience', ...job(0, 'Founder'), index: 0, before: DRAFT.slice(0, 40) + '…', value: DRAFT_BULLETS[0] }]);
  assert.deepEqual(roles[0].deliverables, [DRAFT_BULLETS[0]]);
  const spaced = applied(store(pasted), [{ op: 'remove', field: 'experience', ...job(2, 'Contract Developer'), index: 0, before: LIST.replace(/\n/g, ' ') }]);
  assert.deepEqual(spaced[2].deliverables, [], 'a quote that differs only in spacing names the bullet');
  const twins = { ...fixture, roles: [{ ...fixture.roles[1], deliverables: ['Shipped the routing service for freight', 'Shipped the routing service for parcels'] }] };
  const unclear = patch(store(twins), [{ op: 'remove', field: 'experience', ...job(0, 'Principal Engineer'), before: 'Shipped the routing service for' }]);
  assert.match(unclear.error, /more than one bullet under Principal Engineer at Example Freight Co begins "Shipped the routing service for"/);
  const short = patch(store(pasted), [{ op: 'remove', field: 'experience', ...job(0, 'Founder'), before: '• Founded' }]);
  assert.match(short.error, /under Founder at Gulf Coast Test Works there is no bullet that reads "• Founded"/, 'a quote shorter than 30 characters must be exact');
});

test('a job named with other spacing or case is the job with that title, and a job that is not there is said in words', () => {
  const roles = applied(store(), [{ op: 'set', field: 'role', ...job(0, ' founder'), key: 'end', before: '', value: '2026-10' }]);
  assert.equal(roles[0].end, '2026-10');
  const missing = patch(store(), [{ op: 'add', field: 'experience', ...job(0, 'Founder & CEO'), index: 0, before: '', value: 'x' }]);
  assert.doesNotMatch(missing.error, /selected role does not match the current profile/);
  assert.match(missing.error, /Change 1 of 1 \(add a bullet of Founder & CEO\).*no job titled Founder & CEO in your work history now/);
});

test('the patch tool says the rule plainly and accepts the employer it names a job by', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(packageRoot, 'oshal-app.yaml'), 'utf8'));
  const tool = manifest.tools.find(item => item.name === 'career_resume_patch');
  assert.equal(tool.inputSchema.properties.edits.items.properties.roleOrg.type, 'string');
  const words = tool.usageInstructions.replace(/\s+/g, ' ');
  assert.match(words, /as you read it/);
  assert.match(words, /earlier edits on the same card never renumber/);
  assert.match(words, /exact text/);
  assert.match(words, /at the end, in the order written/);
  assert.match(words, /split, with before and no value, turns a bullet holding several lines/);
  assert.ok(tool.inputSchema.properties.edits.items.properties.op.enum.includes('split'));
  assert.doesNotMatch(words, /appends at total/);
});
