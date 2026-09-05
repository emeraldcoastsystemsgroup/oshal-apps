"use strict";
/**
 * Single-stock research, watchlist and pinned lots (ADR-138) — the operator's "look at ONE stock"
 * surface over the SELECTED account. The kernel (@/app/trading-pinned-lots) owns the lot store and
 * the leg that watches an entry fill and places its exits; these routes are the operator's view over
 * it plus the research reads the ticket is designed from.
 *
 *   GET    /api/trading/research/:symbol  → quote + fundamentals + news + EDGAR filings/events + next earnings
 *   GET    /api/trading/symbols/search    → market-wide type-ahead over the Alpaca asset directory (no book)
 *   GET    /api/trading/reports/movers    → the honest bounded movers board (oshal's universe + your watchlist)
 *   GET    /api/trading/watchlist         → the caller's watchlist (per USER, not per book) with best-effort quotes
 *   POST   /api/trading/watchlist         → add { symbol, note? } (201; re-adding updates the note)
 *   DELETE /api/trading/watchlist/:symbol → remove
 *   GET    /api/trading/lots              → this book's pinned lots + pinned qty by symbol
 *   POST   /api/trading/lots/:id/release  → confirm-gated (428); cancels working exits, shares return to the autopilot
 *
 * Every research section (quote / fundamentals / news / filings / earnings) is fetched independently
 * and reported in `sections` as 'ok' | 'unavailable' — an EDGAR outage never fails the quote and
 * nothing is ever fabricated. The next-earnings date comes from the world calendar when it is
 * reachable ('world-calendar'); otherwise it is a reporting-cadence estimate off the last item-2.02
 * 8-K and is labelled 'cadence-estimate' — never presented as the calendar. EDGAR is keyless and
 * requires the contact User-Agent; the ticker→CIK table is cached in-module for 24h.
 *
 * Watchlist quotes come from the SELECTED book's market-data rail (paper: Alpaca; live: Schwab).
 * dayChangePct is null: the rail is a closes-only source that cannot say which bar is yesterday's
 * without a date, and a wrong percent is worse than none.
 *
 * Every handler resolves the caller via callerSub (401) and, where a book matters, the book
 * QUERY-FIRST (`?book=` rides every surface fetch; body.book wins only when the query is silent —
 * the 2026-09-03 paper-routing class).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — GET /research/:symbol (five independently guarded sections: quote via latestTrade/latestPrice, fundamentalsSummary, recentNews 7d/25, EDGAR submissions → latest 10-K/10-Q + 12 decoded 8-Ks + events, earnings from the world calendar else a labelled cadence estimate), the per-user FORCE-RLS watchlist (GET with book-rail quotes / POST 201 upsert / DELETE), GET /lots + POST /lots/:id/release (428 confirm-gated) over the kernel pinned-lot store; TradingError → its status/code else logger.error + 502.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Add GET /symbols/search (400 query_required, limit capped 25, searchSymbols over the market-wide asset directory — no book) and GET /reports/movers (kind ∈ winners|losers|volatile|active, 400 kind_invalid, limit default 15/cap 50) over the honest bounded universe DEFAULT_UNIVERSE ∪ the caller's watchlist — one daily-bar batch fetch of 30 bars, the PURE computeMovers ranking (trading-movers.ts), best-effort per-row names, an empty batch → an honest empty board with a note, never a fabricated row.
 *
 * @module trading-research-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTradingResearchRoutes = registerTradingResearchRoutes;
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const trading_1 = require("@/features/trading");
const world_data_1 = require("@/features/world-data");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const trading_pinned_lots_1 = require("@/app/trading-pinned-lots");
const trading_movers_1 = require("./trading-movers");
const trading_edgar_filings_1 = require("./trading-edgar-filings");
const logger = (0, logger_1.createChildLogger)({ module: 'trading-research-routes' });
const SYMBOL_RE = /^[A-Z.\-]{1,10}$/;
/** News lookback for the research read (minutes) and the item cap. */
const NEWS_WINDOW_MIN = 7 * 24 * 60;
const NEWS_LIMIT = 25;
/** How many decoded 8-Ks the report carries and how many past results dates. */
const RECENT_8K_LIMIT = 12;
const PAST_RESULTS_LIMIT = 8;
/** How far ahead the world calendar is asked for an earnings row. */
const CALENDAR_DAYS = 90;
const NOTE_MAX = 280;
const RELEASE_CONFIRM_MESSAGE = 'Releasing a lot cancels its working exits and hands the shares back to the autopilot — resend with confirm:true.';
/** GET /symbols/search caps the type-ahead page at this many hits. */
const SYMBOL_SEARCH_MAX = 25;
/** GET /reports/movers: default board size, hard cap, and daily bars pulled per symbol. */
const MOVERS_DEFAULT_LIMIT = 15;
const MOVERS_MAX_LIMIT = 50;
const MOVERS_BARS = 30;
/** The honest label for what the movers universe actually spans (no holdings — the rail is quote-only). */
const MOVERS_SOURCE = 'oshal universe + your watchlist';
/** The free-IEX data-lag caveat carried on every non-empty board. */
const MOVERS_NOTE = 'End-of-last-session daily closes on the free IEX feed — not intraday real-time.';
/** What an empty batch says instead of inventing rows. */
const MOVERS_UNAVAILABLE_NOTE = 'Market data unavailable right now.';
const EMPTY_FILINGS = { summary: { latest10K: null, latest10Q: null, recent8K: [] }, resultsDates: [] };
/**
 * @description Resolve the caller's sub or answer 401 — shared by every handler.
 * @param req - The request.
 * @param res - The response (401 written when unauthenticated).
 * @returns The sub, or null after the 401 was sent.
 */
