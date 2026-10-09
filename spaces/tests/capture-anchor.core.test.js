/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-169 L7, store half: a new scan gets an anchor from its joined capture GPS. The PACKAGED, COMPILED router runs over real loopback HTTP with express + multer resolved from a framework checkout (OSHAL_CORE_DIR). The capture half is real end to end: the phone's readings are posted to the route's own POST /capture-telemetry, validated by the kernel's sanitizer and appended to the owner-scoped sidecar under a temporary scans root, and the kernel's readCaptureAnchor (loaded from the framework's TypeScript source) reads that sidecar back. The scan store is a double that records what the route registers and joins a scan to the session it named, as the kernel service does; anchorMap is a double that records what the route hands the location kernel skill and the identity it ran under. So this suite proves what the route registers, joins and asks to be anchored, and what it answers and logs; that the kernel stores the anchor and who may read it is proven in core (tests/unit/location-map-anchors-postgres.spec.ts). Both multipart lanes anchor; an upload with no session, a value that is not a session id, a session with no GPS fix, another person's session and a refusal by the kernel each register the scan without an anchor and say why; no answer and no log line carries a coordinate. Named *.core.test.js so the bare-checkout store CI glob does not run it without a framework checkout; run locally: OSHAL_CORE_DIR=<framework checkout> node --test tests/capture-anchor.core.test.js
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
assert.ok(
  fs.existsSync(path.join(CORE, 'node_modules', 'express')),
  `OSHAL_CORE_DIR must point at a framework checkout with node_modules (got ${CORE})`,
);
const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
const PKG = path.resolve(__dirname, '..');
const COMPILED_ROUTE = path.join(PKG, 'routes', 'spaces-routes.js');
const SPATIAL_SRC = path.join(CORE, 'src', 'features', 'spatial-mapping', 'services');

/** A synthetic spot in the open South Atlantic: no address, no person. */
const SPOT = { lat: -12.34567, lon: -31.98765 };
const PLACE = '3f1d2c4b-5a69-4788-9a0b-1c2d3e4f5a6b';
const COORDINATE = /-?12\.34|-?31\.98|"lat"|"lon"|latitude|longitude/;

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-capture-anchor-'));
const savedRoot = process.env.OSHAL_SPACES_ROOT;
process.env.OSHAL_SPACES_ROOT = scratchRoot;

const identityStore = new AsyncLocalStorage();
const requestIdentity = {
  runWithRequestIdentity: (identity, fn) => identityStore.run(identity, fn),
  runWithSystemIdentity: (fn) => identityStore.run({ sub: null, isOperator: true, system: true }, fn),
  getRequestIdentity: () => identityStore.getStore(),
};

/** Every log call the route or the kernel modules made, so a coordinate in a log line is caught. */
const logged = [];
const record = (level) => (...args) => { logged.push({ level, args }); };
const logger = { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') };
const SHARED_STUBS = { '@/shared/logger': { createChildLogger: () => logger } };

/**
 * @description Everything logged, as text, with an error written out the way the api's logger writes
 * one (name, message, stack and code). A plain JSON.stringify drops an Error's message, which would
 * let a logged error carry a coordinate past this suite unseen.
 * @returns The log lines as one string
 */
function loggedText() {
  return JSON.stringify(logged, (_key, value) => (value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack, code: value.code }
    : value));
}

/**
 * @description Route module requests: framework aliases to the stubs, bare packages the package
 * asks for to the framework checkout's node_modules, everything else normally.
 * @param aliasStubs - Framework aliases this load answers itself
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

// The kernel's capture modules load from the framework's TypeScript source through its own tsx hook,
// so the sanitizer, the sidecar path and the reader this suite runs are the shipped ones.
process.env.TSX_TSCONFIG_PATH = path.join(CORE, 'tsconfig.json');
const restoreForFrameworkLoad = patchModuleLoader({});
require(coreRequire.resolve('tsx/cjs'));
const telemetry = require(path.join(SPATIAL_SRC, 'capture-telemetry.ts'));
const scanPaths = require(path.join(SPATIAL_SRC, 'scan-paths.ts'));
const captureAnchor = require(path.join(SPATIAL_SRC, 'capture-anchor.ts'));
const safeError = require(path.join(CORE, 'src', 'shared', 'logger', 'location-safe-error.ts'));
restoreForFrameworkLoad();
SHARED_STUBS['@/shared/logger'].locationSafeError = safeError.locationSafeError;

/** What the route registered, and what it asked the location kernel skill to anchor. */
const registered = [];
const anchored = [];
/** Set by a case to make the next anchorMap call throw. */
let nextAnchorError = null;

/** Stands in for the owner-scoped scan store: records the registration and joins a scan to its session. */
class FakeSpatialMappingService {
  constructor() { this.maxScansPerUser = 100; }

  async canAcceptScan() { return true; }

  async registerAndStart(input) {
    registered.push({ ...input, identity: requestIdentity.getRequestIdentity() });
    return { id: input.id, userSub: input.userSub, title: input.title, status: 'queued', sourceKind: input.sourceKind,
      sourceBytes: input.sourceBytes, tenantId: null, captureSessionId: input.captureSessionId ?? null };
  }

  /** The kernel service's join: the caller's own scan, the session it names, that session's telemetry. */
  async captureAnchorForScan(userSub, id) {
    const scan = registered.find((r) => r.id === id && r.userSub === userSub);
    if (!scan || !scan.captureSessionId) return null;
    return captureAnchor.readCaptureAnchor(scan.userSub, scan.captureSessionId);
  }

  async listScans() { return []; }
}

/** Stands in for the location kernel skill's anchorMap: records the request and the ambient caller. */
async function anchorMap(_pool, input) {
  if (nextAnchorError) {
    const error = nextAnchorError;
    nextAnchorError = null;
    throw error;
  }
  anchored.push({ input, identity: requestIdentity.getRequestIdentity() });
  return { anchorId: `anchor-${anchored.length}`, placeId: input.placeId ?? null };
}

const ALIAS_STUBS = {
  '@/shared/artifact-exchange': { redeemArtifactViaRelay: async () => { throw new Error('not used in this suite'); } },
  '@/shared/services/database/request-identity': requestIdentity,
  '@/features/spatial-mapping': {
    SpatialMappingService: FakeSpatialMappingService,
    RfOverlayService: class {},
    RfInputError: class extends Error {},
    scanDir: scanPaths.scanDir,
    IMPORT_EXTENSIONS: ['.ply', '.splat'],
    resolvePlyImportLimits: () => ({ plyMaxBytes: 50 * 1024 * 1024, workerHeapMb: 1024 }),
    generateCapturePlan: () => ({}),
    droneScanPattern: () => ({ perRing: 8, stepDeg: 45, ringCount: 2 }),
    sanitizeCaptureTelemetry: telemetry.sanitizeCaptureTelemetry,
    captureTelemetryPath: scanPaths.captureTelemetryPath,
    CAPTURE_TELEMETRY_MAX_BYTES: telemetry.CAPTURE_TELEMETRY_MAX_BYTES,
    CAPTURE_SESSION_ID_RE: telemetry.CAPTURE_SESSION_ID_RE,
  },
  '@/features/location': { anchorMap },
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

/** The api's shape around the route: a signed-in caller, the RLS identity store and a JSON body parser. */
function startServer(sub) {
  const express = coreRequire('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.oidc = { user: { sub } };
    requestIdentity.runWithRequestIdentity({ sub, principalIssuer: 'https://login.oshal.example.com', isOperator: false }, next);
  });
  app.use('/api/spaces', loadRouterFactory()({ pool: { marker: 'pool' }, appPackageDir: PKG }));
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    close: () => new Promise((done) => server.close(() => done())),
  })));
}

