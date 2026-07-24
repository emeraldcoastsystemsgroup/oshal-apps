"use strict";
/**
 * Trading book-read route builders (ADR-052) — the cheap, read-only surface routes: the HTML
 * surface, per-mode status, account/positions/quote reads, the equity-curve performance view, and
 * the realized P&L tally. No orders are placed and no LLM runs here. Registered FIRST by
 * trading-routes.ts, preserving the original registration order exactly.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-11 05:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Extracted from trading-routes.ts (1000-line cap decomposition): GET / + /ui + /status + /account + /positions + /quote + /performance + /realized. Handler code moved verbatim — zero behavior change.
 * 2026-07-15 10:45:00 | roger.murphy@emeraldcoastsystemsgroup.com   | /performance falls back to our recorded daily-equity series for a book with no broker equity-curve endpoint (LIVE/Schwab). Root cause of the operator's "dashboard tiles don't reflect Schwab": Schwab has no portfolioHistory, so /performance 503'd and loadPerfSummary() silently left the "Total return" + "vs S&P" KPI tiles as placeholders. Account/positions/equity tiles were always correct (Schwab-live); only the two curve-derived tiles were blank. Now built from oshal_trading_daily_equity (our own per-fire equity snapshot) + SPY closes, same payload shape. Paper is unchanged (Alpaca portfolioHistory path untouched).
 * 2026-07-19 16:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Trading engine extraction (ADR-085 pre-carve): import repoint only — ensureTradingSchema from app/trading-schema.ts (was ./trading-routes-schema, moved). Zero behavior change.
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carved out of OSHAL core into the trading app package (ADR-085 Wave 3). Relative kernel imports flip to @/ aliases (trading-routes-helpers + trading-schema stay kernel); apiDir now arrives from the entry's package surfaceDir (ctx.appPackageDir/tools) instead of the core src/api dir. Handler bodies byte-identical — zero behavior change.
 *
 * @module trading-routes-book-read-builders
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.performanceFromEquitySeries = performanceFromEquitySeries;
exports.registerTradingBookReadRoutes = registerTradingBookReadRoutes;
const logger_1 = require("@/shared/logger");
const trading_1 = require("@/features/trading");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const trading_schema_1 = require("@/app/trading-schema");
const trading_daily_equity_store_1 = require("@/app/trading-daily-equity-store");
// Same module tag as the entry file so structured log output is unchanged by the split.
const logger = (0, logger_1.createChildLogger)({ module: 'trading-routes' });
/**
 * @description Build the /performance payload for a book with NO broker equity-curve endpoint (the
 *   LIVE Schwab book) from OUR recorded daily-equity series. This is the fix for the blank
 *   "Total return" / "vs S&P" KPI tiles in live mode: Schwab has no portfolioHistory, so the route
 *   used to 503 and the tiles silently stayed as placeholders. We snapshot real equity every fire,
 *   so we can draw the exact same curve ourselves. Returns null when nothing has been recorded yet
 *   (the caller then 503s, unchanged) so a brand-new book still degrades cleanly rather than lying.
 * @param series - Ascending recorded daily equity for this book (windowed to the period).
 * @param liveEquity - Current live equity (extends the curve to a NOW point and drives inception).
 * @param spyCloses - SPY daily closes over the same window (benchmark; may be empty).
 * @param spyNow - Latest SPY price (extends the benchmark to NOW; may be null).
 * @param inceptionBase - First-ever recorded equity for this book (the since-inception base).
 * @param period - Pass-through period label.
 * @param mode - Pass-through book.
 * @param nowT - Current epoch seconds (passed in — Date.now is banned in some contexts).
 * @returns The payload, or null when there is no recorded equity to build from.
 */
