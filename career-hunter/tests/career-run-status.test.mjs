/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard accepted refresh and truthful manual-run HTTP status contracts.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
let runResult = { ok: true, out: 'done', err: '' };
let refreshStarts = 0;

Module._load = function loadWithRunRouteStubs(request, ...rest) {
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === '@/shared/middleware/authz') return { getTrustedServiceUserSub: () => null };
  if (request === './career-engine-dispatch') return { runCareerCliAwait: async () => runResult };
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
      runEveningScrapeIndex: async () => { refreshStarts += 1; },
      startCareerHunterCron: () => undefined,
    };
  }
  return originalLoad.call(this, request, ...rest);
};

const runRoutes = require('../routes/career-run-routes.js');

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
