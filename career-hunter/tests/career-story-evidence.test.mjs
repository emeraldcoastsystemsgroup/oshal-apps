/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the ADR-141 D7 evidence half end to end: the real engine's `resume base` verb hands the Resume Studio each role's stories under the bullet they support, the shipped surface renders them there, and the production prompt/citation contract runs against a real profile file.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Raise the contract's floor to cover its new generate_for section. Clause 3 of the done-when was unguarded — the two calls that implement it could both be deleted with every suite still green — so the contract now runs the real pipeline and reads the citation record off the packet it wrote. The floor is what stops that section from being quietly dropped: a contract that runs fewer checks than it did is not a passing contract.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binPath = path.join(packageRoot, 'bin', 'oshal-jobhunter.js');
const surfacePath = path.join(packageRoot, 'tools', 'career-resume-studio.html');
const contractPath = path.join(packageRoot, 'tests', 'career-story-evidence-contract.py');
const engineRoot = path.join(packageRoot, 'engine');
const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-story-evidence-'));

after(() => { fs.rmSync(fixtureRoot, { recursive: true, force: true }); });

const DEPLOY_BULLET = 'Cut deploy time from 40 minutes to 6 by rebuilding the release pipeline';
const DEPLOY_STORY = 'The pipeline rebuilt every image; layer caching took it to six minutes.';

const fixtureProfile = {
  profile: { name: 'Alex Fixture', credential: 'PMP', experience_summary: 'Platform lead.' },
  roles: [
    {
      title: 'Platform Lead',
      org: 'Acme',
      start: '2019-01',
      end: null,
      deliverables: [DEPLOY_BULLET, 'Grew the platform team from 4 to 11'],
      stories: [{ title: 'Six-minute deploys', story: DEPLOY_STORY, bullet: DEPLOY_BULLET }],
    },
    { title: 'SRE', org: 'Beta Corp', start: '2015-05', end: '2018-12', deliverables: ['Ran on-call'] },
  ],
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

test('the story-evidence contract holds against a real profile file', () => {
  const result = spawnSync(python, [contractPath], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
    env: { ...process.env, PYTHONPATH: engineRoot, PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  assert.deepEqual(report.failed, [], 'every contract check must hold');
  // 55 today: the prompt/citation/master-document sections plus the 16 that drive the real
  // generate_for. A run that reports fewer has lost a section, which is the failure this bar
  // exists to catch -- an unrun check cannot fail, so `failed: []` alone proves nothing.
  assert.ok(report.checks >= 55, `expected the full contract, ran ${report.checks}`);
});

test('resume base hands the studio each role\'s stories under the bullet they support', () => {
  const dir = path.join(fixtureRoot, 'base');
  fs.mkdirSync(dir, { recursive: true });
  const careerDb = path.join(dir, 'career_db.json');
  fs.writeFileSync(careerDb, JSON.stringify(fixtureProfile, null, 2), 'utf8');
  const run = loadEngineRuns()('resume', ['base'])[0];
  const result = spawnSync(python, run, {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 20_000,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONPATH: engineRoot,
      PYTHONIOENCODING: 'utf-8',
      JOBHUNTER_CAREER_DB: careerDb,
      JOBHUNTER_DATA: path.join(dir, 'data'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const experience = JSON.parse(result.stdout.trim()).resume.experience;
  assert.deepEqual(experience[0].stories, [
    { title: 'Six-minute deploys', story: DEPLOY_STORY, bullet: DEPLOY_BULLET, weak: false },
  ], 'the told story reaches the editor with the bullet it proves');
  assert.ok(experience[0].bullets.includes(experience[0].stories[0].bullet),
    'a story may only cite a bullet the role carries');
  assert.deepEqual(experience[1].stories, [], 'a role with no story carries an empty list, not a missing key');
});

/** Execute the shipped surface's own experience renderer, with no DOM and no network. */
function surfaceRender(experience) {
  const source = fs.readFileSync(surfacePath, 'utf8');
  const escSrc = source.match(/const esc = \([\s\S]*?\);\n/);
  assert.ok(escSrc, 'the surface must still define esc');
  const expSrc = source.match(/function expHtml\(experience\)\s*\{[\s\S]*?\n\}\n/);
  assert.ok(expSrc, 'the surface must expose expHtml so the preview can be proved without a browser');
  // eslint-disable-next-line no-new-func
  return new Function(`${escSrc[0]}${expSrc[0]}return expHtml(${JSON.stringify(experience)});`)();
}

test('the studio preview renders a story beneath the bullet it supports', () => {
  const html = surfaceRender([{
    title: 'Platform Lead',
    org: 'Acme',
    span: '2019-01–present',
    bullets: [DEPLOY_BULLET, 'Grew the platform team from 4 to 11'],
    stories: [{ title: 'Six-minute deploys', story: DEPLOY_STORY, bullet: DEPLOY_BULLET }],
  }]);
  const supported = html.indexOf(DEPLOY_BULLET);
  const story = html.indexOf(DEPLOY_STORY);
  const otherBullet = html.indexOf('Grew the platform team');
  assert.ok(supported >= 0 && story > supported && story < otherBullet,
    'the story must render between the bullet it supports and the next one');
  assert.match(html, /class="story"/, 'the story is its own element, not run into the bullet text');
});

test('a story whose bullet is gone still shows, and a role with none renders as it always did', () => {
  const orphan = surfaceRender([{
    title: 'Platform Lead', org: 'Acme', span: '2019', bullets: ['A rewritten bullet'],
    stories: [{ title: 'Six-minute deploys', story: DEPLOY_STORY, bullet: DEPLOY_BULLET }],
  }]);
  assert.ok(orphan.includes(DEPLOY_STORY),
    'an edit that rewrites the bullet must not silently drop the evidence behind it');
  const plain = surfaceRender([{ title: 'SRE', org: 'Beta Corp', span: '2015', bullets: ['Ran on-call'] }]);
  assert.ok(!plain.includes('class="story"'), 'a role with no story renders no story block');
  assert.match(plain, /<li>Ran on-call<\/li>/);
});

test('the surface escapes a story instead of rendering it as markup', () => {
  const html = surfaceRender([{
    title: 'Platform Lead', org: 'Acme', span: '2019', bullets: ['A bullet'],
    stories: [{ title: '<img src=x>', story: '<script>alert(1)</script>', bullet: 'A bullet' }],
  }]);
  assert.ok(!html.includes('<script>'), 'story text is escaped, never injected');
  assert.ok(html.includes('&lt;script&gt;'));
});
