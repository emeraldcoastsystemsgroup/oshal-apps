/**
 * Venture Plan - service tick execution-boundary guards.
 *
 * The collaborators beyond the tick boundary are injected. These branch tests
 * prove the service worker enters system identity for its scan, never dispatches
 * in either dry-run mode, strips owner subjects from results, and starts only a
 * due explicitly executed policy. Store SQL and cap mechanics have companion
 * tests at their real compiled boundaries.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add default dry-run, policy dry-run, system identity, due-slot, sanitized response, and invalid-time guards.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove the named manifest schedule export uses the kernel timestamp/static execute gate and returns aggregate-only scheduler metadata.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');

function fakeRouter() {
  const routes = new Map();
  return { routes, post: (route, handler) => routes.set(`post ${route}`, handler) };
}

const boundary = { system: 0, scans: 0, starts: 0 };
const STUBS = {
  express: { Router: () => fakeRouter() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database/request-identity': {
    runWithSystemIdentity: async (work) => { boundary.system += 1; return work(); },
  },
  './venture-run': {
    startScheduledRebaseline: async () => {
      boundary.starts += 1;
      return { runId: 'default-run', alreadyRunning: false, alreadyScheduled: false, phases: [] };
    },
  },
  './venture-store-rebaseline': {
    listEnabledRebaselinePoliciesSystem: async () => {
      boundary.scans += 1;
      return [{
        ventureId: 'v-default', ownerSub: 'secret-owner', enabled: true, dryRun: false,
        cadence: 'nightly', weeklyDay: 1, maxCostMicros: 1000, updatedAt: null,
      }];
    },
  },
  './venture-schema': { ensureVentureSchema: async () => {} },
};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};

const {
  createVentureRebaselineRoutes, runDueRebaselineTick, runScheduledRebaselineTick,
} = require(path.join(PKG, 'routes', 'venture-rebaseline-routes.js'));

const ctx = { pool: { query: async () => ({ rows: [] }) } };

function policy(over) {
  return Object.assign({
    ventureId: 'v1', ownerSub: 'alice', enabled: true, dryRun: false,
    cadence: 'nightly', weeklyDay: 1, maxCostMicros: 25_000, updatedAt: null,
  }, over || {});
}

function deps(policies, start) {
  const calls = { system: 0, list: 0, start: [] };
  return {
    calls,
    value: {
      withSystemIdentity: async (work) => { calls.system += 1; return work(); },
      listPolicies: async () => { calls.list += 1; return policies; },
      start: async (...args) => {
        calls.start.push(args);
        return start ? start(...args) : {
          runId: 'r1', alreadyRunning: false, alreadyScheduled: false, phases: [],
        };
      },
    },
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('tick-level dry-run scans under system identity but never dispatches', async () => {
  const d = deps([policy()]);
  const results = await runDueRebaselineTick(ctx, {
    atIso: '2026-08-06T12:00:00Z', execute: false,
  }, d.value);
  assert.deepEqual([d.calls.system, d.calls.list, d.calls.start.length], [1, 1, 0]);
  assert.equal(results[0].outcome, 'dry-run');
  assert.equal(results[0].slot, 'nightly:2026-08-06');
  assert.equal(Object.hasOwn(results[0], 'ownerSub'), false, 'service results never echo owner identity');
});

test('an owner policy left in dry-run cannot dispatch even when the tick executes', async () => {
  const d = deps([policy({ dryRun: true })]);
  const results = await runDueRebaselineTick(ctx, {
    atIso: '2026-08-06T12:00:00Z', execute: true,
  }, d.value);
  assert.equal(results[0].outcome, 'dry-run');
  assert.equal(d.calls.start.length, 0);
});

test('a due policy dispatches once only after exact execute=true', async () => {
  const d = deps([policy()]);
  const results = await runDueRebaselineTick(ctx, {
    atIso: '2026-08-06T12:00:00Z', execute: true,
  }, d.value);
  assert.equal(results[0].outcome, 'started');
  assert.equal(results[0].runId, 'r1');
  assert.equal(d.calls.start.length, 1);
  assert.deepEqual(d.calls.start[0].slice(1), [
    'alice', 'v1', 'nightly:2026-08-06', '2026-08-06', 25_000,
  ]);
  assert.equal(Object.hasOwn(results[0], 'ownerSub'), false);
});

test('a weekly policy that is not due performs no dispatch', async () => {
  const d = deps([policy({ cadence: 'weekly', weeklyDay: 1 })]);
  const results = await runDueRebaselineTick(ctx, {
    atIso: '2026-08-04T12:00:00Z', execute: true,
  }, d.value);
  assert.equal(results[0].outcome, 'not-due');
  assert.equal(results[0].slot, null);
  assert.equal(d.calls.start.length, 0);
});

test('one invalid stored policy is reported without starving another due owner', async () => {
  const d = deps([
    policy({ ventureId: 'broken', ownerSub: 'broken-owner', maxCostMicros: 0 }),
    policy({ ventureId: 'healthy', ownerSub: 'healthy-owner' }),
  ]);
  const results = await runDueRebaselineTick(ctx, {
    atIso: '2026-08-06T12:00:00Z', execute: true,
  }, d.value);
  assert.deepEqual(results.map((result) => result.outcome), ['error', 'started']);
  assert.equal(results[0].error, 'rebaseline_cost_cap_required');
  assert.equal(d.calls.start.length, 1);
  assert.equal(d.calls.start[0][1], 'healthy-owner');
});

test('an invalid timestamp is refused before system identity or policy scan', async () => {
  const d = deps([policy()]);
  await assert.rejects(() => runDueRebaselineTick(ctx, {
    atIso: 'not-a-date', execute: true,
  }, d.value), { code: 'invalid_rebaseline_time' });
  assert.deepEqual([d.calls.system, d.calls.list, d.calls.start.length], [0, 0, 0]);
});

test('the named manifest handler executes the deterministic worker and returns only aggregates', async () => {
  boundary.system = 0;
  boundary.scans = 0;
  boundary.starts = 0;
  const result = await runScheduledRebaselineTick(ctx, {
    scheduleId: 'venture-plan-rebaseline-policy-tick',
    scheduledAtIso: '2026-08-06T12:00:00Z',
    body: Object.freeze({ execute: true }),
  });
  assert.deepEqual(result, { summary: 'evaluated=1; started=1; errors=0' });
  assert.deepEqual([boundary.system, boundary.scans, boundary.starts], [1, 1, 1]);
  assert.equal(JSON.stringify(result).includes('secret-owner'), false);
});

test('the HTTP tick defaults to dry-run and does not reach its start boundary', async () => {
  boundary.system = 0;
  boundary.scans = 0;
  boundary.starts = 0;
  const router = createVentureRebaselineRoutes(ctx);
  const handler = router.routes.get('post /tick');
  assert.ok(handler);
  const res = makeRes();
  await handler({ body: { atIso: '2026-08-06T12:00:00Z' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'dry-run');
  assert.equal(res.body.results[0].outcome, 'dry-run');
  assert.deepEqual([boundary.system, boundary.scans, boundary.starts], [1, 1, 0]);
  assert.equal(JSON.stringify(res.body).includes('secret-owner'), false);
});

test('the HTTP tick returns a closed 400 for invalid supplied time', async () => {
  boundary.system = 0;
  boundary.scans = 0;
  const router = createVentureRebaselineRoutes(ctx);
  const res = makeRes();
  await router.routes.get('post /tick')({ body: { atIso: 'never' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_rebaseline_time');
  assert.deepEqual([boundary.system, boundary.scans], [0, 0]);
});
