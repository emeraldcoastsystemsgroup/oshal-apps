/**
 * Payroll engine suite — known-value checks against the COMPILED engine
 * (routes/payroll-engine.js — the same bytes the framework mounts).
 * Dependency-free plain node:test; no framework, no DB.
 *
 * Expected numbers are hand-derived from the primary sources cited in
 * payroll-tax-tables.ts. If a constant or the math drifts, a check here goes red
 * with the exact dollar delta.
 *
 * The IRS-EQUIVALENCE tests are the load-bearing ones: they prove the engine's
 * simplified formulation reproduces Pub 15-T Worksheet 1A exactly, in both W-4
 * modes, so nobody has to take that claim on faith.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 23:30:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — bracket math, gross, SS cap crossing, additional Medicare, pre-tax class split, Step 2, credits, FUTA/SUTA caps, gross↔net identity.
 * 2026-08-01 11:30:00 | maintainer@emeraldcoastsystemsgroup.com | v1.1 — Pub 15-T Worksheet 1A equivalence proofs (standard + Step 2, against the published schedules); 402(g) cap incl. catch-up tiers; supplemental flat 22% and mandatory 37% over $1M; W-4 exemption stops FIT but never FICA; cash tips taxable + W-2 TP accumulator; qualified-overtime PREMIUM isolation (box 12 TT) incl. the non-FLSA case; salary proration; FUTA credit-reduction add-on; state none/flat/manual paths; hostile-input hardening; warnings surfaced.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../routes/payroll-engine.js');
const tables = require('../routes/payroll-tax-tables.js');
const stateTax = require('../routes/payroll-state-tax.js');

const BASE_W4 = {
  filingStatus: 'single', step2: false, dependentsCreditCents: 0, otherIncomeCents: 0,
  deductionsCents: 0, extraWithholdingCents: 0, exempt: false,
};
const FL = { code: 'FL', manualRatePct: 0, allowances: 0 };
const BASE_COMP = {
  compType: 'salary', annualSalaryCents: 0, hourlyRateCents: 0, k401Pct: 0, rothPct: 0,
  healthPerPeriodCents: 0, otherPostTaxCents: 0, garnishmentCents: 0, age: null, state: FL, w4: BASE_W4,
};
const NO_INPUT = {
  hours: 0, otHours: 0, bonusCents: 0, tipsCents: 0, reimbursementCents: 0,
  proratePct: 100, bonusMethod: 'aggregate', otIsFlsaQualified: true, bonusIsDiscretionary: false,
};
const NO_YTD = { taxableWagesCents: 0, deferralCents: 0, supplementalWagesCents: 0 };
const NO_SUTA = { sutaRatePct: 0, sutaWageBaseCents: 0, futaCreditReductionPct: 0, minimumWageCents: 725 };
const FL_SUTA = { sutaRatePct: 2.7, sutaWageBaseCents: 700_000, futaCreditReductionPct: 0, minimumWageCents: 725 };

/* ── IRS equivalence — the claims that must never be taken on faith ──────── */

test('IRS EQUIVALENCE: Pub 15-T standard schedule, single, $50,000', () => {
  // Worksheet 1A: 50,000 − 8,600 (line 1g) = 41,400 adjusted annual wage.
  // Standard single schedule row 19,900–57,900: 1,240 + 12% × 21,500 = $3,820.
  const got = engine.federalWithholdingCents(5_000_000, BASE_W4, 1);
  assert.equal(got, 382_000, 'must equal the Pub 15-T published-schedule result to the cent');
});

test('IRS EQUIVALENCE: Pub 15-T Step-2-checkbox schedule, single, $50,000', () => {
  // Step-2 schedule row 33,250–60,900: 2,900 + 22% × 16,750 = $6,585.
  const got = engine.federalWithholdingCents(5_000_000, { ...BASE_W4, step2: true }, 1);
  assert.equal(got, 658_500, 'the halved-threshold construction IS the IRS Step-2 schedule');
});

test('IRS EQUIVALENCE: line 1g + the schedule 0% band = the standard deduction', () => {
  // The identity that makes the engine's simpler formulation legitimate.
  assert.equal(tables.W4_LINE_1G_OTHER_CENTS + 750_000, tables.STANDARD_DEDUCTION_CENTS.single);
  assert.equal(tables.W4_LINE_1G_MARRIED_CENTS + 1_930_000, tables.STANDARD_DEDUCTION_CENTS.married);
  assert.equal(tables.W4_LINE_1G_OTHER_CENTS + 1_555_000, tables.STANDARD_DEDUCTION_CENTS.hoh);
});

