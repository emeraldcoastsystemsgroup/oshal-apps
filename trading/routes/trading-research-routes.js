"use strict";
/**
 * Single-stock research, watchlist and pinned lots (ADR-138) — the operator's "look at ONE stock"
 * surface over the SELECTED account. The kernel (@/app/trading-pinned-lots) owns the lot store and
 * the leg that watches an entry fill and places its exits; these routes are the operator's view over
 * it plus the research reads the ticket is designed from.
 *
 *   GET    /api/trading/research/:symbol  → quote + fundamentals + news + EDGAR filings/events + next earnings
 *   GET    /api/trading/symbols/search    → market-wide type-ahead over the Alpaca asset directory (no book)
 *   GET    /api/trading/reports/movers    → whole-market movers (Alpaca screener), falling back to the bounded board
 *   GET    /api/trading/reports/congress  → the congressional disclosure feed's recent names, each with its disclosure date (no book)
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
 * The movers board has TWO sources and says which one it used (ADR-143 D5). With a key configured,
 * winners/losers come from the vendor's `screener/stocks/movers` and active from
 * `screener/stocks/most-actives` — the whole US-equity board, labelled "Alpaca screener", carrying
 * the vendor's own `last_updated` rather than a freshness claim of oshal's. 'volatile' has no
 * screener board and stays on the bounded daily-bar computation. Any screener failure — no key, a
 * non-200, an unusable body, an empty board — falls THROUGH to that same bounded report, so the
 * surface degrades instead of blanking.
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
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-143 D5: GET /reports/movers gains the Alpaca REST screener as a SECOND, labelled source — winners/losers from screener/stocks/movers, active from screener/stocks/most-actives, over the whole US-equity board instead of the ~30-symbol bounded universe. The payload carries source 'Alpaca screener', the vendor's own last_updated verbatim, and the filter that ran (minimum price / asset directory) as a stated note; 'volatile' keeps the bounded daily-bar board because the vendor has no such kind. Every screener failure shape (no key, non-200, unusable body, empty board) falls through to the bounded report, which is unchanged — the surface degrades, never blanks.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Add GET /symbols/search (400 query_required, limit capped 25, searchSymbols over the market-wide asset directory — no book) and GET /reports/movers (kind ∈ winners|losers|volatile|active, 400 kind_invalid, limit default 15/cap 50) over the honest bounded universe DEFAULT_UNIVERSE ∪ the caller's watchlist — one daily-bar batch fetch of 30 bars, the PURE computeMovers ranking (trading-movers.ts), best-effort per-row names, an empty batch → an honest empty board with a note, never a fabricated row.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Project feed-only congressional world_metrics points into each caller's owner-scoped watchlist, preserving the Quiver source and disclosure date; unavailable world data stays explicitly unavailable.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | GET /reports/congress lists the names the congressional disclosure feed reported lately (core recentFeedMetricPoints, bounded: limit default 25 / cap 100, 90-day window), each with its disclosure date and when the collector observed it, newest disclosure first. It sits under /reports because /research/:symbol would swallow /research/congress. The surface's Add button posts the existing POST /watchlist with the symbol only, so a watchlist row never stores a holding. The projection now also requires a recorded observedAt: rows written before core recorded it were keyed on the trade day and must not be labelled "disclosed". A core without the read answers 'unavailable', never an error.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Rail guard: the research quote and GET /watchlist quotes ask railConfigured(md) instead of calling md.configured(). The native kernel bridge answers getMarketData with {}, so a watchlist with any symbol answered 502 "md.configured is not a function"; it now answers 200 with every symbol and quote null, the honest state when no market-data source is connected.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Say why a research section is unavailable, and price from the archive when there is no market-data rail. The report carries `reasons` (section → sentence: the host's market_data_not_connected refusal, a refused outbound host, an EDGAR failure) beside `sections`, which the page printed only as a bare "unavailable". With no rail on the selected book, the research quote and the watchlist quotes read the kernel's World price archive (prices.latest via ctx.intent, trading-archive-quotes.js), labelled as a stored price with its own timestamp; a ticker the archive does not track says so.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | With no market-data rail, two more reads use the kernel's World price archive instead of showing nothing: the movers board ranks the universe and the watchlist by their stored day closes (archiveDailyBars: the latest stored price against the previous session's, labelled as the archive's and not live; names stay null, the asset directory is a market-data read), and the watchlist's Today column carries the same stored day change (archiveDayChanges) instead of a dash. A ticker the archive does not track has no row and no change; a failed archive read keeps the existing answers.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Movers distinguishes missing archived prices from insufficient session history without fabricating comparisons or volatility.
 * 10 | maintainer@emeraldcoastsystemsgroup.com   | The archive movers board names each symbol from the SEC company directory (the same 24h-cached ticker table as the CIK lookup); every row had shown a blank NAME. A failed directory read leaves the names null and the board unchanged.
 * 11 | maintainer@emeraldcoastsystemsgroup.com   | The earnings calendar is asked for the lower-case World subject (`world:ticker:nvda`); the upper-case ticker never matched a recorded row, so every next-earnings date fell back to the cadence estimate.
 * 12 | maintainer@emeraldcoastsystemsgroup.com   | Company news on the native kernel reads the World archive's headlines for the ticker (feeds.news, trading-archive-news.js); it had required a Finnhub connection this installation does not have, so news was always unavailable.
 * 13 | maintainer@emeraldcoastsystemsgroup.com   | Company news asks the person's Finnhub connection first and reads the World archive's headlines only when Finnhub does not answer; 1.33.27 had made the archive answer first, skipping a working Finnhub connection (the owner's account showed Finnhub headlines on 1.33.15).
 * 14 | maintainer@emeraldcoastsystemsgroup.com   | The Movers board's whole-market source on the native kernel is Schwab movers across all US equities (readNativeMovers / kernel trading.movers), ahead of the vendor screener and the bounded archive board; BACKLOG T5's screener had no native source.
 * 15 | maintainer@emeraldcoastsystemsgroup.com   | The Schwab movers board merges the S&P 500, NASDAQ and NYSE lists, keeps prices of $5 or more and ranks the rows itself: live, Schwab ordered EQUITY_ALL by volume whatever the sort, so 1.33.39's winners board showed sub-dollar most-active symbols and a -27% row.
 *
 * 2026-10-15 | maintainer@emeraldcoastsystemsgroup.com | Expose authenticated SEC company-name lookup with public cache provenance and explicit unavailable reads.
 * 2026-10-15 | maintainer@emeraldcoastsystemsgroup.com | Native research reads coherent annual SEC financial statements independently of broker connectivity.
 * 16 | maintainer@emeraldcoastsystemsgroup.com | Read source-bound long-term Congress stock candidates through the existing authenticated disclosure route.
 * @module trading-research-routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectCongressSignals = projectCongressSignals;
exports.registerTradingResearchRoutes = registerTradingResearchRoutes;
const trading_congress_candidates_1 = require("./trading-congress-candidates");
const trading_native_reads_1 = require("./trading-native-reads");
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const trading_1 = require("@/features/trading");
const world_data_1 = require("@/features/world-data");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const trading_pinned_lots_1 = require("@/app/trading-pinned-lots");
const trading_movers_1 = require("./trading-movers");
const trading_edgar_filings_1 = require("./trading-edgar-filings");
const trading_rail_guard_1 = require("./trading-rail-guard");
const trading_sec_financial_reader_1 = require("./trading-sec-financial-reader");
const trading_company_news_1 = require("./trading-company-news");
const trading_archive_news_1 = require("./trading-archive-news");
const trading_archive_quotes_1 = require("./trading-archive-quotes");
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
/** The movers board's source and note when it ranks the World archive's stored day closes. */
const MOVERS_ARCHIVE_SOURCE = 'oshal universe + your watchlist (World price archive)';
const MOVERS_ARCHIVE_NOTE = 'From oshal\'s World price archive (Yahoo chart, collected on its own schedule): each name\'s latest stored price against the previous session\'s last stored price. Not live quotes.';
/** Ask the screener for more rows than the board shows, because the stated filters remove some. */
const MOVERS_SCREENER_OVERFETCH = 3;
/** What the screener board actually spans — printed beside the vendor's label, never implied. */
const MOVERS_SCREENER_SCOPE = 'Whole US-equity board from the Alpaca screener.';
/** The Schwab movers lists the native board merges, and the price floor the vendor screener also used. */
const SCHWAB_MOVERS_INDEXES = ['$SPX', 'NASDAQ', 'NYSE'];
const MOVERS_MIN_PRICE = 5;
const CONGRESS_METRICS = ['congress_buys', 'congress_sells', 'congress_net', 'congress_sentiment', 'congress_notional'];
const CONGRESS_SOURCE = 'quiver-congress';
/** GET /reports/congress: default and maximum names, and the disclosure window it reads. */
const CONGRESS_LIST_DEFAULT = 25;
const CONGRESS_LIST_MAX = 100;
const CONGRESS_WINDOW_DAYS = 90;
const CONGRESS_NOTE = 'Congressional (STOCK Act) disclosures from the Quiver feed. The date is the day the trade was reported, which can be up to ~45 days after the trade. Adding a name to your watchlist stores only the symbol.';
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
async function section(name, symbol, fallback, run, sections, reasons) {
    try {
        const value = await run();
        sections[name] = 'ok';
        return value;
    }
    catch (err) {
        logger.error({ err, symbol, section: name }, 'research section failed — reported unavailable');
        sections[name] = 'unavailable';
        if (reasons)
            reasons[name] = (0, trading_archive_quotes_1.sectionReason)(name, err, trading_routes_helpers_1.TradingError);
        return fallback;
    }
}
/* ─── research sections ────────────────────────────────────────────────────── */
/**
 * @description The latest print from THIS book's market-data rail with its exchange timestamp
 * (latestTrade), falling back to the freshness-blind latestPrice stamped now. With no rail, the
 * World archive's last stored price (labelled) when the host has one, else the rail's refusal.
 * @param ctx - App context (ctx.intent reaches the price archive).
 * @param book - The selected book.
 * @param s - Caller sub.
 * @param symbol - The ticker.
 * @returns The quote, or null when the rail is not configured or has no print.
 */
