/**
 * The market half of the trading bot's ONLY data channel.
 *
 * The defect this guards: the accountable trading bot answered "the worker couldn't access
 * real-time index or market-mover data" while reporting the operator's equity to the cent in the
 * same breath. Nothing was broken — the paper key entitles the screener, the screener ships in the
 * kernel, and GET /reports/movers already uses it. The bot simply could not reach any of it: a
 * protected bot-node run is TOOL-LESS, the specialist-context fact set is the only thing it can
 * see, and that set declared book numbers and no market number at all. So the cases below are about
 * what is DECLARED and what the reader produces for it — not about whether a route works.
 *
 * REAL BOUNDARY: the screener half runs over a REAL node:http server on 127.0.0.1, reached through
 * the REAL screenerMovers/alpacaFetch client via ALPACA_SCREENER_BASE_URL — the override the
 * kernel's screener module documents for exactly this. A vendor-shaped body is parsed, filtered and
 * ranked by the shipped code, not by a stand-in.
 *
 * SCOPED DOUBLES, and their real companions:
 *  - The DATA feed's transport (data.alpaca.markets bars, paper-api asset directory) is answered by
 *    a fetch shim, because the kernel's DATA_BASE is a const with no override. The REAL
 *    barsBatchOhlcv still builds the request and parses the body — only the socket is doubled. Its
 *    real-network companion is the live acceptance recorded on the movers work (ADR-143 D5) and the
 *    sibling suite trading-movers-screener.spec.ts, which doubles the same transport.
 *  - The vendor SEAMS (options.bars / options.movers / options.configured) drive the budget and
 *    cache cases, where a deterministic clock and a vendor that never answers are the point. The
 *    same code paths are covered over real HTTP above.
 *
 * The declaration itself — that the kernel ACCEPTS this key set from this package and hands it to
 * the bot — is proven against the real registry, real manifest and real mounter in the sibling
 * suite trading-specialist-context.spec.ts.
 *
 * RUN: from this package root, with a framework checkout on the alias path -
 *   OSHAL_FRAMEWORK=<oshal checkout> node <oshal checkout>/node_modules/vitest/vitest.mjs run \
 *     --config vitest.config.mjs tests/trading-market-facts.spec.ts
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial - the market fact set is exactly the declared keys on every path, index moves and screener extremes are produced over a real HTTP screener, an unconfigured box reaches no network at all, a vendor that never answers costs the budget and not the dispatch, a stale snapshot is served with its real age and dropped past the maximum, and nothing is fabricated from a row the vendor did not price.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OhlcvBar } from '@/features/trading';
import {
  MARKET_FACTS_MAX_AGE_MS, MARKET_FACTS_TTL_MS, MARKET_FACT_KEYS, MARKET_INDEX_SYMBOLS,
  TRADING_SPECIALIST_FACT_KEYS, indexChangePct, readMarketFacts, resetMarketFactsCache,
} from '../src-routes/trading-market-facts';
import { TRADING_FACT_KEYS } from '../src-routes/trading-book-facts';

/** The vendor's documented movers payload, with a row the filters must drop and one it must keep. */
const MOVERS_BODY = {
  last_updated: '2026-09-16T20:00:00Z',
  gainers: [
    { symbol: 'CHEAP', price: 0.42, percent_change: 310.5, volume: 9_000_000 },
    { symbol: 'NVDA', price: 182.4, percent_change: 7.25, volume: 180_000_000 },
    { symbol: 'AMD', price: 160.1, percent_change: 4.1, volume: 90_000_000 },
  ],
  losers: [
    { symbol: 'INTC', price: 21.3, percent_change: -9.75, volume: 70_000_000 },
    { symbol: 'PLTR', price: 44.8, percent_change: -3.2, volume: 55_000_000 },
  ],
};

/** The tradable directory the screener's second filter reads. CHEAP is listed, so PRICE drops it. */
const DIRECTORY = ['NVDA', 'AMD', 'INTC', 'PLTR', 'CHEAP'].map((symbol) => ({
  symbol, name: `${symbol} Inc`, exchange: 'NASDAQ', tradable: true,
}));