test('bracket math: zero or negative taxable → zero tax', () => {
  assert.equal(engine.bracketTaxCents(0, tables.FEDERAL_BRACKETS.single, 1), 0);
  assert.equal(engine.bracketTaxCents(-500_000, tables.FEDERAL_BRACKETS.single, 1), 0);
  assert.equal(engine.bracketTaxCents(NaN, tables.FEDERAL_BRACKETS.single, 1), 0);
});

/* ── Core paycheck ───────────────────────────────────────────────────────── */

test('salary single biweekly $104,000 — exact FIT / SS / Medicare / net', () => {
  const p = engine.computePaycheck({ ...BASE_COMP, annualSalaryCents: 10_400_000 }, NO_INPUT, 26, NO_YTD, NO_SUTA);
  assert.equal(p.grossCents, 400_000);
  assert.equal(p.fitCents, 54_038);
  assert.equal(p.ssCents, 24_800);
  assert.equal(p.medicareCents, 5_800);
  assert.equal(p.addlMedicareCents, 0);
  assert.equal(p.netCents, 400_000 - 54_038 - 24_800 - 5_800);
  assert.deepEqual(p.warnings, []);
});

test('hourly gross: 80h at $20 + 5 OT hours at time-and-a-half', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 2_000 },
    { ...NO_INPUT, hours: 80, otHours: 5 }, 26, NO_YTD, NO_SUTA);
  assert.equal(p.regularCents, 160_000);
  assert.equal(p.overtimeCents, 15_000);
  assert.equal(p.grossCents, 175_000);
});

test('Social Security stops at the wage base — cap crossing mid-check', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 2_600_000 }, NO_INPUT, 26,
    { ...NO_YTD, taxableWagesCents: 18_400_000 }, NO_SUTA);
  assert.equal(p.ssTaxableCents, 50_000);
  assert.equal(p.ssCents, 3_100);
  assert.equal(p.employer.ssCents, 3_100);
  assert.equal(p.medicareCents, 1_450, 'Medicare never caps');
});

test('additional Medicare 0.9% on the newly-crossed slice, no employer match', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 2_600_000 }, NO_INPUT, 26,
    { ...NO_YTD, taxableWagesCents: 19_950_000 }, NO_SUTA);
  assert.equal(p.addlMedicareCents, 450);
  assert.equal(p.employer.medicareCents, 1_450, 'employer does NOT match the additional 0.9%');
});

test('pre-tax classes split correctly: Sec-125 exempt from FICA, 401(k) not', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000, k401Pct: 5, healthPerPeriodCents: 10_000 },
    NO_INPUT, 26, NO_YTD, NO_SUTA);
  assert.equal(p.healthCents, 10_000);
  assert.equal(p.k401Cents, 20_000);
  assert.equal(p.ficaTaxableCents, 390_000, 'gross − health only');
  assert.equal(p.fitTaxableCents, 370_000, 'gross − health − deferral');
});

/* ── v1.1: 402(g) deferral ceiling ───────────────────────────────────────── */

test('402(g): deferral is capped at the annual limit, and says so', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 52_000_000, k401Pct: 50 }, NO_INPUT, 26,
    { ...NO_YTD, deferralCents: 2_440_000 }, NO_SUTA);
  assert.equal(p.k401Cents, 10_000, 'only $100 of room remained under the $24,500 limit');
  assert.match(p.warnings.join(' '), /402\(g\)/);
});

test('402(g): catch-up tiers by age (50+ vs the SECURE 2.0 60–63 band)', () => {
  assert.equal(tables.deferralLimitCents(null), 2_450_000);
  assert.equal(tables.deferralLimitCents(49), 2_450_000);
  assert.equal(tables.deferralLimitCents(50), 2_450_000 + 800_000);
  assert.equal(tables.deferralLimitCents(61), 2_450_000 + 1_125_000);
  assert.equal(tables.deferralLimitCents(64), 2_450_000 + 800_000, '64 drops back to the standard catch-up');
});

/* ── v1.1: supplemental wages ────────────────────────────────────────────── */

test('supplemental flat method withholds 22% on the bonus, not the aggregate rate', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000 },
    { ...NO_INPUT, bonusCents: 500_000, bonusMethod: 'flat' }, 26, NO_YTD, NO_SUTA);
  assert.equal(p.supplementalFitCents, 110_000, '22% of $5,000');
  assert.equal(p.fitTaxableCents, 400_000, 'the bonus leaves the percentage-method base');
});

