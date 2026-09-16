/**
 * The surface's answer to "why is this position sitting there with no stop?" (ADR-159).
 *
 * Run from the package root with the framework checkout on the vitest alias path:
 *   OSHAL_FRAMEWORK=../../oshal npx vitest run --config vitest.config.mjs tests/trading-unmanaged-positions.spec.ts
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Two ways the readout still lied, both driven through the REAL pinned-lot subtraction rather than described: the pool answers protected-lot rows, ledgerGovernance runs the kernel's own subtraction over them, and the answer that comes out is handed to the surface module in a vm - so these cases fail if either half is reverted. (1) A partially pinned symbol: the row prints the venue's 400 while the engine's sentence is about the 250 the autopilot can act on, and nothing reconciled them; the payload now carries both quantities and the explanation opens by saying which is which. (2) A symbol pinned in FULL is dropped by that subtraction before anything governs it, so it read NOT KNOWN - a position deliberately protected, shown as unexamined. It is asserted to read as protected lots, and, in the same render, a genuinely unanswered symbol is asserted to STILL read not known: this separates two things that shared a bucket, it does not empty the bucket.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial. Since #486/#497 the engine emits NO order for a holding its own filled orders cannot account for, and none for a TRADING_CORE_SYMBOLS ring-fence - and the surface said nothing about either, so a position with no stop, no exit and no trim looked exactly like one under full management. Three boundaries are driven for real rather than described: (1) ledgerGovernance itself - the kernel's replay SQL over a pool that answers real order rows, the real pinned-lot subtraction and the real ring-fence parse - against the live book's own USO shape (0 buys / 4 sells, and USO:0); (2) exitRuleRows, the exported route builder, proving a withheld holding is marked inactive with NO wouldFireNow, because a stop price printed for a stop that will never fire is the silence the mark exists to break; (3) the two UI modules executed in a vm, proving a managed row is unbadged, a withheld one carries its reason IN THE OPEN and not only in a hover title, and - the case this repo keeps failing - that a missing answer reads NOT KNOWN instead of managed. The compiled twin is asserted to carry the same wiring, so a forgotten route rebuild cannot ship a surface whose server never answers.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import type { Position, TradingBook } from '@/features/trading';
import { RISK_POLICIES } from '@/features/trading';
import { positionGovernanceBySymbol } from '@/app/trading-position-governance';
import { coreConfig } from '@/app/trading-dispatch-core';
import { exitRuleRows } from '../src-routes/trading-routes-book-read-builders';
import { ledgerGovernance } from '../src-routes/trading-routes-order-flow-builders';

const src = (f: string): string => readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const SHARED = src('tools/ui/shared-positions.js');
const VIEW = src('tools/ui/view-account.js');
const LEDGER_TWIN = src('routes/trading-routes-order-flow-builders.js');
const BOOK = { bookId: 'b-live', ref: 'live', kind: 'live', accountNumber: null, connectionKey: null } as unknown as TradingBook;

/** A venue position exactly as the reader reports one. */
const pos = (symbol: string, qty: number, avg = 10): Position => ({
  symbol, qty, avgEntryPrice: avg, currentPrice: avg, marketValue: qty * avg, unrealizedPl: 0,
});

/**
 * A pool that answers the reads the governance assembly makes: the engine's own filled orders, the
 * protected-lot overlay, and (empty) strategy override. `fills` is keyed by symbol and is what the
 * kernel replays; `pins` is the held quantity per symbol that the REAL `subtractPinnedLots` then
 * subtracts - so these cases exercise the coverage rule and the residual rule, not a restatement of
 * either.
 */
