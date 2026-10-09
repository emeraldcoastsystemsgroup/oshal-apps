/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Gate the migration-106 outbox and the reverse projector on disposable PostgreSQL and real SQLite stores: transactional capture, owner isolation, three kill points that replay to convergence, a no-op full replay, commit-order safety and fail-closed refusals.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The commit-order case also asserts its first pass ran with the cluster-wide horizon exactly at the still-open T_late, which the contract now waits for instead of assuming.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { packageRoot, postgresSkip, requireProvisionedInCi, runContract } from './helpers/career-pg-env.mjs';

let summary;

/** Run the Python contract once; every case below reads the same evidence. */
function contract() {
  summary ??= runContract('tests/career-reverse-sync-contract.py', 'CAREER_REVERSE_SYNC_CONTRACT=', [], 600_000);
  return summary;
}

test('CI cannot silently omit the reverse-sync contract', () => {
  requireProvisionedInCi();
});

test('migration 106 is declared after the schema it captures and enforces its own row security', () => {
  const manifest = readFileSync(join(packageRoot, 'oshal-app.yaml'), 'utf8');
  const declared = [...manifest.matchAll(/^\s+- (migrations\/\S+\.sql)/gm)].map((m) => m[1]);
  const index = declared.indexOf('migrations/106-career-store-change-log.sql');
  assert.ok(index > declared.indexOf('migrations/103-career-interview-source-identity.sql'), declared.join('\n'));
  assert.ok(index > declared.indexOf('migrations/098-career-peruser-views.sql'));
  const sql = readFileSync(join(packageRoot, 'migrations', '106-career-store-change-log.sql'), 'utf8');
  for (const table of ['career_store_change_log', 'career_reverse_sync_checkpoint']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
  }
});

test('a committed owner write records one outbox row; rollback, no-op and loader replay record none', {
  skip: postgresSkip(),
}, () => {
  const { outbox } = contract();
  assert.equal(outbox.committed, 1);
  assert.equal(outbox.rolledBack, 0);
  assert.equal(outbox.noop, 0);
  assert.equal(outbox.ownerMarkerCaptured, true, 'an owner session must not suppress capture');
  assert.equal(outbox.operatorReplayCaptured, false);
});

test('owners cannot read, rewrite, delete or forge outbox rows', { skip: postgresSkip() }, () => {
  assert.deepEqual(contract().outbox.isolation, {
    visibleToOwner: 0, checkpointsVisible: 0, rewritten: 0, deleted: 0,
    forgedForeignOwner: 'InsufficientPrivilege', unknownOperation: 'CheckViolation',
  });
});

test('killing the worker at each point replays to a converged store without duplicates', {
  skip: postgresSkip(),
}, () => {
  const rounds = Object.fromEntries(contract().rounds.map((round) => [round.point, round]));
  assert.deepEqual(Object.keys(rounds), ['before-sqlite-commit', 'after-sqlite-commit', 'before-checkpoint-commit']);
  for (const round of Object.values(rounds)) assert.equal(round.exit, 86);
  assert.equal(rounds['before-sqlite-commit'].sqliteChangedByKill, false);
  assert.ok(rounds['before-sqlite-commit'].replayApplied > 0);
  for (const point of ['after-sqlite-commit', 'before-checkpoint-commit']) {
    assert.equal(rounds[point].sqliteChangedByKill, true);
    assert.equal(rounds[point].replayApplied, 0, `${point}: replay re-applied a committed change`);
    assert.ok(rounds[point].replaySkipped > 0);
  }
});

test('the projected application keeps every lifecycle fact and never a live claim token', {
  skip: postgresSkip(),
}, () => {
  const { lifecycle } = contract();
  assert.equal(lifecycle.application.status, 'applied');
  assert.equal(lifecycle.application.application_source, 'verified-submission');
  assert.equal(lifecycle.application.apply_run_id, '7d4c2b1a-0e9f-4a8b-9c7d-6e5f4a3b2c1d');
  assert.equal(lifecycle.application.apply_claim_token, null);
  assert.ok(lifecycle.application.generated_at && lifecycle.application.applied_at);
  assert.equal(lifecycle.enginePosting.target_role, 1);
  assert.equal(lifecycle.seededClaimCleared, true, 'a pre-promotion SQLite claim token survived projection');
});

test('a full replay from horizon 0 is a no-op', { skip: postgresSkip() }, () => {
  const { fullReplay } = contract();
  assert.equal(fullReplay.unchanged, true);
  assert.equal(fullReplay.applied, 0);
  assert.ok(fullReplay.skipped > 0);
});

test('a change committed after a higher change_id is held back, then delivered', { skip: postgresSkip() }, () => {
  assert.deepEqual(contract().commitOrder, {
    projectedWhileOpen: 'early-commit', heldBack: null, deliveredAfterCommit: 'late-commit',
    firstPassHorizon: true,
  });
});

test('every unmappable change stops the worker without moving its checkpoint', { skip: postgresSkip() }, () => {
  const { failClosed, final } = contract();
  assert.deepEqual(failClosed.map((entry) => entry.case), ['unknown-table', 'schema-version',
    'missing-owner', 'source-key-collision', 'missing-source-id', 'sqlite-schema-mismatch']);
  for (const entry of failClosed) {
    assert.equal(entry.exit, 3);
    assert.equal(entry.failuresCounted, 1);
    assert.equal(entry.metricsError, entry.error);
  }
  assert.equal(final.caughtUp, true);
  assert.equal(final.lastError, null);
  assert.equal(final.rowFailures, failClosed.length);
});
