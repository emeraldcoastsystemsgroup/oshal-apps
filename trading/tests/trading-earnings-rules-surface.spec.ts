/**
 * ADR-136 D5 — the operator can ARM, LIST and CANCEL an earnings-reaction rule from the account page.
 *
 * THE BOUNDARY THIS GUARD CROSSES. The defect it exists for is not a wrong number; it is an absent
 * surface — the kernel's rule store could only be reached by CALLING the module, so no person could
 * arm a rule, see one, or stop one. So the two seams that were missing are the two this spec drives
 * for real:
 *   (1) THE ROUTE. A REAL express Router is composed by this package's own
 *       registerTradingEarningsRuleRoutes and every request is matched and run by express, against
 *       the REAL kernel CRUD (createEventRule / listEventRules / cancelEventRule / normalizeEventRule
 *       from @/app/trading-earnings-rules) and the REAL book resolver. Nothing about arming,
 *       validating, scoping or refusing is restated here — the assertions are on the payload a caller
 *       actually receives and on the SQL the kernel actually emitted.
 *   (2) THE SURFACE. The shipped classic script tools/ui/view-earnings-rules.js is EXECUTED in a vm
 *       context with the page globals it depends on, and the card's own delegated click handler is
 *       dispatched — so "Arm" and "Cancel" are proven to reach the endpoints, not read to.
 *
 * THE ONE SCOPED DOUBLE, named rather than hidden: the Postgres pool is a recording fake that stores
 * rows in memory and raises 23505 for a second ACTIVE rule on the same (book, symbol), the way the
 * kernel's partial unique index does. It is a double of a boundary this change does not touch, and
 * it CANNOT be the closure evidence for that boundary — the real companion already exists and is
 * core's tests/unit/trading-earnings-rules.spec.ts, which drives the same CRUD against a
 * DisposablePostgres with the real FORCE-RLS table and the real partial unique index. A real server
 * is structurally unavailable here: scripts/run-trading-specs.mjs pins this package's specs to a DSN
 * that cannot connect to anything, deliberately, and that refusal is worth more than a second copy
 * of a test core already runs.
 *
 * Run from the package root with the framework checkout on the alias path:
 *   OSHAL_FRAMEWORK=<oshal checkout> npx vitest run tests/trading-earnings-rules-surface.spec.ts
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the ADR-136 D5 surface guards. Route half over the real router: list is book-scoped and carries the watcher posture, the limits and the classification basis; arming is 428 without confirm and stores NOTHING; a missing scheduler is 503 and stores nothing; the leg is ensured BEFORE the insert; the kernel's own refusals (all-hold, bad expiry, a second active rule on the same name) arrive as 400/409 through the route; cancel moves an active rule to cancelled and 409s a terminal one; every handler 401s without a caller; the book is resolved QUERY-first. Surface half by EXECUTING view-earnings-rules.js: the card paints a row per rule with a Cancel only on the active ones, prints the SERVER's watcher-off note and the SERVER's basis (both changed in the payload and read back, so neither can be a literal here), and the delegated Arm / Cancel handlers POST to /events/rules and /events/rules/:id/cancel with the form's own values.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createContext, Script } from 'node:vm';
import { registerTradingEarningsRuleRoutes } from '../src-routes/trading-earnings-rule-routes';
import { setTradingScheduleService } from '@/app/trading-schedule-dispatch';
import { CLASSIFICATION_BASIS } from '@/app/trading-earnings-rules';
import type { AppContext } from '@/app/composition/app-context';

const SUB = 'k-earnings-rule-surface-spec-sub';
const BOOK_ID = '11111111-2222-4333-8444-555555555555';
const BOOK_REF = 'paper-spec';

/* ── the recording pool ─────────────────────────────────────────────────────── */
type Row = Record<string, unknown>;
/** Every SQL the route + kernel handed the pool this test, in order. */
let sql: string[] = [];
/** The in-memory rule table. */
let rules: Row[] = [];
/** Whether the book this spec resolves is enabled for the autopilot. */
let bookEnabled = true;
let ruleSeq = 0;

const ACTIVE = ['armed', 'detected', 'classified'];

/** A duplicate-key error shaped the way node-postgres reports the partial unique index. */
function duplicate(): Error {
  const e = new Error('duplicate key value violates unique constraint') as Error & { code: string };
  e.code = '23505';
  return e;
}

