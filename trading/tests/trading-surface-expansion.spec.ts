/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial - the ADR-136 surface-expansion contract: the Allocation mix, the active-exits panel and GET /exposure. The load-bearing claim is PROVENANCE, so the sector pins cross the real kernel boundary rather than a fixture: sectorOf/DEFAULT_UNIVERSE/RISK_POLICIES/exitsToRun/trailingExits/rebalanceTrims/sizeEntry/IN_FLIGHT_STATUSES are imported for real, the mix must bucket exactly as sectorOf does (an unmapped name lands in 'other' AND unclassified, never a guessed sector), and the sector-headroom figure is proven against the REAL sizeEntry - if the engine's sector map or its cap rule ever disappears or changes shape, these go red instead of the card quietly mislabelling a live portfolio. The exits pins cover the two ways a panel can lie about protection: a core hold (coreConfig-exempt) and any non-regular session (computeExits runs ONLY the close-anchored dip rule off-hours), both of which must render as not-in-force with no wouldFireNow. Route/UI contracts are source pins.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review round. The UI half stops being a text pin and RUNS: tools/ui/view-account.js is a classic script, so it loads whole into a node:vm context with the app.js globals stubbed, and the card builders are called for real. That closes two holes. (a) The stale-paint contract is now proven by behaviour on BOTH paths - the painter is driven with stale() true after the await and asserted to have painted nothing - where the previous body-extraction pin was vacuous on a CRLF file (indexOf('\\n}\\n') = -1 widened the 'body' to the rest of the file, so deleting the success-path bail kept every assertion green). (b) Each of the six degradable sections is asserted, one at a time, to be REPEATED by a card instead of painted as fact; a failed protected-lot read must additionally withhold the whole rules table, because its fallback is a no-op subtraction and the engine's own answer to that read failing is to skip the fire.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Review round 2, and the item's OTHER half. (a) The autopilot's universe default is proven at the boundary the claim is about - the REAL express router is driven with a capturing ScheduleService, so the assertion is on the taskData actually handed to createSchedule (no `universe` key unless the operator pinned one; a pinned list carried verbatim; an over-ceiling list refused 400 with NOTHING scheduled), plus the engine-source pin that dispatch, research and assess each fall through to DEFAULT_UNIVERSE when the key is absent - which is the only reason omitting it is safe. (b) The cap-TRIM base is pinned to the engine's own (capped equity -> rebalanceTrims), separately from the per-sector denominator (sizeEntry's equity-or-cash), with a real-engine case proving the two bases are not interchangeable. (c) exits.rules is asserted to come back NULL, not a computed list, when the protected-lot read failed - the payload now enforces what only the card enforced before. (d) The service-secret/auth posture is refuted rather than left silent: /exposure is asserted byte-parallel to the /account and /positions reads beside it and to define no caller resolution of its own.
 *
 * Run from the package root with the framework checkout on the vitest alias path:
 *   OSHAL_FRAMEWORK=<oshal checkout> TRADING_MAX_NOTIONAL_USD=50000 TRADING_MAX_QTY=100000 \
 *     node <oshal checkout>/node_modules/vitest/vitest.mjs run --root . --no-file-parallelism
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import {
  sectorOf, sizeEntry, exitsToRun, trailingExits, rebalanceTrims,
  RISK_POLICIES, DEFAULT_UNIVERSE, nextPeaks,
} from '@/features/trading';
import type { BrokerAccount, OrderResult, Position } from '@/features/trading';
import { IN_FLIGHT_STATUSES } from '@/app/trading-dispatch-rail';
import { autopilotTaskType, setTradingScheduleService } from '@/app/trading-schedule-dispatch';
import type { ScheduleService } from '@/features/scheduling';
import { createTradingAutopilotRoutes } from '../src-routes/trading-autopilot-routes';
import {
  exposureMix, exitRuleRows, workingVenueOrders, EXPOSURE_SECTOR_SOURCE, EXPOSURE_KIND_SOURCE,
} from '../src-routes/trading-routes-book-read-builders';

const src = (f: string): string => readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const ROUTE = src('src-routes/trading-routes-book-read-builders.ts');
const TWIN = src('routes/trading-routes-book-read-builders.js');
const VA = src('tools/ui/view-account.js');
const AUTOPILOT = src('src-routes/trading-autopilot-routes.ts');
/* The ENGINE's own source. The universe-default claim is about what the dispatch legs do with an ABSENT
   taskData.universe, so it is read from the framework checkout the alias already points at rather than
   restated here - if a leg ever stops falling through to DEFAULT_UNIVERSE, omitting the pin stops being
   safe and this goes red. */
const FRAMEWORK = process.env.OSHAL_FRAMEWORK || path.resolve(__dirname, '../../../oshal');
const fw = (f: string): string => readFileSync(path.join(FRAMEWORK, f), 'utf8');

const POL = RISK_POLICIES.active;
const acct = (equity: number, cash: number): BrokerAccount => ({ cash, buyingPower: cash, equity, currency: 'USD' });
function pos(symbol: string, qty: number, avg: number, last: number): Position {
  return { symbol, qty, avgEntryPrice: avg, marketValue: qty * last, unrealizedPl: (last - avg) * qty, currentPrice: last };
}
const noKinds = (): string => 'unknown';

