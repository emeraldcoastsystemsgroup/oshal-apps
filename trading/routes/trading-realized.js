"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tallyRealized = tallyRealized;
exports.applyEngineRealized = applyEngineRealized;
exports.priceOrdersOnEngineCost = priceOrdersOnEngineCost;
exports.realizedReport = realizedReport;
const trading_engine_cost_basis_1 = require("@/app/trading-engine-cost-basis");
const round2 = (n) => Math.round(n * 100) / 100;
/**
 * @description Tally realized results the way the old SQL did - wins, losses, net, averages and
 *   extremes - from engine-priced closes. An unpriced close is counted in `unpriced` and nowhere else.
 * @param values - One entry per close: its engine realized P&L, or null when it could not be priced.
 * @returns The tally, rounded to cents.
 */
function tallyRealized(values) {
    const priced = values.filter((v) => v != null && Number.isFinite(v));
    const wins = priced.filter((v) => v > 0);
    const losses = priced.filter((v) => v < 0);
    const mean = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0);
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
/**
 * @description Swap each sell's stored venue-basis realized P&L for the engine's own, keeping the
 *   venue's figure as `venue_realized_pnl`. A sell the engine cannot price gets `realized_pnl: null`
 *   (an order card then shows no gain/loss badge rather than a figure nobody can stand behind).
 * @param rows - Order rows as the routes read them.
 * @param sales - Engine realized results by order id.
 * @returns New rows with realized_pnl, venue_realized_pnl and realized_basis set.
 */
function applyEngineRealized(rows, sales) {
    return rows.map((row) => {
        const venue = row.realized_pnl ?? null;
        if (row.side !== 'sell')
            return { ...row, venue_realized_pnl: venue, realized_basis: 'engine' };
        const sale = sales.get(String(row.order_id));
        return { ...row, realized_pnl: sale ? round2(sale.realizedPnl) : null, venue_realized_pnl: venue, realized_basis: 'engine' };
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
async function priceOrdersOnEngineCost(ctx, sub, bookId, rows) {
    const symbols = [...new Set(rows.filter((r) => r.side === 'sell').map((r) => String(r.symbol)))];
    const sales = symbols.length ? await (0, trading_engine_cost_basis_1.engineRealizedForBook)(ctx, sub, bookId, symbols) : new Map();
    return applyEngineRealized(rows, sales);
}
/**
 * @description Tally one book's realized P&L on the engine's own cost: every filled sell in the
 *   last 30 days, re-priced by engineRealizedForBook, split into today and the 30-day record, with
 *   the venue's own net riding alongside labelled. Book-scoped and owner-scoped by the query's own
 *   (user_sub, book_id) predicate - an unscoped read would mix a paper book into a live figure.
 *   This is the whole body of GET /realized, extracted so the route and the trading specialist's
 *   facts cannot report different numbers for the same day.
 * @param ctx - App context (pool).
 * @param sub - Owner sub.
 * @param bookId - The book whose closes are tallied; it alone scopes the query.
 * @param mode - The book kind, echoed back as `mode` for the surface's response shape.
 * @returns The realized report for that book.
 */
async function realizedReport(ctx, sub, bookId, mode = '') {
    // Closes are priced on the ENGINE's own cost: the stored realized_pnl uses the venue's wash-sale-
    // adjusted average and counts each disallowed loss twice. The venue's net rides along, labelled.
    const closes = (await ctx.pool.query(`SELECT order_id::text AS order_id, upper(symbol) AS symbol, realized_pnl,
            (created_at::date = CURRENT_DATE) AS today
       FROM oshal_trading_orders
      WHERE user_sub=$1 AND book_id=$2 AND side='sell' AND status='filled'
        AND created_at >= now() - interval '30 days'`, [sub, bookId])).rows;
    const sales = closes.length
        ? await (0, trading_engine_cost_basis_1.engineRealizedForBook)(ctx, sub, bookId, [...new Set(closes.map((c) => c.symbol))])
        : new Map();
    const engine = (c) => sales.get(c.order_id)?.realizedPnl ?? null;
    const venueNet = (list) => round2(list.reduce((s, c) => s + Number(c.realized_pnl ?? 0), 0));
    const todays = closes.filter((c) => c.today);
    const today = tallyRealized(todays.map(engine));
    const d30 = tallyRealized(closes.map(engine));
    const winRate = (r) => (r.trades ? Math.round((r.wins / r.trades) * 100) : null);
    return {
        mode, basis: 'engine',
        today: { ...today, winRatePct: winRate(today) },
        last30d: { ...d30, winRatePct: winRate(d30) },
        venueNet: { today: venueNet(todays), last30d: venueNet(closes) },
    };
}
//# sourceMappingURL=trading-realized.js.map