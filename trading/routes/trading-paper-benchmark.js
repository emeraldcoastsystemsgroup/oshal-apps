"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closesFromBars = closesFromBars;
exports.withSchwabBenchmark = withSchwabBenchmark;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fill the paper book's unavailable SPY benchmark from the caller's Schwab day bars. The native World archive only holds SPY since the 2026-10-12 cutover, so the 1M/3M/1Y comparison had no base close and Reports showed +0.00% S&P.
 */
const logger_1 = require("@/shared/logger");
const trading_native_reads_1 = require("./trading-native-reads");
const screen_1 = require("./paper/screen");
const logger = (0, logger_1.createChildLogger)({ module: 'trading-paper-benchmark' });
const NATIVE = { enabled: trading_native_reads_1.nativeSchwabReads, chart: trading_native_reads_1.readNativeChart };
/**
 * @description Day closes from a trading.bars answer. A Schwab daily candle is stamped at the start of its session
 * day (midnight Central, i.e. 05:00/06:00 UTC), so its UTC calendar date is the session date.
 * @param chart - The trading.bars answer ({bars: [{t, c}]}, t in epoch seconds).
 * @returns Ascending {date, price} closes; malformed bars are dropped.
 */
function closesFromBars(chart) {
    const bars = chart?.bars;
    if (!Array.isArray(bars))
        return [];
    return bars
        .filter((b) => Number.isFinite(b.t) && Number(b.c) > 0)
        .map((b) => ({ date: new Date(Number(b.t) * 1000).toISOString().slice(0, 10), price: Number(b.c) }));
}
/**
 * @description The paper /performance payload with an unavailable SPY benchmark filled from the caller's Schwab
 *   day bars. Anything else (an available benchmark, no native Schwab reads, no connection, a failed read, or
 *   bars that do not reach back to the base date) returns the payload unchanged, so the unavailable reason stands.
 * @param ctx - Route context; the kernel resolves the caller for the bar read.
 * @param perf - The paper /performance payload from screenRead.
 * @param reads - The Schwab reads (defaults to the native kernel's).
 * @returns The payload to send.
 */
async function withSchwabBenchmark(ctx, perf, reads = NATIVE) {
    const summary = perf.summary;
    if (summary?.benchmark?.available !== false || !reads.enabled())
        return perf;
    try {
        const chart = await reads.chart(ctx, 'SPY', '1Day');
        if (!chart)
            return perf;
        return (0, screen_1.withSpyCloses)(perf, closesFromBars(chart), 'schwab');
    }
    catch (err) {
        logger.error({ err }, 'schwab SPY day bars for the paper benchmark failed');
        return perf;
    }
}
