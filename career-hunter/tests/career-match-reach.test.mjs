/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The nightly match reaches every open job: 79,342 open jobs had never been matched to the owner's resume because selection used the employer's date alone.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const postgresAdminUrl = process.env.CAREER_TEST_POSTGRES_ADMIN_URL;

function run(backend) {
  const args = [join(packageRoot, 'tests', 'career-match-reach-contract.py'), '--backend', backend];
  if (backend === 'postgres') args.push('--admin-url', postgresAdminUrl);
  const result = spawnSync('python3', args, { cwd: packageRoot, encoding: 'utf8', timeout: 300_000 });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const line = result.stdout.split(/\r?\n/).findLast(entry => entry.startsWith('CAREER_MATCH_REACH='));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice('CAREER_MATCH_REACH='.length));
}

function assertReach(report) {
  const { fits } = report;
  assert.ok(fits['first-seen-late'] > 0, 'a job posted weeks ago but first seen today is matched');
  assert.ok(fits['never-matched'] > 0, 'an open job that passed through unmatched is caught up');
  assert.ok(fits.fresh > 0, 'a job dated inside the window is matched');
  assert.ok(fits.undated > 0, 'a job with no date is matched by when it was first seen');
  assert.equal(fits['already-matched'], 77, 'an old job with a saved fit is not scanned again');
  assert.equal(fits.closed, null, 'a closed job is not matched');
  assert.equal(report.first, 4);
  assert.equal(report.second, 3, 'once caught up, the never-matched job leaves the nightly scan');
}

test('the match reaches every open job on a person\'s store over a read-only corpus', () => {
  assertReach(run('sqlite'));
});

test('the match reaches every open job on PostgreSQL under its row policy', {
  skip: postgresAdminUrl ? false : 'CAREER_TEST_POSTGRES_ADMIN_URL is not available locally',
}, () => {
  assertReach(run('postgres'));
});
