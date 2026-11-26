/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-LOCATION (BACKLOG "A role's location": Work history could not set where a job was, and the parse résumé prints Location: only for a role that records one; employer forms such as Workday ask for each job's location). Over Career's real compiled résumé route module (GET /resume/doc, GET /resume/master-section, POST /resume/master-edit, POST /resume/master-undo) and the launcher's real Python programs on a made-up person (tests/helpers/career-years-fixture.mjs): a job's location is read with the main résumé's exact revision, set, changed and cleared through the same revision-checked, backed-up, audited edit as its title and months, with Undo putting the exact earlier file back; a new job and a client engagement under an employer carry their own; a client engagement in the ledger keeps its own; a wrong current value, an over-long location and a moved main résumé change nothing; the parse résumé the engine writes from the saved record prints the location under the job's Company and nothing for a job with none; and the concierge's patch tool takes the location key with the approval every job edit needs.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { packageRoot, yearsHarness } from './helpers/career-years-fixture.mjs';

const require = createRequire(import.meta.url);
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(packageRoot, '../scripts/toolchain')] }));
const h = yearsHarness('career-role-location');
before(() => h.start());
after(() => h.stop());

/** A made-up person: a current job with no location, an employer with one, a client engagement under it, a ledger entry. */
function person() {
  return {
    profile: { name: 'Jordan Placeholder', headline: 'Operations lead', experience_summary: 'Made-up summary.', clearance: 'None' },
    roles: [
      { id: 'r1', title: 'Operations Lead', org: 'Example Freight Co', start: '2020-02', end: null, deliverables: ['Ran the dispatch floor.'] },
      { id: 'r2', title: 'Senior Consultant', org: 'Sample Advisory Group', start: '2015-05', end: '2020-01', location: 'Denver, CO',
        engagements_heading: 'Selected Client Engagements', deliverables: ['Led eleven assessments.'] },
      { id: 'r3', title: 'Program Lead', org: 'Northwind Bank', start: '2017-01', end: '2019-06', parent_role_id: 'r2', deliverables: ['Moved 14 branches onto one process.'] },
      { id: 'r4', title: 'Analyst', org: 'Contoso Logistics', start: '2012-08', end: '2015-04', deliverables: ['Built the weekly freight report.'] },
    ],
    project_ledger: [{ project: 'Fixture Health Network', role: 'Lead analyst', start: '2018-02', end: '2018-09', job: 'r2' }],
    skills: { Core: { items: ['Logistics'] } },
  };
}
const at = (roleIndex, roleTitle) => ({ roleIndex, roleTitle });
const place = (roleIndex, roleTitle, before, value) => ({ op: 'set', field: 'role', ...at(roleIndex, roleTitle), key: 'location', before, value,
  summary: `Location of ${roleTitle}: ${before || 'none'} to ${value || 'none'}` });
const doc = () => h.call('GET', '/resume/doc?id=master');
const edit = async (edits, revision) => h.call('POST', '/resume/master-edit', { revision: revision || (await doc()).body.revision, edits });

test('the main résumé and its section reads carry a job\'s location with the exact revision; a job with none reads as before', async () => {
  h.reset('read', person());
  const { code, body } = await doc();
  assert.equal(code, 200, JSON.stringify(body));
  assert.equal(body.revision, h.digest(h.text()));
  assert.equal(body.resume.experience[1].location, 'Denver, CO');
  for (const n of [0, 2, 3]) assert.equal('location' in body.resume.experience[n], false, 'a job that records no location has no location key, as before');
  const overview = await h.call('GET', '/resume/master-section?field=overview&index=0&offset=0');
  assert.equal(overview.code, 200, JSON.stringify(overview.body));
  assert.deepEqual(overview.body.items.map((item) => item.value.location), ['', 'Denver, CO', '', ''], 'the concierge reads every job\'s location, empty when none');
  const role = await h.call('GET', '/resume/master-section?field=experience&index=1&offset=0');
  assert.equal(role.body.role.location, 'Denver, CO');
});

