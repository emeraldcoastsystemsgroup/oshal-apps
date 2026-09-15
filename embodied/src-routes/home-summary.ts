/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the ADR-145 Home tile. Import-free (express
 *                     |                             | only) so the store Home harness can load it with no framework
 *                     |                             | resolution; session gate is isAuthenticated() === true plus a
 *                     |                             | bound owner subject; SELECT only with a query timeout; a failed
 *                     |                             | source is 503 with no error text echoed. Reads task metadata
 *                     |                             | only — never the world, never a node.
 */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';

const clip = (v: unknown, cap = 400): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const date = (v: unknown): string => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };

/**
 * @description Saved embodied-task evidence for the cockpit Home. GET is owner-scoped, bounded,
 * and side-effect free.
 * @param ctx - The per-package context; only `pool` is read.
 * @returns The router.
 */
export function createHomeSummaryRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const oidc = (req as any).oidc;
    const sub = oidc?.user?.sub || oidc?.user?.oid;
    if (!sub || oidc?.isAuthenticated?.() !== true) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const now = new Date();
    const result = await Promise.allSettled([
      "SELECT count(*)::text AS total, count(*) FILTER (WHERE status = 'done')::text AS done, count(*) FILTER (WHERE status IN ('failed', 'aborted'))::text AS stopped, count(*) FILTER (WHERE status = 'executing')::text AS executing FROM embodied_task WHERE owner_sub = $1 AND created_at <= $2",
      'SELECT title, status, current_step, failure, updated_at FROM embodied_task WHERE owner_sub = $1 AND created_at <= $2 ORDER BY updated_at DESC, task_id LIMIT 3',
      "SELECT count(*)::text AS refused FROM embodied_command_log WHERE owner_sub = $1 AND created_at <= $2 AND created_at > $2 - interval '7 days' AND outcome = 'refused'",
    ].map((text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 } as any)));
    const rows = (i: number): any[] => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
    const metric = (i: number, key: string, id: string, label: string) => ({ id, label, value: result[i].status === 'fulfilled' ? String(rows(i)[0]?.[key] ?? '0') : 'Unavailable' });
    const metrics = [metric(0, 'total', 'tasks-total', 'Physical tasks drafted'), metric(0, 'done', 'tasks-done', 'Completed in simulation'), metric(0, 'stopped', 'tasks-stopped', 'Failed or aborted'), metric(2, 'refused', 'commands-refused', 'Commands refused (7 days)')];
    const items: any[] = [];
    rows(1).forEach((r) => {
      const text = clip(r.title, 120);
      const detail = clip(`${r.status} / step ${Number(r.current_step) + 1} / ${date(r.updated_at)}`);
      items.push({ text, detail, tone: r.status === 'failed' ? 'warn' : 'neutral', fix: 'embodied', notes: clip(r.failure ?? '', 400) });
    });
    const failed = result.filter((r) => r.status === 'rejected').length;
    if (failed) items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'embodied' });
    else if (!items.length) items.push({ text: 'No physical task drafted yet. Open the app to run the simulation.', tone: 'neutral', fix: 'embodied' });
    items.push({ text: 'Simulation only: every task here ran against the simulated kitchen, never a real arm or drone. Home reads task metadata only.', tone: 'neutral', fix: 'embodied' });
    res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
  });
  return router;
}
