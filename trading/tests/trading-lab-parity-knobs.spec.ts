/**
 * ADR-052 addendum — the three paper-to-live parity knobs are documented where the Strategy Lab reads
 * its knobs, and editable where a strategy is made.
 *
 * THE BOUNDARY THIS GUARD CROSSES. The knob reference and the editor are the two seams this change
 * adds, and both are driven for real:
 *   (1) THE ROUTE. A REAL express Router built by this package's own createTradingStrategyLabRoutes
 *       answers GET /knobs and POST /strategies; the new strategy's config goes through the kernel's
 *       REAL normalizeConfig on its way to the INSERT this spec records.
 *   (2) THE SURFACE. The shipped classic script tools/ui/view-strategies.js is EXECUTED in a vm
 *       context, and its requests go through app.js's REAL api() (sliced from the shipped file), whose
 *       fetch is wired to that same router. renderLabForm paints the editor, saveLabStrategy reads it
 *       and posts, loadLabKnobs paints the reference.
 *
 * THE SCOPED DOUBLES, named rather than hidden: the Postgres pool is a recording fake (it answers the
 * lab bootstrap and the strategy INSERT), and the DOM is a minimal element map that mounts the ids the
 * painted HTML declares. The real companion for the knobs themselves is core's
 * tests/unit/trading-strategy-lab-sim.spec.ts and trading-yield-sleeve.spec.ts, which drive the same
 * normalizeConfig and resolvers; the confirm-gated path that carries a saved strategy to an account is
 * tests/trading-parity-feature-promotion.spec.ts.
 *
 * Run from the package root with the framework checkout on the alias path:
 *   OSHAL_FRAMEWORK=<oshal checkout> npx vitest run --config vitest.config.mjs tests/trading-lab-parity-knobs.spec.ts
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — GET /lab/knobs carries marketGapFilterPct, exitPlanSessions and yieldSleeveFloatPct, each saying it is OFF by default, what 0 and blank mean, its env arm, its pre-registered value and that it reaches an account only through a confirmed Apply; every key the kernel's normalizeConfig emits is documented, so a future kernel knob without a row goes red; the Knobs & formulas panel paints the three; the Lab editor paints three blank fields (a drafted config fills them) and Save posts blank as null (inherit), 0 as an explicit off and a number as the arm, stored exactly as the kernel normalizes it (plan life clamped to 252).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createContext, Script } from 'node:vm';
import { createTradingStrategyLabRoutes } from '../src-routes/trading-strategy-lab-routes';
import { normalizeConfig } from '@/app/trading-strategy-lab-sim';
import type { AppContext } from '@/app/composition/app-context';

const SUB = 'k-lab-parity-knobs-spec-sub';
const PARITY = ['marketGapFilterPct', 'exitPlanSessions', 'yieldSleeveFloatPct'] as const;
const ui = (f: string): string => readFileSync(path.resolve(__dirname, '..', 'tools/ui', f), 'utf8');

/* ── the recording pool ─────────────────────────────────────────────────────── */
type Row = Record<string, unknown>;
let inserted: Row[] = [];
const query = async (raw: string, args: unknown[] = []) => {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (/^INSERT INTO trading_strategies/.test(text)) {
    const row = {
      id: `11111111-2222-4333-8444-5555555501${String(inserted.length).padStart(2, '0')}`, user_sub: args[0], name: args[1],
      description: args[2], config: JSON.parse(String(args[3])), status: 'candidate', baseline_run_id: null, created_at: '', updated_at: '',
    };
    inserted.push(row);
    return { rows: [row] };
  }
  return { rows: [] };
};
const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as AppContext['pool'];
const router = createTradingStrategyLabRoutes({ pool } as unknown as AppContext);

/* ── one request through the REAL router ────────────────────────────────────── */
interface Answer { status: number; body: Record<string, unknown> }

/**
 * @description Drive one request through the lab router this package builds.
 * @param method - HTTP method.
 * @param url - Path under /api/trading/lab, query string included.
 * @param body - JSON body.
 * @returns The status and JSON payload the handler produced.
 */
async function call(method: string, url: string, body: Record<string, unknown> = {}): Promise<Answer> {
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
      oidc: { isAuthenticated: () => true, user: { sub: SUB } },
    };
    (router as unknown as (a: unknown, b: unknown, n: (e?: unknown) => void) => void)(
      req, res, (err?: unknown) => reject(err instanceof Error ? err : new Error(`no route matched ${method} ${pathname}`)),
    );
  });
  return { status, body: out };
}

