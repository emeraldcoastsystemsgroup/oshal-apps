/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Regression guard for the multipart lanes losing the RLS request identity. The PACKAGED, COMPILED router runs over real loopback HTTP with express + multer resolved from the framework checkout (OSHAL_CORE_DIR); the multipart body is written to the socket in several chunks with gaps, exactly like a browser or curl upload of a multi-megabyte .splat, so busboy finishes on a LATER socket chunk than the one the identity middleware ran on. The kernel's SpatialMappingService is a double that records the AsyncLocalStorage identity it was called under — the database itself is not the boundary that failed here; the async-context hand-off between the identity middleware and the post-multer handler is, and both sides of it (a real AsyncLocalStorage, real multer streaming) are real in this suite. Before the fix the recorded identity is undefined (the GUC pool then refuses the insert under OSHAL_DB_GUC_STRICT=deny); after it the caller's sub is present on both the model and the video lane. Named *.core.test.js so the bare-checkout store CI glob (tests/spaces-*.test.js) does not run it without a framework checkout; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/upload-identity.core.test.js
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Redirect a bare require to the framework checkout only when the package itself asks for it. Requires made inside node_modules resolve normally again: redirecting them to core's root broke in the Test Lab sandbox, where the image's pruned node_modules keeps semver only nested under sharp (Cannot find module 'semver'); a developer checkout hoists it, which is why no local run saw it.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const CORE = process.env.OSHAL_CORE_DIR || 'C:/Projects/oshal';
assert.ok(fs.existsSync(path.join(CORE, 'node_modules', 'express')), `OSHAL_CORE_DIR must point at a framework checkout with node_modules (got ${CORE})`);
const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
const PKG = path.resolve(__dirname, '..');
const COMPILED_ROUTE = path.join(PKG, 'routes', 'spaces-routes.js');

/** The same primitive the kernel's request-identity module wraps: one AsyncLocalStorage store. */
const identityStore = new AsyncLocalStorage();
const requestIdentity = {
  runWithRequestIdentity: (identity, fn) => identityStore.run(identity, fn),
  runWithSystemIdentity: (fn) => identityStore.run({ sub: null, isOperator: true, system: true }, fn),
  getRequestIdentity: () => identityStore.getStore(),
};

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-upload-identity-'));

/** Records the identity every registerAndStart ran under — the assertion target. */
const observed = [];
class FakeSpatialMappingService {
  constructor() { this.maxScansPerUser = 100; }
  async canAcceptScan() { return true; }
  async registerAndStart(input) {
    observed.push({ scanId: input.id, sub: input.userSub, sourceKind: input.sourceKind, identity: requestIdentity.getRequestIdentity() });
    return { id: input.id, userSub: input.userSub, title: input.title, status: 'queued', sourceKind: input.sourceKind, sourceBytes: input.sourceBytes };
  }
  async listScans() { return []; }
}
class FakeRfOverlayService {}
class RfInputError extends Error {}

const STUBS = {
  '@/shared/logger': { createChildLogger: () => logger },
  '@/shared/artifact-exchange': { redeemArtifactViaRelay: async () => { throw new Error('not used in this suite'); } },
  '@/shared/services/database/request-identity': requestIdentity,
  '@/features/spatial-mapping': {
    SpatialMappingService: FakeSpatialMappingService,
    RfOverlayService: FakeRfOverlayService,
    RfInputError,
    scanDir: (sub, scanId) => path.join(scratchRoot, sub, scanId),
    IMPORT_EXTENSIONS: ['.ply', '.splat'],
    generateCapturePlan: () => ({}),
    droneScanPattern: () => ({ perRing: 8, stepDeg: 45, ringCount: 2 }),
    sanitizeCaptureTelemetry: (x) => x,
    captureTelemetryPath: (sub, scanId) => path.join(scratchRoot, sub, scanId, 'telemetry.json'),
    CAPTURE_TELEMETRY_MAX_BYTES: 1024,
  },
  '@/features/drone': { SimDroneProvider: class {}, validateMission: () => ({ ok: true }) },
  '@/app/routes/cli-token-routes': { insertCliToken: async () => { throw new Error('not used in this suite'); } },
};

