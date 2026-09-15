/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Regression guard for the .ply import lane taking the box down. The PACKAGED, COMPILED router runs over REAL loopback HTTP beside a real /health route, with express + multer resolved from a framework checkout (OSHAL_CORE_DIR); the .ply gate and the conversion engine are the framework's REAL modules (import-limits.ts and ImportReconstructionProvider, loaded through the checkout's tsx), so the limit the 413 names and the worker thread the conversion runs in are both real. The fixtures are generated here — a point cloud either side of the gate — and the multipart body is written to the socket in chunks, so an oversized part is refused WHILE IT STREAMS: the assertion is that the bytes received at refusal are a fraction of the file and no source survives on disk. The scan store is doubled because the database is not the boundary that failed; the event loop and the upload stream are, and both are real here. Before the fix an oversized .ply was accepted (201) and converted on this thread, and /health went unanswered for the whole conversion. Named *.core.test.js so the bare-checkout store CI glob (tests/spaces-*.test.js) does not run it without a framework checkout; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/ply-import-off-loop.core.test.js
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
const { performance } = require('node:perf_hooks');

const CORE = process.env.OSHAL_CORE_DIR || 'C:/Projects/oshal';
assert.ok(
  fs.existsSync(path.join(CORE, 'node_modules', 'express')),
  `OSHAL_CORE_DIR must point at a framework checkout with node_modules (got ${CORE})`,
);
const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
const PKG = path.resolve(__dirname, '..');
const COMPILED_ROUTE = path.join(PKG, 'routes', 'spaces-routes.js');
const SPATIAL_SRC = path.join(CORE, 'src', 'features', 'spatial-mapping', 'services');

/** The gate this suite runs under: small enough to generate fixtures either side of it quickly. */
const GATE_BYTES = 4 * 1024 * 1024;
/** Vertices in the under-gate cloud — a conversion long enough (hundreds of ms) to sample /health against. */
const UNDER_GATE_VERTICES = 150_000;
/** Vertices in the over-gate cloud — comfortably past GATE_BYTES so the refusal lands mid-stream. */
const OVER_GATE_VERTICES = 500_000;

const identityStore = new AsyncLocalStorage();
const requestIdentity = {
  runWithRequestIdentity: (identity, fn) => identityStore.run(identity, fn),
  runWithSystemIdentity: (fn) => identityStore.run({ sub: null, isOperator: true, system: true }, fn),
  getRequestIdentity: () => identityStore.getStore(),
};
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-ply-gate-'));

/** Intercepted before anything framework-side loads, so the real spatial modules log into the void. */
const SHARED_STUBS = { '@/shared/logger': { createChildLogger: () => logger } };

/**
 * @description Route every module request the packaged route (or a framework source file loaded
 * for this suite) makes: framework aliases to the stubs below, bare packages to the framework
 * checkout's node_modules, everything else normally.
 * @returns A function that restores the original loader
 */
