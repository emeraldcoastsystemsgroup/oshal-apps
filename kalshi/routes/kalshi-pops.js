"use strict";
/**
 * Kalshi "pops" — price since announced, for the alerts that have not settled yet.
 *
 * An alert says "this hand cleared your floor at 38c". Until the market settles, the only honest
 * follow-up question is: has the market moved TOWARD the pick or away from it? That is what this
 * module answers, from Kalshi's own candlesticks — the announced ask on OUR side versus the latest
 * candle's price on the same side, in cents, with the direction stated rather than implied.
 *
 * Three things make this safe to call from a surface:
 *   - it is BOUNDED (at most POP_MAX_MARKETS markets per read — the public tier is ~3 rps and the
 *     background scan already spends it),
 *   - it is SPACED (POP_MIN_INTERVAL_MS between candle reads, tracked in the cache so two callers
 *     back to back still queue behind each other),
 *   - it is CACHED (POP_CACHE_TTL_MS), and one market's failure is counted, never thrown — a 429
 *     on the ninth ticker must not blank the other eight.
 *
 * The cache holds the MARKET's price, never a caller's derived Pop. There is one cache for the whole
 * process and it is keyed by ticker, so anything caller-specific in it is served to the next caller:
 * a Pop carries the announced price and the side THIS caller picked, and two users are routinely
 * alerted on one ticker at different prices. Every other read here is caller-scoped; the cache must
 * not be the one place that is not.
 *
 * The candle reader is INJECTED (`CandleReader`), so this module has no framework import and runs
 * under the plain-node suites like kalshi-trends does; the route hands it the framework's real
 * `getCandles`. Only SELECTs.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — open-alert read, side-aware price math over the
 *                     |                             | latest candle (mid, else close, else mean), and a bounded,
 *                     |                             | spaced, cached fetch that degrades per market instead of
 *                     |                             | failing the request.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Close a cross-user leak: the ONE per-process cache keyed a
 *                     |                             | fully derived Pop by ticker alone, so the announced price
 *                     |                             | and side of whichever caller read the market first were
 *                     |                             | served to every later caller on that ticker (reachable in
 *                     |                             | normal use — first-seen dedup is per user, so two users
 *                     |                             | alerted in different scan cycles carry different prices).
 *                     |                             | The cache now holds only the MARKET's latest price, which
 *                     |                             | IS shareable, and popFrom runs per caller against it — so
 *                     |                             | one vendor fetch per ticker still serves everyone and the
 *                     |                             | caller-specific half is never stored.
 *
 * @module kalshi-pops
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.POP_MAX_SPAN_DAYS = exports.POP_CACHE_TTL_MS = exports.POP_MIN_INTERVAL_MS = exports.POP_MAX_MARKETS = void 0;
exports.createPopCache = createPopCache;
exports.sidePrice = sidePrice;
exports.candleYesPrice = candleYesPrice;
exports.latestYesPrice = latestYesPrice;
exports.popFrom = popFrom;
exports.candleWindow = candleWindow;
exports.readOpenAlerts = readOpenAlerts;
exports.seriesFromTicker = seriesFromTicker;
exports.fetchPops = fetchPops;
/** At most this many candle reads per request — the public tier is shared with the scan. */
exports.POP_MAX_MARKETS = 12;
/** Minimum gap between candle reads, ms. ~2.9 rps, under the documented ~3 rps public tier. */
exports.POP_MIN_INTERVAL_MS = 350;
/** How long a priced market stays good for. */
exports.POP_CACHE_TTL_MS = 5 * 60 * 1000;
/** Never ask for more than this much history in one candle window. */
exports.POP_MAX_SPAN_DAYS = 30;
/**
 * @description Make an empty pop cache.
 * @returns A fresh cache with no entries and no recorded call.
 */
function createPopCache() {
    return { entries: new Map(), lastCallMs: 0 };
}
/**
 * @description Translate a YES price into the price of the side that was actually picked.
 * @param yesPrice - Price of the YES side, 0..1.
 * @param side - The picked side.
 * @returns The picked side's price.
 */
function sidePrice(yesPrice, side) {
    return side === 'yes' ? yesPrice : 1 - yesPrice;
}
/**
 * @description The YES price a single candle implies, preferring the book mid (both sides quoted)
 * over the last trade, and the last trade over the period mean — a mid is the market's price now,
 * a trade may be minutes stale, and the mean is an average of the whole period.
 * @param candle - One candlestick.
 * @returns The price and where it came from, or null when the candle quotes nothing usable.
 */