/** Prior close, then today's close, per index proxy — the two bars a day change is computed from. */
const INDEX_CLOSES: Record<string, [number, number]> = {
  SPY: [660, 647.13],   // -1.95%
  QQQ: [600, 585.0],    // -2.50%
  DIA: [460, 457.7],    // -0.50%
};

let server: Server;
let base = '';
let vendorRequests: string[] = [];
/** When set, the stand-in screener accepts the socket and never answers. */
let vendorHangs = false;
/** When set, the bars transport never answers. */
let barsHang = false;
/** Symbols the bars transport was asked for, so "one batch call" is checked, not assumed. */
let barsRequests: string[] = [];

const realFetch = globalThis.fetch;
const ENV_KEYS = ['ALPACA_SCREENER_BASE_URL', 'ALPACA_PAPER_KEY_ID', 'ALPACA_PAPER_SECRET_KEY',
  'ALPACA_KEY_ID', 'ALPACA_KEY', 'ALPAKA_KEY', 'ALPACA_SECRET_KEY', 'ALPACA_SECRET', 'ALPAKA_SECRET',
  'TRADING_MOVERS_MIN_PRICE'];
const savedEnv = new Map<string, string | undefined>();

/** The vendor's bars page for whatever symbols were asked for. */
function barsPayload(symbols: string[]): string {
  const bars: Record<string, Array<Record<string, number>>> = {};
  for (const s of symbols) {
    const closes = INDEX_CLOSES[s];
    if (!closes) continue;
    bars[s] = closes.map((c) => ({ o: c, h: c, l: c, c, v: 1_000_000 }));
  }
  return JSON.stringify({ bars, next_page_token: null });
}

