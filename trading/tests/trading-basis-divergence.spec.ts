/**
 * The surface's answer to "which cost is this stop measured from?" - the wash-sale half of the
 * basis work (ADR-159's sibling; docs/backlog/trading-advisor.md item 21).
 *
 * Run from the package root with the framework checkout on the vitest alias path:
 *   OSHAL_FRAMEWORK=../../oshal npx vitest run --config vitest.config.mjs tests/trading-basis-divergence.spec.ts
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial. The engine has vetoed a stop drawn off the venue's wash-sale-ADJUSTED average since the veto landed, but the Exits card went on printing that average and a stop price derived from it - so the divergence was corrected in silence and the row said the opposite of what the engine had decided. Two boundaries are driven for real rather than described: (1) the ledger, through the kernel's own withEngineCostBasis over a pool answering real order rows, into the exported route builder - the row's engine basis is the replay's number, not a map handed in by the test; and (2) the card itself, executed in a vm, proving both cost bases and both stop prices are on the screen, that the foot names the adjustment, that a not-in-force row shows it too, and that a book with no divergence gains no noise. The compiled twin is asserted to carry the same fields, so a forgotten route rebuild cannot ship a card whose server never answers.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import type { Position, TradingBook } from '@/features/trading';
import { riskPolicy } from '@/features/trading';
import { withEngineCostBasis } from '@/app/trading-engine-cost-basis';
import { exitRuleRows, type ExitRuleRow } from '../src-routes/trading-routes-book-read-builders';

const src = (f: string): string => readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const VIEW = src('tools/ui/view-account.js');
const EXPOSURE_TWIN = src('routes/trading-routes-book-read-builders.js');

const BOOK = { bookId: 'b-live', ref: 'live', kind: 'live', accountNumber: null, connectionKey: null } as unknown as TradingBook;
/** The live book's posture: stop 5%, per-name cap 3%. */
const POLICY = riskPolicy('live', { posture: 'active' });
/** Well above 3% of any position here, so nothing is trimmed and the stop is the only rule in play. */
const CAP_EQUITY = 600_000;

/** One filled order as the ledger stores it. */
interface Fill { side: string; qty: number; px: number }

/**
 * The CRM round trip the operator verified to the cent: bought at 144.56, stopped out at 137.05
 * (7.51/share disallowed), re-bought at 143.97 inside the 30-day window. The engine's own cost of
 * what it holds now is 143.97; the venue reports 151.48.
 */
const CRM_FILLS: Fill[] = [
  { side: 'buy', qty: 100, px: 144.56 },
  { side: 'sell', qty: 100, px: 137.05 },
  { side: 'buy', qty: 100, px: 143.97 },
];

/**
 * @description A pool that answers the one read the cost attachment makes, with real order rows -
 * so the row's engine basis is the kernel's replay of these fills and not a number this spec chose.
 * @param fills - Filled orders per symbol.
 * @returns The stand-in pool.
 */
function poolWith(fills: Record<string, Fill[]>): { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }> } {
  return {
    query: async (text: string, params?: unknown[]) => {
      if (/FROM oshal_trading_orders/i.test(text)) {
        const wanted = new Set(((params?.[2] as string[]) ?? []).map((s) => s.toUpperCase()));
        return {
          rows: Object.entries(fills)
            .filter(([symbol]) => !wanted.size || wanted.has(symbol.toUpperCase()))
            .flatMap(([symbol, list]) => list.map((f) => ({
              symbol: symbol.toUpperCase(), side: f.side, filled_qty: f.qty, filled_avg_price: f.px,
            }))),
        };
      }
      return { rows: [] };
    },
  };
}

/** A venue position exactly as the reader reports one, with the VENUE's average. */
const pos = (symbol: string, qty: number, venueAvg: number, last: number): Position => ({
  symbol, qty, avgEntryPrice: venueAvg, currentPrice: last,
  marketValue: qty * last, unrealizedPl: qty * (last - venueAvg),
});

/**
 * @description Build the exit-rule rows the /exposure card paints, the way the route builds them:
 * the kernel's cost attachment over the venue positions, then the exported row builder.
 * @param positions - Venue positions.
 * @param fills - The engine's own filled orders per symbol.
 * @param rulesRunNow - Whether the regular-session rule set is in force.
 * @returns The rows.
 */
async function rowsFor(positions: Position[], fills: Record<string, Fill[]>, rulesRunNow = true): Promise<ExitRuleRow[]> {
  const ctx = { pool: poolWith(fills) } as never;
  const costed = await withEngineCostBasis(ctx, 'u1', BOOK, positions);
  const engineCost = new Map<string, number>();
  for (const p of costed) if (p.engineAvgCost !== undefined) engineCost.set(p.symbol.toUpperCase(), p.engineAvgCost);
  return exitRuleRows(costed, POLICY, new Map(), CAP_EQUITY, new Set(), rulesRunNow, engineCost);
}