function performanceFromEquitySeries(series, liveEquity, spyCloses, spyNow, inceptionBase, period, mode, nowT) {
    const r2 = (n) => Math.round(n * 100) / 100;
    const pts = series.filter((p) => p.equity > 0);
    if (!pts.length)
        return null;
    const windowBase = pts[0].equity;
    // DAILY portfolio % vs the window's first recorded close (ET-close epoch). Built BEFORE the live
    // NOW point so the SPY benchmark aligns to real trading days, not the synthetic NOW — then both
    // series get the NOW point appended separately (mirrors the Alpaca portfolioHistory path).
    const daily = pts.map((p) => ({ t: Math.floor(Date.parse(p.etDay + 'T20:00:00Z') / 1000), pct: (p.equity / windowBase - 1) * 100 }));
    // SPY aligned to the SAME daily window (tail index), normalized to the first close OF THAT WINDOW.
    // The base MUST be cl[0] (first of the slice), NOT spyCloses[0]: we usually have more SPY closes
    // than recorded equity days (only ~9 live-equity days exist), so normalizing to spyCloses[0] would
    // measure SPY over ~23 days while the portfolio spans ~9 — an apples-to-oranges vs-S&P.
    const n = Math.min(spyCloses.length, daily.length);
    const cl = n > 0 ? spyCloses.slice(-n) : [];
    const spyBase = cl.length ? cl[0] : 0;
    const spy = spyBase > 0
        ? cl.map((c, i) => ({ t: daily[daily.length - n + i].t, pct: (c / spyBase - 1) * 100 }))
        : [];
    // Extend BOTH lines to a live NOW point: portfolio via live equity, SPY via its latest price.
    const portfolio = [...daily];
    if (liveEquity > 0 && (!portfolio.length || nowT > portfolio[portfolio.length - 1].t)) {
        portfolio.push({ t: nowT, pct: (liveEquity / windowBase - 1) * 100 });
    }
    if (spyBase > 0 && spyNow && spyNow > 0 && spy.length && nowT > spy[spy.length - 1].t) {
        spy.push({ t: nowT, pct: (spyNow / spyBase - 1) * 100 });
    }
    const endPct = portfolio.length ? portfolio[portfolio.length - 1].pct : 0;
    const spyPct = spy.length ? spy[spy.length - 1].pct : 0;
    const inceptionReturnPct = (inceptionBase > 0 && liveEquity > 0) ? (liveEquity / inceptionBase - 1) * 100 : endPct;
    return {
        mode, period, portfolio, spy,
        summary: {
            totalReturnPct: r2(endPct), spyReturnPct: r2(spyPct), vsSpyPct: r2(endPct - spyPct), baseValue: windowBase,
            inceptionReturnPct: r2(inceptionReturnPct), equity: r2(liveEquity), inceptionBase: r2(inceptionBase),
        },
    };
}
/**
 * @description Registers the read-only book routes (surface pages, status, account, positions,
 * quote, performance, realized P&L, ledger header) on the trading router. Auth is enforced at the
 * mount (`/api/trading` sits behind serviceSecretOr(requiresAuth) in server.ts) plus each
 * handler's own callerSub 401 check — unchanged from the pre-split file.
 * @param router - The trading router being composed by createTradingRoutes.
 * @param ctx - App context (Postgres pool for the per-user, per-mode stores).
 * @param apiDir - Directory holding the HTML surface.
 * @returns Nothing — routes are registered on the passed router.
 */
