/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.24 (Roger, 2026-11-19: "i have to be able to generate accurate resumes ... i cant have random numbers 2 years vs 11 years vs 20 years getting out of place"). Résumé generation has stated a person's own years (`years_by_skill`, `career_years`) since 1.68.22, and nothing on any screen wrote them. This guards the read and save behind Work history's Years by skill section, over Career's real compiled résumé route module and the real engine programs on a made-up person (tests/helpers/career-years-fixture.mjs): the read lists the years counted from the roles, the person's figure and what a résumé states, and each "used" is compared with what the real generation code says for the same person (skill_tenure.prompt_block line by line, years_truth.enforce on a written packet); a save writes exactly the two keys, is backed up and audited, and Undo puts back the exact earlier file; the editor's two ends (0.5 and 60, 1 and 70) are read back by generation's own reader; a bad row refuses the whole save in words that name the row; a moved main résumé is refused. Red on store main 8b4c5002 (1.68.23), where field `years` is not a section (400): all 9 cases fail there.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { yearsHarness, yearsProfile } from './helpers/career-years-fixture.mjs';

const h = yearsHarness('career-years-edit');
before(() => h.start());
after(() => h.stop());

/**
 * What the real generation code says for the saved person: the tenure block's skill lines, the reader's figures, and
 * each of `written` (a résumé's headline, then its summary) after the last pass over a generated packet.
 */
const generation = (written = []) => h.python(`
import json
from jobhunter import profile, skill_tenure, years_truth
prof = profile.load()
tenure = skill_tenure.compute_tenure(prof)
lines = [line[4:] for line in skill_tenure.prompt_block(tenure, max_skills=999).splitlines() if line.startswith('  * ')]
figures = years_truth.figures(prof)
passed = [years_truth.enforce({'resume': {'headline': text, 'summary': text}}, prof)[0]['resume'] for text in json.loads(${JSON.stringify(JSON.stringify(written))})]
print(json.dumps({'lines': lines, 'career': figures['career'], 'skills': {f['name']: f['years'] for f in figures['skills']},
                  'passed': [item['headline'] for item in passed], 'same': all(item['headline'] == item['summary'] for item in passed)}))
`);

test('the read lists the years counted from the roles, the person\'s figure and what a résumé states, with the exact revision', async () => {
  h.reset('read');
  const { code, body } = await h.read();
  assert.equal(code, 200, JSON.stringify(body));
  assert.equal(body.revision, h.digest(h.text()), 'the revision is the main résumé as saved');
  assert.deepEqual(body.rows, [
    { skill: 'Python', from_roles: 3.5, yours: 10, used: 10, used_words: '10 years' },
    { skill: 'SAP NetWeaver Java', from_roles: null, yours: 6.5, used: 6.5, used_words: '6.5 years' },
    { skill: 'Java', from_roles: 5, yours: null, used: 5, used_words: 'Up to 5 years' },
    { skill: 'SQL', from_roles: 5, yours: null, used: 5, used_words: 'Up to 5 years' },
    { skill: 'Docker', from_roles: 3.5, yours: null, used: 3, used_words: 'Up to 3 years' },
    { skill: 'Linux', from_roles: 1, yours: null, used: null, used_words: 'No year count (under 2 years)' },
  ], 'most years used first, then by name; a skill counted under two years states no count');
  assert.deepEqual([body.career_from_roles, body.career_yours, body.career_used, body.career_used_words, body.more], [9.5, 15, 15, '15 years', 0]);
  assert.deepEqual(body.limits, { rows: 40, name: 60, skill_years: { min: 0.5, max: 60, step: 0.5 }, career_years: { min: 1, max: 70, step: 0.5 } });
});

test('"used" is what the real generation code states: the tenure block line by line, and the last pass on written text', async () => {
  h.reset('generation');
  const { body } = await h.read(), said = generation(['Engineer with 3 years of experience', 'Python (2 years)', 'SAP NetWeaver Java: 30 years', 'Engineer with over 15 years of experience']);
  assert.equal(said.lines.length, body.rows.length, 'one row per skill of the table generation reads');
  for (const row of body.rows) {
    const line = said.lines.find((item) => item.startsWith(row.skill + ': '));
    assert.ok(line, `generation lists ${row.skill}`);
    if (row.yours !== null) assert.ok(line.endsWith(`: exactly ${row.used} years (the person's own figure)`) && row.used_words === `${row.used} years`, line);
    else if (row.used !== null) assert.ok(line.endsWith(`max ${row.used} years`) && row.used_words === `Up to ${row.used} years`, line);
    else assert.ok(line.endsWith('under 2 years (omit year count)') && row.used_words === 'No year count (under 2 years)', line);
  }
  const used = Object.fromEntries(body.rows.map((row) => [row.skill, row.used]));
  assert.deepEqual([said.passed, said.same], [[`Engineer with ${body.career_used} years of experience`, `Python (${used.Python} years)`,
    `SAP NetWeaver Java: ${used['SAP NetWeaver Java']} years`, `Engineer with ${body.career_used} years of experience`], true],
  'a written 3, 2, 30 and "over 15" become the figures the screen shows as used: 15, 10, 6.5 and 15');
  assert.deepEqual([said.career, body.career_used_words], [15, '15 years']);
});

