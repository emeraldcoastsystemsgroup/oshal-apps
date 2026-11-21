/**
 * Garnishment orders suite — the compiled payroll-garnish allocator, both
 * engines that use it, and the routes that create orders and approve runs.
 * Every expected amount is derived by hand in the comment above it, from 15
 * U.S.C. 1673, 29 CFR 870.10-870.11, 31 CFR 285.11(i), 26 U.S.C. 6334 and IRS
 * Publication 1494 (Rev. 12-2025), all read on 2026-11-20.
 *
 * What these protect:
 *
 *  - A support order is held to ITS percentage, not to the 25 percent creditor
 *    limit (the defect: the shared room was the creditor limit).
 *  - Ceilings are cumulative: what an order with priority took counts against
 *    the next order's ceiling (29 CFR 870.11(b)(2)).
 *  - A federal levy takes take-home pay above the Publication 1494 exempt
 *    amount, and support entered before the levy comes first.
 *  - Where priority or allocation is law the package does not hold, the check
 *    is refused in words and approval stops.
 *  - Approval keeps a line built from earning rows on its own engine and moves
 *    each order's balance once the run is paid.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1                   | maintainer@emeraldcoastsystemsgroup.com | Backlog item 7: Publication 1494 table 1 cell by cell and its four worked examples, the statement-not-returned default and the year refusal; support at 50 and 60 percent; the four 29 CFR 870.11(b)(2) illustrations; the 870.10(b) 30-to-40-times band; 31 CFR 285.11(i) with health premiums and an order with priority; levy against take-home pay; support before and after a levy; every refusal; both engines; order creation; approval keeping earning-row lines, refusing with 409 and settling balances by election.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const here = path.dirname(fileURLToPath(import.meta.url));

const STUBS = {
  express: { Router: () => fakeRouter() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/features/personal-data': {
    isEncrypted: (v) => typeof v === 'string' && v.startsWith('enc:'),
    encryptField: async (_sub, v) => (v === null || v === undefined ? null : `enc:${v}`),
    decryptField: async (_sub, v) => (typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v),
  },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (b) => !!b && typeof b === 'object' && b.confirm === true,
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm: true.` }),
  },
};
function fakeRouter() {
  const routes = new Map();
  const reg = (m) => (p, h) => { routes.set(`${m} ${p}`, h); };
  return { routes, get: reg('get'), post: reg('post'), put: reg('put'), delete: reg('delete') };
}
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};
const { createPayrollRoutes } = require('../routes/payroll-routes.js');
const g = require('../routes/payroll-garnish.js');
const payrun = require('../routes/payroll-payrun.js');

const MIN_WAGE = 725; // 29 U.S.C. 206(a)(1)(C): $7.25
const ctx = (over) => ({
  payDate: '2026-06-05', periodsPerYear: 26, federalMinWageCents: MIN_WAGE,
  disposableCents: 100_000, healthPremiumCents: 0, cashCents: 100_000, voluntaryPostTaxCents: 0, ...over,
});
const support = (over) => ({ code: 'GARN_SUPPORT', label: 'Support A', amountCents: 0, supportCcpaPct: 50, servedOn: '2026-01-05', ...over });
const creditor = (over) => ({ code: 'GARN_CREDITOR', label: 'Writ B', amountCents: 0, servedOn: '2026-02-01', ...over });
const agency = (over) => ({ code: 'GARN_STUDENT', label: 'Agency C', amountCents: 0, servedOn: '2026-02-01', ...over });
const levy = (over) => ({
  code: 'GARN_LEVY', label: 'Levy D', amountCents: 0, servedOn: '2026-02-01',
  levy: { filingStatus: 'single', dependents: 0, additionalStandardDeductions: 0, balanceCents: 500_000 }, ...over,
});
const took = (r, label) => r.applied.find((a) => a.label === label).appliedCents;

/* ── Publication 1494 (Rev. 12-2025) ─────────────────────────────────────── */

