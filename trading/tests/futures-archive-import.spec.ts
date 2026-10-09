/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise operator routes and actual console handlers for exact-preview archive confirmation and navigation fences.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '@/app/composition-root';
import { createTradingAutopilotRoutes } from '../src-routes/trading-autopilot-routes';

const service = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), confirm: vi.fn() }));
vi.mock('@/app/trading-futures-archive-import', () => ({ listFuturesArchiveImports: service.list,
  previewFuturesArchive: service.preview, confirmFuturesArchive: service.confirm }));
beforeEach(() => vi.stubEnv('OSHAL_OPERATOR_SUBS', 'archive-owner'));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
const id = 'de7239ad-4a97-40ed-9d93-1a6bf1844c52';
const confirmation = 'IMPORT SHARED FUTURES BARS';
const job = { importId: id, status: 'ready', config: { roots: ['ES'], dataDir: '<private>' },
  createdAt: '2025-10-02', plan: { fingerprint: 'a'.repeat(64), totalBars: 12, incomplete: 1 } };
async function request(method: string, suffix = '', sub?: string, body: unknown = {}, pool = true): Promise<{ status: number; body: any }> {
  const router = createTradingAutopilotRoutes({ pool: pool ? {} : undefined } as AppContext);
  const url = '/futures/archive' + suffix;
  return new Promise((done, reject) => {
    let status = 200;
    const res = { status(value: number) { status = value; return res; }, json(value: any) { done({ status, body: value }); return res; } };
    (router as any)({ method, url, originalUrl: url, baseUrl: '', headers: {}, get: () => undefined, body,
      query: { ownerSub: 'forged' }, oidc: { user: sub ? { sub } : undefined } }, res, reject);
  });
}
function ui() {
  const fields: Record<string, any> = {}, api = vi.fn(); let gone = false;
  const element = (name: string) => fields[name] ||= { value: '', checked: false, innerHTML: '', textContent: '', contains: () => true };
  const context = createContext({ $: element, api, jbody: (method: string, body: unknown) => ({ method, body }),
    esc: (value: unknown) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    RENDER_TOKEN: 1, tabGen: () => 1, stale: () => gone, tabStale: () => gone, encodeURIComponent });
  runInContext(readFileSync(resolve(__dirname, '../tools/ui/view-futures-archive.js'), 'utf8'), context);
  for (const [name, value] of Object.entries({ futRoots: ' ES, CL ', futDir: ' /server/archive ', futVolume: '7',
    futArchiveZone: 'America/Chicago', futStart: '2025-10-01', futEndMode: 'fixed', futEnd: '2025-10-31' })) element(name).value = value;
  element('futArchiveHourly').checked = true; element('futArchiveDaily').checked = true;
  return { fields, api, element, context, leave: () => { gone = true; } };
}
describe('Futures archive console boundary', () => {
  it.each([['GET', ''], ['POST', '/preview'], ['POST', `/${id}/import`]])('requires an authenticated operator on %s %s', async (method, suffix) => {
    expect((await request(method, suffix)).status).toBe(401);
    expect((await request(method, suffix, 'ordinary')).status).toBe(403);
    expect((await request(method, suffix, 'archive-owner', {}, false)).status).toBe(503);
    expect(service.list).not.toHaveBeenCalled(); expect(service.preview).not.toHaveBeenCalled(); expect(service.confirm).not.toHaveBeenCalled();
  });
  it('passes exact authenticated ownership and bodies through the actual mounted routes', async () => {
    service.list.mockResolvedValue([job]); service.preview.mockResolvedValue(job); service.confirm.mockResolvedValue(job);
    expect((await request('GET', '', 'archive-owner')).body).toEqual({ imports: [job] });
    expect(service.list.mock.calls[0][1]).toBe('archive-owner');
    const config = { roots: ['ES'], ownerSub: 'forged' };
    expect((await request('POST', '/preview', 'archive-owner', config)).status).toBe(202);
    expect(service.preview.mock.calls[0].slice(1)).toEqual(['archive-owner', config]);
    const body = { confirmation, fingerprint: job.plan.fingerprint };
    expect((await request('POST', `/${id}/import`, 'archive-owner', body)).status).toBe(202);
    expect(service.confirm.mock.calls[0].slice(1)).toEqual(['archive-owner', id, body]);
  });
  it('returns safe validation, ownership and busy refusals without leaking infrastructure details', async () => {
    for (const [error, status, message] of [[new TypeError('/private/source'), 400, 'invalid_archive_settings'],
      [Object.assign(new Error('internal'), { code: '23505' }), 409, 'another_archive_worker_is_active'],
      [Object.assign(new Error('owned_archive_preview_not_found'), { statusCode: 404 }), 404, 'owned_archive_preview_not_found'],
      [new Error('postgres://secret@host'), 503, 'futures_archive_unavailable']] as const) {
      service.preview.mockRejectedValue(error);
      expect(await request('POST', '/preview', 'archive-owner')).toEqual({ status, body: { error: message } });
    }
  });
  it('reads explicit source controls and previews without saving a study or importing', async () => {
    const { context, api, fields, element } = ui();
    const form = (context.futuresArchiveForm as any)();
    expect(form).toEqual({ roots: ['ES','CL'], dataDir: '/server/archive', minVolume: 7, sourceTimeZone: 'America/Chicago',
      timeframes: ['1Hour','1Day'], start: '2025-10-01', end: '2025-10-31' });
    fields.futArchiveZone.value = ''; fields.futArchiveDaily.checked = false;
    expect((context.futuresArchiveForm as any)()).toMatchObject({ sourceTimeZone: '', timeframes: ['1Hour'] });
    fields.futEndMode.value = 'latest';
    expect((context.futuresArchiveForm as any)().end).toBe(new Date(Date.now() - 86400000).toISOString().slice(0,10));
    api.mockResolvedValue({ imports: [job] }); element('futArchiveConfirmation').value = confirmation;
    const button = { disabled: false }; await (context.previewFuturesArchiveFromConsole as any)(button);
    expect(api.mock.calls.map(call => call[0])).toEqual(['/autopilot/futures/archive/preview','/autopilot/futures/archive']);
    expect(api.mock.calls[0][1].method).toBe('POST'); expect(fields.futArchiveConfirmation.value).toBe(''); expect(button.disabled).toBe(false);
    expect((context.futuresArchiveControls as any)()).toContain('no shared-bar writes');
  });
  it('requires typed confirmation and imports the frozen receipt, not edited controls', async () => {
    const { context, api, fields, element } = ui(); const button = { disabled: false };
    await (context.confirmFuturesArchiveFromConsole as any)(job, button); expect(api).not.toHaveBeenCalled();
    element('futArchiveConfirmation').value = confirmation; fields.futDir.value = '/different/source';
    api.mockResolvedValue({ imports: [] }); await (context.confirmFuturesArchiveFromConsole as any)(job, button);
    expect(api.mock.calls[0]).toEqual([`/autopilot/futures/archive/${id}/import`, { method: 'POST', body: { confirmation, fingerprint: job.plan.fingerprint } }]);
    expect(fields.futArchiveConfirmation.value).toBe(''); expect(button.disabled).toBe(false);
  });
  it('escapes owned evidence, offers only ready previews and renders actual completion counts', async () => {
    const { context, api, fields } = ui(); api.mockResolvedValue({ imports: [job] });
    await (context.loadFuturesArchiveImports as any)();
    expect(fields.futArchiveJobs.innerHTML).toContain('&lt;private>'); expect(fields.futArchiveJobs.innerHTML).not.toContain('<private>');
    expect(fields.futArchiveJobs.innerHTML).toContain('data-futures-import="' + id + '"');
    const card = (context.futuresArchiveCard as any)({ ...job, status: 'completed', inserted: 2, unchanged: 10 });
    expect(card).toContain('Committed 2 new bars; 10 identical bars unchanged'); expect(card).not.toContain('data-futures-import');
  });
  it.each(['loadFuturesArchiveImports','previewFuturesArchiveFromConsole','confirmFuturesArchiveFromConsole'])('fences late %s responses before painting another tab', async method => {
    const { context, api, fields, element, leave } = ui(); element('futArchiveConfirmation').value = confirmation;
    let finish!: (value: unknown) => void; api.mockReturnValue(new Promise(resolveResult => { finish = resolveResult; }));
    const button = { disabled: false };
    const pending = (context[method] as any)(...(method === 'confirmFuturesArchiveFromConsole' ? [job, button] : [button]));
    leave(); finish({ imports: [job] }); await pending;
    expect(fields.futArchiveJobs).toBeUndefined(); expect(fields.futArchiveMsg).toBeUndefined();
    expect(fields.futArchiveConfirmation.value).toBe(confirmation); expect(api).toHaveBeenCalledTimes(1); expect(button.disabled).toBe(false);
  });
});