async function quoteFor(ctx, book, s, symbol) {
    const md = (0, trading_1.getMarketData)(book.kind, s);
    if (!(0, trading_rail_guard_1.railConfigured)(md)) {
        if ((0, trading_archive_quotes_1.archiveAvailable)(ctx))
            return (0, trading_archive_quotes_1.archiveQuote)(ctx, symbol, trading_routes_helpers_1.TradingError);
        const reason = md?.notConnectedReason;
        throw new trading_routes_helpers_1.TradingError(503, 'market_data_not_connected', reason || 'No market-data source is connected for this account.');
    }
    const native = md;
    if (native.quoteDetails) {
        const q = await native.quoteDetails(symbol);
        const asOf = q.tradeAt || q.quoteAt;
        return q.price != null && asOf ? { price: q.price, asOf, source: 'schwab', note: q.delayed ? 'Delayed Schwab quote.' : 'Schwab quote at the reported exchange time.' } : null;
    }
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
    return (0, trading_edgar_filings_1.cikFromTickerTable)(await secTickerTable(), symbol);
}
/** The SEC ticker table, cached in-module for 24h (shared by the CIK lookup and the movers names). */
async function secTickerTable() {
    if (!tickerTable || Date.now() - tickerTable.at > trading_edgar_filings_1.EDGAR_TICKER_CACHE_MS) {
        tickerTable = { at: Date.now(), table: await edgarJson(trading_edgar_filings_1.EDGAR_TICKERS_URL) };
    }
    return tickerTable.table;
}
/** Native financial statements are public SEC evidence, independent of broker connectivity. */
async function financialsFor(symbol) {
    if (!(0, trading_native_reads_1.nativeSchwabReads)())
        return (0, trading_1.fundamentalsSummary)(symbol);
    const cik = await cikForSymbol(symbol);
    if (!cik)
        throw new Error('No SEC company identity was found for this ticker.');
    return (0, trading_sec_financial_reader_1.readSecFinancialSummary)(cik, symbol);
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
        // World subjects are lower-case (`world:ticker:txn`); the upper-case ticker never matched a calendar row.
        const events = await svc.upcomingEvents(CALENDAR_DAYS, `world:ticker:${symbol.toLowerCase()}`);
        const hit = events.find((e) => e.eventType === 'earnings');
        return hit ? hit.scheduledAt.slice(0, 10) : null;
    }
    catch (err) {
        logger.error({ err, symbol }, 'world calendar earnings read failed — falling back to the cadence estimate');
        return null;
    }
}
/**
 * @description Company news: the person's Finnhub connection when it answers, else the World archive's headlines
 * (native kernel), else the platform rail. A Finnhub failure with no archive keeps its own reason.
 * @param ctx - App context.
 * @param symbol - The ticker.
 * @returns The headlines and their coverage.
 */
