/**
 * ADR-143 D2 — GET /api/trading/stream package boundary.
 *
 * This guard crosses a real loopback HTTP/SSE server and the actual route handler. The kernel
 * subscription and book resolver are injected because this package test must not contact a venue
 * or use a connector. The payload and browser credential boundary are the claims under test.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the owner-authenticated quote relay, fallback streams, allowlisted frames, close lifecycle and browser credential boundary.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Complete the ADR-143 store cases: (b) the route module's kernel imports are exactly the allowlisted names (source and compiled twin carry neither alpacaDataCredentials nor process.env.ALPACA), a resolveBook TradingError is a JSON 400 before any SSE header, and book beats mode; (c) the print frame's keys are exactly asOf/feed/price/size/symbol; (d) a Schwab-broker book is held open across two heartbeats with the response neither ended nor destroyed; (e) more symbols than maxSymbols: hello.dropped carries the tail, the ticket symbol stays first, and the kernel is subscribed to the ACCEPTED list only.
 */

import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { registerTradingQuoteStreamRoutes } from '../src-routes/trading-quote-stream-routes';
import type { AppContext } from '@/app/composition/app-context';
import type { MarketStreamStatus, TradingBook } from '@/features/trading';
import { TradingError } from '@/app/routes/trading-routes-helpers';

const SUB = 'quote-stream-spec-sub';
const BOOK = { bookId: '00000000-0000-0000-0000-000000000001', ref: 'paper', kind: 'paper', broker: 'alpaca', accountNumber: null, connectionKey: null, capitalCapUsd: null, learn: true, enabled: true } as TradingBook;
const ctx = { pool: {} } as AppContext;
const servers: Server[] = [];
const decode = (chunk: Uint8Array | undefined) => new TextDecoder().decode(chunk);
const dataOf = (text: string, event: string) => JSON.parse(text.split(`event: ${event}\n`)[1].split('\n')[0].replace(/^data: /, ''));

function appFor(deps: Parameters<typeof registerTradingQuoteStreamRoutes>[2], authenticated = true, responses?: express.Response[]): express.Express {
  const app = express();
  if (authenticated) app.use((req, _res, next) => { (req as any).oidc = { user: { sub: SUB } }; next(); });
  if (responses) app.use((_req, res, next) => { responses.push(res); next(); });
  const router = express.Router();
  registerTradingQuoteStreamRoutes(router, ctx, deps);
  app.use('/api/trading', router);
  return app;
}

async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  const server = createServer(app); servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function stop(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((done) => server.close(() => done()));
}

afterEach(async () => { for (const server of servers.splice(0)) await stop(server); delete process.env.TRADING_STREAM_SSE_HEARTBEAT_MS; });

function status(overrides: Partial<MarketStreamStatus> = {}): MarketStreamStatus {
  return { enabled: true, state: 'authenticated', feed: 'iex', maxSymbols: 30, staleAfterSec: 60, symbols: ['AAPL'], dropped: [], lastError: null, lastPrintAt: null, ...overrides };
}

