"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Vendored from the ocean-lab geometry slice: one number formatter
 *                     |                             | for every text exporter. Handles the three things that bite CAD
 *                     |                             | text formats — JavaScript's `-0`, exponent notation, and
 *                     |                             | unbounded decimal tails — and rounds RELATIVE (significant
 *                     |                             | digits) so distinct vertices never weld onto one grid point.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SIGNIFICANT_DIGITS = exports.DEFAULT_DECIMALS = void 0;
exports.assertFinite = assertFinite;
exports.formatFloat = formatFloat;
exports.formatFixed = formatFixed;
/** @description Default significant decimals for fixed-width formats. */
exports.DEFAULT_DECIMALS = 6;
/**
 * @description Default significant digits for mesh coordinates. Twelve is comfortably inside
 * double precision so rounding is stable, and beyond float32, so the text formats never carry LESS
 * geometry than the binary STL of the same mesh.
 */
exports.DEFAULT_SIGNIFICANT_DIGITS = 12;
/** @description Largest magnitude `toFixed` can still expand without falling back to exponents. */
const MAX_PLAIN_MAGNITUDE = 1e21;
/**
 * @description Reject values a CAD file cannot represent, before every write, so a NaN from a bad
 * transform is caught at export rather than becoming a silent hole in the part.
 * @param value - Number to check.
 * @param label - What the number is, for the error message.
 * @returns The value, unchanged.
 * @throws RangeError when the value is NaN or infinite.
 */
function assertFinite(value, label) {
    if (!Number.isFinite(value)) {
        throw new RangeError(`${label} must be finite for export, received ${String(value)}`);
    }
    return value;
}
/**
 * @description Render a number in plain decimal, expanding the exponent notation `String()` reaches
 * for below 1e-6 — parsers that predate exponents drop `1e-7` or read it as 1.
 * @param value - Already-rounded number.
 * @param significant - Significant digits the value was rounded to.
 * @returns A plain decimal string with no trailing zeros.
 */
function plainDecimal(value, significant) {
    const direct = String(value);
    if (!direct.includes('e') && !direct.includes('E'))
        return direct;
    if (Math.abs(value) >= MAX_PLAIN_MAGNITUDE)
        return value.toFixed(0);
    const exponent = Math.floor(Math.log10(Math.abs(value)));
    const decimals = Math.min(100, Math.max(0, significant - 1 - exponent));
    return value.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
/**
 * @description Format for a text CAD file: rounded to significant digits, trailing zeros dropped,
 * never `-0`, never exponent notation. Pass `decimals` for absolute rounding instead.
 * @param value - Number to format.
 * @param decimals - Absolute decimal places to round to. Omit for relative rounding.
 * @returns A plain decimal string.
 * @throws RangeError when the value is not finite.
 */
function formatFloat(value, decimals) {
    assertFinite(value, 'Coordinate');
    if (value === 0)
        return '0';
    if (decimals !== undefined) {
        const fixed = Number(value.toFixed(decimals));
        return String(Object.is(fixed, -0) ? 0 : fixed);
    }
    const rounded = Number(value.toPrecision(exports.DEFAULT_SIGNIFICANT_DIGITS));
    if (rounded === 0)
        return '0';
    return plainDecimal(rounded, exports.DEFAULT_SIGNIFICANT_DIGITS);
}
/**
 * @description Format with the decimal places KEPT, for fixed-format readers and drawing labels.
 * @param value - Number to format.
 * @param decimals - Decimal places to emit. Default {@link DEFAULT_DECIMALS}.
 * @returns A fixed-width decimal string.
 * @throws RangeError when the value is not finite.
 */
function formatFixed(value, decimals = exports.DEFAULT_DECIMALS) {
    assertFinite(value, 'Coordinate');
    const safe = Object.is(value, -0) ? 0 : value;
    return safe.toFixed(decimals);
}
//# sourceMappingURL=format-number.js.map