/* ── the surface: view-strategies.js over app.js's real api() ───────────────── */
type El = { id: string; value: string; innerHTML: string; textContent: string; className: string; onclick: unknown; disabled: boolean };
type Surface = Record<string, unknown> & {
  renderLabForm: (v?: unknown) => void; saveLabStrategy: () => Promise<void>; loadLabKnobs: () => Promise<void>;
};

/** The shipped api() and jbody from app.js, sliced verbatim so this spec drives the real request helper. */
function appApiSource(): string {
  const app = ui('app.js');
  const jbody = app.slice(app.indexOf('const jbody = '), app.indexOf('\n', app.indexOf('const jbody = ')) + 1);
  const start = app.indexOf('async function api(');
  return jbody + app.slice(start, app.indexOf('\n}\n', start) + 3);
}

/**
 * @description Mount the ids a painted HTML string declares as element stubs, with the value an input
 * carries in its value attribute or a select's selected (else first) option.
 * @param els - The element map the fake $ reads.
 * @param html - The painted HTML.
 */
function mount(els: Map<string, El>, html: string): void {
  const el = (id: string, value: string): El => ({ id, value, innerHTML: '', textContent: '', className: '', onclick: null, disabled: false });
  for (const m of html.matchAll(/<input id="([^"]+)"([^>]*)>/g)) els.set(m[1], el(m[1], /value="([^"]*)"/.exec(m[2])?.[1] ?? ''));
  for (const m of html.matchAll(/<select id="([^"]+)">([\s\S]*?)<\/select>/g)) {
    const opts = [...m[2].matchAll(/<option( selected)?>([^<]*)<\/option>/g)];
    els.set(m[1], el(m[1], (opts.find((o) => o[1]) ?? opts[0])?.[2] ?? ''));
  }
  for (const m of html.matchAll(/<(?:button|div)[^>]* id="([^"]+)"/g)) if (!els.has(m[1])) els.set(m[1], el(m[1], ''));
}

let els: Map<string, El>;
let sent: Array<{ method: string; url: string; body: Record<string, unknown> | null }>;
let surface: Surface;

beforeEach(() => {
  inserted = [];
  sent = [];
  els = new Map();
  for (const id of ['labForm', 'labFormMsg', 'labKnobs', 'labDraftText']) mount(els, `<div id="${id}"></div>`);
  const labForm = els.get('labForm')!;
  Object.defineProperty(labForm, 'innerHTML', { get() { return (this as { _h?: string })._h ?? ''; }, set(h: string) { (this as { _h?: string })._h = h; mount(els, h); } });
  const ctx: Record<string, unknown> = {
    window: {}, RENDER_TOKEN: 1, SUB_GEN: 1, BOOK: 'paper', MODE: 'paper', DISP: 'Paper',
    $: (id: string) => els.get(id) ?? null,
    esc: (s: unknown) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    stale: (t: number) => t !== (surface as { RENDER_TOKEN: number }).RENDER_TOKEN,
    tabGen: () => 1, tabStale: () => false,
    fetch: async (url: string, opts: { method?: string; body?: string } = {}) => {
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) as Record<string, unknown> : null;
      sent.push({ method, url, body });
      const answer = await call(method, url.replace(/^\/api\/trading\/lab/, ''), body ?? {});
      return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
    },
  };
  surface = createContext(ctx) as never;
  new Script(appApiSource()).runInContext(surface as never);
  new Script(ui('view-strategies.js')).runInContext(surface as never);
  // saveLabStrategy repaints the saved list after a save; that list is not what this spec is about.
  (surface as Record<string, unknown>).refreshLabList = () => undefined;
});