describe('the sector taxonomy is the ENGINE\'s, not the surface\'s (the provenance pin)', () => {
  it('every name in the engine\'s own universe resolves to a real sector bucket - not "other"', () => {
    // This is the pin that must go red if the source disappears: the card is only allowed to show a
    // sector mix BECAUSE the engine already carries a symbol->sector map that its per-sector cap
    // enforces. If that map is gone (or stops covering the universe), the card is mislabelling a
    // real portfolio and the honest answer is to stop shipping it.
    const unmapped = DEFAULT_UNIVERSE.filter((s) => sectorOf(s) === 'other');
    expect(unmapped, `engine universe names with no sector: ${unmapped.join(',')}`).toEqual([]);
    expect(DEFAULT_UNIVERSE.length).toBeGreaterThan(100);
    expect(new Set(DEFAULT_UNIVERSE.map((s) => sectorOf(s))).size).toBeGreaterThanOrEqual(8);
  });

  it('the card names its two sources, and both name the system they really came from', () => {
    expect(EXPOSURE_SECTOR_SOURCE).toContain('sectorOf');
    expect(EXPOSURE_SECTOR_SOURCE).toContain('per-sector sizing cap');
    // Stock-vs-ETF is Alpaca's directory even for a Schwab book - it must not read as venue data.
    expect(EXPOSURE_KIND_SOURCE).toContain('Alpaca');
    expect(ROUTE).toContain('EXPOSURE_SECTOR_SOURCE');
    expect(ROUTE).toContain('EXPOSURE_KIND_SOURCE');
  });

  it('the mix buckets every name exactly as sectorOf does - no second taxonomy exists in the package', () => {
    const held = [pos('NVDA', 10, 100, 120), pos('JPM', 5, 200, 210), pos('XOM', 4, 100, 90)];
    const mix = exposureMix(held, new Map(), acct(10000, 1000), 10000, POL, new Map(), noKinds);
    for (const p of held) {
      const row = mix.bySector.find((s) => s.symbols.some((y) => y.symbol === p.symbol));
      expect(row, `${p.symbol} missing from the mix`).toBeTruthy();
      expect(row!.sector).toBe(sectorOf(p.symbol));
    }
    // No hand-typed map may live in the package - the only sector authority is the kernel import.
    expect(ROUTE).not.toMatch(/const\s+SECTORS?\s*[:=]/);
  });

  it('a name the engine does not classify lands in "other" AND is listed as unclassified', () => {
    const odd = 'ZZZZ';
    expect(sectorOf(odd)).toBe('other');
    const mix = exposureMix([pos(odd, 1, 10, 12)], new Map(), acct(1000, 100), 1000, POL, new Map(), noKinds);
    expect(mix.bySector.find((s) => s.sector === 'other')).toBeTruthy();
    expect(mix.unclassified).toEqual([odd]);
  });
});

describe('the mix measures against the SAME cap the engine sizes with', () => {
  it('sector headroom is maxSectorPct% of the CAPPED equity minus what that sector already holds', () => {
    const held = [pos('NVDA', 10, 100, 100)];               // 1,000 in 'tech'
    const capEquity = 10000;
    const mix = exposureMix(held, new Map(), acct(20000, 5000), capEquity, POL, new Map(), noKinds);
    const tech = mix.bySector.find((s) => s.sector === 'tech')!;
    expect(tech.capPct).toBe(POL.maxSectorPct);
    expect(tech.headroom).toBeCloseTo((POL.maxSectorPct / 100) * capEquity - 1000, 2);
    // percentages use the ACCOUNT equity, headroom the CAPPED equity - the two denominators differ
    // on a capped live book and the card must not silently blend them.
    expect(tech.pctOfEquity).toBeCloseTo(5, 2);
    expect(tech.pctOfCapEquity).toBeCloseTo(10, 2);
  });

  it('when the card shows no headroom left, the REAL sizeEntry refuses the buy for the sector cap', () => {
    // The integration claim: this is not a lookalike formula, it is the rule sizeEntry enforces.
    const capEquity = 10000;
    const sectorFull = [pos('NVDA', 1, 100, (POL.maxSectorPct / 100) * capEquity)];
    const mix = exposureMix(sectorFull, new Map(), acct(capEquity, capEquity), capEquity, POL, new Map(), noKinds);
    expect(mix.bySector.find((s) => s.sector === 'tech')!.headroom).toBeCloseTo(0, 2);
    const sized = sizeEntry('MSFT', 50, 1, acct(capEquity, capEquity), sectorFull, POL);
    expect(sectorOf('MSFT')).toBe('tech');
    expect(sized.qty).toBe(0);
    expect(sized.blocked).toContain('sector cap');
  });

  it('pinned shares are reported per name and never folded into the sector value', () => {
    const mix = exposureMix([pos('NVDA', 10, 100, 100)], new Map([['NVDA', 4]]), acct(10000, 0), 10000, POL, new Map(), noKinds);
    const row = mix.bySector[0].symbols[0];
    expect(row.pinnedQty).toBe(4);
    expect(row.value).toBe(1000);
  });

  it('a sector tilt rides the row as a multiplier and defaults to 1 for untilted sectors', () => {
    const mix = exposureMix([pos('NVDA', 1, 10, 10), pos('JPM', 1, 10, 10)], new Map(), acct(100, 0), 100, POL,
      new Map([['tech', 1.4]]), noKinds);
    expect(mix.bySector.find((s) => s.sector === 'tech')!.tilt).toBe(1.4);
    expect(mix.bySector.find((s) => s.sector === 'financials')!.tilt).toBe(1);
  });

  it('with no asset directory every kind reads "unknown" - never a guessed stock/ETF split', () => {
    const mix = exposureMix([pos('NVDA', 1, 10, 10)], new Map(), acct(100, 20), 100, POL, new Map(), noKinds);
    expect(mix.byKind.map((k) => k.kind).sort()).toEqual(['cash', 'unknown']);
    expect(mix.byKind.find((k) => k.kind === 'unknown')!.value).toBe(10);
    expect(mix.byKind.find((k) => k.kind === 'cash')!.value).toBe(20);
  });
});

