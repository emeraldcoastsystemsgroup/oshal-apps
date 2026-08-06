/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise preclaim rejection, exact rollback, engine error statuses, and accepted background hand-off semantics.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove upload admission runs before multipart buffering and the artifact storage enforces a combined request ceiling.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Supply the dependency-leaf tenant contract used by the shared runner fixture.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Guard the resume parser's file, field, part, and header ceilings against authenticated multipart fan-out.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Prove a transient artifact cleanup failure is retried before the request releases its store lease.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Keep the resume multipart part ceiling aligned with one accepted file plus Busboy's closing boundary.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Guard the per-user artifact count quota and bound listing metadata work to fifty candidates.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Prove artifact listing never materializes an unbounded enrichment audit with readFile.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Prove multipart admission uses a duplicate-body lane independent of scarce engine capacity.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Prove a slow artifact request reaches a finite deadline and releases its upload reservation.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Pin runner leases to the disposable fixture so failed tests cannot strand locks in a checkout-local default store.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | Prove the independent global upload ceiling rejects resume and artifact bodies with exact 429 semantics before parsing.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import {
  existsSync, mkdirSync, mkdtempSync, promises as fsPromises,
  readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-route-transaction-'));
const originalLoad = Module._load;
const savedMaxRuns = process.env.CAREER_HUNTER_MAX_RUNS;
const savedMaxUploadBodies = process.env.CAREER_HUNTER_MAX_UPLOAD_BODIES;
const savedStoreRoot = process.env.JOBHUNTER_STORE_ROOT;
let dispatchBehavior = async () => ({ started: false, err: 'fixture dispatch unset' });
let awaitDispatchBehavior = async () => ({ ok: false, out: '', err: 'fixture dispatch unset' });
const signalPaths = new Map();
let artifactStorage;
let multerArrayCalls = 0;
let multerSingleCalls = 0;
let resumeMulterLimits;

process.env.CAREER_HUNTER_MAX_RUNS = '3';
process.env.CAREER_HUNTER_MAX_UPLOAD_BODIES = '2';
process.env.JOBHUNTER_STORE_ROOT = fixtureRoot;

function multerStub(options = {}) {
  if (options.storage && typeof options.storage._handleFile === 'function') artifactStorage = options.storage;
  else if (options.storage) resumeMulterLimits = options.limits;
  return {
    single: () => (_req, _res, next) => { multerSingleCalls += 1; next(); },
    array: () => (_req, _res, next) => { multerArrayCalls += 1; next(); },
  };
}
multerStub.memoryStorage = () => ({});

/** Small user_signals path store implementing only the two statements Resume Studio uses. */
function openFixtureUserDb(userSub) {
  return {
    prepare(sql) {
      if (sql.startsWith('SELECT resume_path')) {
        return { get: (postingId) => {
          const value = signalPaths.get(`${userSub}:${postingId}`);
          return value ? { resume_path: value.resumePath, cover_path: value.coverPath } : undefined;
        } };
      }
      if (sql.startsWith('UPDATE user_signals SET resume_path')) {
        return { run: (resumePath, coverPath, postingId) => {
          signalPaths.set(`${userSub}:${postingId}`, { resumePath, coverPath });
        } };
      }
      throw new Error(`unexpected fixture SQL: ${sql}`);
    },
    close() {},
  };
}

Module._load = function loadWithRouteStubs(request, ...rest) {
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === './career-hunter-routes' || request === './career-user-store') {
    return {
      callerSub: (req) => req.userSub,
      careerTenant: () => 'career-hunter',
      userPaths: (userSub) => ({ userDir: join(fixtureRoot, userSub) }),
      openUserDb: (userSub) => openFixtureUserDb(userSub),
    };
  }
  if (request === './career-engine-dispatch') {
    return {
      runCareerCliAsync: (...args) => dispatchBehavior(...args),
      runCareerCliAwait: (...args) => awaitDispatchBehavior(...args),
    };
  }
  if (request === '@/features/agent-management') {
    return { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => undefined };
  }
  if (request === '@/app/routes/inline-bot-execution') {
    return { executeBotOrInline: async () => ({ response: '{}' }) };
  }
  if (request === 'multer') return multerStub;
  return originalLoad.call(this, request, ...rest);
};

