/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard SQLite-to-Postgres application provenance selection, mapping, and non-erasing conflict updates.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require claim-lease migration and rank-based monotonic replay so weaker evidence and null applied timestamps cannot downgrade Postgres state.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Include durable Apply run correlation while proving offline loads cannot overwrite a live one-time token.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const loader = readFileSync(
  new URL('../scripts/migrate-sqlite-to-postgres.js', import.meta.url),
  'utf8',
);

/** Return the bounded application-row filter before the Postgres insert begins. */
function applicationFilter() {
  const start = loader.indexOf('const appRows = rows.filter');
  const end = loader.indexOf("pg, 'career_user_applications'", start);
  assert.ok(start >= 0 && end > start, 'career application filter/insert section is missing');
  return loader.slice(start, end);
}

/** Return the complete career_user_applications insert/upsert call. */
function applicationInsert() {
  const start = loader.indexOf("pg, 'career_user_applications'");
  const end = loader.indexOf('\n        );', start);
  assert.ok(start >= 0 && end > start, 'career application insert call is missing');
  return loader.slice(start, end).replaceAll(/\s+/g, ' ');
}

test('provenance-only SQLite rows qualify for application migration', () => {
  const filter = applicationFilter();
  assert.match(filter, /s\.application_source/);
  assert.match(filter, /s\.application_task_id/);
  assert.match(filter, /s\.apply_run_id/);
});

test('application provenance and task id are mapped into the Postgres insert', () => {
  const insert = applicationInsert();
  assert.match(insert, /'apply_claimed_at', 'apply_run_id', 'apply_claim_token', 'confirmation_path', 'application_source', 'application_task_id'/);
  assert.match(insert, /apply_claimed_at: int\(s\.apply_claimed_at\)/);
  assert.match(insert, /apply_run_id: s\.apply_run_id \|\| null/);
  assert.match(insert, /apply_claim_token: null/);
  assert.match(insert, /application_source: s\.application_source/);
  assert.match(insert, /application_task_id: s\.application_task_id/);
});

test('an older SQLite store cannot downgrade stronger provenance already in Postgres', () => {
  const normalized = loader.replaceAll(/\s+/g, ' ');
  assert.match(normalized, /WHEN 'verified-submission' THEN 4/);
  assert.match(normalized, /WHEN 'worker-reported' THEN 3/);
  assert.match(normalized, /WHEN 'manual-mark' THEN 2/);
  assert.match(normalized, /WHEN 'unverified' THEN 1/);
  assert.match(normalized, /WHEN \$\{incomingRank\} > \$\{currentRank\} THEN EXCLUDED\.\$\{field\}/);
  assert.match(normalized, /WHEN \$\{incomingRank\} < \$\{currentRank\} THEN career_user_applications\.\$\{field\}/);
  assert.match(normalized, /applied_at = COALESCE\(career_user_applications\.applied_at, EXCLUDED\.applied_at\)/);
  assert.match(normalized, /apply_claim_token = career_user_applications\.apply_claim_token/);
  assert.doesNotMatch(normalized, /application_source = COALESCE\(EXCLUDED\.application_source/);
});