/** INSERT ... RETURNING * for the rule table, with the one-active-per-(book,symbol) index applied. */
function insertRule(args: unknown[]): Row {
  const [userSub, bookId, bookRef, symbol, onBeat, onMiss, onInline, sizing, expectedAt, expiresAt, timeline] = args;
  if (rules.some((r) => r.book_id === bookId && r.symbol === symbol && ACTIVE.includes(String(r.status)))) throw duplicate();
  ruleSeq += 1;
  const row: Row = {
    rule_id: `aaaaaaaa-bbbb-4ccc-8ddd-00000000000${ruleSeq}`, user_sub: userSub, book_id: bookId, book_ref: bookRef,
    symbol, event: 'earnings', on_beat: onBeat, on_miss: onMiss, on_inline: onInline,
    sizing: JSON.parse(String(sizing)), expected_at: expectedAt, expires_at: expiresAt, status: 'armed',
    cik: null, filing: null, classification: null, reaction: null, decision_id: null, order: null,
    timeline: JSON.parse(String(timeline)), created_at: new Date(Date.now() + ruleSeq * 1000).toISOString(), updated_at: new Date().toISOString(),
  };
  rules.push(row);
  return row;
}

/** UPDATE ... SET "col" = $n ... WHERE user_sub=$1 AND rule_id=$2 RETURNING *, applied by column name. */
function updateRule(text: string, args: unknown[]): Row[] {
  const row = rules.find((r) => r.user_sub === args[0] && r.rule_id === args[1]);
  if (!row) return [];
  for (const m of text.matchAll(/"(\w+)" = \$(\d+)/g)) row[m[1]] = args[Number(m[2]) - 1];
  if (/timeline = timeline \|\| \$(\d+)/.test(text)) {
    const n = Number(/timeline = timeline \|\| \$(\d+)/.exec(text)![1]);
    row.timeline = [...(row.timeline as unknown[]), ...JSON.parse(String(args[n - 1]))];
  }
  return [row];
}

/** The pool the route and the kernel actually use. DDL is accepted; reads/writes hit the arrays. */
const pool = {
  connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }),
  query: async (text: string, args: unknown[] = []) => {
    sql.push(text.replace(/\s+/g, ' ').trim());
    if (/^SELECT book_id FROM oshal_trading_books/.test(text.trim())) {
      return { rows: args[1] === BOOK_REF ? [{ book_id: BOOK_ID }] : [] };
    }
    if (/FROM oshal_trading_books b/.test(text)) {
      return {
        rows: args[1] === BOOK_ID
          ? [{
            book_id: BOOK_ID, ref: BOOK_REF, kind: 'paper', broker: 'alpaca', account_id: null, connection_key: null,
            enabled: bookEnabled, learn: false, capital_cap_usd: null, settlement_policy: null,
            account_number_enc: null, account_type: null,
          }]
          : [],
      };
    }
    if (/INSERT INTO oshal_trading_event_rules/.test(text)) return { rows: [insertRule(args)] };
    if (/UPDATE oshal_trading_event_rules/.test(text)) return { rows: updateRule(text, args) };
    if (/SELECT \* FROM oshal_trading_event_rules/.test(text)) {
      let out = rules.filter((r) => r.user_sub === args[0]);
      if (/rule_id = \$2/.test(text)) out = out.filter((r) => r.rule_id === args[1]);
      if (/book_id = \$2/.test(text)) out = out.filter((r) => r.book_id === args[1]);
      if (/ORDER BY created_at DESC/.test(text)) out = [...out].reverse();
      return { rows: out };
    }
    return { rows: [] };
  },
} as unknown as AppContext['pool'];

const ctx = { pool } as unknown as AppContext;

/* ── the scheduler double (the leg is ensured, not simulated) ───────────────── */
/** Every createSchedule the arm path made, and when — the ordering proof against the INSERT. */
let schedules: Array<{ taskType: string; at: number }> = [];
let schedulerPresent = true;

function installScheduler(): void {
  setTradingScheduleService(schedulerPresent ? ({
    listSchedules: async () => [],
    createSchedule: async (s: { taskType: string }) => { schedules.push({ taskType: s.taskType, at: sql.length }); return { id: 'sched-1' }; },
  } as never) : (null as never));
}

