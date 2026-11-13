"use strict";
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve unknown money values without coercing null, blank text or missing components to zero.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.finiteAmount = finiteAmount;
exports.sumAmounts = sumAmounts;
exports.roundAmount = roundAmount;
/** A finite reported amount, or unknown. Zero is a reported amount. */
function finiteAmount(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** A total is known only when every required component is known. */
function sumAmounts(values) {
    let total = 0;
    for (const value of values) {
        const amount = finiteAmount(value);
        if (amount === null)
            return null;
        total += amount;
    }
    return finiteAmount(total);
}
/** Retain the established cents rounding only for known amounts. */
function roundAmount(value) {
    return value === null ? null : Math.round(value * 100) / 100;
}
//# sourceMappingURL=finance-values.js.map