/** Table 1 as printed, columns 0 to 5 dependents, copied from the PDF's text. */
const TABLE_1 = {
  single: { weekly: '309.62 411.54 513.46 615.38 717.30 819.22', biweekly: '619.23 823.08 1026.93 1230.78 1434.63 1638.48', semimonthly: '670.83 891.66 1112.49 1333.32 1554.15 1774.98', monthly: '1341.67 1783.34 2225.01 2666.68 3108.35 3550.02' },
  mfj: { weekly: '619.23 721.15 823.07 924.99 1026.91 1128.83', biweekly: '1238.46 1442.31 1646.16 1850.01 2053.86 2257.71', semimonthly: '1341.67 1562.50 1783.33 2004.16 2224.99 2445.82', monthly: '2683.33 3125.00 3566.67 4008.34 4450.01 4891.68' },
  hoh: { weekly: '464.42 566.34 668.26 770.18 872.10 974.02', biweekly: '928.85 1132.70 1336.55 1540.40 1744.25 1948.10', semimonthly: '1006.25 1227.08 1447.91 1668.74 1889.57 2110.40', monthly: '2012.50 2454.17 2895.84 3337.51 3779.18 4220.85' },
  mfs: { weekly: '309.62 411.54 513.46 615.38 717.30 819.22', biweekly: '619.23 823.08 1026.93 1230.78 1434.63 1638.48', semimonthly: '670.83 891.66 1112.49 1333.32 1554.15 1774.98', monthly: '1341.67 1783.34 2225.01 2666.68 3108.35 3550.02' },
};
const PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
const statement = (filingStatus, dependents, additionalStandardDeductions = 0) =>
  ({ filingStatus, dependents, additionalStandardDeductions, balanceCents: 1 });

test('Publication 1494 table 1: every printed cell for 0 to 5 dependents, four statuses, four pay periods', () => {
  let cells = 0;
  for (const [status, cols] of Object.entries(TABLE_1)) {
    for (const [col, row] of Object.entries(cols)) {
      row.split(' ').forEach((printed, n) => {
        const cents = Number(printed.replace('.', ''));
        assert.equal(g.levyExemptCents(statement(status, n), PERIODS[col], '2026-03-02'), cents, `${status} ${col} ${n}`);
        cells += 1;
      });
    }
  }
  assert.equal(cells, 96);
  // "More Than 5": "309.62 plus 101.92 for each dependent" → 7 dependents weekly single = 309.62 + 713.44 = $1,023.06.
  assert.equal(g.levyExemptCents(statement('single', 7), 52, '2026-03-02'), 102_306);
});

test("Publication 1494's own four examples", () => {
  // 1. Single, weekly, three dependents → $615.38.
  assert.equal(g.levyExemptCents(statement('single', 3), 52, '2026-03-02'), 61_538);
  // 2. The same, over 65, one additional standard deduction → $615.38 + $39.42 = $654.80.
  assert.equal(g.levyExemptCents(statement('single', 3, 1), 52, '2026-03-02'), 65_480);
  // 3. Married filing jointly, biweekly, two dependents → $1,646.16.
  assert.equal(g.levyExemptCents(statement('mfj', 2), 26, '2026-03-02'), 164_616);
  // 4. The same, over 65 with a blind spouse, two additional → $1,646.16 + $126.92 = $1,773.08.
  assert.equal(g.levyExemptCents(statement('mfj', 2, 2), 26, '2026-03-02'), 177_308);
});

test('a statement not returned is married filing separately with no dependents; another year is refused', () => {
  // IRM 5.11.5.4.1(1): "married filing separate with no dependents (zero)". Biweekly MFS 0 → $619.23,
  // even if dependents were typed in.
  assert.equal(g.levyExemptCents({ filingStatus: '', dependents: 3, additionalStandardDeductions: 1, balanceCents: 1 }, 26, '2026-03-02'), 61_923);
  // A 2025 levy with no new statement uses the 2025 table, which is not held.
  assert.throws(() => g.levyExemptCents(statement('single', 0), 26, '2025-11-03'), (err) => {
    assert.ok(err instanceof g.LevyTableError);
    assert.match(err.message, /Publication 1494 for 2025, and the table held here is for 2026/);
    return true;
  });
  // A new statement in 2026 moves it to the 2026 table (Pub 15 (2026), section 9).
  assert.equal(g.levyExemptCents({ ...statement('single', 0), statementOn: '2026-01-12' }, 26, '2025-11-03'), 61_923);
  // Table 2 lists two additional deductions at most for single.
  assert.throws(() => g.levyExemptCents(statement('single', 0, 3), 26, '2026-03-02'), /at most 2 additional/);
});