describe('Trading quote stream relay (ADR-143)', () => {
  it('refuses unauthenticated callers and missing symbols before writing SSE headers', async () => {
    const unauth = await listen(appFor({ status: () => status() }, false));
    expect((await fetch(`${unauth.base}/api/trading/stream?symbols=AAPL`)).status).toBe(401);
    const missing = await listen(appFor({ status: () => status(), resolveBook: async () => BOOK }));
    const response = await fetch(`${missing.base}/api/trading/stream`);
    expect(response.status).toBe(400);
  });

  it('resolves the book query-first and answers a TradingError as JSON before any SSE header', async () => {
    const refs: Array<string | undefined> = [];
    const app = appFor({
      status: () => status(),
      subscribe: () => () => {},
      resolveBook: async (_pool, _sub, ref) => { refs.push(ref); if (ref === 'nope') throw new TradingError(400, 'bad_book', 'No such book.'); return BOOK; },
    });
    const { base } = await listen(app);
    const refused = await fetch(`${base}/api/trading/stream?book=nope&mode=live&symbols=AAPL`);
    expect(refused.status).toBe(400);
    expect(refused.headers.get('content-type')).toContain('application/json');
    expect(refused.headers.get('content-type')).not.toContain('text/event-stream');
    expect(await refused.json()).toEqual({ error: 'bad_book', message: 'No such book.' });
    const accepted = await fetch(`${base}/api/trading/stream?book=paper&mode=live&symbols=AAPL`);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get('content-type')).toContain('text/event-stream');
    await accepted.body!.cancel();
    expect(refs).toEqual(['nope', 'paper']);
  });

  it('sends hello before an exactly-allowlisted print and cleans the subscription once', async () => {
    let print: ((value: any) => void) | undefined;
    let cleaned = 0;
    const app = appFor({
      status: () => status(),
      resolveBook: async () => BOOK,
      subscribe: (_symbols, onPrint) => { print = onPrint; return () => { cleaned += 1; }; },
    });
    const { base } = await listen(app);
    const response = await fetch(`${base}/api/trading/stream?book=paper&symbols=AAPL,MSFT`);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const firstText = decode((await reader.read()).value);
    expect(firstText).toContain('event: hello');
    print!({ symbol: 'AAPL', price: 189.5, size: 100, asOf: new Date('2026-09-25T14:30:00.000Z'), feed: 'iex', secret: 'must-not-cross' });
    const text = decode((await reader.read()).value);
    expect(text).toContain('event: print');
    const frame = dataOf(text, 'print');
    expect(Object.keys(frame).sort()).toEqual(['asOf', 'feed', 'price', 'size', 'symbol']);
    expect(frame).toEqual({ symbol: 'AAPL', price: 189.5, size: 100, asOf: '2026-09-25T14:30:00.000Z', feed: 'iex' });
    expect(firstText + text).not.toContain('secret');
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cleaned).toBe(1);
  });

  it('holds a disabled stream open with heartbeat and honest poll hello', async () => {
    process.env.TRADING_STREAM_SSE_HEARTBEAT_MS = '20';
    const app = appFor({ status: () => status({ enabled: false, state: 'disabled' }), resolveBook: async () => BOOK });
    const { base } = await listen(app);
    const response = await fetch(`${base}/api/trading/stream?symbols=AAPL`);
    const reader = response.body!.getReader();
    const first = decode((await reader.read()).value);
    expect(first).toContain('"streaming":false');
    expect(first).toContain('"reason":"stream_disabled"');
    const second = decode((await reader.read()).value);
    expect(second).toContain(': ping');
    await reader.cancel();
  });

  it('holds a Schwab-broker book open across two heartbeats without subscribing or ending the response', async () => {
    process.env.TRADING_STREAM_SSE_HEARTBEAT_MS = '20';
    const responses: express.Response[] = [];
    const app = appFor({
      status: () => status(),
      resolveBook: async () => ({ ...BOOK, broker: 'schwab' } as TradingBook),
      subscribe: () => { throw new Error('a Schwab book must never reach the kernel subscribe'); },
    }, true, responses);
    const { base } = await listen(app);
    const response = await fetch(`${base}/api/trading/stream?symbols=AAPL`);
    const reader = response.body!.getReader();
    let text = decode((await reader.read()).value);
    expect(dataOf(text, 'hello')).toMatchObject({ streaming: false, source: 'schwab-poll', reason: 'broker_poll', symbols: ['AAPL'] });
    while ((text.match(/: ping/g) || []).length < 2) text += decode((await reader.read()).value);
    expect(responses).toHaveLength(1);
    expect(responses[0].writableEnded).toBe(false);
    expect(responses[0].destroyed).toBe(false);
    await reader.cancel();
  });

  it('uses Schwab/poll fallback and reports the dropped tail from the kernel plan', async () => {
    let subscribed: string[] = [];
    const schwab = { ...BOOK, broker: 'schwab' } as TradingBook;
    const app = appFor({
      status: () => status({ symbols: ['AAPL'], dropped: ['MSFT'] }),
      resolveBook: async () => schwab,
      subscribe: (symbols) => { subscribed = symbols; return () => {}; },
    });
    const { base } = await listen(app);
    const response = await fetch(`${base}/api/trading/stream?symbols=AAPL,MSFT`);
    const reader = response.body!.getReader();
    const body = decode((await reader.read()).value);
    expect(body).toContain('"source":"schwab-poll"');
    expect(body).toContain('"reason":"broker_poll"');
    expect(body).toContain('"dropped":["MSFT"]');
    expect(subscribed).toEqual([]);
    await reader.cancel();
  });

  it('drops the tail past maxSymbols, keeps the ticket symbol first and subscribes the kernel to the accepted list only', async () => {
    let subscribed: string[] | null = null;
    const app = appFor({
      status: () => status({ maxSymbols: 2 }),
      resolveBook: async () => BOOK,
      subscribe: (symbols) => { subscribed = [...symbols]; return () => {}; },
    });
    const { base } = await listen(app);
    const response = await fetch(`${base}/api/trading/stream?book=paper&symbols=NVDA,AAPL,MSFT`);
    const reader = response.body!.getReader();
    const hello = dataOf(decode((await reader.read()).value), 'hello');
    expect(hello).toMatchObject({ streaming: true, symbols: ['NVDA', 'AAPL'], dropped: ['MSFT'], source: 'alpaca-stream' });
    expect(subscribed).toEqual(['NVDA', 'AAPL']);
    await reader.cancel();
  });

  it('imports only the allowlisted kernel names and never the credential reader, in source and compiled twin', () => {
    const source = readFileSync(resolve(process.cwd(), 'src-routes/trading-quote-stream-routes.ts'), 'utf8');
    const twin = readFileSync(resolve(process.cwd(), 'routes/trading-quote-stream-routes.js'), 'utf8');
    const block = source.match(/import \{([^}]+)\} from '@\/features\/trading';/);
    expect(block, 'one import block from the trading barrel').toBeTruthy();
    const names = block![1].split(',').map((name) => name.replace(/^\s*type\s+/, '').trim()).filter(Boolean).sort();
    expect(names).toEqual(['MarketPrint', 'MarketStreamStatus', 'TradingBook', 'brokerProviderFor', 'marketStreamStatus', 'planSubscription', 'subscribeMarketPrints']);
    for (const text of [source, twin]) {
      expect(text).not.toContain('alpacaDataCredentials');
      expect(text).not.toContain('process.env.ALPACA');
      expect(text).not.toMatch(/@\/features\/trading\/services/);
      expect(text).toContain('subscribe(accepted,');
    }
  });

  it('keeps venue and credentials out of browser assets', () => {
    const ui = resolve(process.cwd(), 'tools/ui');
    const files = readdirSync(ui).filter((file) => file.endsWith('.js')).map((file) => readFileSync(resolve(ui, file), 'utf8')).join('\n');
    const html = readFileSync(resolve(process.cwd(), 'tools/trading.html'), 'utf8');
    const browser = `${files}\n${html}`;
    for (const forbidden of ['wss://', 'stream.data.alpaca', 'APCA-API', 'ALPACA_', 'schwabapi.com', 'Authorization', 'access_token']) expect(browser).not.toContain(forbidden);
    const stream = readFileSync(resolve(ui, 'quote-stream.js'), 'utf8');
    expect(stream).toContain("new EventSource('/api/trading/stream");
  });
});