function sub(req, res) {
    const s = (0, trading_routes_helpers_1.callerSub)(req);
    if (!s)
        res.status(401).json({ error: 'not_authenticated' });
    return s;
}
/**
 * @description Resolve the SELECTED book QUERY-FIRST: `?book=`, then body.book, then the legacy
 * `mode` aliases in the same order.
 * @param ctx - App context (pool).
 * @param s - Caller sub.
 * @param req - The request.
 * @returns The resolved TradingBook (400 unknown_book on a garbage ref, never a silent paper remap).
 */
function resolveRequestBook(ctx, s, req) {
    const b = (req.body || {});
    return (0, trading_routes_helpers_1.resolveBook)(ctx.pool, s, req.query.book ?? b.book ?? req.query.mode ?? b.mode);
}
/**
 * @description Route failure → a TradingError's own status/code, else a logged 502.
 * @param res - The response.
 * @param err - The thrown value.
 * @param what - The handler, for the log line.
 */
function fail(res, err, what) {
    if (err instanceof trading_routes_helpers_1.TradingError) {
        res.status(err.httpStatus).json({ error: err.code, message: err.message });
        return;
    }
    logger.error({ err, what }, 'research route failed');
    res.status(502).json({ error: err.message || 'research_failed' });
}
/**
 * @description Run one research section in isolation: its result on success, the fallback on any
 * failure — logged, and reported in `sections` as 'unavailable' so the surface can say so instead
 * of showing an invented value.
 * @param name - Section name.
 * @param symbol - The ticker (for the log line).
 * @param fallback - What the report carries when the section fails.
 * @param run - The section's read.
 * @param sections - The per-section state map this call writes into.
 * @returns The section's value or the fallback.
 */
async function section(name, symbol, fallback, run, sections) {
    try {
        const value = await run();
        sections[name] = 'ok';
        return value;
    }
    catch (err) {
        logger.error({ err, symbol, section: name }, 'research section failed — reported unavailable');
        sections[name] = 'unavailable';
        return fallback;
    }
}
/* ─── research sections ────────────────────────────────────────────────────── */
/**
 * @description The latest print from THIS book's market-data rail with its exchange timestamp
 * (latestTrade), falling back to the freshness-blind latestPrice stamped now.
 * @param book - The selected book.
 * @param s - Caller sub.
 * @param symbol - The ticker.
 * @returns The quote, or null when the rail is not configured or has no print.
 */