function registerTradingBookReadRoutes(router, ctx, apiDir) {
    const round2 = (n) => Math.round(n * 100) / 100;
    router.get('/', (0, trading_routes_helpers_1.servePage)(apiDir, 'trading.html'));
    router.get('/ui', (0, trading_routes_helpers_1.servePage)(apiDir, 'trading.html'));
    /** GET /status — per-mode broker config, live gate, and counts. Drives the surface. */
    router.get('/status', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            let paperConfigured = false, liveConfigured = false;
            try {
                paperConfigured = (0, trading_1.getBrokerReader)('paper', sub).configured();
            }
            catch { /* provider unset */ }
            // Reader (not gated): report whether the LIVE rail is wired regardless of the live-enable switch.
            try {
                liveConfigured = (0, trading_1.getBrokerReader)('live', sub).configured();
            }
            catch { /* rail unset */ }
            const counts = (await ctx.pool.query(`SELECT
           (SELECT COUNT(*)::int FROM oshal_trading_signals  WHERE user_sub=$1 AND mode=$2) AS signals,
           (SELECT COUNT(*)::int FROM oshal_trading_decisions WHERE user_sub=$1 AND mode=$2) AS decisions,
           (SELECT COUNT(*)::int FROM oshal_trading_orders    WHERE user_sub=$1 AND mode=$2) AS orders`, [sub, mode])).rows[0];
            res.json({
                provider: process.env.BROKER_PROVIDER || 'alpaca',
                mode, liveEnabled: (0, trading_1.liveTradingEnabled)(),
                paperConfigured, liveConfigured,
                guardrails: (0, trading_routes_helpers_1.guardrails)(),
                counts: { signals: counts?.signals || 0, decisions: counts?.decisions || 0, orders: counts?.orders || 0 },
            });
        }
        catch (err) {
            logger.error({ err }, 'trading status failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /account?mode= — the broker account snapshot (cash, buying power, equity). */
    router.get('/account', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const broker = (0, trading_1.getBrokerReader)(mode, sub); // read — account balances readable with just a connection
            if (!broker.configured()) {
                res.status(503).json({ error: 'broker_not_configured', message: `Set the ${mode} broker keys (e.g. ALPACA_${mode.toUpperCase()}_KEY_ID / _SECRET_KEY).` });
                return;
            }
            res.json({ mode, account: await broker.getAccount() });
        }
        catch (err) {
            logger.error({ err }, 'trading account failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /positions?mode= — open positions for the active book. */
    router.get('/positions', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const broker = (0, trading_1.getBrokerReader)(mode, sub); // read — positions readable with just a connection
            if (!broker.configured()) {
                res.status(503).json({ error: 'broker_not_configured' });
                return;
            }
            res.json({ mode, positions: await broker.getPositions() });
        }
        catch (err) {
            logger.error({ err }, 'trading positions failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /quote?symbol=&mode= — latest price from the ACTIVE book's data source (Schwab live feed
     *  for the live book, Alpaca IEX for paper). The live data stream, one symbol — proves data is flowing. */
    router.get('/quote', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const symbol = String(req.query.symbol || '').trim().toUpperCase();
        if (!symbol) {
            res.status(400).json({ error: 'symbol_required', message: 'symbol is required.' });
            return;
        }
        try {
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const md = (0, trading_1.getMarketData)(mode, sub);
            if (!md.configured()) {
                res.status(503).json({ error: 'market_data_not_configured', source: md.kind });
                return;
            }
            const price = await md.latestPrice(symbol);
            res.json({ mode, source: md.kind, symbol, price });
        }
        catch (err) {
            logger.error({ err }, 'trading quote failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /performance?mode=&period=1W|1M|3M|1Y — account equity curve vs SPY (the "me vs market" view). */
    router.get('/performance', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const broker = (0, trading_1.getBrokerReader)(mode, sub); // read — equity curve
            if (!broker.configured()) {
                res.status(503).json({ error: 'broker_not_configured' });
                return;
            }
            const periodReq = String(req.query.period || '1M').toUpperCase();
            // period → (Alpaca period code, resolution, SPY daily bars to fetch).
            const MAP = {
                '1W': { p: '1W', tf: '1D', n: 6, days: 9 }, '1M': { p: '1M', tf: '1D', n: 23, days: 33 },
                '3M': { p: '3M', tf: '1D', n: 65, days: 95 }, '1Y': { p: '1A', tf: '1D', n: 252, days: 370 },
            };
            const sel = MAP[periodReq] || MAP['1M'];
            // LIVE (Schwab) has no broker equity-curve endpoint, so the Alpaca portfolioHistory path below
            // 503'd and the "Total return" / "vs S&P" KPI tiles silently stayed blank. Build the same
            // response from OUR recorded daily-equity series instead — the actual fix for the missing tiles.
            if (!broker.portfolioHistory) {
                const [series, acct, spyCloses, spyNow] = await Promise.all([
                    (0, trading_daily_equity_store_1.loadDailyEquitySeries)(ctx.pool, sub, mode, sel.days),
                    broker.getAccount().catch(() => null),
                    (0, trading_1.dailyCloses)('SPY', sel.n).catch(() => []),
                    (0, trading_1.latestPrice)('SPY').catch(() => null),
                ]);
                const allTime = await (0, trading_daily_equity_store_1.loadDailyEquitySeries)(ctx.pool, sub, mode, 0).catch(() => series);
                const inceptionBase = allTime.length ? allTime[0].equity : (series[0]?.equity ?? 0);
                const liveEquity = Number(acct?.equity || 0) || (series.length ? series[series.length - 1].equity : 0);
                const payload = performanceFromEquitySeries(series, liveEquity, spyCloses, spyNow, inceptionBase, periodReq, mode, Math.floor(Date.now() / 1000));
                if (!payload) {
                    res.status(503).json({ error: 'broker_not_configured' });
                    return;
                }
                res.json(payload);
                return;
            }
            const hist = await broker.portfolioHistory(sel.p, sel.tf);
            // Build cumulative-% portfolio series (skip leading nulls Alpaca pads weekends with).
            const port = [];
            for (let i = 0; i < hist.t.length; i++) {
                const e = hist.equity[i];
                if (e == null || !(e > 0))
                    continue;
                port.push({ t: hist.t[i], pct: Number(hist.plPct[i] || 0) * 100 });
            }
            // SPY benchmark over the same span, normalized to % from its first close; aligned by index (tail).
            let spy = [];
            let spyBase = 0;
            try {
                const closes = await (0, trading_1.dailyCloses)('SPY', sel.n).catch(() => []);
                if (closes.length > 1) {
                    const n = Math.min(closes.length, port.length || closes.length);
                    const cl = closes.slice(-n);
                    const tx = port.slice(-n).map((p) => p.t);
                    spyBase = cl[0];
                    if (spyBase > 0)
                        spy = cl.map((c, i) => ({ t: tx[i] || 0, pct: (c / spyBase - 1) * 100 }));
                }
            }
            catch { /* SPY optional — chart still shows the portfolio line */ }
            // Live account read: drives the since-inception KPI AND extends both chart lines to NOW.
            let liveEquity = 0;
            let inceptionBase = hist.baseValue;
            try {
                const [acct, allHist] = await Promise.all([
                    broker.getAccount(),
                    broker.portfolioHistory('all', '1D').catch(() => null),
                ]);
                liveEquity = Number(acct.equity || 0);
                if (allHist && allHist.baseValue > 0)
                    inceptionBase = allHist.baseValue;
            }
            catch { /* fall back to the period series if the live/all-time read fails */ }
            // The daily portfolio-history series lags by a session (its last bar is the prior
            // close), so the chart never showed today's ACTUAL move — the "missing actuals".
            // Extend both lines to a live NOW point (portfolio: live equity vs the window base;
            // SPY: latest trade vs the window's first close) so the chart reflects real current
            // performance against the index instead of stopping at yesterday's close.
            const nowT = Math.floor(Date.now() / 1000);
            if (liveEquity > 0 && hist.baseValue > 0 && (!port.length || nowT > port[port.length - 1].t)) {
                port.push({ t: nowT, pct: (liveEquity / hist.baseValue - 1) * 100 });
            }
            if (spy.length && spyBase > 0 && nowT > spy[spy.length - 1].t) {
                const spyNow = await (0, trading_1.latestPrice)('SPY').catch(() => null);
                if (spyNow && spyNow > 0)
                    spy.push({ t: nowT, pct: (spyNow / spyBase - 1) * 100 });
            }
            // Chart-summary figures reflect the (now-extended) curve end, so the "you" number
            // under the chart matches where the line actually finishes.
            const endPct = port.length ? port[port.length - 1].pct : 0;
            const spyPct = spy.length ? spy[spy.length - 1].pct : 0;
            // True since-inception total return (KPI): live equity vs the all-time base —
            // period-independent, so the "Total return" card does not change with the 1W/1M/
            // 3M/1Y toggle. Falls back to the period end if the live read failed.
            const inceptionReturnPct = (inceptionBase > 0 && liveEquity > 0)
                ? (liveEquity / inceptionBase - 1) * 100 : endPct;
            res.json({
                mode, period: periodReq, portfolio: port, spy,
                summary: {
                    totalReturnPct: round2(endPct), spyReturnPct: round2(spyPct), vsSpyPct: round2(endPct - spyPct),
                    baseValue: hist.baseValue,
                    inceptionReturnPct: round2(inceptionReturnPct), equity: round2(liveEquity), inceptionBase: round2(inceptionBase),
                },
            });
        }
        catch (err) {
            logger.error({ err }, 'trading performance failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /realized?mode= — realized P&L tally (per-sale): today + 30d win/loss record. */
    router.get('/realized', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const win = async (clause) => (await ctx.pool.query(`SELECT count(*)::int trades,
                count(*) FILTER (WHERE realized_pnl > 0)::int wins,
                count(*) FILTER (WHERE realized_pnl < 0)::int losses,
                COALESCE(round(sum(realized_pnl)::numeric,2),0) net,
                COALESCE(round(avg(realized_pnl) FILTER (WHERE realized_pnl>0)::numeric,2),0) avg_win,
                COALESCE(round(avg(realized_pnl) FILTER (WHERE realized_pnl<0)::numeric,2),0) avg_loss,
                COALESCE(round(max(realized_pnl)::numeric,2),0) biggest_win,
                COALESCE(round(min(realized_pnl)::numeric,2),0) biggest_loss
           FROM oshal_trading_orders
          WHERE user_sub=$1 AND mode=$2 AND side='sell' AND realized_pnl IS NOT NULL AND ${clause}`, [sub, mode])).rows[0];
            const today = await win(`created_at::date = CURRENT_DATE`);
            const d30 = await win(`created_at >= now() - interval '30 days'`);
            const winRate = (r) => r.trades ? Math.round((r.wins / r.trades) * 100) : null;
            res.json({ mode, today: { ...today, winRatePct: winRate(today) }, last30d: { ...d30, winRatePct: winRate(d30) } });
        }
        catch (err) {
            logger.error({ err }, 'trading realized failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /transactions?mode=&days=&symbol= — settled trade executions the VENUE recorded (read-only).
     *  The authority for reconciling closes done outside the engine. 503 on a rail without a
     *  transactions endpoint (e.g. Alpaca paper). */
    router.get('/transactions', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const broker = (0, trading_1.getBrokerReader)(mode, sub);
            if (!broker.configured() || !broker.getTransactions) {
                res.status(503).json({ error: 'transactions_not_supported' });
                return;
            }
            const days = Math.min(365, Math.max(1, Number(req.query.days) || 90));
            const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
            const txns = await broker.getTransactions(new Date(Date.now() - days * 86400000).toISOString(), new Date().toISOString(), symbol);
            res.json({ mode, days, symbol: symbol || null, count: txns.length, transactions: txns });
        }
        catch (err) {
            logger.error({ err }, 'trading transactions failed');
            res.status(502).json({ error: err.message });
        }
    });
}
//# sourceMappingURL=trading-routes-book-read-builders.js.map