async function newsFor(ctx, symbol) {
    if (!(0, trading_native_reads_1.nativeSchwabReads)()) {
        if ((0, trading_archive_quotes_1.archiveAvailable)(ctx))
            return (0, trading_archive_news_1.readArchiveNews)(ctx, symbol);
        return { items: await (0, trading_1.recentNews)([symbol], NEWS_WINDOW_MIN, NEWS_LIMIT), coverage: null };
    }
    try {
        return await (0, trading_company_news_1.readCompanyNews)(symbol);
    }
    catch (err) {
        if (!(0, trading_archive_quotes_1.archiveAvailable)(ctx))
            throw err;
        logger.info({ symbol, reason: err.message }, 'Finnhub company news unavailable - reading the World archive headlines');
        // When the archive cannot answer either, the page keeps Finnhub's own reason (the connection the person can fix).
        try {
            return await (0, trading_archive_news_1.readArchiveNews)(ctx, symbol);
        }
        catch {
            throw err;
        }
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
 * @description Assemble the research report — every section guarded independently; `reasons`
 * says in words why each unavailable section is unavailable.
 * @param ctx - App context.
 * @param s - Caller sub.
 * @param book - The selected book (its rail prices the quote).
 * @param symbol - The ticker.
 * @returns The report.
 */
async function researchSymbol(ctx, s, book, symbol) {
    const sections = {}, reasons = {};
    const [quote, fundamentals, newsRead, filings] = await Promise.all([
        section('quote', symbol, null, () => quoteFor(ctx, book, s, symbol), sections, reasons),
        section('fundamentals', symbol, null, () => financialsFor(symbol), sections, reasons),
        section('news', symbol, { items: [], coverage: null }, () => newsFor(ctx, symbol), sections, reasons),
        section('filings', symbol, EMPTY_FILINGS, () => filingsFor(symbol), sections, reasons),
    ]);
    if (!quote && sections.quote === 'ok') {
        sections.quote = 'unavailable';
        reasons.quote = 'The market-data rail has no recent print for ' + symbol + '.';
    }
    if (!fundamentals && sections.fundamentals === 'ok') {
        sections.fundamentals = 'unavailable';
        reasons.fundamentals = 'No fundamentals were returned for ' + symbol + '.';
    }
    const noEarnings = { nextExpected: null, source: null, pastResults: filings.resultsDates };
    const earnings = await section('earnings', symbol, noEarnings, () => earningsFor(symbol, filings.resultsDates), sections, reasons);
    return { symbol, book: book.ref, quote, fundamentals, news: newsRead.items, newsCoverage: newsRead.coverage, filings: filings.summary, events: (0, trading_edgar_filings_1.filingEvents)(filings.summary.recent8K), earnings, sections, reasons };
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
 * whose read fails is logged and shown without a quote; dayChangePct stays null (see header). With no
 * rail, the World archive's last stored prices (labelled) when the host has the archive.
 * @param ctx - App context.
 * @param book - The selected book.
 * @param s - Caller sub.
 * @param symbols - The watchlist symbols.
 * @returns symbol → quote (absent when unreadable).
 */
async function watchlistQuotes(ctx, book, s, symbols) {
    const out = new Map();
    if (!symbols.length)
        return out;
    const md = (0, trading_1.getMarketData)(book.kind, s);
    if (!(0, trading_rail_guard_1.railConfigured)(md)) {
        if (!(0, trading_archive_quotes_1.archiveAvailable)(ctx))
            return out;
        try {
            const upper = symbols.map((x) => x.toUpperCase());
            const [quotes, changes] = await Promise.all([(0, trading_archive_quotes_1.archiveQuotes)(ctx, upper), (0, trading_archive_quotes_1.archiveDayChanges)(ctx, upper).catch(() => new Map())]);
            for (const [symbol, q] of quotes)
                out.set(symbol, { ...q, dayChangePct: changes.get(symbol) ?? null });
        }
        catch (err) {
            logger.error({ err, book: book.ref }, 'watchlist archive quotes failed — shown without a price');
        }
        return out;
    }
    const native = md;
    if (native.quotes) {
        for (let start = 0; start < symbols.length; start += 50) {
            try {
                for (const q of await native.quotes(symbols.slice(start, start + 50))) {
                    if (q.price == null)
                        continue;
                    const stamp = q.tradeAt || q.quoteAt;
                    out.set(q.symbol, { price: q.price, dayChangePct: q.priorClose && q.priorClose > 0 ? (q.price - q.priorClose) / q.priorClose * 100 : null,
                        ...(stamp ? { asOf: stamp } : {}), source: 'schwab', note: q.delayed ? 'Delayed Schwab quote.' : 'Schwab quote at the reported exchange time.' });
                }
            }
            catch (err) {
                logger.error({ err, book: book.ref }, 'Schwab watchlist quotes unavailable');
            }
        }
        return out;
    }
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
function watchlistItem(r, quote, congress = null) {
    return { symbol: String(r.symbol), note: r.note ?? null, addedAt: new Date(r.added_at).toISOString(), quote, congress };
}
/**
 * @description Project only feed-authored, provenance-complete points into the congressional read
 * model. A point is dropped unless it carries the quiver-congress source AND a recorded observedAt:
 * rows written before core recorded observed_at were keyed on the trade day, so labelling their date
 * "disclosed" would be false.
 * @param points - Latest or recent world metric points.
 * @returns Symbol → the signal with its disclosure date and observation time.
 */
function projectCongressSignals(points) {
    const bySymbol = new Map();
    for (const point of points) {
        if (point.source !== CONGRESS_SOURCE || !point.observedAt)
            continue;
        const match = /^world:ticker:([a-z.\-]+)$/i.exec(point.entity);
        if (!match || !CONGRESS_METRICS.includes(point.metric))
            continue;
        const symbol = match[1].toUpperCase();
        const current = bySymbol.get(symbol) || {};
        const field = point.metric.replace('congress_', '');
        if (field === 'buys' || field === 'sells' || field === 'net' || field === 'sentiment' || field === 'notional')
            current[field] = point.value;
        if (!current.disclosureDate || point.ts > current.disclosureDate)
            current.disclosureDate = point.ts;
        if (!current.observedAt || point.observedAt > current.observedAt)
            current.observedAt = point.observedAt;
        bySymbol.set(symbol, current);
    }
    return new Map([...bySymbol.entries()].map(([symbol, row]) => [symbol, {
            buys: row.buys ?? null, sells: row.sells ?? null, net: row.net ?? null,
            sentiment: row.sentiment ?? null, notional: row.notional ?? null,
            disclosureDate: row.disclosureDate, observedAt: row.observedAt, source: CONGRESS_SOURCE,
        }]));
}
async function watchlistCongress(symbols) {
    const out = new Map();
    if (!symbols.length)
        return out;
    const svc = (0, world_data_1.createWorldIntelligenceService)();
    if (!svc)
        return out;
    try {
        const entities = symbols.map((symbol) => `world:ticker:${symbol.toLowerCase()}`);
        return projectCongressSignals(await svc.latestMetricPoints(entities, [...CONGRESS_METRICS]));
    }
    catch (err) {
        logger.error({ err }, 'watchlist congressional signal read failed — shown without feed data');
        return out;
    }
}
/**
 * @description The names the congressional disclosure feed reported lately, newest disclosure first.
 * Every failure shape answers 'unavailable' with rows [] — world off, a core that predates the read,
 * or a read error (logged) — so the surface says so instead of blanking or inventing a list.
 * Supports granular trade filtering by politician, symbol, party, chamber, or view mode.
 * @param limit - Maximum names (already clamped by the handler).
 * @param opts - Granular filter options for bots and UI.
 * @returns The list payload, labelled with its source and window.
 */
async function congressDisclosures(limit, opts = {}) {
    const base = { source: CONGRESS_SOURCE, windowDays: CONGRESS_WINDOW_DAYS, note: CONGRESS_NOTE };
    const svc = (0, world_data_1.createWorldIntelligenceService)();
    if (!svc)
        return { ...base, status: 'unavailable', reason: 'World intelligence is not enabled on this deployment.', rows: [] };
    if (typeof svc.recentFeedMetricPoints !== 'function') {
        return { ...base, status: 'unavailable', reason: 'This core does not provide dated disclosure reads yet.', rows: [] };
    }
    try {
        const isGranularFilter = Boolean(opts.view === 'trades' || opts.politician || opts.party || opts.chamber || opts.direction);
        let trades = [];
        if (typeof svc.queryCongressTrades === 'function') {
            try {
                trades = await svc.queryCongressTrades({
                    representative: opts.politician,
                    ticker: opts.symbol,
                    party: opts.party,
                    chamber: opts.chamber,
                    direction: opts.direction,
                    sinceDays: CONGRESS_WINDOW_DAYS,
                    limit,
                });
            }
            catch (err) {
                logger.warn({ err }, 'queryCongressTrades read failed, continuing with summary metrics');
            }
        }
        if (isGranularFilter && trades.length > 0) {
            return { ...base, status: 'ok', view: 'trades', count: trades.length, trades, rows: [] };
        }
        const points = await svc.recentFeedMetricPoints([...CONGRESS_METRICS], CONGRESS_SOURCE, CONGRESS_WINDOW_DAYS, limit);
        const rows = [...projectCongressSignals(points).entries()]
            .map(([symbol, signal]) => ({ symbol, ...signal }))
            .sort((a, b) => b.disclosureDate.localeCompare(a.disclosureDate) || a.symbol.localeCompare(b.symbol))
            .slice(0, limit);
        return { ...base, status: 'ok', rows, trades };
    }
    catch (err) {
        logger.error({ err }, 'congressional disclosure list read failed — shown as unavailable');
        return { ...base, status: 'unavailable', reason: 'The disclosure feed could not be read right now.', rows: [] };
    }
}
/** GET /reports/congress — the disclosure feed's recent names; market-wide, no book, never a holding. */
function registerCongressDisclosures(router, ctx) {
    router.get('/reports/congress', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        const limit = Math.min(CONGRESS_LIST_MAX, Math.max(1, Math.floor(Number(req.query.limit)) || CONGRESS_LIST_DEFAULT));
        const politician = typeof req.query.politician === 'string' ? req.query.politician.trim() : undefined;
        const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : undefined;
        const party = typeof req.query.party === 'string' ? req.query.party.trim() : undefined;
        const chamber = typeof req.query.chamber === 'string' ? req.query.chamber.trim() : undefined;
        const direction = typeof req.query.direction === 'string' ? req.query.direction.trim() : undefined;
        const view = typeof req.query.view === 'string' ? req.query.view.trim() : undefined;
        try {
            if (req.query.candidate === 'long-term') {
                res.json(await (0, trading_congress_candidates_1.readCongressCandidates)(ctx));
                return;
            }
            res.json(await congressDisclosures(limit, { limit, view, politician, symbol, party, chamber, direction }));
        }
        catch (err) {
            fail(res, err, 'congress-disclosures');
        }
    });
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
    registerCongressDisclosures(router, ctx);
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
            res.json(await researchSymbol(ctx, s, book, symbol));
        }
        catch (err) {
            fail(res, err, 'research');
        }
    });
}
/* ─── symbol search + movers (market-wide; no book needed) ───────────────────── */
/** GET /symbols/search — market-wide type-ahead over the Alpaca asset directory (no book). */
function registerSymbolSearch(router) {
    router.get('/companies/search', async (req, res) => {
        const s = sub(req, res);
        if (!s)
            return;
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!q || q.length > 80 || !/[\p{L}\p{N}]/u.test(q)) {
            res.status(400).json({ error: 'company_query_invalid', message: 'Enter a company name or ticker of 1–80 characters.' });
            return;
        }
        try {
            if (!tickerTable || Date.now() - tickerTable.at > trading_edgar_filings_1.EDGAR_TICKER_CACHE_MS) {
                const table = await edgarJson(trading_edgar_filings_1.EDGAR_TICKERS_URL);
                (0, trading_edgar_filings_1.companyMatches)(table, q); // Validate before publishing a shared directory cache.
                tickerTable = { at: Date.now(), table };
            }
            const results = (0, trading_edgar_filings_1.companyMatches)(tickerTable.table, q);
            res.json({ query: q, results, source: 'sec-company-directory', fetchedAt: new Date(tickerTable.at).toISOString(), cacheAgeMs: Math.max(0, Date.now() - tickerTable.at), note: 'SEC company and ticker identity directory; this does not verify broker tradability, a current quote or company financials.' });
        }
        catch (err) {
            tickerTable = null;
            logger.error({ err }, 'SEC company lookup unavailable');
            res.status(503).json({ error: 'company_directory_unavailable', message: 'The SEC company directory could not be read. Retry or supply a known ticker.' });
        }
    });
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
 * Shape-agnostic on purpose: a screener row carries nulls where the vendor said nothing, which the
 * pure bounded row type does not allow — and casting those to a number would be a lie in the types.
 * @param rows - The ranked rows (anything carrying a symbol).
 * @returns The same rows, each with a name (or null).
 */
