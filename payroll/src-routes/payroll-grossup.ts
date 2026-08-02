/**
 * Gross-up — solve for the gross that yields a target NET.
 *
 * Every payroll system has this and it is not optional in practice: an employer
 * who promises "a $1,000 bonus, in hand" owes the tax on top, and computing that
 * by hand is where people get it wrong. The employer is paying the employee's
 * tax, so the gross must be larger by exactly the amount of tax the larger gross
 * itself creates — a fixed-point problem, not a division.
 *
 * WHY NOT THE CLOSED FORM. The usual shortcut is `gross = net / (1 - totalRate)`
 * with a flat supplemental rate. It is wrong whenever the check crosses the
 * Social Security wage base or the additional-Medicare threshold, because the
 * marginal rate CHANGES mid-solve — the function is piecewise, and a single
 * divide silently lands on the wrong piece. It is also wrong under the aggregate
 * method, where the progressive brackets apply.
 *
 * SO: BISECTION over integer cents. net(gross) is monotonically non-decreasing
 * (no marginal rate here reaches 100%), which is exactly the property bisection
 * needs, and it is indifferent to how many pieces the function has. We search for
 * the smallest gross whose net reaches the target — deliberately rounding in the
 * EMPLOYEE's favour when integer-cent rounding makes the target unreachable
 * exactly, and reporting that we did.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-01 18:15:00 | maintainer@emeraldcoastsystemsgroup.com | Initial — integer-cent bisection gross-up over the real computeCheck, so wage-base and additional-Medicare crossings are handled by construction rather than by a marginal-rate assumption; reports the achieved net and whether it landed exactly.
 *
 * @module payroll-grossup
 */

import { computeCheck, type DeductionRow, type EarningRow, type PayCheck } from './payroll-payrun';
import type { W4Profile } from './payroll-engine';

/** The options computeCheck needs, passed straight through. */
type CheckOpts = Parameters<typeof computeCheck>[3];

/** The outcome of a gross-up solve. */
export interface GrossUpResult {
  /** The gross to pay under `earningsCode` to land on the target net. */
  grossCents: number;
  /** The net that gross actually produces. */
  achievedNetCents: number;
  /** True when achievedNet === targetNet to the cent. */
  exact: boolean;
  /** The full check at the solved gross. */
  check: PayCheck;
  /** Iterations used — surfaced so a pathological case is visible, not hidden. */
  iterations: number;
  warnings: string[];
}

/**
 * @description Solve for the gross earnings amount that produces a target net.
 *
 * @param targetNetCents - The net the employee must receive.
 * @param code - The earnings code to pay the grossed-up amount under (e.g. BONUS_D).
 * @param baseEarnings - Other earnings already on the check; the solve is on top of them.
 * @param deductions - Deduction rows to apply.
 * @param w4 - The employee's W-4 profile.
 * @param opts - The same options computeCheck takes.
 * @returns The solved gross, the achieved net, and the resulting check.
 */
export function grossUp(
  targetNetCents: number,
  code: string,
  baseEarnings: EarningRow[],
  deductions: DeductionRow[],
  w4: W4Profile,
  opts: CheckOpts,
): GrossUpResult {
  const warnings: string[] = [];
  const target = Math.max(0, Math.trunc(Number(targetNetCents) || 0));

  const at = (grossCents: number): PayCheck => computeCheck(
    [...baseEarnings, { code, hours: 0, rateCents: 0, amountCents: grossCents, workweek: 1 }],
    deductions, w4, opts);

  const baseline = computeCheck(baseEarnings, deductions, w4, opts);
  const baselineNet = baseline.netCents;
  const needed = target - baselineNet;
  if (needed <= 0) {
    return {
      grossCents: 0, achievedNetCents: baselineNet, exact: baselineNet === target,
      check: baseline, iterations: 0,
      warnings: ['The check already meets or exceeds the target net without any grossed-up amount.'],
    };
  }

  // Bracket the answer. The gross can never need to exceed the needed net divided
  // by a very small residual rate; doubling from the needed amount finds a bound
  // in a handful of steps and never assumes a marginal rate.
  let lo = 0;
  let hi = Math.max(1, needed);
  let iterations = 0;
  while (at(hi).netCents < target) {
    lo = hi;
    hi *= 2;
    iterations += 1;
    if (iterations > 60) {
      warnings.push('Gross-up could not bracket the target — deductions may be consuming the entire increase.');
      const check = at(hi);
      return { grossCents: hi, achievedNetCents: check.netCents, exact: false, check, iterations, warnings };
    }
  }

  // Smallest gross whose net reaches the target.
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    iterations += 1;
    if (at(mid).netCents >= target) hi = mid; else lo = mid + 1;
    if (iterations > 200) break; // defensive; bisection over cents converges long before this
  }

  const check = at(lo);
  const exact = check.netCents === target;
  if (!exact) {
    warnings.push(`Integer-cent rounding makes ${target} unreachable exactly; the smallest gross that reaches or exceeds it yields ${check.netCents}, which favours the employee.`);
  }
  return { grossCents: lo, achievedNetCents: check.netCents, exact, check, iterations, warnings };
}