/* ── one request through the REAL router ────────────────────────────────────── */
interface Answer { status: number; body: Record<string, unknown> }

/**
 * @description Drive one request through a real express Router composed by the package's own
 * registration function — express matches the path and runs the handler, so the answer is the one a
 * caller receives.
 * @param method - HTTP method.
 * @param url - Path under the trading mount, query string included.
 * @param body - JSON body.
 * @param auth - False to send no authenticated caller (the 401 cases).
 * @returns The status and JSON payload the handler produced.
 */
async function call(method: string, url: string, body: Record<string, unknown> = {}, auth = true): Promise<Answer> {
  const router = express.Router();
  registerTradingEarningsRuleRoutes(router, ctx);
  const [pathname, query] = url.split('?');
  const q: Record<string, string> = {};
  for (const pair of (query || '').split('&').filter(Boolean)) { const [k, v] = pair.split('='); q[k] = decodeURIComponent(v ?? ''); }
  let status = 200;
  let out: Record<string, unknown> = {};
  await new Promise<void>((resolve, reject) => {
    const res: Record<string, unknown> = {};
    res.status = (code: number) => { status = code; return res; };
    res.json = (payload: Record<string, unknown>) => { out = payload; resolve(); return res; };
    const req = {
      method, url: pathname, originalUrl: pathname, baseUrl: '', path: pathname,
      body, query: q, headers: {}, get: () => undefined,
      ...(auth ? { oidc: { user: { sub: SUB } } } : {}),
    };
    (router as unknown as (a: unknown, b: unknown, n: (e?: unknown) => void) => void)(
      req, res, (err?: unknown) => reject(err instanceof Error ? err : new Error(`no route matched ${method} ${pathname}`)),
    );
  });
  return { status, body: out };
}

/** A well-formed rule body the kernel accepts. */
const goodRule = (over: Record<string, unknown> = {}) => ({
  symbol: 'MSFT', onBeat: 'buy', onMiss: 'sell', onInline: 'hold',
  sizing: { mode: 'pct_of_position', value: 50 },
  expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), ...over,
});

const ENV = ['TRADING_EVENT_PLANS', 'TRADING_EARNINGS_RULES'];
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  sql = []; rules = []; schedules = []; ruleSeq = 0; bookEnabled = true; schedulerPresent = true;
  for (const k of ENV) { saved.set(k, process.env[k]); process.env[k] = 'true'; }
  installScheduler();
});
afterEach(() => {
  for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('GET /events/rules — this account\'s rules, with the posture the operator must see', () => {
  it('answers the resolved book\'s rules newest first, scoped by book_id, with the basis and limits', async () => {
    await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule() });
    await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule({ symbol: 'NVDA' }) });
    sql = [];

    const r = await call('GET', `/events/rules?book=${BOOK_REF}`);

    expect(r.status).toBe(200);
    expect(r.body.book).toBe(BOOK_REF);
    expect((r.body.rules as Array<{ symbol: string }>).map((x) => x.symbol)).toEqual(['NVDA', 'MSFT']);
    // The list read is BOOK-scoped in the query itself, not filtered afterwards.
    expect(sql.some((s) => /SELECT \* FROM oshal_trading_event_rules WHERE user_sub = \$1 AND book_id = \$2/.test(s))).toBe(true);
    // The basis is the kernel's own sentence, not a copy living on the surface.
    expect(r.body.basis).toBe(CLASSIFICATION_BASIS);
    expect(String(r.body.basis)).toContain('not Street consensus');
    expect(r.body.limits).toMatchObject({ maxDays: expect.any(Number), windowBeforeDays: expect.any(Number), windowAfterDays: expect.any(Number) });
  });

  it('enabled folds BOTH executor gates, and the note names the one that is off', async () => {
    process.env.TRADING_EARNINGS_RULES = 'true';
    process.env.TRADING_EVENT_PLANS = 'true';
    expect((await call('GET', `/events/rules?book=${BOOK_REF}`)).body).toMatchObject({ enabled: true, note: null });

    process.env.TRADING_EARNINGS_RULES = 'false';
    const watcherOff = (await call('GET', `/events/rules?book=${BOOK_REF}`)).body;
    expect(watcherOff.enabled).toBe(false);
    expect(String(watcherOff.note)).toContain('TRADING_EARNINGS_RULES');

    process.env.TRADING_EARNINGS_RULES = 'true';
    process.env.TRADING_EVENT_PLANS = 'false';
    const legOff = (await call('GET', `/events/rules?book=${BOOK_REF}`)).body;
    expect(legOff.enabled).toBe(false);
    expect(String(legOff.note)).toContain('TRADING_EVENT_PLANS');
  });

  it('a garbage book ref is 400 unknown_book — never a silent remap to the paper book', async () => {
    const r = await call('GET', '/events/rules?book=not-a-book');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('unknown_book');
  });

  it('401s with no authenticated caller, on every handler, before any work', async () => {
    for (const [m, u] of [['GET', '/events/rules'], ['POST', '/events/rules'], ['POST', '/events/rules/x/cancel']] as const) {
      const r = await call(m, u, { confirm: true, rule: goodRule() }, false);
      expect(r.status, `${m} ${u}`).toBe(401);
      expect(r.body.error).toBe('not_authenticated');
    }
    expect(sql).toEqual([]);
  });
});

