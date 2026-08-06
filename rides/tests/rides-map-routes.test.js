/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 21:10:00 | maintainer@emeraldcoastsystemsgroup.com   | Guards for the map's server half, run against the COMPILED route module (the same bytes the framework requires). The bug being pinned: this surface shipped a whole Google Maps integration gated on GOOGLE_MAPS_BROWSER_KEY, that key was set in no file in either repo, and /config therefore answered provider:'fallback' forever — the rider got a CSS drawing and nobody noticed, because nothing asserted what the keyless answer was. So: (1) with NO key configured the provider must be 'osm' and must carry a usable tile URL — a keyless install gets a REAL map, not a placeholder; (2) with a key it upgrades to google-maps and hands the key over; (3) /geocode and /reverse exist, validate their input, and 401 before any CLI work when the caller is anonymous — they proxy a public endpoint on the rider's behalf, so an open one is an abuse relay; (4) /estimate passes the CLI's coords and measured distance through, because the map draws its pins from them.
 *
 * 2026-08-06 03:05:00 | maintainer@emeraldcoastsystemsgroup.com   | Exercise the compiled request-scoped in-process Rides provider bridge instead of the retired CLI subprocess seam.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'rides-routes.js');

/**
 * Load the compiled route module with every framework import stubbed, and record what it
 * registers. `cliResponses` maps a provider subcommand to its bounded JSON result, so the tests
 * exercise the real handler bodies without a network call, a DB, or a bot node.
 */
function loadRoutes(opts = {}) {
  const handlers = { get: new Map(), post: new Map() };
  const mounts = [];
  const cliCalls = [];
  const fakeRouter = {
    get(p, h) { handlers.get.set(p, h); return this; },
    post(p, h) { handlers.post.set(p, h); return this; },
    use(p) { mounts.push(p); return this; },
  };
  const stubs = {
    express: {
      Router: () => fakeRouter,
      static: (dir, options) => { mounts.push({ static: dir, options }); return () => {}; },
    },
    path,
    crypto: { randomUUID: () => 'test-uuid' },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/services/database': {
      buildOwnerRlsPolicyStatements: () => [],
      runRuntimeSchemaBootstrap: async () => {},
    },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => undefined },
    '@/app/routes/connector-token-broker': {
      resolveServerOperationCreds: async () => ({ OSHAL_CRED_UBER_RIDES: 'test-request-credential' }),
    },
    '@/app/routes/provider-operation-clients': {
      runUberRidesProviderOperation: async (_credential, args) => {
        cliCalls.push([...args]);
        const payload = (opts.cliResponses || {})[args[0]];
        return payload === undefined ? {} : payload;
      },
    },
    '@/app/routes/concierge-store': { ConciergeStore: class { async ensureConversation() { return 'c1'; } } },
    '@/app/routes/concierge-reply': { cleanConciergeReply: (t) => t },
    '@/features/agent-management': {
      BotNodeClient: class {},
      createRegistryEndpointResolver: () => () => undefined,
    },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '{}' }) },
  };
  const shimRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    throw new Error(`unexpected require in rides route module: ${id}`);
  };
  const code = fs.readFileSync(ROUTE_FILE, 'utf8');
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(
    shimRequire, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE),
  );
  mod.exports.createRidesRoutes({
    pool: { query: opts.query || (async () => ({ rows: [], rowCount: 0 })) },
    appPackageDir: PKG,
  });
  return { handlers, mounts, cliCalls };
}

function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    sendFile(b) { this.body = b; return this; },
  };
}

const authed = (extra = {}) => ({ oidc: { isAuthenticated: () => true, user: { sub: 'rider-1' } }, query: {}, body: {}, ...extra });
const anon = (extra = {}) => ({ oidc: { isAuthenticated: () => false }, query: {}, body: {}, ...extra });

