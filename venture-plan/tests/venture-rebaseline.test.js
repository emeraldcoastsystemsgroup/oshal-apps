/**
 * Venture Plan - deterministic scheduled rebaseline policy and cost-cap guards.
 *
 * These tests run the compiled dependency-free module the framework will load.
 * They prove that absent policy cannot spend, UTC slots are deterministic, and
 * missing/over-cap provider settlement stops every later bot boundary.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add default-deny policy, cadence, exact-money, immutable-output, and fail-closed per-call budget coverage.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { engine } = require('./fixture-venture');

const R = engine('venture-rebaseline');

function enabled(over) {
  return Object.assign({
    ventureId: 'v1', enabled: true, dryRun: false, cadence: 'nightly',
    weeklyDay: 1, maxCostMicros: 50_000, updatedAt: null,
  }, over || {});
}

test('an absent policy is frozen, disabled, dry-run, and authorizes zero spend', () => {
  const policy = R.defaultRebaselinePolicy('v1');
  assert.deepEqual(policy, {
    ventureId: 'v1', enabled: false, dryRun: true, cadence: 'weekly',
    weeklyDay: 1, maxCostMicros: 0, updatedAt: null,
  });
  assert.equal(Object.isFrozen(policy), true);
});

test('a closed policy patch preserves omitted fields and refuses unknown fields', () => {
  const current = R.defaultRebaselinePolicy('v1');
  const merged = R.mergeRebaselinePolicy(current, {
    enabled: true, cadence: 'nightly', maxCostMicros: 25_000,
  });
  assert.equal(merged.enabled, true);
  assert.equal(merged.dryRun, true, 'enabling alone remains dry-run');
  assert.equal(merged.maxCostMicros, 25_000);
  assert.equal(Object.isFrozen(merged), true);
  assert.throws(() => R.mergeRebaselinePolicy(current, { ownerSub: 'mallory' }),
    { code: 'unknown_rebaseline_policy_field' });
});

test('paid enablement requires an explicit positive exact-integer micro-USD cap', () => {
  const current = R.defaultRebaselinePolicy('v1');
  assert.throws(() => R.mergeRebaselinePolicy(current, {
    enabled: true, dryRun: false,
  }), { code: 'rebaseline_cost_cap_required' });
  for (const cap of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => R.mergeRebaselinePolicy(current, { maxCostMicros: cap }),
      { code: 'invalid_rebaseline_cost_cap' });
  }
});

test('policy switches, cadence, and UTC weekday are strict closed values', () => {
  const current = R.defaultRebaselinePolicy('v1');
  assert.throws(() => R.mergeRebaselinePolicy(current, { enabled: 'true' }),
    { code: 'invalid_rebaseline_switch' });
  assert.throws(() => R.mergeRebaselinePolicy(current, { cadence: 'hourly' }),
    { code: 'invalid_rebaseline_cadence' });
  for (const day of [-1, 1.2, 7]) {
    assert.throws(() => R.mergeRebaselinePolicy(current, { weeklyDay: day }),
      { code: 'invalid_rebaseline_weekday' });
  }
});

test('nightly cadence derives one UTC date slot without reading a clock', () => {
  const decision = R.evaluateRebaselinePolicy(enabled(), '2026-08-06T23:59:59-05:00');
  assert.deepEqual(decision.phases, ['bom', 'market', 'ops', 'compute']);
  assert.equal(decision.onDate, '2026-08-07');
  assert.equal(decision.slot, 'nightly:2026-08-07');
  assert.equal(decision.outcome, 'ready');
  assert.equal(decision.botCallsAtMost, 3);
  assert.equal(Object.isFrozen(decision), true);
});

test('weekly cadence is due only on its configured UTC weekday', () => {
  const policy = enabled({ cadence: 'weekly', weeklyDay: 1 });
  const monday = R.evaluateRebaselinePolicy(policy, '2026-08-03T00:00:00Z');
  const tuesday = R.evaluateRebaselinePolicy(policy, '2026-08-04T00:00:00Z');
  assert.equal(monday.outcome, 'ready');
  assert.equal(monday.slot, 'weekly:2026-08-03');
  assert.equal(tuesday.outcome, 'not-due');
  assert.equal(tuesday.slot, null);
});

test('disabled and forced dry-run decisions never say they would start', () => {
  const off = R.evaluateRebaselinePolicy(R.defaultRebaselinePolicy('v1'), '2026-08-03T00:00:00Z');
  const preview = R.evaluateRebaselinePolicy(enabled(), '2026-08-03T00:00:00Z', true);
  assert.deepEqual([off.outcome, off.wouldStart], ['disabled', false]);
  assert.deepEqual([preview.outcome, preview.wouldStart], ['dry-run', false]);
});

test('invalid scheduler time is rejected before any due decision', () => {
  for (const value of ['not-a-date', '08/06/2026', '2026-08-06', '2026-02-30T12:00:00Z']) {
    assert.throws(() => R.evaluateRebaselinePolicy(enabled(), value),
      { code: 'invalid_rebaseline_time' });
  }
});

test('provider USD cost crosses into integer micros exactly once', () => {
  assert.equal(R.reportedCostUsdToMicros(0.000001), 1);
  assert.equal(R.reportedCostUsdToMicros(0.0123456), 12_346);
  for (const cost of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.0000004]) {
    assert.throws(() => R.reportedCostUsdToMicros(cost),
      { code: 'rebaseline_cost_capture_failed' });
  }
});

test('a charge reaching the cap blocks the next bot before dispatch', async () => {
  const budget = new R.ScheduledRunBudget(10_000);
  assert.equal(Object.isFrozen(budget.beforeCall()), true);
  let calls = 0;
  await R.costCappedBotCall(budget, async () => {
    calls += 1;
    return { costUsd: 0.01 };
  });
  await assert.rejects(() => R.costCappedBotCall(budget, async () => {
    calls += 1;
    return { costUsd: 0.001 };
  }), { code: 'rebaseline_cost_cap_blocked' });
  assert.equal(calls, 1, 'the refused callback never crosses the provider boundary');
  assert.deepEqual(budget.status(), {
    capMicros: 10_000, spentMicros: 10_000, status: 'exhausted',
    callsStarted: 1, callsSettled: 1, callsSkipped: 1,
  });
});

test('the atomic call that reports an overshoot is recorded, then all later calls stop', async () => {
  const budget = new R.ScheduledRunBudget(5_000);
  let calls = 0;
  await R.costCappedBotCall(budget, async () => {
    calls += 1;
    return { costUsd: 0.006 };
  });
  assert.equal(budget.status().status, 'overshot');
  await assert.rejects(() => R.costCappedBotCall(budget, async () => {
    calls += 1;
    return { costUsd: 0.001 };
  }), { code: 'rebaseline_cost_cap_blocked' });
  assert.equal(calls, 1);
});

test('missing or zero provider cost fails closed after preserving the current reply', async () => {
  const budget = new R.ScheduledRunBudget(5_000);
  const reply = await R.costCappedBotCall(budget, async () => ({ costUsd: 0, text: 'usable' }));
  assert.equal(reply.text, 'usable');
  assert.equal(budget.status().status, 'capture-failed');
  let later = false;
  await assert.rejects(() => R.costCappedBotCall(budget, async () => {
    later = true;
    return { costUsd: 0.001 };
  }), { code: 'rebaseline_cost_cap_blocked' });
  assert.equal(later, false);
});

test('a thrown provider call has unknown settlement and blocks every later call', async () => {
  const budget = new R.ScheduledRunBudget(5_000);
  await assert.rejects(() => R.costCappedBotCall(budget, async () => {
    throw new Error('provider disconnected');
  }), /provider disconnected/);
  assert.equal(budget.status().status, 'capture-failed');
  await assert.rejects(() => R.costCappedBotCall(budget, async () => ({ costUsd: 0.001 })),
    { code: 'rebaseline_cost_cap_blocked' });
});

test('an unsafe accumulated sum fails closed without storing an inexact integer', () => {
  const exactCeiling = 9_007_199_254_740_000;
  const budget = new R.ScheduledRunBudget(exactCeiling);
  budget.settleReportedCost(exactCeiling / 1_000_000);
  const before = budget.status().spentMicros;
  budget.settleReportedCost(0.000001);
  const after = budget.status();
  assert.equal(after.status, 'capture-failed');
  assert.equal(after.spentMicros, before, 'the unsafe addition is never performed');
  assert.equal(Number.isSafeInteger(after.spentMicros), true);
});
