/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard signed-in owner capture settings, first-capture schedule admission, stop semantics and console request round-trip.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '@/app/composition-root';
import { createFuturesSchwabCaptureRoutes } from '../src-routes/trading-futures-schwab-capture-routes';

const service = vi.hoisted(() => ({ token: vi.fn(), capture: vi.fn(), backfill: vi.fn(), plan: vi.fn(), coverage: vi.fn(), health: vi.fn(), list: vi.fn(), create: vi.fn(), remove: vi.fn() }));
vi.mock('@/app/routes/connectors-routes', () => ({ getValidAccessToken: service.token }));
vi.mock('@/app/trading-futures-schwab-capture', () => ({
  captureSchwabFuturesBars: service.capture, listSchwabFuturesCoverage: service.coverage, listSchwabFuturesHealth: service.health,
  backfillSchwabCurrentFuturesBars: service.backfill, planSchwabCurrentBackfill: service.plan,
  schwabFuturesCaptureTaskType: (sub: string) => `trading-futures-schwab-capture:${sub}`,
  SCHWAB_FUTURES_CAPTURE_CRON: '7 * * * *',
}));
vi.mock('@/app/trading-schedule-dispatch', () => ({ getTradingScheduleService: () => ({
  listSchedules: service.list, createSchedule: service.create, deleteSchedule: service.remove,
}) }));
beforeEach(() => {
  vi.stubEnv('OSHAL_OPERATOR_SUBS', 'capture-owner');
  service.token.mockResolvedValue('private-token');
  service.capture.mockResolvedValue({ series: [{ symbol: 'ESZ26', received: 2, inserted: 2 }] });
  service.coverage.mockResolvedValue([]);
  service.health.mockResolvedValue([]);
  service.plan.mockReturnValue({ roots: ['ES'], fromDate: '2026-09-23', throughDate: '2026-09-24',
    contracts: [{ root: 'ES', symbol: 'ESZ26' }], requestCount: 1, fingerprint: 'preview-fingerprint' });
  service.backfill.mockResolvedValue({ series: [{ symbol: 'ESZ26', received: 2, inserted: 2 }] });
  service.list.mockResolvedValue([]);
  service.create.mockResolvedValue({ cron: '7 * * * *', nextRunAt: 'soon', status: 'active' });
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

async function request(method: string, url: string, sub?: string, body?: unknown): Promise<{ status: number; body: any }> {
  const router = createFuturesSchwabCaptureRoutes({ pool: {} } as AppContext);
  return new Promise((done, reject) => {
    let status = 200;
    const res = { status(value: number) { status = value; return res; }, setHeader() { return res; },
      json(value: any) { done({ status, body: value }); return res; } };
    (router as any)({ method, url, originalUrl: url, baseUrl: '', headers: {}, get: () => undefined,
      body, oidc: { user: sub ? { sub } : undefined } }, res, reject);
  });
}

describe('Schwab Futures capture control', () => {
  it('requires an authenticated operator and forbids arbitrary source settings', async () => {
    expect((await request('POST', '/enable')).status).toBe(401);
    expect((await request('POST', '/enable', 'other')).status).toBe(403);
    expect((await request('POST', '/enable', 'capture-owner', { roots: ['NQ'] })).status).toBe(400);
    expect(service.token).not.toHaveBeenCalled();
  });
  it('captures before enabling an owner-bound, read-only schedule', async () => {
    const result = await request('POST', '/enable', 'capture-owner', { roots: ['ES', 'CL'], cadence: 'half-hour', token: 'forged' });
    expect(result.status).toBe(200);
    expect(service.token).toHaveBeenCalledWith({}, 'capture-owner', 'schwab');
    expect(service.capture).toHaveBeenCalledWith({}, 'capture-owner', 'private-token', ['ES', 'CL']);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'trading-futures-schwab-capture:capture-owner',
      schedule: '7,37 * * * *', ownerSub: 'capture-owner', taskData: expect.objectContaining({ mode: 'paper', roots: ['ES', 'CL'] }) }));
    expect(JSON.stringify(result.body)).not.toContain('private-token');
    expect(JSON.stringify(result.body)).not.toContain('forged');
  });
  it('does not schedule if provider capture fails and stops only this owner schedule', async () => {
    service.capture.mockRejectedValueOnce(new Error('private-token provider failure'));
    expect((await request('POST', '/enable', 'capture-owner')).body).toEqual({ error: 'schwab_capture_failed' });
    expect(service.create).not.toHaveBeenCalled();
    service.list.mockResolvedValue([{ id: 'owned', ownerSub: 'capture-owner', taskType: 'trading-futures-schwab-capture:capture-owner' },
      { id: 'other', ownerSub: 'other', taskType: 'trading-futures-schwab-capture:other' }]);
    service.remove.mockResolvedValue(true);
    expect((await request('DELETE', '/', 'capture-owner')).body).toEqual({ stopped: true, retainedBars: true });
    expect(service.remove).toHaveBeenCalledWith('owned');
  });
  it('refuses repeated enable so stop cannot leave a duplicate collector behind', async () => {
    service.list.mockResolvedValue([{ id: 'already', ownerSub: 'capture-owner', taskType: 'trading-futures-schwab-capture:capture-owner' }]);
    expect((await request('POST', '/enable', 'capture-owner')).body).toEqual({ error: 'schwab_capture_already_enabled' });
    expect(service.capture).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });
  it('returns owner-scoped aggregate health without exposing bars or a bearer', async () => {
    service.health.mockResolvedValue([{ root: 'ES', symbol: 'ESZ26', expected: 10, received: 9, missing: 1, trailingMissing: 1 }]);
    const result = await request('GET', '/', 'capture-owner');
    expect(result.status).toBe(200);
    expect(service.health).toHaveBeenCalledWith({}, 'capture-owner');
    expect(result.body.health[0]).toMatchObject({ symbol: 'ESZ26', missing: 1 });
    expect(JSON.stringify(result.body)).not.toContain('private-token');
  });
  it('previews without a broker call and requires the exact preview before private catch-up', async () => {
    const form = { roots: ['ES'], fromDate: '2026-09-23', throughDate: '2026-09-24' };
    expect((await request('POST', '/backfill/preview', 'other', form)).status).toBe(403);
    const preview = await request('POST', '/backfill/preview', 'capture-owner', form);
    expect(preview.body.plan.contracts[0].symbol).toBe('ESZ26');
    expect(service.token).not.toHaveBeenCalled();
    expect((await request('POST', '/backfill', 'capture-owner', { ...form, confirmation: 'forged' })).body).toEqual({ error: 'backfill_preview_changed' });
    expect(service.token).not.toHaveBeenCalled();
    const result = await request('POST', '/backfill', 'capture-owner', { ...form, confirmation: preview.body.plan.fingerprint });
    expect(result.status).toBe(200);
    expect(service.token).toHaveBeenCalledWith({}, 'capture-owner', 'schwab');
    expect(service.backfill).toHaveBeenCalledWith({}, 'capture-owner', 'private-token', ['ES'], form.fromDate, form.throughDate,
      preview.body.plan.fingerprint, expect.any(Function), expect.any(Number));
    expect(JSON.stringify(result.body)).not.toContain('private-token');
  });
});