function patchModuleLoader(aliasStubs) {
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (SHARED_STUBS[request]) return SHARED_STUBS[request];
    if (aliasStubs[request]) return aliasStubs[request];
    if (request.startsWith('@/') && String(parent?.filename || '').startsWith(PKG + path.sep)) {
      throw new Error(`Unexpected framework import: ${request}`);
    }
    const bare = !request.startsWith('.') && !path.isAbsolute(request)
      && !request.startsWith('node:') && !Module.builtinModules.includes(request);
    if (bare && String(parent?.filename || '').startsWith(PKG + path.sep)) {
      return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return () => { Module._load = originalLoad; };
}

// The framework's TypeScript sources load through the checkout's own tsx CJS hook — the same loader
// the conversion worker boots with — so the limit the 413 names and the engine that converts are the
// shipped modules, not a copy of their behaviour. The worker itself is a fresh thread with no loader
// patch of its own and resolves the framework's `@/` aliases from a tsconfig; tsx looks beside the
// process cwd, which here is this package, so point it at the framework's (a deployed api runs from
// /app and finds its own).
process.env.TSX_TSCONFIG_PATH = path.join(CORE, 'tsconfig.json');
const restoreForFrameworkLoad = patchModuleLoader({});
require(coreRequire.resolve('tsx/cjs'));
const limitsModule = require(path.join(SPATIAL_SRC, 'import-limits.ts'));
const importProvider = require(path.join(SPATIAL_SRC, 'import-reconstruction-provider.ts'));
const importFormat = require(path.join(SPATIAL_SRC, 'import-format.ts'));
restoreForFrameworkLoad();

/**
 * @description Build an ASCII point-cloud PLY with `vertexCount` coloured vertices — generated
 * rather than checked in, because a fixture large enough to cross a megabyte gate has no business
 * in git. The same count always produces the same bytes.
 * @param vertexCount - How many vertices to emit
 * @returns The PLY bytes
 */
function asciiPointCloudPly(vertexCount) {
  const lines = [
    'ply', 'format ascii 1.0', `element vertex ${vertexCount}`,
    'property float x', 'property float y', 'property float z',
    'property uchar red', 'property uchar green', 'property uchar blue',
    'end_header',
  ];
  for (let i = 0; i < vertexCount; i++) {
    lines.push(`${(i % 97) / 10} ${(i % 89) / 10} ${(i % 83) / 10} ${i % 256} ${(i * 7) % 256} ${(i * 13) % 256}`);
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'ascii');
}

/** Every registerAndStart the suite triggered: the identity it ran under and its off-loop conversion. */
const observed = [];

/** Stands in for the owner-scoped scan store (Postgres is not this defect's boundary) but runs the REAL conversion. */
class FakeSpatialMappingService {
  constructor() { this.maxScansPerUser = 100; }

  async canAcceptScan() { return true; }

  async registerAndStart(input) {
    const record = {
      scanId: input.id,
      sub: input.userSub,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      sourceBytes: input.sourceBytes,
      identity: requestIdentity.getRequestIdentity(),
      conversion: null,
      failure: null,
    };
    const ext = path.extname(input.sourceName || '').toLowerCase();
    if (input.sourceKind === 'model' && ext === '.ply') {
      // The REAL kernel engine, started detached exactly as the service starts it (and marking the
      // row failed on a throw), so the response returns while the conversion is still running.
      record.conversion = new importProvider.ImportReconstructionProvider().reconstruct({
        scanId: input.id, userSub: input.userSub, sourceKind: 'model',
        sourcePath: input.sourceRef, sourceName: input.sourceName,
      }).catch((err) => { record.failure = err; return null; });
    }
    observed.push(record);
    return {
      id: input.id, userSub: input.userSub, title: input.title,
      status: 'queued', sourceKind: input.sourceKind, sourceBytes: input.sourceBytes,
    };
  }

  async listScans() { return []; }
}

const ALIAS_STUBS = {
  '@/shared/artifact-exchange': { redeemArtifactViaRelay: async () => { throw new Error('not used in this suite'); } },
  '@/shared/services/database/request-identity': requestIdentity,
  '@/features/spatial-mapping': {
    SpatialMappingService: FakeSpatialMappingService,
    RfOverlayService: class {},
    RfInputError: class extends Error {},
    scanDir: (sub, scanId) => path.join(scratchRoot, sub, scanId),
    IMPORT_EXTENSIONS: ['.ply', '.splat'],
    resolvePlyImportLimits: limitsModule.resolvePlyImportLimits,
    formatByteLimit: limitsModule.formatByteLimit,
    PLY_IMPORT_ENV: limitsModule.PLY_IMPORT_ENV,
    generateCapturePlan: () => ({}),
    droneScanPattern: () => ({ perRing: 8, stepDeg: 45, ringCount: 2 }),
    sanitizeCaptureTelemetry: (x) => x,
    captureTelemetryPath: (sub, scanId) => path.join(scratchRoot, sub, scanId, 'telemetry.json'),
    CAPTURE_TELEMETRY_MAX_BYTES: 1024,
  },
  '@/features/drone': { SimDroneProvider: class {}, validateMission: () => [] },
  '@/app/routes/cli-token-routes': { insertCliToken: async () => { throw new Error('not used in this suite'); } },
};

/** Load the compiled packaged router with the framework seams stubbed. */
function loadRouterFactory() {
  const restore = patchModuleLoader(ALIAS_STUBS);
  try {
    delete require.cache[require.resolve(COMPILED_ROUTE)];
    return require(COMPILED_ROUTE).createSpacesRoutes;
  } finally {
    restore();
  }
}

/** The api's shape around the route: an authenticated caller, the RLS identity store, and /health. */
function startServer(sub) {
  const express = coreRequire('express');
  const app = express();
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.use((req, _res, next) => {
    req.oidc = { user: { sub } };
    requestIdentity.runWithRequestIdentity({ sub, isOperator: false }, next);
  });
  app.use('/api/spaces', loadRouterFactory()({ pool: {}, appPackageDir: PKG }));
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

/** POST one multipart file to `pathname`, writing the body to the socket in chunks like a real client. */
function uploadModel(port, pathname, field, filename, bytes) {
  const boundary = `----oshal${randomUUID().replace(/-/g, '')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n`
    + 'Content-Type: application/octet-stream\r\n\r\n', 'ascii',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'ascii');
  let answered = false;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: pathname,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': head.length + bytes.length + tail.length,
      },
    }, (res) => {
      answered = true;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (err) => {
      // An over-gate part is refused while the client is still sending, so the server may close the
      // connection under the remaining body — that is the refusal working, not a test failure, as
      // long as the response itself arrived. If it did not, report it rather than hanging.
      if (answered && ['ECONNRESET', 'EPIPE'].includes(err.code)) return;
      if (['ECONNRESET', 'EPIPE'].includes(err.code)) { resolve({ status: 0, body: `connection ${err.code} with no response` }); return; }
      reject(err);
    });
    req.write(head);
    const CHUNK = 256 * 1024;
    let offset = 0;
    const pump = () => {
      while (offset < bytes.length) {
        const slice = bytes.subarray(offset, offset + CHUNK);
        offset += slice.length;
        if (!req.write(slice)) { req.once('drain', pump); return; }
      }
      req.end(tail);
    };
    pump();
  });
}

