/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Pin minimized education projections, atomic roster audit writes, migration immutability, manifest parity, and the live mounted PostgreSQL gate.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const store = path.join(root, '..');
const source = fs.readFileSync(path.join(root, 'src-routes', 'education-roster-routes.ts'), 'utf8');
const compiled = fs.readFileSync(path.join(root, 'routes', 'education-roster-routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '037-authorization-audit.sql'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'src-routes', 'education-schema.ts'), 'utf8');
const liveRunner = fs.readFileSync(path.join(store, 'scripts', 'security', 'run-live-lm-authorization-proof.mjs'), 'utf8');
const workflow = fs.readFileSync(path.join(store, '.github', 'workflows', 'security.yml'), 'utf8');

test('migration 037 records the complete server-timestamped audit fact and rejects every mutation form', () => {
  assert.match(manifest, /version:\s*1\.0\.9/);
  assert.match(manifest, /migrations\/037-authorization-audit\.sql/);
  for (const column of ['actor_student_id', 'student_id', 'class_id', 'action', 'occurred_at']) {
    assert.match(migration, new RegExp(`\\b${column}\\b`));
    assert.match(schema, new RegExp(`\\b${column}\\b`));
  }
  assert.match(migration, /NEW\.occurred_at := clock_timestamp\(\)/);
  assert.match(migration, /BEFORE UPDATE OR DELETE OR TRUNCATE/);
  assert.match(migration, /RAISE EXCEPTION 'lm_authorization_audit is append-only'/);
  assert.doesNotMatch(migration, /REFERENCES\s+lm_(?:students|classes)/i,
    'audit history must not cascade away with operational records');
  assert.match(schema, /audit_stamp_trigger[\s\S]*audit_immutable_trigger/);
});

test('roster provisioning and enrollment append audit rows before the transaction commits', () => {
  for (const artifact of [source, compiled]) {
    assert.match(artifact, /BEGIN[\s\S]*assertLockedRosterAccess[\s\S]*findOrProvisionStudent/);
    assert.match(artifact, /INSERT INTO lm_enrollments \(student_id, class_id, tenant_id\)/);
    assert.match(artifact, /roster\.student_provisioned/);
    assert.match(artifact, /roster\.enrollment_created/);
    assert.match(artifact, /recordRosterAudit[\s\S]*COMMIT/);
    assert.match(artifact, /WITH authorized AS MATERIALIZED[\s\S]*DELETE FROM lm_enrollments[\s\S]*INSERT INTO lm_authorization_audit/);
    assert.match(artifact, /roster\.enrollment_removed/);
  }
});

test('generic roster writes remain permanently retired and source/compiled SQL uses no wildcard projections', () => {
  for (const artifact of [source, compiled]) {
    assert.match(artifact, /router\.post\(['"]\/students['"], retireLegacyRosterWrite\)/);
    assert.match(artifact, /router\.post\(['"]\/enroll['"], retireLegacyRosterWrite\)/);
    assert.match(artifact, /status\(410\)/);
  }
  const wildcard = /\b(?:SELECT|RETURNING)\s+(?:[a-z_][a-z0-9_]*\.)?\*/i;
  for (const directory of ['src-routes', 'routes']) {
    for (const name of fs.readdirSync(path.join(root, directory)).filter((entry) => /\.(?:ts|js)$/.test(entry))) {
      const contents = fs.readFileSync(path.join(root, directory, name), 'utf8');
      assert.doesNotMatch(contents, wildcard, `${directory}/${name} must use an explicit projection`);
    }
  }
});

test('the enforced gate mounts compiled routes against a disposable least-privilege PostgreSQL role', async () => {
  const runner = await import('../../scripts/security/run-live-lm-authorization-proof.mjs');
  assert.throws(() => runner.parseLiveLmOptions([], {}), /--confirm-live-lm-authorization-proof/);
  assert.match(liveRunner, /LOGIN PASSWORD[\s\S]*NOSUPERUSER[\s\S]*NOBYPASSRLS/);
  for (const proof of ['student self', 'assigned teacher', 'unrelated teacher', 'tenant admin', 'cross-tenant teacher']) {
    assert.match(liveRunner, new RegExp(proof.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(liveRunner, /app\.use\('\/api\/education',[\s\S]*factory/);
  assert.match(liveRunner, /REVOKE INSERT ON lm_authorization_audit[\s\S]*atomic-rollback@a\.school/);
  assert.match(liveRunner, /UPDATE lm_authorization_audit[\s\S]*DELETE FROM lm_authorization_audit[\s\S]*TRUNCATE lm_authorization_audit/);
  assert.match(liveRunner, /DROP DATABASE IF EXISTS[\s\S]*DROP ROLE IF EXISTS/);
  assert.match(workflow, /run-live-lm-authorization-proof\.mjs[\s\S]*--confirm-live-lm-authorization-proof/);
  assert.match(workflow, /lm_postgres:[\s\S]*ports:\s*\n\s*- 5432\/tcp/);
  assert.match(workflow, /job\.services\.lm_postgres\.ports\[5432\]/);
});