function candleYesPrice(candle) {
    const bid = candle.yesBidClose;
    const ask = candle.yesAskClose;
    if (usable(bid) && usable(ask))
        return { price: (bid + ask) / 2, basis: 'mid' };
    if (usable(candle.close))
        return { price: candle.close, basis: 'close' };
    if (usable(candle.mean))
        return { price: candle.mean, basis: 'mean' };
    return null;
}
/** A price is usable when it is a finite number inside the contract's own 0..1 range. */
function usable(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}
/**
 * @description The most recent candle that quotes a usable price. Kalshi returns candles oldest
 * first, and a thin market's last candles can be empty, so this walks BACKWARD rather than taking
 * the final element.
 * @param candles - Candles as returned by the reader.
 * @returns The newest usable price, its basis and its candle end, or null.
 */
function latestYesPrice(candles) {
    for (let i = candles.length - 1; i >= 0; i -= 1) {
        const c = candles[i];
        const p = candleYesPrice(c);
        if (p)
            return { price: p.price, basis: p.basis, endPeriodTs: c.endPeriodTs };
    }
    return null;
}
/**
 * @description Fold an open alert and the market's latest price into a pop. Run PER CALLER — every
 * field it returns except the basis and the as-of is that caller's own hand, so its result must not
 * be memoized anywhere a second caller can reach it.
 * @param alert - The announced hand.
 * @param latest - The newest usable YES price, from latestYesPrice.
 * @returns The pop, or null when the announced price is unusable (nothing to move FROM).
 */
function popFrom(alert, latest) {
    const announced = alert.announcedPrice;
    if (!usable(announced))
        return null;
    const from = announced;
    const current = sidePrice(latest.price, alert.side);
    const move = current - from;
    return {
        ticker: alert.ticker,
        side: alert.side,
        announcedPrice: from,
        currentPrice: current,
        moveCents: move * 100,
        moveFraction: from > 0 ? move / from : null,
        toward: move > 0,
        basis: latest.basis,
        asOf: Number.isFinite(latest.endPeriodTs) && latest.endPeriodTs > 0
            ? new Date(latest.endPeriodTs * 1000).toISOString() : null,
    };
}
/**
 * @description The candle range to ask for: from the announcement to now, never more than
 * POP_MAX_SPAN_DAYS of hourly candles, and never an inverted range.
 * @param announcedAt - When the hand was announced, ISO.
 * @param nowMs - Now, ms.
 * @returns Epoch-second bounds and the hourly period interval.
 */
function candleWindow(announcedAt, nowMs) {
    const endTs = Math.floor(nowMs / 1000);
    const announcedMs = Date.parse(announcedAt);
    const floorMs = nowMs - exports.POP_MAX_SPAN_DAYS * 86_400_000;
    const fromMs = Number.isFinite(announcedMs) ? Math.max(announcedMs, floorMs) : floorMs;
    const startTs = Math.min(endTs, Math.floor(fromMs / 1000));
    return { startTs, endTs, periodInterval: 60 };
}
/**
 * @description The caller's announced hands whose market has not settled — the only ones a "price
 * since announced" means anything for. Joined to the pre-registration the alert was recorded as,
 * which is where the series ticker lives; `detail` carries what was actually announced, so it wins
 * over the ledger row when both are present.
 * @param pool - Postgres pool.
 * @param userSub - Caller.
 * @param strategy - The strategy alerts are pre-registered under.
 * @param limit - Row cap.
 * @returns Open alerts, newest first.
 */
