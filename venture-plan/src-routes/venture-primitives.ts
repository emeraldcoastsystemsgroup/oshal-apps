/**
 * Venture engine — money, rate, time and allocation primitives.
 *
 * WHY INTEGER MICRO-DOLLARS. A bill of materials contains fasteners at $0.0034
 * and resin at $2.41/kg x 0.35 kg. At CENT granularity a 40-piece fastener line
 * rounds to $0.00 and the unit cost is quietly understated — which is exactly the
 * class of error that makes a manufacturing commitment on a wrong number. At
 * FLOAT precision a 50,000-unit roll-up accumulates representation error and the
 * plan stops tying to itself. Micros (1e-6 USD) give six decimals of unit-cost
 * resolution inside a 2^53 integer, and every operation asserts against the
 * ceiling rather than silently losing precision.
 *
 * WHY BASIS POINTS FOR RATES. Fees, duty, margins and allowances are contractual
 * and exact; 15% is 1500 bps, not 0.15. Only physical/behavioural factors (scrap,
 * sell-through, elasticity, FTE) are floats, because precision-to-the-cent is
 * meaningless there.
 *
 * THE ROUNDING POLICY, stated once and applied in exactly two places:
 *   1. Immediately after any rate multiplication or division, back to whole micros
 *      (`applyBps`, `scaleMicros`, `divMicros`, `grossUpBps`).
 *   2. Once at the presentation boundary (`microsToCents`, `formatUsd`).
 * Rounding is HALF-UP AWAY FROM ZERO. `Math.round(-0.5)` is `-0` in JavaScript,
 * so sign is handled explicitly — a negative contribution must round the same
 * magnitude as its positive twin or a waterfall stops reconciling.
 *
 * Nothing in this module does I/O, reads a clock, or calls `Math.random`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — integer micro-dollar money type with an asserted overflow ceiling, basis-point rate application and its exact inverse, null-not-Infinity division, largest-remainder allocation that sums exactly for any weights including negative totals, and YYYY-MM calendar arithmetic. These are the primitives every other venture engine module is built on, so a defect here is a defect in every figure the app prints.
 *
 * @module venture-primitives
 */

/** Integer micro-dollars. 1 Micros = $0.000001. NEVER fractional. */
export type Micros = number;

/**
 * Basis points. 1 Bps = 0.01%. 1500 Bps = 15%.
 *
 * CONTRACTUAL RATES ARE WHOLE BASIS POINTS — a margin, a referral fee, an
 * allowance. A few STATUTORY rates are not: the US harbour maintenance fee is
 * 0.125%, which is 12.5 bps and cannot be written as an integer. So a Bps value may
 * carry a fraction, and `applyBps` is exact for one. What is never acceptable is
 * rounding 12.5 to 13 to fit an integer, or — as an earlier build of the worked
 * example did — writing it as 125 and overstating the fee tenfold on every
 * landed-cost figure in the plan. `assertRateBps` is the check that catches the
 * second of those.
 */
export type Bps = number;

/** Unitless float factor (scrap, sell-through, elasticity, FTE). Not money. */
export type Ratio = number;

/** Calendar month, `YYYY-MM`. The engine's scheduling resolution is one month. */
export type YearMonth = string;

/** Micros in one US dollar. */
export const MICROS_PER_DOLLAR = 1_000_000;

/** Micros in one US cent. */
export const MICROS_PER_CENT = 10_000;

/** One whole rate, in basis points. */
export const BPS_ONE = 10_000;

/**
 * +/- $9.007B. Every helper asserts against this and throws rather than losing
 * precision, because a silently-wrong large number is worse than a loud failure.
 */
export const MAX_SAFE_MICROS = 9_007_199_254_740_000;

/** Weeks in an average month (52 / 12). Used for week <-> month conversion only. */
export const WEEKS_PER_MONTH = 52 / 12;

/** Days in an average month (365.25 / 12). Used for net-terms conversion only. */
export const DAYS_PER_MONTH = 365.25 / 12;

/**
 * Thrown when an arithmetic result would leave the exactly-representable integer
 * range. Loud beats lossy: at this altitude a number that quietly stops being
 * exact is a number a human commits money against.
 */
export class VentureOverflowError extends Error {
  /**
   * @description Build the overflow error.
   * @param operation - The helper that detected the overflow.
   * @param value - The offending (unrepresentable) value.
   */
  constructor(public readonly operation: string, public readonly value: number) {
    super(`venture arithmetic overflow in ${operation}: ${value} exceeds +/-${MAX_SAFE_MICROS}`);
    this.name = 'VentureOverflowError';
  }
}

