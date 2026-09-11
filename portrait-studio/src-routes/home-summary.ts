/** Saved portrait-studio evidence. GET is owner-scoped, bounded, and side-effect free. */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
const clip = (v: unknown, cap = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0,cap);
const date = (v: unknown) => { const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : 'date unavailable'; };
export function createHomeSummaryRoutes(ctx: AppContext): Router {
 const router = Router();
 router.get('/', async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  const oidc = (req as any).oidc, sub = oidc?.user?.sub || oidc?.user?.oid;
  if (!sub || oidc?.isAuthenticated?.() !== true) { res.status(401).json({error:'not_authenticated'}); return; }
  const now = new Date();
  const result = await Promise.allSettled([
  "SELECT count(*) FILTER (WHERE status IN ('queued','generating'))::text AS active, count(*) FILTER (WHERE status='failed')::text AS failed, count(*) FILTER (WHERE status='done' AND updated_at > $2::timestamptz - interval '120 hours')::text AS five FROM ps_portraits WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2",
  "SELECT mode, style, status, updated_at FROM ps_portraits WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY updated_at DESC, portrait_id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"active","portraits-active","Portraits generating"],[0,"failed","portraits-failed","Failed portraits"],[0,"five","portraits-done-5d","Portraits done / 5d"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"portrait-studio",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(1).forEach(r => item(clip(r.mode) + ' portrait', clip(r.style) + ' · ' + clip(r.status) + ' · updated ' + date(r.updated_at), 'Prepare a profile or brand document. This handoff contains portrait metadata, not the image file. Open Portrait Studio to review and export the image.', ['prepare-document'], r.status==='failed' ? 'warn' : 'neutral'));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"portrait-studio"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"portrait-studio"});
  items.push({text:"Saved generation states distinguish work in progress, failed work and completed portraits. The five-day window uses the last update, not a separate completion timestamp. Existing image review/export remains in Portrait Studio; document preparation sends only selected metadata.",tone:'neutral',fix:"portrait-studio"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
