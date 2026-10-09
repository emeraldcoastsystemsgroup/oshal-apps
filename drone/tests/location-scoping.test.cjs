/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-169 L6 (D6) over the package's REAL routes (routes/drone-routes.js, loaded with express and the framework aliases stubbed): GET /state, GET /fleet and GET /fleet/:droneId/state return position and home exactly when the kernel's locatedDevice answers for the caller, and null with positionWithheld for everyone else; a drone enrolled nowhere is withheld from everyone; a locatedDevice refusal (no verified issuer) or failure is a "no", not an error; every other telemetry field, the fence, the fleet's online and kind flags survive; locatedDevice is asked by kind 'drone' and the fleet id; and the surface tolerates a withheld drone (no read of position or home without a guard on the paths the withheld shape reaches).
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The capture thumbnails with no home known: drawCaptureFrame, taken from the real page and run against a recording canvas, draws the frame without the home-direction tick while home is null (a withheld drone still gets its captures, and the unguarded read threw a TypeError that pollCaptures swallowed, so the thumbnails stopped drawing), and draws the tick once a home is known. The source list of guarded reads gains the capture frame.
 * -----------------------------------------------------------------------------
 * @module location-scoping.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SUB = 'synthetic-sub';
delete process.env.MOCK_OIDC;

const POINT = { lat: -12.35, lon: -31.99, alt: 30 };
const HOME = { lat: -12.3501, lon: -31.9901, alt: 0 };

/** @returns {object} Telemetry for one drone, as the engine reports it. */
function telemetry(droneId) {
  return { droneId, status: 'hold', position: { ...POINT }, home: { ...HOME }, headingDeg: 90, groundSpeedMps: 1.5,
    batteryPct: 88, distanceFromHomeM: 15, mission: null, failsafe: null };
}

/** @returns {object} A stub Express response that records the status and the JSON body. */
function response() {
  return { statusCode: 200, body: undefined, setHeader() {}, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; } };
}

/**
 * @description Load the compiled route module with a recording router; the kernel's locatedDevice is the stub given.
 * @param {(pool: object, kind: string, ref: string) => Promise<object|null>} located The locatedDevice stand-in.
 * @returns {{ routes: Array<{method: string, path: string, handler: Function}>, exports: object, warned: string[], asked: string[][] }} The module, its routes and what it logged and asked.
 */
function load(located) {
  const routes = [];
  const router = {};
  const warned = [];
  const asked = [];
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach((m) => { router[m] = (p, ...fns) => { routes.push({ method: m, path: p, handler: fns[fns.length - 1] }); }; });
  const stubs = {
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn(o, msg) { warned.push(msg); }, error() {}, debug(o, msg) { warned.push(msg); } }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: () => Promise.resolve(), buildOwnerRlsPolicyStatements: () => [] },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => null, hasValidServiceSecret: () => false },
    '@/features/drone': {
      DroneService: class {
        constructor() { this.fence = { maxRadiusM: 500, minAltM: 5, maxAltM: 120 }; this.providerKind = 'sim'; }
        getState(id = 'alpha') { return { droneId: id, telemetry: telemetry(id), fence: this.fence, provider: 'sim', online: true }; }
        listFleet() {
          return [
            { droneId: 'alpha', kind: 'sim', remote: false, online: true, lastSeenMs: null, telemetry: telemetry('alpha'), videoUrl: null },
            { droneId: 'beta', kind: 'mavlink', remote: true, online: true, lastSeenMs: 1, telemetry: telemetry('beta'), videoUrl: null },
            { droneId: 'gamma', kind: 'mavlink', remote: true, online: false, lastSeenMs: 1, telemetry: null, videoUrl: null },
          ];
        }
      },
      FleetShowRunner: class {}, DroneValidationError: class extends Error {}, DroneCommandError: class extends Error {}, DEFAULT_DRONE_ID: 'alpha',
    },
    '@/app/routes/concierge-envelope': {},
    '@/app/routes/concierge-store': { ConciergeStore: class {} },
    '@/features/location': { locatedDevice: (pool, kind, ref) => { asked.push([kind, ref]); return located(pool, kind, ref); } },
  };
  const req = (name) => {
    if (name === 'express') return { Router: () => router };
    if (['path', 'fs', 'crypto'].includes(name)) return require(name);
    assert.ok(Object.prototype.hasOwnProperty.call(stubs, name), 'unexpected import: ' + name);
    return stubs[name];
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', fs.readFileSync(path.join(ROOT, 'routes/drone-routes.js'), 'utf8'))(req, mod, mod.exports, path.join(ROOT, 'routes'));
  mod.exports.createDroneRoutes({ pool: { query: async () => ({ rows: [] }) }, appPackageDir: ROOT });
  return { routes, exports: mod.exports, warned, asked };
}

