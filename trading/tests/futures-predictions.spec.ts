/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise owner-authenticated receipt routes, actual console configuration and escaped ungraded evidence.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '@/app/composition-root';
import { createTradingAutopilotRoutes } from '../src-routes/trading-autopilot-routes';

const ledger = vi.hoisted(() => ({ list: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/app/trading-futures-prediction-ledger', () => ({ listFuturesPredictions: ledger.list, readFuturesPredictionSnapshot: ledger.snapshot }));
afterEach(() => vi.resetAllMocks());
const id = 'de7239ad-4a97-40ed-9d93-1a6bf1844c52';
const source = (name: string) => readFileSync(resolve(__dirname, '../tools/ui', name), 'utf8');
async function request(url: string, sub?: string): Promise<{ status: number; body: any }> {
  const router = createTradingAutopilotRoutes({ pool: {} } as AppContext);
  return new Promise((done, reject) => {
    let status = 200;
    const res = { status(value: number) { status = value; return res; }, json(body: any) { done({ status, body }); return res; } };
    (router as any)({ method: 'GET', url, originalUrl: url, baseUrl: '', headers: {}, get: () => undefined,
      query: { ownerSub: 'forged' }, oidc: { user: sub ? { sub } : undefined } }, res, reject);
  });
}
function ui() {
  const fields: Record<string, any> = {};
  let gone = false;
  const api = vi.fn();
  const context = createContext({ $: (name: string) => fields[name] ||= { value: '', innerHTML: '', textContent: '', contains: () => true }, api,
    esc: (value: unknown) => String(value ?? '').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    RENDER_TOKEN: 1, tabGen: () => 1, stale: () => gone, tabStale: () => gone, encodeURIComponent });
  runInContext(source('view-futures-predictions.js'), context);
  return { fields, context, api, leave: () => { gone = true; } };
}

describe('Futures forward console boundary', () => {
  it('refuses anonymous access and derives ownership from the authenticated caller, not the query', async () => {
    expect((await request('/futures/predictions')).status).toBe(401);
    expect((await request('/futures/predictions/' + id)).status).toBe(401);
    expect(ledger.list).not.toHaveBeenCalled(); expect(ledger.snapshot).not.toHaveBeenCalled();
    ledger.list.mockResolvedValue([]);
    expect((await request('/futures/predictions', 'actual-owner')).body).toEqual({ predictions: [] });
    expect(ledger.list.mock.calls[0][1]).toBe('actual-owner');
    ledger.snapshot.mockResolvedValue(null);
    expect((await request('/futures/predictions/' + id, 'actual-owner')).status).toBe(404);
    expect(ledger.snapshot.mock.calls[0].slice(1)).toEqual(['actual-owner', id]);
    expect((await request('/futures/predictions/not-an-id', 'actual-owner')).status).toBe(400);
  });
  it('does not expose filesystem or database details on a missing migration', async () => {
    ledger.list.mockRejectedValue(new Error('/private/archive'));
    expect(await request('/futures/predictions', 'owner')).toEqual({ status: 503, body: { error: 'futures_predictions_unavailable' } });
    ledger.snapshot.mockResolvedValue({ model: 'locked-strategy-bias-v1' });
    expect((await request('/futures/predictions/' + id, 'owner')).body.snapshot.model).toBe('locked-strategy-bias-v1');
  });
  it('round-trips every console control and does not invent opt-in or archive clock for old schedules', () => {
    const { context, fields, api } = ui();
    const fill = context.fillFuturesPredictionForm as any, read = context.futuresPredictionForm as any;
    fill(undefined);
    expect(read()).toEqual({ enabled: false, contracts: {}, sourceTimeZone: '', horizonHours: 24, maxSourceAgeHours: 36, gradingToleranceHours: 24, historyBars: 512 });
    const value = { enabled: true, contracts: { ES: 'ESZ26' }, sourceTimeZone: 'America/Chicago', horizonHours: 12, maxSourceAgeHours: 8, gradingToleranceHours: 6, historyBars: 1024 };
    fill(value); expect(read()).toEqual(value); expect(api).not.toHaveBeenCalled();
    fields.futPredContracts.value = '{'; expect(read).toThrow();
    const html = (context.futuresPredictionControls as any)();
    for (const field of Object.keys(fields)) expect(html).toContain('id="' + field + '"');
  });
  it('renders withheld and graded receipts distinctly, escapes evidence and fetches inputs only on demand', async () => {
    const { context, api, fields } = ui();
    api.mockResolvedValue({ predictions: [{ predictionId: id, contract: '<img>', status: 'withheld', reason: '<script>', issuedAt: '2026-09-25T00:00:00Z', checkedAt: '2026-09-25T00:00:00Z' }] });
    await (context.loadFuturesPredictions as any)();
    expect(fields.futPredictions.innerHTML).toContain('unscored'); expect(fields.futPredictions.innerHTML).toContain('&lt;script>');
    expect(fields.futPredictions.innerHTML).not.toContain('<img>'); expect(api).toHaveBeenCalledTimes(1);
    api.mockResolvedValue({ snapshot: { chart: [{ c: 5000 }] } });
    const button = { disabled: false };
    await (context.loadFuturesPredictionEvidence as any)(id, button);
    expect(fields['futEvidence_' + id].textContent).toContain('5000'); expect(button.disabled).toBe(false);
    const card = (context.futuresPredictionCard as any)({ status: 'graded', contract: 'ESZ26', issuedAt: '2026-09-25T00:00:00Z', outcome: { signedTicks: 0, correct: null } });
    expect(card).toContain('flat outcome (not a win)');
  });
  it('does not repaint another tab when slow ledger or evidence requests complete', async () => {
    for (const method of ['loadFuturesPredictions', 'loadFuturesPredictionEvidence']) {
      const { context, fields, api, leave } = ui();
      let finish!: (value: unknown) => void; api.mockReturnValue(new Promise(resolveResult => { finish = resolveResult; }));
      const pending = (context[method] as any)(id, { disabled: false });
      leave(); finish({ predictions: [], snapshot: {} }); await pending;
      expect(fields.futPredictions?.innerHTML ?? '').toBe(''); expect(fields['futEvidence_' + id]).toBeUndefined();
    }
  });
});