function poolWith(
  fills: Record<string, Array<{ side: string; qty: number; px: number }>>, fail = false, pins: Record<string, number> = {},
) {
  return {
    query: async (text: string, params?: unknown[]) => {
      if (fail) throw new Error('pool down');
      if (/FROM oshal_trading_pinned_lots/i.test(text) && /GROUP BY symbol/i.test(text)) {
        return { rows: Object.entries(pins).map(([symbol, q]) => ({ symbol, q })) };
      }
      if (/FROM oshal_trading_orders/i.test(text)) {
        const wanted = new Set(((params?.[2] as string[]) ?? []).map((s) => s.toUpperCase()));
        const rows = Object.entries(fills)
          .filter(([symbol]) => !wanted.size || wanted.has(symbol.toUpperCase()))
          .flatMap(([symbol, list]) => list.map((f) => ({
            symbol: symbol.toUpperCase(), side: f.side, filled_qty: f.qty, filled_avg_price: f.px,
          })));
        return { rows };
      }
      return { rows: [] };
    },
  };
}

const ctxWith = (pool: ReturnType<typeof poolWith>) => ({ pool } as never);

describe('ledgerGovernance - the surface asks the ENGINE, it does not decide for itself', () => {
  const saved = process.env.TRADING_CORE_SYMBOLS;
  beforeEach(() => { delete process.env.TRADING_CORE_SYMBOLS; });
  afterEach(() => { if (saved === undefined) delete process.env.TRADING_CORE_SYMBOLS; else process.env.TRADING_CORE_SYMBOLS = saved; });

  it('says nothing about a holding the engine bought and still fully covers', async () => {
    const g = await ledgerGovernance(ctxWith(poolWith({ ANET: [{ side: 'buy', qty: 20, px: 100 }] })), 'u1', BOOK, [pos('ANET', 20)]);
    expect(g.ANET.reasons).toEqual([]);
    expect(g.ANET.exitsApply).toBe(true);
  });

  it("marks the live book's USO shape: 0 buys, 4 sells, and no order of any kind", async () => {
    // The real 2026-09-15 live-book ledger for USO: the engine sold 400 shares it never bought.
    const uso = [1, 2, 3, 4].map(() => ({ side: 'sell', qty: 100, px: 72 }));
    const g = await ledgerGovernance(ctxWith(poolWith({ USO: uso })), 'u1', BOOK, [pos('USO', 400, 72)]);
    expect(g.USO.reasons.map((r) => r.kind)).toEqual(['unaccounted']);
    expect(g.USO.exitsApply).toBe(false);
    expect(g.USO.ordersApply).toBe(false);
  });

  it('keeps the ring-fence a SEPARATE reason from the unaccounted one - different states, different fixes', async () => {
    process.env.TRADING_CORE_SYMBOLS = 'SKHYV:0,SKHY:0,USO:0';
    const g = await ledgerGovernance(ctxWith(poolWith({
      USO: [{ side: 'sell', qty: 400, px: 72 }],
      SKHY: [{ side: 'buy', qty: 100, px: 12 }],
    })), 'u1', BOOK, [pos('USO', 400, 72), pos('SKHY', 100, 12)]);
    expect(g.USO.reasons.map((r) => r.kind)).toEqual(['unaccounted', 'ring-fenced']);
    expect(g.SKHY.reasons.map((r) => r.kind)).toEqual(['ring-fenced']);
    expect(g.SKHY.exitsApply).toBe(false);
  });

  it('treats partial coverage as no coverage - 40 bought of 100 held is unaccounted', async () => {
    const g = await ledgerGovernance(ctxWith(poolWith({ ABT: [{ side: 'buy', qty: 40, px: 130 }] })), 'u1', BOOK, [pos('ABT', 100, 130)]);
    expect(g.ABT.reasons.map((r) => r.kind)).toEqual(['unaccounted']);
  });

  it('answers {} when the read fails, so the surface says NOT KNOWN rather than managed', async () => {
    expect(await ledgerGovernance(ctxWith(poolWith({}, true)), 'u1', BOOK, [pos('ANET', 20)])).toEqual({});
  });

  it('answers {} for a flat book without touching the pool', async () => {
    let queried = false;
    const pool = { query: async () => { queried = true; return { rows: [] }; } };
    expect(await ledgerGovernance(ctxWith(pool as never), 'u1', BOOK, [])).toEqual({});
    expect(queried).toBe(false);
  });
});

