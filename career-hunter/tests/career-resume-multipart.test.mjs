/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the production Multer middleware and prove one valid resume part survives Busboy's closing-boundary accounting.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove a slow multipart body expires from its upload-only lane without acquiring engine capacity.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Resolve the real framework-owned Multer dependency explicitly for standalone package test runs.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Stub the upload-specific admission response used before the production multipart parser.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Locate a sibling or explicitly supplied kernel checkout from the package path and report the two real-Multer checks as unavailable, not failed, in dependency-free store CI.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const corePackage = resolve(
  process.env.OSHAL_CORE_DIR || resolve(packageRoot, '..', '..', 'oshal'), 'package.json',
);
const realMulter = existsSync(corePackage) ? createRequire(corePackage)('multer') : null;
const originalLoad = Module._load;
let released = 0;
let engineClaims = 0;
let uploadClaims = 0;

Module._load = function loadWithRouteStubs(request, ...rest) {
  if (request === 'multer') return realMulter;
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === './career-user-store') {
    return { callerSub: (req) => req.userSub, userPaths: () => ({ userDir: '' }) };
  }
  if (request === './career-engine-dispatch') return { runCareerCliAsync: async () => ({ started: true }) };
  if (request === './career-engine-response') {
    return { rejectEngineClaim: () => false, rejectEngineStart: () => false, rejectUploadClaim: () => false };
  }
  if (request === './career-engine-runner') {
    return {
      releaseRun() { released += 1; },
      tryAcquireRun: () => { engineClaims += 1; return { status: 'ok', token: Symbol('engine') }; },
      tryAcquireUploadRun: () => { uploadClaims += 1; return { status: 'ok', token: Symbol('upload') }; },
    };
  }
  if (request === './career-file-transaction') {
    return { restoreFilesAsync: async () => {}, snapshotFilesAsync: async () => [], writeFileAtomicAsync: async () => {} };
  }
  return originalLoad.call(this, request, ...rest);
};

const resumeUpload = realMulter ? require('../routes/career-resume-upload.js') : null;

after(() => { Module._load = originalLoad; });

/** Capture one real middleware from the production three-stage upload route. */
function captureMiddleware(index) {
  assert.ok(resumeUpload, 'real framework Multer is unavailable');
  let callbacks;
  const router = {
    post(path, ...registered) { if (path === '/resume/upload') callbacks = registered; },
  };
  resumeUpload.registerCareerResumeUpload(router, { pool: {} });
  assert.equal(callbacks.length, 3);
  return callbacks[index];
}

/** Build a minimal streaming HTTP request containing one correctly terminated resume part. */
function multipartRequest() {
  const boundary = 'career-resume-boundary';
  const body = Buffer.from([
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="resume"; filename="resume.pdf"\r\n',
    'Content-Type: application/pdf\r\n\r\n',
    '%PDF-fixture\r\n',
    `--${boundary}--\r\n`,
  ].join(''));
  const request = Readable.from([body]);
  request.method = 'POST';
  request.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };
  return request;
}

test('production resume parser accepts exactly one file part', {
  skip: realMulter ? false : 'requires an OSHAL kernel checkout with Multer',
}, async () => {
  const parser = captureMiddleware(1);
  const request = multipartRequest();
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await new Promise((resolve, reject) => parser(request, response, (error) => {
    if (error) reject(error); else resolve();
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(request.file.originalname, 'resume.pdf');
  assert.equal(request.file.buffer.toString(), '%PDF-fixture');
});

test('slow upload admission expires without reserving engine capacity', {
  skip: realMulter ? false : 'requires an OSHAL kernel checkout with Multer',
}, async () => {
  const savedTimeout = process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS;
  process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS = '1';
  try {
    released = 0;
    engineClaims = 0;
    uploadClaims = 0;
    const admission = captureMiddleware(0);
    const request = new Readable({ read() {} });
    request.userSub = 'slow-upload-user';
    const response = {
      headersSent: false,
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      set() { return this; },
      json(body) { this.body = body; this.headersSent = true; return this; },
    };
    await new Promise((resolve, reject) => {
      admission(request, response, (error) => { if (error) reject(error); });
      setTimeout(resolve, 1_150);
    });
    assert.equal(response.statusCode, 408);
    assert.equal(uploadClaims, 1);
    assert.equal(engineClaims, 0);
    assert.equal(released, 1);
  } finally {
    if (savedTimeout === undefined) delete process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS;
    else process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS = savedTimeout;
  }
});
