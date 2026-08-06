/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard bounded convergence evidence, corpus replay updates, and stable interview synchronization before cutover.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = join(packageRoot, 'engine', 'sync', 'report_convergence.py');
const loaderPath = join(packageRoot, 'scripts', 'migrate-sqlite-to-postgres.js');
const migrationPath = join(packageRoot, 'migrations', '103-career-interview-source-identity.sql');

test('convergence reporter is executable, read-only by default, and can fail a cutover gate', () => {
  const help = spawnSync('python', [reportPath, '--help'], {
    cwd: packageRoot, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--require-convergence/);
  const source = readFileSync(reportPath, 'utf8');
  assert.match(source, /fetchmany\(2_000\)/);
  assert.match(source, /hashlib\.sha256\(\)/);
  assert.match(source, /CAREER_CONVERGENCE_REPORT=/);
  assert.match(source, /postgresUnmapped/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\s+(?:INTO\s+)?career_/i);
});

test('replayed loader updates every mutable dataset and never imports a live claim token', () => {
  const loader = readFileSync(loaderPath, 'utf8');
  for (const key of [
    'ON CONFLICT (id) DO UPDATE SET',
    'ON CONFLICT (user_sub, id) DO UPDATE SET',
    'ON CONFLICT (user_sub, key) DO UPDATE SET',
    'ON CONFLICT (user_sub, source_id) WHERE source_id IS NOT NULL DO UPDATE SET',
  ]) assert.match(loader, new RegExp(key.replace(/[()]/g, '\\$&')));
  assert.match(loader, /apply_claim_token: null/);
  assert.match(loader, /source_id: int\(a\.id\)/);
  assert.doesNotMatch(loader, /title: p\.title \|\| '\(untitled\)'/);
});

test('interview source identity is unique per user without guessing old generated ids', () => {
  const migration = readFileSync(migrationPath, 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS source_id BIGINT/);
  assert.match(migration, /ON career_user_interview_assessments\(user_sub, source_id\)/);
  assert.match(migration, /WHERE source_id IS NOT NULL/);
  assert.doesNotMatch(migration, /SET source_id\s*=\s*id/i);
});
