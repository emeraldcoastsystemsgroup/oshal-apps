/**
 * Movers compute (ADR-138) — the PURE ranking core behind GET /reports/movers. A daily-bar batch
 * (symbol → ascending OHLCV) goes in; the ranked rows for one board come out. Nothing here fetches,
 * logs, or reaches a book: the route does the single barsBatchOhlcv call and hands the map in, so
 * every ranking and the never-fabricate rule is unit-testable against a fixture without a live feed.
 *
 * Never fabricates: a symbol with fewer than two bars is simply omitted (no price, no change to
 * invent), and the 'volatile' board additionally drops any symbol whose history is too thin to give
 * a real standard deviation — its volatility stays null rather than being guessed at zero.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the pure movers compute: MoverKind/MoverRow shapes, the ?kind= type guard, day-over-day returns + sample-stdev realized volatility over the last ~20 sessions (null under 6 bars), a per-symbol row (null under 2 bars — never fabricated), the per-board comparators (winners/losers by changePct, volatile by volatilityPct, active by dayVolume), and computeMovers that filters the volatile board to rows with a real volatility and returns the top `limit`.
 *
 * @module trading-movers
 */

import type { OhlcvBar } from '@/features/trading';

/** The four movers boards the surface can ask for. */
export type MoverKind = 'winners' | 'losers' | 'volatile' | 'active';

/** One ranked row. `name` is attached by the route (best-effort) after this pure compute. */
export interface MoverRow {
  symbol: string;
  name?: string | null;
  price: number;
  changePct: number;
  dayVolume: number;
  volatilityPct: number | null;
}

/** The valid `?kind=` values, in a stable order. */
export const MOVER_KINDS: MoverKind[] = ['winners', 'losers', 'volatile', 'active'];

/** Fewest bars a symbol needs before a realized volatility is honest rather than a guess. */
const VOL_MIN_BARS = 6;
/** How many recent daily returns the volatility window spans. */
const VOL_WINDOW = 20;

/**
 * @description Type guard for the `?kind=` query value.
 * @param x - The raw query value.
 * @returns True when x is one of the four board names.
 */
export function isMoverKind(x: unknown): x is MoverKind {
  return typeof x === 'string' && (MOVER_KINDS as string[]).includes(x);
}

/**
 * @description Day-over-day simple returns, oldest→newest, from ascending OHLCV closes.
 * @param bars - The symbol's ascending daily bars.
 * @returns One return per adjacent close pair (a zero prior close is skipped, never divided by).
 */
function dailyReturns(bars: OhlcvBar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].c;
    if (prev) out.push((bars[i].c - prev) / prev);
  }
  return out;
}

/**
 * @description Sample standard deviation of xs.
 * @param xs - The sample.
 * @returns The stdev, or 0 for fewer than two points.
 */
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * @description Realized daily volatility (percent) over the last VOL_WINDOW returns.
 * @param bars - The symbol's ascending daily bars.
 * @returns The volatility percent, or null when the history is under VOL_MIN_BARS bars.
 */
function volatilityPctOf(bars: OhlcvBar[]): number | null {
  if (bars.length < VOL_MIN_BARS) return null;
  return stdev(dailyReturns(bars).slice(-VOL_WINDOW)) * 100;
}

/**
 * @description One mover row from a symbol's ascending bars — never a fabricated row.
 * @param symbol - The ticker.
 * @param bars - Its ascending daily bars.
 * @returns The row, or null when there are fewer than two bars (or a zero prior close).
 */
function rowFor(symbol: string, bars: OhlcvBar[]): MoverRow | null {
  if (!bars || bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (!prev.c) return null;
  return {
    symbol,
    price: last.c,
    changePct: ((last.c - prev.c) / prev.c) * 100,
    dayVolume: last.v,
    volatilityPct: volatilityPctOf(bars),
  };
}

/**
 * @description The comparator for one board (descending winners/volatile/active, ascending losers).
 * @param kind - The board.
 * @returns A sort comparator over MoverRow.
 */
function rankBy(kind: MoverKind): (a: MoverRow, b: MoverRow) => number {
  switch (kind) {
    case 'winners': return (a, b) => b.changePct - a.changePct;
    case 'losers': return (a, b) => a.changePct - b.changePct;
    case 'active': return (a, b) => b.dayVolume - a.dayVolume;
    case 'volatile': return (a, b) => (b.volatilityPct ?? 0) - (a.volatilityPct ?? 0);
  }
}

/**
 * @description Rank a universe's bars into the top `limit` movers for one board — PURE. Symbols with
 * under two bars are omitted; the 'volatile' board additionally drops rows whose volatility is null.
 * @param barsBySymbol - symbol → ascending daily OHLCV bars.
 * @param kind - The board to rank.
 * @param limit - Max rows returned.
 * @returns The ranked rows (name unset — the route attaches it best-effort afterwards).
 */
export function computeMovers(barsBySymbol: Map<string, OhlcvBar[]>, kind: MoverKind, limit: number): MoverRow[] {
  const rows: MoverRow[] = [];
  for (const [symbol, bars] of barsBySymbol) {
    const row = rowFor(symbol, bars);
    if (row) rows.push(row);
  }
  const eligible = kind === 'volatile' ? rows.filter((r) => r.volatilityPct != null) : rows;
  return eligible.sort(rankBy(kind)).slice(0, Math.max(0, limit));
}
