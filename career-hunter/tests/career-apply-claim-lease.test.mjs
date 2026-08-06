/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the registered Postgres claim-lease migration and SQLite/Python schema parity required by bounded Apply recovery.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../migrations/101-career-apply-claim-lease.sql', import.meta.url), 'utf8',
);
const manifest = readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
const pythonStore = readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');

test('migration 101 adds a bounded nonnegative claim lease and outstanding-claim index', () => {
  assert.match(migration, /ALTER TABLE career_user_applications[\s\S]*apply_claimed_at BIGINT/);
  assert.match(migration, /CHECK \(apply_claimed_at IS NULL OR apply_claimed_at >= 0\)/);
  assert.match(migration, /ON career_user_applications\(user_sub, apply_active, apply_claimed_at\)/);
  assert.match(migration, /WHERE apply_active = 0 AND applied_at IS NULL/);
});

test('claim-lease migration is registered after application provenance', () => {
  const provenance = manifest.indexOf('migrations/100-career-application-provenance.sql');
  const lease = manifest.indexOf('migrations/101-career-apply-claim-lease.sql');
  assert.ok(provenance >= 0 && lease > provenance);
});

test('Python SQLite and Postgres routing both retain apply_claimed_at', () => {
  assert.match(pythonStore, /apply_claimed_at INTEGER/);
  assert.match(pythonStore, /"apply_claimed_at": "INTEGER"/);
  assert.match(pythonStore, /"application_task_id", "apply_claimed_at"/);
  assert.match(pythonStore, /us\.apply_active, us\.apply_claimed_at, us\.confirmation_path/);
});