async function withNames(rows) {
    return Promise.all(rows.map(async (row) => ({ ...row, name: await nameFor(row.symbol) })));
}
/**
 * @description The movers board: the whole-market screener when it answers, the bounded daily-bar
 * board when it does not. The fallback is unconditional — every screener failure shape lands here,
 * so the surface degrades to a smaller honest board and never to a blank one.
 * @param ctx - App context (pool).
 * @param s - Caller sub.
 * @param kind - The board.
 * @param limit - Max rows.
 * @returns The board payload, labelled with the source that actually produced it.
 */
async function moversReport(ctx, s, kind, limit) {
    return (await schwabMoversReport(ctx, kind, limit)) ?? (await screenerMoversReport(kind, limit)) ?? boundedMoversReport(ctx, s, kind, limit);
}
/**
 * @description The whole-market board from the person's Schwab connection on the native kernel (Schwab movers across
 * all US equities), or null to fall back: no Schwab rail, the 'volatile' board (Schwab has none), a refused read or an
 * empty board.
 * @param ctx - App context.
 * @param kind - The board.
 * @param limit - Max rows.
 * @returns The board payload, or null.
 */
async function schwabMoversReport(ctx, kind, limit) {
    if (kind === 'volatile' || !(0, trading_native_reads_1.nativeSchwabReads)())
        return null;
    const sort = kind === 'active' ? 'VOLUME' : kind === 'winners' ? 'PERCENT_CHANGE_UP' : 'PERCENT_CHANGE_DOWN';
    // Schwab answers at most ten movers per index and, live on 2026-10-16, ordered EQUITY_ALL by volume whatever the sort.
    // So the board merges three equity lists, keeps the screener's $5 floor and ranks the rows itself.
    const seen = new Map();
    let answered = false;
    for (const index of SCHWAB_MOVERS_INDEXES) {
        let movers;
        try {
            movers = await (0, trading_native_reads_1.readNativeMovers)(ctx, sort, index);
        }
        catch (err) {
            logger.info({ kind, index, reason: err.message }, 'Schwab movers index unavailable');
            continue;
        }
        if (!movers)
            return null;
        answered = true;
        for (const m of movers) {
            if (!(m.price >= MOVERS_MIN_PRICE) || seen.has(m.symbol))
                continue;
            seen.set(m.symbol, { symbol: m.symbol, name: m.name || null, price: m.price, changePct: m.changePct, dayVolume: m.volume, volatilityPct: null });
        }
    }
    if (!answered || !seen.size)
        return null;
    const pct = (r) => r.changePct ?? 0;
    const rows = [...seen.values()]
        .filter((r) => kind === 'active' || (kind === 'winners' ? pct(r) > 0 : pct(r) < 0))
        .sort((a, b) => kind === 'active' ? (b.dayVolume ?? 0) - (a.dayVolume ?? 0) : kind === 'winners' ? pct(b) - pct(a) : pct(a) - pct(b))
        .slice(0, limit);
    if (!rows.length)
        return null;
    return { kind, source: 'Schwab movers (S&P 500, NASDAQ and NYSE)', asOf: new Date().toISOString(), lastUpdated: null, filter: { minPrice: MOVERS_MIN_PRICE },
        rows, note: `Schwab's movers for the S&P 500, NASDAQ and NYSE through your Schwab connection (at most ten per list), priced at $${MOVERS_MIN_PRICE} or above, ranked here by ${kind === 'active' ? 'volume' : 'percent change'}; percent is computed from Schwab's net change and last price.` };
}
/**
 * @description The whole-market board from the vendor's REST screener, or null to fall back. Returns
 * null for 'volatile' (the vendor has no such board), for every screener failure, and for an empty
 * board — an empty answer is a fallback trigger, not a result worth showing.
 * @param kind - The board.
 * @param limit - Max rows.
 * @returns The screener payload, or null when the caller must fall back.
 */