/** One HTTP request to the loopback server. */
function send(port, method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { ...headers, 'Content-Length': body.length } }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { raw += d; });
      res.on('end', () => resolve({ status: res.statusCode, raw, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Post one phone reading to the route's own telemetry sink. */
function postReading(port, reading) {
  return send(port, 'POST', '/api/spaces/capture-telemetry', { 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify(reading)));
}

/** Post a guided capture's readings: three fixes around the spot, the most accurate one on it. */
async function capture(port, sessionId, withGps = true) {
  const ts = Date.now() - 60_000;
  const gps = (dLat, accuracyM) => (withGps ? { lat: SPOT.lat + dLat, lon: SPOT.lon, accuracyM } : null);
  const readings = [
    { sessionId, step: 0, ts, headingDeg: 40, sweepDeg: 0, steps: 0, gps: gps(0.00004, 18) },
    { sessionId, step: 1, ts: ts + 2000, headingDeg: 95, sweepDeg: 120, steps: 4, gps: gps(0, 6) },
    { sessionId, step: 2, ts: ts + 4000, headingDeg: 190, sweepDeg: 250, steps: 9, gps: gps(-0.00005, 12) },
  ];
  for (const reading of readings) assert.equal((await postReading(port, reading)).status, 204);
  return ts + 2000;
}

/** Upload one file as multipart/form-data with the file first and the text fields after it, as the surface sends them. */
function upload(port, urlPath, field, filename, fields) {
  const boundary = `----oshal${randomUUID().replace(/-/g, '')}`;
  const parts = [Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n`
    + 'Content-Type: application/octet-stream\r\n\r\n', 'ascii',
  ), Buffer.alloc(64, 1)];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`, 'utf8'));
  }
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'ascii'));
  return send(port, 'POST', urlPath, { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, Buffer.concat(parts));
}