describe('POST /events/rules — arming is confirm-gated and never stores a rule nothing will read', () => {
  it('428 confirm_required without the flag, and NOTHING is written', async () => {
    const r = await call('POST', `/events/rules?book=${BOOK_REF}`, { rule: goodRule() });
    expect(r.status).toBe(428);
    expect(r.body.error).toBe('confirm_required');
    expect(rules).toEqual([]);
    expect(sql).toEqual([]);
  });

  it('a truthy confirm is not a confirm — only the strict boolean arms', async () => {
    const r = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: 'yes', rule: goodRule() });
    expect(r.status).toBe(428);
    expect(rules).toEqual([]);
  });

  it('201 stores the rule, and the trading-events leg is ensured BEFORE the insert', async () => {
    const r = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule() });

    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ scheduled: true, enabled: true, note: null, basis: CLASSIFICATION_BASIS, warning: null });
    const stored = r.body.rule as Record<string, unknown>;
    expect(stored).toMatchObject({ symbol: 'MSFT', onBeat: 'buy', onMiss: 'sell', onInline: 'hold', bookRef: BOOK_REF, status: 'armed' });
    expect(stored.sizing).toEqual({ mode: 'pct_of_position', value: 50 });
    expect(rules).toHaveLength(1);
    // The ordering is the point: a rule armed without its leg is never looked at again.
    expect(schedules).toHaveLength(1);
    expect(schedules[0].taskType).toBe(`trading-events:${SUB}`);
    const insertAt = sql.findIndex((s) => /INSERT INTO oshal_trading_event_rules/.test(s));
    expect(insertAt).toBeGreaterThan(-1);
    expect(schedules[0].at).toBeLessThanOrEqual(insertAt);
  });

  it('no scheduler is 503 scheduler_unavailable and stores NOTHING', async () => {
    schedulerPresent = false; installScheduler();
    const r = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule() });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('scheduler_unavailable');
    expect(rules).toEqual([]);
    expect(sql.some((s) => /INSERT INTO oshal_trading_event_rules/.test(s))).toBe(false);
  });

  it('the kernel\'s own refusals arrive through the route with their codes', async () => {
    const noop = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule({ onBeat: 'hold', onMiss: 'hold', onInline: 'hold' }) });
    expect(noop.status).toBe(400);
    expect(noop.body.error).toBe('rule_noop');

    const past = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule({ expiresAt: '2020-01-01T00:00:00.000Z' }) });
    expect(past.status).toBe(400);
    expect(past.body.error).toBe('expiry_invalid');

    const size = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule({ sizing: { mode: 'pct_of_position', value: 400 } }) });
    expect(size.status).toBe(400);
    expect(size.body.error).toBe('sizing_invalid');

    const sym = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule({ symbol: '' }) });
    expect(sym.status).toBe(400);
    expect(sym.body.error).toBe('symbol_required');
    expect(rules).toEqual([]);
  });

  it('a second ACTIVE rule for the same name on the same book is 409 rule_exists', async () => {
    expect((await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule() })).status).toBe(201);
    const again = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule() });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('rule_exists');
    expect(rules).toHaveLength(1);
  });

  it('a view-only account is warned about the half that is refused, not told nothing happens', async () => {
    bookEnabled = false;
    const r = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule() });
    expect(r.status).toBe(201);
    expect(String(r.body.warning)).toContain('BUY');
    expect(String(r.body.warning)).toContain('SELL');
  });

  it('the book is resolved QUERY-first — a stale body book can never redirect the rule', async () => {
    const r = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, book: 'paper', rule: goodRule() });
    expect(r.status).toBe(201);
    expect((r.body.rule as { bookRef: string }).bookRef).toBe(BOOK_REF);
  });
});