async function readOpenAlerts(pool, userSub, strategy, limit = 50) {
    const { rows } = await pool.query(`SELECT a.ticker, a.detail, a.created_at,
            p.series_ticker, p.side AS ledger_side, p.market_prob::float AS ledger_price
       FROM kalshi_scan_alerts a
       LEFT JOIN kalshi_predictions p ON p.ticker = a.ticker AND p.strategy = $2
      WHERE a.user_sub = $1 AND (p.settled IS NOT TRUE)
      ORDER BY a.created_at DESC LIMIT $3`, [userSub, strategy, Math.min(200, Math.max(1, limit))]);
    return rows.map((r) => {
        const detail = (r.detail && typeof r.detail === 'object' ? r.detail : {});
        const side = detail.side === 'no' || r.ledger_side === 'no' ? 'no' : 'yes';
        const announced = Number(detail.price);
        const ledger = Number(r.ledger_price);
        return {
            ticker: String(r.ticker),
            seriesTicker: r.series_ticker ? String(r.series_ticker) : seriesFromTicker(String(r.ticker)),
            side: side,
            announcedPrice: Number.isFinite(announced) ? announced : (Number.isFinite(ledger) ? ledger : null),
            announcedAt: new Date(r.created_at).toISOString(),
            title: typeof detail.title === 'string' ? detail.title : null,
        };
    });
}
/**
 * @description Kalshi market tickers are `SERIES-EVENT-STRIKE`; the series is the first segment.
 * Only a fallback — the ledger's own `series_ticker` is authoritative when it is there.
 * @param ticker - Market ticker.
 * @returns The series ticker, or null when the shape does not hold.
 */
function seriesFromTicker(ticker) {
    const first = String(ticker).split('-')[0];
    return first && first !== ticker ? first : null;
}
/**
 * @description Price a bounded set of open alerts against Kalshi's candles: cached markets first,
 * then at most `cap` live reads, spaced so the shared public tier is never burst. Per-market
 * failures are counted in `unavailable` rather than thrown — one rate-limited ticker must not
 * blank the rest. The cache is shared by every caller, so only the market's price is taken from it;
 * the pop is folded from THIS call's alerts, whether the market was fetched now or memoized.
 * @param alerts - Open alerts, newest first.
 * @param candles - The candle reader (the framework's getCandles at runtime).
 * @param opts - cache (per-process memo + rate clock), now/sleep (injectable clock), cap, spacing,
 * ttl, and onError so a per-market failure is reported by the caller's logger rather than swallowed.
 * @returns The pops and what was skipped.
 */
async function fetchPops(alerts, candles, opts = {}) {
    const cache = opts.cache ?? createPopCache();
    const now = opts.now ?? Date.now;
    const sleep = opts.sleep ?? ((ms) => new Promise((r) => { setTimeout(r, ms); }));
    const cap = Number.isFinite(opts.cap) && opts.cap > 0 ? Math.floor(opts.cap) : exports.POP_MAX_MARKETS;
    const minIntervalMs = Number.isFinite(opts.minIntervalMs) ? Math.max(0, opts.minIntervalMs) : exports.POP_MIN_INTERVAL_MS;
    const ttl = Number.isFinite(opts.cacheTtlMs) ? Math.max(0, opts.cacheTtlMs) : exports.POP_CACHE_TTL_MS;
    const pops = [];
    let checked = 0;
    let unavailable = 0;
    let deferred = 0;
    let reads = 0;
    for (const alert of alerts) {
        const hit = cache.entries.get(alert.ticker);
        if (hit && now() - hit.atMs < ttl) {
            checked += 1;
            // The cache holds the market; the pop is derived HERE, from THIS caller's own alert.
            const cached = hit.latest ? popFrom(alert, hit.latest) : null;
            if (cached)
                pops.push(cached);
            else
                unavailable += 1;
            continue;
        }
        if (reads >= cap) {
            deferred += 1;
            continue;
        }
        if (!alert.seriesTicker) {
            unavailable += 1;
            continue;
        }
        const wait = minIntervalMs - (now() - cache.lastCallMs);
        if (wait > 0)
            await sleep(wait);
        reads += 1;
        checked += 1;
        let latest = null;
        try {
            const w = candleWindow(alert.announcedAt, now());
            const rows = await candles(alert.seriesTicker, alert.ticker, w.startTs, w.endTs, w.periodInterval);
            latest = latestYesPrice(Array.isArray(rows) ? rows : []);
        }
        catch (err) {
            // Counted, never thrown: a 429 or a dead series on ONE ticker must not blank the others.
            opts.onError?.(err, alert.ticker);
            latest = null;
        }
        cache.lastCallMs = now();
        cache.entries.set(alert.ticker, { atMs: cache.lastCallMs, latest });
        const pop = latest ? popFrom(alert, latest) : null;
        if (pop)
            pops.push(pop);
        else
            unavailable += 1;
    }
    return {
        generatedAt: new Date(now()).toISOString(),
        pops, open: alerts.length, checked, deferred, unavailable, cap,
    };
}
//# sourceMappingURL=kalshi-pops.js.map