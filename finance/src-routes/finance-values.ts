/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve unknown money values without coercing null, blank text or missing components to zero.
 */

/** A finite reported amount, or unknown. Zero is a reported amount. */
export function finiteAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A total is known only when every required component is known. */
export function sumAmounts(values: unknown[]): number | null {
  let total = 0;
  for (const value of values) {
    const amount = finiteAmount(value);
    if (amount === null) return null;
    total += amount;
  }
  return finiteAmount(total);
}

/** Retain the established cents rounding only for known amounts. */
export function roundAmount(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}