/* ── support, and the cumulative ceilings ────────────────────────────────── */

test('THE DEFECT: a support order takes its own 50 percent, not the 25 percent creditor limit', () => {
  // Disposable $1,000.00, order $550.00 at 50%: ceiling $500.00 → $500.00 withheld, $50.00 to arrears.
  // The old shared room was min(25%, excess over $435) = $250.00.
  const r = g.allocateGarnishments([support({ amountCents: 55_000 })], ctx());
  assert.equal(took(r, 'Support A'), 50_000);
  assert.equal(r.applied[0].shortfallCents, 5_000);
  // At 60% (not supporting another family) the same order is paid in full: $550.00 ≤ $600.00.
  assert.equal(took(g.allocateGarnishments([support({ amountCents: 55_000, supportCcpaPct: 60 })], ctx()), 'Support A'), 55_000);
});

test('29 CFR 870.11(b)(2)(iv): support taking 25 percent or more leaves an ordinary writ nothing', () => {
  // Support $300.00 at 60% → $300.00 (30%). Writ ceiling min($250.00, $1,000 − $435 = $565) = $250.00,
  // less $300.00 already taken → $0.
  const r = g.allocateGarnishments([creditor({ amountCents: 10_000 }), support({ amountCents: 30_000, supportCcpaPct: 60 })], ctx());
  assert.equal(r.applied[0].label, 'Support A', 'support is paid first (42 U.S.C. 666(b)(7))');
  assert.equal(took(r, 'Support A'), 30_000);
  assert.equal(took(r, 'Writ B'), 0);
  assert.equal(r.applied[1].shortfallCents, 10_000);
});

test('29 CFR 870.11(b)(2)(iii) the other way round: support at 10 percent leaves the writ 15 percent', () => {
  // Support $100.00 → writ ceiling $250.00 − $100.00 = $150.00 of the $500.00 asked.
  const r = g.allocateGarnishments([support({ amountCents: 10_000 }), creditor({ amountCents: 50_000 })], ctx());
  assert.equal(took(r, 'Writ B'), 15_000);
  assert.match(r.applied[1].reason, /1673\(a\) limit/);
});

test('29 CFR 870.11(b)(2)(i)-(ii): a levy ahead of support shrinks what support may take, to nothing past its percentage', () => {
  // Levy served 2026-02-01, support entered 2026-03-01 (after) → levy first.
  // Weekly single 0: exempt $309.62. Take-home $1,000.00 → levy $690.38 (69%).
  // Support 50% ceiling $500.00 − $690.38 → $0.
  const r = g.allocateGarnishments(
    [support({ amountCents: 20_000, enteredOn: '2026-03-01' }), levy()], ctx({ periodsPerYear: 52 }));
  assert.deepEqual(r.applied.map((a) => a.label), ['Levy D', 'Support A']);
  assert.equal(took(r, 'Levy D'), 69_038);
  assert.equal(took(r, 'Support A'), 0);
});

test('support ENTERED BEFORE the levy goes first and reduces the levy (26 U.S.C. 6334(a)(8))', () => {
  // Support $200.00 entered 2026-01-05, levy 2026-02-01. Levy = $1,000.00 − $200.00 − $309.62 = $490.38.
  const r = g.allocateGarnishments([levy(), support({ amountCents: 20_000, enteredOn: '2026-01-05' })], ctx({ periodsPerYear: 52 }));
  assert.deepEqual(r.applied.map((a) => a.label), ['Support A', 'Levy D']);
  assert.equal(took(r, 'Support A'), 20_000);
  assert.equal(took(r, 'Levy D'), 49_038);
  assert.equal(r.totalCents, 69_038);
});