async function quoteFor(book, s, symbol) {
    const md = (0, trading_1.getMarketData)(book.kind, s);
    if (!md.configured())
        return null;
    const tick = await md.latestTrade(symbol);
    if (tick)
        return { price: tick.price, asOf: new Date(tick.asOf).toISOString() };
    const price = await md.latestPrice(symbol);
    return price == null ? null : { price, asOf: new Date().toISOString() };
}
let tickerTable = null;
/**
 * @description Fetch EDGAR JSON with the SEC's required contact User-Agent.
 * @param url - The EDGAR url.
 * @returns The parsed body; throws on a non-2xx so the section reports 'unavailable'.
 */
async function edgarJson(url) {
    const r = await fetch(url, { headers: { 'User-Agent': trading_edgar_filings_1.EDGAR_UA, Accept: 'application/json' } });
    if (!r.ok)
        throw new Error(`EDGAR ${r.status} for ${url}`);
    return (await r.json());
}
/**
 * @description Ticker → 10-digit CIK via the SEC ticker table, cached in-module for 24h.
 * @param symbol - The ticker.
 * @returns The zero-padded CIK, or null for a non-registrant.
 */
async function cikForSymbol(symbol) {
    if (!tickerTable || Date.now() - tickerTable.at > trading_edgar_filings_1.EDGAR_TICKER_CACHE_MS) {
        tickerTable = { at: Date.now(), table: await edgarJson(trading_edgar_filings_1.EDGAR_TICKERS_URL) };
    }
    return (0, trading_edgar_filings_1.cikFromTickerTable)(tickerTable.table, symbol);
}
/**
 * @description The company's recent filings from EDGAR submissions: latest 10-K/10-Q, the decoded
 * 8-Ks, and the past results dates the earnings estimate steps from.
 * @param symbol - The ticker.
 * @returns The filings read (empty, not invented, for a ticker with no CIK).
 */
async function filingsFor(symbol) {
    const cik = await cikForSymbol(symbol);
    if (!cik)
        return EMPTY_FILINGS;
    const submissions = await edgarJson((0, trading_edgar_filings_1.edgarSubmissionsUrl)(cik));
    return { summary: (0, trading_edgar_filings_1.summarizeSubmissions)(submissions, cik, RECENT_8K_LIMIT), resultsDates: (0, trading_edgar_filings_1.earningsResultDates)(submissions, PAST_RESULTS_LIMIT) };
}
/**
 * @description The next earnings date from the world calendar (ISO date), or null when the world
 * service is off, has no row, or fails — logged, so the estimate can take over honestly.
 * @param symbol - The ticker.
 * @returns The calendar date, or null.
 */
async function calendarEarnings(symbol) {
    const svc = (0, world_data_1.createWorldIntelligenceService)();
    if (!svc)
        return null;
    try {
        const events = await svc.upcomingEvents(CALENDAR_DAYS, `world:ticker:${symbol}`);
        const hit = events.find((e) => e.eventType === 'earnings');
        return hit ? hit.scheduledAt.slice(0, 10) : null;
    }
    catch (err) {
        logger.error({ err, symbol }, 'world calendar earnings read failed — falling back to the cadence estimate');
        return null;
    }
}
/**
 * @description The earnings block: the calendar when it has a row, else the labelled cadence
 * estimate, else nothing.
 * @param symbol - The ticker.
 * @param resultsDates - Past item-2.02 8-K dates.
 * @returns The earnings block.
 */
async function earningsFor(symbol, resultsDates) {
    const calendar = await calendarEarnings(symbol);
    if (calendar)
        return { nextExpected: calendar, source: 'world-calendar', pastResults: resultsDates };
    const estimate = (0, trading_edgar_filings_1.estimateNextEarnings)(resultsDates, new Date());
    return { nextExpected: estimate, source: estimate ? 'cadence-estimate' : null, pastResults: resultsDates };
}
/**
 * @description Assemble the research report — every section guarded independently.
 * @param s - Caller sub.
 * @param book - The selected book (its rail prices the quote).
 * @param symbol - The ticker.
 * @returns The report.
 */