describe('the exits panel cannot disagree with the engine', () => {
  const peaks = new Map<string, number>();

  it('stop and take-profit are the posture\'s own percentages off average cost', () => {
    for (const pol of Object.values(RISK_POLICIES)) {
      const [row] = exitRuleRows([pos('NVDA', 10, 100, 100)], pol, peaks, 1e9, new Set(), true);
      expect(row.stopPx).toBeCloseTo(100 * (1 - pol.stopLossPct / 100), 2);
      expect(row.takeProfitPx).toBeCloseTo(100 * (1 + pol.takeProfitPct / 100), 2);
    }
  });

  it('the trailing stop arms exactly at trailArmPct and prices off the stored peak', () => {
    const armAt = 100 * (1 + POL.trailArmPct / 100);
    const pk = new Map([['NVDA', 130]]);
    const [below] = exitRuleRows([pos('NVDA', 1, 100, armAt - 0.01)], POL, pk, 1e9, new Set(), true);
    const [at] = exitRuleRows([pos('NVDA', 1, 100, armAt)], POL, pk, 1e9, new Set(), true);
    expect(below.trailArmed).toBe(false);
    expect(below.trailStopPx).toBeNull();
    expect(at.trailArmed).toBe(true);
    expect(at.trailStopPx).toBeCloseTo(130 * (1 - POL.trailGivebackPct / 100), 2);
  });

  it('"would fire now" is literally what the engine\'s own exit functions return for that position', () => {
    const cases = [pos('NVDA', 10, 100, 90), pos('JPM', 10, 100, 130), pos('XOM', 10, 100, 101)];
    for (const p of cases) {
      const engine = [...exitsToRun([p], POL), ...trailingExits([p], peaks, POL), ...rebalanceTrims([p], 1e9, POL)];
      const [row] = exitRuleRows([p], POL, peaks, 1e9, new Set(), true);
      expect(row.wouldFireNow).toBe(engine.length ? engine[0].reason : null);
    }
  });

  it('a cap-breaching name carries the engine\'s own trim quantity', () => {
    const p = pos('NVDA', 100, 10, 10);                       // 1,000 against a 3%-of-10,000 cap
    const trim = rebalanceTrims([p], 10000, POL);
    const [row] = exitRuleRows([p], POL, peaks, 10000, new Set(), true);
    expect(trim.length).toBe(1);
    expect(row.trimQty).toBe(trim[0].qty);
  });

  it('a CORE HOLD is exempt: the dispatch filters its exits, so the panel must never advertise one', () => {
    // trading-schedule-dispatch filters every computed exit whose symbol is in coreConfig().symbols.
    // A stop shown on SPY here would be a stop the engine will never fire.
    const p = pos('SPY', 10, 100, 80);                        // -20%: would otherwise stop out
    expect(exitsToRun([p], POL).length).toBe(1);
    const [row] = exitRuleRows([p], POL, peaks, 1e9, new Set(['SPY']), true);
    expect(row.coreHold).toBe(true);
    expect(row.ruleActive).toBe(false);
    expect(row.wouldFireNow).toBeNull();
    expect(row.trimQty).toBe(0);
  });

  it('outside the regular session NO rule is in force - off-hours the engine runs only the dip rule', () => {
    const p = pos('NVDA', 10, 100, 80);
    const [row] = exitRuleRows([p], POL, peaks, 1e9, new Set(), false);
    expect(row.ruleActive).toBe(false);
    expect(row.wouldFireNow).toBeNull();
    // the prices are still shown (they are the rule), but nothing claims it fires
    expect(row.stopPx).toBeGreaterThan(0);
  });
});

describe('working orders are the VENUE\'s answer, not the strategy\'s intent', () => {
  const order = (o: Partial<OrderResult>): OrderResult => ({
    id: 'o1', clientOrderId: 'sub:auto-1', status: 'accepted', symbol: 'NVDA', side: 'sell', qty: 5,
    type: 'stop', filledQty: 0, provider: 'alpaca', mode: 'paper', ...o,
  } as OrderResult);

  it('only the kernel\'s own non-terminal statuses survive - the set is imported, never restated', () => {
    const rows = workingVenueOrders(
      ['pending', 'accepted', 'partially_filled', 'filled', 'canceled', 'rejected', 'expired']
        .map((status, i) => order({ id: 'o' + i, status: status as OrderResult['status'] })),
      new Set(), 200,
    );
    expect(rows.map((r) => r.status).sort()).toEqual([...IN_FLIGHT_STATUSES].sort());
    expect(ROUTE).toContain("import { capAccount, IN_FLIGHT_STATUSES } from '@/app/trading-dispatch-rail'");
  });

  it('origin is claimed only where the order itself proves it', () => {
    const rows = workingVenueOrders([
      order({ id: 'lotOrd', clientOrderId: 'sub:plain-1' }),
      order({ id: 'byClient', clientOrderId: 'sub:lot-abc-tp-1' }),
      order({ id: 'other', clientOrderId: 'sub:auto-9' }),
    ], new Set(['lotOrd']), 200);
    const by = Object.fromEntries(rows.map((r) => [r.orderId, r.origin]));
    expect(by.lotOrd).toBe('protected-lot');       // the lot ledger recorded this exit order id
    expect(by.byClient).toBe('protected-lot');     // the kernel's lot- request-id convention
    expect(by.other).toBe('unattributed');         // nothing proves an origin: say so
  });

  it('newest first, and the row ceiling is honoured', () => {
    const rows = workingVenueOrders([
      order({ id: 'a', submittedAt: '2026-09-01T10:00:00Z' }),
      order({ id: 'b', submittedAt: '2026-09-05T10:00:00Z' }),
      order({ id: 'c', submittedAt: '2026-09-03T10:00:00Z' }),
    ], new Set(), 2);
    expect(rows.map((r) => r.orderId)).toEqual(['b', 'c']);
  });
});