test('supplemental: mandatory 37% applies only above the $1M annual threshold', () => {
  assert.equal(engine.supplementalWithholdingCents(100_000_000, 0), 22_000_000);
  // $200k more once $1M is already paid → all at 37%.
  assert.equal(engine.supplementalWithholdingCents(20_000_000, 100_000_000), 7_400_000);
  // Straddle: $100k when $950k already paid → $50k at 22%, $50k at 37%.
  assert.equal(engine.supplementalWithholdingCents(10_000_000, 95_000_000), 1_100_000 + 1_850_000);
});

test('aggregate method (the default) leaves the bonus in the regular base', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000 },
    { ...NO_INPUT, bonusCents: 500_000 }, 26, NO_YTD, NO_SUTA);
  assert.equal(p.supplementalFitCents, 0);
  assert.equal(p.fitTaxableCents, 900_000);
});

/* ── v1.1: OBBBA / TY2026 reporting accumulators ─────────────────────────── */

test('qualified overtime is the PREMIUM only (box 12 TT), never the full 1.5x', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 2_000 },
    { ...NO_INPUT, hours: 80, otHours: 10 }, 26, NO_YTD, NO_SUTA);
  assert.equal(p.overtimeCents, 30_000, 'paid at time-and-a-half');
  assert.equal(p.qualifiedOvertimeCents, 10_000, 'reportable premium is the 0.5x half only');
  assert.equal(p.qualifiedOvertimeCents, p.overtimeCents / 3, 'the IRS divide-by-3 rule for 1.5x OT');
});

test('overtime not required by FLSA is NOT qualified, though still paid and taxed', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 2_000 },
    { ...NO_INPUT, hours: 80, otHours: 10, otIsFlsaQualified: false }, 26, NO_YTD, NO_SUTA);
  assert.equal(p.overtimeCents, 30_000);
  assert.equal(p.qualifiedOvertimeCents, 0);
});

test('cash tips are fully taxable — OBBBA relief is a 1040 deduction, not a payroll exclusion', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 2_000 },
    { ...NO_INPUT, hours: 40, tipsCents: 30_000 }, 26, NO_YTD, NO_SUTA);
  assert.equal(p.tipsCents, 30_000);
  assert.equal(p.grossCents, 110_000);
  assert.equal(p.ficaTaxableCents, 110_000, 'tips are FICA wages');
  assert.equal(p.medicareCents, Math.round(110_000 * 0.0145));
});

test('W-4 exemption stops federal income tax but NEVER FICA', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000, w4: { ...BASE_W4, exempt: true } },
    NO_INPUT, 26, NO_YTD, NO_SUTA);
  assert.equal(p.fitCents, 0);
  assert.equal(p.ssCents, 24_800, 'Social Security is statutory and unaffected');
  assert.equal(p.medicareCents, 5_800);
  assert.match(p.warnings.join(' '), /exemption/i);
});

/* ── v1.1: proration, employer taxes, state ──────────────────────────────── */

test('salary proration pays a partial period for a mid-period hire', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000 }, { ...NO_INPUT, proratePct: 50 }, 26, NO_YTD, NO_SUTA);
  assert.equal(p.regularCents, 200_000, 'half of the $4,000 period salary');
});

test('FUTA and SUTA respect their own wage bases', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 2_600_000 }, NO_INPUT, 26,
    { ...NO_YTD, taxableWagesCents: 650_000 }, FL_SUTA);
  assert.equal(p.employer.futaCents, 300, '0.6% of the remaining $500');
  assert.equal(p.employer.sutaCents, 1_350, '2.7% of the remaining $500');
  const done = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 2_600_000 }, NO_INPUT, 26,
    { ...NO_YTD, taxableWagesCents: 800_000 }, FL_SUTA);
  assert.equal(done.employer.futaCents, 0);
  assert.equal(done.employer.sutaCents, 0);
});

test('FUTA credit reduction raises the employer rate above the 0.6% net', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 2_600_000 }, NO_INPUT, 26, NO_YTD,
    { ...FL_SUTA, futaCreditReductionPct: 1.2 });
  assert.equal(p.employer.futaCents, Math.round(100_000 * 0.018), '0.6% + 1.2% on the $1,000 of wages');
});

