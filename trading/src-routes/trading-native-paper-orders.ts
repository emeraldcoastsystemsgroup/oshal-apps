/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | "Buy a stock" on the native paper book: POST /decisions/manual and POST /orders answer from the person's native paper book (routes/paper/manual.js) when this is the native kernel's railless paper book; every other book keeps its existing path. Review had failed with 502 (an undeclared unique key) and there was no broker to fill the order.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | nativePaperQuote: GET /quote on the native railless paper book answers from the kernel's stored price.
 */
import * as crypto from 'crypto';
import type { AppContext } from '@/app/composition/app-context';
import { getBrokerReader, type TradingBook } from '@/features/trading';
import { nativeHost, paperBook, readerConnected } from './paper/screen';
import { previewManual, fillManual, quoteManual, type PaperAnswer } from './paper/manual';

/** Whether this book is the native kernel's paper book with no broker rail (the native paper engine owns it). */
function nativePaper(ctx: AppContext, sub: string, book: TradingBook): boolean {
  if (!nativeHost(ctx) || !paperBook(book)) return false;
  const reader = () => getBrokerReader(book.kind, sub, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined);
  return !readerConnected(reader);
}

function deps(ctx: AppContext) {
  return { pool: ctx.pool, intent: (ctx as unknown as { intent: unknown }).intent, newId: () => crypto.randomUUID() };
}

/**
 * @description The native paper book's answer to POST /decisions/manual, or null for every other book.
 * @param ctx - Route context.
 * @param sub - Caller subject.
 * @param book - The resolved book.
 * @param order - The validated request.
 * @returns The answer, or null.
 */
export async function nativePaperDecision(ctx: AppContext, sub: string, book: TradingBook, order: {
  symbol: string; side: string; qty?: unknown; notional?: unknown; orderType: string; fireAt: unknown; protect: boolean; rationale?: string;
}): Promise<PaperAnswer | null> {
  if (!nativePaper(ctx, sub, book)) return null;
  return previewManual(deps(ctx), sub, { ...order, now: new Date() });
}

/**
 * @description The native paper book's answer to GET /quote (the price its orders are priced at), or null otherwise.
 * @param ctx - Route context.
 * @param sub - Caller subject.
 * @param book - The resolved book.
 * @param symbol - Upper-case ticker.
 * @returns The answer, or null.
 */
export async function nativePaperQuote(ctx: AppContext, sub: string, book: TradingBook, symbol: string): Promise<PaperAnswer | null> {
  if (!nativePaper(ctx, sub, book)) return null;
  return quoteManual(deps(ctx), symbol, book.ref);
}

/**
 * @description The native paper book's answer to POST /orders for a manual paper decision, or null otherwise.
 * @param ctx - Route context.
 * @param sub - Caller subject.
 * @param book - The resolved book.
 * @param decisionId - The decision to fill.
 * @returns The answer, or null.
 */
export async function nativePaperOrder(ctx: AppContext, sub: string, book: TradingBook, decisionId: string): Promise<PaperAnswer | null> {
  if (!nativePaper(ctx, sub, book)) return null;
  return fillManual(deps(ctx), sub, decisionId, new Date());
}