describe('GET /exposure - the route contract', () => {
  it('is registered on the read-only book routes, 401-gated, and book-scoped through routeBook', () => {
    expect(ROUTE).toContain("router.get('/exposure'");
    const handler = ROUTE.slice(ROUTE.indexOf("router.get('/exposure'"));
    expect(handler).toContain('const sub = callerSub(req);');
    expect(handler).toContain("res.status(401).json({ error: 'not_authenticated' })");
    expect(handler).toContain('await routeBook(ctx, sub, req)');
    // routeBook is the package's query-first resolver - book= wins, ?mode= is the legacy alias.
    expect(src('src-routes/trading-accounts-routes.ts'))
      .toContain("resolveBook(ctx.pool, s, (req.query.book as string | undefined) ?? (req.query.mode as string | undefined))");
  });

  it('reads through the BOOK-BOUND reader and 503s when that book\'s broker is not connected', () => {
    const handler = ROUTE.slice(ROUTE.indexOf("router.get('/exposure'"));
    expect(handler).toContain('getBrokerReader(book.kind, sub, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined)');
    expect(handler).toContain("res.status(503).json({ error: 'broker_not_configured' })");
  });

  it('is READ-ONLY: it places no order, arms no adapter and never persists a peak', () => {
    const handler = ROUTE.slice(ROUTE.indexOf('-- ADR-136 exposure'));
    expect(handler).not.toContain('placeDecisionOrder');
    expect(handler).not.toContain('getBrokerAdapter');
    // a CALL, not the word: SEQ 7's comment names savePeaks to say the read route must never invoke it
    expect(handler).not.toContain('savePeaks(');
    expect(handler).not.toContain('placeManaged');
  });

  it('reuses the engine\'s own cap and core-hold functions instead of restating them', () => {
    expect(ROUTE).toContain("import { coreConfig } from '@/app/trading-dispatch-core'");
    expect(ROUTE).toContain('capAccount(inp.account, book)');
    expect(ROUTE).toContain('coreConfig(override)');
    // no local re-derivation of the live capital cap
    expect(ROUTE).not.toContain('TRADING_CAPITAL_CAP_USD');
  });

  it('a failed side read degrades ONE section, is logged at error, and fabricates nothing', () => {
    expect(ROUTE).toMatch(/logger\.error\(\{ err, book: bookRef, section: name \}/);
    expect(ROUTE).toContain("sections[name] = 'unavailable';");
    // working orders are null (unknown) rather than [] (nothing resting) when the venue read failed
    expect(ROUTE).toContain('working: inp.orders ? workingVenueOrders(');
    expect(ROUTE).toContain(': null,');
  });

  it('the trailing peak is the ENGINE\'s rolled-forward peak, and it is never persisted here', () => {
    // computeExits evaluates trailingExits against nextPeaks(positions, storedPeaks); a card reading the
    // RAW stored peak would price a winner at a new high off a stale high and disagree with the engine.
    expect(ROUTE).toContain('nextPeaks');
    expect(ROUTE).toContain('const peaks = nextPeaks(visible, inp.peaks);');
    expect(ROUTE).toContain('? exitRuleRows(visible, policy, peaks, capped.equity,');
    expect(ROUTE.slice(ROUTE.indexOf('-- ADR-136 exposure'))).not.toContain('savePeaks(');
    // the roll-forward is the kernel's own function, not a local max()
    expect(nextPeaks(([pos('NVDA', 1, 100, 130)]), new Map([['NVDA', 120]])).get('NVDA')).toBe(130);
  });

  it('the per-sector cap denominator is sizeEntry\'s own base - capped equity, or capped CASH at zero equity', () => {
    expect(ROUTE).toContain('const capBase = capped.equity > 0 ? capped.equity : capped.cash;');
    expect(ROUTE).toContain('exposureMix(visible, inp.pinned, inp.account, capBase,');
    // a cash-only book still sizes in the engine, so the card must not report zero headroom for it
    const mix = exposureMix([], new Map(), acct(0, 5000), 5000, POL, new Map(), noKinds);
    expect(mix.byKind.find((k) => k.kind === 'cash')!.value).toBe(5000);
    const sized = sizeEntry('MSFT', 50, 1, acct(0, 5000), [], POL);
    expect(sized.qty).toBeGreaterThan(0);
  });

  it('the cap-TRIM base is the ENGINE\'s own - capped equity, NOT the per-sector denominator', () => {
    // Two different rules that happen to look alike. The engine sizes SECTORS off sizeEntry's
    // equity-or-cash base, but it TRIMS off account.equity of the CAPPED account - so reusing the
    // sector base for trims would invent a divergence on a zero-equity book. Read from the engine:
    expect(fw('src/app/trading-schedule-dispatch.ts')).toContain('capAccount(accountRaw');
    expect(fw('src/app/trading-schedule-dispatch.ts'))
      .toContain('computeExits(ctx, sub, book, positions, policy, account.equity, extHours)');
    expect(fw('src/app/trading-dispatch-exits-entries.ts')).toContain('rebalanceTrims(positions, equity, policy)');
    expect(ROUTE).toContain('exitRuleRows(visible, policy, peaks, capped.equity,');
    // and the two bases are not interchangeable: the REAL rebalanceTrims answers differently on each
    const held = pos('NVDA', 100, 10, 10);
    expect(rebalanceTrims([held], 1000, POL).length).toBe(1);
    expect(rebalanceTrims([held], 1000000, POL).length).toBe(0);
  });

  it('a failed protected-lot read WITHHOLDS exits.rules in the PAYLOAD, not only on the card', () => {
    // A non-browser consumer (a tool, the MCP surface) that reads exits.rules without checking
    // `sections` would otherwise be handed stops computed over shares the autopilot may not sell.
    const exitsBlock = ROUTE.slice(ROUTE.indexOf('    exits: {'), ROUTE.indexOf('    sections: inp.sections,'));
    expect(exitsBlock).toContain("rules: inp.sections.pinnedLots === 'ok'");
    expect(exitsBlock).toContain(': null,');
  });

  it('carries the auth posture of the reads BESIDE it - it adds none and relaxes none', () => {
    // The critique asked whether /exposure sits behind the same service-secret read posture ADR-134 gave
    // the account reads. It does, and not by its own arrangement: it uses the SAME shared callerSub, the
    // same reader construction and the same mount as /account and /positions, and defines no caller
    // resolution of its own - so the posture cannot drift for this one route.
    const cut = (name: string): string => ROUTE.slice(ROUTE.indexOf(`router.get('${name}'`), ROUTE.indexOf(`router.get('${name}'`) + 1200);
    for (const r of ['/account', '/positions', '/exposure']) {
      const h = cut(r);
      expect(h, `${r} must resolve its caller through the shared helper`).toContain('const sub = callerSub(req);');
      expect(h, `${r} must 401 an unauthenticated caller`).toContain("res.status(401).json({ error: 'not_authenticated' })");
      expect(h, `${r} must read through the book-bound READER`).toContain('getBrokerReader(');
      expect(h, `${r} must never construct an order-placing adapter`).not.toContain('getBrokerAdapter(');
    }
    expect(ROUTE).toContain("import { callerSub, resolveMode, servePage, guardrails } from '@/app/routes/trading-routes-helpers'");
    expect(ROUTE.slice(ROUTE.indexOf('-- ADR-136 exposure'))).not.toMatch(/function callerSub|getTrustedServiceUserSub/);
  });

  it('the session decides whether the rule block is in force, and TRADING_HALT is one of the answers', () => {
    expect(ROUTE).toContain('tradableSessionDetailed()');
    expect(ROUTE).toContain("const rulesRunNow = session.session === 'regular';");
    expect(ROUTE).toContain('TRADING_EXT_DIP_SELL_PCT');
  });

  it('nothing is hard-coded: both new ceilings are env-driven with a default', () => {
    expect(ROUTE).toContain('process.env.TRADING_EXPOSURE_ORDERS_DAYS');
    expect(ROUTE).toContain('process.env.TRADING_EXPOSURE_WORKING_MAX');
  });

  it('the compiled twin carries the route (the deployed artifact, not just the source)', () => {
    expect(TWIN).toContain("'/exposure'");
    expect(TWIN).toContain('exposureMix');
  });
});

/* The account view is a classic script: it declares functions and a few globals and executes nothing
   at load, so it loads whole into a vm context with app.js's globals stubbed and its card builders can
   be CALLED. That is the difference between pinning the source text and proving the behaviour. */
interface ViewCtx {
  exitsCardHtml: (x: unknown) => string;
  mixCardHtml: (x: unknown) => string;
  renderExposureCards: (token: unknown) => Promise<void>;
  [k: string]: unknown;
}
function loadView(over: Record<string, unknown> = {}): ViewCtx {
  const ctx: Record<string, unknown> = {
    console, window: {},
    esc: (v: unknown) => String(v == null ? '' : v),
    money: (n: unknown) => '$' + Number(n || 0).toFixed(2),
    fmtDate: (d: unknown) => String(d),
    ...over,
  };
  vm.createContext(ctx);
  vm.runInContext(VA, ctx, { filename: 'view-account.js' });
  return ctx as unknown as ViewCtx;
}

/** A whole-book /exposure answer with every section healthy; `over` degrades exactly what a case needs. */
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'paper', book: 'paper', asOf: new Date().toISOString(),
    basis: { equity: 1000, cash: 100, deployed: 900, capEquity: 1000, capBase: 1000, capped: false },
    policy: {
      posture: 'active', source: 'env', maxPerNamePct: 3, maxSectorPct: 30,
      stopLossPct: 5, takeProfitPct: 8, trailArmPct: 6, trailGivebackPct: 3,
    },
    engine: {
      session: 'regular', reason: 'open', blind: false, rulesRunNow: true, offHoursDipPct: 0.5,
      coreHolds: [], universeCount: DEFAULT_UNIVERSE.length, universeClassified: DEFAULT_UNIVERSE.length,
    },
    sources: { sector: EXPOSURE_SECTOR_SOURCE, assetKind: EXPOSURE_KIND_SOURCE },
    mix: {
      byKind: [{ kind: 'stock', value: 900, pctOfEquity: 90 }],
      bySector: [{
        sector: 'tech', value: 900, pctOfEquity: 90, pctOfCapEquity: 90, capPct: 30, headroom: -600, tilt: 1,
        symbols: [{ symbol: 'NVDA', value: 900, pinnedQty: 0 }],
      }],
      unclassified: [],
    },
    exits: {
      working: [],
      rules: [{
        symbol: 'NVDA', qty: 9, avgEntryPrice: 100, currentPrice: 100, stopPx: 95, takeProfitPx: 108,
        peak: 100, trailArmed: false, trailStopPx: null, trimQty: 0, wouldFireNow: null,
        coreHold: false, ruleActive: true,
      }],
    },
    sections: {
      pinnedLots: 'ok', protectedLots: 'ok', peaks: 'ok', strategy: 'ok', workingOrders: 'ok', assetKinds: 'ok',
    },
    ...over,
  };
}
const SECTIONS = (over: Record<string, string>): Record<string, unknown> =>
  ({ sections: { pinnedLots: 'ok', protectedLots: 'ok', peaks: 'ok', strategy: 'ok', workingOrders: 'ok', assetKinds: 'ok', ...over } });