test('a levy is not CCPA-limited, stops at its balance, and voluntary deductions in effect reduce take-home pay', () => {
  // Balance $100.00 < $690.38 available → $100.00.
  assert.equal(took(g.allocateGarnishments([levy({ levy: { ...levy().levy, balanceCents: 10_000 } })], ctx({ periodsPerYear: 52 })), 'Levy D'), 10_000);
  // $50.00 of union dues in effect when served: $1,000.00 − $50.00 − $309.62 = $640.38.
  const r = g.allocateGarnishments([levy()], ctx({ periodsPerYear: 52, voluntaryPostTaxCents: 5_000 }));
  assert.equal(took(r, 'Levy D'), 64_038);
  assert.match(r.warnings.join(' '), /IRM 5\.11\.5\.4\.5/);
});

/* ── the 30-times floor and the agency order ─────────────────────────────── */

test('29 CFR 870.10(b): between 30 and 40 times the minimum wage only the excess over 30 times may be taken', () => {
  // Weekly disposable $250.00: 30 × $7.25 = $217.50, 25% = $62.50 → $32.50.
  const r = g.allocateGarnishments([creditor({ amountCents: 10_000 })], ctx({ periodsPerYear: 52, disposableCents: 25_000, cashCents: 25_000 }));
  assert.equal(took(r, 'Writ B'), 3_250);
  // At or below $217.50 nothing may be taken.
  assert.equal(took(g.allocateGarnishments([creditor({ amountCents: 10_000 })], ctx({ periodsPerYear: 52, disposableCents: 21_750 })), 'Writ B'), 0);
  // Biweekly the floor is 2 × 30 × $7.25 = $435.00; semimonthly 52/24 weeks → $471.25 (870.10(c)).
  assert.equal(took(g.allocateGarnishments([creditor({ amountCents: 100_000 })], ctx({ periodsPerYear: 24, disposableCents: 50_000 })), 'Writ B'), 2_875);
});

test('31 CFR 285.11(i): 15 percent of disposable PAY (after health premiums), and 25 percent less an order with priority', () => {
  // Disposable earnings $1,000.00, health premiums $100.00 → disposable pay $900.00.
  // 15% order → $135.00 (excess over $435 is $465, so 15% binds).
  const alone = g.allocateGarnishments([agency({ orderPct: 15 })], ctx({ healthPremiumCents: 10_000 }));
  assert.equal(took(alone, 'Agency C'), 13_500);
  // Behind $200.00 of support: min($135.00, 25% × $900.00 − $200.00 = $25.00) → $25.00.
  const behind = g.allocateGarnishments([agency({ orderPct: 15 }), support({ amountCents: 20_000 })], ctx({ healthPremiumCents: 10_000 }));
  assert.equal(took(behind, 'Support A'), 20_000);
  assert.equal(took(behind, 'Agency C'), 2_500);
});

test('nothing is withheld beyond the cash on the check', () => {
  const r = g.allocateGarnishments([support({ amountCents: 40_000 })], ctx({ cashCents: 30_000 }));
  assert.equal(took(r, 'Support A'), 30_000);
  assert.equal(r.applied[0].reason, 'Not enough cash pay left on this check.');
});

/* ── refusals ─────────────────────────────────────────────────────────────── */

test('refusals: missing support percentage, missing dates beside a levy, unranked or tied non-support orders', () => {
  const noPct = g.allocateGarnishments([support({ supportCcpaPct: undefined, amountCents: 100 })], ctx());
  assert.match(noPct.refusals[0], /maximum percentage this support order may take/);
  assert.equal(noPct.totalCents, 0);

  const noEntered = g.allocateGarnishments([support({ amountCents: 100 }), levy()], ctx());
  assert.match(noEntered.refusals.join(' '), /date this support order was entered.*6334\(a\)\(8\)/);

  const unranked = g.allocateGarnishments([creditor({ amountCents: 100 }), agency({ amountCents: 100 })], ctx());
  assert.match(unranked.refusals[0], /set the order of priority for each.*29 CFR 870\.1\(a\)/);
  const tied = g.allocateGarnishments([creditor({ amountCents: 100, priorityRank: 1 }), agency({ amountCents: 100, priorityRank: 1 })], ctx());
  assert.equal(tied.refusals.length, 1);
  const ranked = g.allocateGarnishments([creditor({ amountCents: 100, priorityRank: 2 }), agency({ amountCents: 100, priorityRank: 1 })], ctx());
  assert.deepEqual(ranked.applied.map((a) => a.label), ['Agency C', 'Writ B'], 'the stated order is used');
});