test('state: a no-wage-income-tax state withholds a KNOWN zero', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000, state: { code: 'FL', manualRatePct: 9, allowances: 0 } },
    NO_INPUT, 26, NO_YTD, NO_SUTA);
  assert.equal(p.stateCents, 0, 'a verified no-tax state ignores a stray manual rate');
  assert.equal(stateTax.stateSupport('FL').supported, true);
});

test('state: an unsupported state falls back to the manual rate and WARNS', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000, state: { code: 'ZZ', manualRatePct: 5, allowances: 0 } },
    NO_INPUT, 26, NO_YTD, NO_SUTA);
  assert.equal(p.stateCents, 20_000, '5% of the $4,000 FIT-taxable base');
  assert.match(p.warnings.join(' '), /no verified withholding table/i);
  const s = stateTax.stateSupport('ZZ');
  assert.equal(s.supported, false);
});

test('state: unsupported AND no manual rate is the LOUD case, never a silent zero', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000, state: { code: 'CA', manualRatePct: 0, allowances: 0 } },
    NO_INPUT, 26, NO_YTD, NO_SUTA);
  assert.equal(p.stateCents, 0);
  assert.match(p.warnings.join(' '), /ZERO state income tax was withheld/i,
    'withholding nothing for a state that taxes wages must never pass silently');
});

test('state: a researched-but-unshipped state explains WHY it is absent', () => {
  const s = stateTax.stateSupport('IN');
  assert.equal(s.supported, false);
  assert.match(s.note, /county income tax/i, 'the reason must be on the record, not a shrug');
  assert.ok(stateTax.unsupportedStates().some((u) => u.code === 'NC'));
});

test('state PA: flat 3.07% with no deduction at all', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000, state: { code: 'PA', manualRatePct: 0, allowances: 0 } },
    NO_INPUT, 26, NO_YTD, NO_SUTA);
  assert.equal(p.stateCents, Math.round(400_000 * 0.0307));
  assert.deepEqual(p.warnings, [], 'a verified state produces no coverage warning');
});

test('state IL: flat 4.95% with each allowance sheltering $2,925/yr', () => {
  const none = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000, state: { code: 'IL', manualRatePct: 0, allowances: 0 } },
    NO_INPUT, 26, NO_YTD, NO_SUTA);
  assert.equal(none.stateCents, Math.round(400_000 * 0.0495));
  const two = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000, state: { code: 'IL', manualRatePct: 0, allowances: 2 } },
    NO_INPUT, 26, NO_YTD, NO_SUTA);
  // (104,000 − 5,850) × 4.95% ÷ 26
  assert.equal(two.stateCents, Math.round(((10_400_000 - 585_000) * 0.0495) / 26));
});

test('state KY: the flat path HONORS the standard deduction (the over-withholding bug)', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000, state: { code: 'KY', manualRatePct: 0, allowances: 0 } },
    NO_INPUT, 26, NO_YTD, NO_SUTA);
  assert.equal(p.stateCents, Math.round(((10_400_000 - 336_000) * 0.035) / 26));
  assert.notEqual(p.stateCents, Math.round(400_000 * 0.035), 'ignoring the deduction would over-withhold');
});

test('state MO: the DOR worked example — $35,000/yr monthly, spouse works → $59.00', () => {
  // MO DOR 2026 formula, printed example: annual gross taxable $35,000, married
  // with a working spouse ($16,100 deduction), monthly payroll → $59.00 withheld.
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 3_500_000, state: { code: 'MO', manualRatePct: 0, allowances: 0 },
      w4: { ...BASE_W4, filingStatus: 'married', step2: true } },
    NO_INPUT, 12, NO_YTD, NO_SUTA);
  assert.equal(p.stateCents, 5_900, 'must match the DOR example to the dollar');
  assert.equal(p.stateCents % 100, 0, 'Missouri rounds withholding to whole dollars');
});

test('state MO: a non-working spouse gets the larger deduction and less tax', () => {
  const spouseWorks = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 3_500_000, state: { code: 'MO', manualRatePct: 0, allowances: 0 },
      w4: { ...BASE_W4, filingStatus: 'married', step2: true } }, NO_INPUT, 12, NO_YTD, NO_SUTA);
  const soleEarner = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 3_500_000, state: { code: 'MO', manualRatePct: 0, allowances: 0 },
      w4: { ...BASE_W4, filingStatus: 'married', step2: false } }, NO_INPUT, 12, NO_YTD, NO_SUTA);
  assert.ok(soleEarner.stateCents < spouseWorks.stateCents,
    'the $32,200 deduction must shelter more than the $16,100 one');
});

