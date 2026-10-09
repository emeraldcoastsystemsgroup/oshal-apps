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

import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import {
  brokerProviderFor,
  marketStreamStatus,
  planSubscription,
  subscribeMarketPrints,
  type MarketPrint,
  type MarketStreamStatus,
  type TradingBook,
} from '@/features/trading';
import { callerSub, resolveBook, TradingError } from '@/app/routes/trading-routes-helpers';

type Subscribe = typeof subscribeMarketPrints;
type Status = typeof marketStreamStatus;
type ResolveBook = typeof resolveBook;

export interface TradingQuoteStreamDeps {
  subscribe?: Subscribe;
  status?: Status;
  resolveBook?: ResolveBook;
}

function querySymbols(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  return [...new Set(values.flatMap((value) => String(value ?? '').split(',')).map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function heartbeatMs(): number {
  const value = Number(process.env.TRADING_STREAM_SSE_HEARTBEAT_MS);
  return Number.isFinite(value) && value > 0 ? value : 15_000;
}

function writeFrame(res: Response, event: string, payload: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function printFrame(print: MarketPrint): { symbol: string; price: number; size: number; asOf: string; feed: string } {
  return {
    symbol: String(print.symbol).toUpperCase(), price: Number(print.price), size: Number(print.size),
    asOf: print.asOf instanceof Date ? print.asOf.toISOString() : new Date(String(print.asOf)).toISOString(), feed: String(print.feed),
  };
}

function statusFrame(status: MarketStreamStatus): Record<string, unknown> {
  return { state: status.state, lastError: status.lastError, lastPrintAt: status.lastPrintAt };
}

function fallbackHello(status: MarketStreamStatus, book: TradingBook, broker: string, symbols: string[]): Record<string, unknown> {
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
export function registerTradingQuoteStreamRoutes(router: Router, ctx: AppContext, deps: TradingQuoteStreamDeps = {}): void {
  const subscribe = deps.subscribe || subscribeMarketPrints;
  const statusOf = deps.status || marketStreamStatus;
  const resolve = deps.resolveBook || resolveBook;

  router.get('/stream', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const symbols = querySymbols(req.query.symbols);
    if (!symbols.length) { res.status(400).json({ error: 'symbols_required', message: 'At least one symbol is required.' }); return; }
    let book: TradingBook;
    try { book = await resolve(ctx.pool, sub, (req.query.book as string | undefined) ?? (req.query.mode as string | undefined)); }
    catch (error) {
      if (error instanceof TradingError) { res.status(error.httpStatus).json({ error: error.code, message: error.message }); return; }
      res.status(500).json({ error: 'book_resolution_failed' }); return;
    }
    const status = statusOf();
    const broker = book.broker ?? brokerProviderFor(book.kind);
    const streaming = status.enabled && broker !== 'schwab' && status.state !== 'disabled' && status.state !== 'entitlement_blocked';
    const planned = planSubscription(symbols, status.maxSymbols);
    const accepted = planned.accepted;
    const dropped = [...new Set([...planned.dropped, ...status.dropped])];
    const hello = streaming
      ? { streaming: true, feed: status.feed, staleAfterSec: status.staleAfterSec, symbols: accepted, dropped, book: book.ref, source: 'alpaca-stream' }
      : { ...fallbackHello(status, book, broker, accepted), dropped };

    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
    writeFrame(res, 'hello', hello);
    let stopped = false;
    let unsubscribe = () => {};
    const ping = setInterval(() => { if (!stopped && !res.writableEnded && !res.destroyed) res.write(': ping\n\n'); }, heartbeatMs());
    const close = () => {
      if (stopped) return;
      stopped = true; clearInterval(ping); unsubscribe();
      if (!res.writableEnded && !res.destroyed) res.end();
    };
    req.once('close', close); res.once('close', close);
    if (streaming) {
      unsubscribe = subscribe(accepted, (print) => writeFrame(res, 'print', printFrame(print)), (next) => writeFrame(res, 'status', statusFrame(next)));
    }
  });
}
