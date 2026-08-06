/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove a re-upload reports its own pending and failed lifecycle even when an older parsed profile remains available.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Recover newer JSON markers across re-upload crash windows instead of exposing a stale succeeded status.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Prove aborted and stale completion observers cannot overwrite the current resume-ingest generation.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-resume-status-'));
const originalLoad = Module._load;
const savedStoreRoot = process.env.JOBHUNTER_STORE_ROOT;
let completionObserver;
let adoptedLease;

process.env.JOBHUNTER_STORE_ROOT = fixtureRoot;

function multerStub() {
  return { single: () => (_req, _res, next) => next() };
}
multerStub.memoryStorage = () => ({});

Module._load = function loadWithStatusStubs(request, ...rest) {
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === './career-user-store') {
    return {
      callerSub: (req) => req.userSub,
      careerTenant: () => 'career-hunter',
      userPaths: (userSub) => ({ userDir: join(fixtureRoot, userSub) }),
      openUserDb: () => null,
    };
  }
  if (request === './career-engine-dispatch') {
    return {
      runCareerCliAsync: async (_pool, _sub, _args, _env, options) => {
        completionObserver = options.onComplete;
        adoptedLease = options.preclaimed;
        return { started: true };
      },
    };
  }
  if (request === 'multer') return multerStub;
  return originalLoad.call(this, request, ...rest);
};

const runner = require('../routes/career-engine-runner.js');
const resumeUpload = require('../routes/career-resume-upload.js');
const onboarding = require('../routes/career-onboarding-routes.js');

after(() => {
  if (adoptedLease) runner.releaseRun(adoptedLease);
  Module._load = originalLoad;
  if (savedStoreRoot === undefined) delete process.env.JOBHUNTER_STORE_ROOT;
  else process.env.JOBHUNTER_STORE_ROOT = savedStoreRoot;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Capture only the terminal handler from one registered route. */
function captureHandler(register, method, routePath, withContext = false) {
  let handler;
  const router = {
    get(path, ...callbacks) { if (method === 'get' && path === routePath) handler = callbacks.at(-1); },
    post(path, ...callbacks) { if (method === 'post' && path === routePath) handler = callbacks.at(-1); },
  };
  if (withContext) register(router, { pool: {} });
  else register(router);
  assert.equal(typeof handler, 'function');
  return handler;
}

/** Minimal Express response recorder for lifecycle assertions. */
function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('re-upload lifecycle supersedes an older parsed profile through child failure', async () => {
  const userSub = 'resume-lifecycle-user';
  const userDir = join(fixtureRoot, userSub);
  mkdirSync(userDir, { recursive: true });
  writeFileSync(join(userDir, 'career_db.json'), JSON.stringify({
    profile: { name: 'Existing Candidate', experience_summary: 'Previously indexed profile' },
    roles: [{ title: 'Engineer' }],
  }));
  const upload = captureHandler(
    resumeUpload.registerCareerResumeUpload, 'post', '/resume/upload', true,
  );
  const status = captureHandler(onboarding.registerCareerOnboardingRoutes, 'get', '/resume/state');

  const accepted = responseRecorder();
  await upload({
    userSub,
    file: { originalname: 'replacement.pdf', buffer: Buffer.from('replacement resume') },
  }, accepted);
  assert.equal(accepted.statusCode, 202);
  assert.equal(typeof completionObserver, 'function');

  const pending = responseRecorder();
  await status({ userSub }, pending);
  assert.equal(pending.body.hasResume, true);
  assert.equal(pending.body.indexing, true);
  assert.equal(pending.body.ingest.state, 'pending');
  assert.match(pending.body.ingest.operationId, /^[0-9a-f-]{36}$/i);

  await completionObserver({ ok: false, code: 1, timedOut: false });
  runner.releaseRun(adoptedLease);
  adoptedLease = undefined;
  const failed = responseRecorder();
  await status({ userSub }, failed);
  assert.equal(failed.body.hasResume, true);
  assert.equal(failed.body.indexing, false);
  assert.equal(failed.body.ingest.state, 'failed');
  assert.equal(failed.body.ingest.error, 'resume ingest failed');
});

test('aborted and stale completion observers preserve the current operation', async () => {
  const userSub = 'resume-stale-observer-user';
  const userDir = join(fixtureRoot, userSub);
  mkdirSync(userDir, { recursive: true });
  const upload = captureHandler(
    resumeUpload.registerCareerResumeUpload, 'post', '/resume/upload', true,
  );
  const accepted = responseRecorder();
  await upload({
    userSub,
    file: { originalname: 'first.pdf', buffer: Buffer.from('first resume') },
  }, accepted);
  assert.equal(accepted.statusCode, 202);
  const statusPath = join(userDir, '.resume-ingest.json');
  const original = JSON.parse(readFileSync(statusPath, 'utf8'));
  const aborted = new AbortController();
  aborted.abort();
  await completionObserver({ ok: true, code: 0, timedOut: false }, aborted.signal);
  assert.deepEqual(JSON.parse(readFileSync(statusPath, 'utf8')), original);

  const newer = { state: 'pending', operationId: 'newer-operation', startedAt: Date.now() + 1 };
  writeFileSync(statusPath, JSON.stringify(newer));
  writeFileSync(join(userDir, '.indexing'), JSON.stringify(newer));
  await completionObserver(
    { ok: false, code: 1, timedOut: false }, new AbortController().signal,
  );
  assert.deepEqual(JSON.parse(readFileSync(statusPath, 'utf8')), newer);
  runner.releaseRun(adoptedLease);
  adoptedLease = undefined;
});

test('a newer pending marker supersedes stale success after an interrupted re-upload', async () => {
  const userSub = 'resume-crash-window-user';
  const userDir = join(fixtureRoot, userSub);
  mkdirSync(userDir, { recursive: true });
  writeFileSync(join(userDir, '.resume-ingest.json'), JSON.stringify({
    state: 'succeeded', operationId: 'old', startedAt: 100, finishedAt: 200,
  }));
  writeFileSync(join(userDir, '.indexing'), JSON.stringify({
    state: 'pending', operationId: 'new', startedAt: Date.now(),
  }));
  const state = await resumeUpload.readResumeIngestState(userSub);
  assert.equal(state.state, 'pending');
  assert.equal(state.operationId, 'new');
});

test('a current JSON marker is recoverable when the status file was lost', async () => {
  const userSub = 'resume-marker-only-user';
  const userDir = join(fixtureRoot, userSub);
  mkdirSync(userDir, { recursive: true });
  writeFileSync(join(userDir, '.indexing'), JSON.stringify({
    state: 'pending', operationId: 'marker-only', startedAt: Date.now(),
  }));
  const state = await resumeUpload.readResumeIngestState(userSub);
  assert.equal(state.state, 'pending');
  assert.equal(state.operationId, 'marker-only');
});
