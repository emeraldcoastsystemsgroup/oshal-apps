/** Saved vids evidence. GET is owner-scoped, bounded, and side-effect free. */
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
  "SELECT count(*) FILTER (WHERE status IN ('queued','running'))::text AS active, count(*) FILTER (WHERE status='failed')::text AS failed FROM vids_jobs WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2",
  "SELECT count(*) FILTER (WHERE updated_at > $2::timestamptz - interval '24 hours')::text AS day, count(*)::text AS five FROM vids_jobs WHERE user_sub = $1 AND created_at <= $2 AND status='done' AND updated_at <= $2 AND updated_at > $2::timestamptz - interval '120 hours'",
  "SELECT idea, status, orientation, updated_at FROM vids_jobs WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2 ORDER BY (status IN ('failed','queued','running')) DESC, updated_at DESC, job_id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"active","jobs-active","Queued / rendering"],[0,"failed","jobs-failed","Failed jobs"],[1,"day","jobs-done-24h","Done jobs updated / 24h"],[1,"five","jobs-done-5d","Done jobs updated / 5d"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"vids-studio",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(2).forEach(r => item(clip(r.idea,120), clip(r.status) + ' · ' + clip(r.orientation || 'orientation not recorded') + ' · updated ' + date(r.updated_at), clip(r.idea,1500), ['prepare-document','prepare-episode'], r.status==='failed' ? 'warn' : 'neutral'));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"vids-studio"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"vids-studio"});
  items.push({text:"Done means the worker recorded completion, not social publication. Windows use last update because the ledger has no completion timestamp. Home does not drive the editor, retry jobs or consume rendering credits.",tone:'neutral',fix:"vids-studio"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