/**
 * @description Assert a raw numeric result is finite and inside the micro ceiling.
 *   Called on every arithmetic result so precision loss surfaces as an exception
 *   instead of a plausible-looking wrong figure.
 * @param value - Raw (possibly fractional) result to check.
 * @param operation - Helper name, for the error message.
 * @returns The value, unchanged, when it is representable.
 */
export function assertRepresentable(value: number, operation: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_SAFE_MICROS) {
    throw new VentureOverflowError(operation, value);
  }
  return value;
}

/**
 * @description Round half-up AWAY FROM ZERO. `Math.round` rounds -0.5 to -0,
 *   which breaks the symmetry a signed waterfall depends on: a -$0.005 fee and a
 *   +$0.005 fee must round to the same magnitude or the deductions stop summing
 *   to the total.
 * @param value - Any finite number.
 * @returns The nearest integer, ties away from zero.
 */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) throw new VentureOverflowError('roundHalfUp', value);
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * @description Convert a dollar amount to micros.
 * @param dollars - Dollars, possibly fractional.
 * @returns Integer micros.
 */
export function dollarsToMicros(dollars: number): Micros {
  return roundHalfUp(assertRepresentable(dollars * MICROS_PER_DOLLAR, 'dollarsToMicros'));
}

/**
 * @description Convert a cent amount to micros.
 * @param cents - Cents, possibly fractional.
 * @returns Integer micros.
 */
export function centsToMicros(cents: number): Micros {
  return roundHalfUp(assertRepresentable(cents * MICROS_PER_CENT, 'centsToMicros'));
}

/**
 * @description Presentation boundary ONLY — never called inside the engine.
 *   Rounding here is the second and last place the policy applies.
 * @param m - Micros.
 * @returns Integer cents, half-up away from zero.
 */
export function microsToCents(m: Micros): number {
  return roundHalfUp(m / MICROS_PER_CENT);
}

/**
 * @description Format micros as a US dollar string for a document. Presentation
 *   boundary; the engine never consumes the result.
 * @param m - Micros.
 * @param opts - `cents: true` keeps two decimals (default), `false` rounds whole.
 * @returns A `$1,234.56` style string, negatives parenthesised as accounting does.
 */
export function formatUsd(m: Micros, opts?: { cents?: boolean }): string {
  const withCents = opts?.cents !== false;
  // Half-up at the whole unit being displayed: rounding to dollars must round,
  // not truncate, or a summary figure drifts below the detail it summarises.
  const displayed = withCents ? microsToCents(m) : roundHalfUp(m / MICROS_PER_DOLLAR);
  const abs = Math.abs(displayed);
  const whole = withCents ? Math.floor(abs / 100) : abs;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = withCents ? `$${grouped}.${String(abs % 100).padStart(2, '0')}` : `$${grouped}`;
  return displayed < 0 ? `(${body})` : body;
}

/**
 * @description Sum micros with an overflow assertion on the running total.
 * @param values - Integer micro amounts.
 * @returns The integer sum.
 */
export function addMicros(...values: Micros[]): Micros {
  let total = 0;
  for (const v of values) total = assertRepresentable(total + v, 'addMicros');
  return total;
}

/**
 * @description Subtract micros with an overflow assertion.
 * @param a - Minuend.
 * @param b - Subtrahend.
 * @returns `a - b`.
 */
export function subMicros(a: Micros, b: Micros): Micros {
  return assertRepresentable(a - b, 'subMicros');
}

/**
 * @description Multiply micros by a unitless float factor and re-integerise.
 *   Used for physical factors (scrap, sell-through) — never for a contractual
 *   rate, which must go through `applyBps` so the rate stays exact.
 * @param m - Micros.
 * @param ratio - Float factor.
 * @returns Integer micros, rounded half-up once.
 */
export function scaleMicros(m: Micros, ratio: Ratio): Micros {
  return roundHalfUp(assertRepresentable(m * ratio, 'scaleMicros'));
}

/**
 * @description Apply a basis-point rate to a money amount. The ONLY way a
 *   contractual rate is allowed to touch money in this engine.
 * @param m - Micros.
 * @param bps - Rate in basis points.
 * @returns `m * bps / 10000`, rounded half-up once.
 */
