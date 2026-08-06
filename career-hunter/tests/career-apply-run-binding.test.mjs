/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Apply V2 run/token storage parity and ensure offline migration never revives a one-time claim token.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Follow the storage-contract release while retaining the Apply V2 migration assertion.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const migration = read('migrations', '102-career-apply-run-binding.sql');
const manifest = read('oshal-app.yaml');
const pythonStore = read('engine', 'jobhunter', 'db.py');
const routeStore = read('src-routes', 'career-user-store.ts');
const loader = read('scripts', 'migrate-sqlite-to-postgres.js');

test('manifest ships the idempotent Apply V2 claim-binding migration', () => {
  assert.match(manifest, /version:\s*1\.6\.4/);
  assert.match(manifest, /migrations\/102-career-apply-run-binding\.sql/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS apply_run_id UUID/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS apply_claim_token UUID/);
  assert.match(migration, /CHECK \(apply_claim_token IS NULL OR apply_run_id IS NOT NULL\)/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS uq_career_user_apps_apply_run/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS uq_career_user_apps_claim_token/);
});

test('Python and route-opened SQLite stores retain both exact binding fields', () => {
  for (const field of ['apply_run_id', 'apply_claim_token']) {
    assert.match(pythonStore, new RegExp(`${field} TEXT`));
    assert.match(pythonStore, new RegExp(`"${field}": "TEXT"`));
    assert.match(routeStore, new RegExp(`${field}: 'TEXT'`));
  }
  assert.match(pythonStore, /"application_task_id", "apply_claimed_at", "apply_run_id", "apply_claim_token"/);
});

test('offline SQLite migration preserves run correlation but imports no live token', () => {
  assert.match(loader, /'apply_claimed_at', 'apply_run_id', 'apply_claim_token', 'confirmation_path'/);
  assert.match(loader, /apply_run_id:\s*s\.apply_run_id \|\| null/);
  assert.match(loader, /apply_claim_token:\s*null/);
  assert.match(loader, /apply_claim_token = career_user_applications\.apply_claim_token/);
  assert.doesNotMatch(loader, /apply_claim_token:\s*s\.apply_claim_token/);
});
