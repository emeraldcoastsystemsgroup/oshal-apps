/**
 * ADR-052 addendum (paper-to-live parity) — the three parity knobs reach a book, and above all the
 * LIVE book, only through the existing confirm-gated per-book applies, in the shape the dispatch reads.
 *
 * THE BOUNDARY THIS GUARD CROSSES: the route. A REAL express Router is composed by this package's own
 * registerTradingAccountRoutes, and every request is matched and run by express against the REAL
 * kernel stores it calls (loadBook, getActiveOverride, applyOverride, getStrategy, normalizeConfig)
 * and the REAL dispatch resolvers the stored knob is then read by (marketGapFilterPct,
 * exitPlanSessions, yieldSleeveFloatPct). The assertions are on the status a caller receives, on the
 * config the kernel actually wrote, and on what the dispatch would resolve from it.
 *
 * THE ONE SCOPED DOUBLE, named rather than hidden: the Postgres pool is a recording fake holding the
 * override rows in memory. It is a double of a boundary this change does not touch; the real
 * companions are core's tests/unit/trading-override-book-scope.spec.ts (applyOverride and
 * getActiveOverride on a DisposablePostgres) and tests/unit/trading-parity-fire.spec.ts plus
 * tests/unit/trading-dispatch-yield-sleeve-fire.spec.ts (a knob applied to a book arms or disarms a
 * real dispatch fire). A real server is structurally unavailable here: scripts/run-trading-specs.mjs
 * pins this package's specs to a DSN that cannot connect to anything, deliberately.
 *
 * Run from the package root with the framework checkout on the alias path:
 *   OSHAL_FRAMEWORK=<oshal checkout> npx vitest run --config vitest.config.mjs tests/trading-parity-feature-promotion.spec.ts
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the promotion guard for marketGapFilterPct, exitPlanSessions and yieldSleeveFloatPct. Without confirm:true both POST /accounts/books/:bookId/strategy and POST /accounts/books/:bookId/mix answer 428 and read and write NOTHING, on the live book as on paper; no caller is 401 before any read. Confirmed, the full-snapshot strategy body and the mix edit store the knobs through the kernel's normalizeConfig (clamped, junk = inherit, 0 = explicit off), the strategyId path carries the saved strategy's knobs, and a mix edit that does not name a knob keeps the applied strategy's value; the stored knob is exactly what the dispatch resolves for the book, so a strategy's explicit 0 disarms a book the env arms. Applying a knob to the live book does not arm live trading: the kernel still requires TRADING_LIVE_ENABLED and TRADING_AUTOPILOT_LIVE, read from the kernel's own source.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { registerTradingAccountRoutes, parityKnobsOf, PARITY_KNOBS } from '../src-routes/trading-accounts-routes';
import { marketGapFilterPct, exitPlanSessions } from '@/features/trading';
import * as tradingFeature from '@/features/trading';
import type { AppContext } from '@/app/composition/app-context';

const SUB = 'k-parity-promotion-spec-sub';
const LIVE_ID = '11111111-2222-4333-8444-5555555500aa';
const PAPER_ID = '11111111-2222-4333-8444-5555555500bb';
const STRATEGY_ID = '11111111-2222-4333-8444-5555555500cc';
const FRAMEWORK = process.env.OSHAL_FRAMEWORK || path.resolve(__dirname, '../../../oshal');
const fw = (f: string): string => readFileSync(path.join(FRAMEWORK, f), 'utf8');

/* ── the recording pool ─────────────────────────────────────────────────────── */
type Row = Record<string, unknown>;
let sql: string[] = [];
let overrides: Row[] = [];
let seq = 0;