describe('POST /events/rules/:id/cancel — an active rule stops; a terminal one is already inert', () => {
  it('cancels an armed rule and leaves it listed as history', async () => {
    const armed = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule() });
    const id = (armed.body.rule as { ruleId: string }).ruleId;

    const r = await call('POST', `/events/rules/${id}/cancel`);
    expect(r.status).toBe(200);
    expect((r.body.rule as { status: string }).status).toBe('cancelled');
    const timeline = (r.body.rule as { timeline: Array<{ event: string }> }).timeline;
    expect(timeline.map((t) => t.event)).toContain('cancelled');

    const list = await call('GET', `/events/rules?book=${BOOK_REF}`);
    expect((list.body.rules as Array<{ status: string }>).map((x) => x.status)).toEqual(['cancelled']);
  });

  it('cancelling twice is 409 rule_not_active, and an unknown id is 404 rule_not_found', async () => {
    const armed = await call('POST', `/events/rules?book=${BOOK_REF}`, { confirm: true, rule: goodRule() });
    const id = (armed.body.rule as { ruleId: string }).ruleId;
    await call('POST', `/events/rules/${id}/cancel`);

    const twice = await call('POST', `/events/rules/${id}/cancel`);
    expect(twice.status).toBe(409);
    expect(twice.body.error).toBe('rule_not_active');

    const missing = await call('POST', '/events/rules/99999999-9999-4999-8999-999999999999/cancel');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('rule_not_found');
  });
});

