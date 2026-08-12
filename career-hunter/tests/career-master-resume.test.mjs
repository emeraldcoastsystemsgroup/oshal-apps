/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the Resume Studio MASTER document: `resume base` straight mapping and `resume base-save` whitelist round-trip run the CLI's exact Python programs against the real profile engine (backup rotation, audit, refusal-on-mismatch with the file untouched), with source-level assertions for the routing and surface seams only.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binPath = path.join(packageRoot, 'bin', 'oshal-jobhunter.js');
const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-master-resume-'));

after(() => { fs.rmSync(fixtureRoot, { recursive: true, force: true }); });

const fixtureProfile = {
  profile: {
    name: 'Alex Fixture', credential: 'PMP', location: 'Testville',
    clearance: 'None stated', citizenship: 'US',
    experience_summary: 'Seasoned platform lead.',
  },
  roles: [
    { title: 'Platform Lead', org: 'Acme', start: '2019-01', end: null,
      deliverables: ['Led the team that shipped the platform', 'Cut deploy time 60%'] },
    { title: 'SRE', org: 'Beta Corp', start: '2015-05', end: '2018-12',
      deliverables: ['Ran the on-call rotation'] },
  ],
  skills: { Cloud: { items: ['AWS', 'Terraform'] }, Leadership: { items: ['Mentoring'] } },
  metrics_bank: ['Cut deploy time 60%'],
  certifications: ['PMP'],
};

/** Load the CLI's private verb-to-Python mapping without widening its production exports. */
function loadEngineRuns() {
  const cliModule = new Module(binPath);
  cliModule.filename = binPath;
  cliModule.paths = Module._nodeModulePaths(path.dirname(binPath));
  const source = `${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__engineRuns=engineRuns;`;
  cliModule._compile(source, binPath);
  return cliModule.exports.__engineRuns;
}

/** Create one isolated per-test user store seeded with the fixture profile. */
function makeStore(name) {
  const dir = path.join(fixtureRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const careerDb = path.join(dir, 'career_db.json');
  fs.writeFileSync(careerDb, JSON.stringify(fixtureProfile, null, 2), 'utf8');
  return { dir, careerDb };
}

/** Environment routing the REAL engine at an isolated store, exactly as the wrapper would. */
function storeEnv(store) {
  return {
    PYTHONPATH: path.join(packageRoot, 'engine'),
    PYTHONIOENCODING: 'utf-8',
    JOBHUNTER_CAREER_DB: store.careerDb,
    JOBHUNTER_DATA: path.join(store.dir, 'data'),
  };
}

/** Execute one extracted CLI Python mapping against the real engine with a controlled store. */
function runPythonMapping(run, env) {
  return spawnSync(python, run, {
    cwd: packageRoot, env: { ...process.env, ...env },
    encoding: 'utf8', timeout: 20_000, windowsHide: true,
  });
}

test('resume base maps the profile straight into the editor document shape', () => {
  const engineRuns = loadEngineRuns();
  const store = makeStore('base');
  const result = runPythonMapping(engineRuns('resume', ['base'])[0], storeEnv(store));
  assert.equal(result.status, 0, result.stderr);
  const doc = JSON.parse(result.stdout.trim());
  assert.equal(doc.meta.master, true);
  assert.equal(doc.meta.name, 'Alex Fixture');
  assert.deepEqual(doc.cover, {});
  const r = doc.resume;
  assert.equal(r.headline, 'PMP', 'headline falls back to the credential line, never invented');
  assert.equal(r.summary, 'Seasoned platform lead.');
  assert.equal(r.clearance, 'None stated');
  assert.deepEqual(r.competencies, []);
  assert.deepEqual(r.skills, ['AWS', 'Terraform', 'Mentoring']);
  assert.equal(r.experience.length, 2);
  assert.deepEqual(r.experience[0], {
    title: 'Platform Lead', org: 'Acme', span: '2019-01–present',
    bullets: ['Led the team that shipped the platform', 'Cut deploy time 60%'],
  });
  assert.deepEqual(r.experience[1].bullets, fixtureProfile.roles[1].deliverables,
    'bullets are carried verbatim, not rewritten');
  assert.equal(r.experience[1].span, '2015-05–2018-12');
});

test('resume base-save round-trips whitelisted edits with backup, audit, and atomic replace', () => {
  const engineRuns = loadEngineRuns();
  const store = makeStore('save');
  const env = storeEnv(store);
  const base = runPythonMapping(engineRuns('resume', ['base'])[0], env);
  assert.equal(base.status, 0, base.stderr);
  const doc = JSON.parse(base.stdout.trim());
  doc.resume.headline = 'Principal Platform Engineering Leader';
  doc.resume.experience[0].bullets = [
    'Led the team that shipped the platform to 40 countries', 'Cut deploy time 60%',
  ];
  doc.resume.skills = ['AWS', 'Mentoring', 'Kubernetes'];
  const save = runPythonMapping(engineRuns('resume', ['base-save'])[0], {
    ...env, CH_RESUME_DOC: JSON.stringify({ resume: doc.resume }),
  });
  assert.equal(save.status, 0, save.stderr);
  const outcome = JSON.parse(save.stdout.trim());
  assert.equal(outcome.ok, true);
  assert.equal(outcome.changed, true);
  assert.ok(outcome.changelog.some((line) => /headline/.test(line)), 'changelog names the headline');
  assert.ok(outcome.changelog.some((line) => /Platform Lead/.test(line)), 'changelog names the role');

  const updated = JSON.parse(fs.readFileSync(store.careerDb, 'utf8'));
  assert.equal(updated.profile.headline, 'Principal Platform Engineering Leader');
  assert.equal(updated.profile.experience_summary, 'Seasoned platform lead.', 'unsent fields survive');
  assert.deepEqual(updated.roles[0].deliverables, doc.resume.experience[0].bullets);
  assert.deepEqual(updated.roles[1].deliverables, fixtureProfile.roles[1].deliverables);
  assert.deepEqual(updated.skills, {
    Cloud: { items: ['AWS'] },
    Leadership: { items: ['Mentoring'] },
    'Additional Skills': { items: ['Kubernetes'] },
  }, 'skills keep their grouping; removals leave groups; new items land in the additions group');

  const backups = fs.readdirSync(path.join(store.dir, 'backups'))
    .filter((name) => /^career_db\..+\.json$/.test(name));
  assert.equal(backups.length, 1, 'one pre-image backup rotated in');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(store.dir, 'backups', backups[0]), 'utf8')),
    fixtureProfile, 'the backup is the exact pre-edit profile',
  );
  const auditLines = fs.readFileSync(path.join(store.dir, 'enrichment_log.jsonl'), 'utf8')
    .trim().split('\n');
  const record = JSON.parse(auditLines[auditLines.length - 1]);
  assert.match(record.facts, /resume-studio master edit/);
  assert.ok(record.changelog.some((line) => /headline updated/.test(line)), 'audit carries the changelog');
});

