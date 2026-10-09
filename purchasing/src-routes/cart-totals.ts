/**
 * Cart totals in integer cents — the ONE place a Shopping cart's money is added up.
 *
 * Why this exists: the cart total used to be a floating-point reduce over whatever unit price
 * each stored line carried, and the direct-add route stored the price the BROWSER sent. The
 * total a shopper saw therefore depended on the request body, and summing dollars as floats can
 * drift a cent (0.1 + 0.2). Lines are now priced by the server from the catalog, and every total
 * is computed here in whole cents, so /cart, the checkout proposal and the recorded hand-off all
 * report the same exact figure. Pure: no I/O, no framework imports, so a plain-node test and the
 * browser smoke fixture can load the compiled module directly.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — integer-cent price parsing, cart totals with an unpriced-line count, and exact two-decimal formatting shared by /cart, the chat checkout proposal and the checkout hand-off record.
 *
 * @module cart-totals
 */

/** Largest unit price accepted as a real catalog price (matches the NUMERIC(10,2) column). */
const MAX_UNIT_CENTS = 99_999_999;

/** Largest quantity one cart line may carry (the add paths clamp to this too). */
export const MAX_LINE_QUANTITY = 10;

/** The cart-line fields a total reads (a stored shop_list_items row satisfies it). */
export interface PricedLine {
  unit_price?: number | string | null;
  quantity?: number | string | null;
}

/** The result of adding a cart up. */
export interface CartTotal {
  /** Sum of priced lines, in integer cents. */
  totalCents: number;
  /** Lines that carried a usable price. */
  pricedLines: number;
  /** Lines with no usable price — counted, never guessed. */
  unpricedLines: number;
}

/**
 * @description Parse one price (a number or the string PostgreSQL returns for NUMERIC) into
 * integer cents. Rounds to the nearest cent once, at the boundary, so float noise such as
 * 2.78 * 100 = 277.99999999999997 cannot leak into a sum.
 * @param value - The price in dollars.
 * @returns Whole cents, or null when the value is missing, not finite, negative or implausibly large.
 */
export function toCents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const dollars = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  const cents = Math.round(dollars * 100);
  return cents <= MAX_UNIT_CENTS ? cents : null;
}

/**
 * @description Clamp a requested quantity to a whole number between 1 and MAX_LINE_QUANTITY.
 * @param value - The requested quantity (any shape).
 * @returns The quantity a line is stored and totalled with.
 */
export function lineQuantity(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_LINE_QUANTITY, n);
}

/**
 * @description Add a cart up in integer cents. A line without a usable price is counted in
 * `unpricedLines` rather than silently priced at zero, so a caller can say the total is partial.
 * @param lines - Stored cart lines (`unit_price`, `quantity`).
 * @returns The exact total in cents with the priced/unpriced line counts.
 */
export function cartTotalCents(lines: readonly PricedLine[]): CartTotal {
  let totalCents = 0;
  let pricedLines = 0;
  let unpricedLines = 0;
  for (const line of lines || []) {
    const unit = toCents(line?.unit_price);
    if (unit === null) { unpricedLines += 1; continue; }
    totalCents += unit * lineQuantity(line?.quantity);
    pricedLines += 1;
  }
  return { totalCents, pricedLines, unpricedLines };
}

/**
 * @description Format integer cents as an exact two-decimal string ("1234" -> "12.34") without
 * going back through floating point.
 * @param cents - Whole cents (non-negative).
 * @returns The amount with exactly two decimals, suitable for a NUMERIC(10,2) column.
 */
export function formatCents(cents: number): string {
  const whole = Math.max(0, Math.round(Number(cents) || 0));
  return `${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, '0')}`;
}

/**
 * @description Integer cents as a dollar number for the existing `total` response field. Parsed
 * from the exact two-decimal string, so the number is the closest double to the true amount.
 * @param cents - Whole cents.
 * @returns The amount in dollars.
 */
export function centsToDollars(cents: number): number {
  return Number(formatCents(cents));
}