describe('the account page paints both cards (tools/ui/view-account.js)', () => {
  it('the skeleton hosts both cards and the view kicks the painter off with its render token', () => {
    expect(VA).toContain('<div id="mixCard"></div>');
    expect(VA).toContain('<div id="exitsCard"></div>');
    expect(VA).toContain('renderExposureCards(token);');
  });

  it('paints the server\'s own numbers when every section is healthy', () => {
    const v = loadView();
    const mix = v.mixCardHtml(payload());
    const exits = v.exitsCardHtml(payload());
    expect(mix).toContain('Allocation');
    expect(mix).toContain('tech');
    expect(exits).toContain('Autopilot exit rules');
    expect(exits).toContain('NVDA');
    expect(exits).toContain('NOT orders resting at the venue');
    // nothing is degraded, so no red banner is invented either
    expect(mix).not.toContain('Degraded');
    expect(exits).not.toContain('Degraded');
  });
});

describe('a degraded section is REPEATED by the card, never painted as fact', () => {
  // The route answers six side reads and degrades each to 'unavailable' rather than fabricating. The
  // card is the half that can undo that honesty, so every one of the six is asserted here: forget one
  // and this goes red. The words must also say what the fallback COSTS, not merely that a read failed.
  // Each card is checked on its OWN, not on the two concatenated: a section the Allocation card needs
  // must be said by the Allocation card, or a reader looking only at it is reading a fabricated mix.
  const MIX_MUST_SAY: Record<string, string> = {
    pinnedLots: 'protected-lot pins could not be read',
    strategy: 'strategy override could not be read',
    assetKinds: 'Stock-vs-ETF is unavailable',
  };
  const EXITS_MUST_SAY: Record<string, string> = {
    pinnedLots: 'protected-lot pins could not be read',
    protectedLots: 'protected-lot records could not be read',
    peaks: 'trailing peaks could not be read',
    strategy: 'strategy override could not be read',
    workingOrders: 'working orders could not be read',
  };

  for (const section of Object.keys(MIX_MUST_SAY)) {
    it(`the Allocation card itself says so when the ${section} read failed`, () => {
      const v = loadView();
      const painted = v.mixCardHtml(payload(SECTIONS({ [section]: 'unavailable' })));
      expect(painted, `${section} is degraded but the Allocation card says nothing`).toContain(MIX_MUST_SAY[section]);
    });
  }

  for (const section of Object.keys(EXITS_MUST_SAY)) {
    it(`the Exits card itself says so when the ${section} read failed`, () => {
      const v = loadView();
      const painted = v.exitsCardHtml(payload(SECTIONS({ [section]: 'unavailable' })));
      expect(painted, `${section} is degraded but the Exits card says nothing`).toContain(EXITS_MUST_SAY[section]);
    });
  }

  it('between them the two cards cover EVERY section the route can report unavailable', () => {
    // The route's own list, read from its source - so a seventh section added there fails here until a
    // card learns to say it, instead of being silently painted as fact.
    const emitted = [...ROUTE.matchAll(/exposureSection\('([a-zA-Z]+)'/g)].map((m) => m[1]);
    expect(emitted.length).toBeGreaterThanOrEqual(6);
    const covered = new Set([...Object.keys(MIX_MUST_SAY), ...Object.keys(EXITS_MUST_SAY)]);
    expect([...new Set(emitted)].filter((n) => !covered.has(n))).toEqual([]);
  });

  it('a failed protected-lot read WITHHOLDS the rules table - it never draws stops over pinned shares', () => {
    // The engine's own answer to this read failing is to skip the fire (it could otherwise sell shares
    // the operator ring-fenced). The card's equivalent is to show no rules at all: the fallback is a
    // NO-OP subtraction, so every price would be computed over shares the autopilot may not touch.
    const v = loadView();
    const x = payload(SECTIONS({ pinnedLots: 'unavailable' }));
    const exits = v.exitsCardHtml(x);
    expect(exits).toContain('exit rules are not shown');
    expect(exits).not.toContain('NVDA');                                   // no rule row survives
    expect(exits).not.toContain('Protected-lot shares are excluded');      // nor the claim that they are
    // and the header pill must not simultaneously say the rules are in force
    expect(exits).not.toContain('the rules below are in force');
    expect(exits).toContain('withheld');
  });

  it('a healthy protected-lot read still shows the rules (the withholding is the exception, not the default)', () => {
    const v = loadView();
    const exits = v.exitsCardHtml(payload());
    expect(exits).toContain('NVDA');
    expect(exits).toContain('Protected-lot shares are excluded');
  });

  it('a core hold and an out-of-session row render as NOT in force, never as a stop that will fire', () => {
    const v = loadView();
    const base = payload();
    const rules = [
      { symbol: 'SPY', qty: 10, avgEntryPrice: 100, currentPrice: 80, stopPx: 95, takeProfitPx: 108, peak: 100,
        trailArmed: false, trailStopPx: null, trimQty: 0, wouldFireNow: null, coreHold: true, ruleActive: false },
      { symbol: 'NVDA', qty: 9, avgEntryPrice: 100, currentPrice: 80, stopPx: 95, takeProfitPx: 108, peak: 100,
        trailArmed: false, trailStopPx: null, trimQty: 0, wouldFireNow: null, coreHold: false, ruleActive: false },
    ];
    const html = v.exitsCardHtml({
      ...base,
      engine: { ...(base.engine as Record<string, unknown>), session: 'post', rulesRunNow: false },
      exits: { working: [], rules },
    });
    expect(html).toContain('core hold — exempt from every autopilot exit');
    expect(html).toContain('rules not in force right now');
    expect(html).toContain('only the ');                              // the off-hours dip rule is named
    expect(html).toContain('only the close-anchored dip rule');       // and the foot says what runs instead
    expect(html).not.toContain('$95.00');                             // no stop price is advertised for either row
  });

  it('a failed peaks read is called out where the trailing prices are, not only at the top', () => {
    const v = loadView();
    const exits = v.exitsCardHtml(payload(SECTIONS({ peaks: 'unavailable' })));
    expect(exits).toContain('anchored at average cost');
  });

  it('a failed venue order read reads as UNKNOWN, never as an empty (reassuring) list', () => {
    const v = loadView();
    const x = payload({ exits: { working: null, rules: [] }, ...SECTIONS({ workingOrders: 'unavailable' }) });
    expect(v.exitsCardHtml(x)).toContain('this list is unknown, not empty');
  });

  it('the Allocation foot names both sources and calls out anything outside the engine\'s map', () => {
    const v = loadView();
    const base = payload();
    const mixArg = { ...(base.mix as Record<string, unknown>), unclassified: ['ZZZZ'] };
    const mix = v.mixCardHtml({ ...base, mix: mixArg });
    expect(mix).toContain('Sectors are ');
    expect(mix).toContain('outside that map');
    expect(mix).toContain('never assigned a sector');
    expect(mix).toContain('ZZZZ');
  });
});

describe('the painter cannot overpaint a view the operator has already left', () => {
  /* The shared contract tests/trading-ui-loader-guards.spec.ts pins for load* loaders: capture the token
     before the first await, re-check stale(token) after it, and paint NOTHING when it is stale. This
     painter follows renderStrategyLine's render* spelling, so the contract is proven here - by driving
     it, not by matching its source, because a source pin cannot see a deleted bail on one path only. */
  it('paints both cards when the view is still current', async () => {
    const els: Record<string, { innerHTML: string }> = { mixCard: { innerHTML: '' }, exitsCard: { innerHTML: '' } };
    const v = loadView({ $: (id: string) => els[id], stale: () => false, api: async () => payload() });
    await v.renderExposureCards(1);
    expect(els.mixCard.innerHTML).toContain('Allocation');
    expect(els.exitsCard.innerHTML).toContain('Exits');
  });

  it('paints NOTHING on the success path once the view has moved on', async () => {
    const els: Record<string, { innerHTML: string }> = { mixCard: { innerHTML: '' }, exitsCard: { innerHTML: '' } };
    const v = loadView({ $: (id: string) => els[id], stale: () => true, api: async () => payload() });
    await v.renderExposureCards(1);
    expect(els.mixCard.innerHTML).toBe('');
    expect(els.exitsCard.innerHTML).toBe('');
  });

  it('paints NOTHING on the error path either - a stale failure must not overwrite the new account', async () => {
    const els: Record<string, { innerHTML: string }> = { mixCard: { innerHTML: '' }, exitsCard: { innerHTML: '' } };
    const v = loadView({ $: (id: string) => els[id], stale: () => true, api: async () => { throw new Error('boom'); } });
    await v.renderExposureCards(1);
    expect(els.mixCard.innerHTML).toBe('');
    expect(els.exitsCard.innerHTML).toBe('');
  });

  it('a live failure DOES say so on the current view - the bail is about staleness, not silence', async () => {
    const els: Record<string, { innerHTML: string }> = { mixCard: { innerHTML: '' }, exitsCard: { innerHTML: '' } };
    const v = loadView({ $: (id: string) => els[id], stale: () => false, api: async () => { throw new Error('boom'); } });
    await v.renderExposureCards(1);
    expect(els.mixCard.innerHTML).toContain('Unavailable: boom');
    expect(els.exitsCard.innerHTML).toContain('Unavailable: boom');
  });

  it('the source still shows a stale check on both paths, scoped to THIS function body', () => {
    // Belt and braces to the behavioural proof above, and scoped properly: the earlier form sliced on
    // '\n}\n', which never matches in a CRLF file and silently widened the body to the rest of the file.
    const fn = VA.slice(VA.indexOf('async function renderExposureCards(token) {'));
    const end = fn.search(/\r?\n\}\r?\n/);
    expect(end).toBeGreaterThan(0);
    const body = fn.slice(0, end);
    expect(body.length).toBeLessThan(1200);                       // the body, not the rest of the file
    expect(body).not.toContain('function mixCardHtml');
    const m = /catch \(e\) \{\r?\n([\s\S]*?)\r?\n  \}/.exec(body);
    expect(m, 'the catch block was not found inside the painter body').toBeTruthy();
    const catchBody = m![1];
    const successBody = body.slice(m!.index + m![0].length);
    expect(catchBody.trimStart().startsWith('if (stale(token)) return;')).toBe(true);
    expect(catchBody.indexOf('stale(token)')).toBeLessThan(catchBody.indexOf('innerHTML'));
    expect(successBody).toContain("if (stale(token) || !$('mixCard')) return;");
    expect(successBody.indexOf('stale(token)')).toBeLessThan(successBody.indexOf('innerHTML'));
  });

  it('the new markup carries no inline handler attributes (strict CSP)', () => {
    const block = VA.slice(VA.indexOf('async function renderExposureCards(token) {'), VA.indexOf('let ACCT_LOTS = [];'));
    expect(block).not.toMatch(/onclick=/);
    expect(block).not.toMatch(/onchange=/);
  });
});

