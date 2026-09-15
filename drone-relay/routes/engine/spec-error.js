"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The one refusal the engine raises for untrusted input: it names
 *                     |                             | the field so a route answers 400 with it and an iterating
 *                     |                             | caller fixes that field rather than guessing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpecError = void 0;
exports.numberIn = numberIn;
/** @description A refused input, naming the field. */
class SpecError extends Error {
    field;
    constructor(field, message) {
        super(message);
        this.name = 'SpecError';
        this.field = field;
    }
}
exports.SpecError = SpecError;
/**
 * @description Read a finite number in a closed range, or refuse naming the field.
 * @param value - Untrusted value (a missing value takes the fallback).
 * @param field - Field name for the refusal.
 * @param min - Inclusive minimum.
 * @param max - Inclusive maximum.
 * @param fallback - Used when the value is undefined or null.
 * @returns The number.
 */
function numberIn(value, field, min, max, fallback) {
    if (value === undefined || value === null)
        return fallback;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n))
        throw new SpecError(field, `${field} must be a number`);
    if (n < min || n > max)
        throw new SpecError(field, `${field} must be between ${min} and ${max}`);
    return n;
}
//# sourceMappingURL=spec-error.js.map