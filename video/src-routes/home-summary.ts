/** Saved video evidence. GET is owner-scoped, bounded, and side-effect free. */
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
  "SELECT count(*) FILTER (WHERE status='awaiting_approval')::text AS review, count(*) FILTER (WHERE status IN ('scripting','rendering','assembling'))::text AS active, count(*) FILTER (WHERE status='failed')::text AS failed FROM video_series WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2",
  "SELECT count(*)::text AS five FROM oshal_videos WHERE user_sub = $1 AND created_at <= $2 AND created_at > $2::timestamptz - interval '120 hours'",
  "SELECT s.title, s.premise, s.status, s.updated_at, (SELECT count(*) FROM video_episodes e WHERE e.series_id=s.series_id AND e.user_sub = $1 AND e.status='assembled' AND e.created_at <= $2 AND e.updated_at <= $2)::text AS assembled FROM video_series s WHERE s.user_sub = $1 AND s.created_at <= $2 AND s.updated_at <= $2 ORDER BY (s.status IN ('awaiting_approval','failed')) DESC, s.updated_at DESC, s.series_id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"review","scripts-review","Scripts needing approval"],[0,"active","series-active","Series in progress"],[0,"failed","series-failed","Failed series"],[1,"five","videos-saved-5d","Videos saved / 5 days"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"video-studio",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(2).forEach(r => item(r.title, clip(r.status) + ' · ' + clip(r.assembled) + ' episodes recorded assembled · updated ' + date(r.updated_at), clip(r.premise,1500), ['prepare-document','prepare-video'], ['failed','awaiting_approval'].includes(r.status) ? 'warn' : 'neutral'));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"video-studio"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"video-studio"});
  items.push({text:"Series and episode states are saved pipeline evidence. Saved video rows count completed saves, not current remote file availability. Script review stays explicit; preparing a continuation never starts rendering.",tone:'neutral',fix:"video-studio"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