describe('the exposure row carries the ENGINE cost beside the venue average', () => {
  it("reports the replay's own number and the stop measured from it", async () => {
    const [r] = await rowsFor([pos('CRM', 100, 151.48, 143.00)], { CRM: CRM_FILLS });
    expect(r.avgEntryPrice, "the venue's wash-sale-adjusted average").toBe(151.48);
    expect(r.engineBasisPx, 'what the engine actually paid for the shares it holds').toBe(143.97);
    // 5% under each basis: the venue's stop is the one the veto suppresses; the engine's is the
    // price the stop really fires at, and the two are $7.14 apart on one position.
    expect(r.stopPx).toBe(143.91);
    expect(r.engineStopPx).toBe(136.77);
  });

  it('reports NULL rather than a guess when the engine ledger does not cover the holding', async () => {
    // 500 USO the operator bought outside the engine: no fills, so no second basis exists.
    const [r] = await rowsFor([pos('USO', 500, 70, 60)], {});
    expect(r.engineBasisPx).toBeNull();
    expect(r.engineStopPx).toBeNull();
    expect(r.avgEntryPrice, "the venue's number is still reported").toBe(70);
  });

  it('agrees with the venue where there was no wash sale to adjust for', async () => {
    const [r] = await rowsFor([pos('ANET', 20, 100, 104)], { ANET: [{ side: 'buy', qty: 20, px: 100 }] });
    expect(r.engineBasisPx).toBe(100);
    expect(r.engineStopPx).toBe(95);
  });
});

/** Globals the classic-script surface module needs to render one card in isolation. */
function surfaceCtx(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    console, window: {}, document: { querySelectorAll: () => [] },
    esc: (v: unknown) => String(v == null ? '' : v),
    money: (n: unknown) => '$' + Number(n || 0).toFixed(2),
    pct: (n: unknown) => Number(n || 0).toFixed(2) + '%',
    cls: () => '', DISP: 'Live', CURRENT: '', UNIVERSE: {},
    STATE: { positions: [], posSort: { key: 'marketValue', dir: -1 }, equity: 0 },
    $: () => null,
  };
  vm.createContext(ctx);
  return ctx;
}

/**
 * @description Render the Exits card's rules section for `rows`, exactly as the card does.
 * @param rows - The payload's exit-rule rows.
 * @returns The rendered HTML.
 */
function renderRules(rows: ExitRuleRow[]): string {
  const ctx = surfaceCtx();
  vm.runInContext(VIEW, ctx, { filename: 'view-account.js' });
  return (ctx as { exitsRulesHtml: (x: unknown) => string }).exitsRulesHtml({
    policy: { posture: 'active', source: 'env', stopLossPct: 5, takeProfitPct: 8, trailArmPct: 5, trailGivebackPct: 3 },
    exits: { rules: rows, working: [] },
    sections: { pinnedLots: 'ok', peaks: 'ok' },
  });
}

describe('the Exits card shows both bases instead of correcting one out of sight', () => {
  it('prints the venue average AND the engine cost, and both stop prices, on the same row', async () => {
    const html = renderRules(await rowsFor([pos('CRM', 100, 151.48, 143.00)], { CRM: CRM_FILLS }));
    expect(html, "the venue's average is still shown").toContain('$151.48');
    expect(html, "the engine's own cost is beside it").toContain('engine $143.97');
    expect(html, "the venue's stop is still shown").toContain('$143.91');
    expect(html, 'and the stop that actually fires').toContain('engine $136.77');
  });

  it('names the wash-sale adjustment in the foot and counts the rows carrying one', async () => {
    const html = renderRules(await rowsFor(
      [pos('CRM', 100, 151.48, 143.00), pos('ANET', 20, 100, 104)],
      { CRM: CRM_FILLS, ANET: [{ side: 'buy', qty: 20, px: 100 }] }));
    expect(html).toContain('1 row shows two cost bases');
    expect(html).toContain('wash-sale-ADJUSTED average');
    expect(html).toContain('the lower of the two stop prices is the one that fires');
  });

  it('shows the engine cost on a NOT-IN-FORCE row too - off-hours is when the operator looks', async () => {
    const html = renderRules(await rowsFor([pos('CRM', 100, 151.48, 143.00)], { CRM: CRM_FILLS }, false));
    expect(html).toContain('rules not in force right now');
    expect(html).toContain('engine $143.97');
  });

  it('adds nothing at all to a book whose two bases agree', async () => {
    const html = renderRules(await rowsFor([pos('ANET', 20, 100, 104)], { ANET: [{ side: 'buy', qty: 20, px: 100 }] }));
    expect(html).not.toContain('engine $');
    expect(html).not.toContain('cost bases');
  });

  it('says nothing about a second basis for a holding that has none', async () => {
    const html = renderRules(await rowsFor([pos('USO', 500, 70, 60)], {}));
    expect(html).toContain('$70.00');
    expect(html).not.toContain('engine $');
    expect(html).not.toContain('cost bases');
  });
});

describe('the surface contract holds end to end', () => {
  it('view-account.js still parses as a classic script', () => {
    expect(() => new Function(VIEW)).not.toThrow();
  });

  it('the COMPILED exposure route answers both fields, so a stale rebuild cannot ship', () => {
    expect(EXPOSURE_TWIN).toContain('engineBasisPx');
    expect(EXPOSURE_TWIN).toContain('engineStopPx');
  });

  it('the card still decides nothing from the basis - it prints it', () => {
    // The one rule about which holdings the engine manages stays the server's `governance`
    // (ADR-159). A basis-derived verdict here is exactly the drift that rule exists to prevent.
    expect(VIEW).not.toContain('engineAvgCost');
    // The withheld/greyed row is still decided by the server's posture, not by the two prices.
    expect(VIEW).toContain('r.governance');
  });
});
