/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard accepted refresh and truthful manual-run HTTP status contracts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Career worker rail: a manual run that lost the Career worker answers 503 career-worker-unavailable with its run id and failed state, a cancelled run answers 409, the run list is the caller's own, and cancellation is owner-only (another user's run is a 404) against the real engine run registry.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A manual run that failed on the rail's slot-wait ceiling answers 504 career-worker-queue-timeout with its run id and state, and every failure code the COMPILED rail can record on a run (read from routes/career-worker-rail.js) answers with the rail's own status instead of the generic 502.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Guard the refresh status completion field separately from corpus freshness.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { deploymentModeStub } from './helpers/deployment-mode-stub.mjs';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
let runResult = { ok: true, out: 'done', err: '' };
let runObserver = () => undefined;
let refreshStarts = 0;

Module._load = function loadWithRunRouteStubs(request, ...rest) {
  if (request === '@/shared/deployment-mode') return deploymentModeStub();
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === '@/shared/middleware/authz') return { getTrustedServiceUserSub: () => null };
  if (request === './career-engine-dispatch') {
    return { runCareerCliAwait: async (_pool, userSub, args, _extra, options) => { runObserver(userSub, args, options); return runResult; } };
  }
  if (request === './career-engine-response') {
    return { rejectEngineStart: (res, result, label) => {
      if (result.started) return false;
      const status = result.limitReason === 'inflight' ? 409 : 429;
      res.status(status).json({ ok: false, error: `${label} rejected` });
      return true;
    } };
  }
  if (request === './career-company-routes') return { isCareerAdmin: () => true };
  if (request === './career-user-store') {
    return {
      callerSub: (req) => req.userSub,
      listStoreUsers: () => ['run-user'],
      openUserDb: () => null,
    };
  }
  if (request === './career-hunter-cron') {
    return {
      isEveningChainRunning: () => false,
      lastEveningCompletedAt: () => '2026-10-06T08:48:47.612Z',
      runEveningScrapeIndex: async () => { refreshStarts += 1; },
      startCareerHunterCron: () => undefined,
    };
  }
  return originalLoad.call(this, request, ...rest);
};

const runRoutes = require('../routes/career-run-routes.js');
const engineRuns = require('../lib/career-engine-runs.js');

after(() => { Module._load = originalLoad; });

/** Capture registered handlers by method and path. */
function captureHandlers() {
  const handlers = new Map();
  const router = {
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
  };
  runRoutes.registerCareerRunRoutes(router, { pool: {} });
  return handlers;
}

/** Minimal Express response recorder. */
function responseRecorder() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('manual refresh reports accepted detached work with HTTP 202', () => {
  const response = responseRecorder();
  captureHandlers().get('POST /run/refresh')({ userSub: 'run-user' }, response);
  assert.equal(response.statusCode, 202);
  assert.equal(response.body.started, true);
  assert.equal(refreshStarts, 1);
});

test('manual engine failures use 502 and deadline failures use 504', async () => {
  const handler = captureHandlers().get('POST /run/:verb');
  runResult = { ok: false, out: '', err: 'engine rejected', timedOut: false };
  const failed = responseRecorder();
  await handler({ userSub: 'run-user', params: { verb: 'score' } }, failed);
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.body.ok, false);
  runResult = { ok: false, out: '', err: 'career engine timed out', timedOut: true };
  const timedOut = responseRecorder();
  await handler({ userSub: 'run-user', params: { verb: 'score' } }, timedOut);
  assert.equal(timedOut.statusCode, 504);
});

test('successful manual engine work retains HTTP 200', async () => {
  runResult = { ok: true, out: 'finished', err: '', timedOut: false };
  const response = responseRecorder();
  await captureHandlers().get('POST /run/:verb')({ userSub: 'run-user', params: { verb: 'match' } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, out: 'finished' });
});

/** Simulate a real engine run: register it, let the route observe its id, then settle it. */
function simulateRun(settle) {
  runObserver = (userSub, args, options) => {
    const run = engineRuns.registerEngineRun(userSub, args[0]);
    options?.onRunStarted?.(run.runId);
    settle(run);
  };
}

