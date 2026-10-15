/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Sat Ops chat asked for ground-station coordinates while the Pass windows table on the same
 *   screen listed four passes. Through the real compiled route: POST /chat puts the station and the pass table the page sends
 *   into GROUND STATION / PASS WINDOWS ON SCREEN prompt lines with the rule to answer from them; bad page input is dropped; and
 *   the page sends its station and last prediction with every chat turn.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 8: on 2026-10-12 at 16:3x UTC the concierge called the 10-12 18:38 pass 'tomorrow'. The prompt
 *   carries a NOW (UTC) line and each pass on screen is labelled today / tomorrow / its date against the current UTC day.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const engine = {
  TLE_MAX_CHARS: 1000,
  SatFleet: class { async list() { return []; } },
  TleCatalog: class { async list() { return [{ satId: 'sweep6-iss', satnum: 25544, name: 'ISS' }]; } },
  SatCommandError: class extends Error {},
  CatalogError: class extends Error {},
  TleParseError: class extends Error {},
  PropagationError: class extends Error {},
  parseTle: () => ({}),
  computePassWindows: async () => ({ passes: [] }),
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
const { createSatRoutes, screenContextLines, nowLine } = require('../routes/sat-routes.js');
test.after(() => { Module._load = original; });

const RISE = Date.parse('2026-10-12T05:31:00Z');
const SCREEN = { station: { latDeg: 30.4, lonDeg: -86.6, altKm: 0.01 },
  passes: { satId: 'sweep6-iss', passes: [0, 1, 2, 3].map((i) => ({ riseUtcMs: RISE + i * 5_700_000, durationS: 540 + i * 60, maxElevationDeg: 20 + i * 10 })) } };

/** POST /chat with a stub orchestrator; answers the prompt the concierge was given. */
async function chat(body) {
  let prompt = '';
  const ctx = { orchestrator: { processMessage: async (_id, p) => { prompt = p; return { response: '{"say":"ok","draft":null}' }; } } };
  const router = createSatRoutes({ fleet: new engine.SatFleet(), catalog: new engine.TleCatalog(), ctx });
  let done;
  const finished = new Promise((r) => { done = r; });
  const res = { statusCode: 200, headersSent: false, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; done(); return this; } };
  router.routes['POST /chat']({ body, oidc: { user: { sub: 'op' } } }, res);
  await finished;
  return { res, prompt };
}

test('the station and the pass table on screen reach the prompt with the rule to answer from them', async () => {
  const { res, prompt } = await chat({ message: 'When is the next pass?', screen: SCREEN });
  assert.equal(res.statusCode, 200);
  assert.match(prompt, /GROUND STATION \(on the operator's screen\): lat 30\.40°, lon -86\.60°, alt 0\.010 km/);
  assert.match(prompt, /PASS WINDOWS ON SCREEN for sweep6-iss from that station \(next 24 h, UTC\): rise 10-12 05:31 \([^)]+\), 9 min, max el 20°; /);
  assert.equal((prompt.match(/rise 10-12/g) || []).length, 4);
  assert.match(prompt, /never ask for ground-station coordinates or a prediction the screen already gives/);
});

test('a turn with no screen state carries no screen lines, and an empty prediction says so', async () => {
  const { prompt } = await chat({ message: 'hi' });
  assert.doesNotMatch(prompt, /GROUND STATION \(on|PASS WINDOWS ON SCREEN for/);
  assert.deepEqual(screenContextLines({ passes: { satId: 'sat-a', passes: [] } }),
    ['PASS WINDOWS ON SCREEN for sat-a from that station: none above the mask in the next 24 h']);
});

test('bad page input is dropped, bounded and stripped', () => {
  assert.deepEqual(screenContextLines({ station: { latDeg: 91, lonDeg: 0 } }), []);
  assert.deepEqual(screenContextLines({ station: { latDeg: 'x', lonDeg: 0 } }), []);
  assert.deepEqual(screenContextLines('nope'), []);
  const many = screenContextLines({ passes: { satId: 'evil\nsat<script>', passes: Array.from({ length: 50 }, () => ({ riseUtcMs: RISE, durationS: 60, maxElevationDeg: 10 })).concat([{ riseUtcMs: 'x' }]) } });
  assert.equal(many.length, 1);
  assert.match(many[0], /^PASS WINDOWS ON SCREEN for evilsatscript /);
  assert.equal((many[0].match(/rise /g) || []).length, 12);
});

test('the page sends its station and last prediction with every chat turn', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sat-ops.html'), 'utf8');
  assert.match(html, /state\.lastPasses = \{ satId, passes: rep\.passes\.map/);
  assert.match(html, /JSON\.stringify\(\{ message: msg, history: chatHistory\.slice\(0, -1\), screen \}\)/);
  assert.match(html, /station: \{ latDeg: Number\(\$\('gsLat'\)\.value\), lonDeg: Number\(\$\('gsLon'\)\.value\), altKm: Number\(\$\('gsAlt'\)\.value\) \}/);
});

test('the prompt names the current UTC day and labels each pass against it', async () => {
  const at1635 = Date.parse('2026-10-12T16:35:00Z');
  const lines = screenContextLines({ passes: { satId: 'sweep8-iss', passes: [
    { riseUtcMs: Date.parse('2026-10-12T18:38:00Z'), durationS: 240, maxElevationDeg: 15 },
    { riseUtcMs: Date.parse('2026-10-13T00:10:00Z'), durationS: 300, maxElevationDeg: 40 },
    { riseUtcMs: Date.parse('2026-10-14T01:00:00Z'), durationS: 300, maxElevationDeg: 40 },
  ] } }, at1635);
  assert.match(lines[0], /rise 10-12 18:38 \(today\), 4 min, max el 15°; rise 10-13 00:10 \(tomorrow\), 5 min/);
  assert.match(lines[0], /rise 10-14 01:00 \(2026-10-14\)/);
  assert.equal(nowLine(at1635), 'NOW (UTC): 2026-10-12 16:35. Today is 2026-10-12 UTC; call a pass today or tomorrow only from its label below.');
  const { prompt } = await chat({ message: 'When is the next pass?', screen: SCREEN });
  const today = new Date().toISOString().slice(0, 10);
  assert.match(prompt, new RegExp(`^NOW \\(UTC\\): ${today} \\d\\d:\\d\\d\\. Today is ${today} UTC`, 'm'));
});