/** Run a registered handler and hand back the recording response. */
async function call(handlers, method, route, req) {
  const handler = handlers[method].get(route);
  assert.ok(handler, `no ${method.toUpperCase()} ${route} registered`);
  const res = fakeRes();
  await handler(req, res);
  return res;
}

// Each test controls MOCK_OIDC/GOOGLE_MAPS_* itself; keep the process env clean between them.
const ENV_KEYS = ['GOOGLE_MAPS_BROWSER_KEY', 'VITE_GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAPS_MAP_ID', 'OSHAL_MAP_TILE_URL', 'MOCK_OIDC'];
const savedEnv = {};
test.beforeEach(() => { for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; } });
test.afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test('with no Google key the map provider is osm — a real map, not a placeholder', async () => {
  const { handlers } = loadRoutes();
  const res = await call(handlers, 'get', '/config', authed());
  assert.equal(res.body.maps.provider, 'osm');
  assert.equal(res.body.maps.googleMapsEnabled, false);
  assert.equal(res.body.maps.googleMapsBrowserKey, undefined);
  // The surface cannot draw tiles without this, so a provider of 'osm' with no tile URL would
  // be the old fallback wearing a new name.
  assert.match(res.body.maps.tileUrl, /\{z\}\/\{x\}\/\{y\}/);
  assert.ok(res.body.maps.tileAttribution, 'OSM tiles must carry attribution');
  assert.ok(res.body.maps.maxZoom > 10);
});

test('a configured Google key upgrades the provider and is handed to the browser', async () => {
  process.env.GOOGLE_MAPS_BROWSER_KEY = 'test-browser-key';
  process.env.GOOGLE_MAPS_MAP_ID = 'test-map-id';
  const { handlers } = loadRoutes();
  const res = await call(handlers, 'get', '/config', authed());
  assert.equal(res.body.maps.provider, 'google-maps');
  assert.equal(res.body.maps.googleMapsEnabled, true);
  assert.equal(res.body.maps.googleMapsBrowserKey, 'test-browser-key');
  assert.equal(res.body.maps.googleMapsMapId, 'test-map-id');
  // Even keyed, the OSM tile config still ships — the surface falls back to it when the Google
  // script fails to load, and it cannot do that if the config did not arrive.
  assert.match(res.body.maps.tileUrl, /\{z\}\/\{x\}\/\{y\}/);
});

test('an operator tile server replaces the public OSM endpoint and its attribution', async () => {
  process.env.OSHAL_MAP_TILE_URL = 'https://tiles.internal.example/{z}/{x}/{y}.png';
  const { handlers } = loadRoutes();
  const res = await call(handlers, 'get', '/config', authed());
  assert.equal(res.body.maps.tileUrl, 'https://tiles.internal.example/{z}/{x}/{y}.png');
  assert.doesNotMatch(res.body.maps.tileAttribution, /openstreetmap\.org/i);
});

test('the vendored Leaflet directory is mounted, so the surface never needs a CDN', () => {
  const { mounts } = loadRoutes();
  assert.ok(mounts.includes('/vendor'), 'no /vendor mount registered');
  const staticMount = mounts.find((m) => m && m.static);
  assert.ok(staticMount, 'no express.static handler created for the vendor dir');
  assert.equal(staticMount.static, path.join(PKG, 'tools', 'vendor'));
  assert.equal(staticMount.options.index, false);
  assert.equal(staticMount.options.dotfiles, 'deny');
});

