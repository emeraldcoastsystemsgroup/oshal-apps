/**
 * Gross-up suite — the round-trip IS the test.
 *
 * A gross-up is only correct if running the solved gross back through the real
 * check produces the target net. Every case here asserts that round trip against
 * the COMPILED modules, including the two places a closed-form
 * `net / (1 - rate)` shortcut silently lands on the wrong piece of the function:
 * the Social Security wage base and the additional-Medicare threshold.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 18:30:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — exact round-trip at several targets, correctness across the SS wage-base and additional-Medicare crossings, minimality of the solved gross, the already-met case, and behaviour when a garnishment eats the increase.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { grossUp } = require('../routes/payroll-grossup.js');
const { computeCheck } = require('../routes/payroll-payrun.js');

const W4 = {
  filingStatus: 'single', step2: false, dependentsCreditCents: 0, otherIncomeCents: 0,
  deductionsCents: 0, extraWithholdingCents: 0, exempt: false,
};
const OPTS = {
  periodsPerYear: 26, age: null,
  state: { code: 'FL', manualRatePct: 0, allowances: 0 },
  ytd: { taxableWagesCents: 0, deferralCents: 0, supplementalWagesCents: 0 },
  employerTax: { sutaRatePct: 2.7, sutaWageBaseCents: 700_000, futaCreditReductionPct: 0, minimumWageCents: 725 },
};
const bonusRow = (amountCents) => ({ code: 'BONUS_D', hours: 0, rateCents: 0, amountCents, workweek: 1 });

test('ROUND TRIP: a $1,000.00 target net is reproduced exactly by the solved gross', () => {
  const r = grossUp(100_000, 'BONUS_D', [], [], W4, OPTS);
  assert.equal(r.exact, true, r.warnings.join(' '));
  assert.equal(r.achievedNetCents, 100_000);
  // The proof: feed the solved gross back through the real check.
  const back = computeCheck([bonusRow(r.grossCents)], [], W4, OPTS);
  assert.equal(back.netCents, 100_000, 'the solved gross must actually produce the target net');
  assert.ok(r.grossCents > 100_000, 'grossing up must cost more than the net promised');
});

test('the solved gross is MINIMAL — one cent less misses the target', () => {
  const r = grossUp(50_000, 'BONUS_D', [], [], W4, OPTS);
  const oneLess = computeCheck([bonusRow(r.grossCents - 1)], [], W4, OPTS);
  assert.ok(oneLess.netCents < 50_000, 'a cent less must fall short, or the solve was not minimal');
});

test('round trip holds at several targets', () => {
  for (const target of [1_00, 25_000, 100_000, 250_000, 1_000_000]) {
    const r = grossUp(target, 'BONUS_D', [], [], W4, OPTS);
    const back = computeCheck([bonusRow(r.grossCents)], [], W4, OPTS);
    assert.equal(back.netCents, r.achievedNetCents, `target ${target}: result must be reproducible`);
    assert.ok(back.netCents >= target, `target ${target}: never underpay the promised net`);
  }
});

test('CROSSING THE SS WAGE BASE: the solve stays correct where a flat-rate shortcut breaks', () => {
  // $1,000 short of the wage base, so the grossed-up amount straddles it: part of
  // the increase owes 6.2% and part owes none. A closed form using one marginal
  // rate lands on the wrong piece.
  const opts = { ...OPTS, ytd: { ...OPTS.ytd, taxableWagesCents: 18_350_000 } };
  const r = grossUp(500_000, 'BONUS_D', [], [], W4, opts);
  const back = computeCheck([bonusRow(r.grossCents)], [], W4, opts);
  assert.equal(back.netCents, 500_000, 'must still land exactly on the target across the cap');
  assert.ok(back.taxes.ssTaxableCents < back.grossCents, 'part of the check is genuinely above the wage base');
});

test('CROSSING THE ADDITIONAL-MEDICARE THRESHOLD: still exact', () => {
  const opts = { ...OPTS, ytd: { ...OPTS.ytd, taxableWagesCents: 19_900_000 } };
  const r = grossUp(500_000, 'BONUS_D', [], [], W4, opts);
  const back = computeCheck([bonusRow(r.grossCents)], [], W4, opts);
  assert.equal(back.netCents, 500_000);
  assert.ok(back.taxes.addlMedicareCents > 0, 'the check genuinely crosses the 0.9% threshold');
});

test('gross-up sits ON TOP of earnings already on the check', () => {
  const base = [{ code: 'REG', hours: 40, rateCents: 2_000, amountCents: 0, workweek: 1 },
                { code: 'REG', hours: 40, rateCents: 2_000, amountCents: 0, workweek: 2 }];
  const baseline = computeCheck(base, [], W4, OPTS);
  const r = grossUp(baseline.netCents + 100_000, 'BONUS_D', base, [], W4, OPTS);
  const back = computeCheck([...base, bonusRow(r.grossCents)], [], W4, OPTS);
  assert.equal(back.netCents, baseline.netCents + 100_000, 'the employee takes home exactly $1,000 more');
});

test('a target already met needs no gross-up and says so', () => {
  const base = [{ code: 'REG', hours: 40, rateCents: 5_000, amountCents: 0, workweek: 1 }];
  const baseline = computeCheck(base, [], W4, OPTS);
  const r = grossUp(baseline.netCents - 1_000, 'BONUS_D', base, [], W4, OPTS);
  assert.equal(r.grossCents, 0);
  assert.match(r.warnings.join(' '), /already meets or exceeds/);
});

test('a garnishment that consumes the increase is reported, not silently mis-solved', () => {
  // A creditor garnishment scales with disposable earnings, so raising gross also
  // raises the garnishment. The solve must still terminate and tell the truth.
  const r = grossUp(200_000, 'BONUS_D', [], [{ code: 'GARN_CREDITOR', amountCents: 10_000_000 }], W4, OPTS);
  const back = computeCheck([bonusRow(r.grossCents)],
    [{ code: 'GARN_CREDITOR', amountCents: 10_000_000 }], W4, OPTS);
  assert.equal(back.netCents, r.achievedNetCents, 'whatever it reports must be reproducible');
  assert.ok(r.iterations < 200, 'the solve must terminate, not spin');
});
