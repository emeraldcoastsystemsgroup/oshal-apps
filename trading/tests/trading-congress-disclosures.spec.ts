/**
 * GET /api/trading/reports/congress — the watchlist can be populated from the congressional
 * disclosure feed, with the disclosure date beside each name, and never from anything else.
 *
 * THE BOUNDARY THIS GUARD CROSSES: the route. A REAL express Router is composed by the package's own
 * registerTradingResearchRoutes and the request is matched and run by express, so the assertions are
 * on the payload a caller receives and on the SQL the watchlist add actually issues. The surface half
 * EXECUTES the shipped view-research.js in a vm context and asserts on the HTML it produces and the
 * request its Add button sends.
 *
 * ONE SCOPED DOUBLE, outside that boundary: the core world service (createWorldIntelligenceService),
 * replaced so each case can choose what the series store answers — including a core that predates the
 * read. The read itself (ReportDate keying, observed_at, the bounded recent-feed query) is proven on a
 * real TimescaleDB by core's tests/unit/world-metrics-observed-at-postgres.spec.ts. The Postgres pool
 * is a recording fake: the watchlist write is asserted as the exact statement and values it receives.
 *
 * Run from the package root with the framework checkout on the alias path:
 *   OSHAL_FRAMEWORK=<oshal checkout> npx vitest run tests/trading-congress-disclosures.spec.ts
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the recent-disclosures list: 401 without a caller; limit default 25, capped at 100 and floored at 1 before it reaches core; only quiver-congress points with a recorded observation become rows, newest disclosure first; world off, a core without the read and a failed read each answer 'unavailable' with no rows; the watchlist add stores the symbol and nothing a body claims about holdings; and the rendered panel prints "disclosed <report day>" beside each name with an Add button that posts the symbol only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createContext, Script } from 'node:vm';
import type { AppContext } from '@/app/composition/app-context';
// vi.mock is hoisted above this import, so the route binds the controllable world service.
import { registerTradingResearchRoutes } from '../src-routes/trading-research-routes';

const world = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
  calls: [] as unknown[][],
}));

vi.mock('@/features/world-data', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, createWorldIntelligenceService: () => world.current };
});


const SUB = 'k-congress-disclosures-spec-sub';
const SEEN = '2026-09-25T06:00:00.000Z';

/** Feed points the stand-in series store answers with. */
const FEED = [
  { entity: 'world:ticker:nvda', metric: 'congress_net', ts: '2026-09-23T00:00:00.000Z', value: 2, source: 'quiver-congress', observedAt: SEEN },
  { entity: 'world:ticker:nvda', metric: 'congress_buys', ts: '2026-09-23T00:00:00.000Z', value: 2, source: 'quiver-congress', observedAt: SEEN },
  { entity: 'world:ticker:nvda', metric: 'congress_sells', ts: '2026-09-23T00:00:00.000Z', value: 0, source: 'quiver-congress', observedAt: SEEN },
  { entity: 'world:ticker:aapl', metric: 'congress_net', ts: '2026-09-15T00:00:00.000Z', value: -1, source: 'quiver-congress', observedAt: SEEN },
  { entity: 'world:ticker:msft', metric: 'congress_net', ts: '2026-09-24T00:00:00.000Z', value: 9, source: 'model', observedAt: SEEN },
  { entity: 'world:ticker:tsla', metric: 'congress_net', ts: '2026-09-24T00:00:00.000Z', value: 5, source: 'quiver-congress', observedAt: null },
];

/** A world service exposing the read, recording what it was asked. */
function feedService(answer: () => Promise<unknown[]> = async () => FEED) {
  return {
    recentFeedMetricPoints: async (...args: unknown[]) => { world.calls.push(args); return answer(); },
  };
}

let sql: Array<{ text: string; values: unknown[] }> = [];
const ctx = {
  pool: {
    query: async (text: string, values: unknown[] = []) => {
      sql.push({ text, values });
      return text.startsWith('INSERT INTO oshal_trading_watchlist')
        ? { rows: [{ symbol: values[1], note: values[2], added_at: '2026-09-26T12:00:00.000Z' }] }
        : { rows: [] };
    },
  },
} as unknown as AppContext;

afterEach(() => { world.current = null; world.calls = []; sql = []; });

