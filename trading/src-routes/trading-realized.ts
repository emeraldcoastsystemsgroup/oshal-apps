/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Realized P&L for the trading surfaces on the engine's own cost (core engineRealizedForBook). The stored realized_pnl uses the venue's wash-sale-adjusted average and counts each disallowed loss twice; the Day P&L tile, the win record and the order cards read these figures instead. The venue's figure travels alongside as venue_realized_pnl.
 */
import type { AppContext } from '@/app/composition/app-context';
import { engineRealizedForBook, type EngineRealizedSale } from '@/app/trading-engine-cost-basis';

/** One realized tally, in the shape the Day P&L tile and win-record already read. */
export interface RealizedTally {
  trades: number;
  wins: number;
  losses: number;
  net: number;
  avg_win: number;
  avg_loss: number;
  biggest_win: number;
  biggest_loss: number;
  /** Closes the engine's ledger cannot price (drift or shares it did not buy): counted, never guessed. */
  unpriced: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * @description Tally realized results the way the old SQL did - wins, losses, net, averages and
 *   extremes - from engine-priced closes. An unpriced close is counted in `unpriced` and nowhere else.
 * @param values - One entry per close: its engine realized P&L, or null when it could not be priced.
 * @returns The tally, rounded to cents.
 */
export function tallyRealized(values: ReadonlyArray<number | null>): RealizedTally {
  const priced = values.filter((v): v is number => v != null && Number.isFinite(v));
  const wins = priced.filter((v) => v > 0);
  const losses = priced.filter((v) => v < 0);
  const mean = (list: number[]): number => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0);
  return {
    trades: priced.length,
    wins: wins.length,
    losses: losses.length,
    net: round2(priced.reduce((s, v) => s + v, 0)),
    avg_win: round2(mean(wins)),
    avg_loss: round2(mean(losses)),
    biggest_win: round2(priced.length ? Math.max(0, ...priced) : 0),
    biggest_loss: round2(priced.length ? Math.min(0, ...priced) : 0),
    unpriced: values.length - priced.length,
  };
}

/** The columns an order row must carry to be re-priced. */
export interface RealizedOrderRow {
  order_id: unknown;
  symbol: unknown;
  side: unknown;
  realized_pnl?: unknown;
}

/**
 * @description Swap each sell's stored venue-basis realized P&L for the engine's own, keeping the
 *   venue's figure as `venue_realized_pnl`. A sell the engine cannot price gets `realized_pnl: null`
 *   (an order card then shows no gain/loss badge rather than a figure nobody can stand behind).
 * @param rows - Order rows as the routes read them.
 * @param sales - Engine realized results by order id.
 * @returns New rows with realized_pnl, venue_realized_pnl and realized_basis set.
 */
export function applyEngineRealized<T extends RealizedOrderRow>(
  rows: readonly T[], sales: ReadonlyMap<string, EngineRealizedSale>,
): Array<T & { venue_realized_pnl: unknown; realized_basis: 'engine' }> {
  return rows.map((row) => {
    const venue = row.realized_pnl ?? null;
    if (row.side !== 'sell') return { ...row, venue_realized_pnl: venue, realized_basis: 'engine' as const };
    const sale = sales.get(String(row.order_id));
    return { ...row, realized_pnl: sale ? round2(sale.realizedPnl) : null, venue_realized_pnl: venue, realized_basis: 'engine' as const };
  });
}

/**
 * @description Re-price a list of one book's order rows on the engine's own cost.
 * @param ctx - App context (pool).
 * @param sub - Caller sub.
 * @param bookId - The book the rows came from.
 * @param rows - The rows.
 * @returns The rows, re-priced (see applyEngineRealized).
 */
export async function priceOrdersOnEngineCost<T extends RealizedOrderRow>(
  ctx: Pick<AppContext, 'pool'>, sub: string, bookId: string, rows: readonly T[],
): Promise<Array<T & { venue_realized_pnl: unknown; realized_basis: 'engine' }>> {
  const symbols = [...new Set(rows.filter((r) => r.side === 'sell').map((r) => String(r.symbol)))];
  const sales = symbols.length ? await engineRealizedForBook(ctx, sub, bookId, symbols) : new Map<string, EngineRealizedSale>();
  return applyEngineRealized(rows, sales);
}
