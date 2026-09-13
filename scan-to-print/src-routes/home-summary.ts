/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the ADR-145 Home tile. Import-free (express
 *                     |                             | only) so the store Home harness can load it with no framework
 *                     |                             | resolution; session gate is isAuthenticated() === true plus a
 *                     |                             | bound owner subject; SELECT only with a query timeout; a failed
 *                     |                             | source is 503 with no error text echoed. Reads metadata only —
 *                     |                             | never a model file, never a printer.
 */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';

const clip = (v: unknown, cap = 400): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
const date = (v: unknown): string => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };

/**
 * @description Saved scan-to-print evidence for the cockpit Home. GET is owner-scoped, bounded,
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
      "SELECT count(*)::text AS total, count(*) FILTER (WHERE state = 'reconstructed')::text AS reconstructed, count(*) FILTER (WHERE state = 'reconstructed' AND (report->>'printable') = 'true')::text AS printable, count(*) FILTER (WHERE state = 'failed')::text AS failed FROM scan_print_job WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2",
      'SELECT title, state, source_kind, report, updated_at FROM scan_print_job WHERE owner_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, job_id LIMIT 3',
      "SELECT count(*)::text AS sent FROM scan_print_submission WHERE owner_sub = $1 AND created_at <= $2 AND created_at > $2 - interval '7 days' AND state <> 'failed'",
    ].map((text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 } as any)));
    const rows = (i: number): any[] => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
    const metric = (i: number, key: string, id: string, label: string) => ({ id, label, value: result[i].status === 'fulfilled' ? String(rows(i)[0]?.[key] ?? '0') : 'Unavailable' });
    const metrics = [metric(0, 'total', 'jobs-total', 'Objects scanned'), metric(0, 'printable', 'jobs-printable', 'Printable models'), metric(0, 'failed', 'jobs-failed', 'Failed reconstructions'), metric(2, 'sent', 'prints-week', 'Sent to a printer (7 days)')];
    const items: any[] = [];
    rows(1).forEach((r) => {
      const report = r.report && typeof r.report === 'object' ? r.report : {};
      const size = report.sizeMm ? `${Number(report.sizeMm.x).toFixed(1)} × ${Number(report.sizeMm.y).toFixed(1)} × ${Number(report.sizeMm.z).toFixed(1)} mm` : 'not reconstructed yet';
      const text = clip(r.title, 120);
      const detail = clip(`${r.state} / ${r.source_kind} / ${date(r.updated_at)}`);
      const notes = clip(`${detail}\nExtents ${size}. ${report.printable === true ? 'Watertight mesh; ready to print.' : report.printable === false ? 'Mesh not printable — read the report.' : ''} Method: ${clip(report.method ?? 'none')}. Home reads metadata only.`, 2000);
      items.push({ text, detail, tone: r.state === 'failed' ? 'warn' : 'neutral', fix: 'scan-to-print', actions: [{ integration: 'prepare-document', context: { title: text, notes } }] });
    });
    const failed = result.filter((r) => r.status === 'rejected').length;
    if (failed) items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'scan-to-print' });
    else if (!items.length) items.push({ text: 'No objects scanned yet. Open the app to begin.', tone: 'neutral', fix: 'scan-to-print' });
    items.push({ text: 'Caller-owned scan jobs, drawings and print submissions. Home reads metadata only; it never reconstructs, reads a model file, or contacts a printer.', tone: 'neutral', fix: 'scan-to-print' });
    res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
  });
  return router;
}
