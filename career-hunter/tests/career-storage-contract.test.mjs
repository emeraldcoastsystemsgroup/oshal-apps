/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Require exact engine pins, fail-closed store selection, and one shared real-backend Career contract in SQLite and disposable PostgreSQL.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = join(packageRoot, 'tests', 'career-storage-contract.py');
const engineRoot = join(packageRoot, 'engine');
const postgresAdminUrl = process.env.CAREER_TEST_POSTGRES_ADMIN_URL;

/** Run the production Python storage contract and return its final structured report. */
function runContract(backend) {
  const args = [contractPath, '--backend', backend];
  if (backend === 'postgres') args.push('--admin-url', postgresAdminUrl);
  const result = spawnSync('python', args, {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, PYTHONPATH: engineRoot },
  });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const line = result.stdout.split(/\r?\n/).findLast((entry) =>
    entry.startsWith('CAREER_STORAGE_CONTRACT='));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice('CAREER_STORAGE_CONTRACT='.length));
}

test('engine requirements are exact and include the PostgreSQL runtime driver', () => {
  const requirements = readFileSync(join(engineRoot, 'requirements.txt'), 'utf8');
  const packages = requirements.split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => line && !line.startsWith('#'));
  assert.ok(packages.length >= 8);
  assert.ok(packages.every((entry) => /^[A-Za-z0-9_.-]+==[^=\s]+$/.test(entry)), packages);
  assert.ok(packages.some((entry) => entry.startsWith('psycopg2-binary==')));
});

test('unknown JOBHUNTER_STORE values fail before a database can be opened', () => {
  const result = spawnSync('python', ['-c', 'from jobhunter import config'], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, PYTHONPATH: engineRoot, JOBHUNTER_STORE: 'postgress' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported JOBHUNTER_STORE value 'postgress'/);
  assert.match(result.stderr, /Refusing to select a fallback/);
});

test('shared Career storage and deterministic ATS/nightly contract passes on SQLite', () => {
  const report = runContract('sqlite');
  assert.deepEqual(report.ats, { firstIndexed: 2, secondIndexed: 1 });
  assert.equal(report.counts.postings, 2);
  assert.equal(report.counts.active, 1);
  assert.equal(report.counts.applied, 1);
});

test('shared Career storage and deterministic ATS/nightly contract passes on PostgreSQL', {
  skip: postgresAdminUrl ? false : 'CAREER_TEST_POSTGRES_ADMIN_URL is not available locally',
}, () => {
  const report = runContract('postgres');
  assert.deepEqual(report.ats, { firstIndexed: 2, secondIndexed: 1 });
  assert.equal(report.counts.postings, 2);
  assert.equal(report.counts.active, 1);
  assert.equal(report.counts.applied, 1);
});

test('CI cannot silently omit the disposable PostgreSQL half of the shared contract', () => {
  if (process.env.CI) assert.ok(postgresAdminUrl, 'CAREER_TEST_POSTGRES_ADMIN_URL is required in CI');
});
