/**
 * ADR-052 addendum P4 — each open position's exit plan is readable, and amendable only on purpose.
 *
 * THE BOUNDARY THIS GUARD CROSSES. The kernel plan ledger could only be reached by CALLING the
 * module, so nobody could see a position's plan or amend one. The two seams this change adds are the
 * two this spec drives for real:
 *   (1) THE ROUTE. A REAL express Router is composed by this package's own
 *       registerTradingPositionPlanRoutes, and every request is matched and run by express against the
 *       REAL kernel ledger functions (listPositionPlans, amendPlans), the REAL book resolver and the
 *       REAL plan resolver (exitPlanSessions). The assertions are on the payload a caller receives and
 *       on the SQL the kernel actually emitted.
 *   (2) THE SURFACE. The shipped classic script tools/ui/position-plans.js is EXECUTED in a vm context
 *       with the page globals it depends on, and shared-positions.js is read for the two hooks that
 *       put its pill beside the governance badge.
 *
 * THE ONE SCOPED DOUBLE, named rather than hidden: the Postgres pool is a recording fake holding the
 * plan rows in memory. The real companion is core's tests/unit/trading-position-plans-postgres.spec.ts,
 * which drives the same listPositionPlans and amendPlans against a DisposablePostgres with the owner-RLS
 * table and the trigger that freezes a plan's terms. A real server is structurally unavailable here:
 * scripts/run-trading-specs.mjs pins this package's specs to a DSN that cannot connect to anything.
 *
 * Run from the package root with the framework checkout on the alias path:
 *   OSHAL_FRAMEWORK=<oshal checkout> npx vitest run --config vitest.config.mjs tests/trading-position-plans-surface.spec.ts
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — GET /position-plans lists the resolved book's OPEN plans (scoped by book_id in the kernel's own query), 'all' drops the status filter, a bad status or book is 400, and `armed` says whether plans are on for the book and why (env, strategy knob, off). POST /position-plans/amend is 428 without confirm:true before any statement, 400 on an unknown posture, bad sessions, bad symbols or an empty change, and confirmed it retires each open plan and writes the successor priced from the ORIGINAL entry with the caller and the note. No caller is 401 on both. The surface: loadPositionPlans publishes the open plans by symbol and repaints the table, a failed read clears them, a stale read changes nothing, planPill states the whole plan in its title, and shared-positions.js loads the module and renders the pill right after the governance badge.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The amend button (trading 1.33.0), driven through the shipped position-plans.js over app.js's REAL api() (sliced verbatim) whose fetch reaches the REAL plan routes above: api() errors carry status 428 and code confirm_required; the account's open plans put the 'Exit plans' card on the page and a re-read refreshes only its count, so typed input survives; closed plans take the card away; an empty change sends nothing; DECLINED, the one request carries no confirm, the route refuses it 428 before any statement, the card shows the route's words before the question is asked and no plan changes; CONFIRMED, only the second request carries confirm:true and the route re-prices every open plan (or only the named symbols) from its original entry with the caller and the note; a 400 after the confirmation is shown as the route's reason with nothing written. The existing surface context gains a $ that finds no card host, so those cases paint exactly as before.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A life of 0 reached the confirmation with no terms named ('... get , priced from each plan's original entry.'). Two cases over the same shipped card, real api() and real routes: a life of 0 (alone and beside a posture), a negative and a fraction are each refused on the card with no request sent, no confirmation asked, no statement run and no plan changed, even though every confirmation would have been answered OK; and planAmendSummary names the life whenever the change carries one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createContext, Script } from 'node:vm';
import { registerTradingPositionPlanRoutes, parseAmendment } from '../src-routes/trading-position-plan-routes';
import type { AppContext } from '@/app/composition/app-context';

const SUB = 'k-position-plans-surface-spec-sub';
const BOOK_ID = '11111111-2222-4333-8444-5555555500dd';
const BOOK_REF = 'b-planspec';

/* ── the recording pool ─────────────────────────────────────────────────────── */
type Row = Record<string, unknown>;
let sql: Array<{ text: string; args: unknown[] }> = [];
let plans: Row[] = [];
let seq = 0;
let applied: Row | null = null;