const bookRow = (bookId: string): Row | null => (bookId === LIVE_ID || bookId === PAPER_ID ? {
  book_id: bookId, ref: bookId === LIVE_ID ? 'b-livespec' : 'b-paperspec', kind: bookId === LIVE_ID ? 'live' : 'paper',
  broker: bookId === LIVE_ID ? 'schwab' : 'alpaca', account_id: null, connection_key: null, enabled: false, learn: false,
  capital_cap_usd: null, settlement_policy: null, discovered_account_type: null, arm_ack_at: null, arm_ack_by: null,
  account_number_enc: null, account_type: null,
} : null);

const SAVED_STRATEGY: Row = {
  id: STRATEGY_ID, name: 'gap and sleeve', description: '', status: 'active', baseline_run_id: null, created_at: '', updated_at: '',
  config: { kind: 'rotation', posture: 'balanced', rank: 'momentum', marketGapFilterPct: 1, exitPlanSessions: 20, yieldSleeveFloatPct: 5 },
};

/** The override table's statements, applied to the in-memory rows. */
function overrideQuery(text: string, args: unknown[]): { rows: Row[] } {
  if (/^UPDATE trading_config_overrides SET active = false/.test(text)) {
    for (const r of overrides) if (r.user_sub === args[0] && r.book_id === args[1]) r.active = false;
    return { rows: [] };
  }
  if (/^INSERT INTO trading_config_overrides/.test(text)) {
    seq += 1;
    const row: Row = {
      id: `ov-${seq}`, user_sub: args[0], book_id: args[1], strategy_id: args[2], strategy_name: args[3],
      config: JSON.parse(String(args[4])), apply_pct: args[5], note: args[6], active: true, created_at: `t${seq}`, deactivated_at: null,
    };
    overrides.push(row);
    return { rows: [row] };
  }
  if (/^SELECT \* FROM trading_config_overrides WHERE user_sub = \$1 AND book_id = \$2 AND active/.test(text)) {
    return { rows: overrides.filter((r) => r.user_sub === args[0] && r.book_id === args[1] && r.active) };
  }
  return { rows: [] };
}

const query = async (raw: string, args: unknown[] = []) => {
  const text = raw.replace(/\s+/g, ' ').trim();
  sql.push(text);
  if (/FROM oshal_trading_books b/.test(text)) { const r = bookRow(String(args[1])); return { rows: r ? [r] : [] }; }
  if (/trading_config_overrides/.test(text)) return overrideQuery(text, args);
  if (/^SELECT \* FROM trading_strategies WHERE id = \$1/.test(text)) return { rows: args[0] === STRATEGY_ID && args[1] === SUB ? [SAVED_STRATEGY] : [] };
  return { rows: [] };
};
const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as AppContext['pool'];
const ctx = { pool } as unknown as AppContext;

/* ── one request through the REAL router ────────────────────────────────────── */
interface Answer { status: number; body: Record<string, unknown> }

/**
 * @description Drive one request through a real express Router composed by the package's own
 * registration function.
 * @param method - HTTP method.
 * @param url - Path under the trading mount.
 * @param body - JSON body.
 * @param auth - False to send no authenticated caller.
 * @returns The status and JSON payload the handler produced.
 */
async function call(method: string, url: string, body: Record<string, unknown> = {}, auth = true): Promise<Answer> {
  const router = express.Router();
  registerTradingAccountRoutes(router, ctx);
  let status = 200;
  let out: Record<string, unknown> = {};
  await new Promise<void>((resolve, reject) => {
    const res: Record<string, unknown> = {};
    res.status = (code: number) => { status = code; return res; };
    res.json = (payload: Record<string, unknown>) => { out = payload; resolve(); return res; };
    const req = {
      method, url, originalUrl: url, baseUrl: '', path: url, body, query: {}, headers: {}, get: () => undefined,
      ...(auth ? { oidc: { user: { sub: SUB } } } : {}),
    };
    (router as unknown as (a: unknown, b: unknown, n: (e?: unknown) => void) => void)(
      req, res, (err?: unknown) => reject(err instanceof Error ? err : new Error(`no route matched ${method} ${url}`)),
    );
  });
  return { status, body: out };
}

