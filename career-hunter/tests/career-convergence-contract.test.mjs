/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Gate the real loader + convergence reporter pair on disposable PostgreSQL: converge, replay with zero observable change, isolate owners, and exit 2 naming each dataset a mutation breaks.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Give the contract child the same 600 s budget as its siblings: it may queue behind them for the shared server's contract lock.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postgresSkip, requireProvisionedInCi, runContract } from './helpers/career-pg-env.mjs';

const OWNER_A = 'convergence-owner-a';
const OWNER_B = 'convergence-owner-b';
let summary;

/** Run the Python contract once; every case below reads the same evidence. */
function contract() {
  summary ??= runContract('tests/career-convergence-contract.py', 'CAREER_CONVERGENCE_CONTRACT=', [], 600_000);
  return summary;
}

test('CI cannot silently omit the convergence contract', () => {
  requireProvisionedInCi();
});

test('loaded SQLite stores converge and a second loader run changes zero observable rows', {
  skip: postgresSkip(),
}, () => {
  const { firstDigests, replayUnchanged } = contract();
  assert.equal(replayUnchanged, true);
  assert.equal(firstDigests['corpus.postings'].count, 4);
  assert.equal(firstDigests['corpus.companies'].count, 2);
  assert.equal(firstDigests[`${OWNER_A}.applications`].count, 1);
  assert.equal(firstDigests[`${OWNER_B}.applications`].count, 0);
  assert.equal(firstDigests[`${OWNER_A}.interviews`].count, 1);
});

test("owner B's key queries and RLS session never include owner A's rows", { skip: postgresSkip() }, () => {
  assert.deepEqual(contract().isolation, {
    applications: 0, foreignRecruiters: 0, foreignScores: 0, ownScores: 3,
  });
});

test('a broken store exits 2 and names every failing dataset', { skip: postgresSkip() }, () => {
  const { mutation } = contract();
  assert.equal(mutation.exit, 2);
  assert.deepEqual(mutation.named, mutation.reportFailures);
  for (const dataset of ['corpus.postings', `users.${OWNER_A}.scores`,
    `users.${OWNER_A}.applications`, `users.${OWNER_A}.interviews`]) {
    assert.ok(mutation.named.includes(dataset), `${dataset} not named: ${mutation.named}`);
  }
  for (const dataset of ['corpus.companies', `users.${OWNER_B}.scores`,
    `users.${OWNER_B}.applications`, `users.${OWNER_B}.interviews`]) {
    assert.ok(!mutation.named.includes(dataset), `${dataset} wrongly named: ${mutation.named}`);
  }
});