/* ── the advisor scans the ENGINE's universe, not a frozen copy of it ─────────────────────────── */
/* The item's other half. The claim is about the taskData the schedule service is actually HANDED, so
   this drives the REAL express router the package mounts with a capturing ScheduleService rather than
   matching the route's source: a source pin cannot see a leg that quietly re-adds the key, and it
   cannot see a refusal that schedules six legs before it answers 400. */
const AUTO_SUB = 'k-surface-expansion-spec-sub';
interface CreatedLeg { taskType: string; schedule: string; ownerSub: string; taskData: Record<string, unknown> }

/** A ScheduleService that records every leg instead of persisting one. */
function captureScheduler(created: CreatedLeg[], existing: unknown[] = []): ScheduleService {
  return {
    createSchedule: async (a: CreatedLeg) => {
      created.push(a);
      return {
        id: 'sched-' + created.length, taskType: a.taskType, cron: a.schedule, ownerSub: a.ownerSub,
        status: 'active', taskData: a.taskData, executionCount: 0, nextRunAt: null, lastRunAt: null,
      };
    },
    listSchedules: async () => existing,
    deleteSchedule: async () => true,
  } as unknown as ScheduleService;
}

/** One request through the REAL router (express matches the path and runs the real handler). */
async function callAutopilot(method: 'GET' | 'POST', body: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const router = createTradingAutopilotRoutes();
  let status = 200;
  let out: Record<string, unknown> = {};
  await new Promise<void>((resolve, reject) => {
    const res: Record<string, unknown> = {};
    res.status = (code: number) => { status = code; return res; };
    res.json = (payloadOut: Record<string, unknown>) => { out = payloadOut; resolve(); return res; };
    const req = {
      method, url: '/', originalUrl: '/', baseUrl: '', path: '/', body, query: {}, headers: {},
      get: () => undefined, oidc: { user: { sub: AUTO_SUB } },
    };
    (router as unknown as (q: unknown, r: unknown, n: (e?: unknown) => void) => void)(
      req, res, (err?: unknown) => reject(err instanceof Error ? err : new Error('no route matched')),
    );
  });
  return { status, body: out };
}