async function researchSymbol(s, book, symbol) {
    const sections = {};
    const [quote, fundamentals, news, filings] = await Promise.all([
        section('quote', symbol, null, () => quoteFor(book, s, symbol), sections),
        section('fundamentals', symbol, null, () => (0, trading_1.fundamentalsSummary)(symbol), sections),
        section('news', symbol, [], () => (0, trading_1.recentNews)([symbol], NEWS_WINDOW_MIN, NEWS_LIMIT), sections),
        section('filings', symbol, EMPTY_FILINGS, () => filingsFor(symbol), sections),
    ]);
    if (!quote)
        sections.quote = 'unavailable';
    if (!fundamentals)
        sections.fundamentals = 'unavailable';
    const noEarnings = { nextExpected: null, source: null, pastResults: filings.resultsDates };
    const earnings = await section('earnings', symbol, noEarnings, () => earningsFor(symbol, filings.resultsDates), sections);
    return { symbol, book: book.ref, quote, fundamentals, news, filings: filings.summary, events: (0, trading_edgar_filings_1.filingEvents)(filings.summary.recent8K), earnings, sections };
}
/* ─── watchlist ────────────────────────────────────────────────────────────── */
/**
 * @description Create the per-user FORCE-RLS watchlist table (idempotent; runs at first use).
 * @param pool - Postgres pool.
 */
async function ensureWatchlistSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool, moduleName: 'trading watchlist',
        statements: [
            'CREATE TABLE IF NOT EXISTS oshal_trading_watchlist (user_sub TEXT NOT NULL, symbol TEXT NOT NULL, note TEXT, added_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_sub, symbol))',
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_trading_watchlist', 'user_sub'),
        ],
        requirements: [{ table: 'oshal_trading_watchlist', columns: ['user_sub', 'symbol', 'note', 'added_at'] }],
    });
}
/**
 * @description Best-effort latest prices for the watchlist from the SELECTED book's rail. A symbol
 * whose read fails is logged and shown without a quote; dayChangePct stays null (see header).
 * @param book - The selected book.
 * @param s - Caller sub.
 * @param symbols - The watchlist symbols.
 * @returns symbol → quote (absent when unreadable).
 */
async function watchlistQuotes(book, s, symbols) {
    const out = new Map();
    if (!symbols.length)
        return out;
    const md = (0, trading_1.getMarketData)(book.kind, s);
    if (!md.configured())
        return out;
    await Promise.all(symbols.map(async (symbol) => {
        try {
            const price = await md.latestPrice(symbol);
            if (price != null)
                out.set(symbol, { price, dayChangePct: null });
        }
        catch (err) {
            logger.error({ err, symbol, book: book.ref }, 'watchlist quote failed — shown without a price');
        }
    }));
    return out;
}
/** The watchlist row projection. */
function watchlistItem(r, quote) {
    return { symbol: String(r.symbol), note: r.note ?? null, addedAt: new Date(r.added_at).toISOString(), quote };
}
/**
 * @description Registers the research / watchlist / pinned-lot routes on the trading router (ADR-138).
 * @param router - The trading router being composed by createTradingRoutes.
 * @param ctx - App context (Postgres pool).
 * @returns Nothing — routes are registered on the passed router.
 */