describe('the Exits card stops printing a stop that will never fire', () => {
  const peaks = new Map<string, number>();
  const gov = (positions: Position[]) => positionGovernanceBySymbol(positions, coreConfig(null));

  /** 400 shares bought at 100, now 50: a real 50% loss, well past the `active` posture's 5% stop. */
  const sinking = (extra: Partial<Position>): Position => ({
    symbol: 'USO', qty: 400, avgEntryPrice: 100, currentPrice: 50,
    marketValue: 400 * 50, unrealizedPl: 400 * (50 - 100), ...extra,
  });

  it('a holding the engine cannot account for is inactive, with NO would-fire reason', () => {
    const held = sinking({ unmanaged: true });
    const [row] = exitRuleRows([held], RISK_POLICIES.active, peaks, 4000000, new Set(), true, new Map(), gov([held]));
    expect(row.ruleActive).toBe(false);
    expect(row.wouldFireNow).toBeNull();
    expect(row.governance?.reasons.map((r) => r.kind)).toEqual(['unaccounted']);
  });

  it('the same position WITHOUT the mark still fires, so the withholding is the only thing that changed', () => {
    const held = sinking({ engineAvgCost: 100 });
    const [row] = exitRuleRows([held], RISK_POLICIES.active, peaks, 4000000, new Set(), true, new Map([['USO', 100]]), gov([held]));
    expect(row.ruleActive).toBe(true);
    expect(row.wouldFireNow).toBe('stop_loss');
  });

  it('a row whose posture could not be read keeps its rules and carries the doubt', () => {
    const held: Position = { ...pos('NVDA', 10, 100), currentPrice: 99 };
    const [row] = exitRuleRows([held], RISK_POLICIES.active, peaks, 100000, new Set(), true, new Map(), {});
    expect(row.ruleActive, 'a failed read must not silently strip the exit rules from the card').toBe(true);
    expect(row.governance).toBeUndefined();
  });
});

/** Globals the two classic-script surface modules need to run one render in isolation. */
function surfaceCtx(over: Record<string, unknown> = {}): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    console, window: {}, document: { querySelectorAll: () => [] },
    esc: (v: unknown) => String(v == null ? '' : v),
    money: (n: unknown) => '$' + Number(n || 0).toFixed(2),
    pct: (n: unknown) => Number(n || 0).toFixed(2) + '%',
    cls: () => '', DISP: 'Live', CURRENT: '', UNIVERSE: {},
    STATE: { positions: [], posSort: { key: 'marketValue', dir: -1 }, equity: 0 },
    $: (_id: string) => null,
    ...over,
  };
  vm.createContext(ctx);
  return ctx;
}

/** Render the positions table for `positions` under `governance`, and return its HTML. */
function renderTable(positions: Array<Record<string, unknown>>, governance: unknown): string {
  const host = { innerHTML: '', querySelectorAll: () => [] };
  const ctx = surfaceCtx({
    $: (id: string) => (id === 'positionsHero' ? host : null),
    STATE: { positions, posSort: { key: 'marketValue', dir: -1 }, equity: 1000 },
  });
  (ctx.window as Record<string, unknown>).GOVERNANCE_BY_SYMBOL = governance;
  vm.runInContext(SHARED, ctx, { filename: 'shared-positions.js' });
  (ctx as { renderPortfolioTable: () => void }).renderPortfolioTable();
  return host.innerHTML;
}

const row = (symbol: string, qty: number) => ({
  symbol, qty, avgEntryPrice: 10, price: 11, marketValue: qty * 11, unrealizedPl: qty, retPct: 10,
});
const reason = (kind: string, label: string, detail: string) => ({ kind, label, detail });