test('resume base-save refuses a role index/title mismatch and leaves the file untouched', () => {
  const engineRuns = loadEngineRuns();
  const store = makeStore('refuse');
  const env = storeEnv(store);
  const base = runPythonMapping(engineRuns('resume', ['base'])[0], env);
  assert.equal(base.status, 0, base.stderr);
  const doc = JSON.parse(base.stdout.trim());
  doc.resume.headline = 'Should never land';
  doc.resume.experience[1].title = 'Chief Executive Officer';
  doc.resume.experience[1].bullets = ['Invented everything'];
  const before = fs.readFileSync(store.careerDb, 'utf8');
  const refused = runPythonMapping(engineRuns('resume', ['base-save'])[0], {
    ...env, CH_RESUME_DOC: JSON.stringify({ resume: doc.resume }),
  });
  assert.notEqual(refused.status, 0, 'a refused save must exit nonzero');
  const outcome = JSON.parse(refused.stdout.trim());
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /title does not match/);
  assert.equal(fs.readFileSync(store.careerDb, 'utf8'), before, 'the profile bytes are untouched');
  assert.equal(fs.existsSync(path.join(store.dir, 'backups')), false, 'no backup for a refused save');
});

test('resume base-save refuses an oversize CH_RESUME_DOC payload before parsing it', () => {
  const engineRuns = loadEngineRuns();
  const store = makeStore('oversize');
  const before = fs.readFileSync(store.careerDb, 'utf8');
  const refused = runPythonMapping(engineRuns('resume', ['base-save'])[0], {
    ...storeEnv(store),
    CH_RESUME_DOC: `{"resume":{"summary":"${'x'.repeat(263_000)}"}}`,
  });
  assert.notEqual(refused.status, 0);
  assert.match(JSON.parse(refused.stdout.trim()).error, /input limit/);
  assert.equal(fs.readFileSync(store.careerDb, 'utf8'), before);
});

test('the studio routes carry the master branch while numeric ids keep the packet contract', () => {
  // Source-level assertions are acceptable ONLY for this routing seam (the Python boundary is
  // exercised for real above); they pin the master branch to the exact engine verbs.
  const source = fs.readFileSync(
    path.join(packageRoot, 'src-routes', 'career-resume-studio-routes.ts'), 'utf8',
  );
  assert.match(source, /const MASTER_ID = 'master'/);
  assert.match(source, /\['resume', 'base'\]/);
  assert.match(source, /\['resume', 'base-save'\]/);
  assert.match(source, /CH_RESUME_DOC/);
  const docHandler = source.slice(source.indexOf('async function getResumeDocument'));
  assert.ok(docHandler.indexOf('MASTER_ID') >= 0
    && docHandler.indexOf('MASTER_ID') < docHandler.indexOf('Number.isFinite(postingId)'),
  'the master branch runs before the numeric-id guard in /resume/doc');
  assert.match(source, /res\.status\(400\)\.json\(\{ error: 'id required' \}\)/);
  assert.match(source, /no generated packet/);
  const saveHandler = source.slice(source.indexOf('async function saveResume'));
  assert.ok(saveHandler.indexOf('MASTER_ID') >= 0
    && saveHandler.indexOf('MASTER_ID') < saveHandler.indexOf('Number.isFinite(postingId)'),
  'the master branch runs before the numeric-id guard in /resume/save');
  assert.match(source, /rejectEngineStart\(res, \{ started: false, limitReason: result.limitReason \}, 'master resume save'\)/);
  assert.match(source, /master resume load/);
  const wrapper = fs.readFileSync(binPath, 'utf8');
  assert.match(wrapper, /if \(verb === 'resume'\) return resumeRuns\(rest\);/);
});

test('the studio surface always offers the master entry and saves it with the master flag', () => {
  const surface = fs.readFileSync(
    path.join(packageRoot, 'tools', 'career-resume-studio.html'), 'utf8',
  );
  assert.match(surface, /master\.value = 'master'; master\.textContent = '⭐ My resume \(master\)'/);
  assert.match(surface, /\{ postingId: 'master', resume: state\.resume \}/);
  assert.match(surface, /Save master resume/);
  assert.match(surface, /j\.changelog/);
  const list = surface.slice(surface.indexOf('async function loadList'));
  assert.ok(list.indexOf("sel.appendChild(master)") < list.indexOf('jobs.forEach'),
    'the master entry precedes the generated packet list');
});