/** A schedule row shaped the way the scheduler stores one, so statusOf reads a real record. */
const autopilotRow = (taskData: Record<string, unknown>): Record<string, unknown> => ({
  id: 'sched-existing', taskType: autopilotTaskType(AUTO_SUB), cron: '*/5 * * * *', ownerSub: AUTO_SUB,
  status: 'active', taskData, executionCount: 4, nextRunAt: null, lastRunAt: null,
});

describe('arming the advisor tracks the engine\'s universe instead of freezing a copy of it', () => {
  const envBefore = process.env.TRADING_UNIVERSE_MAX_PIN;
  afterEach(() => {
    if (envBefore === undefined) delete process.env.TRADING_UNIVERSE_MAX_PIN;
    else process.env.TRADING_UNIVERSE_MAX_PIN = envBefore;
    setTradingScheduleService(null as unknown as ScheduleService);
  });

  it('with no universe pinned, NO leg carries a universe - the key is absent, not empty', async () => {
    const created: CreatedLeg[] = [];
    setTradingScheduleService(captureScheduler(created));
    const r = await callAutopilot('POST', {});
    expect(r.status).toBe(200);
    expect(created.length).toBe(7);                       // technical + the six advisor legs
    for (const leg of created) {
      expect(Object.keys(leg.taskData), `${leg.taskType} still pins a universe`).not.toContain('universe');
      expect(leg.taskData.userSub).toBe(AUTO_SUB);
      expect(leg.taskData.mode).toBe('paper');
    }
    // and the prompt no longer states a symbol count taken from a list frozen at arming time
    expect(String(created[0].taskData.prompt)).toContain('default universe');
  });

  it('omitting the key is only SAFE because the engine falls through - so the engine is read, not assumed', () => {
    // Each leg that scans resolves its own universe when taskData carries none. If any of these three
    // stops falling through, arming without a pin would scan nothing and this goes red.
    expect(fw('src/app/trading-schedule-dispatch.ts'))
      .toContain('        : DEFAULT_UNIVERSE;');
    expect(fw('src/app/trading-research-dispatch.ts'))
      .toContain('Array.isArray(td.universe) && td.universe.length ? (td.universe as unknown[]).map((s) => String(s).toUpperCase()) : DEFAULT_UNIVERSE');
    expect(fw('src/app/trading-assess-dispatch.ts'))
      .toContain('Array.isArray(td.universe) && td.universe.length ? (td.universe as unknown[]).map((s) => String(s).toUpperCase()) : DEFAULT_UNIVERSE');
  });

  it('a caller-pinned list IS honoured - deduped, upper-cased and carried to every leg', async () => {
    const created: CreatedLeg[] = [];
    setTradingScheduleService(captureScheduler(created));
    const r = await callAutopilot('POST', { universe: ['nvda', 'NVDA', ' msft '] });
    expect(r.status).toBe(200);
    for (const leg of created) expect(leg.taskData.universe).toEqual(['NVDA', 'MSFT']);
    expect(r.body.universeSource).toBe('pinned');
    expect(r.body.universeCount).toBe(2);
  });

  it('a list over the ceiling is REFUSED, and nothing is scheduled - the old code silently truncated', async () => {
    process.env.TRADING_UNIVERSE_MAX_PIN = '3';
    const created: CreatedLeg[] = [];
    setTradingScheduleService(captureScheduler(created));
    const r = await callAutopilot('POST', { universe: ['A', 'B', 'C', 'D', 'E'] });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('universe_too_large');
    expect(r.body.max).toBe(3);
    expect(created.length).toBe(0);                       // the refusal precedes every write
    expect(String(r.body.message)).toContain('TRADING_UNIVERSE_MAX_PIN');
  });

  it('the ceiling defaults to the ENGINE\'s own universe size - no literal survives in the route', async () => {
    delete process.env.TRADING_UNIVERSE_MAX_PIN;
    const created: CreatedLeg[] = [];
    setTradingScheduleService(captureScheduler(created));
    const one = await callAutopilot('POST', { universe: [...DEFAULT_UNIVERSE] });
    expect(one.status).toBe(200);
    expect(created.length).toBe(7);
    created.length = 0;
    const over = await callAutopilot('POST', { universe: [...DEFAULT_UNIVERSE, 'ZZZZ'] });
    expect(over.status).toBe(400);
    expect(over.body.max).toBe(DEFAULT_UNIVERSE.length);
    expect(created.length).toBe(0);
    // the literal 150 that used to do this job is gone from the CODE (the CHANGE LOG still names it,
    // which is why the assertion is scoped to the handler rather than to the whole file)
    expect(AUTOPILOT.slice(AUTOPILOT.indexOf("router.post('/'"))).not.toContain('slice(0, 150)');
    expect(AUTOPILOT).toContain('process.env.TRADING_UNIVERSE_MAX_PIN');
  });

  it('GET says WHICH universe a live schedule is on, and how big the engine\'s own list is now', async () => {
    setTradingScheduleService(captureScheduler([], [autopilotRow({ userSub: AUTO_SUB, mode: 'paper' })]));
    const def = await callAutopilot('GET');
    expect(def.body.universeSource).toBe('default');
    expect(def.body.universeCount).toBe(DEFAULT_UNIVERSE.length);
    expect(def.body.defaultUniverseCount).toBe(DEFAULT_UNIVERSE.length);

    setTradingScheduleService(captureScheduler([], [autopilotRow({ userSub: AUTO_SUB, mode: 'paper', universe: ['NVDA'] })]));
    const pinnedStatus = await callAutopilot('GET');
    expect(pinnedStatus.body.universeSource).toBe('pinned');
    expect(pinnedStatus.body.universeCount).toBe(1);
    expect(pinnedStatus.body.defaultUniverseCount).toBe(DEFAULT_UNIVERSE.length);
  });
});