async function screenerMoversReport(kind, limit) {
    if (kind === 'volatile' || !(0, trading_1.marketDataConfigured)() || (0, trading_native_reads_1.nativeSchwabReads)())
        return null;
    const top = limit * MOVERS_SCREENER_OVERFETCH;
    const board = kind === 'active'
        ? await (0, trading_1.screenerMostActives)('volume', top)
        : await (0, trading_1.screenerMovers)(kind === 'winners' ? 'gainers' : 'losers', top);
    if (!board || !board.rows.length)
        return null;
    const rows = board.rows.slice(0, limit).map((r) => ({
        symbol: r.symbol, price: r.price, changePct: r.changePct, dayVolume: r.dayVolume, volatilityPct: null,
    }));
    return {
        kind, source: trading_1.SCREENER_LABEL, asOf: new Date().toISOString(), lastUpdated: board.lastUpdated,
        filter: board.filter, rows: await withNames(rows), note: screenerNote(kind, board.filter),
    };
}
/**
 * @description State exactly what filtered the screener board, per board — the minimum price cannot
 * apply to most-actives rows, which the vendor sends without a price, and the asset-directory filter
 * does not run at all when the directory is unreachable. Both are said, never implied.
 * @param kind - The board.
 * @param filter - What the screener reported it applied.
 * @returns The surface note.
 */