/* ── the surface half: the shipped card is EXECUTED, not read ───────────────── */
describe('the Earnings rules card — painted, and its Arm / Cancel actually reach the routes', () => {
  /** What the card's api() was asked for, and what it was given back. */
  let calls: Array<{ path: string; opts: Record<string, unknown> | undefined }> = [];
  let payload: Record<string, unknown> = {};
  let nodes: Record<string, { innerHTML: string; onclick: ((e: unknown) => void) | null; value?: string }> = {};
  let confirmed = true;
  let surface: Record<string, (...a: unknown[]) => unknown>;

  /** A node the card can paint into or read a value out of. */
  function node(value?: string) {
    return {
      innerHTML: '', onclick: null as ((e: unknown) => void) | null, value,
      contains: () => true,
      insertAdjacentHTML(_where: string, html: string) { this.innerHTML = html + this.innerHTML; },
    };
  }

  /** Dispatch the card's ONE delegated handler as a click on a button carrying these attributes. */
  function click(attrs: Record<string, string>): void {
    const button = { getAttribute: (k: string) => attrs[k] ?? null };
    const event = { target: { closest: (sel: string) => (sel === 'button[data-act]' ? button : null) }, preventDefault: () => undefined };
    nodes.earningsRulesCard.onclick!(event);
  }

  beforeEach(() => {
    calls = []; confirmed = true;
    nodes = { earningsRulesCard: node() } as never;
    payload = {
      rules: [
        {
          ruleId: 'r-1', symbol: 'MSFT', onBeat: 'buy', onMiss: 'sell', onInline: 'hold', status: 'armed',
          sizing: { mode: 'pct_of_position', value: 50 }, expectedAt: '2026-10-23', order: null, filing: null,
          timeline: [{ at: '2026-09-20T12:00:00Z', event: 'armed', detail: 'MSFT on paper-spec: beat -> buy' }],
        },
        {
          ruleId: 'r-2', symbol: 'NVDA', onBeat: 'hold', onMiss: 'sell', onInline: 'hold', status: 'fired_short',
          sizing: { mode: 'shares', value: 40 }, expectedAt: null, order: { truncated: true }, filing: { url: 'https://example.invalid/8k' },
          timeline: [{ at: '2026-09-20T12:00:00Z', event: 'fired_short', detail: '264 of 1000 NVDA placed' }],
        },
      ],
      book: BOOK_REF, enabled: false, note: 'SPEC POSTURE SENTENCE', basis: 'SPEC BASIS SENTENCE',
      limits: { maxDays: 120, windowBeforeDays: 1, windowAfterDays: 3 },
    };
    surface = createContext({
      $: (id: string) => nodes[id] ?? null,
      esc: (s: unknown) => String(s == null ? '' : s),
      money: (n: unknown) => `$${n}`,
      stale: () => false,
      RENDER_TOKEN: 1,
      DISP: 'Paper (spec)',
      STATE: { positions: [{ symbol: 'MSFT', qty: 120 }, { symbol: 'NVDA', qty: 40 }] },
      confirm: () => confirmed,
      jbody: (method: string, obj: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }),
      api: async (p: string, opts?: Record<string, unknown>) => { calls.push({ path: p, opts }); return payload; },
    }) as never;
    const file = path.resolve(__dirname, '..', 'tools/ui/view-earnings-rules.js');
    new Script(readFileSync(file, 'utf8')).runInContext(surface as never);
  });

  it('paints a row per rule with its mappings and status, and a Cancel only on the active one', async () => {
    await surface.loadEarningsRulesCard(1);
    const html = nodes.earningsRulesCard.innerHTML;

    expect(calls[0].path).toBe('/events/rules');
    expect(html).toContain('Earnings rules');
    expect(html).toContain('MSFT');
    expect(html).toContain('beat → buy · miss → sell · inline → hold');
    expect(html).toContain('50% of the position');
    expect(html).toContain('40 shares');
    // The kernel's honest terminal has to read as an alert, not as a completed rule.
    expect(html).toContain('fired short');
    expect(html).toContain('TRUNCATED');
    expect(html).toContain('https://example.invalid/8k');
    // Exactly one cancel button: r-1 is armed, r-2 is terminal.
    expect(html.match(/data-act="cancel-rule"/g)).toHaveLength(1);
    expect(html).toContain('data-rule="r-1"');
    expect(html).not.toContain('data-rule="r-2"');
  });

  it('prints the SERVER\'s posture note and the SERVER\'s basis — neither is a literal in the card', async () => {
    await surface.loadEarningsRulesCard(1);
    expect(nodes.earningsRulesCard.innerHTML).toContain('SPEC POSTURE SENTENCE');
    expect(nodes.earningsRulesCard.innerHTML).toContain('SPEC BASIS SENTENCE');

    payload.enabled = true; payload.note = null;
    await surface.loadEarningsRulesCard(1);
    expect(nodes.earningsRulesCard.innerHTML).not.toContain('SPEC POSTURE SENTENCE');
  });

  it('a failed read says so in red rather than painting an empty card', async () => {
    surface.api = (async () => { throw new Error('boom'); }) as never;
    await surface.loadEarningsRulesCard(1);
    expect(nodes.earningsRulesCard.innerHTML).toContain('Earnings rules unavailable: boom');
  });

  it('Arm POSTs the form\'s own values to /events/rules with confirm true', async () => {
    await surface.loadEarningsRulesCard(1);
    click({ 'data-act': 'open-rule-form' });
    expect(nodes.earningsRulesCard.innerHTML).toContain('data-act="arm-rule"');
    // The held names are offered, from the positions this account already loaded.
    expect(nodes.earningsRulesCard.innerHTML).toContain('<option value="MSFT">MSFT (120)</option>');

    Object.assign(nodes, {
      ruleSymbol: node('nvda'), ruleBeat: node('hold'), ruleMiss: node('sell'), ruleInline: node('hold'),
      ruleSizeMode: node('pct_of_position'), ruleSizeValue: node('75'), ruleExpected: node('2026-10-23'),
      ruleExpires: node('2026-11-30'), ruleFormMsg: node(),
    });
    calls = [];
    click({ 'data-act': 'arm-rule' });
    await new Promise((r) => setImmediate(r));

    expect(calls[0].path).toBe('/events/rules');
    const sent = JSON.parse(String((calls[0].opts as { body: string }).body));
    expect(sent.confirm).toBe(true);
    expect(sent.rule).toMatchObject({
      symbol: 'NVDA', onBeat: 'hold', onMiss: 'sell', onInline: 'hold',
      sizing: { mode: 'pct_of_position', value: 75 }, expectedAt: '2026-10-23',
    });
    expect(String(sent.rule.expiresAt)).toContain('2026-11-30');
  });

  it('a rule that holds on every outcome never leaves the form, and says so in the form', async () => {
    await surface.loadEarningsRulesCard(1);
    click({ 'data-act': 'open-rule-form' });
    Object.assign(nodes, {
      ruleSymbol: node('MSFT'), ruleBeat: node('hold'), ruleMiss: node('hold'), ruleInline: node('hold'),
      ruleSizeMode: node('shares'), ruleSizeValue: node('10'), ruleExpected: node(''),
      ruleExpires: node('2026-11-30'), ruleFormMsg: node(),
    });
    calls = [];
    click({ 'data-act': 'arm-rule' });
    await new Promise((r) => setImmediate(r));
    expect(calls).toEqual([]);
    expect(nodes.ruleFormMsg.innerHTML).toContain('would never do anything');
  });

  it('Cancel POSTs to /events/rules/:id/cancel, and a declined confirm sends nothing', async () => {
    await surface.loadEarningsRulesCard(1);
    calls = [];
    confirmed = false;
    click({ 'data-act': 'cancel-rule', 'data-rule': 'r-1' });
    await new Promise((r) => setImmediate(r));
    expect(calls).toEqual([]);

    confirmed = true;
    click({ 'data-act': 'cancel-rule', 'data-rule': 'r-1' });
    await new Promise((r) => setImmediate(r));
    expect(calls[0].path).toBe('/events/rules/r-1/cancel');
    expect((calls[0].opts as { method: string }).method).toBe('POST');
  });
});

