/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | POST /api/sat/passes answers every pass instant as ISO-8601 UTC beside its epoch ms
 *   (riseUtc, culminationUtc, setUtc, and startUtc), through the real compiled route. The Sat Operator concierge read
 *   riseUtcMs 1791720773730 (2026-10-11 12:12:53 UTC) from this route and answered 2026-09-10 00:52:53 and later
 *   2026-11-28 02:52:53 UTC, because the route gave only milliseconds; the persona must quote the ISO strings verbatim.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const RISE = 1791720773730; // 2026-10-11T12:12:53.730Z, the live first rise of 2026-10-11
const START = Date.parse('2026-10-11T00:00:00Z');
class TleParseError extends Error {}
class PropagationError extends Error {}
const engine = {
  TLE_MAX_CHARS: 1000,
  SatFleet: class { async list() { return []; } },
  TleCatalog: class { async list() { return []; } },
  SatCommandError: class extends Error {},
  CatalogError: class extends Error {},
  TleParseError,
  PropagationError,
  parseTle: (raw) => ({ satnum: 90001, raw }),
  computePassWindows: async (_tle, _station, opts) => ({
    satnum: 90001,
    startUtcMs: opts.startUtcMs,
    horizonHours: 24,
    passes: [{ riseUtcMs: RISE, culminationUtcMs: RISE + 150000, setUtcMs: RISE + 300000, maxElevationDeg: 25 }],
  }),
};
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...f) => { routes[`${m} ${p}`] = f[f.length - 1]; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use() {} }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) },
  '@/shared/middleware/authz': { hasValidServiceSecret: () => false },
  '@/features/sat-ops': engine,
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createSatRoutes } = require('../routes/sat-routes.js');
test.after(() => { Module._load = original; });

async function passes(body) {
  const router = createSatRoutes({ fleet: new engine.SatFleet(), catalog: new engine.TleCatalog() });
  const res = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await router.routes['POST /passes']({ body }, res);
  return res;
}

test('every pass instant comes back as ISO-8601 UTC beside its epoch ms', async () => {
  const res = await passes({ tle: '1 x\n2 y', station: { latDeg: 45, lonDeg: -93, altKm: 0.25 }, startUtc: START });
  assert.equal(res.statusCode, 200);
  const [pass] = res.body.passes;
  assert.equal(pass.riseUtcMs, RISE, 'the epoch value is kept');
  assert.equal(pass.riseUtc, '2026-10-11T12:12:53.730Z');
  assert.equal(pass.culminationUtc, '2026-10-11T12:15:23.730Z');
  assert.equal(pass.setUtc, '2026-10-11T12:17:53.730Z');
  assert.equal(res.body.startUtc, '2026-10-11T00:00:00.000Z');
  assert.equal(res.body.engine, 'sgp4/satellite.js');
});

test('the TypeScript source carries the same ISO fields', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src-routes', 'sat-routes.ts'), 'utf8');
  assert.match(source, /res\.json\(\{ \.\.\.withIsoTimes\(prediction\), engine: 'sgp4\/satellite\.js' \}\)/);
  for (const field of ['riseUtc:', 'culminationUtc:', 'setUtc:', 'startUtc:']) assert.ok(source.includes(field), field);
});

test('the Sat Operator persona quotes the ISO strings and never converts milliseconds', () => {
  const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'sat-operator.yaml'), 'utf8');
  assert.match(persona, /riseUtc, culminationUtc and setUtc/);
  assert.match(persona, /never convert/i);
});
