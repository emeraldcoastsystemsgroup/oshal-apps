/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The compiled Vids router reaches its export routes on the native kernel and refuses an attach honestly there. The native bridge's router (oshal-kernel crates/host-process/bridge/express_shim.js) matches a use() path as a literal prefix and a method route segment by segment with :params; the router below implements exactly that contract. Proves: no use() path is parameterised (router.use('/jobs/:jobId/artifact', ...) answered every export request 404 "No matching application route" live); GET /jobs/:id/artifact answers the record with attach.available false in the native sandbox (OSHAL_EGRESS=kernel) and true elsewhere; POST attach in the native sandbox answers 503 export_storage_unavailable with a sentence, never builds the upload parser and writes nothing to the export directory; another owner's job is still 404 job_not_found.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install): framework imports,
 * Express and Multer are doubles; the SQL double answers only the two queries these routes make.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const JOB = '40000000-0000-4000-8000-000000000001';
const OTHER = '40000000-0000-4000-8000-000000000003';

/** The native bridge's routing contract: use() paths are literal prefixes; method routes match :params per segment. */
function nativeRouter() {
  const stack = [];
  const router = (req, res, done) => {
    let index = 0;
    const next = (error) => {
      if (error) { res.status(500).json({ error: String(error.message || error) }); return; }
      const layer = stack[index++];
      if (!layer) { done(); return; }
      const pathname = req.url.split('?')[0];
      if (layer.use) {
        const hit = layer.path === '/' || pathname === layer.path || pathname.startsWith(layer.path + '/');
        return hit ? chain(layer.handlers, req, res, next) : next();
      }
      if (layer.method !== req.method.toLowerCase()) return next();
      const want = layer.path.split('/').filter(Boolean), got = pathname.split('/').filter(Boolean), params = {};
      const hit = want.length === got.length && want.every((part, i) => part.startsWith(':') ? ((params[part.slice(1)] = got[i]), true) : part === got[i]);
      if (!hit) return next();
      req.params = params;
      return chain(layer.handlers, req, res, next);
    };
    next();
  };
  router.registered = stack;
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) router[method] = (p, ...handlers) => { stack.push({ method, path: p, handlers: handlers.flat() }); return router; };
  router.use = (p, ...handlers) => { if (typeof p === 'function') { handlers.unshift(p); p = '/'; } stack.push({ use: true, path: p, handlers: handlers.flat() }); return router; };
  return router;
}

/** Run handlers in order the way Express does, including asynchronous ones. */
function chain(handlers, req, res, done) {
  let i = 0;
  const step = (error) => {
    if (error) return done(error);
    const handler = handlers[i++];
    if (!handler) return done();
    try { Promise.resolve(handler(req, res, step)).catch(step); } catch (failure) { step(failure); }
  };
  step();
}

const parsers = [];
function multerDouble() {
  const multer = (options) => { parsers.push(options); return { single: () => (_req, _res, next) => next() }; };
  multer.diskStorage = (options) => options;
  multer.MulterError = class MulterError extends Error {};
  return multer;
}

function load() {
  const stubs = {
    express: { Router: nativeRouter },
    multer: multerDouble(),
    '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
    '@/app/routes/remote-client-routes': { remoteClientRegistry: { listClients: () => [] } },
    '@/shared/middleware/authz': { getCaller: (req) => ({ sub: req.sub }), getTrustedServiceUserSub: () => null },
    '@/shared/middleware/trusted-service-user-identity': { requireTrustedServiceUserIdentity: (_req, _res, next) => next() },
    '@/shared/services/database/request-identity': { runWithRequestIdentity: (_identity, fn) => fn() },
    '@/shared/middleware/multipart-identity': { preserveRequestIdentity: (handler) => handler },
  };
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
    return original.call(this, request, parent, isMain);
  };
  try { return require(path.join(PKG, 'routes', 'vids-routes.js')); } finally { Module._load = original; }
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vids-native-export-'));
process.env.CLINE_WORKSPACE_ROOT = workspace;
const { createVidsRoutes } = load();
const pool = { async query(text, values) {
  if (/FROM vids_jobs/.test(text)) return { rows: values[0] === JOB && values[1] === 'owner-a' ? [{ status: 'done' }] : [] };
  if (/FROM vids_artifacts/.test(text)) return { rows: [] };
  throw new Error(`Unexpected SQL: ${text}`);
} };
const router = createVidsRoutes({ pool });
test.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

/** One request through the router; resolves with the answer (or a 404 when no route matched). */
function call(method, url, sub = 'owner-a') {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); }, end() { resolve({ status: this.statusCode, body: null }); }, headersSent: false };
    router({ method, url, headers: {}, body: {}, sub }, res, () => resolve({ status: 404, body: { error: 'No matching application route' } }));
  });
}

function withNative(native, fn) {
  const before = process.env.OSHAL_EGRESS;
  if (native) process.env.OSHAL_EGRESS = 'kernel'; else delete process.env.OSHAL_EGRESS;
  return Promise.resolve(fn()).finally(() => { if (before === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = before; });
}

test('no use() path is parameterised: the native bridge would match it literally and never reach the export routes', () => {
  const uses = router.registered.filter((layer) => layer.use).map((layer) => layer.path);
  assert.deepEqual(uses.filter((p) => p.includes(':')), []);
  const exportRoutes = router.registered.filter((layer) => !layer.use && layer.path.startsWith('/jobs/:jobId/artifact')).map((l) => `${l.method} ${l.path}`);
  assert.deepEqual(exportRoutes.sort(), ['delete /jobs/:jobId/artifact', 'get /jobs/:jobId/artifact', 'get /jobs/:jobId/artifact/video.mp4',
    'post /jobs/:jobId/artifact', 'post /jobs/:jobId/artifact/publish', 'post /jobs/:jobId/artifact/unpublish']);
});

test('in the native sandbox the record says exports cannot be kept, and elsewhere it offers the attach', async () => {
  await withNative(true, async () => {
    const answer = await call('GET', `/jobs/${JOB}/artifact`);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.artifact, null);
    assert.equal(answer.body.attach.available, false);
    assert.match(answer.body.attach.detail, /^Video exports cannot be kept on this installation yet/);
  });
  await withNative(false, async () => {
    const answer = await call('GET', `/jobs/${JOB}/artifact`);
    assert.deepEqual(answer.body.attach, { available: true, maxBytes: 128 * 1024 * 1024 });
  });
});

test('a native attach is refused 503 with a sentence before any upload parser exists, and nothing is written', async () => {
  await withNative(true, async () => {
    parsers.length = 0;
    const answer = await call('POST', `/jobs/${JOB}/artifact`);
    assert.equal(answer.status, 503);
    assert.equal(answer.body.error, 'export_storage_unavailable');
    assert.match(answer.body.detail, /Nothing was uploaded or saved\.$/);
    assert.equal(parsers.length, 0, 'the multipart parser is never built');
    assert.deepEqual(fs.readdirSync(workspace), [], 'no export directory or file');
  });
});

test('another owner\'s job stays 404 job_not_found on every export verb', async () => {
  await withNative(true, async () => {
    for (const [method, url] of [['GET', `/jobs/${OTHER}/artifact`], ['POST', `/jobs/${OTHER}/artifact`], ['GET', `/jobs/${JOB}/artifact`]]) {
      const answer = await call(method, url, url.includes(OTHER) ? 'owner-a' : 'owner-b');
      assert.equal(answer.status, 404, `${method} ${url}`);
      assert.equal(answer.body.error, 'job_not_found');
    }
  });
});