const planRow = (symbol: string, over: Row = {}): Row => {
  seq += 1;
  return {
    plan_id: `pppppppp-0000-4000-8000-00000000000${seq}`, user_sub: SUB, mode: 'paper', book_id: BOOK_ID, symbol, decision_id: null,
    source: 'scan', posture: 'balanced', entry_price: '100.0000', stop_loss_pct: '9.0000', take_profit_pct: '20.0000',
    trail_arm_pct: '8.0000', trail_giveback_pct: '4.0000', stop_price: '91.0000', take_profit_price: '120.0000', sessions: 20,
    stamped_session: new Date('2026-09-01T00:00:00Z'), expiry_session: new Date('2026-09-29T00:00:00Z'), status: 'open',
    closed_by_door: null, created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, seq)), ...over,
  };
};

const query = async (raw: string, args: unknown[] = []) => {
  const text = raw.replace(/\s+/g, ' ').trim();
  sql.push({ text, args });
  if (/^SELECT book_id FROM oshal_trading_books/.test(text)) return { rows: args[1] === BOOK_REF ? [{ book_id: BOOK_ID }] : [] };
  if (/FROM oshal_trading_books b/.test(text)) {
    return {
      rows: args[1] === BOOK_ID ? [{
        book_id: BOOK_ID, ref: BOOK_REF, kind: 'paper', broker: 'alpaca', account_id: null, connection_key: null, enabled: true, learn: false,
        capital_cap_usd: null, settlement_policy: null, discovered_account_type: null, arm_ack_at: null, arm_ack_by: null,
        account_number_enc: null, account_type: null,
      }] : [],
    };
  }
  if (/^SELECT \* FROM trading_config_overrides WHERE user_sub = \$1 AND book_id = \$2 AND active/.test(text)) return { rows: applied ? [applied] : [] };
  if (/^SELECT \* FROM oshal_trading_position_plans WHERE user_sub = \$1 AND book_id = \$2 AND \(\$3::text IS NULL/.test(text)) {
    const out = plans.filter((p) => p.user_sub === args[0] && p.book_id === args[1] && (args[2] === null || p.status === args[2]));
    return { rows: [...out].reverse() };
  }
  if (/^SELECT \* FROM oshal_trading_position_plans WHERE user_sub = \$1 AND book_id = \$2 AND status = 'open'/.test(text)) {
    const symbols = args[2] as string[] | null;
    return { rows: plans.filter((p) => p.user_sub === args[0] && p.book_id === args[1] && p.status === 'open' && (!symbols || symbols.includes(String(p.symbol)))) };
  }
  if (/^UPDATE oshal_trading_position_plans SET status = 'amended'/.test(text)) {
    for (const p of plans) if (p.plan_id === args[0]) p.status = 'amended';
    return { rows: [] };
  }
  if (/^INSERT INTO oshal_trading_position_plans/.test(text)) {
    const [userSub, mode, bookId, symbol, decisionId, source, posture, entry, sl, tp, arm, give, stop, tpPx, sessions, stamped, expiry, from, by, note] = args;
    const row = planRow(String(symbol), {
      user_sub: userSub, mode, book_id: bookId, decision_id: decisionId, source, posture, entry_price: entry, stop_loss_pct: sl,
      take_profit_pct: tp, trail_arm_pct: arm, trail_giveback_pct: give, stop_price: stop, take_profit_price: tpPx, sessions,
      stamped_session: stamped, expiry_session: expiry, amended_from: from, amended_by: by, amend_note: note,
    });
    plans.push(row);
    return { rows: [row] };
  }
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
 * @param url - Path under the trading mount, query string included.
 * @param body - JSON body.
 * @param auth - False to send no authenticated caller.
 * @returns The status and JSON payload the handler produced.
 */
async function call(method: string, url: string, body: Record<string, unknown> = {}, auth = true): Promise<Answer> {
  const router = express.Router();
  registerTradingPositionPlanRoutes(router, ctx);
  const [pathname, qs] = url.split('?');
  const q: Record<string, string> = {};
  for (const pair of (qs || '').split('&').filter(Boolean)) { const [k, v] = pair.split('='); q[k] = decodeURIComponent(v ?? ''); }
  let status = 200;
  let out: Record<string, unknown> = {};
  await new Promise<void>((resolve, reject) => {
    const res: Record<string, unknown> = {};
    res.status = (code: number) => { status = code; return res; };
    res.json = (payload: Record<string, unknown>) => { out = payload; resolve(); return res; };
    const req = {
      method, url: pathname, originalUrl: pathname, baseUrl: '', path: pathname, body, query: q, headers: {}, get: () => undefined,
      ...(auth ? { oidc: { user: { sub: SUB } } } : {}),
    };
    (router as unknown as (a: unknown, b: unknown, n: (e?: unknown) => void) => void)(
      req, res, (err?: unknown) => reject(err instanceof Error ? err : new Error(`no route matched ${method} ${pathname}`)),
    );
  });
  return { status, body: out };
}

const ENV = ['TRADING_EXIT_PLANS', 'TRADING_EXIT_PLAN_SESSIONS'];
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  sql = []; plans = []; seq = 0; applied = null;
  for (const k of ENV) { saved.set(k, process.env[k]); delete process.env[k]; }
});
afterEach(() => {
  for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('GET /position-plans — the selected book\'s plans, and whether plans are on for it', () => {
  it('lists the OPEN plans of the resolved book, scoped by book_id in the kernel\'s own query', async () => {
    plans.push(planRow('AAPL'), planRow('MSFT', { status: 'closed', closed_by_door: 'plan-stop' }), planRow('NVDA'));
    plans.push(planRow('TSLA', { book_id: 'another-book' }));
    const r = await call('GET', `/position-plans?book=${BOOK_REF}`);
    expect(r.status).toBe(200);
    expect(r.body.book).toBe(BOOK_REF);
    expect((r.body.plans as Array<Row>).map((p) => p.symbol)).toEqual(['NVDA', 'AAPL']);
    expect((r.body.plans as Array<Row>)[0]).toMatchObject({ entryPrice: 100, stopPrice: 91, takeProfitPrice: 120, expirySession: '2026-09-29', status: 'open' });
    const read = sql.find((s) => /FROM oshal_trading_position_plans WHERE user_sub = \$1 AND book_id = \$2/.test(s.text));
    expect(read?.args.slice(0, 3)).toEqual([SUB, BOOK_ID, 'open']);
    const all = await call('GET', `/position-plans?book=${BOOK_REF}&status=all`);
    expect((all.body.plans as Array<Row>).map((p) => p.symbol)).toEqual(['NVDA', 'MSFT', 'AAPL']);
  });

  it('armed: env, a strategy knob (0 included) or off — through the dispatch\'s own resolver', async () => {
    expect((await call('GET', `/position-plans?book=${BOOK_REF}`)).body.armed).toEqual({ sessions: 0, source: 'off' });
    process.env.TRADING_EXIT_PLANS = 'paper';
    expect((await call('GET', `/position-plans?book=${BOOK_REF}`)).body.armed).toEqual({ sessions: 20, source: 'env' });
    applied = { id: 'ov', book_id: BOOK_ID, strategy_name: 'x', config: { exitPlanSessions: 0 }, apply_pct: 100, active: true, note: '', created_at: '' };
    expect((await call('GET', `/position-plans?book=${BOOK_REF}`)).body.armed).toEqual({ sessions: 0, source: 'strategy' });
  });

  it('a bad status or a garbage book is 400 — never a silent remap to the paper book', async () => {
    expect((await call('GET', `/position-plans?book=${BOOK_REF}&status=everything`)).body.error).toBe('status_invalid');
    const r = await call('GET', '/position-plans?book=not-a-book');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('unknown_book');
  });
});

describe('POST /position-plans/amend — the deliberate re-price, and only on purpose', () => {
  it('428 confirm_required without the flag, and NOTHING is read or written', async () => {
    plans.push(planRow('AAPL'));
    const r = await call('POST', `/position-plans/amend?book=${BOOK_REF}`, { posture: 'aggressive' });
    expect(r.status).toBe(428);
    expect(r.body.error).toBe('confirm_required');
    expect(sql).toEqual([]);
    expect(plans.map((p) => p.status)).toEqual(['open']);
  });

  it('400 on an unknown posture, bad sessions, bad symbols or an empty change — before any statement', async () => {
    for (const [body, code] of [
      [{ posture: 'yolo' }, 'posture_invalid'], [{ sessions: 0 }, 'sessions_invalid'], [{ sessions: 2.5 }, 'sessions_invalid'],
      [{ sessions: 300 }, 'sessions_invalid'], [{ sessions: 5, symbols: ['AAPL', 'DROP TABLE'] }, 'symbols_invalid'],
      [{ sessions: 5, symbols: [] }, 'symbols_invalid'], [{ note: 'nothing' }, 'nothing_to_amend'],
    ] as Array<[Record<string, unknown>, string]>) {
      const r = await call('POST', `/position-plans/amend?book=${BOOK_REF}`, { confirm: true, ...body });
      expect(r.status, code).toBe(400);
      expect(r.body.error).toBe(code);
    }
    expect(sql).toEqual([]);
  });

  it('confirmed: each open plan is retired and its successor is priced from the ORIGINAL entry, with the caller and the note', async () => {
    plans.push(planRow('AAPL'), planRow('MSFT'));
    const r = await call('POST', `/position-plans/amend?book=${BOOK_REF}`, { confirm: true, posture: 'aggressive', symbols: ['aapl'], note: 'widen after the posture review' });
    expect(r.status).toBe(200);
    const [amended] = r.body.amended as Array<Row>;
    expect(amended).toMatchObject({ symbol: 'AAPL', posture: 'aggressive', entryPrice: 100, stopLossPct: 15, stopPrice: 85, takeProfitPrice: 135, sessions: 20, status: 'open' });
    expect(plans.filter((p) => p.symbol === 'AAPL').map((p) => p.status)).toEqual(['amended', 'open']);
    expect(plans.find((p) => p.symbol === 'MSFT')?.status, 'a plan outside the named symbols is untouched').toBe('open');
    const insert = sql.find((s) => /^INSERT INTO oshal_trading_position_plans/.test(s.text));
    expect(insert?.args.slice(-2)).toEqual([SUB, 'widen after the posture review']);
    expect(sql.some((s) => /FOR UPDATE/.test(s.text) && s.args[0] === SUB && s.args[1] === BOOK_ID)).toBe(true);
  });

  it('parseAmendment: a new life alone keeps the dials; the note defaults', () => {
    expect(parseAmendment({ sessions: '30' })).toEqual({ change: { sessions: 30 }, note: 'amended from the trading surface' });
  });

  it('401s with no authenticated caller, on both handlers, before any work', async () => {
    for (const [m, u] of [['GET', '/position-plans'], ['POST', '/position-plans/amend']] as const) {
      const r = await call(m, u, { confirm: true, sessions: 5 }, false);
      expect(r.status, `${m} ${u}`).toBe(401);
      expect(r.body.error).toBe('not_authenticated');
    }
    expect(sql).toEqual([]);
  });
});

describe('the surface — the plan beside the governance badge', () => {
  type Surface = { loadPositionPlans: () => Promise<void>; planPill: (s: string) => string; window: Record<string, unknown>; RENDER_TOKEN: number };
  let surface: Surface;
  let payload: unknown;
  let fail = false;
  let renders = 0;
  const plan = { symbol: 'AAPL', posture: 'balanced', stampedSession: '2026-09-01', entryPrice: 100, stopPrice: 91, stopLossPct: 9, takeProfitPrice: 120, takeProfitPct: 20, trailArmPct: 8, trailGivebackPct: 4, expirySession: '2026-09-29', sessions: 20 };

  beforeEach(() => {
    payload = { book: BOOK_REF, plans: [plan], armed: { sessions: 20, source: 'env' } };
    fail = false; renders = 0;
    const win: Record<string, unknown> = {};
    surface = createContext({
      window: win,
      RENDER_TOKEN: 1,
      stale: (t: number) => t !== (surface as unknown as { RENDER_TOKEN: number }).RENDER_TOKEN,
      esc: (s: unknown) => String(s == null ? '' : s).replace(/"/g, '&quot;'),
      money: (n: unknown) => `$${Number(n).toFixed(2)}`,
      api: async (p: string) => { if (fail) throw new Error('HTTP 500'); expect(p).toBe('/position-plans?status=open'); return payload; },
      renderPortfolioTable: () => { renders += 1; },
      $: () => null, // the account view's card host; absent here, so these cases paint exactly as before
    }) as never;
    new Script(readFileSync(path.resolve(__dirname, '..', 'tools/ui/position-plans.js'), 'utf8')).runInContext(surface as never);
  });

  it('publishes the open plans by symbol, repaints the table, and pills a planned holding with its whole plan', async () => {
    await surface.loadPositionPlans();
    expect(renders).toBe(1);
    expect(Object.keys(surface.window.PLAN_BY_SYMBOL as object)).toEqual(['AAPL']);
    expect(surface.window.PLAN_ARM).toEqual({ sessions: 20, source: 'env' });
    const pill = surface.planPill('aapl');
    expect(pill).toContain('plan · stop $91.00 · exp 2026-09-29');
    expect(pill).toContain('entry $100.00 · stop $91.00 (-9%) · take-profit $120.00 (+20%)');
    expect(pill).toContain('trailing arms at +8% and gives back 4%');
    expect(pill).toContain('a posture change does not re-price them');
    expect(surface.planPill('MSFT'), 'an unplanned holding shows nothing').toBe('');
  });

  it('a failed read clears the plans (no stale pill); a read that lands after navigation changes nothing', async () => {
    await surface.loadPositionPlans();
    fail = true;
    await surface.loadPositionPlans();
    expect(surface.window.PLAN_BY_SYMBOL).toEqual({});
    expect(surface.planPill('AAPL')).toBe('');
    fail = false;
    const pending = surface.loadPositionPlans();
    surface.RENDER_TOKEN = 2;
    await pending;
    expect(surface.window.PLAN_BY_SYMBOL, 'the stale answer is dropped').toEqual({});
  });

  it('shared-positions.js loads the module, fetches plans after the table paints, and pills right after the governance badge', () => {
    const shared = readFileSync(path.resolve(__dirname, '..', 'tools/ui/shared-positions.js'), 'utf8');
    expect(shared).toContain("s.src = '/api/trading/ui/position-plans.js';");
    expect(shared).toMatch(/renderPortfolioTable\(\);[^\n]*\n[^\n]*\n\s*if \(typeof loadPositionPlans === 'function'\) loadPositionPlans\(\);/);
    expect(shared).toContain("governancePills(p.symbol) + (typeof planPill === 'function' ? planPill(p.symbol) : '')");
  });
});

/* ── the amend button: the shipped UI over app.js's REAL api() and the REAL plan routes ─────────── */
describe('the amend button — confirm goes only after an explicit confirmation; the 428 path is shown otherwise', () => {
  type El = { id: string; value: string; textContent: string; className: string; disabled: boolean; onclick: null | (() => unknown) };
  type Page = Record<string, unknown> & { loadPositionPlans: () => Promise<void>; amendPlansFromSurface: () => Promise<void>; api: (p: string, o?: unknown) => Promise<unknown> };
  let page: Page;
  let els: Map<string, El>;
  let host: { innerHTML: string; querySelector: (sel: string) => El | null };
  let posts: Array<Record<string, unknown>>;
  let answers: boolean[];
  let dialogs: Array<{ text: string; statusLine: string }>;
  const app = readFileSync(path.resolve(__dirname, '..', 'tools/ui/app.js'), 'utf8');
  /** The shipped api() and jbody, sliced verbatim from app.js. */
  const apiSource = (): string => {
    const jb = app.indexOf('const jbody = ');
    const start = app.indexOf('async function api(');
    return app.slice(jb, app.indexOf('\n', jb) + 1) + app.slice(start, app.indexOf('\n}\n', start) + 3);
  };
  const el = (id: string): El => ({ id, value: '', textContent: '', className: '', disabled: false, onclick: null });
  const field = (id: string): El => els.get(id)!;

  beforeEach(() => {
    plans.push(planRow('AAPL'), planRow('MSFT'));
    els = new Map(); posts = []; answers = []; dialogs = [];
    let html = '';
    const counter = el('count');
    host = {
      get innerHTML() { return html; },
      set innerHTML(h: string) {
        html = h;
        for (const m of h.matchAll(/ id="([^"]+)"/g)) els.set(m[1], el(m[1]));
        counter.textContent = /data-plan-count>([^<]*)</.exec(h)?.[1] ?? '';
      },
      querySelector: (sel: string) => (sel === '[data-plan-count]' && html.includes('data-plan-count') ? counter : null),
    };
    const ctx: Record<string, unknown> = {
      window: {}, RENDER_TOKEN: 1, BOOK: BOOK_REF, MODE: 'paper', DISP: 'Paper spec book',
      stale: (t: number) => t !== (page as { RENDER_TOKEN: number }).RENDER_TOKEN,
      esc: (s: unknown) => String(s == null ? '' : s).replace(/"/g, '&quot;'),
      money: (n: unknown) => `$${Number(n).toFixed(2)}`,
      $: (id: string) => (id === 'planAmendCard' ? host : els.get(id) ?? null),
      renderPortfolioTable: () => undefined,
      confirm: (text: string) => { dialogs.push({ text, statusLine: field('planAmendMsg').textContent }); return answers.shift() ?? false; },
      fetch: async (url: string, opts: { method?: string; body?: string } = {}) => {
        const method = opts.method || 'GET';
        const body = opts.body ? JSON.parse(opts.body) as Record<string, unknown> : {};
        if (method === 'POST') posts.push(body);
        const answer = await call(method, url.replace(/^\/api\/trading/, ''), body);
        return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
      },
    };
    page = createContext(ctx) as never;
    new Script(apiSource()).runInContext(page as never);
    new Script(readFileSync(path.resolve(__dirname, '..', 'tools/ui/position-plans.js'), 'utf8')).runInContext(page as never);
  });

  const fill = (values: Record<string, string>) => { for (const [id, v] of Object.entries(values)) field(id).value = v; };
  const writes = () => sql.filter((s) => /^(UPDATE|INSERT) /.test(s.text));

  it('app.js api() hands the caller the status and the route\'s code with the unchanged message', async () => {
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ posture: 'aggressive' }) };
    const err = await page.api('/position-plans/amend', opts).catch((e: unknown) => e) as { status: number; code: string; message: string };
    expect([err.status, err.code]).toEqual([428, 'confirm_required']);
    expect(err.message).toContain('resend with confirm:true');
  });

  it('the account\'s open plans put the card on the page, and a re-read refreshes the count without wiping what was typed', async () => {
    await page.loadPositionPlans();
    expect(host.innerHTML).toContain('Exit plans');
    expect(host.innerHTML).toContain('2 open plans');
    for (const p of ['conservative', 'balanced', 'aggressive', 'active']) expect(host.innerHTML).toContain(`<option value="${p}">${p} posture</option>`);
    expect(typeof field('planAmendBtn').onclick).toBe('function');
    fill({ planAmendPosture: 'aggressive', planAmendNote: 'typing' });
    const painted = host.innerHTML;
    plans.push(planRow('NVDA'));
    await page.loadPositionPlans();
    expect(host.innerHTML, 'the card is not repainted').toBe(painted);
    expect(host.querySelector('[data-plan-count]')!.textContent).toBe('3 open plans');
    expect([field('planAmendPosture').value, field('planAmendNote').value]).toEqual(['aggressive', 'typing']);
  });

  it('no open plan, no card: once the plans close, the card goes with them', async () => {
    await page.loadPositionPlans();
    expect(host.innerHTML).toContain('Exit plans');
    for (const p of plans) p.status = 'closed';
    await page.loadPositionPlans();
    expect(host.innerHTML).toBe('');
  });

  it('nothing chosen: it says so and sends nothing', async () => {
    await page.loadPositionPlans();
    await page.amendPlansFromSurface();
    expect(field('planAmendMsg').textContent).toBe('Choose new dials, a new life in sessions, or both.');
    expect(posts).toEqual([]);
  });

  it('a life of 0, a negative or a fraction is refused on the card: no request, no confirmation, no plan changed', async () => {
    await page.loadPositionPlans();
    sql = [];
    answers = [true, true, true, true];
    for (const [life, posture] of [['0', ''], ['0', 'aggressive'], ['-3', ''], ['2.5', '']]) {
      fill({ planAmendSessions: life, planAmendPosture: posture });
      await page.amendPlansFromSurface();
      expect(field('planAmendMsg').textContent, `life ${life}`).toBe('A new life is a whole number of sessions, 1 or more. Nothing was sent.');
      expect(field('planAmendMsg').className).toBe('sub err');
    }
    expect(posts, 'a posture beside a life of 0 is not sent on its own either').toEqual([]);
    expect(dialogs, 'the operator is never asked to confirm terms the question does not state').toEqual([]);
    expect(sql).toEqual([]);
    expect(plans.map((p) => p.status)).toEqual(['open', 'open']);
    expect(field('planAmendBtn').disabled).toBe(false);
  });

  it('the confirmation names every term the request carries, a life included', () => {
    const summary = (page as unknown as { planAmendSummary: (c: Record<string, unknown>) => string }).planAmendSummary;
    expect(summary({ sessions: 5 })).toBe('every open plan (0 open plans) on Paper spec book get a life of 5 sessions, priced from each plan\'s original entry.');
    expect(summary({ sessions: 0 }), 'a term is never dropped from the question').toContain('get a life of 0 sessions, priced');
    expect(summary({ posture: 'active' })).not.toContain('a life of');
  });

  it('declined: the one request sent carries no confirm, the route refuses it 428, the card shows its words, and no plan changes', async () => {
    await page.loadPositionPlans();
    fill({ planAmendPosture: 'aggressive', planAmendSessions: '30', planAmendNote: 'tighten' });
    sql = [];
    answers = [false];
    await page.amendPlansFromSurface();
    expect(posts).toHaveLength(1);
    expect(posts[0]).not.toHaveProperty('confirm');
    expect(posts[0]).toMatchObject({ posture: 'aggressive', sessions: 30, note: 'tighten', book: BOOK_REF });
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].statusLine, 'the 428 is on the card before the question is asked').toContain('Not amended - the server answered 428: Amending plans re-prices the exits of positions already in flight');
    expect(dialogs[0].text).toContain('every open plan (2 open plans) on Paper spec book get the stop / take-profit / trailing dials of the aggressive posture and a life of 30 sessions');
    expect(field('planAmendMsg').textContent).toBe('Not amended - you did not confirm, so the 428 stands and nothing changed.');
    expect(writes()).toEqual([]);
    expect(plans.map((p) => p.status)).toEqual(['open', 'open']);
    expect(field('planAmendBtn').disabled).toBe(false);
  });

  it('confirmed: only then does confirm:true go, and the route re-prices every open plan with the caller and the note', async () => {
    await page.loadPositionPlans();
    fill({ planAmendPosture: 'aggressive', planAmendSessions: '30', planAmendNote: 'tighten' });
    answers = [true];
    await page.amendPlansFromSurface();
    expect(posts.map((b) => b.confirm)).toEqual([undefined, true]);
    expect(posts[1]).toMatchObject({ posture: 'aggressive', sessions: 30, note: 'tighten', confirm: true });
    expect(plans.map((p) => `${p.symbol}:${p.status}`)).toEqual(['AAPL:amended', 'MSFT:amended', 'AAPL:open', 'MSFT:open']);
    const successors = plans.filter((p) => p.status === 'open');
    for (const p of successors) expect(p).toMatchObject({ posture: 'aggressive', sessions: 30, amended_by: SUB, amend_note: 'tighten' });
    expect(successors.map((p) => Number(p.entry_price)), 'priced from the original entry').toEqual([100, 100]);
    expect(field('planAmendMsg').textContent).toBe('Amended 2 plan(s); each successor records you and your note.');
    expect(field('planAmendMsg').className).toBe('sub ok');
  });

  it('named symbols only: the confirmation names them and the rest stay as they were', async () => {
    await page.loadPositionPlans();
    fill({ planAmendSessions: '10', planAmendSymbols: 'msft' });
    answers = [true];
    await page.amendPlansFromSurface();
    expect(dialogs[0].text).toContain('MSFT on Paper spec book get a life of 10 sessions');
    expect(posts[1]).toMatchObject({ sessions: 10, symbols: ['MSFT'], confirm: true });
    expect(plans.map((p) => `${p.symbol}:${p.status}`)).toEqual(['AAPL:open', 'MSFT:amended', 'MSFT:open']);
  });

  it('a refusal after the confirmation is shown as the route\'s own reason, and nothing is written', async () => {
    await page.loadPositionPlans();
    fill({ planAmendSessions: '10', planAmendSymbols: '???' });
    answers = [true];
    sql = [];
    await page.amendPlansFromSurface();
    expect(posts.map((b) => b.confirm)).toEqual([undefined, true]);
    expect(field('planAmendMsg').textContent).toBe('Amend failed: symbols must be a list of 1 to 100 tickers.');
    expect(writes()).toEqual([]);
  });

  it('the account view owns the card host, right under the positions table', () => {
    const view = readFileSync(path.resolve(__dirname, '..', 'tools/ui/view-account.js'), 'utf8');
    expect(view).toMatch(/'<div id="positionsHero">[^\n]*\n\s*'<div id="planAmendCard"><\/div>' \+/);
  });
});
