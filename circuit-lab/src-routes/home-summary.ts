/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the ADR-145 Home tile: caller-owned design
 *                     |                             | counts and the three most recent designs, metadata only (no
 *                     |                             | engine call, no file read). Import-free apart from express and
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
      "SELECT count(*)::text AS total, count(*) FILTER (WHERE state = 'ran')::text AS ran, count(*) FILTER (WHERE state = 'failed')::text AS failed, coalesce(sum(run_count), 0)::text AS runs FROM circuit_design WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2",
      'SELECT title, state, run_count, report, source, updated_at FROM circuit_design WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, design_id LIMIT 3',
    ].map((text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 } as any)));
    const rows = (i: number): any[] => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
    const metric = (i: number, key: string, id: string, label: string) => ({ id, label, value: result[i].status === 'fulfilled' ? String(rows(i)[0]?.[key] ?? '0') : 'Unavailable' });
    const metrics = [metric(0, 'total', 'designs-total', 'Circuits'), metric(0, 'ran', 'designs-ran', 'Solved circuits'), metric(0, 'runs', 'runs-total', 'Runs'), metric(0, 'failed', 'designs-failed', 'Failed runs')];
    const items: any[] = [];
    rows(1).forEach((r) => {
      const report = r.report && typeof r.report === 'object' ? r.report : {};
      const warnings = Array.isArray(report.warnings) ? report.warnings.length : 0;
      const text = clip(r.title, 120);
      const detail = clip(`${r.state} / run ${r.run_count} / ${date(r.updated_at)}`);
      const notes = clip(`${detail}\n${Array.isArray(report.readings) ? report.readings.length : 0} parts read, ${warnings} warnings. ${r.source?.kind === 'example' ? `From the ${r.source.example} example.` : ''} Home reads metadata only.`, 2000);
      items.push({ text, detail, tone: r.state === 'failed' ? 'warn' : 'neutral', fix: 'circuit-lab', actions: [{ integration: 'prepare-document', context: { title: text, notes } }] });
    });
    const failed = result.filter((r) => r.status === 'rejected').length;
    if (failed) items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'circuit-lab' });
    else if (!items.length) items.push({ text: 'No circuits yet. Open Circuit Lab to begin.', tone: 'neutral', fix: 'circuit-lab' });
    items.push({ text: 'Caller-owned circuits and their runs. Home reads metadata only; it never runs the solver or reads a waveform file.', tone: 'neutral', fix: 'circuit-lab' });
    res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
  });
  return router;
}