function loadRouter() {
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (STUBS[request]) return STUBS[request];
    if (request.startsWith('@/')) throw new Error(`Unexpected framework import: ${request}`);
    if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request) && String(parent?.filename || '').startsWith(PKG + path.sep)) {
      return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const express = coreRequire('express');
  const { createSpacesRoutes } = require(COMPILED_ROUTE);
  return { express, createSpacesRoutes, restore: () => { Module._load = originalLoad; } };
}

/** The identity middleware exactly as server.ts mounts it: resolve the caller, then run the chain inside the store. */
function startServer(sub) {
  const { express, createSpacesRoutes, restore } = loadRouter();
  const app = express();
  app.use((req, _res, next) => {
    req.oidc = { user: { sub } };
    requestIdentity.runWithRequestIdentity({ sub, isOperator: false }, () => next());
  });
  app.use('/api/spaces', createSpacesRoutes({ pool: {}, appPackageDir: PKG }));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((r) => { server.close(() => { restore(); r(); }); }) }));
  });
}

/** Build one multipart/form-data body carrying a title field and a binary file part. */
function multipartBody(field, filename, bytes) {
  const boundary = `----spaces-${randomUUID()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nchunked upload\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat([head, bytes, tail]) };
}

/** POST the body in several socket writes with gaps so the multipart parser finishes on a later chunk. */
function postChunked(port, urlPath, { boundary, body }, chunkBytes, gapMs) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: urlPath, headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length,
    } }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { raw += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    let offset = 0;
    const writeNext = () => {
      if (offset >= body.length) { req.end(); return; }
      req.write(body.subarray(offset, offset + chunkBytes));
      offset += chunkBytes;
      setTimeout(writeNext, gapMs);
    };
    writeNext();
  });
}

/** 96 000 gaussians of the 32-byte .splat record = 3 MB, well past one socket chunk. */
const SPLAT_BYTES = Buffer.alloc(96_000 * 32, 1);

test('the model import lane keeps the caller identity across a chunked multipart upload', async () => {
  observed.length = 0;
  const srv = await startServer('ident-owner-model');
  try {
    const res = await postChunked(srv.port, '/api/spaces/scans/import', multipartBody('model', 'chunked.splat', SPLAT_BYTES), 256 * 1024, 15);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.scan.status, 'queued');
    assert.equal(observed.length, 1, 'registerAndStart ran exactly once');
    assert.equal(observed[0].sub, 'ident-owner-model');
    assert.equal(observed[0].sourceKind, 'model');
    assert.ok(observed[0].identity, 'registerAndStart ran with NO request identity — the GUC pool refuses this insert under OSHAL_DB_GUC_STRICT=deny');
    assert.equal(observed[0].identity.sub, 'ident-owner-model');
    assert.ok(fs.existsSync(path.join(scratchRoot, 'ident-owner-model', observed[0].scanId, 'source.splat')), 'multer streamed the file into the scan dir');
  } finally {
    await srv.close();
  }
});

test('the video lane keeps the caller identity across a chunked multipart upload', async () => {
  observed.length = 0;
  const srv = await startServer('ident-owner-video');
  try {
    const res = await postChunked(srv.port, '/api/spaces/scans', multipartBody('video', 'walkthrough.mp4', SPLAT_BYTES), 256 * 1024, 15);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(observed.length, 1, 'registerAndStart ran exactly once');
    assert.equal(observed[0].sourceKind, 'video');
    assert.ok(observed[0].identity, 'registerAndStart ran with NO request identity');
    assert.equal(observed[0].identity.sub, 'ident-owner-video');
  } finally {
    await srv.close();
  }
});

test('a rejected upload still answers the multer error shape (no identity needed on that path)', async () => {
  observed.length = 0;
  const srv = await startServer('ident-owner-reject');
  try {
    const res = await postChunked(srv.port, '/api/spaces/scans/import', multipartBody('model', 'not-a-model.txt', Buffer.alloc(64, 2)), 64 * 1024, 0);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'unsupported_import_format');
    assert.equal(observed.length, 0, 'an unsupported extension never reaches registerAndStart');
  } finally {
    await srv.close();
  }
});

test.after(() => { fs.rmSync(scratchRoot, { recursive: true, force: true }); });