/* ── v1.1 audit fixes — each of these was a real defect ──────────────────── */

test('cash tips are WITHHELD ON but not PAID AGAIN — the employee already holds them', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 800 },
    { ...NO_INPUT, hours: 30, tipsCents: 60_000 }, 52, NO_YTD, NO_SUTA);
  assert.equal(p.grossCents, 84_000, 'tips are taxable wages, so they are in gross');
  assert.equal(p.tipsCreditedCents, 60_000);
  // The check must be cash wages minus ALL withholding — never cash wages plus tips.
  assert.equal(p.netCents, 84_000 - 60_000 - p.fitCents - p.ssCents - p.medicareCents - p.stateCents);
  assert.ok(p.netCents < 24_000, 'taxes on tips come out of the cash wages');
});

test('402(g) is a COMBINED pre-tax + Roth ceiling — a 50/50 split does not buy two limits', () => {
  // $150 of annual room left. The employee elects 0.5% pre-tax AND 0.5% Roth of a
  // $20,000 period — $100 each. Pre-tax fills first, Roth gets only the $50 left.
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 52_000_000, k401Pct: 0.5, rothPct: 0.5 },
    NO_INPUT, 26, { ...NO_YTD, deferralCents: tables.DEFERRAL_LIMIT_CENTS - 15_000 }, NO_SUTA);
  assert.equal(p.k401Cents, 10_000, 'pre-tax draws first');
  assert.equal(p.rothCents, 5_000, 'Roth gets only the remaining room');
  assert.equal(p.k401Cents + p.rothCents, 15_000, 'together they may not exceed the room');
  assert.match(p.warnings.join(' '), /COMBINED limit/i);
});

test('garnishment is clamped to the CCPA Title III ceiling, and says so', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 1_500, garnishmentCents: 90_000 },
    { ...NO_INPUT, hours: 80 }, 26, NO_YTD, NO_SUTA);
  const cap = engine.ccpaCapCents(p.disposableEarningsCents, 26);
  assert.equal(p.garnishmentCents, Math.round(cap));
  assert.ok(p.garnishmentCents < 90_000, 'the requested amount exceeded the legal ceiling');
  assert.match(p.warnings.join(' '), /CCPA/);
});

test('CCPA ceiling is the LESSER of 25% of disposable and the excess over 30x minimum wage', () => {
  // Weekly, disposable $300: 25% = $75; excess over 30 x $7.25 = $300 - $217.50 = $82.50 → $75 wins.
  assert.equal(Math.round(engine.ccpaCapCents(30_000, 52)), 7_500);
  // Weekly, disposable $250: 25% = $62.50; excess = $32.50 → the floor wins.
  assert.equal(Math.round(engine.ccpaCapCents(25_000, 52)), 3_250);
  // Below the floor entirely → nothing may be garnished.
  assert.equal(engine.ccpaCapCents(20_000, 52), 0);
});

test('a NONDISCRETIONARY bonus raises the FLSA regular rate and the overtime premium', () => {
  const base = { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 2_000 };
  const inputs = { ...NO_INPUT, hours: 40, otHours: 10, bonusCents: 20_000 };
  const nondis = engine.computePaycheck(base, inputs, 52, NO_YTD, NO_SUTA);
  const discretionary = engine.computePaycheck(
    base, { ...inputs, bonusIsDiscretionary: true }, 52, NO_YTD, NO_SUTA);
  // $200 bonus over 50 hours = $4/hr; the extra half-time premium on 10 OT hours = $20.
  assert.equal(nondis.grossCents - discretionary.grossCents, 2_000);
  assert.match(nondis.warnings.join(' '), /NONDISCRETIONARY/);
  assert.deepEqual(discretionary.warnings.filter((w) => /NONDISCRETIONARY/.test(w)), []);
});

test('hours beyond 40/week with no overtime recorded is flagged, not silently paid straight', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 2_000 },
    { ...NO_INPUT, hours: 80, otHours: 0 }, 26, NO_YTD, NO_SUTA);
  assert.deepEqual(p.warnings, [], '80 hours over a 2-week period is exactly straight time');
  const over = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 2_000 },
    { ...NO_INPUT, hours: 90, otHours: 0 }, 26, NO_YTD, NO_SUTA);
  assert.match(over.warnings.join(' '), /cannot be averaged across weeks/i);
});