const runner = require('../routes/career-engine-runner.js');
const resumeRoutes = require('../routes/career-resume-upload.js');
const artifactRoutes = require('../routes/career-artifacts.js');
const resumeStudioRoutes = require('../routes/career-resume-studio-routes.js');

after(() => {
  Module._load = originalLoad;
  if (savedMaxRuns === undefined) delete process.env.CAREER_HUNTER_MAX_RUNS;
  else process.env.CAREER_HUNTER_MAX_RUNS = savedMaxRuns;
  if (savedMaxUploadBodies === undefined) delete process.env.CAREER_HUNTER_MAX_UPLOAD_BODIES;
  else process.env.CAREER_HUNTER_MAX_UPLOAD_BODIES = savedMaxUploadBodies;
  if (savedStoreRoot === undefined) delete process.env.JOBHUNTER_STORE_ROOT;
  else process.env.JOBHUNTER_STORE_ROOT = savedStoreRoot;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Capture the final route callback while treating middleware as already completed. */
function capturePost(register, routePath) {
  let handler;
  const router = {
    post(path, ...callbacks) { if (path === routePath) handler = callbacks.at(-1); },
    get() {},
  };
  register(router, { pool: { query: async () => ({ rows: [] }) } });
  assert.equal(typeof handler, 'function');
  return handler;
}

/** Capture a route's ordered middleware stack for admission-before-parser assertions. */
function capturePostCallbacks(register, routePath) {
  let callbacks;
  const router = {
    post(path, ...registered) { if (path === routePath) callbacks = registered; },
    get() {},
  };
  register(router, { pool: { query: async () => ({ rows: [] }) } });
  assert.ok(Array.isArray(callbacks));
  return callbacks;
}

/** Capture one registered GET handler for bounded listing assertions. */
function captureGet(register, routePath) {
  let handler;
  const router = {
    post() {},
    get(path, callback) { if (path === routePath) handler = callback; },
  };
  register(router, { pool: { query: async () => ({ rows: [] }) } });
  assert.equal(typeof handler, 'function');
  return handler;
}

/** Minimal Express response recorder for status-contract assertions. */
function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
  };
}

const resumeHandler = capturePost(resumeRoutes.registerCareerResumeUpload, '/resume/upload');
const resumeCallbacks = capturePostCallbacks(resumeRoutes.registerCareerResumeUpload, '/resume/upload');
const artifactHandler = capturePost(artifactRoutes.registerCareerArtifacts, '/artifacts/upload');
const artifactCallbacks = capturePostCallbacks(artifactRoutes.registerCareerArtifacts, '/artifacts/upload');
const artifactListHandler = captureGet(artifactRoutes.registerCareerArtifacts, '/artifacts');
const resumeSaveHandler = capturePost(resumeStudioRoutes.registerCareerResumeStudio, '/resume/save');

test('resume admission rejects a duplicate upload body before multipart buffering starts', () => {
  assert.deepEqual(resumeMulterLimits, {
    fileSize: 8 * 1024 * 1024, files: 1, fields: 0, parts: 2,
    fieldNameSize: 64, fieldSize: 4 * 1024, headerPairs: 32,
  });
  assert.equal(resumeCallbacks.length, 3);
  const userSub = 'resume-parser-busy';
  const blocker = runner.tryAcquireUploadRun(userSub);
  const request = Object.assign(new EventEmitter(), { userSub });
  const response = responseRecorder();
  const parserCallsBefore = multerSingleCalls;
  let admitted = false;
  resumeCallbacks[0](request, response, () => { admitted = true; });
  assert.equal(admitted, false);
  assert.equal(response.statusCode, 409);
  assert.equal(multerSingleCalls, parserCallsBefore);
  runner.releaseRun(blocker);
});

