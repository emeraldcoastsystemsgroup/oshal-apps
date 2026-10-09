/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the Home summary for Scene Studio: project and
 *                     |                             | revision counts and the three most recent projects. Home reads
 *                     |                             | metadata only; it never runs the engine or reads a project file.
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
      "SELECT count(*)::text AS total, count(*) FILTER (WHERE kind = 'godot')::text AS godot, count(*) FILTER (WHERE kind = 'blender')::text AS blender, coalesce(sum(revision), 0)::text AS revisions FROM scene_project WHERE owner_sub = $1 AND created_at <= $2",
      'SELECT title, kind, revision, preview, last_run, updated_at FROM scene_project WHERE owner_sub = $1 AND created_at <= $2 ORDER BY updated_at DESC, project_id LIMIT 3',
    ].map((text) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 } as any)));
    const rows = (i: number): any[] => { const r = result[i]; return r.status === 'fulfilled' ? r.value.rows : []; };
    const metric = (i: number, key: string, id: string, label: string) => ({ id, label, value: result[i].status === 'fulfilled' ? String(rows(i)[0]?.[key] ?? '0') : 'Unavailable' });
    const metrics = [metric(0, 'total', 'projects-total', 'Projects'), metric(0, 'godot', 'projects-godot', 'Godot games'), metric(0, 'blender', 'projects-blender', 'Blender models'), metric(0, 'revisions', 'revisions-total', 'Revisions')];
    const items: any[] = [];
    rows(1).forEach((r) => {
      const text = clip(r.title, 120);
      const kind = r.kind === 'godot' ? 'Godot game' : 'Blender model';
      const detail = `${kind} / revision ${r.revision} / ${date(r.updated_at)}`;
      const errors = Array.isArray(r.last_run?.errors) ? r.last_run.errors.length : 0;
      const state = r.preview ? `preview at revision ${r.preview.revision}` : 'no preview yet';
      items.push({ text, detail: clip(`${detail} / ${state}${r.last_run ? ` / last run ${errors} error line(s)` : ''}`), tone: errors ? 'warn' : 'neutral', fix: 'scene-studio' });
    });
    const failed = result.filter((r) => r.status === 'rejected').length;
    if (failed) items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'scene-studio' });
    else if (!items.length) items.push({ text: 'No projects yet. Open Scene Studio to start a Godot game or a Blender model.', tone: 'neutral', fix: 'scene-studio' });
    items.push({ text: 'Caller-owned Godot and Blender projects and their revisions. Home reads metadata only; it never runs the engine or reads a project file.', tone: 'neutral', fix: 'scene-studio' });
    res.status(failed === result.length ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
  });
  return router;
}
