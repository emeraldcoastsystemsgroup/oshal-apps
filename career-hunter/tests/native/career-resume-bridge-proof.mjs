/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Companion to tests/career-resume-native-upload.test.mjs on the kernel's real pieces: the compiled résumé upload route behind the native protocol request constructor (runner.js createSimulatedReq), its router, its multipart parser (multipart_compat) and its response, with the native port marker. Before the fix this request answered "req.once is not a function" (live on blue 2026-11-09); now one résumé is accepted (202), stored and handed to indexing, and a second file in the same body is refused 413.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCompiledModules } from '../helpers/career-route-harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bridge = process.env.OSHAL_TEST_BRIDGE_DIR || resolve(root, '../../oshal-kernel/crates/host-process/bridge');
const available = existsSync(join(bridge, 'runner.js'));
if (process.env.OSHAL_TEST_BRIDGE_DIR && !available) throw new Error('Explicit OSHAL_TEST_BRIDGE_DIR must contain the native runner');
const require = createRequire(import.meta.url);

/** The kernel's own request constructor, cut from runner.js exactly as the LinkedIn bridge proof does. */
function nativeRequestConstructor() {
  const runner = readFileSync(join(bridge, 'runner.js'), 'utf8');
  const start = runner.indexOf('function createSimulatedReq('), end = runner.indexOf('// Runner State & Route Dispatch', start);
  assert.ok(start >= 0 && end > start, 'runner.js still defines createSimulatedReq');
  return vm.runInNewContext(`${runner.slice(start, end)}\ncreateSimulatedReq`, {
    Buffer, URLSearchParams, requestAccepts() { throw new Error('Upload does not negotiate representations'); },
  });
}

test('the kernel\'s own request, parser and response upload one résumé and refuse a second file', {
  skip: !available && 'Native bridge fixture required: set OSHAL_TEST_BRIDGE_DIR to the verified release bridge directory',
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'career-native-resume-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { createExpressShim } = require(join(bridge, 'express_shim'));
  const { createHttpResponse } = require(join(bridge, 'http_response'));
  const { multer } = require(join(bridge, 'multipart_compat'));
  const { createBackgroundRuns } = require(join(bridge, 'background_runs'));
  const nativePort = createBackgroundRuns(() => { throw new Error('No kept run is started by the route itself'); }).port;
  const ingests = [], released = [];
  const { modules } = loadCompiledModules({ upload: 'routes/career-resume-upload.js' }, {
    multer, '@/shared/package-runs': nativePort,
    './career-user-store': { callerSub: (req) => req.oshalCallerSub, userPaths: (sub) => ({ userDir: join(directory, sub) }) },
    './career-engine-dispatch': { runCareerCliAsync: async (_pool, sub, args, env) => { ingests.push({ sub, args, env }); return { started: true }; } },
    './career-engine-runner': {
      tryAcquireUploadRun: (sub) => ({ status: 'ok', sub, kind: 'upload' }), tryAcquireRun: (sub) => ({ status: 'ok', sub, kind: 'user-store' }),
      tryAcquireStorageRun: (sub) => ({ status: 'ok', sub, kind: 'resume-lifecycle' }), releaseRun: (lease) => { released.push(lease); },
    },
  });
  const router = createExpressShim().Router();
  modules.upload.registerCareerResumeUpload(router, { pool: {} });
  const constructor = nativeRequestConstructor();
  async function upload(files) {
    const form = new FormData();
    for (const [name, text] of files) form.append('resume', new Blob([text], { type: 'text/plain' }), name);
    const request = new Request('http://native.fixture/', { method: 'POST', body: form });
    const input = { method: 'POST', headers: Object.fromEntries(request.headers), bodyEncoding: 'base64',
      body: Buffer.from(await request.arrayBuffer()).toString('base64') };
    const req = constructor(input, '/api/career-hunter/resume/upload', '/resume/upload',
      { id: 'sam', subject: 'sam', kind: 'person', issuer: 'fixture', tenant: 'fixture' });
    assert.equal(req.once, undefined, 'the real native constructor has no stream events');
    const { res, response, fail } = createHttpResponse({ error() {} });
    router(req, res, (error) => { if (error) fail(error); else res.status(404).json({ error: 'missing route' }); });
    return response;
  }
  const accepted = await upload([['resume.txt', 'Sam Example\nPlatform engineer (made up)\n']]);
  assert.equal(accepted.status, 202); assert.deepEqual(accepted.body, { started: true });
  assert.equal(await readFile(join(directory, 'sam', 'uploads', 'resume.txt'), 'utf8'), 'Sam Example\nPlatform engineer (made up)\n');
  assert.deepEqual(ingests.map((run) => run.args), [['ingest']]);
  const twoFiles = await upload([['resume.txt', 'one'], ['other.txt', 'two']]);
  assert.equal(twoFiles.status, 413, 'the native parser keeps the one-file limit');
  assert.equal(ingests.length, 1);
  assert.ok(released.filter((lease) => lease.kind === 'upload').length >= 2, 'both upload reservations are returned');
});