test('artifact admission rejects a duplicate upload body before multipart buffering starts', () => {
  assert.equal(artifactCallbacks.length, 3);
  const userSub = 'artifact-parser-busy';
  const blocker = runner.tryAcquireUploadRun(userSub);
  const request = Object.assign(new EventEmitter(), { userSub });
  const response = responseRecorder();
  const parserCallsBefore = multerArrayCalls;
  let admitted = false;
  artifactCallbacks[0](request, response, () => { admitted = true; });
  assert.equal(admitted, false);
  assert.equal(response.statusCode, 409);
  assert.equal(multerArrayCalls, parserCallsBefore);
  runner.releaseRun(blocker);
});

test('global upload saturation rejects both multipart routes before buffering with exact 429', () => {
  const first = runner.tryAcquireUploadRun('global-upload-owner-a');
  const second = runner.tryAcquireUploadRun('global-upload-owner-b');
  assert.equal(first.status, 'ok');
  assert.equal(second.status, 'ok');
  const expected = {
    ok: false,
    error: 'busy - too many career uploads in progress',
    err: 'busy - too many career uploads in progress',
  };
  try {
    const resumeRequest = Object.assign(new EventEmitter(), { userSub: 'global-upload-resume' });
    const resumeResponse = responseRecorder();
    const resumeParsers = multerSingleCalls;
    resumeCallbacks[0](resumeRequest, resumeResponse, () => assert.fail('busy resume was admitted'));
    assert.equal(resumeResponse.statusCode, 429);
    assert.deepEqual(resumeResponse.body, expected);
    assert.equal(multerSingleCalls, resumeParsers);

    const artifactRequest = Object.assign(new EventEmitter(), { userSub: 'global-upload-artifact' });
    const artifactResponse = responseRecorder();
    const artifactParsers = multerArrayCalls;
    artifactCallbacks[0](artifactRequest, artifactResponse, () => assert.fail('busy artifact was admitted'));
    assert.equal(artifactResponse.statusCode, 429);
    assert.deepEqual(artifactResponse.body, expected);
    assert.equal(multerArrayCalls, artifactParsers);
  } finally {
    runner.releaseRun(first);
    runner.releaseRun(second);
  }
});

test('artifact body admission does not consume or contend with engine capacity', () => {
  const userSub = 'artifact-upload-lane';
  const engine = runner.tryAcquireRun(userSub, 'user-store');
  assert.equal(engine.status, 'ok');
  const request = Object.assign(new EventEmitter(), { userSub, destroy() {} });
  const response = responseRecorder();
  let admitted = false;
  artifactCallbacks[0](request, response, () => { admitted = true; });
  assert.equal(admitted, true);
  request.emit('aborted');
  runner.releaseRun(engine);
});

test('slow artifact upload reaches a deadline and releases its body lane', async () => {
  const savedTimeout = process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS;
  process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS = '1';
  try {
    const userSub = 'artifact-upload-timeout';
    let destroyed = false;
    const request = Object.assign(new EventEmitter(), {
      userSub,
      destroy() { destroyed = true; },
    });
    const response = responseRecorder();
    artifactCallbacks[0](request, response, () => {});
    await new Promise((resolve) => setTimeout(resolve, 1_150));
    assert.equal(response.statusCode, 408);
    assert.equal(destroyed, true);
    const next = runner.tryAcquireUploadRun(userSub);
    assert.equal(next.status, 'ok');
    runner.releaseRun(next);
  } finally {
    if (savedTimeout === undefined) delete process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS;
    else process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS = savedTimeout;
  }
});