describe('the positions table marks what the engine will not trade, in words', () => {
  it('a managed holding carries no badge at all', () => {
    const html = renderTable([row('ANET', 20)], { ANET: { symbol: 'ANET', exitsApply: true, ordersApply: true, reasons: [] } });
    expect(html).toContain('ANET');
    expect(html).not.toContain('not managed');
    expect(html).not.toContain('not known');
  });

  it('an unaccounted holding is badged AND explained in the open, not only in a hover title', () => {
    const detail = 'The engine’s own filled orders do not account for the 400 USO held here, so it emits no order for this position at all: no stop-loss, no take-profit, no trailing exit, no rotation or rebalance trim. It is monitored, not managed.';
    const html = renderTable([row('USO', 400)], {
      USO: { symbol: 'USO', exitsApply: false, ordersApply: false, reasons: [reason('unaccounted', 'not managed', detail)] },
    });
    expect(html).toContain('>not managed<');
    expect(html).toContain('pill unmanaged');
    expect(html).toContain('1 position the engine will not trade.');
    expect(html).toContain('Monitored, not managed: no stop, no take-profit, no trailing exit and no trim, by design.');
    // The sentence is repeated OUTSIDE the title attribute - a badge nobody hovers is a coloured dot.
    const outsideTitles = html.replace(/title="[^"]*"/g, '');
    expect(outsideTitles).toContain('monitored, not managed');
  });

  it('shows BOTH reasons for a holding that is unaccounted AND ring-fenced', () => {
    const html = renderTable([row('USO', 400)], {
      USO: {
        symbol: 'USO', exitsApply: false, ordersApply: false,
        reasons: [reason('unaccounted', 'not managed', 'no engine basis'), reason('ring-fenced', 'ring-fenced', 'named in TRADING_CORE_SYMBOLS at a 0% target')],
      },
    });
    expect(html).toContain('>not managed<');
    expect(html).toContain('>ring-fenced<');
    expect(html).toContain('named in TRADING_CORE_SYMBOLS at a 0% target');
  });

  it('a symbol with NO answer reads NOT KNOWN - never managed (the failure this repo keeps hitting)', () => {
    const html = renderTable([row('ABT', 134)], { NVDA: { symbol: 'NVDA', exitsApply: true, ordersApply: true, reasons: [] } });
    expect(html).toContain('>not known<');
    expect(html).toContain('NOT KNOWN');
    expect(html).not.toContain('not managed');
  });

  it('a server that answers no governance at all leaves every row NOT KNOWN', () => {
    const html = renderTable([row('ABT', 134), row('ANET', 20)], undefined);
    expect(html.match(/>not known</g) ?? []).toHaveLength(2);
    // ONE collapsed explanation in the open, not one paragraph per row: a blind book marks
    // everything, and fifteen copies of the same sentence would bury the rows that mean something.
    const outsideTitles = html.replace(/title="[^"]*"/g, '');
    expect(outsideTitles.match(/is NOT KNOWN/g) ?? []).toHaveLength(1);
    expect(html).toContain('ABT, ANET');
  });

  it('the table foot no longer claims the AI manages these positions', () => {
    const html = renderTable([row('ANET', 20)], { ANET: { symbol: 'ANET', exitsApply: true, ordersApply: true, reasons: [] } });
    expect(html).not.toContain('The AI manages these positions');
    expect(html).toContain('The engine manages every row that carries no badge');
  });
});

describe('the surface contract holds end to end', () => {
  it('both UI modules still parse as classic scripts after the change', () => {
    for (const [name, code] of [['shared-positions.js', SHARED], ['view-account.js', VIEW]] as const) {
      expect(() => new Function(code), `${name} must parse`).not.toThrow();
    }
  });

  it('the COMPILED /ledger route carries the governance wiring, so a stale rebuild cannot ship', () => {
    expect(LEDGER_TWIN).toContain('trading-position-governance');
    expect(LEDGER_TWIN).toContain('positionGovernanceBySymbol');
    expect(LEDGER_TWIN, 'the fifth state ships only if the route was rebuilt').toContain('pinnedInFullGovernance');
    expect(LEDGER_TWIN).toContain('governance');
  });

  it('the package never re-derives the rule: no surface module decides "unmanaged" for itself', () => {
    // The one definition lives with the order paths that enforce it. A package-side derivation is
    // the drift ADR-160 complains about, so the surface may READ the mark and never compute it.
    expect(SHARED).not.toMatch(/unmanaged\s*[=!]==?\s*true/);
    expect(SHARED).not.toContain('engineAvgCost');
    expect(VIEW).not.toContain('engineAvgCost');
  });
});

