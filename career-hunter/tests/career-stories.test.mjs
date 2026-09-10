/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the ADR-141 D7 story-review contract against the production engine module, and pin the route registrar + its bounds against the COMPILED routes.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = join(packageRoot, 'tests', 'career-stories-contract.py');
const engineRoot = join(packageRoot, 'engine');

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

  const registrar = readFileSync(join(packageRoot, 'routes', 'career-hunter-routes.js'), 'utf8');
  assert.match(registrar, /registerCareerStoryRoutes\)?\(router, ctx\)/, 'the package must register the review');
});

test('the engine verb is reachable through the launcher', () => {
  const launcher = readFileSync(join(packageRoot, 'bin', 'oshal-jobhunter.js'), 'utf8');
  assert.match(launcher, /case 'stories':/, 'the launcher must map the stories verb');
});