test('two support orders that together ask for more than the ceiling are refused: allocation is state law', () => {
  // 50% of $1,000.00 = $500.00 < $300.00 + $300.00.
  const r = g.allocateGarnishments([support({ amountCents: 30_000 }), support({ label: 'Support E', amountCents: 30_000 })], ctx());
  assert.match(r.refusals[0], /666\(b\)\(6\)\(A\)\(i\)\(IV\)/);
  // Together within the ceiling both are paid.
  const fits = g.allocateGarnishments([support({ amountCents: 20_000 }), support({ label: 'Support E', amountCents: 20_000 })], ctx());
  assert.equal(fits.totalCents, 40_000);
});

test('a support order entered after a levy cannot also be ahead of a writ the person ranked before that levy', () => {
  const r = g.allocateGarnishments([
    support({ amountCents: 100, enteredOn: '2026-03-01' }), creditor({ amountCents: 100, priorityRank: 1 }), levy({ priorityRank: 2 }),
  ], ctx());
  assert.match(r.refusals[0], /entered after the levy/);
});

test('an order as entered: what each order must carry, in words', () => {
  assert.match(g.orderFactsFromInput('GARN_SUPPORT', { amountCents: 100 }).message, /date the order was served/);
  assert.match(g.orderFactsFromInput('GARN_SUPPORT', { amountCents: 100, servedOn: '2026-01-05' }).message, /most this support order may take/);
  assert.match(g.orderFactsFromInput('GARN_SUPPORT', { amountCents: 100, servedOn: '2026-01-05', supportCcpaPct: 70 }).message, /at most 65/);
  assert.match(g.orderFactsFromInput('GARN_STUDENT', { servedOn: '2026-01-05', orderPct: 20 }).message, /at most 15/);
  assert.match(g.orderFactsFromInput('GARN_LEVY', { servedOn: '2026-01-05' }).message, /amount the levy says is owed/);
  assert.match(g.orderFactsFromInput('GARN_LEVY', { servedOn: '2026-01-05', amountCents: 100, levyFilingStatus: 'hoh', levyAdditionalStd: 3 }).message, /from 0 to 2/);
  assert.match(g.orderFactsFromInput('GARN_CREDITOR', { servedOn: '2026-13-40', amountCents: 100 }).message, /must be a date/);
  const ok = g.orderFactsFromInput('GARN_LEVY', { servedOn: '2026-02-01', amountCents: 500_000, levyFilingStatus: 'mfj', levyDependents: 2 });
  assert.deepEqual([ok.facts.levyFilingStatus, ok.facts.levyDependents, ok.facts.servedOn], ['mfj', 2, '2026-02-01']);
});

/* ── both engines ────────────────────────────────────────────────────────── */

const W4 = { filingStatus: 'single', step2: false, dependentsCreditCents: 0, otherIncomeCents: 0, deductionsCents: 0, extraWithholdingCents: 0, exempt: false };
const OPTS = { periodsPerYear: 26, age: 40, state: { code: 'FL', manualRatePct: 0, allowances: 0 }, ytd: {}, employerTax: { sutaRatePct: 2.7, sutaWageBaseCents: 700_000, futaCreditReductionPct: 0 }, payDate: '2026-06-05' };
const reg = (hours, rateCents, workweek) => ({ code: 'REG', hours, rateCents, amountCents: 0, workweek });

