/** Saved camera evidence. GET is owner-scoped, bounded, and side-effect free. */
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
  "SELECT count(*) FILTER(WHERE created_at>$2::timestamptz-interval '24 hours')::text AS day,count(*)::text AS five,count(*) FILTER(WHERE outcome='rejected')::text AS rejected FROM camera_command_log WHERE user_sub = $1 AND created_at<=$2 AND created_at>$2::timestamptz-interval '120 hours'",
  "SELECT camera_id,op,outcome,created_at FROM camera_command_log WHERE user_sub = $1 AND created_at<=$2 ORDER BY created_at DESC,log_id LIMIT 3"
].map(text => ctx.pool.query({text,values:[String(sub),now],query_timeout:1800} as any)));
  const rows = (i: number): any[] => { const r=result[i]; return r.status==='fulfilled' ? r.value.rows : []; };
  const metrics = [[0,"day","commands-24h","Commands logged / 24h"],[0,"five","commands-5d","Commands logged / 5d"],[0,"rejected","rejected-5d","Rejected commands / 5d"]].map(([i,key,id,label]) => ({id,label,value:result[Number(i)].status==='fulfilled' ? String(rows(Number(i))[0]?.[key] ?? '0') : 'Unavailable'}));
  const items: any[] = [];
  const item = (title: unknown, detail: string, body: string, actions: string[], tone = 'neutral') => {
   const text = clip(title,120), notes = clip(detail + '\n' + body,2000);
   items.push({text,detail:clip(detail),tone,fix:"camera-ops",actions:actions.map(integration => ({integration,context:{title:text,notes}}))});
  };
  rows(1).forEach(r=>item('Camera '+clip(r.camera_id),clip(r.op)+' / '+clip(r.outcome)+' / '+date(r.created_at),'Command log only. Acceptance does not prove capture completion, media availability or physical device state. The log may include simulated cameras.', ['prepare-document'],r.outcome==='rejected'?'warn':'neutral'));
  const failed=result.filter(r => r.status==='rejected').length;
  if(failed) items.push({text:'Some saved sources cannot be checked.',tone:'warn',fix:"camera-ops"});
  else if(!items.length) items.push({text:'No saved work yet. Open the app to begin.',tone:'neutral',fix:"camera-ops"});
  items.push({text:"Your recorded camera commands, including rejected attempts. Simulation and hardware commands share this audit log; it cannot establish physical success. Prepare a diagnostic brief from selected metadata without transferring captures or issuing commands.",tone:'neutral',fix:"camera-ops"});
  res.status(failed===result.length ? 503 : 200).json({metrics,tiles:metrics,items,asOf:now.toISOString(),partial:failed>0});
 });
 return router;
}