export function applyBps(m: Micros, bps: Bps): Micros {
  return roundHalfUp(assertRepresentable((m * bps) / BPS_ONE, 'applyBps'));
}

/**
 * @description Assert a basis-point rate is finite and inside a stated band, and
 *   return it. A rate is the one input class where a decimal slip is invisible:
 *   125 bps and 12.5 bps both look like a fee, both compute, and one of them is
 *   ten times the statutory figure on the largest line in the plan. Callers that
 *   register a published rate state the band the published rate lives in, and a
 *   value outside it fails loudly instead of pricing a shipment wrong.
 * @param bps - The candidate rate in basis points.
 * @param label - What the rate is, for the error message.
 * @param min - Lowest plausible value, inclusive.
 * @param max - Highest plausible value, inclusive.
 * @returns The rate, unchanged, when it is inside the band.
 */
export function assertRateBps(bps: Bps, label: string, min = 0, max = BPS_ONE): Bps {
  if (!Number.isFinite(bps) || bps < min || bps > max) {
    throw new RangeError(`${label} is ${bps} bps, outside the plausible ${min}-${max} bps band — check for a factor-of-ten slip`);
  }
  return bps;
}

/**
 * @description Inverse of `applyBps`: the base amount that yields `m` after
 *   `bps` has been taken off it. Solving margin ladders backwards is the whole
 *   point of the channel inverse, so this has to exist as arithmetic rather than
 *   as an approximation.
 * @param m - The amount remaining after the deduction, in micros.
 * @param bps - The deduction rate in basis points; must be strictly under 10000.
 * @returns The pre-deduction base, in integer micros.
 */
export function grossUpBps(m: Micros, bps: Bps): Micros {
  if (bps >= BPS_ONE) throw new VentureOverflowError('grossUpBps', bps);
  return roundHalfUp(assertRepresentable((m * BPS_ONE) / (BPS_ONE - bps), 'grossUpBps'));
}

/**
 * @description Divide micros by a count. Returns NULL at a zero divisor — never
 *   Infinity, never NaN, and never a silent 0. A per-unit figure at zero volume
 *   does not exist, and the caller must say so rather than print a number.
 * @param m - Micros.
 * @param divisor - Any number; 0 yields null.
 * @returns Integer micros, or null when the divisor is zero or not finite.
 */
export function divMicros(m: Micros, divisor: number): Micros | null {
  if (!Number.isFinite(divisor) || divisor === 0) return null;
  return roundHalfUp(assertRepresentable(m / divisor, 'divMicros'));
}

/**
 * @description Express one money amount as basis points of another.
 * @param part - Numerator, micros.
 * @param whole - Denominator, micros; 0 yields null.
 * @returns Integer basis points, or null when the denominator is zero.
 */
export function bpsOf(part: Micros, whole: Micros): Bps | null {
  if (whole === 0 || !Number.isFinite(whole)) return null;
  return roundHalfUp(assertRepresentable((part * BPS_ONE) / whole, 'bpsOf'));
}

/**
 * @description Largest-remainder allocation of a total across weights. The
 *   result sums to `total` EXACTLY for any weights, including a negative total,
 *   zero weights, and more weights than micros — because a document whose line
 *   items do not add up to its own total destroys the credibility of every other
 *   number on the page.
 *
 *   Weights are taken by magnitude (a negative weight is a share, not a
 *   direction); the sign travels with the total. All-zero weights fall back to an
 *   even split. Ties in the remainder are broken by ascending index, which makes
 *   the result deterministic across runs and platforms.
 * @param total - Micros to distribute (may be negative).
 * @param weights - Relative shares; length defines the result length.
 * @returns Integer micros per weight, summing exactly to `total`.
 */
export function allocateMicros(total: Micros, weights: number[]): Micros[] {
  const n = weights.length;
  if (n === 0) return [];
  const w = weights.map((x) => (Number.isFinite(x) ? Math.abs(x) : 0));
  let sum = w.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    for (let i = 0; i < n; i += 1) w[i] = 1;
    sum = n;
  }
  const exact = w.map((x) => assertRepresentable((total * x) / sum, 'allocateMicros'));
  const base = exact.map((x) => Math.trunc(x));
  const allocated = base.reduce((a, b) => a + b, 0);
  let deficit = total - allocated;
  const step = deficit < 0 ? -1 : 1;
  const order = exact
    .map((x, i) => ({ i, rem: Math.abs(x - base[i]) }))
    .sort((a, b) => (b.rem - a.rem) || (a.i - b.i));
  let k = 0;
  while (deficit !== 0 && k < order.length * 2) {
    base[order[k % order.length].i] += step;
    deficit -= step;
    k += 1;
  }
  return base;
}

