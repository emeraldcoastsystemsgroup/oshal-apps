/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | GET /events/plans on the native kernel. The kernel bridge (OSHAL_EGRESS=kernel) serves a schedule service whose every method refuses, and a refusal fails the whole request even when the route catches it, so the list answered 503 "trading schedule service listSchedules is unavailable in this native runtime". A REAL express Router composed by the package's own registerTradingEventPlanRoutes is driven with a schedule service shaped like the bridge's (truthy, every method refusing and recording the call): natively the list answers 200 with the book's plans and every plan, scheduled false, and the schedule service is never called; off the native kernel the same route still asks the scheduler, so an active owner-matching schedule still reads scheduled true.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { registerTradingEventPlanRoutes } from '../src-routes/trading-event-plan-routes';

const SUB = 'k-event-plans-native-spec-sub';
const BOOK = { bookId: 'book-native-spec', ref: 'b-native', kind: 'paper', enabled: true };

const kernel = vi.hoisted(() => ({
  refused: [] as string[],
  listSchedules: vi.fn(),
  listEventPlans: vi.fn(),
}));

vi.mock('@/app/trading-schedule-dispatch', () => {
  /** The bridge's shape: a truthy service whose every method refuses (and the kernel fails the request). */
  const refuse = (method: string) => async () => {
    kernel.refused.push(method);
    throw Object.assign(new Error(`trading schedule service ${method} is unavailable in this native runtime`), { status: 503 });
  };
  return {
    getTradingScheduleService: () => (process.env.OSHAL_EGRESS === 'kernel'
      ? { listSchedules: refuse('listSchedules'), createSchedule: refuse('createSchedule') }
      : { listSchedules: kernel.listSchedules }),
  };
});
vi.mock('@/app/trading-event-plans', () => ({
  EVENT_PLANS_CRON: '0 * * * *', EVENT_PLANS_TIMEZONE: 'America/New_York',
  eventPlansEnabled: () => false,
  eventPlanTaskType: (sub: string) => `trading-events:${sub}`,
  ensureEventPlansSchema: async () => undefined,
  listEventPlans: kernel.listEventPlans,
  getEventPlan: async () => null,
  normalizeEventPlanParams: (p: unknown) => p,
  dryRunEventPlan: () => null,
  createEventPlan: async () => { throw new Error('not used'); },
  updateEventPlan: async () => { throw new Error('not used'); },
  deleteEventPlan: async () => { throw new Error('not used'); },
  armEventPlan: async () => { throw new Error('not used'); },
  disarmEventPlan: async () => { throw new Error('not used'); },
}));
vi.mock('@/app/routes/trading-routes-helpers', () => {
  class TradingError extends Error {
    constructor(public httpStatus: number, public code: string, message: string) { super(message); }
  }
  return {
    TradingError,
    callerSub: (req: { oidc?: { user?: { sub?: string } } }) => req.oidc?.user?.sub ?? null,
    resolveBook: async () => BOOK,
  };
});
vi.mock('@/app/trading-books-store', () => ({ loadBook: async () => null }));
vi.mock('@/features/trading', () => ({ getBrokerReader: () => ({ configured: () => false }) }));
vi.mock('@/app/routes/free-tier-rotation', () => ({ resolveUserLlmConnection: async () => null }));
vi.mock('@/app/routes/inline-bot-execution', () => ({ executeBotOrInline: async () => ({ response: '' }) }));

const ctx = { pool: {} } as unknown as AppContext;
const PLAN_HERE = { planId: 'plan-here', bookId: BOOK.bookId, name: 'IPO entry', status: 'draft' };
const PLAN_ELSEWHERE = { planId: 'plan-elsewhere', bookId: 'another-book', name: 'Other IPO', status: 'draft' };

/**
 * @description Drive one GET through a real express Router composed by the package's own registration.
 * @param url - Path under the trading mount, query string included.
 * @returns The status and JSON payload the handler produced.
 */
async function get(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const router = express.Router();
  registerTradingEventPlanRoutes(router, ctx);
  const [pathname, qs] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  let status = 200;
  let body: Record<string, unknown> = {};
  await new Promise<void>((resolve, reject) => {
    const res: Record<string, unknown> = {};
    res.status = (code: number) => { status = code; return res; };
    res.json = (payload: Record<string, unknown>) => { body = payload; resolve(); return res; };
    const req = { method: 'GET', url: pathname, originalUrl: pathname, baseUrl: '', path: pathname, body: {}, query,
      headers: {}, get: () => undefined, oidc: { user: { sub: SUB } } };
    (router as unknown as (a: unknown, b: unknown, n: (e?: unknown) => void) => void)(
      req, res, (err?: unknown) => reject(err instanceof Error ? err : new Error(`no route matched GET ${pathname}`)));
  });
  return { status, body };
}

beforeEach(() => {
  kernel.refused = [];
  kernel.listEventPlans.mockImplementation(async (_pool: unknown, _sub: string, opts?: { bookId?: string }) =>
    [PLAN_HERE, PLAN_ELSEWHERE].filter((p) => !opts?.bookId || p.bookId === opts.bookId));
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe('GET /events/plans on the native kernel', () => {
  it('answers 200 with the plans and scheduled false, never calling the refusing schedule service', async () => {
    vi.stubEnv('OSHAL_EGRESS', 'kernel');
    const r = await get('/events/plans?book=b-native');
    expect(r.status).toBe(200);
    expect(kernel.refused).toEqual([]);
    expect(r.body).toEqual({ plans: [PLAN_HERE], allPlans: [PLAN_HERE, PLAN_ELSEWHERE], enabled: false, scheduled: false, book: 'b-native' });
    expect(kernel.listEventPlans).toHaveBeenCalledWith(ctx.pool, SUB, { bookId: BOOK.bookId });
    expect(kernel.listEventPlans).toHaveBeenCalledWith(ctx.pool, SUB);
  });

  it('off the native kernel still asks the scheduler, and an active owner-matching schedule reads scheduled true', async () => {
    vi.stubEnv('OSHAL_EGRESS', '');
    kernel.listSchedules.mockResolvedValue([{ taskType: `trading-events:${SUB}`, ownerSub: SUB, status: 'active' }]);
    const r = await get('/events/plans?book=b-native');
    expect(r.status).toBe(200);
    expect(kernel.listSchedules).toHaveBeenCalledWith({ ownerSub: SUB, scope: 'mine' });
    expect(r.body.scheduled).toBe(true);
  });
});
