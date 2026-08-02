/**
 * Pay-run assembler suite — the v2 earnings/deduction model, run against the
 * COMPILED routes/payroll-payrun.js.
 *
 * These are the guards for the things that make it a payroll SYSTEM rather than
 * a tax calculator: overtime computed per workweek and never averaged, a
 * weighted regular rate that nondiscretionary pay lifts, each tax base reduced
 * independently, income that is taxed but not paid, and deductions applied in
 * statutory order against limited net with arrears.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 16:30:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — FLSA per-workweek overtime (the 30/50 averaging bug), weighted regular rate across two rates, nondiscretionary-bonus top-up, PTO not creating overtime, per-base pre-tax reduction, imputed income and reported tips taxed-not-paid, reimbursement paid-not-taxed, garnishment priority under one CCPA ceiling with arrears, the shared 402(g) ceiling, unknown-code rejection, and the cash identity.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// payroll-store pulls in the schema module, which needs the framework's database
// helper. Stubbed at the require layer so this suite stays dependency-free.
const Module = require('node:module');
const STUBS = {
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/features/personal-data': {
    isEncrypted: (v) => typeof v === 'string' && v.startsWith('enc:'),
    encryptField: (_s, v) => (v === null || v === undefined ? null : `enc:${v}`),
    decryptField: (_s, v) => (typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v),
  },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, req)) return STUBS[req];
  return origLoad.call(this, req, ...rest);
};
const payrun = require('../routes/payroll-payrun.js');
const codes = require('../routes/payroll-codes.js');

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
const reg = (hours, rate, week, code = 'REG') => ({ code, hours, rateCents: rate, amountCents: 0, workweek: week });
const amt = (code, amountCents, week = 1) => ({ code, hours: 0, rateCents: 0, amountCents, workweek: week });

/* ── The headline: FLSA overtime is per workweek ─────────────────────────── */

test('THE AVERAGING BUG: 30h + 50h biweekly owes 10 hours of premium, not zero', () => {
  const c = payrun.computeCheck([reg(30, 2_000, 1), reg(50, 2_000, 2)], [], W4, OPTS);
  // Straight time for 80 hours = $1,600. Week 2 owes 10 hours at half the $20
  // regular rate = $100 of premium. A period-total model pays $1,600 and is wrong.
  assert.equal(c.grossCents, 170_000, 'must be $1,700, not the $1,600 a period-total model pays');
  assert.deepEqual(c.workweekHours, { 1: 30, 2: 50 });
  assert.match(c.warnings.join(' '), /Week 2: 50 hours worked with no overtime/);
});

test('40h + 40h owes NO premium — the fix must not invent overtime', () => {
  const c = payrun.computeCheck([reg(40, 2_000, 1), reg(40, 2_000, 2)], [], W4, OPTS);
  assert.equal(c.grossCents, 160_000);
  assert.deepEqual(c.warnings.filter((w) => /premium/.test(w)), []);
});

test('the regular rate is WEIGHTED across two rates worked in one week', () => {
  // 30h at $20 + 20h at $10 = $800 over 50 hours → regular rate $16/hr.
  // Premium owed on 10 OT hours = 10 x $8 = $80. Gross $880.
  const c = payrun.computeCheck([reg(30, 2_000, 1), reg(20, 1_000, 1)], [], W4, OPTS);
  assert.equal(c.grossCents, 88_000, 'a blended rate, not either raw rate');
});

test('a nondiscretionary bonus lifts the regular rate on explicitly-entered overtime', () => {
  // 40 REG + 10 OT at $20, plus a $200 production bonus. The bonus raises the
  // regular rate, so the half-time premium owes a top-up (29 CFR 778.117).
  const withBonus = payrun.computeCheck(
    [reg(40, 2_000, 1), reg(10, 2_000, 1, 'OT'), amt('BONUS_ND', 20_000)], [], W4, OPTS);
  const withDiscretionary = payrun.computeCheck(
    [reg(40, 2_000, 1), reg(10, 2_000, 1, 'OT'), amt('BONUS_D', 20_000)], [], W4, OPTS);
  assert.ok(withBonus.grossCents > withDiscretionary.grossCents,
    'a nondiscretionary bonus must cost more than a discretionary one of the same size');
  assert.match(withBonus.warnings.join(' '), /778\.117/);
});

test('PTO and holiday hours are paid but are NOT hours worked, so they create no overtime', () => {
  const c = payrun.computeCheck([reg(32, 2_000, 1), reg(8, 2_000, 1, 'PTO')], [], W4, OPTS);
  assert.equal(c.grossCents, 80_000, '40 paid hours, none of them overtime');
  assert.equal(c.workweekHours[1], 32, 'only worked hours accumulate toward the 40-hour threshold');
  const over = payrun.computeCheck([reg(40, 2_000, 1), reg(8, 2_000, 1, 'HOL')], [], W4, OPTS);
  assert.equal(over.grossCents, 96_000, 'holiday on top of 40 worked hours is still straight time');
});