test('with no total of the person\'s own, a résumé is held to the whole years the roles give, and the screen says so in that pass\'s terms', async () => {
  const { career_years: _total, ...profile } = yearsProfile();
  h.reset('floor', profile);
  const { body } = await h.read();
  assert.deepEqual([body.career_from_roles, body.career_yours, body.career_used, body.career_used_words], [9.5, null, 9, 'At least 9 years, or "over 5 years"']);
  const said = generation(['Engineer with 3 years of experience', 'Engineer with over 4 years of experience', 'Engineer with 9 years of experience', 'Engineer with over 5 years of experience']);
  assert.deepEqual(said.passed, ['Engineer with 9 years of experience', 'Engineer with 9 years of experience', 'Engineer with 9 years of experience', 'Engineer with over 5 years of experience'],
    'a lower number becomes the 9 the screen shows; 9 and "over 5 years" stand as written');
  const short = { ...profile, roles: [{ ...profile.roles[2], end: '2015-06' }] };
  h.reset('under-a-year', short);
  const { body: little } = await h.read();
  assert.deepEqual([little.career_from_roles, little.career_used, little.career_used_words], [0.5, null, 'No figure yet']);
  assert.deepEqual(generation(['Analyst with 3 years of experience']).passed, ['Analyst with 3 years of experience'], 'under a year of dated roles the pass holds the total to nothing');
});

test('a save writes exactly the two keys, is backed up and audited, the read shows it, and Undo puts the exact bytes back', async () => {
  h.reset('save');
  const before = h.text(), { body: opened } = await h.read();
  const value = { years_by_skill: [{ skill: 'Java', years: 11 }, { skill: 'Python', years: 4.5 }, { skill: 'Kubernetes', years: 2 }], career_years: 18.5 };
  const { code, body } = await h.save(opened.revision, value);
  assert.equal(code, 200, JSON.stringify(body));
  assert.deepEqual([body.changed, body.revision], [true, h.digest(h.text())]);
  const { years_by_skill: rows, career_years: total, ...rest } = h.saved(), { years_by_skill: _rows, career_years: _total, ...was } = yearsProfile();
  assert.deepEqual([rows, total], [value.years_by_skill, 18.5]);
  assert.deepEqual(rest, was, 'no other key of the main résumé is touched');
  assert.equal(h.backups().length, 1);
  assert.equal(fs.readFileSync(h.backups()[0], 'utf8'), before, 'the one backup is the exact earlier file');
  assert.deepEqual(h.audit().at(-1).changelog, ['years by skill: 3 stated', 'years of experience in total: set to 18.5']);
  const { body: reread } = await h.read();
  assert.deepEqual(reread.rows.map((row) => [row.skill, row.from_roles, row.yours, row.used_words]), [
    ['Java', 5, 11, '11 years'], ['SQL', 5, null, 'Up to 5 years'], ['Python', 3.5, 4.5, '4.5 years'], ['Docker', 3.5, null, 'Up to 3 years'],
    ['Kubernetes', null, 2, '2 years'], ['Linux', 1, null, 'No year count (under 2 years)']]);
  assert.deepEqual([reread.career_yours, reread.career_used_words], [18.5, '18.5 years']);
  assert.deepEqual(generation().skills, { Java: 11, Python: 4.5, Kubernetes: 2 }, 'generation reads the saved figures');
  const undone = await h.call('POST', '/resume/master-undo', { revision: body.revision, restore: opened.revision });
  assert.equal(undone.code, 200, JSON.stringify(undone.body));
  assert.equal(h.text(), before, 'Undo puts back the exact earlier file');
});

