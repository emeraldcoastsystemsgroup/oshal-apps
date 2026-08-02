"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.issue = issue;
exports.worstSeverity = worstSeverity;
exports.hasBlocker = hasBlocker;
exports.mergeIssues = mergeIssues;
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
function issue(code, severity, where, message, data) {
    return data === undefined
        ? { code, severity, where, message }
        : { code, severity, where, message, data };
}
const SEVERITY_ORDER = { info: 0, warn: 1, block: 2 };
/**
 * @description The worst severity present in a list.
 * @param issues - Issues to scan.
 * @returns The highest severity, or `'info'` for an empty list.
 */
function worstSeverity(issues) {
    let worst = 'info';
    for (const i of issues)
        if (SEVERITY_ORDER[i.severity] > SEVERITY_ORDER[worst])
            worst = i.severity;
    return worst;
}
/**
 * @description Whether any issue in a list blocks publication.
 * @param issues - Issues to scan.
 * @returns True when at least one issue has `block` severity.
 */
function hasBlocker(issues) {
    return issues.some((i) => i.severity === 'block');
}
/**
 * @description Flatten several issue lists into one, preserving order.
 * @param groups - Issue lists, possibly undefined.
 * @returns A single concatenated list.
 */
function mergeIssues(...groups) {
    const out = [];
    for (const g of groups)
        if (g)
            out.push(...g);
    return out;
}
//# sourceMappingURL=venture-issues.js.map