/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | On the native host GET/POST/DELETE /api/trading/autopilot answer from the native paper book
 *   (status, arm, disarm) through the compiled router over the in-memory SQL double, and never reach the legacy schedule
 *   service, whose native stand-in throws native_executor_unavailable; a different cron is refused; the declared cron and
 *   timezone are the manifest's paper-autopilot schedule; off the native host the legacy path still runs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Armed is not scheduled: arming answers armed:true with enabled and scheduleActive null (the person's activation
 *   lives in the kernel, which the package cannot read), never enabled:true; a disarmed book answers enabled:false; the
 *   newest schedule-fired tick is reported as lastScheduledRunAt and a manual tick is not.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { createSqlDouble } = require('./support/paper-doubles');

const legacyCalls = [];
const unavailable = (name) => () => { legacyCalls.push(name); throw Object.assign(new Error('native trading executor unavailable'), { code: 'native_executor_unavailable', status: 503 }); };
/** Every framework import is the native bridge's posture: present, and refusing when called. */
const framework = (request) => new Proxy({}, { get: (_t, key) => (key === 'createChildLogger' ? () => ({ info() {}, warn() {}, error() {}, debug() {} }) : key === '__esModule' ? false : unavailable(`${request}.${String(key)}`)) });
const express = { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { if (typeof p === 'string') routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST'), delete: add('DELETE'), use() {} }; } };
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'express') return express;
  if (request.startsWith('@/')) return framework(request);
  return originalLoad.call(this, request, parent, isMain);
};
const { createTradingAutopilotRoutes } = require('../routes/trading-autopilot-routes');
Module._load = originalLoad;

/** Call one compiled route as `sub` and answer its status and JSON. */
async function call(routes, key, sub, body = {}) {
  const sent = { status: 200, body: undefined };
  const res = { status(c) { sent.status = c; return res; }, json(b) { sent.body = b; return res; } };
  await routes[key]({ oshalCallerSub: sub, body, headers: {} }, res);
  return sent;
}

function nativeRoutes() {
  const sql = createSqlDouble();
  const ctx = { pool: sql.pool, intent: async () => { throw new Error('no price read expected'); }, newId: (() => { let n = 0; return () => `id-${(n += 1)}`; })() };
  return { sql, routes: createTradingAutopilotRoutes(ctx).routes };
}

test('native status answers from the paper book and never reaches the legacy schedule service', async () => {
  legacyCalls.length = 0;
  const { routes } = nativeRoutes();
  const out = await call(routes, 'GET /', 'ap-alice');
  assert.equal(out.status, 200);
  assert.equal(out.body.native, true);
  assert.equal(out.body.enabled, false);
  assert.equal(out.body.mode, 'paper');
  assert.deepEqual(out.body.legs.technical, false);
  assert.equal(out.body.schedule.name, 'paper-autopilot');
  assert.deepEqual(legacyCalls, [], 'no legacy executor was called');
});

test('POST arms the paper book, DELETE disarms it, and each person sees only their own', async () => {
  legacyCalls.length = 0;
  const { routes } = nativeRoutes();
  const armed = await call(routes, 'POST /', 'ap-alice', { universe: ['AAA', 'BBB'], startingCash: 50000 });
  assert.equal(armed.status, 200);
  assert.equal(armed.body.armed, true);
  assert.equal(armed.body.enabled, null, 'arming alone is not scheduled: enabled is never claimed true');
  assert.equal(armed.body.scheduleActive, null);
  assert.equal(armed.body.schedule.activationKnown, false);
  assert.equal(armed.body.schedule.activationSource, '/api/v1/agent/schedules');
  assert.match(armed.body.note, /activated for you/);
  assert.equal(armed.body.universeSource, 'pinned');
  assert.equal(armed.body.universeCount, 2);
  assert.equal(armed.body.account.startingCash, 50000);
  assert.equal((await call(routes, 'GET /', 'ap-bob')).body.enabled, false, 'Bob does not see Alice armed');
  const stopped = await call(routes, 'DELETE /', 'ap-alice');
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.armed, false);
  assert.equal(stopped.body.enabled, false);
  assert.equal(stopped.body.disarmed, true);
  assert.deepEqual(legacyCalls, []);
});

test('a different cadence and an invalid book are refused with their own status', async () => {
  const { routes } = nativeRoutes();
  const cron = await call(routes, 'POST /', 'ap-alice', { cron: '*/2 * * * *' });
  assert.equal(cron.status, 400);
  assert.equal(cron.body.error, 'cron_fixed');
  const posture = await call(routes, 'POST /', 'ap-alice', { posture: 'reckless' });
  assert.equal(posture.status, 400);
  assert.equal(posture.body.error, 'invalid_paper_config');
  assert.equal((await call(routes, 'GET /', null)).status, 401);
});

test('the declared cadence is the manifest\'s paper-autopilot schedule', async () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const block = manifest.slice(manifest.indexOf('- id: paper-autopilot'));
  const { routes } = nativeRoutes();
  const out = (await call(routes, 'GET /', 'ap-alice')).body;
  assert.match(block, new RegExp(`cron: "${out.cron.replace(/[*]/g, '\\*')}"`));
  assert.match(block, new RegExp(`timezone: ${out.timezone}`));
});

test('off the native host the legacy schedule service is still the switch', async () => {
  legacyCalls.length = 0;
  const routes = createTradingAutopilotRoutes({ pool: { query: async () => ({ rows: [] }) } }).routes;
  await assert.rejects(call(routes, 'GET /', 'ap-alice'), /native trading executor unavailable/, 'the legacy path ran (its stand-ins refuse here)');
  assert.ok(legacyCalls.length > 0 && legacyCalls.every((c) => c.startsWith('@/')), `the legacy framework path was asked (${legacyCalls})`);
});

test('the newest schedule-fired tick is reported, a manual tick is not', async () => {
  const { sql, routes } = nativeRoutes();
  await call(routes, 'POST /', 'ap-alice', {});
  const insert = require('../routes/paper/store').SQL.TICK_CLAIM;
  await sql.pool.query(insert, ['ap-alice', '2026-10-12T13:30', 'schedule', 'run-1', 'completed', 0, 50000, null, '2026-10-12T13:30:05.000Z']);
  await sql.pool.query(insert, ['ap-alice', '2026-10-12T13:35', 'manual', null, 'completed', 0, 50000, null, '2026-10-12T13:35:05.000Z']);
  const out = (await call(routes, 'GET /', 'ap-alice')).body;
  assert.equal(out.lastRunAt, '2026-10-12T13:35:05.000Z');
  assert.equal(out.lastScheduledRunAt, '2026-10-12T13:30:05.000Z');
  assert.equal(out.enabled, null);
});
