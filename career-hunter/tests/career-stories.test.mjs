/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the ADR-141 D7 story-review contract against the production engine module, and pin the route registrar + its bounds against the COMPILED routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | GET /stories reads the profile in JavaScript (lib/career-stories-state.js) because the native kernel's package sandbox carries no Python source. Guard that the JavaScript projection answers exactly what the engine's stories.state() answers for the same real profile file (missing, partial with malformed roles, and complete), that an unreadable profile is refused rather than read as empty, and that the compiled GET /stories no longer starts the engine.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = join(packageRoot, 'tests', 'career-stories-contract.py');
const engineRoot = join(packageRoot, 'engine');
const require = createRequire(import.meta.url);
const { readStoriesState, PROFILE_MAX_BYTES } = require('../lib/career-stories-state.js');

/** The engine's own state() for one profile file: what `jobhunter stories list` prints. */
function engineState(profilePath) {
  const result = spawnSync(process.env.JOBHUNTER_PYTHON || 'python', ['-c',
    'import json\nfrom jobhunter import stories\nprint(json.dumps(stories.state(), ensure_ascii=False))'], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, PYTHONPATH: engineRoot, PYTHONIOENCODING: 'utf-8', JOBHUNTER_CAREER_DB: profilePath },
  });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
}

/** Roles as resume ingest and the review leave them, plus the malformed shapes state() tolerates. */
const PARTIAL = {
  profile: { name: 'Parity Candidate' },
  roles: [
    { title: 'Platform Lead', org: 'Acme', deliverables: ['Rebuilt the release pipeline...', 'Grew the team'],
      stories: [{ at: '2026-10-01T00:00:00', title: 'Pipeline', story: 'I rebuilt it — 40 → 6 minutes.',
        bullet: 'Rebuilt the release pipeline...', answer: 'I rebuilt it.', source: 'verbatim' }, 'not a story'] },
    { title: '  Site Reliability Engineer ', org: '', deliverables: ['  Ran the on-call rotation.  ', '', '   '] },
    { title: '', org: 'Gamma Labs', deliverables: [] },
    { deliverables: 'not a list', stories: 'not a list' },
    'not a role',
  ],
};
const COMPLETE = { roles: [{ title: 'Engineer', org: 'Delta', deliverables: ['Shipped it'], stories: [{ story: 'I shipped it.' }] }] };

test('the JavaScript review read answers exactly what the engine answers for the same profile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-stories-parity-'));
  try {
    for (const [name, profile] of [['missing', null], ['partial', PARTIAL], ['complete', COMPLETE], ['empty', {}]]) {
      const userDir = join(root, name);
      mkdirSync(userDir);
      const profilePath = join(userDir, 'career_db.json');
      if (profile) writeFileSync(profilePath, JSON.stringify(profile, null, 2));
      assert.deepEqual(await readStoriesState(userDir), engineState(profilePath), `${name} profile`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unreadable profile is refused, never read as an empty review', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-stories-refuse-'));
  try {
    const cases = {
      'not json': '{"roles": [',
      'a list': '[]',
      'over budget': `{"pad":"${'x'.repeat(PROFILE_MAX_BYTES)}"}`,
    };
    for (const [name, content] of Object.entries(cases)) {
      const userDir = join(root, name.replace(/\s/g, '-'));
      mkdirSync(userDir);
      writeFileSync(join(userDir, 'career_db.json'), content);
      await assert.rejects(readStoriesState(userDir), `${name} is refused`);
    }
    const directory = join(root, 'directory');
    mkdirSync(join(directory, 'career_db.json'), { recursive: true });
    await assert.rejects(readStoriesState(directory), 'a directory in place of the profile is refused');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the story review holds its contract against a real profile file', () => {
  const result = spawnSync('python', [contractPath], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, PYTHONPATH: engineRoot },
  });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  assert.deepEqual(report.failed, [], 'every contract check must hold');
  assert.ok(report.checks >= 20, `expected the full contract, ran ${report.checks}`);
});

test('the compiled routes register the review and bound one answer', () => {
  const source = readFileSync(join(packageRoot, 'routes', 'career-stories-routes.js'), 'utf8');
  assert.match(source, /router\.get\('\/stories'/, 'GET /stories must be registered');
  assert.match(source, /router\.post\('\/stories\/answer'/, 'POST /stories/answer must be registered');
  // The answer is bounded and the caller is resolved before anything runs — a review turn must
  // never become an unbounded write, and must never run for an unauthenticated caller.
  assert.match(source, /MAX_RESPONSE_CHARS|6000/, 'an answer must be length-bounded');
  assert.match(source, /unauthorized/, 'an unauthenticated caller must be refused');
  // The read is served from the profile file: the native package sandbox has no Python to start.
  assert.doesNotMatch(source, /\['stories', 'list'\]/, 'GET /stories must not start the engine');
  assert.match(source, /readStoriesState\(/, 'GET /stories reads the profile through lib/career-stories-state.js');

  const registrar = readFileSync(join(packageRoot, 'routes', 'career-hunter-routes.js'), 'utf8');
  assert.match(registrar, /registerCareerStoryRoutes\)?\(router, ctx\)/, 'the package must register the review');
});

test('the engine verb is reachable through the launcher', () => {
  const launcher = readFileSync(join(packageRoot, 'bin', 'oshal-jobhunter.js'), 'utf8');
  assert.match(launcher, /case 'stories':/, 'the launcher must map the stories verb');
});