const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * @description Build a `YYYY-MM` month key.
 * @param year - Four-digit year.
 * @param month - Month, 1-12.
 * @returns The month key.
 */
export function ym(year: number, month: number): YearMonth {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`invalid year-month ${year}-${month}`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * @description Parse a month key into its parts, throwing on a malformed key so
 *   a bad calendar input cannot quietly shift a cash trough by a year.
 * @param m - Month key.
 * @returns `{ year, month }` with month 1-12.
 */
export function ymParts(m: YearMonth): { year: number; month: number } {
  const parsed = YM_RE.exec(m);
  if (!parsed) throw new RangeError(`invalid YearMonth "${m}" — expected YYYY-MM`);
  return { year: Number(parsed[1]), month: Number(parsed[2]) };
}

/**
 * @description Shift a month key by a whole number of months.
 * @param m - Month key.
 * @param months - Offset, may be negative.
 * @returns The shifted month key.
 */
export function ymAdd(m: YearMonth, months: number): YearMonth {
  const { year, month } = ymParts(m);
  const zero = year * 12 + (month - 1) + Math.trunc(months);
  return ym(Math.floor(zero / 12), (zero % 12) + 1);
}

/**
 * @description Shift a month key by whole weeks, FLOORING the month conversion.
 *   Use where an earlier month is the conservative reading.
 * @param m - Month key.
 * @param weeks - Whole or fractional weeks.
 * @returns The shifted month key.
 */
export function ymAddWeeks(m: YearMonth, weeks: number): YearMonth {
  return ymAdd(m, Math.floor(weeks / WEEKS_PER_MONTH));
}

/**
 * @description Shift a month key by whole weeks, CEILING the month conversion.
 *   Lead time and transit use this: a 13-week lead time spans three calendar
 *   months of risk, and rounding it down is how a schedule silently claims to
 *   make a window it misses.
 * @param m - Month key.
 * @param weeks - Whole or fractional weeks.
 * @returns The shifted month key.
 */
export function ymAddWeeksCeil(m: YearMonth, weeks: number): YearMonth {
  return ymAdd(m, Math.ceil(weeks / WEEKS_PER_MONTH));
}

/**
 * @description Convert payment net-terms days to whole months, rounded to
 *   nearest. One stated policy so AR and AP never disagree about when a net-60
 *   invoice lands.
 * @param days - Net terms in days.
 * @returns Whole months.
 */
export function monthsForDays(days: number): number {
  if (!Number.isFinite(days)) return 0;
  return roundHalfUp(days / DAYS_PER_MONTH);
}

/**
 * @description Months between two month keys.
 * @param a - Later month key.
 * @param b - Earlier month key.
 * @returns `a - b` in whole months (negative when `a` precedes `b`).
 */
export function ymDiff(a: YearMonth, b: YearMonth): number {
  const pa = ymParts(a);
  const pb = ymParts(b);
  return (pa.year - pb.year) * 12 + (pa.month - pb.month);
}

/**
 * @description Compare two month keys.
 * @param a - First month key.
 * @param b - Second month key.
 * @returns -1, 0 or 1.
 */
export function ymCompare(a: YearMonth, b: YearMonth): -1 | 0 | 1 {
  const d = ymDiff(a, b);
  if (d < 0) return -1;
  return d > 0 ? 1 : 0;
}

/**
 * @description Build a contiguous run of month keys.
 * @param start - First month key.
 * @param count - How many months (0 or fewer yields an empty array).
 * @returns The month keys, ascending.
 */
export function ymRange(start: YearMonth, count: number): YearMonth[] {
  const out: YearMonth[] = [];
  for (let i = 0; i < Math.max(0, Math.trunc(count)); i += 1) out.push(ymAdd(start, i));
  return out;
}

/**
 * @description Coerce hostile input to a finite number inside a stated range.
 *   NaN, Infinity and out-of-range values can never reach the arithmetic.
 * @param value - Any candidate value.
 * @param fallback - Returned when the candidate is unusable.
 * @param min - Lower clamp (inclusive).
 * @param max - Upper clamp (inclusive).
 * @returns A finite number within [min, max].
 */
export function safeNumber(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