/**
 * The two ways one /ledger payload could still mislead the operator, each driven end to end: the
 * pool answers protected-lot rows, `ledgerGovernance` runs the kernel's own `subtractPinnedLots`
 * over them, and the answer it produces is what the surface module renders in a vm.
 */
describe('the protected-lot overlay: the row, the answer, and the same screen', () => {
  const saved = process.env.TRADING_CORE_SYMBOLS;
  beforeEach(() => { delete process.env.TRADING_CORE_SYMBOLS; });
  afterEach(() => { if (saved === undefined) delete process.env.TRADING_CORE_SYMBOLS; else process.env.TRADING_CORE_SYMBOLS = saved; });

  /** 400 USO the engine only ever sold, with `pin` of them sitting in protected lots. */
  const usoWithPin = (pin: number) => ledgerGovernance(
    ctxWith(poolWith({ USO: [{ side: 'sell', qty: 400, px: 72 }] }, false, { USO: pin })), 'u1', BOOK, [pos('USO', 400, 72)],
  );

  it('a partial pin: the answer states the quantity it is about AND the quantity the row shows', async () => {
    const g = await usoWithPin(150);
    expect(g.USO.reasons.map((r) => r.kind)).toEqual(['unaccounted']);
    expect(g.USO.heldQty, 'what the venue reports, which is what the row prints').toBe(400);
    expect(g.USO.governedQty, 'what the autopilot can act on, which is what the sentence is about').toBe(250);
    // The kernel's wording really is about the subtracted quantity - that is the disagreement.
    expect(g.USO.reasons[0].detail).toContain('250 USO');
  });

  it('and the surface says which is which, so 400 beside a sentence about 250 is no longer a puzzle', async () => {
    const html = renderTable([row('USO', 400)], await usoWithPin(150));
    expect(html, "the row still shows the venue's own quantity").toContain('>400</td>');
    expect(html).toContain('Of the 400 USO held, 150 sit in protected lots with their own exits');
    expect(html).toContain('the row above shows all 400, and what follows is about the other 250');
  });

  it('a holding pinned in FULL reads as protected lots - not as one nobody looked at', async () => {
    const g = await usoWithPin(400);
    expect(g.USO, 'the subtraction drops it, so this answer exists only because it is supplied').toBeDefined();
    expect(g.USO.reasons.map((r) => r.kind)).toEqual(['pinned-in-full']);
    expect(g.USO.reasons.map((r) => r.label)).toEqual(['protected lots']);
    expect(g.USO.heldQty).toBe(400);
    expect(g.USO.governedQty, 'the autopilot sees none of it').toBe(0);
    expect(g.USO.reasons[0].detail).toContain('All 400 USO');
    expect(g.USO.reasons[0].detail, 'a setting - say how it ends').toContain('returns to the autopilot when its lots are released');
  });

  it('the surface badges it as a setting, apart from the holdings the engine WILL NOT trade', async () => {
    const html = renderTable([row('USO', 400)], await usoWithPin(400));
    expect(html).toContain('>protected lots<');
    expect(html).toContain('pill pinned');
    expect(html, 'the state this replaces').not.toContain('not known');
    expect(html).not.toContain('not managed');
    expect(html).toContain('1 position is held entirely in protected lots.');
    // It is a setting, so it must not be counted under the headline that means something is wrong.
    expect(html).not.toContain('position the engine will not trade');
  });

  it('a genuinely unanswered position beside it STILL reads not known', async () => {
    const html = renderTable([row('USO', 400), row('ABT', 134)], await usoWithPin(400));
    expect(html).toContain('>protected lots<');
    expect(html).toContain('>not known<');
    expect(html).toContain('is NOT KNOWN');
    expect(html).toContain('1 position is held entirely in protected lots.');
  });
});
