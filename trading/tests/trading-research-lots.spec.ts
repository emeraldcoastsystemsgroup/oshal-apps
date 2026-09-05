/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — ADR-138 guards for single-stock research, the watchlist and pinned lots: every new handler 401-gates via callerSub, the book is resolved QUERY-FIRST (the 2026-09-03 paper-routing class), the watchlist table carries the owner RLS statements, the research route never throws on a failed section (each section wrapped, reported 'unavailable', an estimate labelled 'cadence-estimate'), the 8-K decoder maps 2.02 → results and drops 9.01 beside other items, the manual route only pins a BUY with exit rules (scheduler checked BEFORE any insert, schedule created exactly like the arm route) and persists extended_hours, release is 428-gated, and the family registers right after the event-plan routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 D4: the protected-entry pin now passes notBefore (the fire time of a TIMED order) to createPinnedLotIntent — assertion updated to the new call shape.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import {
  EDGAR_UA, cikFromTickerTable, decode8kItems, earningsResultDates, edgarDocumentUrl, edgarSubmissionsUrl,
  estimateNextEarnings, eventKindForItem, filingEvents, summarizeSubmissions,
} from '../src-routes/trading-edgar-filings';
import { computeMovers, isMoverKind, MOVER_KINDS, type MoverKind } from '../src-routes/trading-movers';
import type { OhlcvBar } from '@/features/trading';

const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');

const QUERY_FIRST = 'resolveBook(ctx.pool, s, (req.query.book as string | undefined) ?? b.book ?? (req.query.mode as string | undefined) ?? b.mode)';

