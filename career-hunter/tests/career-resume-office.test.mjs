/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the master resume as a Word document (tools/career-resume-office.js): the document Career makes passes AI Office's own model validation, an untouched document maps back to exactly the master, and an edited document saved through the REAL `resume base-save` engine path keeps the career profile valid (roles, titles, unsent fields intact). A changed role heading, a removed role and an extra section are said, never silently saved.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const office = createRequire(import.meta.url)('../tools/career-resume-office.js');
const { validate } = await import('../../presentations/tools/office/model.mjs');
const binPath = path.join(packageRoot, 'bin', 'oshal-jobhunter.js');
const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-resume-office-'));
after(() => { fs.rmSync(fixtureRoot, { recursive: true, force: true }); });

const profile = {
  profile: { name: 'Alex Fixture', credential: 'PMP', location: 'Testville', clearance: 'None stated',
    citizenship: 'US', experience_summary: 'Seasoned platform lead.' },
  roles: [
    { title: 'Platform Lead', org: 'Acme', start: '2019-01', end: null,
      deliverables: ['Led the team that shipped the platform', 'Cut deploy time 60%'] },
    { title: 'SRE', org: 'Beta Corp', start: '2015-05', end: '2018-12', deliverables: ['Ran the on-call rotation'] },
  ],
  skills: { Cloud: { items: ['AWS', 'Terraform'] }, Leadership: { items: ['Mentoring'] } },
  metrics_bank: ['Cut deploy time 60%'], certifications: ['PMP'],
};

function engine(verb, store, extra = {}) {
  const cli = new Module(binPath); cli.filename = binPath; cli.paths = Module._nodeModulePaths(path.dirname(binPath));
  cli._compile(`${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__engineRuns=engineRuns;`, binPath);
  const env = { ...process.env, PYTHONPATH: path.join(packageRoot, 'engine'), PYTHONIOENCODING: 'utf-8',
    JOBHUNTER_CAREER_DB: store.careerDb, JOBHUNTER_DATA: path.join(store.dir, 'data'), ...extra };
  const result = spawnSync(python, cli.exports.__engineRuns('resume', [verb])[0], { cwd: packageRoot, env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}
function store(name) {
  const dir = path.join(fixtureRoot, name); fs.mkdirSync(dir, { recursive: true });
  const careerDb = path.join(dir, 'career_db.json'); fs.writeFileSync(careerDb, JSON.stringify(profile, null, 2));
  return { dir, careerDb };
}
const paragraphs = (model) => model.pages[0].blocks;
const find = (model, text) => paragraphs(model).find((block) => block.runs.map((r) => r.text).join('') === text);
const setText = (block, text) => { block.runs = [{ ...block.runs[0], text }]; };

test('the master resume becomes a valid AI Office Word document with real headings and bullets', () => {
  const master = engine('base', store('layout'));
  const model = office.resumeToModel(master.resume, master.meta);
  assert.doesNotThrow(() => validate(model), 'AI Office accepts the document Career makes');
  assert.equal(model.kind, 'docx'); assert.equal(model.title, office.TITLE);
  assert.equal(find(model, 'Alex Fixture').style, 'title');
  assert.equal(find(model, 'Experience').style, 'heading1');
  assert.equal(find(model, 'Platform Lead — Acme').style, 'heading2');
  assert.equal(find(model, 'Cut deploy time 60%').list, 'bullet');
  const back = office.modelToResume(model, master.resume);
  assert.deepEqual(back.notes, []); assert.equal(back.error, undefined);
  assert.deepEqual(back.resume, master.resume, 'an untouched document maps back to exactly the master');
  assert.ok(office.sameResume(back.resume, master.resume));
});

test('an edited document saved through the existing base-save path keeps the career profile valid', () => {
  const s = store('save'), master = engine('base', s), model = office.resumeToModel(master.resume, master.meta);
  setText(find(model, master.resume.headline), 'Principal Platform Engineering Leader');
  setText(find(model, 'Led the team that shipped the platform'), 'Shipped the platform to 40 countries');
  const mapped = office.modelToResume(model, master.resume);
  assert.equal(mapped.error, undefined);
  assert.equal(office.sameResume(mapped.resume, master.resume), false);
  const saved = engine('base-save', s, { CH_RESUME_DOC: JSON.stringify({ resume: mapped.resume }) });
  assert.equal(saved.ok, true, JSON.stringify(saved)); assert.equal(saved.changed, true);
  const after = JSON.parse(fs.readFileSync(s.careerDb, 'utf8'));
  assert.equal(after.profile.headline, 'Principal Platform Engineering Leader');
  assert.deepEqual(after.roles.map((role) => role.title), ['Platform Lead', 'SRE'], 'roles and titles intact');
  assert.deepEqual(after.roles[0].deliverables, ['Shipped the platform to 40 countries', 'Cut deploy time 60%']);
  assert.deepEqual(after.roles[1].deliverables, profile.roles[1].deliverables);
  assert.equal(after.profile.experience_summary, 'Seasoned platform lead.', 'unsent fields survive');
  const reopened = engine('base', s);
  assert.ok(office.sameResume(office.modelToResume(model, reopened.resume).resume, reopened.resume),
    'the saved master and the document agree after the save');
});

test('a changed role heading is said and kept out of the save; the save still succeeds', () => {
  const s = store('heading'), master = engine('base', s), model = office.resumeToModel(master.resume, master.meta);
  setText(find(model, 'SRE — Beta Corp'), 'Senior SRE — Beta Corp');
  const mapped = office.modelToResume(model, master.resume);
  assert.match(mapped.notes.join(' '), /role heading "Senior SRE — Beta Corp" stays in this document only/);
  assert.equal(mapped.resume.experience[1].title, 'SRE');
  const saved = engine('base-save', s, { CH_RESUME_DOC: JSON.stringify({ resume: mapped.resume }) });
  assert.equal(saved.ok, true, 'no index/title mismatch refusal');
});

test('a removed role refuses the save in words; an extra section stays in the document only', () => {
  const master = engine('base', store('refuse')), model = office.resumeToModel(master.resume, master.meta);
  const blocks = paragraphs(model), role = blocks.indexOf(find(model, 'SRE — Beta Corp'));
  blocks.splice(role, 1);
  const removed = office.modelToResume(model, master.resume);
  assert.match(removed.error, /Experience section has 1 role and your profile has 2/);
  assert.equal(removed.resume, undefined, 'nothing to save');
  const extra = office.resumeToModel(master.resume, master.meta);
  paragraphs(extra).push({ ...find(extra, 'Summary'), id: 'extra-heading', runs: [{ ...find(extra, 'Summary').runs[0], text: 'Volunteering' }] });
  assert.match(office.modelToResume(extra, master.resume).notes.join(' '), /"Volunteering" stays in this document only/);
});
