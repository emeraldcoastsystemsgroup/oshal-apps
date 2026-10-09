"use strict";
/**
 * ADR-143 — owner-authenticated quote relay.
 *
 * The kernel owns the venue websocket. This package owns only the same-origin SSE relay and may
 * receive normalized prints through the public stream barrel. A browser never sees a venue URL or
 * credential. Schwab books and a disabled/blocked stream remain on the ordinary poll path while
 * this connection stays open so the surface does not go blank.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-143 Phase 2: owner-authenticated SSE relay with book-bound fallback, allowlisted frames, heartbeat and close cleanup.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Subscribe the kernel to hello's ACCEPTED list, not the full request. The route already trimmed the request to maxSymbols for hello, then handed the untrimmed list to the kernel, so a dropped tail still took kernel listener slots ahead of the next client's ticket symbol while hello told the browser it was polling (ADR-143 D3: dropped symbols keep polling). The listener set now matches hello.symbols exactly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTradingQuoteStreamRoutes = registerTradingQuoteStreamRoutes;
const trading_1 = require("@/features/trading");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
function querySymbols(raw) {
    const values = Array.isArray(raw) ? raw : [raw];
    return [...new Set(values.flatMap((value) => String(value ?? '').split(',')).map((value) => value.trim().toUpperCase()).filter(Boolean))];
}
function heartbeatMs() {
    const value = Number(process.env.TRADING_STREAM_SSE_HEARTBEAT_MS);
    return Number.isFinite(value) && value > 0 ? value : 15_000;
}
function writeFrame(res, event, payload) {
    if (res.writableEnded || res.destroyed)
        return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}
function printFrame(print) {
    return {
        symbol: String(print.symbol).toUpperCase(), price: Number(print.price), size: Number(print.size),
        asOf: print.asOf instanceof Date ? print.asOf.toISOString() : new Date(String(print.asOf)).toISOString(), feed: String(print.feed),
    };
}
function statusFrame(status) {
    return { state: status.state, lastError: status.lastError, lastPrintAt: status.lastPrintAt };
}
function fallbackHello(status, book, broker, symbols) {
    const reason = broker === 'schwab' ? 'broker_poll' : status.state === 'entitlement_blocked' ? 'entitlement_blocked' : 'stream_disabled';
    return {
        streaming: false, feed: status.feed, staleAfterSec: status.staleAfterSec,
        symbols, dropped: status.dropped, book: book.ref,
        source: broker === 'schwab' ? 'schwab-poll' : 'alpaca-poll', reason,
    };
}
/**
 * @description Register GET /stream under the package's already-authenticated trading router.
 * @param router - The package router mounted at /api/trading.
 * @param ctx - Package context; retained for the standard route registration contract.
 * @param deps - Injected kernel/book seams for a real HTTP guard without venue credentials.
 */
function registerTradingQuoteStreamRoutes(router, ctx, deps = {}) {
    const subscribe = deps.subscribe || trading_1.subscribeMarketPrints;
    const statusOf = deps.status || trading_1.marketStreamStatus;
    const resolve = deps.resolveBook || trading_routes_helpers_1.resolveBook;
    router.get('/stream', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const symbols = querySymbols(req.query.symbols);
        if (!symbols.length) {
            res.status(400).json({ error: 'symbols_required', message: 'At least one symbol is required.' });
            return;
        }
        let book;
        try {
            book = await resolve(ctx.pool, sub, req.query.book ?? req.query.mode);
        }
        catch (error) {
            if (error instanceof trading_routes_helpers_1.TradingError) {
                res.status(error.httpStatus).json({ error: error.code, message: error.message });
                return;
            }
            res.status(500).json({ error: 'book_resolution_failed' });
            return;
        }
        const status = statusOf();
        const broker = book.broker ?? (0, trading_1.brokerProviderFor)(book.kind);
        const streaming = status.enabled && broker !== 'schwab' && status.state !== 'disabled' && status.state !== 'entitlement_blocked';
        const planned = (0, trading_1.planSubscription)(symbols, status.maxSymbols);
        const accepted = planned.accepted;
        const dropped = [...new Set([...planned.dropped, ...status.dropped])];
        const hello = streaming
            ? { streaming: true, feed: status.feed, staleAfterSec: status.staleAfterSec, symbols: accepted, dropped, book: book.ref, source: 'alpaca-stream' }
            : { ...fallbackHello(status, book, broker, accepted), dropped };
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
        writeFrame(res, 'hello', hello);
        let stopped = false;
        let unsubscribe = () => { };
        const ping = setInterval(() => { if (!stopped && !res.writableEnded && !res.destroyed)
            res.write(': ping\n\n'); }, heartbeatMs());
        const close = () => {
            if (stopped)
                return;
            stopped = true;
            clearInterval(ping);
            unsubscribe();
            if (!res.writableEnded && !res.destroyed)
                res.end();
        };
        req.once('close', close);
        res.once('close', close);
        if (streaming) {
            unsubscribe = subscribe(accepted, (print) => writeFrame(res, 'print', printFrame(print)), (next) => writeFrame(res, 'status', statusFrame(next)));
        }
    });
}
//# sourceMappingURL=trading-quote-stream-routes.js.map