beforeAll(async () => {
  for (const k of ENV_KEYS) { savedEnv.set(k, process.env[k]); delete process.env[k]; }
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    vendorRequests.push(req.url ?? '');
    if (vendorHangs) return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(MOVERS_BODY));
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
      barsRequests.push(syms.join(','));
      if (barsHang) return new Promise<Response>(() => { /* never answers */ });
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

beforeEach(() => { resetMarketFactsCache(); vendorHangs = false; barsHang = false; });
afterEach(() => { vendorRequests = []; barsRequests = []; });

/** Point the real screener client at the stand-in server, with or without a key. */
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

describe('the declaration is what the bot can ever see', () => {
  it('carries market keys, because a tool-less worker cannot call the movers route', () => {
    // The whole defect in one assertion: the book half was declared and the market half was not.
    for (const key of ['market.spy_change_pct', 'market.qqq_change_pct', 'market.dia_change_pct',
      'market.top_gainer_pct', 'market.top_loser_pct']) {
      expect(TRADING_SPECIALIST_FACT_KEYS).toContain(key);
    }
    expect(TRADING_SPECIALIST_FACT_KEYS).toEqual([...TRADING_FACT_KEYS, ...MARKET_FACT_KEYS]);
  });

  it('stays inside the kernel cap and the kernel key grammar, with both halves declared', () => {
    // SpecialistContextRegistry refuses more than 64 keys, refuses a duplicate, and refuses a key
    // its stableKey regex does not match - the declaration would be rejected outright, which on a
    // protected dispatch means no facts at all rather than fewer facts.
    expect(TRADING_SPECIALIST_FACT_KEYS.length).toBeLessThanOrEqual(64);
    expect(new Set(TRADING_SPECIALIST_FACT_KEYS).size).toBe(TRADING_SPECIALIST_FACT_KEYS.length);
    for (const key of TRADING_SPECIALIST_FACT_KEYS) expect(key).toMatch(/^[a-z][a-z0-9_.-]{0,63}$/);
  });

  it('declares one key per index proxy, so a proxy can never be read as another', () => {
    expect(MARKET_INDEX_SYMBOLS.length).toBe(3);
    for (const symbol of MARKET_INDEX_SYMBOLS) {
      expect(MARKET_FACT_KEYS).toContain(`market.${symbol.toLowerCase()}_change_pct`);
    }
  });
});

describe('the market facts', () => {
  it('are produced over the real screener client and the real bar reader', async () => {
    configure();
    const facts = await readMarketFacts();
    // Index moves, from the two closes the vendor sent.
    expect(facts['market.spy_change_pct']).toBeCloseTo(-1.95, 2);
    expect(facts['market.qqq_change_pct']).toBeCloseTo(-2.5, 2);
    expect(facts['market.dia_change_pct']).toBeCloseTo(-0.5, 2);
    // The extremes of the whole-market board, AFTER the shipped filters ran.
    expect(facts['market.top_gainer_pct']).toBeCloseTo(7.25, 2);
    expect(facts['market.top_loser_pct']).toBeCloseTo(-9.75, 2);
    expect(facts['market.screener_available']).toBe(true);
    expect(facts['market.complete']).toBe(true);
    expect(facts['market.age_seconds']).toBe(0);
    // Both boards asked for, and the index proxies fetched in ONE batch - the budget depends on it.
    expect(vendorRequests.filter((u) => u.includes('/stocks/movers')).length).toBe(2);
    expect(barsRequests).toEqual(['SPY,QQQ,DIA']);
  });

  it('returns EXACTLY the declared keys on every path, which is what the kernel demands', async () => {
    // normalizeFacts rejects a read whose key set is not the declared one, and a rejected read is a
    // dead dispatch - so "the keys are right" has to hold when everything works AND when nothing does.
    configure();
    expect(Object.keys(await readMarketFacts()).sort()).toEqual([...MARKET_FACT_KEYS].sort());
    resetMarketFactsCache();
    configure(false);
    expect(Object.keys(await readMarketFacts()).sort()).toEqual([...MARKET_FACT_KEYS].sort());
  });

  it('never fabricates: a row the vendor did not price is not counted as an extreme', async () => {
    configure();
    const facts = await readMarketFacts();
    // CHEAP ran +310.5% but at $0.42 it is under the shipped minimum price, so the honest top
    // gainer is NVDA. A screener half that skipped the filters would report 310.5 here.
    expect(facts['market.top_gainer_pct']).toBeCloseTo(7.25, 2);
  });

  it('reports a real zero as zero and an absent figure as null, never one as the other', async () => {
    const flat = new Map<string, OhlcvBar[]>([['SPY', [{ o: 1, h: 1, l: 1, c: 100, v: 1 }, { o: 1, h: 1, l: 1, c: 100, v: 1 }]]]);
    const facts = await readMarketFacts({
      configured: () => true,
      bars: async () => flat,
      movers: async () => null,
    });
    expect(facts['market.spy_change_pct']).toBe(0);          // a flat session IS zero
    expect(facts['market.qqq_change_pct']).toBeNull();       // never priced, so never a zero
    expect(facts['market.top_gainer_pct']).toBeNull();
    expect(facts['market.screener_available']).toBe(false);  // absent board, not a calm market
    expect(facts['market.complete']).toBe(false);
  });

  it('computes a day change only from two real closes', () => {
    expect(indexChangePct([{ o: 1, h: 1, l: 1, c: 100, v: 1 }, { o: 1, h: 1, l: 1, c: 110, v: 1 }])).toBeCloseTo(10, 6);
    expect(indexChangePct([{ o: 1, h: 1, l: 1, c: 100, v: 1 }])).toBeNull();
    expect(indexChangePct(undefined)).toBeNull();
    // A zero prior close is not a denominator; it is a missing number.
    expect(indexChangePct([{ o: 1, h: 1, l: 1, c: 0, v: 1 }, { o: 1, h: 1, l: 1, c: 5, v: 1 }])).toBeNull();
  });
});

describe('an unconfigured box', () => {
  it('reaches no network at all and answers unknown, rather than spending the budget finding out', async () => {
    configure(false);
    const facts = await readMarketFacts();
    expect(vendorRequests).toEqual([]);
    expect(barsRequests).toEqual([]);
    for (const symbol of MARKET_INDEX_SYMBOLS) expect(facts[`market.${symbol.toLowerCase()}_change_pct`]).toBeNull();
    expect(facts['market.screener_available']).toBe(false);
    expect(facts['market.age_seconds']).toBeNull();
    expect(facts['market.complete']).toBe(false);
  });
});

describe('the 2000 ms deadline', () => {
  it('a vendor that never answers costs the budget, not the dispatch', async () => {
    configure();
    vendorHangs = true;
    barsHang = true;
    const started = Date.now();
    const facts = await readMarketFacts({ budgetMs: 150 });
    const elapsed = Date.now() - started;
    // The registry THROWS at its own deadline, which kills the ticket. We stop at ours and say so.
    expect(elapsed).toBeLessThan(1000);
    expect(facts['market.complete']).toBe(false);
    expect(facts['market.spy_change_pct']).toBeNull();
    expect(Object.keys(facts).sort()).toEqual([...MARKET_FACT_KEYS].sort());
  });

  it('a reader that throws outright degrades to unknown facts rather than a dead ticket', async () => {
    const facts = await readMarketFacts({
      configured: () => true,
      bars: async () => { throw new Error('bars exploded'); },
      movers: async () => { throw new Error('screener exploded'); },
    });
    expect(facts['market.complete']).toBe(false);
    expect(facts['market.screener_available']).toBe(false);
  });
});

describe('the cache is what keeps a cold vendor from costing every read', () => {
  it('serves a fresh snapshot without going back to the vendor', async () => {
    configure();
    await readMarketFacts();
    const afterFirst = vendorRequests.length;
    expect(afterFirst).toBeGreaterThan(0);
    const second = await readMarketFacts();
    expect(vendorRequests.length).toBe(afterFirst);
    expect(second['market.top_gainer_pct']).toBeCloseTo(7.25, 2);
    expect(second['market.age_seconds']).toBe(0);
  });

  it('answers from the last good snapshot with its REAL age when a refresh misses the budget', async () => {
    configure();
    await readMarketFacts();
    // Past the TTL, so the next read must try the vendor again - and the vendor is now dead.
    const clock = Date.now() + MARKET_FACTS_TTL_MS + 90_000;
    vendorHangs = true;
    barsHang = true;
    const facts = await readMarketFacts({ budgetMs: 150, now: () => clock });
    expect(facts['market.top_gainer_pct']).toBeCloseTo(7.25, 2);
    // Stale is served, but never as live: the bot is told how old the number is.
    expect(facts['market.age_seconds']).toBeGreaterThanOrEqual(90);
  });

  it('drops a snapshot too old to describe this session — unknown beats a lie about the tape', async () => {
    configure();
    await readMarketFacts();
    const clock = Date.now() + MARKET_FACTS_MAX_AGE_MS + 1_000;
    vendorHangs = true;
    barsHang = true;
    const facts = await readMarketFacts({ budgetMs: 150, now: () => clock });
    expect(facts['market.top_gainer_pct']).toBeNull();
    expect(facts['market.age_seconds']).toBeNull();
    expect(facts['market.complete']).toBe(false);
  });

  it('shares one refresh between concurrent dispatches instead of racing the vendor', async () => {
    configure();
    const [a, b] = await Promise.all([readMarketFacts(), readMarketFacts()]);
    expect(vendorRequests.filter((u) => u.includes('/stocks/movers')).length).toBe(2); // one refresh: gainers + losers
    expect(barsRequests).toEqual(['SPY,QQQ,DIA']);
    expect(a['market.top_gainer_pct']).toBeCloseTo(7.25, 2);
    expect(b['market.top_gainer_pct']).toBeCloseTo(7.25, 2);
  });
});

describe('the whole set, composed', () => {
  it('is the book half plus the market half, with no key claimed twice', () => {
    const seen = new Set<string>();
    for (const key of TRADING_SPECIALIST_FACT_KEYS) {
      expect(seen.has(key), `${key} is declared twice`).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(TRADING_FACT_KEYS.length + MARKET_FACT_KEYS.length);
  });
});