/** One GET, resolved with its status and round-trip time. */
function timedGet(port, pathname) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: performance.now() - started }));
    });
    req.on('error', reject);
  });
}

/**
 * @description Keep one `/health` request in flight for as long as the caller runs, so a stretch of
 * event loop the api owes to something else shows up as that probe's round trip. Started BEFORE the
 * upload on purpose: an on-thread conversion runs inside the request handler, so a probe issued only
 * after the 201 would measure an import that is already over and pass vacuously.
 * @param port - The listening port
 * @returns A handle whose `stop()` resolves with every probe's status and the worst round trip
 */
function startHealthProbe(port) {
  const statuses = [];
  let worstMs = 0;
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const probe = await timedGet(port, '/health');
      statuses.push(probe.status);
      worstMs = Math.max(worstMs, probe.ms);
      await new Promise((r) => setTimeout(r, 5));
    }
    return { statuses, worstMs };
  })();
  return { stop: () => { stopped = true; return loop; } };
}

/**
 * @description Every file left under one caller's scan tree, once the refusal's cleanup has
 * settled. The route removes a rejected scan dir without waiting for it, so the assertion polls
 * briefly rather than racing that unlink.
 * @param sub - The caller whose tree to read
 * @returns The remaining file names (empty when the refusal left nothing behind)
 */
async function settledScanFiles(sub) {
  const root = path.join(scratchRoot, sub);
  const listing = () => {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => fs.readdirSync(path.join(root, entry.name)));
  };
  const deadline = Date.now() + 5000;
  let files = listing();
  while (files.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    files = listing();
  }
  return files;
}

test.after(() => { fs.rmSync(scratchRoot, { recursive: true, force: true }); });

test('POST /scans/import refuses an over-gate .ply with a 413 naming the limit, while it streams', async () => {
  const restoreEnv = process.env[limitsModule.PLY_IMPORT_ENV.maxBytes];
  process.env[limitsModule.PLY_IMPORT_ENV.maxBytes] = String(GATE_BYTES);
  const { server, port } = await startServer('oidc-gate-over');
  try {
    const ply = asciiPointCloudPly(OVER_GATE_VERTICES);
    assert.ok(ply.length > GATE_BYTES * 2, `fixture must be well over the gate (${ply.length} vs ${GATE_BYTES})`);
    const before = observed.length;

    const res = await uploadModel(port, '/api/spaces/scans/import', 'model', 'room.ply', ply);

    assert.equal(res.status, 413);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'model_too_large');
    assert.equal(body.maxBytes, GATE_BYTES);
    assert.equal(body.maxLabel, limitsModule.formatByteLimit(GATE_BYTES));
    assert.match(body.message, /at most 4 MB/);
    // Refused WHILE STREAMING: the server stopped at the first chunk past the gate rather than
    // reading the part and checking afterwards.
    assert.ok(
      body.receivedBytes > GATE_BYTES && body.receivedBytes < ply.length,
      `expected a mid-stream refusal, received ${body.receivedBytes} of ${ply.length}`,
    );
    assert.equal(observed.length, before, 'an over-gate .ply must never reach the scan store');
    assert.deepEqual(await settledScanFiles('oidc-gate-over'), [], 'the partial upload must not survive on disk');
  } finally {
    server.close();
    if (restoreEnv === undefined) delete process.env[limitsModule.PLY_IMPORT_ENV.maxBytes];
    else process.env[limitsModule.PLY_IMPORT_ENV.maxBytes] = restoreEnv;
  }
});