test('an empty figure removes the person\'s figure; an empty list and a null total remove their keys; the same form again changes nothing', async () => {
  h.reset('clear');
  const { body: opened } = await h.read();
  const one = await h.save(opened.revision, { years_by_skill: [{ skill: 'SAP NetWeaver Java', years: 6.5 }], career_years: null });
  assert.deepEqual([one.code, one.body.changed], [200, true], JSON.stringify(one.body));
  assert.deepEqual([h.saved().years_by_skill, 'career_years' in h.saved()], [[{ skill: 'SAP NetWeaver Java', years: 6.5 }], false]);
  const { body: after } = await h.read();
  assert.deepEqual(after.rows.find((row) => row.skill === 'Python'), { skill: 'Python', from_roles: 3.5, yours: null, used: 3, used_words: 'Up to 3 years' });
  assert.deepEqual([after.career_from_roles, after.career_yours], [9.5, null]);
  const same = await h.save(one.body.revision, { years_by_skill: [{ skill: 'SAP NetWeaver Java', years: 6.5 }], career_years: null });
  assert.deepEqual([same.code, same.body.changed, same.body.revision, h.backups().length], [200, false, one.body.revision, 1], 'nothing changed, nothing backed up');
  const none = await h.save(one.body.revision, { years_by_skill: [], career_years: null });
  assert.deepEqual([none.code, 'years_by_skill' in h.saved(), 'career_years' in h.saved()], [200, false, false]);
  assert.deepEqual(h.audit().at(-1).changelog, ['years by skill: your figures removed']);
});

test('the editor\'s two ends are saved and read back by generation: 0.5 and 60 for a skill, 1 and 70 in total', async () => {
  h.reset('ends');
  let { body: opened } = await h.read();
  for (const [low, high, total] of [[0.5, 60, 70], [60, 0.5, 1]]) {
    const { code, body } = await h.save(opened.revision, { years_by_skill: [{ skill: 'Java', years: low }, { skill: 'Python', years: high }], career_years: total });
    assert.equal(code, 200, JSON.stringify(body));
    const said = generation();
    assert.deepEqual([said.skills, said.career], [{ Java: low, Python: high }, total], 'the reader accepts what the editor saved');
    ({ body: opened } = await h.read());
    assert.deepEqual([opened.rows.find((row) => row.skill === 'Java').used, opened.rows.find((row) => row.skill === 'Python').used, opened.career_used], [low, high, total]);
  }
});

test('a bad row refuses the whole save in words that name the row, and changes nothing', async () => {
  h.reset('refusals');
  const { body: opened } = await h.read(), before = h.text(), good = { skill: 'Java', years: 11 };
  const form = (rows, total = 16) => ({ years_by_skill: rows, career_years: total });
  const refusals = [
    [form([good, { skill: 'Rust', years: 0 }]), /^The years of row 2 \(Rust\) must be from 0\.5 to 60, in steps of 0\.5; it is 0\./],
    [form([{ skill: 'Rust', years: 61 }]), /^The years of row 1 \(Rust\) must be from 0\.5 to 60, in steps of 0\.5; it is 61\./],
    [form([{ skill: 'Rust', years: 60.5 }]), /row 1 \(Rust\) must be from 0\.5 to 60/],
    [form([{ skill: 'Rust', years: 2.3 }]), /row 1 \(Rust\) must be from 0\.5 to 60, in steps of 0\.5; it is 2\.3\./],
    [form([{ skill: 'Rust', years: null }]), /^The years of row 1 \(Rust\) must be a number from 0\.5 to 60, in steps of 0\.5\./],
    [form([{ skill: 'Rust', years: '11' }]), /row 1 \(Rust\) must be a number/],
    [form([{ skill: 'Rust', years: true }]), /row 1 \(Rust\) must be a number/],
    [form([good, { skill: 'java', years: 8 }]), /^Row 2 \(java\) is the same skill as row 1\. List each skill once\./],
    [form([{ skill: 'JavaScript', years: 8 }, good, { skill: 'JS', years: 3 }]), /^Row 3 \(JS\) is read as the same skill as row 1 \(JavaScript\)\. List each skill once\./],
    [form([good, { skill: '   ', years: 4 }]), /^Row 2 has no skill name\. Name the skill, or clear its years\./],
    [form([{ skill: 'x'.repeat(61), years: 4 }]), /^The skill of row 1 \(x{30}…\) is longer than 60 characters\./],
    [form([{ skill: 'Ja\u0007va', years: 4 }]), /^The skill of row 1 holds a character that cannot be saved\./],
    [form([{ skill: 'Ja\tva', years: 4 }]), /^The skill of row 1 holds a character that cannot be saved\./],
    [form([{ skill: '!!!', years: 4 }]), /^Row 1 \(!!!\) has no letters or digits to match in a résumé\./],
    [form([{ skill: 7, years: 4 }]), /^The skill of row 1 must be text\./],
    [form([{ skill: 'Rust', years: 4, note: 'x' }]), /^Row 1 of your years by skill must hold a skill and its years, and nothing else\./],
    [form(Array.from({ length: 41 }, (_, n) => ({ skill: `Skill ${n + 1}`, years: 1 }))), /^Keep at most 40 skills with a figure of your own; this has 41\./],
    [form([good], 0.5), /^Your years of experience in total must be from 1 to 70, in steps of 0\.5; it is 0\.5\./],
    [form([good], 70.5), /^Your years of experience in total must be from 1 to 70/],
    [form([good], 12.25), /^Your years of experience in total must be from 1 to 70, in steps of 0\.5; it is 12\.25\./],
    [form([good], 'not a number'), /^Your years of experience in total must be a number from 1 to 70/],
    [{ years_by_skill: [good] }, /^Save the whole years form/],
    [{ ...form([good]), roles: [] }, /^Save the whole years form/],
    [form('Java 11'), /^Your years by skill must be a list of skills and years\./],
  ];
  for (const [value, words] of refusals) {
    const { code, body } = await h.save(opened.revision, value);
    assert.equal(code, 422, JSON.stringify(body));
    assert.match(body.error, words);
    assert.match(body.error, /Nothing was saved\.$/);
  }
  assert.deepEqual([h.text(), h.backups().length], [before, 0], 'no refused save changed a byte or took a backup');
  const full = await h.save(opened.revision, form(Array.from({ length: 40 }, (_, n) => ({ skill: `Skill ${n + 1}`, years: 1 }))));
  assert.deepEqual([full.code, h.saved().years_by_skill.length], [200, 40], '40 rows and a 60-character name are within the form');
  const long = await h.save(full.body.revision, form([{ skill: 'x'.repeat(60), years: 4 }]));
  assert.equal(long.code, 200, JSON.stringify(long.body));
});