/** @returns {Promise<object>} The JSON body one of the three read routes answers for a signed-in viewer. */
async function read(routes, method, p, params = {}) {
  const found = routes.filter((r) => r.method === method && r.path === p);
  assert.equal(found.length, 1, method.toUpperCase() + ' ' + p + ' is registered once');
  const res = response();
  await found[0].handler({ oidc: { user: { sub: SUB }, isAuthenticated: () => true }, params, query: {}, body: undefined, path: p }, res);
  assert.equal(res.statusCode, 200);
  return JSON.parse(JSON.stringify(res.body));
}

const memberOf = (ids) => async (pool, kind, ref) => (ids.includes(ref) ? { deviceId: 'dev-' + ref, owner: 'group', groupId: 'g1', reporting: true } : null);

test('a member of the drone\'s group sees position and home on all three reads; everything else is unchanged', async () => {
  const { routes, asked } = load(memberOf(['alpha', 'beta']));
  const state = await read(routes, 'get', '/state');
  assert.deepEqual(state.telemetry.position, POINT);
  assert.deepEqual(state.telemetry.home, HOME);
  assert.equal(state.telemetry.positionWithheld, undefined);
  assert.equal(state.telemetry.batteryPct, 88);
  assert.deepEqual(state.fence, { maxRadiusM: 500, minAltM: 5, maxAltM: 120 });
  const one = await read(routes, 'get', '/fleet/:droneId/state', { droneId: 'beta' });
  assert.deepEqual(one.telemetry.position, POINT);
  const fleet = await read(routes, 'get', '/fleet');
  assert.deepEqual(fleet.fleet.map((f) => [f.droneId, f.online, f.kind, f.telemetry && f.telemetry.position !== null]), [['alpha', true, 'sim', true], ['beta', true, 'mavlink', true], ['gamma', false, 'mavlink', null]]);
  assert.deepEqual(asked, [['drone', 'alpha'], ['drone', 'beta'], ['drone', 'alpha'], ['drone', 'beta']]);
});

test('a non-member gets no position and no home from the three reads, and the rest of the telemetry survives', async () => {
  const { routes } = load(memberOf(['beta']));
  const state = await read(routes, 'get', '/state');
  assert.equal(state.telemetry.position, null);
  assert.equal(state.telemetry.home, null);
  assert.equal(state.telemetry.positionWithheld, true);
  assert.equal(state.telemetry.status, 'hold');
  assert.equal(state.telemetry.distanceFromHomeM, 15);
  assert.equal(state.online, true);
  const one = await read(routes, 'get', '/fleet/:droneId/state', { droneId: 'alpha' });
  assert.equal(one.telemetry.position, null);
  assert.equal(one.telemetry.positionWithheld, true);
  const fleet = await read(routes, 'get', '/fleet');
  const byId = Object.fromEntries(fleet.fleet.map((f) => [f.droneId, f.telemetry]));
  assert.equal(byId.alpha.position, null);
  assert.equal(byId.alpha.positionWithheld, true);
  assert.deepEqual(byId.beta.position, POINT);
  assert.equal(byId.gamma, null);
  assert.doesNotMatch(JSON.stringify(state).replace(/"home":null|"position":null/g, ''), /"lat"|"lon"/, 'no coordinate leaks for a withheld drone');
});

