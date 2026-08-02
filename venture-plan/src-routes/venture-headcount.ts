/**
 * Venture engine — headcount cost at plan altitude.
 *
 * THE BOUNDARY THIS MODULE DOES NOT CROSS. The payroll package in this same store
 * computes what an employee ACTUALLY costs: real tax tables, real wage bases, real
 * pre-tax classes. This module does not, and must never be read as if it did. It
 * applies ONE labelled burden rate to a base salary because at planning altitude —
 * "can this venture afford three people from month four?" — the answer does not
 * turn on the third decimal of a FUTA credit reduction. `burdenBps` is an
 * assumption like any other: it carries a source, it appears in the ledger, and it
 * sweeps.
 *
 * WHOLE-MONTH CHARGING IS A STATED POLICY, not an oversight. A hire that starts on
 * the 20th costs the whole month here. Day-proration at plan altitude implies a
 * precision the rest of the model does not have.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — fully-loaded monthly cost per role with the employee/contractor burden split, one-time recruiting charged in the start month, whole-month charging, peak FTE and the month it falls in.
 *
 * @module venture-headcount
 */

import { type VentureIssue } from './venture-issues';
import {
  addMicros, applyBps, divMicros, scaleMicros, ymCompare, type Bps, type Micros, type Ratio, type YearMonth,
} from './venture-primitives';

/** One planned role. */
export interface Role {
  id: string;
  title: string;
  kind: 'employee' | 'contractor';
  startMonth: YearMonth;
  /** Inclusive last month; absent means through the end of the horizon. */
  endMonth?: YearMonth;
  annualBaseMicros: Micros;
  fteRatio: Ratio;
  /**
   * Employer burden as basis points of base. PLAN ALTITUDE ONLY — a labelled
   * assumption, not a payroll computation. Ignored for contractors.
   */
  burdenBps: Bps;
  oneTimeRecruitMicros?: Micros;
  assumptionRefs: string[];
}

/** Monthly headcount cost across the horizon. */
export interface HeadcountResult {
  byMonth: Record<YearMonth, { fte: number; costMicros: Micros; roleIds: string[] }>;
  totalMicros: Micros;
  peakFte: number;
  peakFteMonth: YearMonth | null;
  issues: VentureIssue[];
  assumptionRefs: string[];
}

/**
 * @description The fully-loaded monthly cost of one role: base x (1 + burden) x
 *   FTE, divided into twelve. Contractors carry no employer burden by definition.
 * @param r - The role.
 * @returns Monthly cost in micros.
 */
export function roleMonthlyMicros(r: Role): Micros {
  const fte = Math.max(0, Number.isFinite(r.fteRatio) ? r.fteRatio : 0);
  const burden = r.kind === 'employee' ? Math.max(0, r.burdenBps) : 0;
  const loadedAnnual = addMicros(r.annualBaseMicros, applyBps(r.annualBaseMicros, burden));
  return scaleMicros(divMicros(loadedAnnual, 12) ?? 0, fte);
}

/**
 * @description Whether a role is on the payroll in a given month.
 * @param r - The role.
 * @param month - The month key.
 * @returns True when the month is within the role's start and end.
 */
export function roleActiveIn(r: Role, month: YearMonth): boolean {
  if (ymCompare(month, r.startMonth) < 0) return false;
  return !r.endMonth || ymCompare(month, r.endMonth) <= 0;
}

/**
 * @description Monthly fully-loaded headcount cost across a horizon, plus the
 *   peak FTE and the month it falls in — the figure a funding conversation opens
 *   with.
 * @param roles - The planned roles.
 * @param horizon - The months to compute, ascending.
 * @returns Cost and FTE by month, the total, the peak, and the assumption references.
 */
export function computeHeadcount(roles: readonly Role[], horizon: readonly YearMonth[]): HeadcountResult {
  const byMonth: HeadcountResult['byMonth'] = {};
  let peakFte = 0;
  let peakFteMonth: YearMonth | null = null;
  for (const month of horizon) {
    const active = roles.filter((r) => roleActiveIn(r, month));
    const fte = active.reduce((a, r) => a + Math.max(0, r.fteRatio), 0);
    const recruiting = roles
      .filter((r) => r.startMonth === month && r.oneTimeRecruitMicros)
      .map((r) => r.oneTimeRecruitMicros as Micros);
    const costMicros = addMicros(...active.map(roleMonthlyMicros), ...recruiting);
    byMonth[month] = { fte, costMicros, roleIds: active.map((r) => r.id) };
    if (fte > peakFte) {
      peakFte = fte;
      peakFteMonth = month;
    }
  }
  return {
    byMonth,
    totalMicros: addMicros(...horizon.map((m) => byMonth[m]?.costMicros ?? 0)),
    peakFte,
    peakFteMonth,
    issues: [],
    assumptionRefs: [...new Set(roles.flatMap((r) => r.assumptionRefs))].sort(),
  };
}