/** One request through the REAL express router the package composes. */
async function call(method: 'GET' | 'POST', url: string, opts: { query?: Record<string, string>; body?: unknown; signedIn?: boolean } = {}) {
  const router = express.Router();
  registerTradingResearchRoutes(router, ctx);
  let status = 200;
  let out: Record<string, unknown> = {};
  await new Promise<void>((resolve, reject) => {
    const res: Record<string, unknown> = {};
    res.status = (code: number) => { status = code; return res; };
    res.json = (payload: Record<string, unknown>) => { out = payload; resolve(); return res; };
    const req = {
      method, url, originalUrl: url, baseUrl: '', path: url, body: opts.body ?? {}, query: opts.query ?? {},
      headers: {}, get: () => undefined, ...(opts.signedIn === false ? {} : { oidc: { user: { sub: SUB } } }),
    };
    (router as unknown as (q: unknown, r: unknown, n: (e?: unknown) => void) => void)(
      req, res, (err?: unknown) => reject(err instanceof Error ? err : new Error('no route matched')),
    );
  });
  return { status, body: out };
}

describe('GET /reports/congress — the disclosure feed, bounded and feed-only', () => {
  it('refuses an anonymous caller before reading anything', async () => {
    world.current = feedService();
    const r = await call('GET', '/reports/congress', { signedIn: false });
    expect(r.status).toBe(401);
    expect(world.calls).toEqual([]);
  });

  it('lists only observed quiver-congress names, newest disclosure first, each with its disclosure date', async () => {
    world.current = feedService();
    const r = await call('GET', '/reports/congress');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', source: 'quiver-congress', windowDays: 90 });
    const rows = r.body.rows as Array<Record<string, unknown>>;
    expect(rows.map((x) => x.symbol)).toEqual(['NVDA', 'AAPL']);
    expect(rows[0]).toEqual({
      symbol: 'NVDA', buys: 2, sells: 0, net: 2, sentiment: null, notional: null,
      disclosureDate: '2026-09-23T00:00:00.000Z', observedAt: SEEN, source: 'quiver-congress',
    });
    expect(world.calls).toEqual([[['congress_buys', 'congress_sells', 'congress_net', 'congress_sentiment', 'congress_notional'], 'quiver-congress', 90, 25]]);
    expect(sql, 'a market-wide feed read touches no owner table').toEqual([]);
  });

  it.each([
    ['500', 100], ['0', 25], ['-4', 1], ['abc', 25], ['7', 7],
  ])('clamps limit=%s to %d before it reaches core', async (limit, expected) => {
    world.current = feedService(async () => []);
    await call('GET', '/reports/congress', { query: { limit } });
    expect(world.calls[0][3]).toBe(expected);
  });

  it('a limit of one returns one row even when the read returns more names', async () => {
    world.current = feedService();
    const r = await call('GET', '/reports/congress', { query: { limit: '1' } });
    expect((r.body.rows as unknown[])).toHaveLength(1);
  });

  it('world off, a core without the read, and a failed read each answer unavailable with no rows', async () => {
    world.current = null;
    expect((await call('GET', '/reports/congress')).body).toMatchObject({ status: 'unavailable', rows: [] });

    world.current = { latestMetricPoints: async () => [] };
    const old = await call('GET', '/reports/congress');
    expect(old.status).toBe(200);
    expect(old.body).toMatchObject({ status: 'unavailable', rows: [] });
    expect(String(old.body.reason)).toContain('does not provide');

    world.current = feedService(async () => { throw new Error('getaddrinfo ENOTFOUND oshal-tsdb'); });
    const failed = await call('GET', '/reports/congress');
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ status: 'unavailable', rows: [] });
  });

  it('queries granular trades when politician or view=trades is provided', async () => {
    const rawTrade = {
      tradeId: 't-1', representative: 'Nancy Pelosi', party: 'Democrat', chamber: 'House',
      ticker: 'NVDA', transactionType: 'Purchase', direction: 'buy',
      disclosureDate: '2026-09-23T00:00:00.000Z', observedAt: SEEN,
    };
    const svc = feedService();
    (svc as unknown as Record<string, unknown>).queryCongressTrades = async (filter: Record<string, unknown>) => {
      world.calls.push(['queryCongressTrades', filter]);
      return [rawTrade];
    };
    world.current = svc;

    const r = await call('GET', '/reports/congress', { query: { politician: 'Pelosi', limit: '10' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', view: 'trades', count: 1 });
    expect((r.body.trades as unknown[])[0]).toMatchObject({ representative: 'Nancy Pelosi', ticker: 'NVDA' });
    expect(world.calls).toContainEqual(['queryCongressTrades', expect.objectContaining({ representative: 'Pelosi', limit: 10 })]);
  });
});

describe('POST /watchlist — the owner adds a symbol; a body can never add a holding', () => {
  it('stores user_sub, the symbol and the note only, ignoring congress/holdings fields', async () => {
    const r = await call('POST', '/watchlist', {
      body: { symbol: 'nvda', congress: { net: 99, disclosureDate: '2020-01-01' }, holdings: 1_000, political: true },
    });
    expect(r.status).toBe(201);
    const insert = sql.find((q) => q.text.startsWith('INSERT INTO oshal_trading_watchlist'))!;
    expect(insert.text).toContain('(user_sub, symbol, note)');
    expect(insert.values).toEqual([SUB, 'NVDA', null]);
    expect((r.body.item as Record<string, unknown>).congress).toBeNull();
  });
});

describe('the Congress disclosures panel (the surface half, executed)', () => {
  const posted: Array<{ path: string; init: unknown }> = [];
  const surface = createContext({
    esc: (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    fmtDate: (s: unknown) => String(s), money: (n: number) => String(n), pct: (n: number) => `${n}%`,
    spinner: () => '', jbody: (method: string, body: unknown) => ({ method, body }),
    api: async (p: string, init: unknown) => { posted.push({ path: p, init }); return {}; },
    $: () => null, RENDER_TOKEN: 0, tabGen: () => 0, stale: () => false, tabStale: () => false,
  }) as Record<string, (...args: unknown[]) => unknown>;

  beforeAll(() => {
    const file = path.resolve(__dirname, '..', 'tools/ui/view-research.js');
    new Script(readFileSync(file, 'utf8')).runInContext(surface as never);
  });

  it('prints "disclosed <report day>" beside each name, as the calendar day the feed gave', () => {
    const html = String(surface.cgRowsHtml({
      status: 'ok', windowDays: 90, note: 'from the feed',
      rows: [
        { symbol: 'NVDA', net: 2, buys: 2, sells: 0, disclosureDate: '2026-09-23T00:00:00.000Z', observedAt: SEEN },
        { symbol: 'AAPL', net: -1, buys: 0, sells: 1, disclosureDate: '2026-09-15T00:00:00.000Z', observedAt: SEEN },
      ],
    }));
    expect(html).toContain('<strong>NVDA</strong>');
    expect(html).toContain('disclosed 2026-09-23');
    expect(html).toContain('disclosed 2026-09-15');
    expect(html).toContain('data-cg="add" data-sym="NVDA"');
    expect(html).toContain('Add to watchlist');
  });

  it('says unavailable (with the reason) or empty, and never invents a row', () => {
    expect(String(surface.cgRowsHtml({ status: 'unavailable', reason: 'World intelligence is not enabled on this deployment.', rows: [] })))
      .toContain('unavailable &mdash; World intelligence is not enabled');
    expect(String(surface.cgRowsHtml({ status: 'ok', windowDays: 90, rows: [] }))).toContain('No congressional disclosures from the feed in the last 90 days.');
    expect(String(surface.cgRowsHtml(null))).not.toContain('<tr>');
  });

  it('the watchlist Congress column prints the same calendar day', () => {
    const html = String(surface.wlRowsHtml([{ symbol: 'NVDA', note: null, addedAt: SEEN, quote: null, congress: { net: 2, disclosureDate: '2026-09-23T00:00:00.000Z' } }]));
    expect(html).toContain('disclosed 2026-09-23');
  });

  it('Add posts the symbol only, through the existing watchlist route', async () => {
    posted.length = 0;
    await surface.congressAdd('nvda', null);
    expect(posted).toEqual([{ path: '/watchlist', init: { method: 'POST', body: { symbol: 'NVDA' } } }]);
  });

  it('renders granular politician trades with party, chamber, and official filing PDF link', () => {
    const html = String(surface.cgRowsHtml({
      status: 'ok', windowDays: 90, note: 'from the feed',
      trades: [
        {
          tradeId: 't-1',
          representative: 'Nancy Pelosi',
          party: 'Democrat',
          chamber: 'House',
          state: 'CA',
          ticker: 'NVDA',
          assetDescription: 'NVIDIA Corp',
          transactionType: 'Purchase',
          direction: 'buy',
          amount: '$1,000,001 - $5,000,000',
          disclosureDate: '2026-09-23T00:00:00.000Z',
          transactionDate: '2026-09-20',
          ptrLink: 'https://disclosures.house.gov/ptr/123.pdf',
        },
      ],
    }));
    expect(html).toContain('Nancy Pelosi');
    expect(html).toContain('Democrat');
    expect(html).toContain('House');
    expect(html).toContain('NVDA');
    expect(html).toContain('Purchase');
    expect(html).toContain('$1,000,001 - $5,000,000');
    expect(html).toContain('disclosed 2026-09-23');
    expect(html).toContain('traded 2026-09-20');
    expect(html).toContain('href="https://disclosures.house.gov/ptr/123.pdf"');
    expect(html).toContain('data-cg="research" data-sym="NVDA"');
    expect(html).toContain('data-cg="add" data-sym="NVDA"');
  });
});
