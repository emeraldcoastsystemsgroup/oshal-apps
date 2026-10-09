/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard operator-only owner-token probe route and real console-script result rendering.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '@/app/composition-root';
import { createTradingAutopilotRoutes } from '../src-routes/trading-autopilot-routes';

const service = vi.hoisted(() => ({ token: vi.fn(), probe: vi.fn() }));
vi.mock('@/app/routes/connectors-routes', () => ({ getValidAccessToken: service.token }));
vi.mock('@/app/trading-futures-schwab-probe', () => ({ probeSchwabFuturesBars: service.probe }));
beforeEach(() => vi.stubEnv('OSHAL_OPERATOR_SUBS', 'probe-owner'));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

async function request(sub?: string, pool = true): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const router = createTradingAutopilotRoutes({ pool: pool ? {} : undefined } as AppContext);
  const url = '/futures/sources/schwab/probe', headers: Record<string, string> = {};
  return new Promise((done, reject) => {
    let status = 200;
    const res = { status(value: number) { status = value; return res; },
      setHeader(name: string, value: string) { headers[name] = value; return res; },
      json(body: any) { done({ status, body, headers }); return res; } };
    (router as any)({ method: 'GET', url, originalUrl: url, baseUrl: '', headers: {}, get: () => undefined,
      query: { ownerSub: 'forged', token: 'forged' }, oidc: { user: sub ? { sub } : undefined } }, res, reject);
  });
}

describe('Schwab Futures probe boundary', () => {
  it('requires a signed-in operator with a connected token', async () => {
    expect((await request()).status).toBe(401);
    expect((await request('ordinary')).status).toBe(403);
    expect((await request('probe-owner', false)).status).toBe(503);
    expect(service.token).not.toHaveBeenCalled();
    service.token.mockResolvedValue(null);
    expect((await request('probe-owner')).body).toEqual({ error: 'schwab_connection_not_available' });
  });
  it('passes only the authenticated owner token and returns metadata without caching', async () => {
    service.token.mockResolvedValue('private-token');
    service.probe.mockResolvedValue({ source: 'schwab', roots: [] });
    const result = await request('probe-owner');
    expect(result.status).toBe(200);
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(service.token).toHaveBeenCalledWith({}, 'probe-owner', 'schwab');
    expect(service.probe).toHaveBeenCalledWith('private-token');
  });
  it('keeps provider failures and tokens out of the response', async () => {
    service.token.mockResolvedValue('private-token');
    service.probe.mockRejectedValue(new Error('provider body private-token'));
    expect((await request('probe-owner')).body).toEqual({ error: 'schwab_probe_unavailable' });
  });
});

describe('Schwab Futures console receipt', () => {
  it('shows quote and bar states separately as inert text', async () => {
    const fields: Record<string, any> = {}, api = vi.fn().mockResolvedValue({ roots: [{ root: '<ES>', datedContract: 'ESZ26',
      quote: { state: 'available' }, minute: { state: 'empty', bars: 0, volumeBars: 0 }, daily: { state: 'empty', bars: 0 }, forwardBarCandidate: false }], note: 'No source enabled.' });
    const context = createContext({ $: (name: string) => fields[name] ||= { textContent: '', disabled: false }, api,
      RENDER_TOKEN: 1, tabGen: () => 1, stale: () => false, tabStale: () => false });
    runInContext(readFileSync(resolve(__dirname, '../tools/ui/view-futures-loop.js'), 'utf8'), context);
    await (context.probeSchwabFuturesFromConsole as any)(fields.button ||= { disabled: false });
    expect(api).toHaveBeenCalledWith('/autopilot/futures/sources/schwab/probe');
    expect(fields.futSchwabProbeResult.textContent).toContain('quote available; 30-minute bars empty');
    expect(fields.futSchwabProbeResult.textContent).toContain('<ES>');
    expect(fields.button.disabled).toBe(false);
  });
});
