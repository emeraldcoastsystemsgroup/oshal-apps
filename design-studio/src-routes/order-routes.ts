/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D3 as built (0.4.0): engine orders. POST files one and waits while the open page runs it (a kernel route call ends at 60 s, so the wait stops at 40 s and a long action reads back later); an order no page took within a few seconds answers 202 saying the product page is not open.
 */
import type { Request, Response, Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { ModelError } from './phase-model';
import { validateOrder } from './order-model';
import { claimOrder, createOrder, finishOrder, getOrder, pendingOrders, type OrderRow } from './order-store';

const logger = createChildLogger({ module: 'design-studio-orders' });
type Pool = AppContext['pool'];

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How long an unclaimed order stays on offer: long enough to open the page, short enough that a stale one never runs by surprise. */
export const ORDER_MAX_AGE_MS = 15 * 60 * 1000;
const WAIT_MS = 40_000; const CLAIM_WAIT_MS = 8_000; const POLL_MS = 1_000; const STATUS_WAIT_MS = 45_000;
const RESULT_CAP = 60_000;

/** @description What the order routes need from the project routes. */
export interface OrderDeps { pool: Pool; callerSub: (req: Request) => string | null; withProject: (pool: Pool, req: Request, res: Response) => Promise<{ sub: string; project: { id: string } } | null> }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const bounded = (ms: unknown, limit: number): number => (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? Math.min(ms, limit) : limit);

/** Wait for the page: until it finishes, or until no page took the order, or until the route's own limit. */
async function waitFor(pool: Pool, sub: string, order: OrderRow, waitMs: number, claimWaitMs: number): Promise<{ order: OrderRow; note?: string }> {
  const started = Date.now();
  let current: OrderRow = order;
  while (Date.now() - started < waitMs) {
    const read = await getOrder(pool, sub, order.id);
    if (read) current = read;
    if (current.status === 'done' || current.status === 'failed') return { order: current };
    if (current.status === 'pending' && Date.now() - started >= claimWaitMs) return { order: current, note: 'The product page is not open, so nothing ran yet. Ask the person to open this product in Design Studio; the order runs when it opens, for the next 15 minutes.' };
    await sleep(POLL_MS);
  }
  return { order: current, note: 'The engine is still working. Read it once with design-order-status, which waits for it. If it is still running after that, tell the person it is running and that the poster will show the result, and end the turn.' };
}

function fileOrder(router: Router, d: OrderDeps): void {
  router.post('/projects/:id/orders', async (req: Request, res: Response) => {
    const c = await d.withProject(d.pool, req, res); if (!c) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const { action, input } = validateOrder(body);
      const order = await createOrder(d.pool, c.sub, c.project.id, action, input);
      logger.info({ sub: c.sub, projectId: c.project.id, action, orderId: order.id }, 'Engine order filed');
      const out = await waitFor(d.pool, c.sub, order, bounded(body.waitMs, WAIT_MS), bounded(body.claimWaitMs, CLAIM_WAIT_MS));
      res.status(out.order.status === 'done' || out.order.status === 'failed' ? 201 : 202).json(out);
    } catch (error) {
      if (error instanceof ModelError) { res.status(error.status).json({ error: error.code, field: error.field, message: error.message }); return; }
      logger.error({ err: error }, 'File order failed'); res.status(500).json({ error: 'file_order_failed' });
    }
  });
  router.get('/projects/:id/orders/:orderId', async (req: Request, res: Response) => {
    const c = await d.withProject(d.pool, req, res); if (!c) return;
    try {
      const id = String(req.params.orderId);
      let order = ID.test(id) ? await getOrder(d.pool, c.sub, id) : null;
      if (!order || order.project_id !== c.project.id) { res.status(404).json({ error: 'order_not_found' }); return; }
      // ?wait=1 holds the read while the page is still running it, so the partner reads once instead of spending its tool steps polling.
      const started = Date.now();
      while (req.query.wait === '1' && order && (order.status === 'running' || order.status === 'pending') && Date.now() - started < STATUS_WAIT_MS) { await sleep(POLL_MS); order = await getOrder(d.pool, c.sub, id); }
      res.setHeader('Cache-Control', 'no-store'); res.json({ order });
    } catch (error) { logger.error({ err: error }, 'Read order failed'); res.status(500).json({ error: 'read_order_failed' }); }
  });
}

function runOrders(router: Router, d: OrderDeps): void {
  router.get('/orders/pending', async (req: Request, res: Response) => {
    const sub = d.callerSub(req); if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    try { res.setHeader('Cache-Control', 'no-store'); res.json({ orders: await pendingOrders(d.pool, sub, ORDER_MAX_AGE_MS) }); }
    catch (error) { logger.error({ err: error }, 'List orders failed'); res.status(500).json({ error: 'list_orders_failed' }); }
  });
  router.post('/orders/:orderId/claim', async (req: Request, res: Response) => {
    const sub = d.callerSub(req); if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    try {
      const order = ID.test(String(req.params.orderId)) ? await claimOrder(d.pool, sub, String(req.params.orderId)) : null;
      if (!order) { res.status(409).json({ error: 'order_taken' }); return; }
      res.json({ order });
    } catch (error) { logger.error({ err: error }, 'Claim order failed'); res.status(500).json({ error: 'claim_order_failed' }); }
  });
  router.post('/orders/:orderId/finish', async (req: Request, res: Response) => {
    const sub = d.callerSub(req); if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    const body = (req.body ?? {}) as { ok?: unknown; result?: unknown };
    try {
      const text = JSON.stringify(body.result ?? null);
      const result = text.length > RESULT_CAP ? { truncated: true, bytes: text.length, head: text.slice(0, RESULT_CAP) } : body.result ?? null;
      const order = ID.test(String(req.params.orderId)) ? await finishOrder(d.pool, sub, String(req.params.orderId), body.ok === true, result) : null;
      if (!order) { res.status(404).json({ error: 'order_not_running' }); return; }
      logger.info({ sub, orderId: order.id, action: order.action, status: order.status }, 'Engine order finished');
      res.json({ order });
    } catch (error) { logger.error({ err: error }, 'Finish order failed'); res.status(500).json({ error: 'finish_order_failed' }); }
  });
}

/**
 * @description Mount the engine-order routes.
 * @param router - The package router. @param deps - The pool and the caller and project loaders.
 * @returns Nothing.
 */
export function registerOrders(router: Router, deps: OrderDeps): void {
  fileOrder(router, deps);
  runOrders(router, deps);
}
