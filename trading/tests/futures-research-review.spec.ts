/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise interactive review auth, exact caller binding, safe proposal staging and stale-view refusal.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Render deficient and unassessed samples honestly and preserve console quality gates in staged proposals.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Keep queued ticket state escaped and distinct from completed reviews.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Keep review guards crossing the decomposed Futures console modules.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Exercise frozen forward cohort rendering, missing-evidence honesty, skipped review spending and escaped citations.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Read the shipped manifest through the actual kernel validator and runtime mapper so invalid inline declarations cannot pass as YAML-only fixtures.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Render real loop handlers with escaped computation receipts and honest legacy states.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Render all notification receipt states without implying delivery, recomputation or writes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import type { AppContext } from '@/app/composition-root';
import { createTradingAutopilotRoutes } from '../src-routes/trading-autopilot-routes';
import { readManifest } from '@/features/swarm-apps';
import { manifestBotDefinition } from '@/app/extensions/swarm/manifest-bot-definition';
import yaml from 'js-yaml';

const review = vi.hoisted(() => vi.fn());
vi.mock('@/app/trading-futures-research-review', () => ({ reviewFuturesResearchRun: review }));
const source = (file: string): string => readFileSync(resolve(__dirname, '..', file), 'utf8');
const oldOperator = process.env.OSHAL_OPERATOR_SUBS;
afterEach(() => { vi.resetAllMocks(); if (oldOperator === undefined) delete process.env.OSHAL_OPERATOR_SUBS; else process.env.OSHAL_OPERATOR_SUBS = oldOperator; });

async function request(sub?: string): Promise<{ status: number; payload: any }> {
  const ctx = { pool: {} } as AppContext;
  const router = createTradingAutopilotRoutes(ctx);
  return new Promise((done, reject) => {
    let status = 200;
    const res = { status(code: number) { status = code; return res; }, json(payload: any) { done({ status, payload }); return res; } };
    const url = '/futures/runs/57c84aeb-6e2d-48d8-abd2-501d8de91e27/review';
    (router as any)({ method: 'POST', url, originalUrl: url, baseUrl: '', body: { ownerSub: 'forged', markets: ['forged'] },
      headers: {}, get: () => undefined, oidc: { user: sub ? { sub } : undefined } }, res, reject);
  });
}
function ui() {
  const fields: Record<string, any> = {};
  const api = vi.fn(), fill = vi.fn(); let gone = false;
  const context = createContext({
    $: (id: string) => fields[id] ||= { innerHTML: '', textContent: '', className: '', contains: () => true },
    esc: (v: unknown) => String(v ?? '').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    api, fillFuturesForm: fill, loadFuturesResearch: vi.fn(), RENDER_TOKEN: 1, tabGen: () => 1,
    stale: () => gone, tabStale: () => gone, encodeURIComponent,
  });
  runInContext(source('tools/ui/view-futures-review.js'), context);
  return { context, fields, api, fill, leave: () => { gone = true; } };
}