describe('research / watchlist / lots routes — auth + book scoping (ADR-138)', () => {
  const route = src('src-routes/trading-research-routes.ts');
  const handlers = route.split(/\n  router\.(?=get|post|patch|delete)/).slice(1);

  it('registers exactly the eight handlers', () => {
    const heads = handlers.map((h) => h.split('\n')[0]);
    expect(heads.filter((h) => h.startsWith("get('/research/:symbol'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("get('/symbols/search'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("get('/reports/movers'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("get('/watchlist'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("post('/watchlist'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("delete('/watchlist/:symbol'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("get('/lots'"))).toHaveLength(1);
    expect(heads.filter((h) => h.startsWith("post('/lots/:id/release'"))).toHaveLength(1);
    expect(handlers).toHaveLength(8);
  });

  it('every handler 401-gates via callerSub before any work', () => {
    expect(route).toMatch(/const s = callerSub\(req\);\s*\n\s*if \(!s\) res\.status\(401\)/);
    for (const h of handlers) expect(h.split('\n')[1]).toContain('const s = sub(req, res); if (!s) return;');
    expect(route).not.toMatch(/req\.oidc|userSub\s*=\s*req\./);
  });

  it('resolves the book QUERY-first, then body, then the legacy mode aliases — and nowhere else', () => {
    expect(route).toContain(QUERY_FIRST);
    expect(route.match(/resolveBook\(/g)).toHaveLength(1);
    expect(route).not.toMatch(/resolveBook\(ctx\.pool, s, b\.book/);
    expect(route).not.toMatch(/resolveBook\(ctx\.pool, s, b\.mode/);
  });

  it('research, the watchlist quotes and the lots read the SELECTED book; watchlist writes are per USER', () => {
    const byHead = (h: string) => handlers.find((x) => x.startsWith(h))!;
    expect(byHead("get('/research/:symbol'")).toContain('resolveRequestBook(ctx, s, req)');
    expect(byHead("get('/watchlist'")).toContain('resolveRequestBook(ctx, s, req)');
    expect(byHead("get('/lots'")).toContain('listPinnedLots(ctx.pool, s, { bookId: book.bookId })');
    expect(byHead("get('/lots'")).toContain('pinnedQtyBySymbol(ctx.pool, s, book.bookId)');
    expect(byHead("post('/watchlist'")).not.toContain('resolveRequestBook');
    expect(byHead("delete('/watchlist/:symbol'")).not.toContain('resolveRequestBook');
    expect(byHead("post('/watchlist'")).toMatch(/INSERT INTO oshal_trading_watchlist \(user_sub, symbol, note\)/);
    expect(byHead("delete('/watchlist/:symbol'")).toContain('DELETE FROM oshal_trading_watchlist WHERE user_sub=$1 AND symbol=$2');
    expect(byHead("get('/watchlist'")).toContain('FROM oshal_trading_watchlist WHERE user_sub=$1');
  });

  it('the watchlist table is created through the schema bootstrap WITH the owner RLS statements', () => {
    expect(route).toContain("buildOwnerRlsPolicyStatements('oshal_trading_watchlist', 'user_sub')");
    expect(route).toMatch(/runRuntimeSchemaBootstrap\(\{\s*\n\s*pool, moduleName: 'trading watchlist'/);
    expect(route).toContain('PRIMARY KEY (user_sub, symbol)');
    expect(route).toContain("from '@/shared/services/database'");
  });

  it('every research section is wrapped: a failure is logged, reported unavailable, and never thrown', () => {
    const wrapped = route.match(/section\('(quote|fundamentals|news|filings|earnings)', symbol,/g) ?? [];
    expect(new Set(wrapped)).toHaveProperty('size', 5);
    expect(route).toMatch(/catch \(err\) \{\s*\n\s*logger\.error\(\{ err, symbol, section: name \}[^\n]*\n\s*sections\[name\] = 'unavailable';\s*\n\s*return fallback;/);
    expect(route).toContain("type SectionState = 'ok' | 'unavailable'");
    expect(route).toContain("if (!quote) sections.quote = 'unavailable';");
    expect(route).toContain("if (!fundamentals) sections.fundamentals = 'unavailable';");
  });

  it('never fabricates: the calendar is labelled world-calendar, the estimate cadence-estimate, and no price is defaulted', () => {
    expect(route).toContain("source: 'world-calendar'");
    expect(route).toContain("source: estimate ? 'cadence-estimate' : null");
    expect(route.indexOf('calendarEarnings(symbol)')).toBeLessThan(route.indexOf('estimateNextEarnings(resultsDates, new Date())'));
    expect(route).toMatch(/e\.eventType === 'earnings'/);
    expect(route).toContain('`world:ticker:${symbol}`');
    expect(route).not.toMatch(/price\s*(\?\?|\|\|)\s*\d/);
    expect(route).toContain('dayChangePct: null');
  });

  it('EDGAR is keyless with the contact User-Agent and a 24h in-module ticker cache', () => {
    expect(route).toContain("headers: { 'User-Agent': EDGAR_UA, Accept: 'application/json' }");
    expect(route).toContain('Date.now() - tickerTable.at > EDGAR_TICKER_CACHE_MS');
    expect(EDGAR_UA).toBe('oshal-trading/1.0 (maintainer@emeraldcoastsystemsgroup.com)');
  });

  it('release is 428 confirm-gated (strict boolean) BEFORE releasePinnedLot runs', () => {
    const release = handlers.find((h) => h.startsWith("post('/lots/:id/release'"))!;
    expect(release).toContain('if (b.confirm !== true) {');
    expect(release).toMatch(/res\.status\(428\)\.json\(\{ error: 'confirm_required'/);
    expect(release.indexOf('confirm !== true')).toBeLessThan(release.indexOf('releasePinnedLot('));
    expect(release).toContain('releasePinnedLot(ctx, s, String(req.params.id))');
    expect(release).toContain('res.json({ lot })');
  });

  it('every handler maps a TradingError to its own status/code and logs + 502s anything else', () => {
    expect(route).toContain('if (err instanceof TradingError) { res.status(err.httpStatus).json({ error: err.code, message: err.message }); return; }');
    expect(route).toMatch(/logger\.error\(\{ err, what \}, 'research route failed'\);\s*\n\s*res\.status\(502\)/);
    for (const h of handlers) expect(h).toMatch(/catch \(err\) \{ fail\(res, err, '/);
    expect(route).not.toMatch(/catch\s*\{\s*\}/);
    expect(route).not.toMatch(/catch \([a-z]+\) \{\s*return/);
    expect(route).not.toMatch(/console\.log/);
  });
});

describe('symbols/search + reports/movers routes — auth + honest bounds (ADR-138)', () => {
  const route = src('src-routes/trading-research-routes.ts');
  const handlers = route.split(/\n  router\.(?=get|post|patch|delete)/).slice(1);
  const byHead = (h: string) => handlers.find((x) => x.startsWith(h))!;

  it('both new handlers 401-gate via callerSub before any work', () => {
    expect(byHead("get('/symbols/search'").split('\n')[1]).toContain('const s = sub(req, res); if (!s) return;');
    expect(byHead("get('/reports/movers'").split('\n')[1]).toContain('const s = sub(req, res); if (!s) return;');
  });

  it('symbols/search 400s on an empty query, caps the limit at 25, and only calls searchSymbols (no book)', () => {
    const h = byHead("get('/symbols/search'");
    expect(h).toContain("res.status(400).json({ error: 'query_required'");
    expect(h).toContain('Math.min(SYMBOL_SEARCH_MAX, Math.max(1, Number(req.query.limit) || SYMBOL_SEARCH_MAX))');
    expect(h).toContain('await searchSymbols(q, limit)');
    expect(h).not.toContain('resolveRequestBook');
    expect(h).not.toContain('resolveBook');
    expect(h).toMatch(/catch \(err\) \{ fail\(res, err, 'symbols-search'\);/);
  });

  it('reports/movers validates kind (400 kind_invalid) and caps the limit default 15 / max 50', () => {
    const h = byHead("get('/reports/movers'");
    expect(h).toContain("String(req.query.kind || 'winners').trim().toLowerCase()");
    expect(h).toContain('if (!isMoverKind(kind))');
    expect(h).toContain("res.status(400).json({ error: 'kind_invalid'");
    expect(h).toContain('Math.min(MOVERS_MAX_LIMIT, Math.max(1, Number(req.query.limit) || MOVERS_DEFAULT_LIMIT))');
    expect(h).toMatch(/catch \(err\) \{ fail\(res, err, 'movers'\);/);
  });

  it('the movers universe is DEFAULT_UNIVERSE ∪ the caller watchlist — one bars batch, PURE ranking, never fabricated', () => {
    expect(route).toContain('const set = new Set<string>(DEFAULT_UNIVERSE.map((x) => x.toUpperCase()));');
    expect(route).toContain("'SELECT symbol FROM oshal_trading_watchlist WHERE user_sub=$1'");
    expect(route).toContain("barsBatchOhlcv(universe, '1Day', MOVERS_BARS)");
    expect(route).toContain('computeMovers(bars, kind, limit)');
    expect(route).toContain("if (!bars.size) return { ...base, rows: [], note: MOVERS_UNAVAILABLE_NOTE };");
    expect(route.match(/barsBatchOhlcv\(/g)).toHaveLength(1);
  });

  it('movers names are best-effort: a lookup failure is logged, the row keeps a null name, never invented', () => {
    expect(route).toMatch(/const hit = \(await searchSymbols\(symbol, 1\)\)\.find\(\(h\) => h\.symbol === symbol\);/);
    expect(route).toContain('return hit ? hit.name : null;');
    expect(route).toMatch(/logger\.error\(\{ err, symbol \}, 'movers name lookup failed/);
  });

  it('the movers source label states exactly what is in scope (no holdings) and carries the free-IEX lag note', () => {
    expect(route).toContain("const MOVERS_SOURCE = 'oshal universe + your watchlist';");
    expect(route).toMatch(/const MOVERS_NOTE = 'End-of-last-session daily closes on the free IEX feed/);
  });
});

describe('computeMovers — the PURE movers ranking (no Alpaca)', () => {
  const bar = (c: number, v: number): OhlcvBar => ({ o: c, h: c, l: c, c, v });
  // Six ascending bars whose last two closes give the change; enough history for a volatility.
  const wiggly = [bar(100, 10), bar(90, 10), bar(110, 10), bar(85, 10), bar(115, 10), bar(120, 10)];
  const calm = [bar(100, 10), bar(100, 10), bar(100, 10), bar(100, 10), bar(100, 10), bar(101, 10)];
  const bars = new Map<string, OhlcvBar[]>([
    ['UP', [bar(100, 5), bar(120, 5)]],        // +20% change, only 2 bars → no volatility
    ['DOWN', [bar(100, 50), bar(80, 50)]],     // -20% change, 2 bars → no volatility, huge volume
    ['FLAT', [bar(100, 999), bar(100, 999)]],  // 0% change, biggest volume
    ['WIGGLY', wiggly],                        // most volatile (6 bars)
    ['CALM', calm],                            // least volatile (6 bars)
    ['NOBARS', []],                            // never a row
    ['ONE', [bar(100, 1000)]],                 // single bar → never a row
  ]);

  it('winners rank by changePct desc; a no-bars and a single-bar symbol are omitted entirely', () => {
    const rows = computeMovers(bars, 'winners', 10);
    expect(rows.map((r) => r.symbol)).not.toContain('NOBARS');
    expect(rows.map((r) => r.symbol)).not.toContain('ONE');
    expect(rows[0].symbol).toBe('UP');
    expect(rows[0].changePct).toBeCloseTo(20);
    expect(rows[0].price).toBe(120);
    expect(rows[0].dayVolume).toBe(5);
    expect(rows[rows.length - 1].symbol).toBe('DOWN');
  });

  it('losers rank by changePct asc, active by dayVolume desc', () => {
    expect(computeMovers(bars, 'losers', 1)[0].symbol).toBe('DOWN');
    expect(computeMovers(bars, 'active', 1)[0].symbol).toBe('FLAT');
  });

  it('volatile ranks by volatilityPct desc and EXCLUDES symbols with too little history (< 6 bars)', () => {
    const rows = computeMovers(bars, 'volatile', 10);
    expect(rows.map((r) => r.symbol)).toEqual(['WIGGLY', 'CALM']);
    expect(rows.map((r) => r.symbol)).not.toContain('UP');
    expect(rows.map((r) => r.symbol)).not.toContain('DOWN');
    expect(rows[0].volatilityPct).not.toBeNull();
  });

  it('the limit caps the returned rows; changePct comes from the last two closes only', () => {
    expect(computeMovers(bars, 'winners', 2)).toHaveLength(2);
    const wig = computeMovers(new Map([['WIGGLY', wiggly]]), 'winners', 1)[0];
    expect(wig.changePct).toBeCloseTo(((120 - 115) / 115) * 100);
  });

  it('isMoverKind guards the query and MOVER_KINDS lists exactly the four boards', () => {
    expect(MOVER_KINDS).toEqual(['winners', 'losers', 'volatile', 'active']);
    for (const k of MOVER_KINDS) expect(isMoverKind(k)).toBe(true);
    expect(isMoverKind('gainers')).toBe(false);
    expect(isMoverKind('')).toBe(false);
    expect(isMoverKind(undefined)).toBe(false);
  });
});

describe('the 8-K decoder + EDGAR parsing', () => {
  const cik = '0000320193';
  const submissions = {
    filings: {
      recent: {
        form: ['8-K', '10-Q', '8-K/A', '8-K', '10-K', '8-K', '10-Q'],
        filingDate: ['2026-08-01', '2026-07-31', '2026-06-15', '2026-05-02', '2025-11-01', '2026-02-01', '2026-05-01'],
        accessionNumber: ['0000320193-26-000081', '0000320193-26-000080', '0000320193-26-000061', '0000320193-26-000050', '0000320193-25-000110', '0000320193-26-000020', '0000320193-26-000049'],
        primaryDocument: ['a.htm', 'q.htm', 'b.htm', 'c.htm', 'k.htm', 'd.htm', 'q2.htm'],
        items: ['2.02,9.01', '', '5.02,8.01', '2.02,9.01', '', '2.02', ''],
      },
    },
  };

  it('maps 2.02 → results of operations (earnings) and drops 9.01 beside other items', () => {
    expect(decode8kItems('2.02,9.01')).toEqual({ items: ['2.02', '9.01'], itemsPlain: ['Results of operations (earnings)'] });
    expect(eventKindForItem('2.02')).toBe('earnings');
    expect(eventKindForItem('5.02')).toBe('leadership');
    expect(eventKindForItem('0.00')).toBe('other');
  });

  it('keeps 9.01 when it stands alone and tolerates an empty items field', () => {
    expect(decode8kItems('9.01')).toEqual({ items: ['9.01'], itemsPlain: ['Exhibits'] });
    expect(decode8kItems('')).toEqual({ items: [], itemsPlain: [] });
    expect(decode8kItems(undefined)).toEqual({ items: [], itemsPlain: [] });
  });

  it('resolves a ticker to its 10-digit zero-padded CIK and builds the SEC urls', () => {
    const table = { '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, '1': { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corp' } };
    expect(cikFromTickerTable(table, 'aapl')).toBe('0000320193');
    expect(cikFromTickerTable(table, 'ZZZZ')).toBeNull();
    expect(cikFromTickerTable(null, 'AAPL')).toBeNull();
    expect(edgarSubmissionsUrl('0000320193')).toBe('https://data.sec.gov/submissions/CIK0000320193.json');
    expect(edgarDocumentUrl('0000320193', '0000320193-26-000081', 'a.htm')).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000081/a.htm');
    expect(edgarDocumentUrl('0000320193', '', 'a.htm')).toBe('');
  });

  it('summarizes submissions: latest 10-K / 10-Q, the decoded 8-Ks in order, capped', () => {
    const s = summarizeSubmissions(submissions, cik, 12);
    expect(s.latest10K).toEqual({ form: '10-K', date: '2025-11-01', url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000110/k.htm' });
    expect(s.latest10Q?.date).toBe('2026-07-31');
    expect(s.recent8K.map((f) => f.date)).toEqual(['2026-08-01', '2026-06-15', '2026-05-02', '2026-02-01']);
    expect(s.recent8K[1]).toMatchObject({ form: '8-K/A', items: ['5.02', '8.01'], itemsPlain: ['Officer/director change', 'Other events'] });
    expect(summarizeSubmissions(submissions, cik, 2).recent8K).toHaveLength(2);
    expect(summarizeSubmissions({}, cik)).toEqual({ latest10K: null, latest10Q: null, recent8K: [] });
  });

  it('past results are the item-2.02 dates, newest first, capped', () => {
    expect(earningsResultDates(submissions, 8)).toEqual(['2026-08-01', '2026-05-02', '2026-02-01']);
    expect(earningsResultDates(submissions, 1)).toEqual(['2026-08-01']);
    expect(earningsResultDates({}, 8)).toEqual([]);
  });

  it('decodes 8-Ks into one event per substantive item, kind from the item code', () => {
    const events = filingEvents(summarizeSubmissions(submissions, cik).recent8K);
    expect(events[0]).toEqual({ date: '2026-08-01', kind: 'earnings', label: 'Results of operations (earnings)', url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000081/a.htm' });
    expect(events.filter((e) => e.date === '2026-06-15').map((e) => e.kind)).toEqual(['leadership', 'other']);
    expect(events.some((e) => e.kind === 'exhibits')).toBe(false);
  });

  it('estimates the next earnings by cadence, rolled forward to today or later — null with no history', () => {
    expect(estimateNextEarnings(['2026-08-01'], new Date('2026-09-04T12:00:00Z'))).toBe('2026-10-31');
    expect(estimateNextEarnings(['2026-02-01', '2026-05-02'], new Date('2026-09-04T12:00:00Z'))).toBe('2026-10-31');
    expect(estimateNextEarnings(['2026-09-10'], new Date('2026-09-04T12:00:00Z'))).toBe('2026-09-10');
    expect(estimateNextEarnings([], new Date())).toBeNull();
    expect(estimateNextEarnings(['garbage'], new Date())).toBeNull();
  });
});

describe('manual route — protect + extendedHours (ADR-138 D3)', () => {
  const route = src('src-routes/trading-manual-order-routes.ts');
  const handler = route.slice(route.indexOf("router.post('/decisions/manual'"));

  it('validates the protect rules through the kernel normalizer and refuses an invalid set with a 400', () => {
    expect(route).toContain('rules = normalizePinnedLotRules(b.protect);');
    expect(route).toMatch(/status: err instanceof TradingError \? err\.httpStatus : 400, error: err instanceof TradingError \? err\.code : 'rules_invalid'/);
    expect(route).toContain("from '@/app/trading-pinned-lots'");
  });

  it('only pins a BUY with exit rules — sells and unprotected buys never create a lot', () => {
    expect(handler).toContain("const pins = side === 'buy' && hasExitRules(rules);");
    expect(handler).toContain('const protectedEntry = pins ? await protectEntry(ctx, sub, book, minted.decisionId, parsed.v, sized.qty) : null;');
    expect(route.match(/createPinnedLotIntent\(/g)).toHaveLength(1);
    expect(route).toContain('createPinnedLotIntent(ctx.pool, sub, { book, decisionId, symbol: v.symbol, qty, rules: v.rules, notBefore: v.fireAt ?? undefined })');
  });

  it('arming the executor leg is best-effort — a scheduler failure NEVER fails an order that already executed', () => {
    // The order + the pinned-lot intent are persisted first; ensureEventSchedule runs inside a try/catch
    // that only sets a `warning`. A momentary scheduler outage must not lose a real trade (the lot waits).
    expect(route).toMatch(/try \{ await ensureEventSchedule\(sub\); \}\s*catch \(err\) \{ scheduleWarning =/);
    expect(handler).not.toMatch(/if \(pins && !getTradingScheduleService\(\)\) \{ res\.status\(503\)/);
    expect(handler).toContain('protectedEntry?.scheduleWarning');
  });

  it('ensures the per-user trading-events schedule exactly as the arm route does', () => {
    expect(route).toContain("taskType: eventPlanTaskType(sub), schedule: EVENT_PLANS_CRON, timezone: EVENT_PLANS_TIMEZONE, ownerSub: sub, queue: 'intelligent-trades'");
    expect(route).toContain("taskData: { prompt: 'Event playbooks — IPO watch/entry/exit state machine', userSub: sub }");
    expect(route).toMatch(/r\.taskType === taskType && r\.ownerSub === sub && r\.status === 'active'/);
    expect(route).toContain("from '@/app/trading-event-plans'");
  });

  it('persists extended_hours on the decision row and echoes it in the response', () => {
    expect(route).toMatch(/INSERT INTO oshal_trading_decisions \(user_sub, mode, book_id,[^\n]*guardrails, extended_hours\) VALUES \([^\n]*\$16,\$17\)/);
    expect(route).toContain('extendedHours: b.extendedHours === true');
    expect(handler).toMatch(/timeInForce: tif, extendedHours, rationale/);
  });

  it('the response carries the lot and the normalized protection rules', () => {
    expect(handler).toContain('lot: protectedEntry ? protectedEntry.lot : null, protection: pins ? rules : null,');
  });

  it('documents the ring-fence: pinned shares are off-limits to the autopilot (ADR-138 D3)', () => {
    expect(route).toContain('ADR-138 D3');
    expect(route).toMatch(/RING-FENCED from the autopilot/);
  });

  it('keeps the direct-trade invariants: query-first book, operator-only, one order path', () => {
    expect(route).toMatch(/resolveBook\(ctx\.pool, sub, \(req\.query\.book as string \| undefined\) \?\? b\.book/);
    expect(route).not.toMatch(/placeDecisionOrder|getBrokerAdapter|placeOrder\(/);
    expect(route).not.toMatch(/\.catch\(\(\) => null\)/);
  });
});

describe('registration', () => {
  const entry = src('src-routes/trading-routes.ts');

  it('trading-routes registers the research family right after the event-plan routes, before the book reads', () => {
    expect(entry).toContain("import { registerTradingResearchRoutes } from './trading-research-routes';");
    const events = entry.indexOf('registerTradingEventPlanRoutes(router, ctx);');
    const research = entry.indexOf('registerTradingResearchRoutes(router, ctx);');
    const reads = entry.indexOf('registerTradingBookReadRoutes(router, ctx, apiDir);');
    expect(events).toBeGreaterThan(0);
    expect(research).toBeGreaterThan(events);
    expect(reads).toBeGreaterThan(research);
  });
});