describe('the card is wired into the account page and the shell, with no inline handlers', () => {
  const read = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');

  it('view-account.js creates the placeholder and kicks the painter', () => {
    const view = read('tools/ui/view-account.js');
    expect(view).toContain("'<div id=\"earningsRulesCard\"></div>'");
    expect(view).toContain('loadEarningsRulesCard(token);');
    // The card lives in its own file — view-account.js only hosts it.
    expect(view).not.toContain('earningsRulesCardHtml');
  });

  it('the shell loads view-earnings-rules.js', () => {
    const html = read('tools/trading.html');
    expect(html).toContain('<script src="/api/trading/ui/view-earnings-rules.js"></script>');
  });

  it('strict-CSP clean: the card carries no inline handler attribute anywhere', () => {
    const card = read('tools/ui/view-earnings-rules.js');
    expect(card).not.toMatch(/\son(click|change|input|submit)\s*=\s*["']/);
    expect(card).toContain("el.onclick = (e) => {");
  });

  /**
   * The registration is checked by COMPOSING the package's real router and reading the paths express
   * actually holds — not by finding the call in the source. A source pin cannot tell a live call from
   * a commented-out one: the first draft of this case asserted the text and stayed green when the
   * registration line was commented out, which is the whole defect ("no surface") back again.
   */
  const composedPaths = (factory: (c: AppContext) => { stack: Array<{ route?: { path: string } }> }): string[] => {
    const router = factory({ pool, appPackageDir: path.resolve(__dirname, '..') } as unknown as AppContext);
    return router.stack.map((l) => l.route?.path).filter((x): x is string => typeof x === 'string');
  };

  it('the composed trading router really holds the three earnings-rule paths', async () => {
    const { createTradingRoutes } = await import('../src-routes/trading-routes');
    const paths = composedPaths(createTradingRoutes as never);
    expect(paths).toContain('/events/rules');
    expect(paths).toContain('/events/rules/:id/cancel');
    // And the sibling family is still there — the registration was added, not swapped in.
    expect(paths).toContain('/events/plans');
  });

  it('the COMPILED module the manifest loads registers it too, not only the TypeScript source', () => {
    // The kernel loads routes/*.js; a source change that never reached the compiled output would
    // ship a surface that exists in git and not on the box.
    const compiled = read('routes/trading-routes.js');
    const line = compiled.split('\n').find((l) => l.includes('registerTradingEarningsRuleRoutes)(router, ctx)'));
    expect(line, 'the compiled trading router must call the earnings-rule registration').toBeTruthy();
    expect(line!.trim().startsWith('//'), 'the call is commented out in the compiled router').toBe(false);
  });
});