function screenerNote(kind, filter) {
    const price = kind === 'active'
        ? `Most-active rows carry the vendor's volume and no price, so the $${filter.minPrice} minimum could not be applied to them.`
        : `Filtered to symbols the vendor priced at $${filter.minPrice} or above.`;
    const directory = filter.assetDirectory
        ? 'Limited to the active tradable asset directory.'
        : 'The asset directory was unreachable, so that filter did not run.';
    return `${MOVERS_SCREENER_SCOPE} ${price} ${directory}`;
}
/**
 * @description Build the bounded movers board: the bounded universe, a single daily-bar batch, the
 * PURE ranking, and best-effort names for only the returned rows. Never fabricates — a symbol with
 * no bars is absent, and an empty batch is an honest empty board with a note.
 * @param ctx - App context (pool).
 * @param s - Caller sub.
 * @param kind - The board.
 * @param limit - Max rows.
 * @returns The board payload.
 */
async function boundedMoversReport(ctx, s, kind, limit) {
    const universe = await moversUniverse(ctx, s);
    if ((!(0, trading_1.marketDataConfigured)() || (0, trading_native_reads_1.nativeSchwabReads)()) && (0, trading_archive_quotes_1.archiveAvailable)(ctx))
        return archiveMoversReport(ctx, kind, limit, universe);
    const base = { kind, source: MOVERS_SOURCE, asOf: new Date().toISOString(), universeCount: universe.length };
    const bars = await (0, trading_1.barsBatchOhlcv)(universe, '1Day', MOVERS_BARS);
    if (!bars.size)
        return { ...base, rows: [], note: MOVERS_UNAVAILABLE_NOTE };
    return { ...base, rows: await withNames((0, trading_movers_1.computeMovers)(bars, kind, limit)), note: MOVERS_NOTE };
}
/**
 * @description The movers board from the World archive's stored day closes (no market-data rail on this host).
 * Names come from the SEC company directory (public, no market-data rail); a failed directory read leaves them null.
 * An empty archive is an honest empty board.
 * @param ctx - App context (its intent call reads prices.series).
 * @param kind - The board.
 * @param limit - Max rows.
 * @param universe - The tickers to rank (the default universe plus the caller's watchlist).
 * @returns The board payload, labelled as the archive's.
 */