/** Start a server for one caller with the recorders cleared. */
async function fresh(sub) {
  registered.length = 0;
  anchored.length = 0;
  logged.length = 0;
  nextAnchorError = null;
  return startServer(sub);
}

test('a walk-through upload that names its capture session is anchored from that session\'s GPS', async () => {
  const srv = await fresh('anchor-owner-video');
  try {
    const session = randomUUID();
    const bestFixAt = await capture(srv.port, session);
    const res = await upload(srv.port, '/api/spaces/scans', 'video', 'walk.mp4', { title: 'Workshop', captureSessionId: session, placeId: PLACE });
    assert.equal(res.status, 201, res.raw);
    assert.deepEqual(res.body.anchor, { anchored: true, anchorId: 'anchor-1', placeId: PLACE });
    assert.equal(registered.length, 1);
    assert.equal(registered[0].captureSessionId, session);
    assert.equal(anchored.length, 1);
    const { input, identity } = anchored[0];
    assert.deepEqual(input, {
      mapKind: 'spatial-scan', mapRef: res.body.scan.id, source: 'capture-gps', capturedAt: new Date(bestFixAt).toISOString(),
      anchor: { lat: SPOT.lat, lon: SPOT.lon, headingDeg: 40, accuracyM: 6 }, footprintRadiusM: 10, placeId: PLACE,
    });
    assert.equal(identity.sub, 'anchor-owner-video', 'anchorMap ran as the caller');
    assert.equal(identity.isOperator, false);
  } finally {
    await srv.close();
  }
});

test('an imported capture is anchored the same way, and neither the answer nor a log line carries a coordinate', async () => {
  const srv = await fresh('anchor-owner-model');
  try {
    const session = randomUUID();
    await capture(srv.port, session);
    const res = await upload(srv.port, '/api/spaces/scans/import', 'model', 'room.splat', { title: 'Room', captureSessionId: session });
    assert.equal(res.status, 201, res.raw);
    assert.deepEqual(res.body.anchor, { anchored: true, anchorId: 'anchor-1', placeId: null });
    assert.equal(registered[0].sourceKind, 'model');
    assert.equal(anchored[0].input.mapRef, res.body.scan.id);
    assert.equal(anchored[0].input.placeId, null);
    assert.doesNotMatch(res.raw, COORDINATE);
    assert.ok(logged.length > 0, 'the route logged the anchor');
    assert.doesNotMatch(loggedText(), COORDINATE);
  } finally {
    await srv.close();
  }
});