test('a drone enrolled nowhere is withheld from everyone; a refused or failed read is a "no" that is logged, never an error', async () => {
  const { routes } = load(async () => null);
  assert.equal((await read(routes, 'get', '/state')).telemetry.positionWithheld, true);
  const refused = load(async () => { const e = new Error('no issuer'); e.name = 'LocationPrincipalError'; throw e; });
  assert.equal((await read(refused.routes, 'get', '/state')).telemetry.position, null);
  assert.ok(refused.warned.some((m) => /withheld/.test(m)), 'the refusal is logged');
  const failed = load(async () => { throw new Error('boom'); });
  assert.equal((await read(failed.routes, 'get', '/fleet/:droneId/state', { droneId: 'beta' })).telemetry.home, null);
  assert.ok(failed.warned.some((m) => /could not be read/.test(m)), 'the failure is logged');
});

test('the surface guards every read of position and home it makes from the fleet and state answers', () => {
  const html = fs.readFileSync(path.join(ROOT, 'tools/drone-ops.html'), 'utf8');
  assert.match(html, /home = state\.home \|\| home;/);
  assert.match(html, /state\.position \? state\.position\.alt\.toFixed\(1\)/);
  assert.match(html, /POSITION WITHHELD/);
  assert.match(html, /if \(!f\.online \|\| !t \|\| !t\.position \|\|/);
  assert.match(html, /if \(!t \|\| !f\.online \|\| !t\.position\) continue;/);
  assert.match(html, /if \(!t \|\| !fl\.online \|\| !t\.position\) continue;/);
  assert.match(html, /if \(viewCam && state && state\.position\)/);
  assert.match(html, /\(f && f\.telemetry && f\.telemetry\.home\) \|\| home;\s*\n\s*if \(!pad\) continue;/);
  assert.match(html, /if \(home\) \{\s*\n\s*const camAxis = /);
});

/**
 * @description Take one top-level function's source from the page, by matching its braces.
 * @param {string} html The page.
 * @param {string} name The function name.
 * @returns {string} The function's source text.
 */
function pageFunction(html, name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' is on the page');
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

/**
 * @description Run the page's drawCaptureFrame for one capture against a canvas that records what it fills.
 * @param {object|null} home The page's home at the time (null while it is withheld).
 * @returns {{ fills: string[], texts: string[] }} The fill colours used and the text drawn.
 */
function drawCapture(home) {
  const html = fs.readFileSync(path.join(ROOT, 'tools/drone-ops.html'), 'utf8');
  const drawn = { fills: [], texts: [] };
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '',
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, closePath() {}, arc() {},
    fill() { drawn.fills.push(String(ctx.fillStyle)); },
    fillText(text) { drawn.texts.push(String(text)); },
  };
  const canvas = { width: 96, height: 54, getContext: () => ctx };
  // A photo just south of home with the camera facing north: home sits dead ahead, so its tick is in frame.
  const capture = { seq: 1, kind: 'photo', ts: 0, durationS: null, position: { lat: -12.3505, lon: -31.99, alt: 30 }, headingDeg: 0, panDeg: 0, tiltDeg: 0 };
  vm.runInNewContext(pageFunction(html, 'drawCaptureFrame') + '\ndrawCaptureFrame(canvas, capture);', { home, canvas, capture, Math, String });
  return drawn;
}

test('the capture thumbnails draw with no home known (a withheld drone), and the home tick only once a home is known', () => {
  const withheld = drawCapture(null);
  assert.deepEqual(withheld.texts, ['SYNTHETIC', '30m']);
  assert.ok(!withheld.fills.includes('#ffd166'), 'no home-direction tick without a home');
  const known = drawCapture({ lat: -12.35, lon: -31.99, alt: 0 });
  assert.ok(known.fills.includes('#ffd166'), 'the home-direction tick is drawn once a home is known');
});
