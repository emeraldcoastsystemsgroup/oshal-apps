/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: types for the World price archive quotes. The module itself is plain JavaScript at routes/trading-archive-quotes.js.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Declare archiveChart, archiveDailyBars and archiveDayChanges (the chart line, the movers board's day closes and the watchlist's Today change from the archive).
 *
 * @module trading-archive-quotes
 */

/** One archive quote: the stored price, its own timestamp, and what it is. */
export interface ArchiveQuote { price: number; asOf: string; source: string; note: string }

/**
 * @description Whether this host can read the archive (the native kernel's ctx.intent).
 * @param ctx - Route context.
 * @returns True when ctx.intent exists.
 */
export function archiveAvailable(ctx: unknown): boolean;

/**
 * @description The archive's last stored price for each ticker it tracks.
 * @param ctx - Route context with ctx.intent.
 * @param symbols - Upper-case tickers.
 * @returns Priced tickers only.
 */
export function archiveQuotes(ctx: unknown, symbols: string[]): Promise<Map<string, ArchiveQuote>>;

/**
 * @description One ticker's archive quote; throws the routes' error when the archive does not track it.
 * @param ctx - Route context with ctx.intent.
 * @param symbol - Upper-case ticker.
 * @param errorClass - The routes' TradingError class.
 * @returns The quote.
 */
export function archiveQuote(ctx: unknown, symbol: string, errorClass: unknown): Promise<ArchiveQuote>;

/**
 * @description The sentence a research section prints when its read failed.
 * @param name - The section.
 * @param err - What the read threw.
 * @param errorClass - The routes' TradingError class.
 * @returns A bounded sentence.
 */
export function sectionReason(name: string, err: unknown, errorClass: unknown): string;

/** One archive chart line. */
export interface ArchiveChart { timeframe: string; line: Array<{ t: number; v: number }>; source: string; note: string }

/**
 * @description One ticker's chart line from the archive for a chart timeframe.
 * @param ctx - Route context with ctx.intent.
 * @param symbol - Upper-case ticker.
 * @param timeframe - 5Min | 15Min | 1Hour | 1Day | 1Week.
 * @returns The line (empty when the archive does not track the ticker).
 */
export function archiveChart(ctx: unknown, symbol: string, timeframe: string): Promise<ArchiveChart>;

/**
 * @description Each ticker's day closes and that day's reported volume.
 * @param ctx - Route context with ctx.intent.
 * @param symbols - Upper-case tickers.
 * @param days - Days of day buckets.
 * @returns Bars per ticker, oldest first.
 */
export function archiveDailyBars(ctx: unknown, symbols: string[], days: number): Promise<Map<string, Array<{ t: number; c: number; v: number }>>>;

/**
 * @description The latest stored price against the previous session's last stored price, in percent.
 * @param ctx - Route context with ctx.intent.
 * @param symbols - Upper-case tickers.
 * @returns Change per ticker that has two stored sessions.
 */
export function archiveDayChanges(ctx: unknown, symbols: string[]): Promise<Map<string, number>>;

/** What an archive chart is, in words the page prints. */
export const CHART_NOTE: string;