function registerTradingResearchRoutes(router, ctx) {
    registerResearchRead(router, ctx);
    registerSymbolSearch(router);
    registerMovers(router, ctx);
    registerWatchlist(router, ctx);
    registerLots(router, ctx);
}
/** GET /research/:symbol — the single-stock report over the SELECTED book's rail. */
function registerResearchRead(router, ctx) {
    router.get('/research/:symbol', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        const symbol = String(req.params.symbol || '').trim().toUpperCase();
        if (!SYMBOL_RE.test(symbol)) {
            res.status(400).json({ error: 'symbol_required', message: 'A ticker symbol is required.' });
            return;
        }
        try {
            const book = await resolveRequestBook(ctx, s, req);
            res.json(await researchSymbol(s, book, symbol));
        }
        catch (err) {
            fail(res, err, 'research');
        }
    });
}
/* ─── symbol search + movers (market-wide; no book needed) ───────────────────── */
/** GET /symbols/search — market-wide type-ahead over the Alpaca asset directory (no book). */
function registerSymbolSearch(router) {
    router.get('/symbols/search', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        const q = String(req.query.q || '').trim();
        if (!q) {
            res.status(400).json({ error: 'query_required', message: 'A search query is required.' });
            return;
        }
        const limit = Math.min(SYMBOL_SEARCH_MAX, Math.max(1, Number(req.query.limit) || SYMBOL_SEARCH_MAX));
        try {
            res.json({ results: await (0, trading_1.searchSymbols)(q, limit) });
        }
        catch (err) {
            fail(res, err, 'symbols-search');
        }
    });
}
/** GET /reports/movers — the honest bounded movers board over oshal's universe + the caller's watchlist. */
function registerMovers(router, ctx) {
    router.get('/reports/movers', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        const kind = String(req.query.kind || 'winners').trim().toLowerCase();
        if (!(0, trading_movers_1.isMoverKind)(kind)) {
            res.status(400).json({ error: 'kind_invalid', message: 'kind must be one of winners, losers, volatile, active.' });
            return;
        }
        const limit = Math.min(MOVERS_MAX_LIMIT, Math.max(1, Number(req.query.limit) || MOVERS_DEFAULT_LIMIT));
        try {
            res.json(await moversReport(ctx, s, kind, limit));
        }
        catch (err) {
            fail(res, err, 'movers');
        }
    });
}
/**
 * @description DEFAULT_UNIVERSE ∪ the caller's watchlist symbols — de-duped, uppercased. Holdings are
 * deliberately out: the price rail is quote-only, so a board claiming holdings would over-state its
 * coverage. The source label states exactly what is included.
 * @param ctx - App context (pool).
 * @param s - Caller sub.
 * @returns The bounded symbol universe.
 */
async function moversUniverse(ctx, s) {
    await ensureWatchlistSchema(ctx.pool);
    const rows = (await ctx.pool.query('SELECT symbol FROM oshal_trading_watchlist WHERE user_sub=$1', [s])).rows;
    const set = new Set(trading_1.DEFAULT_UNIVERSE.map((x) => x.toUpperCase()));
    for (const r of rows)
        set.add(String(r.symbol).toUpperCase());
    return [...set];
}
/**
 * @description Best-effort company/fund name for one returned row from the cached asset directory.
 * A name that cannot be resolved stays null — never invented; a lookup failure is logged, not thrown.
 * @param symbol - The ticker.
 * @returns The exact-match name, or null.
 */
async function nameFor(symbol) {
    try {
        const hit = (await (0, trading_1.searchSymbols)(symbol, 1)).find((h) => h.symbol === symbol);
        return hit ? hit.name : null;
    }
    catch (err) {
        logger.error({ err, symbol }, 'movers name lookup failed — row shown without a name');
        return null;
    }
}
/**
 * @description Attach best-effort names to the returned rows only (≤ limit cheap cached lookups).
 * @param rows - The ranked rows.
 * @returns The rows with a name (or null) each.
 */
async function withNames(rows) {
    return Promise.all(rows.map(async (row) => ({ ...row, name: await nameFor(row.symbol) })));
}
/**
 * @description Build one movers board: the bounded universe, a single daily-bar batch, the PURE
 * ranking, and best-effort names for only the returned rows. Never fabricates — a symbol with no
 * bars is absent, and an empty batch is an honest empty board with a note.
 * @param ctx - App context (pool).
 * @param s - Caller sub.
 * @param kind - The board.
 * @param limit - Max rows.
 * @returns The board payload.
 */