describe('Futures review console', () => {
  it('refuses anonymous and ordinary callers before review and ignores forged body ownership/evidence', async () => {
    process.env.OSHAL_OPERATOR_SUBS = 'real-owner';
    expect((await request()).status).toBe(401);
    expect((await request('ordinary')).status).toBe(403);
    expect(review).not.toHaveBeenCalled();
    review.mockResolvedValue({ status: 'completed' });
    expect((await request('real-owner')).payload.ok).toBe(true);
    expect(review.mock.calls[0].slice(1)).toEqual(['real-owner', '57c84aeb-6e2d-48d8-abd2-501d8de91e27']);
  });
  it('preserves owned-run denial and concurrency status without leaking arbitrary internal errors', async () => {
    process.env.OSHAL_OPERATOR_SUBS = 'real-owner';
    for (const code of [404, 409]) {
      review.mockRejectedValue(Object.assign(new Error('refused'), { statusCode: code }));
      expect((await request('real-owner')).status).toBe(code);
    }
    review.mockRejectedValue(new Error('private source detail'));
    expect(await request('real-owner')).toEqual({ status: 500, payload: { error: 'futures_review_unavailable' } });
  });
  it('stages the reviewed envelope plus validated grid without saving, running or placing an order', () => {
    const { context, fields, api, fill } = ui();
    const run = { runId: 'fixture', config: { roots: ['ES'], source: 'kibot-file', quality: { maxSourceLagDays: 3, minOosTradesPerWindow: 12 } }, review: { result: { nextStudy: { stageGrids: { Entry: {} } } } } };
    (context.wireFuturesReviews as any)([run]);
    fields.futRuns.onclick({ target: { closest: () => ({ dataset: { futuresProposal: 'fixture' } }) } });
    expect(fill).toHaveBeenCalledWith({ ...run.config, stageGrids: { Entry: {} } });
    expect(api).not.toHaveBeenCalled();
    expect(fields.futMsg.textContent).toContain('not saved or run');
  });
  it('escapes review text and does not show a review action for incomplete studies', () => {
    const { context } = ui();
    expect((context.futuresReviewCard as any)({ status: 'running' })).toBe('');
    const html = (context.futuresReviewCard as any)({ status: 'completed', runId: 'fixture', review: { status: 'completed', result: { summary: '<script>', limitations: ['<img>'], nextStudy: null } } });
    expect(html).toContain('&lt;script>'); expect(html).not.toContain('<script>');
    expect(html).toContain('not a forward prediction');
  });
  it('does not repaint another tab when a slow review completes', async () => {
    const { context, fields, api, leave } = ui();
    let finish!: (value: unknown) => void;
    api.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const button = { disabled: false };
    const pending = (context.requestFuturesReview as any)('fixture', button);
    expect(button.disabled).toBe(true);
    leave(); fields.futMsg.textContent = 'new tab'; finish({ ok: true }); await pending;
    expect(fields.futMsg.textContent).toBe('new tab');
    expect(context.loadFuturesResearch).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });
  it('renders legacy and deficient samples without disguising either as passing evidence', () => {
    const { context } = ui();
    const render = context.futuresReviewCard as (run: unknown) => string;
    expect(render({ status: 'completed', markets: [{ root: 'ES' }] })).toContain('not assessed');
    const quality = { sampleStatus: 'insufficient', minOosTradesPerWindow: 12, chartLagDays: 1, ltfLagDays: 2,
      referenceDate: '2026-09-24', maxSourceLagDays: 3, lowTradeWindows: [{ oosStart: '<img>', oosEnd: '2026-09-01', trades: 0 }] };
    const html = render({ status: 'insufficient_sample', runId: 'low', markets: [{ root: '<ES>', quality }] });
    expect(html).toContain('INSUFFICIENT OOS SAMPLE');
    expect(html).toContain('floor 12 trades/window');
    expect(html).toContain('1/2 days against 2026-09-24 (limit 3)');
    expect(html).toContain('&lt;img>'); expect(html).not.toContain('<img>');
    expect(html).toContain('&lt;ES>'); expect(html).toContain('Review this study');
    const passing = render({ status: 'completed', markets: [{ root: 'ES', quality: { ...quality, sampleStatus: 'meets_configured_floor', lowTradeWindows: [] } }] });
    expect(passing).toContain('not statistical confidence');
    expect(passing).not.toContain('INSUFFICIENT');
  });
  it('shows failed source runs as uncomputed, not a zero-dollar OOS result', async () => {
    const { context, fields, api } = ui();
    runInContext(source('tools/ui/view-strategies.js'), context);
    runInContext(source('tools/ui/view-futures-loop.js'), context);
    runInContext(source('tools/ui/view-futures-predictions.js'), context);
    context.fmtDate = (value: string) => value;
    context.money = vi.fn(() => '$0');
    api.mockResolvedValue({ runs: [{ runId: 'stale', status: 'failed', createdAt: '2026-09-24', error: 'stale source', markets: [] }] });
    await (context.loadFuturesResearch as () => Promise<void>)();
    expect(fields.futRuns.innerHTML).toContain('OOS not computed');
    expect(fields.futRuns.innerHTML).toContain('stale source');
    expect(context.money).not.toHaveBeenCalled();
  });
  it('loads the actual package through the kernel and registers the tool-less reviewer inline', () => {
    const manifest = readManifest(resolve(__dirname, '../oshal-app.yaml'));
    const bot = manifest.bots!.find(item => item.name === 'futures-research-analyst')!;
    const persona = yaml.load(source(bot.persona!)) as any;
    expect(persona.agent_id).toBe(bot.agentId);
    expect(persona.allowed_tools).toEqual([]);
    expect(bot.container).toBeUndefined();
    const runtime = manifestBotDefinition(bot);
    expect(runtime).toMatchObject({ agentId: bot.agentId, container: 'oshal-api', port: 3010 });
    expect(runtime.requiresOwnNode).not.toBe(true);
    expect(bot.accessRoles).toEqual(['operator', 'swarm']);
    expect(source('tools/trading.html')).toContain('/api/trading/ui/view-futures-review.js');
    expect(source('tools/ui/view-futures-loop.js')).toContain('wireFuturesReviews(rows)');
  });
  it.each([
    ['disabled', 'off for this run'], ['ready', 'pending attempt (not delivered)'],
    ['claimed', 'attempt claimed; delivery unconfirmed'], ['delivered', 'delivered'],
    ['skipped', 'skipped (not delivered)'], ['failed', 'send failed; not confirmed'],
    ['unknown', 'delivery unknown; no automatic retry'],
  ])('renders the %s source receipt through the actual loop handler with escaped details', async (status, label) => {
    const { context, fields, api } = ui();
    runInContext(source('tools/ui/view-futures-loop.js'), context);
    context.fmtDate = (value: string) => value;
    context.money = vi.fn();
    const sourceAlert = { status, channel: '<channel>', fallbackFrom: '<fallback>', reason: '<img onerror="unsafe">', issue: { root: '<ES>', code: 'stale' } };
    api.mockResolvedValue({ runs: [{ runId: 'fixture', status: 'failed', createdAt: 'fixture', markets: [], sourceAlert }] });
    await (context.loadFuturesResearch as () => Promise<void>)();
    const html = fields.futRuns.innerHTML;
    expect(html).toContain('Source notification: ' + label);
    expect(html).toContain('channel &lt;channel>'); expect(html).toContain('fallback from &lt;fallback>');
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;ES>');
    expect(html).toContain('Source notification receipt'); expect(html).toContain('OOS not computed');
    expect(context.money).not.toHaveBeenCalled();
    expect(api.mock.calls).toEqual([['/autopilot/futures']]);
  });
  it('distinguishes computed, reused and unassessed optimizer evidence without changing research results', async () => {
    const { context, fields, api } = ui();
    runInContext(source('tools/ui/view-futures-loop.js'), context);
    context.fmtDate = (value: string) => value;
    context.money = () => '-$10';
    const markets = [
      { root: 'ES', outOfSampleTrades: 0, computation: { status: 'computed', inputFingerprint: 'input', reportFingerprint: 'report' } },
      { root: 'CL', outOfSampleTrades: 0, computation: { status: 'reused', reusedFromRunId: '<img onerror="unsafe">' } },
      { root: 'NQ', outOfSampleTrades: 0 },
    ];
    api.mockResolvedValue({ runs: [{ runId: 'fixture', status: 'unchanged', createdAt: '2026-09-25', markets }] });
    await (context.loadFuturesResearch as () => Promise<void>)();
    const html = fields.futRuns.innerHTML;
    expect(html).toContain('ES optimizer: computed this run');
    expect(html).toContain('CL optimizer: report reused from run &lt;img');
    expect(html).not.toContain('<img');
    expect(html).toContain('NQ optimizer: not assessed');
    expect(html).toContain('unchanged OOS evidence');
    expect(html).toContain('inputFingerprint');
    expect(html).toContain('reportFingerprint');
    expect(html).toContain('-$10');
    expect(api.mock.calls).toEqual([['/autopilot/futures']]);
  });
  it('renders queued review identity safely without showing a result or proposal', () => {
    const { context } = ui();
    const html = (context.futuresReviewCard as (run: unknown) => string)({ status: 'completed', runId: 'fixture',
      review: { status: 'queued', ticketId: '<img onerror="unsafe">' } });
    expect(html).toContain('Research review: queued');
    expect(html).toContain('Workflow ticket: &lt;img');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('Load proposed study');
    expect(html).toContain('1 hour');
  });
  it('renders bounded forward cohorts and assessments without pooling them into accuracy claims', () => {
    const { context } = ui();
    const counts = { graded: 3, matched: 1, missed: 1, flat: 1, pending: 2, unavailable: 1, withheld: 1, abstained: 1 };
    const html = (context.futuresReviewCard as (run: unknown) => string)({ status: 'completed', runId: 'fixture', review: {
      status: 'completed', forwardContext: { availability: 'available', capturedAt: '<date>', roots: ['ES'], limitPerStateGroup: 25,
        available: { graded: 30, other: 50 }, counts, fingerprint: '<fingerprint>', receipts: Array(8).fill({ predictionId: '<receipt>' }),
        cohorts: [{ root: 'ES', contract: '<contract>', model: '<model>', studyFingerprint: '<study>', horizonHours: 24, counts }] },
      result: { summary: 'Historical summary', limitations: ['Fixture only'], nextStudy: null,
        forwardAssessment: { contextFingerprint: '<fingerprint>', summary: '<script>forward analysis</script>' } },
    } });
    expect(html).toContain('Latest 3 of 30 graded and 5 of 50 other');
    expect(html).toContain('3 graded: 1 matched / 1 missed / 1 flat');
    expect(html).toContain('2 pending / 1 unavailable / 1 withheld / 1 abstained');
    expect(html).toContain('not independent');
    expect(html).toContain('not trade P&amp;L');
    for (const field of ['date', 'contract', 'model', 'study', 'fingerprint', 'receipt', 'script']) {
      expect(html).toContain('&lt;' + field + '>'); expect(html).not.toContain('<' + field + '>');
    }
    expect(html).not.toContain('data-futures-review');
    expect(html).not.toContain('Load proposed study');
  });
  it('distinguishes missing schema, empty samples, legacy reviews and an explicit review of skipped evidence', () => {
    const { context, fields, api } = ui(), render = context.futuresReviewCard as (run: unknown) => string;
    const run = { status: 'completed', runId: 'fixture' };
    expect(render({ ...run, review: { status: 'completed' } })).toContain('not assessed');
    expect(render({ ...run, review: { forwardContext: { availability: 'schema_missing' } } })).toContain('Not a zero-success sample');
    const skipped = { ...run, review: { status: 'skipped', skipReason: '<no provider request>', forwardContext: { availability: 'available',
      capturedAt: 'fixture', roots: ['ES'], counts: { graded: 0 }, available: { graded: 0, other: 0 }, receipts: [], limitPerStateGroup: 25 } } };
    const html = render(skipped);
    expect(html).toContain('No forward receipts');
    expect(html).toContain('Review explicitly (uses provider)');
    expect(html).toContain('&lt;no provider request>');
    (context.wireFuturesReviews as (rows: unknown[]) => void)([skipped]);
    expect(api).not.toHaveBeenCalled();
    api.mockResolvedValue({ ok: true });
    fields.futRuns.onclick({ target: { closest: () => ({ dataset: { futuresReview: 'fixture' } }) } });
    expect(api).toHaveBeenCalledWith('/autopilot/futures/runs/fixture/review', { method: 'POST' });
  });
});