/** Feed one synthetic multipart file through the production bounded-memory storage. */
function bufferArtifact(req, chunks) {
  return new Promise((resolve) => {
    const stream = new PassThrough();
    artifactStorage._handleFile(req, {
      stream, fieldname: 'files', originalname: 'fixture.bin', encoding: '7bit', mimetype: 'application/octet-stream',
    }, (error, info) => resolve({ error, info }));
    for (const chunk of chunks) stream.write(chunk);
    stream.end();
  });
}

test('artifact buffering rejects the combined request above forty MiB', async () => {
  assert.equal(typeof artifactStorage?._handleFile, 'function');
  const request = {};
  const first = await bufferArtifact(request, [Buffer.alloc(25 * 1024 * 1024)]);
  assert.equal(first.error, undefined);
  const second = await bufferArtifact(request, Array.from({ length: 16 }, () => Buffer.alloc(1024 * 1024)));
  assert.equal(second.error?.code, 'LIMIT_TOTAL_FILE_SIZE');
});

test('resume upload rejects an inflight writer before changing either durable file', async () => {
  const userSub = 'resume-busy';
  const blocker = runner.tryAcquireRun(userSub, 'user-store');
  let dispatched = false;
  dispatchBehavior = async () => { dispatched = true; return { started: true }; };
  const response = responseRecorder();
  await resumeHandler({ userSub, file: { originalname: 'resume.pdf', buffer: Buffer.from('new') } }, response);
  assert.equal(response.statusCode, 409);
  assert.equal(dispatched, false);
  assert.equal(existsSync(join(fixtureRoot, userSub, 'uploads', 'resume.pdf')), false);
  assert.equal(existsSync(join(fixtureRoot, userSub, '.indexing')), false);
  runner.releaseRun(blocker);
});

test('resume upload maps the process-wide run ceiling to HTTP 429 before writing', async () => {
  const blockers = [0, 1, 2].map((index) => runner.tryAcquireRun(`ceiling-${index}`, 'user-store'));
  assert.ok(blockers.every((lease) => lease.status === 'ok'));
  const userSub = 'resume-ceiling';
  const response = responseRecorder();
  await resumeHandler({ userSub, file: { originalname: 'resume.pdf', buffer: Buffer.from('new') } }, response);
  assert.equal(response.statusCode, 429);
  assert.equal(existsSync(join(fixtureRoot, userSub, 'uploads', 'resume.pdf')), false);
  blockers.forEach((lease) => runner.releaseRun(lease));
});