async function moversReport(ctx, s, kind, limit) {
    const universe = await moversUniverse(ctx, s);
    const base = { kind, source: MOVERS_SOURCE, asOf: new Date().toISOString(), universeCount: universe.length };
    const bars = await (0, trading_1.barsBatchOhlcv)(universe, '1Day', MOVERS_BARS);
    if (!bars.size)
        return { ...base, rows: [], note: MOVERS_UNAVAILABLE_NOTE };
    return { ...base, rows: await withNames((0, trading_movers_1.computeMovers)(bars, kind, limit)), note: MOVERS_NOTE };
}
/** The watchlist is PER USER (not per book); only the quotes read the selected book's rail. */
function registerWatchlist(router, ctx) {
    /** GET /watchlist — the caller's symbols with best-effort quotes from the SELECTED book's rail. */
    router.get('/watchlist', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        try {
            await ensureWatchlistSchema(ctx.pool);
            const book = await resolveRequestBook(ctx, s, req);
            const rows = (await ctx.pool.query('SELECT symbol, note, added_at FROM oshal_trading_watchlist WHERE user_sub=$1 ORDER BY added_at DESC', [s])).rows;
            const quotes = await watchlistQuotes(book, s, rows.map((r) => String(r.symbol)));
            res.json({ items: rows.map((r) => watchlistItem(r, quotes.get(String(r.symbol)) ?? null)), book: book.ref });
        }
        catch (err) {
            fail(res, err, 'watchlist-list');
        }
    });
    /** POST /watchlist — add a symbol (201). Re-adding updates the note; an omitted note keeps the old one. */
    router.post('/watchlist', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        const b = (req.body || {});
        const symbol = String(b.symbol || '').trim().toUpperCase();
        if (!SYMBOL_RE.test(symbol)) {
            res.status(400).json({ error: 'symbol_required', message: 'A ticker symbol is required.' });
            return;
        }
        const note = b.note === undefined || b.note === null ? null : String(b.note).trim().slice(0, NOTE_MAX);
        try {
            await ensureWatchlistSchema(ctx.pool);
            const row = (await ctx.pool.query('INSERT INTO oshal_trading_watchlist (user_sub, symbol, note) VALUES ($1,$2,$3) ON CONFLICT (user_sub, symbol) DO UPDATE SET note = COALESCE(EXCLUDED.note, oshal_trading_watchlist.note) RETURNING symbol, note, added_at', [s, symbol, note])).rows[0];
            logger.info({ sub: s, symbol }, 'watchlist symbol added');
            res.status(201).json({ item: watchlistItem(row, null) });
        }
        catch (err) {
            fail(res, err, 'watchlist-add');
        }
    });
    /** DELETE /watchlist/:symbol — remove one symbol. */
    router.delete('/watchlist/:symbol', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        const symbol = String(req.params.symbol || '').trim().toUpperCase();
        if (!SYMBOL_RE.test(symbol)) {
            res.status(400).json({ error: 'symbol_required', message: 'A ticker symbol is required.' });
            return;
        }
        try {
            await ensureWatchlistSchema(ctx.pool);
            const r = await ctx.pool.query('DELETE FROM oshal_trading_watchlist WHERE user_sub=$1 AND symbol=$2', [s, symbol]);
            res.json({ deleted: (r.rowCount ?? 0) > 0, symbol });
        }
        catch (err) {
            fail(res, err, 'watchlist-remove');
        }
    });
}
/** Pinned lots — the SELECTED book's ring-fenced entries and the confirm-gated release. */
function registerLots(router, ctx) {
    /** GET /lots — this book's pinned lots + the pinned share count per symbol (what the autopilot may not touch). */
    router.get('/lots', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        try {
            await (0, trading_pinned_lots_1.ensurePinnedLotsSchema)(ctx.pool);
            const book = await resolveRequestBook(ctx, s, req);
            const [lots, pinned] = await Promise.all([
                (0, trading_pinned_lots_1.listPinnedLots)(ctx.pool, s, { bookId: book.bookId }), (0, trading_pinned_lots_1.pinnedQtyBySymbol)(ctx.pool, s, book.bookId),
            ]);
            res.json({ lots, pinnedBySymbol: Object.fromEntries(pinned), book: book.ref });
        }
        catch (err) {
            fail(res, err, 'lots-list');
        }
    });
    /** POST /lots/:id/release — confirm-gated: cancels the lot's working exits; the shares return to the autopilot. */
    router.post('/lots/:id/release', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        const b = (req.body || {});
        if (b.confirm !== true) {
            res.status(428).json({ error: 'confirm_required', message: RELEASE_CONFIRM_MESSAGE });
            return;
        }
        try {
            await (0, trading_pinned_lots_1.ensurePinnedLotsSchema)(ctx.pool);
            const lot = await (0, trading_pinned_lots_1.releasePinnedLot)(ctx, s, String(req.params.id));
            logger.info({ sub: s, lotId: lot.lotId, status: lot.status }, 'pinned lot released');
            res.json({ lot });
        }
        catch (err) {
            fail(res, err, 'lots-release');
        }
    });
}
//# sourceMappingURL=trading-research-routes.js.map