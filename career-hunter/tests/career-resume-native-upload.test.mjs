/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A new person could not upload a résumé on the native kernel: live 2026-11-09 06:00:14 on bare-metal blue, POST /api/career-hunter/resume/upload failed with "req.once is not a function". The kernel hands a package an already-received, bounded body (a Buffer) on a request object without Node's stream events, and admitResumeUpload subscribed to req.once('aborted') and armed a body timer that would call req.destroy(). The compiled route is driven here with a request shaped like the kernel's (runner.js createSimulatedReq's keys, no once, on or destroy) and the native port marker: the résumé is accepted (202) and stored, the engine is asked to index it with the store lease, an oversized buffered body is refused 413 before parsing, and every upload reservation is returned once. tests/native/career-resume-bridge-proof.mjs runs the same route on the kernel's real request constructor and multipart parser.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCompiledModules } from './helpers/career-route-harness.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-resume-native-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const RESUME = Buffer.from('Sam Example\nPlatform engineer (made up)\n');
const claims = [], released = [], ingests = [];

/** The kernel's multer stand-in reads the buffered body; here it selects the one file it would hand the route. */
function nativeMulter() {
  const multer = () => ({ single: (field) => (req, _res, next) => {
    if (!Buffer.isBuffer(req.body)) { next(Object.assign(new Error('INVALID_MULTIPART'), { code: 'INVALID_MULTIPART' })); return; }
    req.file = { fieldname: field, originalname: 'resume.txt', buffer: RESUME };
    next();
  } });
  multer.memoryStorage = () => ({ kind: 'memory' });
  return multer;
}

const lease = (kind) => { const value = { status: 'ok', kind }; claims.push(value); return value; };
const { modules } = loadCompiledModules({ upload: 'routes/career-resume-upload.js' }, {
  '@/shared/package-runs': Object.freeze({ native: true }),
  multer: nativeMulter(),
  './career-user-store': { callerSub: (req) => req.oshalCallerSub || null, userPaths: (sub) => ({ userDir: path.join(root, sub) }) },
  './career-engine-dispatch': { runCareerCliAsync: async (_pool, sub, args, env, options) => {
    ingests.push({ sub, args, env, preclaimed: options && options.preclaimed });
    return { started: true };
  } },
  './career-engine-runner': {
    tryAcquireUploadRun: () => lease('upload'), tryAcquireRun: () => lease('user-store'),
    tryAcquireStorageRun: () => lease('resume-lifecycle'), releaseRun: (value) => { released.push(value); },
  },
});
let handlers;
modules.upload.registerCareerResumeUpload({ post(route, ...callbacks) { if (route === '/resume/upload') handlers = callbacks; } }, { pool: {} });

/** The request runner.js createSimulatedReq builds: plain fields and accessors, the body already received, no stream events. */
function nativeRequest(subject, body) {
  const headers = { 'content-type': 'multipart/form-data; boundary=----oshal-native', 'x-oshal-user-sub': subject };
  const user = { sub: subject, user_sub: subject, oid: subject, name: subject, id: subject, principalId: subject };
  return {
    method: 'POST', protocol: 'http', url: '/resume/upload', originalUrl: '/api/career-hunter/resume/upload', path: '/resume/upload',
    headers, query: {}, body, params: {}, oidc: { isAuthenticated: () => true, user }, user, oshalCallerSub: subject,
    userId: subject, principalId: subject, session: { user, user_sub: subject, principalId: subject },
    get(name) { return headers[String(name).toLowerCase()]; }, header(name) { return this.get(name); }, accepts: () => 'json',
  };
}

/** Run the route's middleware chain the way the kernel's router does, answering with the first response. */
function call(req) {
  return new Promise((resolve, reject) => {
    let index = 0;
    const res = { statusCode: 200, headersSent: false, status(code) { this.statusCode = code; return this; }, set() { return this; },
      json(body) { this.body = body; this.headersSent = true; resolve(this); return this; } };
    const next = (error) => {
      if (error) { reject(error); return; }
      try { Promise.resolve(handlers[index++](req, res, next)).catch(reject); } catch (thrown) { reject(thrown); }
    };
    next();
  });
}

test('a request shaped like the kernel\'s, with a buffered body and no stream events, uploads the résumé', async () => {
  const req = nativeRequest('sam', Buffer.from('------oshal-native bounded multipart body'));
  assert.equal(req.once, undefined); assert.equal(req.on, undefined); assert.equal(req.destroy, undefined);
  const res = await call(req);
  assert.equal(res.statusCode, 202); assert.deepEqual(res.body, { started: true });
  assert.deepEqual(fs.readFileSync(path.join(root, 'sam', 'uploads', 'resume.txt')), RESUME, 'the résumé is stored');
  assert.equal(ingests.length, 1); assert.deepEqual(ingests[0].args, ['ingest']);
  assert.equal(ingests[0].env.CH_RESUME, path.join(root, 'sam', 'uploads', 'resume.txt'));
  assert.equal(ingests[0].preclaimed.kind, 'user-store', 'the store lease goes to the indexing run');
  assert.equal(released.includes(ingests[0].preclaimed), false, 'the indexing run keeps its lease');
  for (const kind of ['upload', 'resume-lifecycle']) {
    const held = claims.find((claim) => claim.kind === kind);
    assert.equal(released.filter((value) => value === held).length, 1, `the ${kind} reservation is returned once`);
  }
});

test('an oversized buffered body is refused before parsing, and its reservation is returned', async () => {
  const before = ingests.length, res = await call(nativeRequest('lee', Buffer.alloc(8 * 1024 * 1024 + 64 * 1024 + 1)));
  assert.equal(res.statusCode, 413); assert.deepEqual(res.body, { error: 'resume exceeds the upload limit' });
  assert.equal(ingests.length, before, 'nothing is indexed');
  assert.equal(fs.existsSync(path.join(root, 'lee')), false, 'nothing is stored');
  const held = claims.filter((claim) => claim.kind === 'upload').at(-1);
  assert.equal(released.filter((value) => value === held).length, 1);
});
