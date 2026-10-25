/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the compiled CSV route with the real native protocol request constructor, router, multipart parser, response and native-port marker; no IncomingMessage event facade.
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

test('native buffered multipart imports owner leads without IncomingMessage events or engine dispatch', {
  skip: !available && 'Native bridge fixture required: set OSHAL_TEST_BRIDGE_DIR to the verified release bridge directory',
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'career-native-linkedin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { createExpressShim } = require(join(bridge, 'express_shim'));
  const { createHttpResponse } = require(join(bridge, 'http_response'));
  const { multer } = require(join(bridge, 'multipart_compat'));
  const { createBackgroundRuns } = require(join(bridge, 'background_runs'));
  const nativePort = createBackgroundRuns(() => { throw new Error('No background work in a private CSV import'); }).port;
  const runner = readFileSync(join(bridge, 'runner.js'), 'utf8');
  const start = runner.indexOf('function createSimulatedReq('), end = runner.indexOf('// Runner State & Route Dispatch', start);
  assert.ok(start >= 0 && end > start);
  const constructor = vm.runInNewContext(runner.slice(start, end) + '\ncreateSimulatedReq', {
    Buffer, URLSearchParams, requestAccepts() { throw new Error('Import does not negotiate representations'); },
  });
  const claims = [], released = [];
  const { modules } = loadCompiledModules({ artifacts: 'routes/career-artifacts.js' }, {
    multer, '@/shared/package-runs': nativePort,
    './career-user-store': { callerSub: req => req.oshalCallerSub, userPaths: sub => ({ userDir: join(directory, sub) }) },
    './career-engine-dispatch': { runCareerCliAsync() { throw new Error('No engine should start'); } },
    './career-engine-runner': {
      tryAcquireRun() { throw new Error('No engine capacity should be claimed'); },
      tryAcquireUploadRun(sub) { const lease = { status: 'ok', sub, kind: 'upload' }; claims.push(lease); return lease; },
      tryAcquireStorageRun(sub) { const lease = { status: 'ok', sub, kind: 'storage' }; claims.push(lease); return lease; },
      releaseRun(lease) { released.push(lease); },
    },
  });
  const router = createExpressShim().Router(); modules.artifacts.registerCareerArtifacts(router, { pool: {} });
  async function call(subject, csv) {
    const route = csv === undefined ? '/artifacts' : '/artifacts/upload';
    let input = { method: 'GET' };
    if (csv !== undefined) {
      const form = new FormData(); form.set('kind', 'linkedin-jobs'); form.append('files', new Blob([csv]), 'Saved Jobs.csv');
      const request = new Request('http://native.fixture/', { method: 'POST', body: form });
      input = { method: 'POST', headers: Object.fromEntries(request.headers), bodyEncoding: 'base64',
        body: Buffer.from(await request.arrayBuffer()).toString('base64') };
    }
    const req = constructor(input, '/api/career-hunter' + route, route,
      { id: subject, subject, kind: 'person', issuer: 'fixture', tenant: 'fixture' });
    assert.equal(req.once, undefined, 'the real native constructor has no stream events');
    const { res, response, fail } = createHttpResponse({ error() {} });
    router(req, res, error => { if (error) fail(error); else res.status(404).json({ error: 'missing route' }); });
    return response;
  }
  const csv = Buffer.from('Job Title,Company Name,Job URL\nPlatform Engineer,Example,https://www.linkedin.com/jobs/view/123456789/');
  const imported = await call('alice', csv);
  assert.equal(imported.status, 200); assert.equal(imported.body.new, 1); assert.equal(imported.body.total, 1);
  const repeated = await call('alice', csv);
  assert.equal(repeated.status, 200); assert.equal(repeated.body.new, 0); assert.equal(repeated.body.updated, 0);
  assert.equal((await call('alice', Buffer.alloc(2 * 1024 * 1024 + 1, 'x'))).status, 413);
  assert.equal((await call('alice')).body.importedJobs.length, 1);
  assert.deepEqual((await call('bob')).body.importedJobs, []);
  assert.equal(JSON.parse(await readFile(join(directory, 'alice/linkedin-saved-jobs.json'), 'utf8')).jobs.length, 1);
  assert.equal(claims.length, 6); assert.equal(released.length, 6);
  assert.ok(claims.every(lease => released.filter(item => item === lease).length === 1));
});
