/** Saved social evidence. GET is owner-scoped, bounded, and side-effect free. */
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
  "SELECT count(*) FILTER(WHERE received_at>$2::timestamptz-interval '24 hours')::text AS day,count(*)::text AS five FROM oshal_inbox_messages WHERE user_sub = $1 AND category='social' AND received_at<=$2 AND ingested_at<=$2 AND received_at>$2::timestamptz-interval '120 hours'",
  "SELECT subject,snippet,received_at,source FROM oshal_inbox_messages WHERE user_sub = $1 AND category='social' AND received_at<=$2 AND ingested_at<=$2 ORDER BY received_at DESC,msg_id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"day","notifications-24h","Social notices / 24h"],[0,"five","notifications-5d","Social notices / 5d"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"social-signals",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(1).forEach(r=>item(r.subject||'Social notification','Inbox notification / '+date(r.received_at),clip(r.snippet,1400)+'\nCaptured via '+clip(r.source)+'. This is an email notification, not a complete social feed. Review the original source before drafting or posting.', ['prepare-post','prepare-document']));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"social-signals"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"social-signals"});
  items.push({text:"Caller-owned social-category inbox notifications, counted by received time after ingestion. They are not unread totals, a complete social feed, or posting analytics. Selected saved snippets continue into a reviewed Switchboard post or Office document. No live feed fetch, organization model call or publication happens on Home.",tone:'neutral',fix:"social-signals"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
