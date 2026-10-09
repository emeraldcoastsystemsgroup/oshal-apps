/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career worker rail: prove the COMPILED evening chain advances the per-user keyword-pass cursor only when the scoring run succeeded. A run that lost the Career worker exits nonzero (engine contract) and surfaces as ok:false (runner); this guard closes the chain by proving that result leaves the cursor where it was, so the pass is retried instead of being marked done.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The signed rail (1.25.1): the cron hands the keyword score and the title pass the issuer the owner's automation opt-in recorded, so the runner can mint a grant the kernel admits; an opt-in with no recorded issuer skips both model passes (no score call, cursor untouched) while the draft enqueue still runs.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
let scoreResult = { ok: true };
const cursorMarks = [];
const scoreCalls = [];
const titleCalls = [];
const enqueueCalls = [];
const ISSUER = 'https://issuer.oshal.example.com';
let automation = { autoGenerate: true, autoSubmit: false, ownerIssuer: ISSUER };

Module._load = function loadCronStubs(request, ...rest) {
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === './career-hunter-routes') return { enqueueForUser: async (_ctx, userSub) => { enqueueCalls.push(userSub); return 0; } };
  if (request === './career-user-store') {
    return { listStoreUsers: () => ['cron-user'], userPaths: () => ({ corpusDb: '/home/user/career/default/corpus.db' }) };
  }
  if (request === './career-engine-dispatch') {
    return {
      runSharedPull: async () => ({ ok: false }),
      runUserMatch: async () => ({ ok: true }),
      runUserScore: async (_pool, userSub, opts) => { scoreCalls.push({ userSub, opts }); return scoreResult; },
    };
  }
  if (request === './career-digest') return { sendDigestsForAllUsers: async () => undefined };
  if (request === './career-title-score') {
    return {
      dueForCronScore: async () => true,
      markCronScore: async (_pool, userSub) => { cursorMarks.push(userSub); },
      runTitlePassForUser: async (_ctx, userSub, opts) => { titleCalls.push({ userSub, opts }); return { ran: false, reason: 'engine-failed' }; },
    };
  }
  if (request === './career-automation') return { readAutomationSettingsSystem: async () => automation };
  if (request === './career-graph-routes') return { ingestJobsGraphForUser: async () => undefined };
  return originalLoad.call(this, request, ...rest);
};

const cron = require('../routes/career-hunter-cron.js');

after(() => { Module._load = originalLoad; });

test('a scoring run that failed (for example on a lost Career worker) does not advance the cursor', async () => {
  scoreResult = { ok: false };
  assert.equal(await cron.runEveningScrapeIndex({ pool: {} }, ['cron-user']), true);
  assert.equal(scoreCalls.length, 1, 'the keyword pass ran');
  assert.deepEqual(cursorMarks, [], 'a failed pass leaves the cursor for the next opportunity');
});

test('a successful scoring run advances the cursor exactly once', async () => {
  scoreResult = { ok: true };
  scoreCalls.length = 0;
  assert.equal(await cron.runEveningScrapeIndex({ pool: {} }, ['cron-user']), true);
  assert.equal(scoreCalls.length, 1);
  assert.deepEqual(cursorMarks, ['cron-user']);
});

test('the model passes carry the issuer the automation opt-in recorded', async () => {
  scoreResult = { ok: true };
  scoreCalls.length = 0; titleCalls.length = 0;
  assert.equal(await cron.runEveningScrapeIndex({ pool: {} }, ['cron-user']), true);
  assert.equal(scoreCalls[0].opts.ownerIssuer, ISSUER, 'the keyword score is minted a grant for the recorded owner');
  assert.equal(titleCalls[0].opts.ownerIssuer, ISSUER, 'so is the title pass');
});

test('an opt-in that recorded no owner issuer skips both model passes and leaves the cursor alone', async () => {
  automation = { autoGenerate: true, autoSubmit: false, ownerIssuer: null };
  scoreCalls.length = 0; titleCalls.length = 0; enqueueCalls.length = 0; cursorMarks.length = 0;
  try {
    assert.equal(await cron.runEveningScrapeIndex({ pool: {} }, ['cron-user']), true);
    assert.deepEqual([scoreCalls.length, titleCalls.length, cursorMarks], [0, 0, []],
      'nothing the kernel could never admit is launched, and the cursor is not advanced');
    assert.deepEqual(enqueueCalls, ['cron-user'], 'the draft enqueue still runs');
  } finally { automation = { autoGenerate: true, autoSubmit: false, ownerIssuer: ISSUER }; }
});
