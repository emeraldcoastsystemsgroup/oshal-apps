/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — ADR-134 D8 cash-account settlement, the store half (source pins; the behaviour itself is proven by the kernel's real-DB spec tests/unit/trading-settlement.spec.ts, which drives placeDecisionOrder for both refusals). Pins: sizeManualOrder runs the settlement pre-check AFTER the guardrails and only through the kernel helpers (settlementApplies / buildSettlementView / settlementViolation / gfvAdvisory — no store-side arithmetic), answers 422 settlement_blocked with settlesOn + settlement, and merges a settlement warning with the scheduler warning instead of overwriting it; GET /account answers `settlement`; GET /accounts books[] carries accountType + settlementPolicy; PATCH accepts settlementPolicy ONLY as 'refuse' | 'warn' | null (400 settlement_policy_invalid); the ticket sizes against SETTLED cash on a cash account and renders the unsettled figure + settlement day; the account header offers default/refuse/warn (never off) on cash accounts. Every user-facing label derives from the server payload — no typed 'T+1'.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fix guard: the manual-order route has no silent `.catch(() =>` — the recent-buys read behind the good-faith advisory logs its failure at error and every `.catch((err) => …)` in settlementCheck logs the err.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-134 D8 gap 2 (the ledger-only label), guarded by EXECUTING the ticket rather than pinning its source: ticket.js is run in a vm with a stub surface and the rendered context line / order summary are read back, so a `source: 'ledger'` view must carry the “your broker reports no settled figure” sentence and the “Settled cash (from oshal history)” row, while a `source: 'venue'` view renders the same bytes it always did. The kernel's SettlementView.source is read out of the framework checkout so the three values the surface branches on cannot drift from the kernel's own union.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import vm from 'vm';

const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');

describe('POST /decisions/manual — the settlement pre-check (src-routes/trading-manual-order-routes.ts)', () => {
  const route = src('src-routes/trading-manual-order-routes.ts');

  it('imports ONLY the kernel settlement helpers and the book-bound reader — no store-side settlement arithmetic', () => {
    expect(route).toContain("import { buildSettlementView, gfvAdvisory, settlementApplies, settlementViolation, unsettledLedgerSells, type SettlementView } from '@/app/trading-settlement';");
    expect(route).toContain('getBrokerReader(book.kind, sub, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined)');
    expect(route).not.toMatch(/placeDecisionOrder|getBrokerAdapter|placeOrder\(/); // still never places at the venue itself
  });

  it('runs AFTER the guardrail check inside sizeManualOrder, skips with no I/O where the kernel says the guard does not apply', () => {
    const size = route.slice(route.indexOf('async function sizeManualOrder('), route.indexOf('async function mintManualDecision('));
    expect(size.indexOf('const violation = guardrailViolation(g, symbol, qty, refPrice ?? 0);')).toBeGreaterThan(0);
    expect(size.indexOf('const settled = await settlementCheck(pool, sub, book, v, qty, refPrice);')).toBeGreaterThan(size.indexOf("error: 'guardrail_blocked'"));
    const check = route.slice(route.indexOf('async function settlementCheck('), route.indexOf('async function sizeManualOrder('));
    expect(check).toContain('if (!settlementApplies(book)) return { warning: null, settlement: null };');
    expect(check.indexOf('if (!settlementApplies(book))')).toBeLessThan(check.indexOf('getBrokerReader('));
  });

  it('a BUY funded by unsettled proceeds is 422 settlement_blocked with settlesOn + settlement under refuse, a `warning` under warn; a SELL only gets the good-faith advisory', () => {
    const check = route.slice(route.indexOf('async function settlementCheck('), route.indexOf('async function sizeManualOrder('));
    expect(check).toContain("return { ok: false, status: 422, error: 'settlement_blocked', message: violation.message, extra: { settlesOn: violation.settlesOn, settlement: view } };");
    expect(check).toContain('if (violation.warnOnly) return { warning: violation.message, settlement: view };');
    expect(check).toMatch(/if \(v\.side === 'sell'\) \{[\s\S]*?return \{ warning: gfvAdvisory\(view, v\.symbol, buys\), settlement: view \};/);
    // The recent-buys read behind the advisory is book-scoped and keyed on the trade time, not updated_at.
    const buys = route.slice(route.indexOf('async function recentLedgerBuys('), route.indexOf('async function settlementCheck('));
    expect(buys).toContain("WHERE user_sub=$1 AND book_id=$2 AND side='buy' AND status IN ('filled','partially_filled') AND filled_qty > 0");
    expect(buys).toContain('COALESCE(submitted_at, created_at) >= $3');
  });

  it('Sized carries warning?/settlement?; the response emits `settlement` and MERGES warnings with the scheduler warning', () => {
    expect(route).toContain('interface Sized { ok: true; qty: number; refPrice: number | null; latest: number | null; notional: number | null; g: Guardrails; warning?: string; settlement?: SettlementView | null }');
    expect(route).toContain('const warnings = [sized.warning, protectedEntry?.scheduleWarning].filter((w): w is string => !!w);');
    expect(route).toContain("...(warnings.length ? { warning: warnings.join(' · ') } : {}),");
    expect(route).toContain('settlement: sized.settlement ?? null,');
    expect(route).not.toContain("...(protectedEntry?.scheduleWarning ? { warning: protectedEntry.scheduleWarning } : {})");
  });

  it('never types a settlement cycle into copy — the label comes from the kernel (TRADING_SETTLEMENT_DAYS)', () => {
    expect(route).not.toMatch(/T\+1/);
  });

  it('no silent catch in the pre-check: the recent-buys read behind the good-faith advisory logs its failure (and still never blocks the sell)', () => {
    const check = route.slice(route.indexOf('async function settlementCheck('), route.indexOf('async function sizeManualOrder('));
    expect(check).toContain("recentLedgerBuys(pool, sub, book, sells[0].tradedAt).catch((err: unknown) => { logger.error({ err, book: book.ref, symbol: v.symbol }, 'settlement pre-check: recent-buys read failed — good-faith advisory unavailable'); return []; })");
    expect(route).not.toMatch(/\.catch\(\(\)\s*=>/);
    for (const m of check.matchAll(/\.catch\(\((\w+)(?::\s*unknown)?\)\s*=>\s*\{([^}]*)\}/g)) expect(m[2], `.catch((${m[1]}) => …) must log the err`).toMatch(/logger\.error\(\{ err/);
  });
});

describe('GET /account — the settlement view rides the account read (src-routes/trading-routes-book-read-builders.ts)', () => {
  const route = src('src-routes/trading-routes-book-read-builders.ts');
  it('answers { account, settlement } and consults the ledger only where the guard applies', () => {
    expect(route).toContain("import { buildSettlementView, settlementApplies, unsettledLedgerSells } from '@/app/trading-settlement';");
    expect(route).toContain('res.json({ mode, book: book.ref, account, settlement: buildSettlementView(account, book, sells) });');
    expect(route).toMatch(/const sells = settlementApplies\(book\)\s*\? await unsettledLedgerSells\(ctx\.pool, sub, book\)/);
  });
});

describe('GET/PATCH /accounts — the per-book policy (src-routes/trading-accounts-routes.ts)', () => {
  const route = src('src-routes/trading-accounts-routes.ts');
  it('books[] carries accountType + settlementPolicy from the core list (one source)', () => {
    expect(route).toContain('accountType: b.accountType ?? null, settlementPolicy: b.settlementPolicy ?? null,');
  });
  it("PATCH accepts settlementPolicy only as 'refuse' | 'warn' | null — anything else (including 'off') is 400 settlement_policy_invalid", () => {
    expect(route).toContain("if (b.settlementPolicy !== undefined && b.settlementPolicy !== null && b.settlementPolicy !== 'refuse' && b.settlementPolicy !== 'warn') {");
    expect(route).toContain("res.status(400).json({ error: 'settlement_policy_invalid'");
    expect(route).toContain("settlementPolicy: b.settlementPolicy === undefined ? undefined : (b.settlementPolicy as 'refuse' | 'warn' | null),");
    // The validation precedes the updateBook call, so an invalid value never reaches the store.
    expect(route.indexOf("error: 'settlement_policy_invalid'")).toBeLessThan(route.indexOf('const book = await updateBook(ctx.pool, s, String(req.params.bookId), {'));
  });
});

describe('the ticket (tools/ui/ticket.js)', () => {
  const tkt = src('tools/ui/ticket.js');
  it('reads funds + settlement from GET /account (one call) and sizes against SETTLED cash on an armed cash account', () => {
    expect(tkt).toContain("try { j = await api('/account'); } catch (e) { j = null; }");
    expect(tkt).toContain('settlement: j.settlement || null');
    expect(tkt).toContain("if (!s || s.accountType === 'margin' || s.policy === 'off' || tktNum(s.settledCash) == null) return null;");
    expect(tkt).toContain('const s = tktSettlement(); if (s) return Math.max(0, tktNum(s.settledCash));');
  });
  it('renders settled vs unsettled with the settlement day, labels the summary row, and shows a mint warning in step 3', () => {
    expect(tkt).toContain("if (tktSettlement()) return 'Settled to spend: <b>' + (a != null ? money(a) : '&mdash;') + '</b>' + (un ? ' &middot; ' + esc(un) : '') +");
    expect(tkt).toContain("return money(s.unsettledCash) + ' unsettled' + (s.settlesOn && s.settlesOn.words ? ', settles ' + s.settlesOn.words : '');");
    expect(tkt).toContain("row(tktSettlement() ? (tktLedgerOnly() ? 'Settled cash (from oshal history)' : 'Settled cash') : 'Available to spend'");
    expect(tkt).toContain("const warn = d.warning ? '<div class=\"warn\" style=\"font-size:13px;margin-bottom:10px\">' + esc(d.warning) + '</div>' : '';");
    // The 422 message is shown verbatim: api() throws Error(j.message) and tktReview writes err into formErr.
    expect(tkt).toContain("if (err || !j || !j.decisionId) { t.formErr = err || 'The server did not return a decision.'; tktRenderStep(); return; }");
    expect(tkt).not.toMatch(/T\+1/);
  });
});

describe('the account header (tools/ui/view-account.js)', () => {
  const va = src('tools/ui/view-account.js');
  it('the CASH/MARGIN pill prefers the book row; cash accounts get a default/refuse/warn select that PATCHes settlementPolicy (never off)', () => {
    expect(va).toContain('const type = (b && b.accountType) || (acct && acct.accountType) || (b && b.type);');
    expect(va).toContain("if (!b || !b.bookId || String(b.accountType || '').toLowerCase() !== 'cash') return '';");
    expect(va).toContain("opt('', 'server default') + opt('refuse', 'refuse') + opt('warn', 'warn only')");
    expect(va).not.toMatch(/opt\('off'/);
    expect(va).toContain("api('/accounts/books/' + encodeURIComponent(b.bookId), jbody('PATCH', { settlementPolicy: policy }))");
    expect(va).toContain("const ss = $('acctSettle'); if (ss) ss.onchange = () => setSettlementPolicy(ss.value || null);");
  });
});

/**
 * The framework checkout the package's `@/` alias resolves to — the SAME rule vitest.config.mjs uses.
 * The kernel's own SettlementView is read from it so the surface's three `source` branches are
 * checked against the kernel's union rather than against a value retyped here; with no framework
 * checkout the read throws and the guard goes RED (a skipped guard is not a guard).
 */
const FRAMEWORK = process.env.OSHAL_FRAMEWORK || path.resolve(__dirname, '..', '..', '..', 'oshal');
const KERNEL_SETTLEMENT = readFileSync(path.resolve(FRAMEWORK, 'src/app/trading-settlement.ts'), 'utf8');

const TKT_SRC = src('tools/ui/ticket.js');

/** The settlement view GET /account answers, as the ticket receives it. */
interface SettlementFixture {
  accountType: string; policy: string; cash: number; settledCash: number;
  unsettledCash: number; settlesOn: { iso: string; words: string } | null;
  source: string; settlementDays: number;
}

/** A cash book with $8,000 of unsettled proceeds, split by `source` (the only field that varies). */
function view(source: string): SettlementFixture {
  return {
    accountType: 'cash', policy: 'refuse', cash: 10000, settledCash: 2000, unsettledCash: 8000,
    settlesOn: { iso: '2026-09-08', words: 'Tue Sep 8' }, source, settlementDays: 1,
  };
}

/**
 * @description Run ticket.js in a vm with a stubbed surface and render BOTH places the settled figure
 * is shown — the step-2 context line and the order summary — for one settlement view.
 * @param settlement - The `settlement` object GET /account answered (null for no view at all).
 * @returns The rendered context line and the summary's innerHTML.
 */
function render(settlement: SettlementFixture | null): { ctx: string; summary: string } {
  const host = { innerHTML: '' };
  const out = { ctx: '' };
  const sandbox: Record<string, unknown> = {
    console, window: {}, document: { querySelectorAll: () => [] },
    esc: (v: unknown) => String(v == null ? '' : v),
    money: (n: unknown) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    $: (id: string) => (id === 'tktSummary' ? host : null),
    STATUS: { guardrails: {}, bookEnabled: true, liveEnabled: true },
    STATE: { positions: [] }, UNIVERSE: {}, MODE: 'live', BOOK: 'live', DISP: 'Live (legacy account)',
    closeTicket: () => undefined, navigate: () => undefined, focus: () => undefined,
    api: async () => ({}), jbody: () => ({}), spinner: () => '', st: () => '',
    __out: out, __settlement: settlement,
  };
  vm.createContext(sandbox);
  // One script: `let TKT` is a top-level lexical binding, so the driver has to share the ticket's
  // own script scope to assign it — exactly what the page does when it opens the ticket.
  vm.runInContext(`${TKT_SRC}
    TKT = tktFresh('MSFT');
    TKT.funds = { cash: 10000, buyingPower: 10000, equity: 50000, settlement: __settlement };
    __out.ctx = tktCtxInner(2);
    tktRenderSummary();
  `, sandbox, { filename: 'ticket.js' });
  return { ctx: out.ctx, summary: host.innerHTML };
}

describe('ADR-134 D8 gap 2 — a ledger-derived settled figure says so on the ticket', () => {
  it("the kernel still answers exactly the three sources the surface branches on", () => {
    expect(KERNEL_SETTLEMENT).toContain("source: 'venue' | 'ledger' | 'n/a';");
  });

  it('a ledger-derived split names its source in the context line and in the summary row', () => {
    const { ctx, summary } = render(view('ledger'));
    expect(ctx, 'the settled figure is still the headline').toContain('Settled to spend: <b>$2,000.00</b>');
    expect(ctx, 'and the unsettled figure with its date').toContain('$8,000.00 unsettled, settles Tue Sep 8');
    expect(ctx, 'the derivation is stated, not implied').toContain('oshal order history');
    expect(ctx, 'and why there is no venue figure to use instead').toContain('your broker reports no settled figure');
    expect(ctx, 'and what that costs the number').toContain('a sale made outside oshal is not counted here');
    expect(summary, 'the summary row carries the same qualification').toContain('Settled cash (from oshal history)');
  });

  it("a venue-reported split renders exactly what it always did — no note, no relabelled row", () => {
    const { ctx, summary } = render(view('venue'));
    expect(ctx).toBe('Settled to spend: <b>$2,000.00</b> &middot; $8,000.00 unsettled, settles Tue Sep 8');
    expect(ctx).not.toContain('oshal order history');
    expect(summary).toContain('Settled cash');
    expect(summary).not.toContain('from oshal history');
  });

  it('a margin book (no settlement view at all) is untouched — no settled wording anywhere', () => {
    const { ctx, summary } = render(null);
    expect(ctx).toBe('Available to spend: <b>$10,000.00</b>');
    expect(summary).toContain('Available to spend');
    expect(summary).not.toContain('Settled');
    expect(summary).not.toContain('oshal order history');
  });

  it('names no broker — the branch is the kernel view\u2019s `source`, so any venue without a settled figure lands here', () => {
    const tkt = src('tools/ui/ticket.js');
    const helpers = tkt.slice(tkt.indexOf('function tktLedgerOnly('), tkt.indexOf('/* % mode: the dollar amount'));
    expect(helpers).toContain("return !!s && s.source === 'ledger';");
    expect(helpers).not.toMatch(/alpaca|schwab/i);
  });

  it('ticket.js still parses as a classic script', () => {
    expect(() => new Function(TKT_SRC)).not.toThrow();
  });
});