test('resume upload restores prior bytes and marker on broker or spawn rejection', async () => {
  const userSub = 'resume-rollback';
  const userDir = join(fixtureRoot, userSub);
  const uploadDir = join(userDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const resumePath = join(uploadDir, 'resume.pdf');
  const markerPath = join(userDir, '.indexing');
  writeFileSync(resumePath, 'old-resume');
  writeFileSync(markerPath, 'old-marker');
  dispatchBehavior = async () => ({ started: false, err: 'credential broker unavailable' });
  const response = responseRecorder();
  await resumeHandler({ userSub, file: { originalname: 'resume.pdf', buffer: Buffer.from('new-resume') } }, response);
  assert.equal(response.statusCode, 500);
  assert.equal(readFileSync(resumePath, 'utf8'), 'old-resume');
  assert.equal(readFileSync(markerPath, 'utf8'), 'old-marker');
  const next = runner.tryAcquireRun(userSub, 'user-store');
  assert.equal(next.status, 'ok', 'rollback returned the lease');
  runner.releaseRun(next);
});

test('accepted resume upload returns 202 and transfers lease ownership', async () => {
  const userSub = 'resume-accepted';
  dispatchBehavior = async (_pool, _sub, _args, _env, options) => {
    runner.releaseRun(options.preclaimed); // simulate the adopted child closing after spawn
    return { started: true };
  };
  const response = responseRecorder();
  await resumeHandler({ userSub, file: { originalname: 'resume.pdf', buffer: Buffer.from('accepted') } }, response);
  assert.equal(response.statusCode, 202);
  assert.equal(readFileSync(join(fixtureRoot, userSub, 'uploads', 'resume.pdf'), 'utf8'), 'accepted');
  assert.equal(existsSync(join(fixtureRoot, userSub, '.indexing')), true);
});

test('artifact start rejection is HTTP 500 and removes only this request files', async () => {
  const userSub = 'artifact-rollback';
  dispatchBehavior = async () => ({ started: false, err: 'fixture spawn rejected' });
  const response = responseRecorder();
  await artifactHandler({
    userSub,
    body: { kind: 'work-sample' },
    files: [{ originalname: 'sample.txt', buffer: Buffer.from('sample') }],
  }, response);
  assert.equal(response.statusCode, 500);
  const artifactDir = join(fixtureRoot, userSub, 'uploads', 'artifacts');
  assert.deepEqual(readdirSync(artifactDir), []);
  const next = runner.tryAcquireRun(userSub, 'user-store');
  assert.equal(next.status, 'ok', 'artifact rollback returned the lease');
  runner.releaseRun(next);
});

test('artifact rollback retries a transient cleanup failure before releasing the lease', async () => {
  const userSub = 'artifact-cleanup-retry';
  dispatchBehavior = async () => ({ started: false, err: 'fixture spawn rejected' });
  const originalRm = fsPromises.rm;
  let removals = 0;
  fsPromises.rm = async (...args) => {
    removals += 1;
    if (removals === 1) throw new Error('transient fixture cleanup failure');
    return originalRm(...args);
  };
  try {
    const response = responseRecorder();
    await artifactHandler({
      userSub, body: { kind: 'other' },
      files: [{ originalname: 'retry.txt', buffer: Buffer.from('retry') }],
    }, response);
    assert.equal(response.statusCode, 500);
    assert.equal(removals, 2);
    assert.deepEqual(readdirSync(join(fixtureRoot, userSub, 'uploads', 'artifacts')), []);
    const next = runner.tryAcquireRun(userSub, 'user-store');
    assert.equal(next.status, 'ok');
    runner.releaseRun(next);
  } finally {
    fsPromises.rm = originalRm;
  }
});

test('accepted artifact batch returns 202 and uses a request-unique filename', async () => {
  const userSub = 'artifact-accepted';
  dispatchBehavior = async (_pool, _sub, _args, _env, options) => {
    runner.releaseRun(options.preclaimed); // simulate the adopted child closing after spawn
    return { started: true };
  };
  const response = responseRecorder();
  await artifactHandler({
    userSub,
    body: { kind: 'other' },
    files: [{ originalname: 'notes.md', buffer: Buffer.from('notes') }],
  }, response);
  assert.equal(response.statusCode, 202);
  const names = readdirSync(join(fixtureRoot, userSub, 'uploads', 'artifacts'));
  assert.equal(names.length, 1);
  assert.match(names[0], /^\d+-[0-9a-f-]{36}-0-notes\.md$/i);
});

test('artifact upload rejects a sequential batch after the per-user file quota is full', async () => {
  const userSub = 'artifact-quota';
  const dir = join(fixtureRoot, userSub, 'uploads', 'artifacts');
  mkdirSync(dir, { recursive: true });
  for (let index = 0; index < 200; index += 1) {
    writeFileSync(join(dir, `${String(index).padStart(13, '0')}-fixture.txt`), 'x');
  }
  let dispatched = false;
  dispatchBehavior = async () => { dispatched = true; return { started: true }; };
  const response = responseRecorder();
  await artifactHandler({
    userSub, body: { kind: 'other' },
    files: [{ originalname: 'overflow.txt', buffer: Buffer.from('overflow') }],
  }, response);
  assert.equal(response.statusCode, 413);
  assert.equal(dispatched, false);
  const next = runner.tryAcquireRun(userSub, 'user-store');
  assert.equal(next.status, 'ok');
  runner.releaseRun(next);
});

test('artifact listing stats only the bounded newest candidate window', async () => {
  const userSub = 'artifact-list-bound';
  const dir = join(fixtureRoot, userSub, 'uploads', 'artifacts');
  mkdirSync(dir, { recursive: true });
  for (let index = 0; index < 80; index += 1) {
    writeFileSync(join(dir, `${String(index).padStart(13, '0')}-fixture.txt`), String(index));
  }
  const originalLstat = fsPromises.lstat;
  let statCalls = 0;
  fsPromises.lstat = async (...args) => { statCalls += 1; return originalLstat(...args); };
  try {
    const response = responseRecorder();
    await artifactListHandler({ userSub }, response);
    assert.equal(response.body.uploaded.length, 50);
    assert.equal(statCalls, 50);
  } finally {
    fsPromises.lstat = originalLstat;
  }
});

test('artifact listing reads enrichment history through a bounded file tail', async () => {
  const userSub = 'artifact-log-tail';
  const userDir = join(fixtureRoot, userSub);
  const artifactDir = join(userDir, 'uploads', 'artifacts');
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(userDir, 'enrichment_log.jsonl'), `${JSON.stringify({
    at: 'now', changelog: ['bounded'], facts: 'x'.repeat(300_000),
  })}\n`);
  const originalReadFile = fsPromises.readFile;
  fsPromises.readFile = async () => { throw new Error('unbounded readFile was used'); };
  try {
    const response = responseRecorder();
    await artifactListHandler({ userSub }, response);
    assert.equal(response.statusCode, 200);
  } finally {
    fsPromises.readFile = originalReadFile;
  }
});