test('the earning-row engine: a support order now takes more than 25 percent of disposable earnings', () => {
  const c = payrun.computeCheck([reg(40, 2_500, 1), reg(40, 2_500, 2)],
    [{ code: 'GARN_SUPPORT', amountCents: 150_000, supportCcpaPct: 60, servedOn: '2026-01-05' }], W4, OPTS);
  const s = c.deductions.find((d) => d.code === 'GARN_SUPPORT');
  // Held to 60% of the check's own disposable earnings, which is more than the old 25%.
  assert.equal(s.appliedCents, Math.floor(c.disposableEarningsCents * 0.6));
  assert.ok(s.appliedCents > c.disposableEarningsCents * 0.25);
  assert.deepEqual(c.garnishmentRefusals, []);
});

test('the earning-row engine reports refusals and withholds nothing it cannot compute', () => {
  const c = payrun.computeCheck([reg(40, 2_500, 1), reg(40, 2_500, 2)],
    [{ code: 'GARN_SUPPORT', amountCents: 10_000, servedOn: '2026-01-05' }], W4, OPTS);
  assert.equal(c.garnishmentCents, 0);
  assert.match(c.garnishmentRefusals[0], /maximum percentage/);
  assert.match(c.warnings.join(' '), /Garnishment not computed/);
});

test('the hours-and-rate engine: orders replace the single garnishment amount and net moves with them', () => {
  const check = {
    grossCents: 200_000, tipsCreditedCents: 0, healthCents: 0, k401Cents: 0, fitCents: 20_000, ssCents: 12_400,
    medicareCents: 2_900, addlMedicareCents: 0, stateCents: 0, rothCents: 0, otherPostTaxCents: 0,
    garnishmentCents: 5_000, disposableEarningsCents: 164_700, netCents: 159_700, warnings: [],
  };
  // Disposable $1,647.00; support $900.00 at 50% → ceiling $823.50 → $823.50.
  // Net = $1,597.00 + $50.00 (the single amount, no longer used) − $823.50 = $823.50.
  const elections = [{ electionId: 'el-1', code: 'GARN_SUPPORT', amountCents: 90_000, arrearsCents: 0, ytdCents: 0, supportCcpaPct: 50, servedOn: '2026-01-05' }];
  const out = g.applyOrdersToHoursCheck(check, elections, { periodsPerYear: 26, payDate: '2026-06-05', federalMinWageCents: MIN_WAGE });
  assert.equal(check.garnishmentCents, 82_350);
  assert.equal(check.netCents, 82_350);
  assert.equal(out.applied[0].electionId, 'el-1');
  assert.equal(out.applied[0].shortfallCents, 7_650);
  assert.match(check.warnings.join(' '), /single garnishment amount on this employee is not used/);
});

/* ── through the routes ──────────────────────────────────────────────────── */

function makePool(impl) {
  const pool = { calls: [] };
  pool.query = async (sql, params) => {
    pool.calls.push({ sql: String(sql), params });
    return impl ? impl(String(sql), params) : { rows: [], rowCount: 0 };
  };
  return pool;
}
function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.type = () => r; r.set = () => r; r.send = () => r; r.sendFile = () => r;
  return r;
}
const AUTHED = { oidc: { user: { sub: 'user-1' } } };
const EMP = '6b0f3c2e-8d1a-4e57-9b3c-2f4a5d6e7f81';
async function call(pool, method, route, req) {
  const h = createPayrollRoutes({ pool, appPackageDir: path.join(here, '..') }).routes.get(`${method} ${route}`);
  assert.ok(h, `route ${method} ${route} must be registered`);
  const res = makeRes();
  await h({ body: {}, params: {}, query: {}, ...req }, res);
  return res;
}
const writes = (pool) => pool.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql));

