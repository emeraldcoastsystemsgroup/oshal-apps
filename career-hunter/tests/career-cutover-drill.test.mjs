/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Gate the disposable promotion + rollback rehearsal: replay-stable loads, a write-free PostgreSQL smoke equal to SQLite, a rollback gate that refuses an outstanding claim and projector lag, an engine read on SQLite that holds every post-cutover write, and real observation samples (archive, owner-isolation probe, activity, window resets).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postgresSkip, requireProvisionedInCi, runContract } from './helpers/career-pg-env.mjs';

let evidence;

/** Run the drill once; every case below reads the same evidence. */
function drill() {
  evidence ??= runContract('tests/career-cutover-drill.py', 'CAREER_CUTOVER_DRILL=', [], 600_000);
  return evidence;
}

test('CI cannot silently omit the cutover drill', () => {
  requireProvisionedInCi();
});

test('promotion: two loads, no change on replay, nothing captured, and a write-free smoke', {
  skip: postgresSkip(),
}, () => {
  const { promotion, smoke } = drill();
  assert.deepEqual(promotion, { loaderRuns: 2, replayUnchanged: true, outboxAfterLoads: 0 });
  assert.deepEqual(smoke, { postings: 4, statsEqual: true, writes: 0 });
});

test('rollback is refused while a claim is outstanding or the projector lags', { skip: postgresSkip() }, () => {
  const { gate } = drill().rollback;
  assert.deepEqual(gate.claimAndLag, [2, ['projector-lag', 'outstanding-claims']]);
  assert.deepEqual(gate.lag, [2, ['projector-lag']]);
  assert.deepEqual(gate.ready, [0, []]);
});

test('rolled-back SQLite holds every PostgreSQL write; without projection it was stale', {
  skip: postgresSkip(),
}, () => {
  const { rollback, postgresWrites } = drill();
  assert.ok(postgresWrites.outboxRows > 0);
  assert.deepEqual(rollback.staleBeforeProjection, { posting12: 'new', postings: 4, activeDrillPostings: [] });
  assert.deepEqual(rollback.afterRollback, {
    posting12: 'applied', postings: 6, activeDrillPostings: ['Principal Cloud Engineer'],
  });
  assert.deepEqual(rollback.convergence, { converged: true, failures: [] });
});

test('observation: an in-bounds sample archives its report; a missing marker and a gap reset the window', {
  skip: postgresSkip(),
}, () => {
  const { observation } = drill();
  const { firstSample } = observation;
  assert.equal(firstSample.inBounds, true);
  assert.equal(firstSample.reverseSync, true);
  assert.deepEqual({ ok: firstSample.rls.ok, foreign: firstSample.rls.foreignRowsVisible, owners: firstSample.rls.probedOwners },
    { ok: true, foreign: 0, owners: 2 });
  assert.ok(firstSample.activity.postingsIngested >= 2);
  assert.ok(firstSample.activity.postingsDeactivated >= 1);
  assert.ok(firstSample.activity.draftsGenerated >= 1);
  assert.ok(firstSample.activity.applicationTransitions.applied >= 1);
  assert.match(firstSample.archivedReport, /^reports\/convergence-\d{8}T\d{6}Z\.json$/);
  assert.deepEqual(observation.resets, [['nightly-marker-missing'], ['missing-sample']]);
  assert.equal(observation.samples, 3);
  assert.equal(observation.archivedReports.length, 2, 'one report per nightly completion marker');
});