test('an under-gate .ply is accepted and converted off the event loop — /health answers throughout', async () => {
  const restoreEnv = process.env[limitsModule.PLY_IMPORT_ENV.maxBytes];
  process.env[limitsModule.PLY_IMPORT_ENV.maxBytes] = String(GATE_BYTES);
  const { server, port } = await startServer('oidc-gate-under');
  try {
    const ply = asciiPointCloudPly(UNDER_GATE_VERTICES);
    assert.ok(ply.length < GATE_BYTES, `fixture must sit under the gate (${ply.length} vs ${GATE_BYTES})`);

    // The control: what the same conversion costs ON this thread. That is exactly how long /health
    // went unanswered before the fix, and the health assertion below is relative to it.
    const started = performance.now();
    const control = importFormat.convertToSplat(ply, '.ply');
    const onThreadMs = performance.now() - started;
    assert.equal(control.count, UNDER_GATE_VERTICES);
    assert.ok(onThreadMs > 100, `the control conversion must be long enough to measure (${onThreadMs.toFixed(0)} ms)`);

    const before = observed.length;
    const probe = startHealthProbe(port);
    const res = await uploadModel(port, '/api/spaces/scans/import', 'model', 'room.ply', ply);
    assert.equal(res.status, 201);
    assert.equal(observed.length, before + 1);

    const record = observed[observed.length - 1];
    assert.equal(record.identity && record.identity.sub, 'oidc-gate-under', 'the post-multer identity must survive');
    assert.ok(record.conversion, 'the import must start an off-loop conversion');
    const converted = await record.conversion;
    const health = await probe.stop();

    assert.equal(record.failure, null);
    assert.ok(converted && converted.splat.equals(control.buffer), 'the off-loop conversion must produce the same bytes');
    assert.equal(converted.gaussianCount, UNDER_GATE_VERTICES);
    assert.ok(health.statuses.length > 0 && health.statuses.every((s) => s === 200), `/health answered ${health.statuses.join(',')}`);
    assert.ok(
      health.worstMs < Math.max(100, onThreadMs / 3),
      `/health worst round trip ${health.worstMs.toFixed(0)} ms against a ${onThreadMs.toFixed(0)} ms on-thread conversion`,
    );
  } finally {
    server.close();
    if (restoreEnv === undefined) delete process.env[limitsModule.PLY_IMPORT_ENV.maxBytes];
    else process.env[limitsModule.PLY_IMPORT_ENV.maxBytes] = restoreEnv;
  }
});

test('a .splat over the .ply gate still imports — the passthrough lane is not gated', async () => {
  const restoreEnv = process.env[limitsModule.PLY_IMPORT_ENV.maxBytes];
  process.env[limitsModule.PLY_IMPORT_ENV.maxBytes] = String(GATE_BYTES);
  const { server, port } = await startServer('oidc-gate-splat');
  try {
    const splat = Buffer.alloc(GATE_BYTES * 2, 7);
    const before = observed.length;
    const res = await uploadModel(port, '/api/spaces/scans/import', 'model', 'room.splat', splat);
    assert.equal(res.status, 201);
    assert.equal(observed.length, before + 1);
    const record = observed[observed.length - 1];
    assert.equal(record.sourceBytes, splat.length, 'the whole .splat must reach disk');
    assert.equal(record.conversion, null, 'a .splat is not converted off-loop');
    assert.equal(record.identity && record.identity.sub, 'oidc-gate-splat');
  } finally {
    server.close();
    if (restoreEnv === undefined) delete process.env[limitsModule.PLY_IMPORT_ENV.maxBytes];
    else process.env[limitsModule.PLY_IMPORT_ENV.maxBytes] = restoreEnv;
  }
});