describe('GET /lab/knobs — the reference documents the three parity knobs', () => {
  it('each is OFF by default, says what 0 and blank mean, names its env arm and its pre-registered value, and reaches an account only through a confirmed Apply', async () => {
    const { status, body } = await call('GET', '/knobs');
    expect(status).toBe(200);
    const knobs = new Map((body.knobs as Array<{ key: string; what: string }>).map((k) => [k.key, k.what]));
    const expected: Record<string, string[]> = {
      marketGapFilterPct: ['TRADING_MARKET_GAP_FILTER=paper|live|both', 'TRADING_MARKET_GAP_PCT', 'pre-registered 1.0', 'fails open', 'protective exits'],
      exitPlanSessions: ['TRADING_EXIT_PLANS=paper|live|both', 'TRADING_EXIT_PLAN_SESSIONS', 'pre-registered 20', 'confirm-gated amend', '1-252'],
      yieldSleeveFloatPct: ['TRADING_YIELD_SLEEVE=paper|live|both', 'TRADING_YIELD_SLEEVE_FLOAT_PCT', 'pre-registered 5', 'sells the fund FIRST', 'SGOV'],
    };
    for (const key of PARITY) {
      const what = knobs.get(key);
      expect(what, `${key} is documented`).toBeTruthy();
      for (const phrase of ['OFF by default', '0 = off', 'blank = inherit', 'off unless armed', 'A Lab walk runs off unless set', 'Reaches an account only through a confirmed Apply', ...expected[key]]) {
        expect(what, `${key} must say "${phrase}"`).toContain(phrase);
      }
    }
  });

  it('every knob the kernel\'s StrategyConfig carries is documented, so a new kernel knob without a row goes red', async () => {
    const { body } = await call('GET', '/knobs');
    const rows = body.knobs as Array<{ key: string; what: string }>;
    const text = rows.map((k) => k.what).join(' ');
    const documented = new Set(rows.map((k) => k.key));
    for (const key of Object.keys(normalizeConfig({ kind: 'rotation' }))) {
      if (key === 'kind') continue; // the kinds list documents it
      expect(documented.has(key) || text.includes(key), `StrategyConfig.${key} has no row in KNOBS_REFERENCE`).toBe(true);
    }
    for (const key of PARITY) expect(Object.keys(normalizeConfig({ kind: 'rotation' }))).toContain(key);
  });

  it('the Knobs & formulas panel paints all three from the route', async () => {
    await surface.loadLabKnobs();
    const html = els.get('labKnobs')!.innerHTML;
    for (const key of PARITY) expect(html).toContain(key);
    expect(html).toContain('pre-registered 5');
    expect(sent.map((r) => `${r.method} ${r.url.split('?')[0]}`)).toEqual(['GET /api/trading/lab/knobs']);
  });
});

describe('the Strategy Lab editor — three knob rows, stored exactly as the kernel normalizes them', () => {
  const field = (id: string) => els.get(id)!;
  const fill = (values: Record<string, string>) => { for (const [id, v] of Object.entries(values)) field(id).value = v; };

  it('a new variation starts blank (inherit); a drafted config fills the rows', () => {
    surface.renderLabForm();
    const html = els.get('labForm')!.innerHTML;
    expect(html).toContain('<input id="lfGap" type="number" min="0" max="50" step="0.1" value="">');
    expect(html).toContain('<input id="lfPlan" type="number" min="0" max="252" step="1" value="">');
    expect(html).toContain('<input id="lfSleeve" type="number" min="0" max="95" step="0.5" value="">');
    expect(html).toContain('Market gap-down filter % (blank = inherit, 0 = off)');
    surface.renderLabForm({ name: 'drafted', description: '', config: normalizeConfig({ kind: 'rotation', marketGapFilterPct: 1.5, exitPlanSessions: 0, yieldSleeveFloatPct: 5 }) });
    expect([field('lfGap').value, field('lfPlan').value, field('lfSleeve').value]).toEqual(['1.5', '0', '5']);
  });

  it('Save posts blank as null, 0 as an explicit off and a number as the arm, and the route stores what the kernel normalizes', async () => {
    surface.renderLabForm();
    fill({ lfName: 'parity twin', lfGap: '', lfPlan: '0', lfSleeve: '7.5' });
    await surface.saveLabStrategy();
    expect(field('labFormMsg').textContent).toContain('Saved.');
    const post = sent.find((r) => r.method === 'POST')!;
    expect(post.url.split('?')[0]).toBe('/api/trading/lab/strategies');
    const config = post.body!.config as Record<string, unknown>;
    expect([config.marketGapFilterPct, config.exitPlanSessions, config.yieldSleeveFloatPct]).toEqual([null, 0, 7.5]);
    const stored = inserted[0].config as Record<string, unknown>;
    expect([stored.marketGapFilterPct, stored.exitPlanSessions, stored.yieldSleeveFloatPct]).toEqual([null, 0, 7.5]);
    expect(inserted[0].user_sub).toBe(SUB);
  });

  it('a value past the kernel\'s bound is clamped by the kernel, not by the page', async () => {
    surface.renderLabForm();
    fill({ lfName: 'long plans', lfGap: '1.5', lfPlan: '400', lfSleeve: '' });
    await surface.saveLabStrategy();
    const post = sent.find((r) => r.method === 'POST')!;
    expect((post.body!.config as Record<string, unknown>).exitPlanSessions, 'the page sends what was typed').toBe(400);
    const stored = inserted[0].config as Record<string, unknown>;
    expect([stored.marketGapFilterPct, stored.exitPlanSessions, stored.yieldSleeveFloatPct]).toEqual([1.5, 252, null]);
  });
});