test('a wage below the floor in force on the pay date is flagged', () => {
  const fl = { ...NO_SUTA, minimumWageCents: 1_500 };
  const under = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 1_350 },
    { ...NO_INPUT, hours: 80 }, 26, NO_YTD, fl);
  assert.match(under.warnings.join(' '), /below the 1500-cent minimum wage/i);
  const ok = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 1_500 },
    { ...NO_INPUT, hours: 80 }, 26, NO_YTD, fl);
  assert.deepEqual(ok.warnings, []);
});

test('the minimum-wage floor is effective-dated — Florida steps up on 2026-09-30', () => {
  assert.equal(tables.minimumWageCents('FL', '2026-09-29'), 1_400);
  assert.equal(tables.minimumWageCents('FL', '2026-09-30'), 1_500);
  assert.equal(tables.minimumWageCents('TX', '2026-09-30'), 725, 'no state schedule falls back to federal');
});

test('W-2 box 1 keeps flat-method supplemental wages instead of losing them', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, annualSalaryCents: 10_400_000 },
    { ...NO_INPUT, bonusCents: 500_000, bonusMethod: 'flat' }, 26, NO_YTD, NO_SUTA);
  assert.equal(p.supplementalTaxableCents, 500_000);
  assert.equal(p.fitTaxableCents + p.supplementalTaxableCents, p.grossCents,
    'reported wages must still add up to gross');
});

/* ── Hostile input + invariants ──────────────────────────────────────────── */

test('hostile inputs cannot reach the math (NaN / Infinity / negative / string)', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 2_000, k401Pct: -5, rothPct: 1e9 },
    { ...NO_INPUT, hours: NaN, otHours: -10, bonusCents: Infinity, tipsCents: 'abc', reimbursementCents: -1 },
    26, { taxableWagesCents: NaN, deferralCents: -1, supplementalWagesCents: undefined }, NO_SUTA);
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} must stay finite, got ${v}`);
  }
  assert.ok(p.grossCents >= 0);
  assert.ok(p.rothCents <= p.grossCents, 'a 1e9% Roth election cannot exceed gross');
});

test('a health premium larger than gross is clamped and warned, never negative', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 1_000, healthPerPeriodCents: 500_000 },
    { ...NO_INPUT, hours: 10 }, 26, NO_YTD, NO_SUTA);
  assert.equal(p.grossCents, 10_000);
  assert.equal(p.healthCents, 10_000);
  assert.equal(p.ficaTaxableCents, 0);
  assert.match(p.warnings.join(' '), /exceeded gross/i);
});

test('an underwater net is reported, not silently shipped', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 1_000, otherPostTaxCents: 999_999 },
    { ...NO_INPUT, hours: 10 }, 26, NO_YTD, NO_SUTA);
  assert.ok(p.netCents < 0);
  assert.match(p.warnings.join(' '), /negative/i);
});

test('identity: gross + reimbursement = net + every deduction and tax', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 3_555, k401Pct: 4, rothPct: 2,
      healthPerPeriodCents: 12_345, otherPostTaxCents: 777, age: 61,
      state: { code: 'ZZ', manualRatePct: 5 }, w4: { ...BASE_W4, filingStatus: 'hoh' } },
    { ...NO_INPUT, hours: 77.5, otHours: 3.25, bonusCents: 25_000, tipsCents: 4_000, reimbursementCents: 4_242 },
    26, NO_YTD, FL_SUTA);
  const back = p.netCents + p.tipsCreditedCents + p.healthCents + p.k401Cents + p.fitCents + p.ssCents +
    p.medicareCents + p.addlMedicareCents + p.stateCents + p.rothCents + p.otherPostTaxCents +
    p.garnishmentCents - p.reimbursementCents;
  assert.equal(back, p.grossCents);
});

test('identity holds under the flat supplemental method too', () => {
  const p = engine.computePaycheck(
    { ...BASE_COMP, compType: 'hourly', hourlyRateCents: 3_000, k401Pct: 6, healthPerPeriodCents: 9_000 },
    { ...NO_INPUT, hours: 80, otHours: 4, bonusCents: 150_000, bonusMethod: 'flat' }, 26, NO_YTD, FL_SUTA);
  const back = p.netCents + p.tipsCreditedCents + p.healthCents + p.k401Cents + p.fitCents + p.ssCents +
    p.medicareCents + p.addlMedicareCents + p.stateCents + p.rothCents + p.otherPostTaxCents +
    p.garnishmentCents - p.reimbursementCents;
  assert.equal(back, p.grossCents);
  assert.ok(p.supplementalFitCents > 0);
});
