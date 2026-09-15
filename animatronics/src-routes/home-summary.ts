/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the ADR-145 Home tile: caller-owned rig
 *                     |                             | counts (rigs, armed rigs, logged commands) and the three most
 *                     |                             | recent rigs, metadata only. Import-free apart from express and
 *                     |                             | the app context type, per the Home summary contract.
 */

import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';

const clip = (v: unknown, cap = 400): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const date = (v: unknown): string => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };

/**
 * @description Build the Home summary route.
 * @param ctx - The per-package AppContext (pool).
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
      'SELECT count(*)::text AS total, count(*) FILTER (WHERE armed)::text AS armed, coalesce(sum(run_count), 0)::text AS runs FROM animatronic_rig WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2',
      'SELECT title, armed, run_count, source, updated_at FROM animatronic_rig WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, rig_id LIMIT 3',
    ].map((text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 } as any)));
    const rows = (i: number): any[] => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
    const metric = (i: number, key: string, id: string, label: string) => ({ id, label, value: result[i].status === 'fulfilled' ? String(rows(i)[0]?.[key] ?? '0') : 'Unavailable' });
    const metrics = [metric(0, 'total', 'rigs-total', 'Rigs'), metric(0, 'armed', 'rigs-armed', 'Armed rigs'), metric(0, 'runs', 'runs-total', 'Logged commands')];
    const items: any[] = [];
    rows(1).forEach((r) => {
      const text = clip(r.title, 120);
      const detail = clip(`${r.armed ? 'armed' : 'disarmed'} / ${r.run_count} commands / ${date(r.updated_at)}`);
      const notes = clip(`${detail}. ${r.source?.kind === 'template' ? `From the ${r.source.template} template.` : ''} Home reads metadata only.`, 2000);
      items.push({ text, detail, tone: r.armed ? 'warn' : 'neutral', fix: 'animatronics', actions: [{ integration: 'prepare-document', context: { title: text, notes } }] });
    });
    const failed = result.filter((r) => r.status === 'rejected').length;
    if (failed) items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'animatronics' });
    else if (!items.length) items.push({ text: 'No rigs yet. Open Animatronics to begin.', tone: 'neutral', fix: 'animatronics' });
    items.push({ text: 'Caller-owned rigs and their command log. Home reads metadata only; it never compiles a frame or talks to a controller.', tone: 'neutral', fix: 'animatronics' });
    res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
  });
  return router;
}