test('an upload with no session, or a value that is not a session id, registers the scan without an anchor', async () => {
  const srv = await fresh('anchor-owner-bare');
  try {
    const bare = await upload(srv.port, '/api/spaces/scans', 'video', 'walk.mp4', { title: 'No capture' });
    assert.equal(bare.status, 201, bare.raw);
    assert.deepEqual(bare.body.anchor, { anchored: false, reason: 'no_capture_session' });
    const odd = await upload(srv.port, '/api/spaces/scans/import', 'model', 'room.splat', { captureSessionId: '../capture-sessions/other' });
    assert.equal(odd.status, 201, odd.raw);
    assert.deepEqual(odd.body.anchor, { anchored: false, reason: 'no_capture_session' });
    assert.deepEqual(registered.map((r) => r.captureSessionId), [null, null]);
    assert.equal(anchored.length, 0);
  } finally {
    await srv.close();
  }
});

test('a session with no GPS fix, and another person\'s session, yield no anchor', async () => {
  const owner = await fresh('anchor-owner-indoors');
  const theirs = randomUUID();
  try {
    const session = randomUUID();
    await capture(owner.port, session, false);
    const res = await upload(owner.port, '/api/spaces/scans', 'video', 'walk.mp4', { captureSessionId: session });
    assert.equal(res.status, 201, res.raw);
    assert.deepEqual(res.body.anchor, { anchored: false, reason: 'no_capture_gps' });
    await capture(owner.port, theirs);
  } finally {
    await owner.close();
  }
  const other = await startServer('anchor-someone-else');
  try {
    const res = await upload(other.port, '/api/spaces/scans', 'video', 'walk.mp4', { captureSessionId: theirs });
    assert.equal(res.status, 201, res.raw);
    assert.deepEqual(res.body.anchor, { anchored: false, reason: 'no_capture_gps' });
    assert.equal(anchored.length, 0);
  } finally {
    await other.close();
  }
});

test('a refusal by the kernel registers the scan, names the reason, and logs no coordinate', async () => {
  const srv = await fresh('anchor-owner-refused');
  try {
    const session = randomUUID();
    await capture(srv.port, session);
    nextAnchorError = Object.assign(new Error('This precision class stores no coordinates, so a map cannot be anchored.'),
      { name: 'LocationPrecisionError', code: 'location_precision_stores_no_coordinates' });
    const refused = await upload(srv.port, '/api/spaces/scans', 'video', 'walk.mp4', { captureSessionId: session });
    assert.equal(refused.status, 201, refused.raw);
    assert.deepEqual(refused.body.anchor, { anchored: false, reason: 'location_precision_stores_no_coordinates' });
    nextAnchorError = Object.assign(new Error(`Failing row contains (${SPOT.lat}, ${SPOT.lon}).`), { code: '23514' });
    const failed = await upload(srv.port, '/api/spaces/scans', 'video', 'walk.mp4', { captureSessionId: session });
    assert.equal(failed.status, 201, failed.raw);
    assert.deepEqual(failed.body.anchor, { anchored: false, reason: 'anchor_failed' });
    assert.equal(registered.length, 2, 'both scans were registered');
    assert.equal(logged.filter((l) => l.level === 'error').length, 2, 'each refusal was logged');
    assert.doesNotMatch(loggedText(), COORDINATE);
    assert.doesNotMatch(refused.raw + failed.raw, COORDINATE);
  } finally {
    await srv.close();
  }
});

test.after(() => {
  if (savedRoot === undefined) delete process.env.OSHAL_SPACES_ROOT; else process.env.OSHAL_SPACES_ROOT = savedRoot;
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});
