/**
 * ADR-143 D5 — GET /api/trading/reports/movers takes the whole-market screener, and falls back.
 *
 * THE BOUNDARY THIS GUARD CROSSES, twice. (1) The route: a REAL express Router is composed by the
 * package's own registerTradingResearchRoutes and the request is matched and run by express, so the
 * assertion is on the payload a caller actually receives — a source pin cannot see a leg that reads
 * the database anyway, or a fallback that answers an empty board. (2) The vendor: the screener is an
 * HTTP client, so a REAL node:http server on 127.0.0.1 answers it with ALPACA_SCREENER_BASE_URL
 * pointed at it — real socket, real status codes, real body parse. The failure the fallback exists
 * for is an HTTP failure, and a fetch double would prove nothing about it.
 *
 * TWO SCOPED DOUBLES, both OUTSIDE those boundaries and both collaborators of the FALLBACK path
 * rather than of this change: the daily-bar feed (data.alpaca.markets) and the asset directory
 * (paper-api.alpaca.markets) are answered from the test at the fetch layer. Screener traffic is
 * never doubled. The Postgres pool is a recording fake — which is what lets the screener path assert
 * something a mock could not fake away: that it never reads the watchlist at all.
 *
 * Run from the package root with the framework checkout on the alias path:
 *   OSHAL_FRAMEWORK=<oshal checkout> npx vitest run tests/trading-movers-screener.spec.ts
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the ADR-143 D5 movers guards over the real router and a real local vendor: winners/losers/active served from the screener with the label and the vendor's own last_updated, the bounded universe provably unread on that path, most-actives asked for by volume with an honest note about the price minimum it cannot apply, 'volatile' never sent to a vendor that has no such board, the requested limit honoured after the over-fetch, and all four fallback shapes (non-200, no key, an empty screener board, and the unchanged bounded board) answering a populated bounded report rather than a blank one. Plus the surface half: view-research.js is EXECUTED in a vm context and its meta line asserted to print the source and the vendor stamp.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createContext, Script } from 'node:vm';
import { registerTradingResearchRoutes } from '../src-routes/trading-research-routes';
import type { AppContext } from '@/app/composition/app-context';

const SUB = 'k-movers-screener-spec-sub';

/** What the stand-in screener answers next, and what it actually received. */
const vendor = { status: 200, body: '{}', requests: [] as string[] };
let server: Server;
let base = '';

const MOVERS_BODY = {
  gainers: [
    { symbol: 'NVDA', price: 182.5, change: 12.1, percent_change: 7.1 },
    { symbol: 'AMD', price: 141.2, change: 6.4, percent_change: 4.7 },
    { symbol: 'INTC', price: 21.4, change: 0.9, percent_change: 4.4 },
    { symbol: 'CHEAP', price: 0.9, change: 0.4, percent_change: 80.0 },
  ],
  losers: [{ symbol: 'PLTR', price: 64.2, change: -5.1, percent_change: -7.4 }],
  last_updated: '2026-09-16T17:41:02.113Z',
};
const ACTIVES_BODY = {
  most_actives: [{ symbol: 'TSLA', volume: 91_204_331, trade_count: 812_004 }],
  last_updated: '2026-09-16T17:41:04.900Z',
};

/** The asset directory the paper-api double answers with — every symbol this spec uses. */
const DIRECTORY = ['NVDA', 'AMD', 'INTC', 'CHEAP', 'PLTR', 'TSLA', 'AAPL', 'MSFT'].map((symbol) => ({
  symbol, name: `${symbol} Inc`, exchange: 'NASDAQ', tradable: true,
}));

/** One daily bar page wide enough for the bounded board to rank something real. */
function barsPayload(symbols: string[]): string {
  const bars: Record<string, Array<Record<string, number>>> = {};
  for (const [i, s] of symbols.entries()) {
    bars[s] = [
      { o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1_000_000 + i },
      { o: 100 + i, h: 106 + i, l: 99 + i, c: 105 + i, v: 2_000_000 + i },
    ];
  }
  return JSON.stringify({ bars, next_page_token: null });
}

const realFetch = globalThis.fetch;
const ENV_KEYS = ['ALPACA_SCREENER_BASE_URL', 'ALPACA_PAPER_KEY_ID', 'ALPACA_PAPER_SECRET_KEY',
  'ALPACA_KEY_ID', 'ALPACA_KEY', 'ALPAKA_KEY', 'ALPACA_SECRET_KEY', 'ALPACA_SECRET', 'ALPAKA_SECRET',
  'TRADING_MOVERS_MIN_PRICE'];
const savedEnv = new Map<string, string | undefined>();

/** Every SQL the route handed the pool this test — empty is the screener path's proof. */
let sql: string[] = [];

