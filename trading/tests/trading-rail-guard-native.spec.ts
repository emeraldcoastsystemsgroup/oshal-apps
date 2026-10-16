/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The cockpit-open reads on a host with no broker or market-data rail. The native kernel bridge answers getMarketData with {} and a broker reader that has no configured() probe, so GET /watchlist (any symbol) answered 502 "md.configured is not a function" and /ledger, /account, /positions, /performance and /exposure answered 502 "broker.configured is not a function". REAL express Routers composed by the package's own registrations are driven with rails shaped exactly like the bridge's: the watchlist answers 200 with every symbol and quote null, the ledger 200 with configured false, and the four book reads 409 broker_not_configured with a message the surface prints; no rail method is ever called. railConfigured itself is pinned on absent, partial, false and true rails.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { NO_BROKER_MESSAGE, railConfigured } from '../src-routes/trading-rail-guard';
import { registerTradingResearchRoutes } from '../src-routes/trading-research-routes';
import { registerTradingBookReadRoutes } from '../src-routes/trading-routes-book-read-builders';
import { registerTradingOrderFlowRoutes } from '../src-routes/trading-routes-order-flow-builders';

const SUB = 'k-rail-guard-native-spec-sub';
const BOOK = { bookId: 'book-rail-guard', ref: 'paper', kind: 'paper', enabled: true, accountNumber: null, connectionKey: null };

const rails = vi.hoisted(() => ({ touched: [] as string[], bound: false, readers: [] as Array<{mode:string,binding:unknown}> }));

vi.mock('@/features/trading', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  /** Every read the bridge's shim reader carries, recorded so the spec can prove none is reached. */
  const record = (name: string, value: unknown) => async () => { rails.touched.push(name); return value; };
  return {
    ...actual,
    // The bridge's shapes: a reader with reads but no configured() probe, and an empty market-data object.
    getBrokerReader: (mode: string, _sub: string, binding?: {connectionKey?:string}) => {
      rails.readers.push({mode,binding});
      if (rails.bound) return {configured:()=>false,notConnectedReason:binding?.connectionKey === 'selected-login' ? 'Selected account needs reconnection.' : 'Unbound account is offline.'};
      return ({ getPositions: record('getPositions', []), getAccount: record('getAccount', { balances: {} }), getOrders: record('getOrders', []) }); },
    getMarketData: () => ({}),
  };
});
vi.mock('@/app/routes/trading-routes-helpers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    callerSub: (req: { oidc?: { user?: { sub?: string } } }) => req.oidc?.user?.sub ?? null,
    resolveBook: async () => rails.bound ? {...BOOK,kind:'live',ref:'b-selected',accountNumber:'selected-account',connectionKey:'selected-login'} : BOOK,
  };
});
vi.mock('@/app/trading-schema', () => ({ ensureTradingSchema: async () => undefined }));
vi.mock('@/shared/services/database', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, runRuntimeSchemaBootstrap: async () => undefined };
});
vi.mock('@/features/world-data', () => ({
  createWorldIntelligenceService: () => ({ latestMetricPoints: async () => [], recentFeedMetricPoints: async () => [] }),
}));

/** A pool that answers the watchlist read with one symbol and every other read with no rows. */
const pool = {
  query: async (text: string) => (/FROM oshal_trading_watchlist/.test(text)
    ? { rows: [{ symbol: 'AAPL', note: null, added_at: '2026-10-01T00:00:00Z' }], rowCount: 1 }
    : { rows: [], rowCount: 0 }),
};
const ctx = { pool } as unknown as AppContext;

/**
 * @description Drive one GET through a real express Router composed by the package's own registrations.
 * @param url - Path under the trading mount, query string included.
 * @returns The status and JSON payload the handler produced.
 */
async function get(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const router = express.Router();
  registerTradingResearchRoutes(router, ctx);
  registerTradingBookReadRoutes(router, ctx, '/nonexistent');
  registerTradingOrderFlowRoutes(router, ctx, async () => { throw new Error('no order is placed by a read'); });
  const [pathname, qs] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  let status = 200;
  let body: Record<string, unknown> = {};
  await new Promise<void>((resolve, reject) => {
    const res: Record<string, unknown> = {};
    res.status = (code: number) => { status = code; return res; };
    res.json = (payload: Record<string, unknown>) => { body = payload; resolve(); return res; };
    const req = { method: 'GET', url, originalUrl: url, baseUrl: '', path: pathname, body: {}, query,
      headers: {}, get: () => undefined, oidc: { user: { sub: SUB } } };
    (router as unknown as (a: unknown, b: unknown, n: (e?: unknown) => void) => void)(
      req, res, (err?: unknown) => reject(err instanceof Error ? err : new Error(`no route matched GET ${pathname}`)));
  });
  return { status, body };
}

beforeEach(() => { rails.touched = []; rails.bound = false; rails.readers=[]; });

describe('railConfigured', () => {
  it('reads an absent rail, a rail without a probe and a false probe as not connected; only true is connected', () => {
    expect(railConfigured(undefined)).toBe(false);
    expect(railConfigured(null)).toBe(false);
    expect(railConfigured({})).toBe(false);
    expect(railConfigured({ configured: true })).toBe(false);
    expect(railConfigured({ configured: () => false })).toBe(false);
    expect(railConfigured({ configured: () => true })).toBe(true);
  });
});

describe('cockpit-open trading reads when the host has no broker or market-data rail', () => {
  it('GET /watchlist answers 200 with every symbol and quote null', async () => {
    const r = await get('/watchlist');
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([{ symbol: 'AAPL', note: null, addedAt: '2026-10-01T00:00:00.000Z', quote: null, congress: null }]);
  });

  it('GET /ledger answers 200 with configured false, no account and no positions', async () => {
    const r = await get('/ledger');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ configured: false, account: null, positions: [], orders: [] });
    expect(rails.touched).toEqual([]);
  });

  for (const path of ['/account', '/positions', '/performance?period=1M', '/exposure']) {
    it(`GET ${path} answers 409 broker_not_configured with the surface's sentence and reads nothing`, async () => {
      const r = await get(path);
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: 'broker_not_configured', message: NO_BROKER_MESSAGE });
      expect(rails.touched).toEqual([]);
    });
  }
});

describe('selected-book readiness', () => {
  it('explains a disconnected bound account using the exact reader checked for that book', async () => {
    rails.bound = true;
    const reply = await get('/status?book=b-selected');
    expect(reply.status).toBe(200);
    expect(reply.body.bookConfigured).toBe(false);
    expect(reply.body.brokerReason).toBe('Selected account needs reconnection.');
    expect(rails.readers.filter(call => call.binding)).toEqual([{mode:'live',binding:{accountNumber:'selected-account',connectionKey:'selected-login'}}]);
    expect(rails.touched).toEqual([]);
  });
});