test('a job\'s location is set, changed and cleared through the revision-checked edit, backed up and audited, and Undo puts back the exact file', async () => {
  h.reset('save', person());
  const preimage = h.text(), first = await doc();
  const set = await edit([place(0, 'Operations Lead', '', 'Austin, TX')], first.body.revision);
  assert.equal(set.code, 200, JSON.stringify(set.body));
  assert.equal(set.body.changed, true);
  const saved = h.saved().roles[0];
  assert.equal(saved.location, 'Austin, TX', 'a state abbreviation is kept as typed');
  assert.deepEqual({ ...saved, location: undefined }, { ...person().roles[0], location: undefined }, 'nothing else of the job changed');
  assert.equal(h.backups().length, 1);
  assert.equal(fs.readFileSync(h.backups()[0], 'utf8'), preimage, 'the exact earlier file is kept');
  assert.ok(h.audit().at(-1).changelog.some((line) => /role 1 \(Operations Lead\) location set/.test(line)), JSON.stringify(h.audit().at(-1)));
  assert.equal(set.body.revision, h.digest(h.text()));
  const undo = await h.call('POST', '/resume/master-undo', { revision: set.body.revision, restore: first.body.revision });
  assert.equal(undo.code, 200, JSON.stringify(undo.body));
  assert.equal(h.text(), preimage, 'Undo puts back the exact earlier file');
  const changed = await edit([place(1, 'Senior Consultant', 'Denver, CO', '  Boulder,   CO ')]);
  assert.equal(changed.code, 200, JSON.stringify(changed.body));
  assert.equal(h.saved().roles[1].location, 'Boulder, CO', 'spacing is tidied, the words are kept');
  const cleared = await edit([place(1, 'Senior Consultant', 'Boulder, CO', '')]);
  assert.equal(cleared.code, 200, JSON.stringify(cleared.body));
  assert.equal('location' in h.saved().roles[1], false, 'a cleared location is no location, not an empty one');
  const again = await edit([place(1, 'Senior Consultant', '', '')]);
  assert.deepEqual([again.code, again.body.changed], [200, false], 'the same empty location again changes nothing');
});

test('a new job carries its location in the same card, and a client engagement under an employer has its own', async () => {
  h.reset('add', person());
  const title = 'Director of Operations', added = await edit([
    { op: 'add', field: 'role', index: 0, before: '', value: title, summary: 'Add Director of Operations' },
    { op: 'set', field: 'role', ...at(0, title), key: 'org', before: '', value: 'Example Harbor Co', summary: 'at Example Harbor Co' },
    { op: 'set', field: 'role', ...at(0, title), key: 'start', before: '', value: '2026-10', summary: 'from Oct 2026' },
    place(0, title, '', 'Mobile, AL'),
  ]);
  assert.equal(added.code, 200, JSON.stringify(added.body));
  assert.deepEqual(['title', 'org', 'start', 'end', 'location'].map((key) => h.saved().roles[0][key]), [title, 'Example Harbor Co', '2026-10', null, 'Mobile, AL']);
  const client = await edit([place(3, 'Program Lead', '', 'Remote')]);
  assert.equal(client.code, 200, JSON.stringify(client.body));
  const roles = h.saved().roles;
  assert.deepEqual([roles[3].parent_role_id, roles[3].location, roles[2].location], ['r2', 'Remote', 'Denver, CO'], 'the engagement keeps its employer and its own place');
});

test('a client engagement in the ledger keeps its own location, shown on Work history and cleared like any of its details', async () => {
  h.reset('ledger', person());
  const set = await edit([{ op: 'set', field: 'engagement', index: 0, before: 'Fixture Health Network', value: { location: 'Houston,  TX' }, summary: 'Location of Fixture Health Network' }]);
  assert.equal(set.code, 200, JSON.stringify(set.body));
  assert.equal(h.saved().project_ledger[0].location, 'Houston, TX');
  const shown = (await doc()).body.expanded.engagements[0];
  assert.deepEqual([shown.location, shown.other], ['Houston, TX', []], 'a field of its own, not an unknown detail');
  const cleared = await edit([{ op: 'set', field: 'engagement', index: 0, before: 'Fixture Health Network', value: { location: '' }, summary: 'Clear it' }]);
  assert.equal(cleared.code, 200, JSON.stringify(cleared.body));
  assert.equal('location' in h.saved().project_ledger[0], false);
  const long = await edit([{ op: 'set', field: 'engagement', index: 0, before: 'Fixture Health Network', value: { location: 'x'.repeat(121) }, summary: 'Too long' }]);
  assert.equal(long.code, 422);
  assert.match(long.body.error, /location is longer than 120 characters/);
});