/** A full-snapshot strategy body carrying the three knobs. */
const snapshot = (knobs: Record<string, unknown>) => ({
  strategyName: 'parity snapshot', applyPct: 100,
  config: { kind: 'rotation', posture: 'balanced', rank: 'momentum', corePct: 30, coreSymbol: 'SPY', takeProfitPct: null, cadenceDays: 5, topN: 8, weighting: 'conviction', universe: [], warmupDays: 80, windowDays: 780, earningsGateDays: 0, ...knobs },
});
const stored = (): Row => overrides.filter((r) => r.active).slice(-1)[0]?.config as Row;
/** The kernel under test ships the yield-sleeve knob (core ADR-052 addendum P6) when its barrel exports the resolver. */
const sleeveResolver = (tradingFeature as unknown as { yieldSleeveFloatPct?: (k: number | null | undefined, m: 'paper' | 'live' | null) => number }).yieldSleeveFloatPct;

const ENV = ['TRADING_MARKET_GAP_FILTER', 'TRADING_EXIT_PLANS', 'TRADING_YIELD_SLEEVE', 'TRADING_MARKET_GAP_PCT', 'TRADING_EXIT_PLAN_SESSIONS', 'TRADING_YIELD_SLEEVE_FLOAT_PCT'];
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  sql = []; overrides = []; seq = 0;
  for (const k of ENV) { saved.set(k, process.env[k]); delete process.env[k]; }
});
afterEach(() => {
  for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('without confirm:true the parity knobs change nothing — on the live book as on paper', () => {
  it('POST /strategy and POST /mix answer 428 confirm_required and issue no statement at all', async () => {
    for (const bookId of [LIVE_ID, PAPER_ID]) {
      for (const [url, body] of [
        [`/accounts/books/${bookId}/strategy`, snapshot({ marketGapFilterPct: 1, exitPlanSessions: 20, yieldSleeveFloatPct: 5 })],
        [`/accounts/books/${bookId}/strategy`, { strategyId: STRATEGY_ID }],
        [`/accounts/books/${bookId}/mix`, { marketGapFilterPct: 1, exitPlanSessions: 20, yieldSleeveFloatPct: 5 }],
        [`/accounts/books/${bookId}/mix`, { yieldSleeveFloatPct: 5, confirm: 'true' }],
      ] as Array<[string, Record<string, unknown>]>) {
        const r = await call('POST', url, body);
        expect(r.status, url).toBe(428);
        expect(r.body.error).toBe('confirm_required');
      }
    }
    expect(sql).toEqual([]);
    expect(overrides).toEqual([]);
  });

  it('401s with no authenticated caller before any read', async () => {
    for (const url of [`/accounts/books/${LIVE_ID}/strategy`, `/accounts/books/${LIVE_ID}/mix`]) {
      const r = await call('POST', url, { confirm: true, yieldSleeveFloatPct: 5 }, false);
      expect(r.status, url).toBe(401);
    }
    expect(sql).toEqual([]);
  });
});

describe('confirmed, the knobs are stored in the shape the dispatch reads', () => {
  it('the full-snapshot strategy body on the LIVE book: clamped, junk = inherit (null), 0 = explicit off', async () => {
    const r = await call('POST', `/accounts/books/${LIVE_ID}/strategy`, { confirm: true, ...snapshot({ marketGapFilterPct: 400, exitPlanSessions: 7.6, yieldSleeveFloatPct: 'lots' }) });
    expect(r.status).toBe(200);
    expect(stored()).toMatchObject({ marketGapFilterPct: 50, exitPlanSessions: 8, yieldSleeveFloatPct: null });
    await call('POST', `/accounts/books/${LIVE_ID}/strategy`, { confirm: true, ...snapshot({ marketGapFilterPct: 0, exitPlanSessions: 0, yieldSleeveFloatPct: 0 }) });
    const off = stored();
    expect(off).toMatchObject({ marketGapFilterPct: 0, exitPlanSessions: 0 });
    // The explicit 0 is what the dispatch reads, so it disarms a live book the env would arm.
    process.env.TRADING_MARKET_GAP_FILTER = 'both'; process.env.TRADING_EXIT_PLANS = 'both';
    expect(marketGapFilterPct(off.marketGapFilterPct as number, 'live')).toBe(0);
    expect(exitPlanSessions(off.exitPlanSessions as number, 'live')).toBe(0);
    expect(overrides.filter((o) => o.active)).toHaveLength(1);
  });

  it('the yield-sleeve knob is clamped and resolved by the kernel\'s own resolver', async () => {
    expect(sleeveResolver, 'this spec needs a framework carrying the ADR-052 addendum P6 yield sleeve').toBeTypeOf('function');
    await call('POST', `/accounts/books/${PAPER_ID}/strategy`, { confirm: true, ...snapshot({ yieldSleeveFloatPct: 400 }) });
    expect(stored().yieldSleeveFloatPct).toBe(95);
    await call('POST', `/accounts/books/${PAPER_ID}/strategy`, { confirm: true, ...snapshot({ yieldSleeveFloatPct: 0 }) });
    process.env.TRADING_YIELD_SLEEVE = 'both';
    expect(sleeveResolver!(stored().yieldSleeveFloatPct as number, 'paper')).toBe(0);
  });

  it('the strategyId path carries the saved strategy\'s knobs', async () => {
    const r = await call('POST', `/accounts/books/${LIVE_ID}/strategy`, { confirm: true, strategyId: STRATEGY_ID });
    expect(r.status).toBe(200);
    expect(stored()).toMatchObject({ marketGapFilterPct: 1, exitPlanSessions: 20 });
    if (sleeveResolver) expect(stored().yieldSleeveFloatPct).toBe(5);
  });

  it('the mix editor: a named knob is set, normalized; an unnamed knob keeps the applied strategy\'s value', async () => {
    await call('POST', `/accounts/books/${LIVE_ID}/strategy`, { confirm: true, strategyId: STRATEGY_ID });
    const r = await call('POST', `/accounts/books/${LIVE_ID}/mix`, { confirm: true, exitPlanSessions: 0, marketGapFilterPct: 'junk' });
    expect(r.status).toBe(200);
    expect(stored()).toMatchObject({ exitPlanSessions: 0, marketGapFilterPct: null, rank: 'momentum', posture: 'balanced' });
    if (sleeveResolver) expect(stored().yieldSleeveFloatPct, 'not named in the edit → the applied strategy\'s value').toBe(5);
    expect(overrides.find((o) => o.active)?.strategy_name).toBe('manual-mix');
  });

  it('parityKnobsOf returns exactly the three knobs, whatever else the config carries', () => {
    expect(PARITY_KNOBS).toEqual(['marketGapFilterPct', 'exitPlanSessions', 'yieldSleeveFloatPct']);
    expect(Object.keys(parityKnobsOf({ posture: 'x', marketGapFilterPct: 2 })).sort()).toEqual([...PARITY_KNOBS].sort());
    expect(parityKnobsOf(null)).toEqual({ marketGapFilterPct: null, exitPlanSessions: null, yieldSleeveFloatPct: null });
  });
});

describe('a knob on the live book does not arm live trading', () => {
  it('the kernel still requires BOTH TRADING_LIVE_ENABLED and TRADING_AUTOPILOT_LIVE before a live fire', () => {
    const dispatch = fw('src/app/trading-schedule-dispatch.ts');
    expect(dispatch).toContain("return process.env.TRADING_LIVE_ENABLED === 'true' && process.env.TRADING_AUTOPILOT_LIVE === 'true';");
    expect(dispatch).toMatch(/if \(mode === 'live' && !autopilotLiveAllowed\(\)\) \{\s*return \{ success: false/);
  });
});
