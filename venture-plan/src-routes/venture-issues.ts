/**
 * Venture engine — the issue model every computation module reports through.
 *
 * WHY A SHARED ISSUE TYPE RATHER THAN THROWING. Most of what goes wrong in a
 * venture model is not an error, it is a CONDITION the reader has to see: a
 * purchase quantity nobody quoted, a container that ships 60% full, a channel
 * that loses money per unit, a critical path that misses the season. Throwing
 * would hide the rest of the model; returning NaN would hide the condition. So
 * every engine returns its numbers AND its issues, and `severity: 'block'` is the
 * one that reaches all the way up to `model.canPublish === false`.
 *
 * A NOTE ON THE NAME. Design C called this file `venture-types.ts`. It ships as
 * `venture-issues.ts` because the app's route/store layer owns a `venture-types.ts`
 * with an unrelated shape, and two modules of the same name in one `src-routes/`
 * would silently overwrite each other at build time.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the closed VentureIssueCode union, the VentureIssue record carrying severity/where/data, and the severity helpers. Kept in its own module so every engine can import it without a cycle.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | Added `reconciliation-residual` and `landed-cash-mismatch` — the two blocking conditions that catch a cost the model spends in one statement and not the other.
 *
 * @module venture-issues
 */

/**
 * Every condition the engine can surface. Deliberately a CLOSED union: a new
 * failure mode has to be named here before any module can report it, which is
 * what stops "something went wrong" strings accumulating in a document.
 */
export type VentureIssueCode =
  // BOM
  | 'below-lowest-price-break'
  | 'above-highest-price-break'
  | 'moq-overbuy'
  | 'supplier-unqualified'
  | 'bom-cycle'
  // Landed cost
  | 'lcl-minimum-chargeable'
  | 'seller-paid-leg'
  | 'customs-basis-assumed'
  | 'partial-container'
  | 'fee-table-stale'
  // Channels
  | 'negative-contribution'
  | 'unreachable-target-margin'
  | 'cost-dependent-fee-rejected'
  | 'invalid-channel-rate'
  // Demand
  | 'no-elasticity-assumption'
  | 'price-outside-elasticity-support'
  | 'invalid-elasticity'
  | 'zero-volume'
  // Schedule
  | 'critical-path-misses-window'
  | 'sell-through-renormalised'
  | 'oversold-inventory'
  // Financials
  | 'no-break-even'
  | 'break-even-crosscheck-diverged'
  | 'break-even-outside-bracket'
  | 'reconciliation-residual'
  | 'landed-cash-mismatch'
  // Provenance
  | 'unsourced-estimate'
  | 'model-confidence-downgraded'
  | 'unit-mismatch'
  // Inversion
  | 'non-monotone-inversion'
  | 'inversion-impossible'
  | 'rounding-residual';

/** How hard an issue bites. Only `block` can stop a document being published. */
export type VentureSeverity = 'info' | 'warn' | 'block';

/** One surfaced condition, with enough context for a reader to act on it. */
export interface VentureIssue {
  code: VentureIssueCode;
  /** `block` sets `model.canPublish = false` and the document renderer refuses. */
  severity: VentureSeverity;
  message: string;
  /** Module plus entity, e.g. `bom:comp-projector-module`. */
  where: string;
  data?: Record<string, number | string>;
}

/**
 * @description Build an issue record. A helper rather than object literals so the
 *   field order and shape stay identical everywhere, which matters because these
 *   records are compared in guards.
 * @param code - The named condition.
 * @param severity - How hard it bites.
 * @param where - Module plus entity identifier.
 * @param message - Human sentence stating the condition and its consequence.
 * @param data - Optional numeric/string context for a document or a chart.
 * @returns The issue record.
 */
export function issue(
  code: VentureIssueCode,
  severity: VentureSeverity,
  where: string,
  message: string,
  data?: Record<string, number | string>,
): VentureIssue {
  return data === undefined
    ? { code, severity, where, message }
    : { code, severity, where, message, data };
}

const SEVERITY_ORDER: Record<VentureSeverity, number> = { info: 0, warn: 1, block: 2 };

/**
 * @description The worst severity present in a list.
 * @param issues - Issues to scan.
 * @returns The highest severity, or `'info'` for an empty list.
 */
export function worstSeverity(issues: readonly VentureIssue[]): VentureSeverity {
  let worst: VentureSeverity = 'info';
  for (const i of issues) if (SEVERITY_ORDER[i.severity] > SEVERITY_ORDER[worst]) worst = i.severity;
  return worst;
}

/**
 * @description Whether any issue in a list blocks publication.
 * @param issues - Issues to scan.
 * @returns True when at least one issue has `block` severity.
 */
export function hasBlocker(issues: readonly VentureIssue[]): boolean {
  return issues.some((i) => i.severity === 'block');
}

/**
 * @description Flatten several issue lists into one, preserving order.
 * @param groups - Issue lists, possibly undefined.
 * @returns A single concatenated list.
 */
export function mergeIssues(...groups: Array<readonly VentureIssue[] | undefined>): VentureIssue[] {
  const out: VentureIssue[] = [];
  for (const g of groups) if (g) out.push(...g);
  return out;
}