test('creating an order without the facts its limit depends on is refused, and nothing is written', async () => {
  const pool = makePool((sql) => (/FROM payroll_employees/.test(sql) ? { rows: [{ employee_id: EMP, user_sub: 'user-1' }], rowCount: 1 } : { rows: [], rowCount: 0 }));
  const res = await call(pool, 'post', '/employees/:id/deductions', { ...AUTHED, params: { id: EMP }, body: { code: 'GARN_SUPPORT', amountCents: 20_000, servedOn: '2026-01-05' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_order');
  assert.deepEqual(writes(pool), []);
});

test('an order with its facts is stored with them, owner-scoped, and audited', async () => {
  const pool = makePool((sql, params) => {
    if (/FROM payroll_employees/.test(sql)) return { rows: [{ employee_id: EMP, user_sub: 'user-1' }], rowCount: 1 };
    if (/INSERT INTO payroll_deduction_elections/.test(sql)) return { rows: [{ election_id: params[0], code: params[3] }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const res = await call(pool, 'post', '/employees/:id/deductions', { ...AUTHED, params: { id: EMP }, body: {
    code: 'GARN_LEVY', amountCents: 500_000, servedOn: '2026-02-01', levyFilingStatus: 'mfj', levyDependents: 2, priorityRank: 1 } });
  assert.equal(res.statusCode, 200);
  const insert = pool.calls.find((c) => /INSERT INTO payroll_deduction_elections/.test(c.sql));
  assert.equal(insert.params[1], 'user-1');
  assert.deepEqual(insert.params.slice(12), ['2026-02-01', null, 1, null, 'mfj', 2, 0, null]);
  assert.ok(pool.calls.some((c) => /INSERT INTO payroll_audit/.test(c.sql)), 'the order is on the audit trail');
});

test("correcting an order's facts updates only the caller's row for that employee, audited", async () => {
  const before = { election_id: 'el-9', employee_id: EMP, user_sub: 'user-1', code: 'GARN_CREDITOR' };
  const pool = makePool((sql) => {
    if (/SELECT \* FROM payroll_deduction_elections WHERE election_id/.test(sql)) return { rows: [before], rowCount: 1 };
    if (/UPDATE payroll_deduction_elections/.test(sql)) return { rows: [{ ...before, priority_rank: 2 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const res = await call(pool, 'put', '/employees/:id/deductions/:electionId/order', { ...AUTHED, params: { id: EMP, electionId: 'el-9' }, body: { amountCents: 10_000, servedOn: '2026-03-01', priorityRank: 2 } });
  assert.equal(res.statusCode, 200);
  const update = pool.calls.find((c) => /UPDATE payroll_deduction_elections/.test(c.sql));
  assert.match(update.sql, /WHERE election_id=\$1 AND user_sub=\$2/);
  const other = await call(pool, 'put', '/employees/:id/deductions/:electionId/order', { ...AUTHED, params: { id: 'someone-else', electionId: 'el-9' }, body: {} });
  assert.equal(other.statusCode, 404, 'an order is reached only through its own employee');
});

/** A pool for approving one run whose single line is the given line row. */
function approvalPool(line, elections) {
  return makePool((sql) => {
    if (/SELECT \* FROM payroll_runs .* FOR UPDATE/s.test(sql)) {
      return { rows: [{ run_id: 'r1', status: 'draft', kind: 'regular', pay_date: '2026-06-05', pay_frequency: 'biweekly', period_end: '2026-05-31' }], rowCount: 1 };
    }
    if (/FROM payroll_run_lines WHERE run_id/.test(sql)) return { rows: [line], rowCount: 1 };
    if (/FROM payroll_employees WHERE employee_id/.test(sql)) {
      return { rows: [{ employee_id: EMP, user_sub: 'user-1', first_name: 'Test', last_name: 'Person', comp_type: 'hourly', hourly_rate_cents: 2_500, filing_status: 'single', pay_method: 'check' }], rowCount: 1 };
    }
    if (/FROM payroll_line_earnings/.test(sql)) {
      return { rows: [{ code: 'REG', hours: 40, rate_cents: 2_500, amount_cents: 0, workweek: 1, memo: '' }, { code: 'REG', hours: 40, rate_cents: 2_500, amount_cents: 0, workweek: 2, memo: '' }], rowCount: 2 };
    }
    if (/FROM payroll_deduction_elections/.test(sql)) return { rows: elections, rowCount: elections.length };
    if (/payroll_company/.test(sql)) return { rows: [{ user_sub: 'user-1', pay_frequency: 'biweekly', state_code: 'FL' }], rowCount: 1 };
    if (/FROM payroll_line_deductions WHERE user_sub/.test(sql)) {
      return { rows: [{ employee_id: EMP, code: 'GARN_SUPPORT', applied_cents: 50_000, arrears_added_cents: 0, election_id: 'el-1' }], rowCount: 1 };
    }
    if (/UPDATE payroll_runs SET status = 'paid'/.test(sql)) return { rows: [{ run_id: 'r1', status: 'paid', pay_date: '2026-06-05' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
}
const SUPPORT_ROW = { election_id: 'el-1', code: 'GARN_SUPPORT', amount_cents: '50000', arrears_cents: '0', ytd_cents: '0', lifetime_cents: '0', support_ccpa_pct: '60', served_on: '2026-01-05', active: true };

test('approval keeps an EARNING-ROW line on its own engine and settles the order by election, after the flip', async () => {
  const pool = approvalPool({ run_id: 'r1', employee_id: EMP, uses_earning_rows: true, hours: 0, net_cents: 1 }, [SUPPORT_ROW]);
  const res = await call(pool, 'post', '/runs/:id/approve', { ...AUTHED, params: { id: 'r1' }, body: { confirm: true } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const line = pool.calls.find((c) => /INSERT INTO payroll_run_lines/.test(c.sql));
  assert.match(line.sql, /uses_earning_rows/, 'the earning-row engine wrote the line, not the hours-and-rate one');
  assert.ok(pool.calls.some((c) => /FROM payroll_line_earnings/.test(c.sql)), 'the earning rows were read');
  const flipAt = pool.calls.findIndex((c) => /UPDATE payroll_runs SET status = 'paid'/.test(c.sql));
  const settleAt = pool.calls.findIndex((c) => /UPDATE payroll_deduction_elections/.test(c.sql));
  assert.ok(settleAt > flipAt, 'balances move only once the run is paid');
  const settle = pool.calls[settleAt];
  assert.match(settle.sql, /election_id = \$3/);
  assert.deepEqual(settle.params, ['user-1', EMP, 'el-1', 50_000, 0]);
});

test('approval of an hours-and-rate line applies the orders and records the row for each, with its election', async () => {
  const pool = approvalPool({ run_id: 'r1', employee_id: EMP, uses_earning_rows: false, hours: 80, net_cents: 1 }, [SUPPORT_ROW]);
  const res = await call(pool, 'post', '/runs/:id/approve', { ...AUTHED, params: { id: 'r1' }, body: { confirm: true } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = pool.calls.find((c) => /INSERT INTO payroll_line_deductions/.test(c.sql));
  assert.ok(row, 'the order took something and that is recorded against the line');
  assert.equal(row.params[4], 'GARN_SUPPORT');
  assert.equal(row.params[9], 'el-1');
  assert.match(row.sql, /r\.status = 'draft'/, 'written only while the run is a draft');
});

test('approval REFUSES a run with a garnishment order it cannot compute: 409 in words, nothing marked paid', async () => {
  const noPct = { ...SUPPORT_ROW, support_ccpa_pct: null };
  for (const usesRows of [true, false]) {
    const pool = approvalPool({ run_id: 'r1', employee_id: EMP, uses_earning_rows: usesRows, hours: 80, net_cents: 1 }, [noPct]);
    const res = await call(pool, 'post', '/runs/:id/approve', { ...AUTHED, params: { id: 'r1' }, body: { confirm: true } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'garnishment_facts_missing');
    assert.match(res.body.message, /Test Person: .*maximum percentage this support order may take/);
    assert.ok(!pool.calls.some((c) => /UPDATE payroll_runs SET status = 'paid'/.test(c.sql)), 'the run stays a draft');
    assert.ok(!pool.calls.some((c) => /UPDATE payroll_deduction_elections/.test(c.sql)), 'no balance moves');
  }
});