test('geocode resolves an address and returns only the point, not the CLI envelope', async () => {
  const { handlers, cliCalls } = loadRoutes({
    cliResponses: { geocode: { source: 'nominatim', lat: 30.39, lon: -86.49, label: 'Destin, FL' } },
  });
  const res = await call(handlers, 'get', '/geocode', authed({ query: { q: 'Destin FL' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { lat: 30.39, lon: -86.49, label: 'Destin, FL' });
  assert.deepEqual(cliCalls[0], ['geocode', 'Destin FL']);
});

test('geocode refuses an empty or oversized query without shelling the CLI', async () => {
  const { handlers, cliCalls } = loadRoutes();
  const empty = await call(handlers, 'get', '/geocode', authed({ query: { q: '  ' } }));
  assert.equal(empty.statusCode, 400);
  const huge = await call(handlers, 'get', '/geocode', authed({ query: { q: 'x'.repeat(301) } }));
  assert.equal(huge.statusCode, 400);
  assert.equal(cliCalls.length, 0, 'a rejected query must never reach Nominatim');
});

test('an address that does not resolve is a 404, never a fabricated point', async () => {
  const { handlers } = loadRoutes({ cliResponses: { geocode: { error: 'address did not resolve' } } });
  const res = await call(handlers, 'get', '/geocode', authed({ query: { q: 'asdkjhasd' } }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.lat, undefined);
});

test('reverse turns a dropped pin into an address', async () => {
  const { handlers, cliCalls } = loadRoutes({
    cliResponses: { reverse: { source: 'nominatim', label: 'Mountain Drive, Destin, FL' } },
  });
  const res = await call(handlers, 'get', '/reverse', authed({ query: { lat: '30.3935', lon: '-86.4958' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.label, 'Mountain Drive, Destin, FL');
  assert.deepEqual(cliCalls[0], ['reverse', '30.3935', '-86.4958']);
});

test('reverse rejects junk and out-of-range coordinates without shelling the CLI', async () => {
  const { handlers, cliCalls } = loadRoutes();
  for (const query of [{}, { lat: 'abc', lon: '1' }, { lat: '91', lon: '0' }, { lat: '0', lon: '181' }]) {
    const res = await call(handlers, 'get', '/reverse', authed({ query }));
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(query)}`);
  }
  assert.equal(cliCalls.length, 0, 'invalid coordinates must never reach Nominatim');
});

test('the geocoding proxy is authenticated — an open one is an abuse relay', async () => {
  const { handlers, cliCalls } = loadRoutes();
  const g = await call(handlers, 'get', '/geocode', anon({ query: { q: 'Destin FL' } }));
  assert.equal(g.statusCode, 401);
  const r = await call(handlers, 'get', '/reverse', anon({ query: { lat: '30', lon: '-86' } }));
  assert.equal(r.statusCode, 401);
  assert.equal(cliCalls.length, 0, 'an anonymous caller must not reach the CLI at all');
});

test('estimate hands the map the pins and the measurement it already paid for', async () => {
  const { handlers } = loadRoutes({
    cliResponses: {
      estimate: {
        source: 'estimate',
        options: [{ type: 'uberx', fareLow: 32, fareHigh: 41 }],
        coords: { pickup: { lat: 30.38, lon: -86.42 }, dropoff: { lat: 30.40, lon: -86.61 } },
        distanceKm: 24.1, straightLineKm: 18.6, basis: 'geocoded',
      },
    },
  });
  const res = await call(handlers, 'get', '/estimate', authed({ query: { pickup: 'a', dropoff: 'b' } }));
  assert.equal(res.body.basis, 'geocoded');
  assert.equal(res.body.distanceKm, 24.1);
  assert.equal(res.body.straightLineKm, 18.6);
  assert.equal(res.body.coords.pickup.lat, 30.38);
  assert.equal(res.body.coords.dropoff.lon, -86.61);
});

test('an unresolved estimate reports basis unresolved and carries no coordinates', async () => {
  const { handlers } = loadRoutes({
    cliResponses: {
      estimate: {
        source: 'estimate',
        options: [{ type: 'uberx', fareLow: null, fareHigh: null }],
        coords: { pickup: null, dropoff: null }, distanceKm: null, basis: 'unresolved',
      },
    },
  });
  const res = await call(handlers, 'get', '/estimate', authed({ query: { pickup: 'a', dropoff: 'nowhere' } }));
  assert.equal(res.body.basis, 'unresolved');
  assert.equal(res.body.distanceKm, null);
  assert.equal(res.body.options[0].fareLow, null);
});
