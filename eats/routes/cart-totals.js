"use strict";
/**
 * Order totals in integer cents — the ONE place an Eats order's money is added up.
 *
 * Why this exists: the order total used to be a floating-point reduce over whatever price each
 * stored cart line carried, and POST /cart/items stored the price the BROWSER sent. The total a
 * diner saw therefore depended on the request body, and summing dollars as floats can drift a
 * cent. Lines are now priced by the server from the restaurant's menu, and every total is summed
 * here in whole cents, so /cart, the chat's order proposal and the recorded hand-off all report
 * the same exact figure. Pure: no I/O and no framework imports, so a plain-node test and the
 * browser smoke fixture can load the compiled module directly. (Each store package is
 * self-contained, which is why Shopping carries its own twin of this module.)
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — integer-cent price parsing, order totals with an unpriced-line count, and exact two-decimal formatting shared by /cart, the chat order proposal and the order hand-off record.
 *
 * @module cart-totals
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LINE_QUANTITY = void 0;
exports.toCents = toCents;
exports.lineQuantity = lineQuantity;
exports.cartTotalCents = cartTotalCents;
exports.formatCents = formatCents;
exports.centsToDollars = centsToDollars;
/** Largest item price accepted as a real menu price (matches the NUMERIC(10,2) column). */
const MAX_UNIT_CENTS = 99_999_999;
/** Largest quantity one order line may carry (the add paths clamp to this too). */
exports.MAX_LINE_QUANTITY = 20;
/**
 * @description Parse one price (a number or the string PostgreSQL returns for NUMERIC) into
 * integer cents, rounding once at the boundary so float noise cannot leak into a sum.
 * @param value - The price in dollars.
 * @returns Whole cents, or null when the value is missing, not finite, negative or implausibly large.
 */
function toCents(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const dollars = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(dollars) || dollars < 0)
        return null;
    const cents = Math.round(dollars * 100);
    return cents <= MAX_UNIT_CENTS ? cents : null;
}
/**
 * @description Clamp a requested quantity to a whole number between 1 and MAX_LINE_QUANTITY.
 * @param value - The requested quantity (any shape).
 * @returns The quantity a line is stored and totalled with.
 */
function lineQuantity(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1)
        return 1;
    return Math.min(exports.MAX_LINE_QUANTITY, n);
}
/**
 * @description Add an order up in integer cents. A line without a usable price is counted in
 * `unpricedLines` rather than silently priced at zero.
 * @param lines - Stored cart lines (`price`, `quantity`).
 * @returns The exact total in cents with the priced/unpriced line counts.
 */
function cartTotalCents(lines) {
    let totalCents = 0;
    let pricedLines = 0;
    let unpricedLines = 0;
    for (const line of lines || []) {
        const unit = toCents(line?.price);
        if (unit === null) {
            unpricedLines += 1;
            continue;
        }
        totalCents += unit * lineQuantity(line?.quantity);
        pricedLines += 1;
    }
    return { totalCents, pricedLines, unpricedLines };
}
/**
 * @description Format integer cents as an exact two-decimal string ("1234" -> "12.34").
 * @param cents - Whole cents (non-negative).
 * @returns The amount with exactly two decimals, suitable for a NUMERIC(10,2) column.
 */
function formatCents(cents) {
    const whole = Math.max(0, Math.round(Number(cents) || 0));
    return `${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, '0')}`;
}
/**
 * @description Integer cents as a dollar number for the existing `total` response field.
 * @param cents - Whole cents.
 * @returns The amount in dollars, parsed from the exact two-decimal string.
 */
function centsToDollars(cents) {
    return Number(formatCents(cents));
}
//# sourceMappingURL=cart-totals.js.map