async function archiveMoversReport(ctx, kind, limit, universe) {
    const base = { kind, source: MOVERS_ARCHIVE_SOURCE, asOf: new Date().toISOString(), universeCount: universe.length };
    const bars = await (0, trading_archive_quotes_1.archiveDailyBars)(ctx, universe, MOVERS_BARS + 15);
    if (!bars.size)
        return { ...base, rows: [], note: 'No stored daily prices for this universe in the requested window. ' + MOVERS_ARCHIVE_NOTE };
    // computeMovers reads only each bar's close and volume; the archive keeps one price per day, never an open/high/low.
    const closes = bars;
    let names = new Map();
    try {
        names = (0, trading_edgar_filings_1.namesFromTickerTable)(await secTickerTable(), [...bars.keys()]);
    }
    catch (err) {
        logger.warn({ err }, 'SEC company directory read failed — movers names stay blank');
    }
    const rows = (0, trading_movers_1.computeMovers)(closes, kind, limit).map((row) => ({ ...row, name: names.get(String(row.symbol).toUpperCase()) ?? null }));
    const shortage = rows.length ? '' : kind === 'volatile'
        ? 'Not enough stored daily history to calculate volatility for this universe yet. '
        : 'Not enough stored daily history to compare sessions for this universe yet. ';
    return { ...base, rows, note: shortage + MOVERS_ARCHIVE_NOTE };
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
            const symbols = rows.map((r) => String(r.symbol));
            const [quotes, congress] = await Promise.all([watchlistQuotes(ctx, book, s, symbols), watchlistCongress(symbols)]);
            res.json({ items: rows.map((r) => watchlistItem(r, quotes.get(String(r.symbol)) ?? null, congress.get(String(r.symbol).toUpperCase()) ?? null)), book: book.ref });
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