/* ── Taxability is four independent axes ─────────────────────────────────── */

test('Section 125 reduces every base; a 401(k) deferral reduces income tax only', () => {
  const c = payrun.computeCheck(
    [reg(40, 2_500, 1), reg(40, 2_500, 2)],
    [{ code: 'MED125', amountCents: 20_000 }, { code: 'K401', amountCents: 10_000 }],
    W4, OPTS);
  assert.equal(c.grossCents, 200_000);
  assert.equal(c.bases.ficaCents, 180_000, 'FICA drops by the 125 premium only');
  assert.equal(c.bases.futaCents, 180_000, 'FUTA follows FICA');
  assert.equal(c.bases.fitCents, 170_000, 'FIT drops by BOTH');
  assert.equal(c.bases.stateCents, 170_000);
});

test('Roth is post-tax but SHARES the 402(g) ceiling with pre-tax', () => {
  const c = payrun.computeCheck(
    [reg(40, 50_000, 1), reg(40, 50_000, 2)],
    [{ code: 'K401', amountCents: 1_000_000 }, { code: 'ROTH401', amountCents: 1_000_000 }],
    W4, { ...OPTS, ytd: { ...OPTS.ytd, deferralCents: 2_400_000 } });
  const k = c.deductions.find((d) => d.code === 'K401');
  const r = c.deductions.find((d) => d.code === 'ROTH401');
  assert.equal(k.appliedCents + r.appliedCents, 50_000, 'only the remaining $500 of room may be used');
  assert.match(c.warnings.join(' '), /COMBINED/);
});

test('imputed group-term life is TAXED but never paid in cash', () => {
  const c = payrun.computeCheck([reg(40, 2_000, 1), reg(40, 2_000, 2), amt('GTL', 5_000)], [], W4, OPTS);
  assert.equal(c.grossCents, 165_000, 'imputed income IS wages');
  assert.equal(c.bases.ficaCents, 165_000, 'and it is FICA-taxable');
  assert.equal(c.imputedCents, 5_000);
  assert.equal(c.cashEarningsCents, 160_000, 'but only the real wages are payable');
  assert.ok(c.netCents < 160_000, 'the tax on imputed income comes out of cash wages');
});

test('reported cash tips are taxed but not paid; charge tips ARE paid', () => {
  const cash = payrun.computeCheck([reg(30, 800, 1), amt('TIPS_CASH', 60_000)], [], W4, OPTS);
  assert.equal(cash.reportedTipsCents, 60_000);
  assert.equal(cash.cashEarningsCents, 24_000, 'the employee already holds the tips');
  const charge = payrun.computeCheck([reg(30, 800, 1), amt('TIPS_CHARGE', 60_000)], [], W4, OPTS);
  assert.equal(charge.cashEarningsCents, 84_000, 'charge tips are paid out by the employer');
});

test('an expense reimbursement is paid but never taxed and never reported as wages', () => {
  const c = payrun.computeCheck([reg(40, 2_000, 1), reg(40, 2_000, 2), amt('REIMB', 12_345)], [], W4, OPTS);
  assert.equal(c.grossCents, 160_000, 'reimbursement is NOT wages');
  assert.equal(c.bases.fitCents, 160_000);
  assert.equal(c.nontaxablePaidCents, 12_345);
  assert.equal(c.netCents, 160_000 - (c.taxes.fitCents + c.taxes.ssCents + c.taxes.medicareCents
    + c.taxes.addlMedicareCents + c.taxes.stateCents) + 12_345);
});

/* ── Deductions: order, ceilings, arrears ────────────────────────────────── */

test('garnishments apply in STATUTORY PRIORITY under one shared CCPA ceiling', () => {
  const c = payrun.computeCheck(
    [reg(40, 1_500, 1), reg(40, 1_500, 2)],
    [
      { code: 'GARN_CREDITOR', amountCents: 40_000 },
      { code: 'GARN_SUPPORT', amountCents: 40_000, supportCcpaPct: 50 },
      { code: 'DUES', amountCents: 2_500 },
    ],
    W4, OPTS);
  const support = c.deductions.find((d) => d.code === 'GARN_SUPPORT');
  const creditor = c.deductions.find((d) => d.code === 'GARN_CREDITOR');
  assert.ok(support.appliedCents > 0, 'support is first in priority and must be funded first');
  assert.ok(creditor.appliedCents < creditor.requestedCents, 'the creditor writ is squeezed by the ceiling');
  assert.ok(support.appliedCents >= creditor.appliedCents, 'priority order must hold');
  assert.ok(c.garnishmentCents <= c.disposableEarningsCents * 0.5 + 1, 'the shared ceiling binds the total');
});