describe('Schwab Futures capture console', () => {
  it('sends bounded operator settings and renders coverage as inert text', async () => {
    const fields: Record<string, any> = { futSchwabRoots: { value: 'ES,CL' }, futSchwabCadence: { value: 'hourly' } };
    const api = vi.fn().mockResolvedValueOnce({ receipt: { series: [{ symbol: 'ESZ26', inserted: 2, received: 2 }] } })
      .mockResolvedValueOnce({ enabled: true, coverage: [{ symbol: '<CL>', bars: 1, first: 'start', last: 'end' }],
        health: [{ symbol: 'ESZ26', state: 'missing', received: 9, expected: 10, missing: 1, trailingMissing: 1,
          gapCount: 1, outsideSession: 0, latestExpected: '2026-09-25T20:00:00.000Z' }] });
    const context = createContext({ $: (name: string) => fields[name] ||= { textContent: '', disabled: false }, api,
      jbody: (method: string, value: unknown) => ({ method, body: JSON.stringify(value) }),
      RENDER_TOKEN: 1, tabGen: () => 1, stale: () => false, tabStale: () => false });
    runInContext(readFileSync(resolve(__dirname, '../tools/ui/view-futures-loop.js'), 'utf8'), context);
    const button = { disabled: false };
    await (context.schwabCaptureAction as any)('enable', button);
    expect(api).toHaveBeenNthCalledWith(1, '/autopilot/futures/sources/schwab/capture/enable',
      { method: 'POST', body: JSON.stringify({ roots: ['ES', 'CL'], cadence: 'hourly' }) });
    expect(fields.futSchwabCaptureStatus.textContent).toContain('<CL>: 1 closed bars');
    expect(fields.futSchwabCaptureStatus.textContent).toContain('ESZ26: session-model 9/10 buckets');
    expect(button.disabled).toBe(false);
  });
  it('previews the bounded current-contract request and sends its fingerprint only on explicit fetch', async () => {
    const fields: Record<string, any> = { futSchwabRoots: { value: 'ES' }, futSchwabBackfillFrom: { value: '2026-09-23' },
      futSchwabBackfillThrough: { value: '2026-09-24' }, futSchwabBackfillRun: { disabled: true } };
    const plan = { fromDate: '2026-09-23', throughDate: '2026-09-24', contracts: [{ symbol: 'ESZ26' }],
      requestCount: 1, fingerprint: 'preview-fingerprint' };
    const api = vi.fn().mockResolvedValueOnce({ plan })
      .mockResolvedValueOnce({ receipt: { series: [{ symbol: 'ESZ26', received: 2, inserted: 2 }] } })
      .mockResolvedValueOnce({ enabled: true, coverage: [] });
    const context = createContext({ $: (name: string) => fields[name] ||= { textContent: '', disabled: false }, api,
      jbody: (method: string, value: unknown) => ({ method, body: JSON.stringify(value) }),
      RENDER_TOKEN: 1, tabGen: () => 1, stale: () => false, tabStale: () => false });
    runInContext(readFileSync(resolve(__dirname, '../tools/ui/view-futures-loop.js'), 'utf8'), context);
    await (context.previewSchwabBackfill as any)({ disabled: false });
    expect(fields.futSchwabBackfillStatus.textContent).toContain('at most 1 Schwab requests');
    expect(fields.futSchwabBackfillRun.disabled).toBe(false);
    await (context.runSchwabBackfill as any)(fields.futSchwabBackfillRun);
    expect(api).toHaveBeenNthCalledWith(2, '/autopilot/futures/sources/schwab/capture/backfill', {
      method: 'POST', body: JSON.stringify({ roots: ['ES'], fromDate: '2026-09-23', throughDate: '2026-09-24', confirmation: 'preview-fingerprint' }),
    });
    expect(fields.futSchwabBackfillStatus.textContent).toContain('ESZ26 +2 new');
    expect(fields.futSchwabBackfillRun.disabled).toBe(true);
    expect(readFileSync(resolve(__dirname, '../tools/ui/view-strategies.js'), 'utf8')).toContain('futSchwabBackfillPreview');
  });
});