test('a wrong current location, an over-long one and a moved main résumé change nothing', async () => {
  h.reset('refused', person());
  const before = h.text(), { body } = await doc();
  const wrong = await edit([place(1, 'Senior Consultant', 'Dallas, TX', 'Austin, TX')], body.revision);
  assert.equal(wrong.code, 422);
  assert.match(wrong.body.error, /the location of Senior Consultant at Sample Advisory Group reads "Denver, CO" now, not "Dallas, TX"/);
  const long = await edit([place(0, 'Operations Lead', '', 'x'.repeat(121))], body.revision);
  assert.equal(long.code, 422);
  assert.match(long.body.error, /location exceeds 120 characters/);
  const moved = await edit([place(0, 'Operations Lead', '', 'Austin, TX')], '0'.repeat(64));
  assert.equal(moved.code, 409);
  assert.equal(h.text(), before, 'nothing was written');
  assert.equal(h.backups().length, 0);
});

test('the parse résumé the engine writes from the saved record prints the location under Company, and nothing for a job with none', async () => {
  h.reset('parse', person());
  assert.equal((await edit([place(0, 'Operations Lead', '', 'Austin, TX')])).code, 200);
  const out = path.join(path.dirname(path.dirname(h.backups()[0])), 'parse');
  const lines = h.python(`
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(packageRoot, 'tests/helpers'))})
from jobhunter import docx_parse, profile
import resume_line_parser as reader
prof = profile.load()
resume = {'experience': [{'title': r['title'], 'org': r['org'], 'span': r['span'], 'bullets': r['bullets'],
                          **{k: r[k] for k in ('id', 'parent_role_id', 'engagements_heading') if r.get(k)}}
                         for r in profile.base_document(prof)['resume']['experience']]}
path = docx_parse.render_parse_resume(prof.get('profile'), resume, ${JSON.stringify(out)} + '/Resume_Parse.docx', roles=prof.get('roles'))
print(json.dumps([line for line in reader.docx_lines(str(path)) if line]))
`);
  const block = (title) => { const n = lines.indexOf('Job Title: ' + title); return lines.slice(n, lines.findIndex((line, i) => i > n && line.startsWith('• '))); };
  assert.deepEqual(block('Operations Lead'), ['Job Title: Operations Lead', 'Company: Example Freight Co', 'Location: Austin, TX', 'Start Date: 02/2020', 'End Date: Present']);
  assert.deepEqual(block('Senior Consultant'), ['Job Title: Senior Consultant', 'Company: Sample Advisory Group', 'Location: Denver, CO', 'Start Date: 05/2015', 'End Date: 01/2020']);
  assert.deepEqual(block('Analyst'), ['Job Title: Analyst', 'Company: Contoso Logistics', 'Start Date: 08/2012', 'End Date: 04/2015'], 'no location recorded, no Location line');
});

test('the concierge\'s patch tool takes the location key, with the approval every job edit needs', async () => {
  const manifest = yaml.load(fs.readFileSync(path.join(packageRoot, 'oshal-app.yaml'), 'utf8'));
  const tool = manifest.tools.find((item) => item.name === 'career_resume_patch');
  assert.ok(tool.inputSchema.properties.edits.items.properties.key.enum.includes('location'));
  assert.deepEqual([tool.requiresApproval, tool.defaultAuthMode], [true, 'ask'], 'the card is the person\'s approval, as for every job edit');
  assert.match(tool.usageInstructions, /location/);
  h.reset('concierge', person());
  const { body } = await h.call('GET', '/resume/master-section?field=overview&index=0&offset=0');
  // The card as the concierge writes it: the job by its title, employer and place as read, a one-line summary.
  const card = await edit([{ op: 'set', field: 'role', roleIndex: 3, roleTitle: 'Analyst', roleOrg: 'Contoso Logistics', key: 'location', before: '', value: 'Milwaukee, WI',
    summary: 'Location of Analyst at Contoso Logistics: Milwaukee, WI' }], body.revision);
  assert.equal(card.code, 200, JSON.stringify(card.body));
  assert.equal(h.saved().roles[3].location, 'Milwaukee, WI');
});
