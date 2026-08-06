/**
 * Venture Plan - exact foreign-exchange arithmetic and immutable rate snapshots.
 *
 * A supplier quote is recorded in the supplier's currency. The model is recorded
 * in the venture's reporting currency. Treating those integer micros as though
 * they were interchangeable produces a plausible but false BOM, so every
 * cross-currency conversion requires one immutable, identified FX assumption.
 *
 * Rates use integer nano-units: 1 EUR = 1.085 USD is 1_085_000_000 rate nanos.
 * Conversion uses BigInt for the intermediate product, then rounds half-up away
 * from zero to a whole reporting-currency micro. No binary float enters the
 * calculation and an overflow throws before a lossy Number can escape.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add exact integer-nanorate FX snapshots and fail-closed micro-currency conversion for foreign supplier quotes.
 *
 * @module venture-currency
 */

import { MAX_SAFE_MICROS, type Micros } from './venture-primitives';

/** One whole target-currency unit per source-currency unit, in nano-units. */
export const FX_RATE_SCALE = 1_000_000_000;

/** Largest accepted rate: one source unit buys at most one million target units. */
export const MAX_FX_RATE_NANOS = 1_000_000 * FX_RATE_SCALE;

/** Source postures that a human may bind to an immutable FX snapshot. */
export type FxSourceKind = 'user-entered' | 'published-source' | 'vendor-quote';

/** The validated values required to perform one conversion. */
export interface FxRateSnapshot {
  id: string;
  sourceCurrency: string;
  reportingCurrency: string;
  rateNanos: number;
}

/** Machine-readable failure at the currency boundary. */
export class VentureFxError extends Error {
  /**
   * @description Create a fail-closed FX validation or binding error.
   * @param code - Stable API-safe error code.
   * @param message - Human-readable reason the conversion was refused.
   */
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'VentureFxError';
  }
}

/**
 * @description Normalize a three-letter currency code at every ingress.
 * @param value - Candidate ISO-4217-style code.
 * @param field - Field name included in a refusal.
 * @returns Uppercase three-letter code.
 */
export function normalizeCurrencyCode(value: unknown, field = 'currency'): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new VentureFxError('invalid_currency', `${field} must be a three-letter currency code`);
  }
  return code;
}

/**
 * @description Validate a money amount before it enters exact FX arithmetic.
 * @param value - Candidate integer micros.
 * @param field - Field name included in a refusal.
 * @returns The unchanged integer micros.
 */
export function assertCurrencyMicros(value: unknown, field: string): Micros {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > MAX_SAFE_MICROS) {
    throw new VentureFxError('invalid_currency_amount', `${field} must be exactly representable integer micros`);
  }
  return value;
}

/**
 * @description Validate an integer nano-rate without accepting zero or a float.
 * @param value - Candidate rate nanos.
 * @returns The unchanged rate.
 */
export function assertFxRateNanos(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
      || value <= 0 || value > MAX_FX_RATE_NANOS) {
    throw new VentureFxError(
      'invalid_fx_rate',
      `rateNanos must be an integer from 1 through ${MAX_FX_RATE_NANOS}`,
    );
  }
  return value;
}

/** Round a signed rational number to an integer, with ties away from zero. */
function divideHalfAway(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  const magnitude = remainder < 0n ? -remainder : remainder;
  if (magnitude * 2n < denominator) return quotient;
  return quotient + (numerator < 0n ? -1n : 1n);
}

/**
 * @description Freeze a validated FX snapshot so a caller cannot change the
 *   rate between quote validation and conversion.
 * @param value - Candidate snapshot.
 * @returns A frozen, normalized snapshot.
 */
export function freezeFxSnapshot(value: FxRateSnapshot): Readonly<FxRateSnapshot> {
  const id = String(value.id ?? '').trim();
  if (!id) throw new VentureFxError('invalid_fx_assumption', 'FX assumption id is required');
  const sourceCurrency = normalizeCurrencyCode(value.sourceCurrency, 'sourceCurrency');
  const reportingCurrency = normalizeCurrencyCode(value.reportingCurrency, 'reportingCurrency');
  if (sourceCurrency === reportingCurrency) {
    throw new VentureFxError('redundant_fx_assumption', 'an FX assumption must cross two currencies');
  }
  return Object.freeze({
    id,
    sourceCurrency,
    reportingCurrency,
    rateNanos: assertFxRateNanos(value.rateNanos),
  });
}

/**
 * @description Convert source-currency micros with one immutable FX snapshot.
 * @param sourceMicros - Exact integer micros in the source currency.
 * @param snapshot - Identified source-to-reporting rate snapshot.
 * @returns Exact integer micros in the reporting currency.
 */
export function convertCurrencyMicros(
  sourceMicros: Micros,
  snapshot: FxRateSnapshot,
): Micros {
  const amount = assertCurrencyMicros(sourceMicros, 'sourceMicros');
  const rate = freezeFxSnapshot(snapshot);
  const converted = divideHalfAway(BigInt(amount) * BigInt(rate.rateNanos), BigInt(FX_RATE_SCALE));
  const ceiling = BigInt(MAX_SAFE_MICROS);
  if (converted > ceiling || converted < -ceiling) {
    throw new VentureFxError('fx_conversion_overflow', 'converted amount exceeds exact micro-currency range');
  }
  return Number(converted);
}