test('Resume Studio restores the document, partial renders, and signal paths on engine failure', async () => {
  const userSub = 'studio-rollback';
  const postingId = 42;
  const packetDir = join(fixtureRoot, userSub, 'applications', `Acme__${postingId}`);
  mkdirSync(packetDir, { recursive: true });
  const applicationPath = join(packetDir, 'application.json');
  const atsPath = join(packetDir, 'Resume_ATS.pdf');
  const newPartialPath = join(packetDir, 'Resume_Premium.pdf');
  const originalApplication = JSON.stringify({
    posting_id: postingId,
    company: 'Acme',
    title: 'Engineer',
    generated: { resume: { headline: 'old' }, cover: { paragraphs: ['old'] } },
  }, null, 2);
  writeFileSync(applicationPath, originalApplication);
  writeFileSync(atsPath, 'old-ats');
  signalPaths.set(`${userSub}:${postingId}`, {
    resumePath: 'C:\\old\\Resume_ATS.pdf', coverPath: 'C:\\old\\CoverLetter.pdf',
  });
  awaitDispatchBehavior = async (_pool, _sub, _args, _env, options) => {
    assert.equal(options.preclaimed.status, 'ok');
    writeFileSync(atsPath, 'partial-new-ats');
    writeFileSync(newPartialPath, 'partial-new-premium');
    return { ok: false, out: '', err: 'fixture renderer failed' };
  };
  const response = responseRecorder();
  await resumeSaveHandler({
    userSub,
    body: { postingId, resume: { headline: 'new' }, cover: { paragraphs: ['new'] } },
  }, response);
  assert.equal(response.statusCode, 500);
  assert.equal(readFileSync(applicationPath, 'utf8'), originalApplication);
  assert.equal(readFileSync(atsPath, 'utf8'), 'old-ats');
  assert.equal(existsSync(newPartialPath), false);
  assert.deepEqual(signalPaths.get(`${userSub}:${postingId}`), {
    resumePath: 'C:\\old\\Resume_ATS.pdf', coverPath: 'C:\\old\\CoverLetter.pdf',
  });
  const next = runner.tryAcquireRun(userSub, 'user-store');
  assert.equal(next.status, 'ok', 'Resume Studio returned its caller-owned lease');
  runner.releaseRun(next);
});