test('what will not fit goes to ARREARS rather than vanishing or going negative', () => {
  const c = payrun.computeCheck(
    [reg(10, 1_500, 1)],
    [{ code: 'DUES', amountCents: 50_000 }],
    W4, OPTS);
  const dues = c.deductions.find((d) => d.code === 'DUES');
  assert.ok(dues.appliedCents < 50_000);
  assert.equal(dues.arrearsAddedCents, 50_000 - dues.appliedCents);
  assert.ok(c.netCents >= 0, 'a deduction may never drive the check negative');
  assert.match(c.warnings.join(' '), /arrears/i);
});

test('an annual cap and a carried arrears balance both bind the requested amount', () => {
  const capped = payrun.computeCheck([reg(40, 5_000, 1), reg(40, 5_000, 2)],
    [{ code: 'LOAN', amountCents: 50_000, annualLimitCents: 100_000, ytdCents: 90_000 }], W4, OPTS);
  assert.equal(capped.deductions.find((d) => d.code === 'LOAN').appliedCents, 10_000, 'only $100 of room left');
  const withArrears = payrun.computeCheck([reg(40, 5_000, 1), reg(40, 5_000, 2)],
    [{ code: 'DUES', amountCents: 2_500, arrearsCents: 5_000 }], W4, OPTS);
  assert.equal(withArrears.deductions.find((d) => d.code === 'DUES').appliedCents, 7_500,
    'this period plus the carried balance');
});

/* ── Safety ──────────────────────────────────────────────────────────────── */

test('an unknown earnings or deduction code is reported, never silently dropped', () => {
  const c = payrun.computeCheck([reg(40, 2_000, 1), reg(40, 2_000, 2), amt('NOPE', 5_000)],
    [{ code: 'MYSTERY', amountCents: 1_000 }], W4, OPTS);
  assert.match(c.warnings.join(' '), /Unknown earnings code\(s\) ignored: NOPE/);
  assert.match(c.warnings.join(' '), /Unknown deduction code\(s\) ignored: MYSTERY/);
  assert.equal(c.grossCents, 160_000, 'the unknown row contributed nothing');
});

test('the code catalog keeps its four taxability axes independent', () => {
  assert.deepEqual(codes.DEDUCTION_CODES.K401.reduces, { fit: true, fica: false, futa: false, state: true },
    'a deferral must stay FICA and FUTA wages');
  assert.deepEqual(codes.DEDUCTION_CODES.MED125.reduces, { fit: true, fica: true, futa: true, state: true });
  assert.deepEqual(codes.DEDUCTION_CODES.ROTH401.reduces, { fit: false, fica: false, futa: false, state: false });
  assert.equal(codes.DEDUCTION_CODES.ROTH401.countsToward402g, true);
  assert.deepEqual(codes.garnishmentCodesByPriority().map((g) => g.code),
    ['GARN_SUPPORT', 'GARN_LEVY', 'GARN_STUDENT', 'GARN_CREDITOR']);
});

test('CASH IDENTITY: what is paid equals cash earnings minus every withholding', () => {
  const c = payrun.computeCheck(
    [reg(38, 2_250, 1), reg(44, 2_250, 2), amt('COMM', 30_000), amt('GTL', 4_000), amt('REIMB', 5_000)],
    [{ code: 'MED125', amountCents: 15_000 }, { code: 'K401', percentOfGross: 5 },
     { code: 'GARN_CREDITOR', amountCents: 20_000 }, { code: 'DUES', amountCents: 2_500 }],
    W4, OPTS);
  const tax = c.taxes.fitCents + c.taxes.ssCents + c.taxes.medicareCents + c.taxes.addlMedicareCents + c.taxes.stateCents;
  const applied = c.deductions.reduce((a, d) => a + d.appliedCents, 0);
  assert.equal(c.netCents, c.cashEarningsCents + c.nontaxablePaidCents - tax - applied);
  assert.ok(c.netCents > 0);
});

/* ── structural guard against the "read back but never persisted" bug class ── */

test('every per-line INPUT the recompute reads back is actually PERSISTED', () => {
  // approveRun recomputes each line from its stored columns. Any input the
  // reader consults that the writer never stored silently reverts to its
  // default at approval — which is exactly how a discretionary bonus grew an
  // FLSA overtime premium nobody asked for.
  const store = require('../routes/payroll-store.js');
  const cols = store.LINE_COLUMNS;
  for (const col of ['hours', 'ot_hours', 'bonus_cents', 'tips_cents', 'reimbursement_cents',
    'prorate_pct', 'bonus_method', 'ot_flsa_qualified', 'bonus_is_discretionary']) {
    assert.ok(cols.includes(col), `${col} is read on recompute but is not in LINE_COLUMNS`);
  }
});