test('a manual run that lost the Career worker answers 503 with its run id and failed state', async () => {
  let runId;
  simulateRun((run) => {
    runId = run.runId;
    engineRuns.markRailFailure(run.runId, 'career-worker-unavailable');
    engineRuns.settleEngineRun(run.runId, { code: 1 });
  });
  runResult = { ok: false, out: '', err: 'career worker unavailable: career-worker-unavailable', timedOut: false };
  const response = responseRecorder();
  await captureHandlers().get('POST /run/:verb')({ userSub: 'run-user', params: { verb: 'score' } }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual([response.body.error, response.body.state, response.body.runId], ['career-worker-unavailable', 'failed', runId]);
  runObserver = () => undefined;
});

/** Run one manual score whose run the rail ended with `reason`, and return the route's answer. */
async function manualRunFailedWith(reason) {
  let runId;
  simulateRun((run) => {
    runId = run.runId;
    engineRuns.markRailFailure(run.runId, reason);
    engineRuns.settleEngineRun(run.runId, { code: 1 });
  });
  runResult = { ok: false, out: '', err: `career worker unavailable: ${reason}`, timedOut: false };
  const response = responseRecorder();
  await captureHandlers().get('POST /run/:verb')({ userSub: 'run-user', params: { verb: 'score' } }, response);
  runObserver = () => undefined;
  return { response, runId };
}

test('a manual run that hit the rail queue ceiling answers 504 career-worker-queue-timeout', async () => {
  const { response, runId } = await manualRunFailedWith('career-worker-queue-timeout');
  assert.equal(response.statusCode, 504);
  assert.deepEqual([response.body.error, response.body.state, response.body.runId], ['career-worker-queue-timeout', 'failed', runId]);
});

/** Every (status, code) pair the compiled rail returns as a call outcome; each one is recorded on the run. */
function railRecordedFailures() {
  const source = readFileSync(new URL('../routes/career-worker-rail.js', import.meta.url), 'utf8');
  const pairs = new Map();
  for (const match of source.matchAll(/return \{ status: (\d+), body: \{ ok: false, error: '([a-z-]+)'/g)) {
    pairs.set(match[2], Number(match[1]));
  }
  return pairs;
}

test('every failure code the rail records answers a manual run with the rail status', async () => {
  const failures = railRecordedFailures();
  assert.ok(failures.size >= 8 && failures.has('career-worker-queue-timeout'), `rail outcomes not found: ${[...failures.keys()]}`);
  for (const [reason, status] of failures) {
    const { response, runId } = await manualRunFailedWith(reason);
    assert.deepEqual(
      [response.statusCode, response.body.error, response.body.runId],
      [status, reason, runId],
      `a run the rail ended with ${reason} answers ${status}`,
    );
  }
});

test('a cancelled manual run answers 409 cancelled', async () => {
  simulateRun((run) => {
    engineRuns.cancelEngineRun('run-user', run.runId);
    engineRuns.settleEngineRun(run.runId, { code: 137 });
  });
  runResult = { ok: false, out: '', err: '', timedOut: false };
  const response = responseRecorder();
  await captureHandlers().get('POST /run/:verb')({ userSub: 'run-user', params: { verb: 'score' } }, response);
  assert.equal(response.statusCode, 409);
  assert.deepEqual([response.body.error, response.body.state], ['cancelled', 'cancelled']);
  runObserver = () => undefined;
});

test('the run list and cancellation are owner-only', () => {
  const handlers = captureHandlers();
  const mine = engineRuns.registerEngineRun('owner-a', 'tailor');
  const theirs = engineRuns.registerEngineRun('owner-b', 'score');
  let terminated = 0;
  engineRuns.attachRunTerminator(mine.runId, () => { terminated += 1; });

  const listed = responseRecorder();
  handlers.get('GET /runs')({ userSub: 'owner-a' }, listed);
  const ids = listed.body.runs.map((run) => run.runId);
  assert.ok(ids.includes(mine.runId));
  assert.ok(!ids.includes(theirs.runId), "another user's run is never listed");

  const cancel = handlers.get('POST /run/:runId/cancel');
  const anonymous = responseRecorder();
  cancel({ params: { runId: mine.runId } }, anonymous);
  assert.equal(anonymous.statusCode, 401);
  const malformed = responseRecorder();
  cancel({ userSub: 'owner-a', params: { runId: 'not-a-run' } }, malformed);
  assert.equal(malformed.statusCode, 400);
  const foreign = responseRecorder();
  cancel({ userSub: 'owner-a', params: { runId: theirs.runId } }, foreign);
  assert.equal(foreign.statusCode, 404, "another user's run is indistinguishable from a missing one");
  assert.equal(engineRuns.engineRunSnapshot(theirs.runId).state, 'running');
  const own = responseRecorder();
  cancel({ userSub: 'owner-a', params: { runId: mine.runId } }, own);
  assert.deepEqual([own.statusCode, own.body.cancelled], [202, true]);
  assert.equal(terminated, 1);
  engineRuns.settleEngineRun(mine.runId, { code: 137 });
  const again = responseRecorder();
  cancel({ userSub: 'owner-a', params: { runId: mine.runId } }, again);
  assert.deepEqual([again.statusCode, again.body.state], [409, 'cancelled']);
  engineRuns.settleEngineRun(theirs.runId, { code: 0 });
});


test('refresh status separates the persisted successful completion from corpus freshness', () => {
  const response = responseRecorder();
  captureHandlers().get('GET /run/refresh')({ userSub: 'run-user' }, response);
  assert.deepEqual(response.body, {
    running: false, corpusFreshAt: null, lastCompletedAt: '2026-10-06T08:48:47.612Z',
  });
});