/** A recording Postgres fake: the schema bootstrap DDL is accepted, the watchlist read answers one row. */
const ctx = {
  pool: {
    query: async (text: string) => {
      sql.push(text);
      return { rows: text.includes('FROM oshal_trading_watchlist') ? [{ symbol: 'AAPL' }] : [] };
    },
  },
} as unknown as AppContext;

beforeAll(async () => {
  for (const k of ENV_KEYS) { savedEnv.set(k, process.env[k]); delete process.env[k]; }
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    vendor.requests.push(req.url ?? '');
    res.writeHead(vendor.status, { 'content-type': 'application/json' });
    res.end(vendor.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta1/screener`;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes('paper-api.alpaca.markets')) {
      return Promise.resolve(new Response(JSON.stringify(DIRECTORY), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    if (url.includes('data.alpaca.markets')) {
      const syms = decodeURIComponent((/symbols=([^&]*)/.exec(url) ?? ['', ''])[1]).split(',').filter(Boolean);
      return Promise.resolve(new Response(barsPayload(syms), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const [k, v] of savedEnv) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

afterEach(() => { vendor.requests.length = 0; sql = []; });

/** Configure (or deliberately unconfigure) the vendor key and point the screener at the local server. */
function configure(withKey = true): void {
  process.env.ALPACA_SCREENER_BASE_URL = base;
  if (withKey) {
    process.env.ALPACA_PAPER_KEY_ID = 'test-key-id';
    process.env.ALPACA_PAPER_SECRET_KEY = 'test-secret-key';
  } else {
    delete process.env.ALPACA_PAPER_KEY_ID;
    delete process.env.ALPACA_PAPER_SECRET_KEY;
  }
}

/** Point the stand-in screener at a payload. */
function answers(body: unknown, status = 200): void {
  vendor.status = status;
  vendor.body = typeof body === 'string' ? body : JSON.stringify(body);
}

/** One GET /reports/movers through the REAL express router the package composes. */
async function movers(query: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const router = express.Router();
  registerTradingResearchRoutes(router, ctx);
  let status = 200;
  let out: Record<string, unknown> = {};
  await new Promise<void>((resolve, reject) => {
    const res: Record<string, unknown> = {};
    res.status = (code: number) => { status = code; return res; };
    res.json = (payload: Record<string, unknown>) => { out = payload; resolve(); return res; };
    const req = {
      method: 'GET', url: '/reports/movers', originalUrl: '/reports/movers', baseUrl: '',
      path: '/reports/movers', body: {}, query, headers: {}, get: () => undefined,
      oidc: { user: { sub: SUB } },
    };
    (router as unknown as (q: unknown, r: unknown, n: (e?: unknown) => void) => void)(
      req, res, (err?: unknown) => reject(err instanceof Error ? err : new Error('no route matched')),
    );
  });
  return { status, body: out };
}

describe('GET /reports/movers — the screener is the whole-market source when it answers (ADR-143 D5)', () => {
  it('winners come from the screener, labelled, with the vendor stamp — and the watchlist is never read', async () => {
    configure();
    answers(MOVERS_BODY);
    const r = await movers({ kind: 'winners', limit: '15' });

    expect(r.status).toBe(200);
    expect(r.body.source).toBe('Alpaca screener');
    expect(r.body.lastUpdated).toBe('2026-09-16T17:41:02.113Z');
    // CHEAP is a real directory symbol at $0.90 — it is the stated minimum-price filter that drops
    // it, not the directory filter, and the surface is told which filter ran.
    expect((r.body.rows as Array<{ symbol: string }>).map((x) => x.symbol)).toEqual(['NVDA', 'AMD', 'INTC']);
    expect(r.body.filter).toEqual({ minPrice: 5, assetDirectory: true });
    expect(String(r.body.note)).toContain('$5 or above');
    expect(vendor.requests[0]).toContain('/stocks/movers');
    // The whole point of the second source: the bounded universe read does not happen at all.
    expect(sql).toEqual([]);
    expect(r.body.universeCount).toBeUndefined();
  });

  it('losers ride the same call and the same label', async () => {
    configure();
    answers(MOVERS_BODY);
    const r = await movers({ kind: 'losers' });
    expect(r.body.source).toBe('Alpaca screener');
    expect((r.body.rows as Array<{ symbol: string }>).map((x) => x.symbol)).toEqual(['PLTR']);
  });

  it('active asks most-actives by volume, and SAYS the price minimum could not apply to it', async () => {
    configure();
    answers(ACTIVES_BODY);
    const r = await movers({ kind: 'active' });

    expect(vendor.requests[0]).toContain('/stocks/most-actives');
    expect(vendor.requests[0]).toContain('by=volume');
    expect(r.body.source).toBe('Alpaca screener');
    expect(r.body.lastUpdated).toBe('2026-09-16T17:41:04.900Z');
    expect(String(r.body.note)).toContain('no price');
    const rows = r.body.rows as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ symbol: 'TSLA', price: null, changePct: null, dayVolume: 91_204_331 });
  });

  it('the asked-for limit is what comes back, even though the screener is over-fetched', async () => {
    configure();
    answers(MOVERS_BODY);
    const r = await movers({ kind: 'winners', limit: '2' });
    expect((r.body.rows as unknown[])).toHaveLength(2);
    expect(vendor.requests[0]).toContain('top=6');
  });

  it("'volatile' is never sent to a vendor that has no such board — it stays on the bounded one", async () => {
    configure();
    answers(MOVERS_BODY);
    const r = await movers({ kind: 'volatile' });
    expect(vendor.requests).toHaveLength(0);
    expect(r.body.source).not.toBe('Alpaca screener');
    expect(r.body.universeCount).toBeGreaterThan(0);
  });
});

describe('GET /reports/movers — every screener failure degrades to the bounded board, never to a blank', () => {
  const boundedAndPopulated = (body: Record<string, unknown>): void => {
    expect(body.source).toBe('oshal universe + your watchlist');
    expect(body.universeCount).toBeGreaterThan(0);
    expect((body.rows as unknown[]).length).toBeGreaterThan(0);
    expect(String(body.note)).not.toBe('');
    // the bounded path is the one that reads the caller's watchlist
    expect(sql.some((q) => q.includes('FROM oshal_trading_watchlist'))).toBe(true);
  };

  it('a screener non-200 falls back to a POPULATED bounded board', async () => {
    configure();
    answers(MOVERS_BODY, 500);            // a body that would have parsed, behind a failure
    const r = await movers({ kind: 'winners' });
    expect(vendor.requests).toHaveLength(1);
    boundedAndPopulated(r.body);
  });

  it('no key configured never contacts the vendor and still answers the bounded board', async () => {
    configure(false);
    answers(MOVERS_BODY);
    const r = await movers({ kind: 'winners' });
    expect(vendor.requests).toHaveLength(0);
    boundedAndPopulated(r.body);
  });

  it('an EMPTY screener board is a fallback trigger, not a result — the surface never shows nothing', async () => {
    configure();
    answers({ gainers: [], losers: [], last_updated: '2026-09-16T17:41:02.113Z' });
    const r = await movers({ kind: 'winners' });
    expect(vendor.requests).toHaveLength(1);
    boundedAndPopulated(r.body);
  });

  it('a screener body that is not the documented shape falls back the same way', async () => {
    configure();
    answers('<html>maintenance</html>');
    const r = await movers({ kind: 'winners' });
    boundedAndPopulated(r.body);
  });
});

describe('the movers meta line prints the source and the vendor stamp (the surface half)', () => {
  /* The shipped classic script is EXECUTED here, not pattern-matched: a vm context with the page
     globals it depends on, so the assertion is on the HTML the surface actually produces. */
  const surface = createContext({
    esc: (s: unknown) => String(s),
    fmtDate: (s: unknown) => `[${String(s)}]`,
    money: (n: number) => String(n),
    pct: (n: number) => `${n}%`,
    spinner: () => '',
  }) as Record<string, (j: Record<string, unknown>) => string>;

  beforeAll(() => {
    const file = path.resolve(__dirname, '..', 'tools/ui/view-research.js');
    new Script(readFileSync(file, 'utf8')).runInContext(surface as never);
  });

  it('names the screener as the source and shows the vendor last_updated beside the read time', () => {
    const html = surface.mvMetaHtml({
      source: 'Alpaca screener', asOf: '2026-09-16T17:42:00.000Z',
      lastUpdated: '2026-09-16T17:41:02.113Z', note: 'Whole US-equity board from the Alpaca screener.',
    });
    expect(html).toContain('Alpaca screener');
    expect(html).toContain('vendor updated [2026-09-16T17:41:02.113Z]');
    expect(html).toContain('read [2026-09-16T17:42:00.000Z]');
    expect(html).toContain('Whole US-equity board');
  });

  it('a bounded board has no vendor stamp to show, and does not invent one', () => {
    const html = surface.mvMetaHtml({
      source: 'oshal universe + your watchlist', asOf: '2026-09-16T17:42:00.000Z',
      universeCount: 31, note: 'End-of-last-session daily closes on the free IEX feed.',
    });
    expect(html).not.toContain('vendor updated');
    expect(html).toContain('31 symbols scanned');
  });
});