test('a main résumé that moved after the form read it is refused, never fitted; a years edit carries nothing else', async () => {
  h.reset('moved');
  const { body: opened } = await h.read();
  const first = await h.save(opened.revision, { years_by_skill: [{ skill: 'Java', years: 11 }], career_years: 16 });
  assert.equal(first.code, 200);
  const after = h.text();
  const stale = await h.save(opened.revision, { years_by_skill: [{ skill: 'Java', years: 12 }], career_years: 16 });
  assert.equal(stale.code, 409);
  assert.match(stale.body.error, /^Your main résumé changed after this form was opened, so nothing was saved\. Your years have been read again as saved/);
  const value = { years_by_skill: [{ skill: 'Java', years: 12 }], career_years: 16 };
  for (const edit of [{ op: 'add', field: 'years', value }, { op: 'set', field: 'years', value, before: '' }, { op: 'set', field: 'years', value, summary: 'x'.repeat(301) }]) {
    const odd = await h.call('POST', '/resume/master-edit', { revision: first.body.revision, edits: [edit] });
    assert.equal(odd.code, 422, JSON.stringify(odd.body));
    assert.match(odd.body.error, /Nothing was saved\.$/);
  }
  assert.equal(h.text(), after);
});

test('figures written by hand read as generation reads them, and every skill with a figure is listed however small the read', async () => {
  h.reset('by-hand', yearsProfile({ years_by_skill: [{ skill: 'k8s', years: '4' }, { skill: 'Python', years: 99 }, { skill: 'Docker' }, 'Java 11'], career_years: 'many' }));
  const { body } = await h.read(), said = generation();
  assert.deepEqual(body.rows.filter((row) => row.yours !== null), [{ skill: 'k8s', from_roles: null, yours: 4, used: 4, used_words: '4 years' }], 'only the figure generation reads');
  assert.deepEqual([said.skills, said.career, body.career_yours, body.career_used], [{ k8s: 4 }, null, null, 9]);
  const small = h.python(`
import json
from jobhunter import profile, years_edit
print(json.dumps(years_edit.read_section(profile.load(), 'r', 10)))
`);
  assert.deepEqual([small.rows.map((row) => row.skill), small.more], [['k8s'], 5], 'the rest are counted, not dropped without a word');
  const whole = await h.read();
  assert.equal(whole.body.rows.length, 6);
});
